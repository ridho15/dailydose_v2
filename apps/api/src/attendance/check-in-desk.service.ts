import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../foundation/audit.service';
import type { SessionPrincipal } from '../identity/identity.service';
import { PolicyService } from '../identity/policy.service';
import { PRIVATE_FILE_STORAGE, type PrivateFileStorage } from '../identity/private-file-storage';
import { ApiProblem } from '../identity/security';
import { dateInTimeZone, startOfLocalDateUtc } from '../identity/assignment-boundary';
import { catatanKeputusan, evaluasiKuota, type EvaluasiKuota } from '../classes/kuota-minimum';
import { calculateSlotFee, sortFeesNewestFirst } from '../packages/instructor-fee-calculator';

/**
 * Layar check-in meja depan: kelas hari ini di satu cabang, siapa yang sudah tercatat, dan kelas
 * yang perlu diputuskan atau ditutup.
 *
 * Semua dibaca dari tabel yang sudah ada. Keputusan menjalankan kelas di bawah kuota disimpan di
 * `audit_log` dengan aksi `class.below_quota_continued`, tempat yang sama dengan jejak perubahan
 * lain, sehingga laporan ke Super Owner tidak membutuhkan tabel baru.
 */

export const AKSI_TETAP_JALAN = 'class.below_quota_continued';

/** Panjang alasan minimum supaya catatan itu masih bisa dipahami orang lain kelak. */
const MIN_ALASAN = 10;

export interface KelasMeja {
  id: string;
  startAt: string;
  endAt: string;
  namaKelas: string;
  namaStudio: string | null;
  namaInstruktur: string | null;
  status: string;
  /** Versi kelas, dipakai saat membatalkan agar tidak menimpa perubahan staf lain. */
  version: number;
  kapasitas: number;
  terdaftar: number;
  hadir: number;
  kuota: EvaluasiKuota;
  /** Keputusan tetap jalan yang sudah diambil; null bila belum ada. */
  keputusan: { oleh: string | null; pada: string; alasan: string | null } | null;
  berjalan: boolean;
  /** Kelas sudah lewat jam selesai tetapi belum ditutup, jadi sesi belum terpotong. */
  perluDitutup: boolean;
}

export interface TercatatMeja {
  id: string;
  jenis: 'MEMBER' | 'INSTRUKTUR';
  nama: string;
  /** Selfie saat mendaftar; hanya untuk member. */
  fotoUrl: string | null;
  namaKelas: string;
  mulaiKelas: string;
  selesaiKelas: string;
  namaStudio: string | null;
  tercatatPada: string;
  manual: boolean;
  dicatatOleh: string | null;
}

export interface MejaCheckIn {
  branchId: string;
  namaCabang: string;
  timezone: string;
  tanggal: string;
  kelas: KelasMeja[];
  tercatat: TercatatMeja[];
}

const SELESAI = new Set(['COMPLETED', 'CANCELLED', 'AUTO_CANCELLED']);

@Injectable()
export class CheckInDeskService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    @Optional() private readonly audit?: AuditService,
    @Optional() @Inject(PRIVATE_FILE_STORAGE) private readonly storage?: PrivateFileStorage,
  ) {}

  private wajibCabang(principal: SessionPrincipal, branchId?: string): string {
    if (!branchId) {
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'branchId', issue: 'REQUIRED' },
      ]);
    }
    if (!principal.capabilities.includes('branch:all') && !principal.branchIds.includes(branchId)) {
      throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
    }
    return branchId;
  }

  async meja(
    principal: SessionPrincipal,
    input: { branchId?: string },
    now = new Date(),
  ): Promise<MejaCheckIn> {
    this.policy.requireCapability(principal.capabilities, 'attendance:manage');
    const branchId = this.wajibCabang(principal, input.branchId);

    const cabang = await this.db.cabang.findUnique({
      where: { id: branchId },
      select: { name: true, timezone: true },
    });
    if (!cabang) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

    // "Hari ini" menurut jam dinding cabang, bukan jam server.
    const tanggal = dateInTimeZone(now, cabang.timezone);
    const awal = startOfLocalDateUtc(tanggal, cabang.timezone);
    const akhir = new Date(awal.getTime() + 24 * 3_600_000);

    const slots = await this.db.slotKelas.findMany({
      where: { branchId, startAt: { gte: awal, lt: akhir } },
      select: {
        id: true,
        startAt: true,
        endAt: true,
        capacity: true,
        minQuota: true,
        status: true,
        version: true,
        classType: { select: { name: true } },
        studio: { select: { name: true } },
        instructor: { select: { displayName: true } },
        bookings: {
          where: { status: { in: ['BOOKED', 'ATTENDED', 'NO_SHOW'] } },
          select: { attendance: { select: { id: true } } },
        },
        instructorAttendance: {
          select: {
            id: true,
            checkedInAt: true,
            method: true,
            instructor: { select: { displayName: true } },
            recordedBy: { select: { displayName: true } },
          },
        },
      },
      orderBy: { startAt: 'asc' },
    });

    const keputusan = slots.length
      ? await this.db.auditLog.findMany({
          where: {
            action: AKSI_TETAP_JALAN,
            objectType: 'ClassSlot',
            objectId: { in: slots.map((slot) => slot.id) },
          },
          select: { objectId: true, actorId: true, createdAt: true, reason: true },
          orderBy: { createdAt: 'desc' },
        })
      : [];
    const pengambil = keputusan.length
      ? await this.db.user.findMany({
          where: { id: { in: keputusan.map((k) => k.actorId).filter((id): id is string => !!id) } },
          select: { id: true, displayName: true },
        })
      : [];
    const namaPengambil = new Map(pengambil.map((u) => [u.id, u.displayName]));
    const keputusanPerKelas = new Map<string, (typeof keputusan)[number]>();
    for (const k of keputusan)
      if (k.objectId && !keputusanPerKelas.has(k.objectId)) keputusanPerKelas.set(k.objectId, k);

    const kelas: KelasMeja[] = slots.map((slot) => {
      const hadir = slot.bookings.filter((b) => b.attendance).length;
      const k = keputusanPerKelas.get(slot.id);
      return {
        id: slot.id,
        startAt: slot.startAt.toISOString(),
        endAt: slot.endAt.toISOString(),
        namaKelas: slot.classType?.name ?? 'Kelas',
        namaStudio: slot.studio?.name ?? null,
        namaInstruktur: slot.instructor?.displayName ?? null,
        status: slot.status,
        version: slot.version,
        kapasitas: slot.capacity,
        terdaftar: slot.bookings.length,
        hadir,
        kuota: evaluasiKuota({ minQuota: slot.minQuota, hadir, startAt: slot.startAt, now }),
        keputusan: k
          ? {
              oleh: (k.actorId && namaPengambil.get(k.actorId)) ?? null,
              pada: k.createdAt.toISOString(),
              alasan: k.reason ?? null,
            }
          : null,
        berjalan: slot.startAt <= now && now < slot.endAt && !SELESAI.has(slot.status),
        perluDitutup: slot.endAt <= now && !SELESAI.has(slot.status),
      };
    });

    const member = await this.db.kehadiranPelanggan.findMany({
      where: {
        checkedInAt: { gte: awal, lt: akhir },
        booking: { classSlot: { branchId } },
      },
      select: {
        id: true,
        checkedInAt: true,
        method: true,
        recordedBy: { select: { displayName: true } },
        booking: {
          select: {
            userId: true,
            user: { select: { displayName: true, profile: { select: { selfieUrl: true } } } },
            classSlot: {
              select: {
                startAt: true,
                endAt: true,
                classType: { select: { name: true } },
                studio: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { checkedInAt: 'desc' },
      take: 30,
    });

    const tercatat: TercatatMeja[] = [
      ...member.map((row) => ({
        id: row.id,
        jenis: 'MEMBER' as const,
        nama: row.booking.user.displayName,
        fotoUrl: row.booking.user.profile?.selfieUrl
          ? alamatFotoMeja(row.booking.userId, branchId)
          : null,
        namaKelas: row.booking.classSlot.classType?.name ?? 'Kelas',
        mulaiKelas: row.booking.classSlot.startAt.toISOString(),
        selesaiKelas: row.booking.classSlot.endAt.toISOString(),
        namaStudio: row.booking.classSlot.studio?.name ?? null,
        tercatatPada: row.checkedInAt.toISOString(),
        manual: row.method !== 'QR_SCAN',
        dicatatOleh: row.method !== 'QR_SCAN' ? (row.recordedBy?.displayName ?? null) : null,
      })),
      ...slots
        .filter((slot) => slot.instructorAttendance)
        .map((slot) => {
          const a = slot.instructorAttendance!;
          return {
            id: a.id,
            jenis: 'INSTRUKTUR' as const,
            nama: a.instructor.displayName,
            fotoUrl: null,
            namaKelas: slot.classType?.name ?? 'Kelas',
            mulaiKelas: slot.startAt.toISOString(),
            selesaiKelas: slot.endAt.toISOString(),
            namaStudio: slot.studio?.name ?? null,
            tercatatPada: a.checkedInAt.toISOString(),
            manual: a.method !== 'QR_SCAN',
            dicatatOleh: a.method !== 'QR_SCAN' ? (a.recordedBy?.displayName ?? null) : null,
          };
        }),
    ].sort((a, b) => b.tercatatPada.localeCompare(a.tercatatPada));

    return {
      branchId,
      namaCabang: cabang.name,
      timezone: cabang.timezone,
      tanggal,
      kelas,
      tercatat,
    };
  }

  /**
   * Staf memutuskan kelas tetap berjalan walau peserta yang hadir kurang dari minimum.
   *
   * Hanya bisa dicatat sebelum batas keputusan lewat; setelah itu kelas berjalan dengan sendirinya
   * dan tidak ada yang perlu diputuskan lagi. Selisih beban (honor instruktur per kursi kosong)
   * ikut disimpan supaya laporan ke Super Owner menyebut angka, bukan kesan.
   */
  async tetapJalan(
    principal: SessionPrincipal,
    classSlotId: string,
    input: { reason?: string },
    now = new Date(),
  ) {
    this.policy.requireCapability(principal.capabilities, 'attendance:manage');
    const alasan = (input.reason ?? '').trim();
    if (alasan.length < MIN_ALASAN) {
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'reason', issue: 'TOO_SHORT' },
      ]);
    }

    const slot = await this.db.slotKelas.findUnique({
      where: { id: classSlotId },
      select: {
        id: true,
        branchId: true,
        startAt: true,
        minQuota: true,
        status: true,
        endAt: true,
        classTypeId: true,
        instructorId: true,
        bookings: {
          where: { status: { in: ['BOOKED', 'ATTENDED'] } },
          select: { attendance: { select: { id: true } } },
        },
      },
    });
    if (!slot) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    this.wajibCabang(principal, slot.branchId);

    const hadir = slot.bookings.filter((b) => b.attendance).length;
    const kuota = evaluasiKuota({ minQuota: slot.minQuota, hadir, startAt: slot.startAt, now });
    if (!kuota.perluKeputusan || SELESAI.has(slot.status)) {
      throw new ApiProblem('CONFLICT', HttpStatus.CONFLICT, false, [
        { field: 'classSlotId', issue: 'NO_DECISION_NEEDED' },
      ]);
    }

    // Honor dari Data Master; nominalnya hanya masuk catatan audit untuk laporan Owner.
    const honor = slot.instructorId
      ? calculateSlotFee(
          sortFeesNewestFirst(
            await this.db.instructorFee.findMany({ where: { instructorId: slot.instructorId } }),
          ),
          { ...slot, instructorId: slot.instructorId },
        )
      : null;
    const honorInstrukturRp = honor?.configured ? honor.feeRp : 0;
    const catatan = catatanKeputusan({
      keputusan: 'TETAP_JALAN',
      classSlotId: slot.id,
      decidedById: principal.userId,
      hadir,
      minimum: kuota.minimum ?? 0,
      honorInstrukturRp,
      reason: alasan,
    });

    await this.audit?.catat(null, {
      actorId: principal.userId,
      branchId: slot.branchId,
      action: catatan.action,
      objectType: 'ClassSlot',
      objectId: slot.id,
      reason: alasan,
      afterMasked: {
        hadir: catatan.hadir,
        minimum: catatan.minimum,
        selisihBebanRp: catatan.selisihBebanRp,
        honorDiketahui: Boolean(honor?.configured),
      },
    });

    // Meja check-in tidak menerima nominal honor; selisih beban hanya untuk laporan Owner.
    const { selisihBebanRp: _beban, ...untukMeja } = catatan;
    return { ...untukMeja, tercatatPada: now.toISOString() };
  }

  /**
   * Foto selfie member untuk kartu check-in.
   *
   * Selfie disimpan di penyimpanan privat, jadi tidak pernah diberikan sebagai alamat publik. Staf
   * hanya bisa membuka foto member yang punya kelas di cabangnya hari ini; dengan begitu layar
   * meja depan tidak bisa dipakai untuk menjelajah foto member lain.
   */
  async fotoMember(
    principal: SessionPrincipal,
    input: { userId: string; branchId?: string },
    now = new Date(),
  ): Promise<{ mimeType: string; stream: Readable }> {
    this.policy.requireCapability(principal.capabilities, 'attendance:manage');
    const branchId = this.wajibCabang(principal, input.branchId);
    const tidakAda = () => new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

    const cabang = await this.db.cabang.findUnique({
      where: { id: branchId },
      select: { timezone: true },
    });
    if (!cabang) throw tidakAda();
    const awal = startOfLocalDateUtc(dateInTimeZone(now, cabang.timezone), cabang.timezone);
    const akhir = new Date(awal.getTime() + 24 * 3_600_000);

    const punyaKelas = await this.db.pemesananKelas.findFirst({
      where: {
        userId: input.userId,
        status: { in: ['BOOKED', 'ATTENDED', 'NO_SHOW'] },
        classSlot: { branchId, startAt: { gte: awal, lt: akhir } },
      },
      select: { id: true },
    });
    if (!punyaKelas) throw tidakAda();

    const profil = await this.db.profilPengguna.findUnique({
      where: { userId: input.userId },
      select: { selfieUrl: true },
    });
    const kunci = profil?.selfieUrl;
    if (!kunci || !this.storage) throw tidakAda();

    const stream = await this.storage.read(kunci).catch(() => {
      throw tidakAda();
    });
    const mimeType = kunci.endsWith('.png')
      ? 'image/png'
      : kunci.endsWith('.webp')
        ? 'image/webp'
        : 'image/jpeg';
    return { mimeType, stream };
  }
}

/** Alamat foto selfie lewat API yang memeriksa hak akses, bukan alamat berkas langsung. */
export function alamatFotoMeja(userId: string, branchId: string) {
  return `/api/v1/attendance/desk/members/${encodeURIComponent(userId)}/photo?branchId=${encodeURIComponent(branchId)}`;
}
