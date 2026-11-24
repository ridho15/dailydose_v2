import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type { SessionPrincipal } from '../identity/identity.service';
import { PolicyService } from '../identity/policy.service';
import { PRIVATE_FILE_STORAGE, type PrivateFileStorage } from '../identity/private-file-storage';
import { ApiProblem } from '../identity/security';
import { NotificationWriterService } from '../notifications/notification-writer.service';
import {
  CAP_PUTUS_PEMBATALAN,
  KODE_PEMBATALAN_TERLAMBAT,
  jalankanPembatalanTerlambat,
  kirimNotifikasiPengajuanPembatalan,
  prosesBookingSetelahDitolak,
  sesiTerpotong,
} from './pembatalan-terlambat';
import {
  alamatBuktiPengajuan,
  buktiWajibAda,
  periksaBuktiPengajuan,
  simpanBuktiPengajuan,
  type BerkasUnggahan,
} from './bukti-pengajuan';
import { tutupPembatalanUsang } from './tutup-pembatalan-usang';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const KODE_SETUJU = 'LATE_CANCELLATION_APPROVED';
const KODE_TOLAK = 'LATE_CANCELLATION_REJECTED';

export interface PengajuanPembatalan {
  id: string;
  version: number;
  bookingId: string;
  /** Sesi yang kembali ke paket bila disetujui (0 bila sesinya belum terpotong). */
  sessionCount: number;
  reason: string;
  requestedById: string;
  requestedByName: string | null;
  createdAt: string;
  /** Alamat bukti pendukung (GET /session-adjustments/:id/evidence); null bila tanpa bukti. */
  buktiUrl?: string | null;
}

export interface HalamanPengajuan {
  items: (PengajuanPembatalan & {
    customerName: string | null;
    className: string | null;
    classStartAt: string | null;
    branchId: string | null;
    branchName: string | null;
    canDecide: boolean;
  })[];
  nextCursor: string | null;
}

const alasanTidakValid = () =>
  new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
    { field: 'reason', issue: 'REASON_REQUIRED' },
  ]);

/**
 * Pengajuan dan persetujuan pembatalan booking setelah lewat batas H-24, dari timetable.
 * Lihat `pembatalan-terlambat.ts` untuk aturan pengembalian sesi.
 */
@Injectable()
export class PembatalanTerlambatService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    @Optional() private readonly notificationWriter?: NotificationWriterService,
    @Optional() @Inject(PRIVATE_FILE_STORAGE) private readonly storage?: PrivateFileStorage,
  ) {}

  private bolehDiCabang(principal: SessionPrincipal, capability: string, branchId: string) {
    return (
      this.policy.hasCapability(principal, 'branch:all', branchId) ||
      this.policy.hasCapability(principal, capability, branchId)
    );
  }

  async ajukan(
    principal: SessionPrincipal,
    bookingId: string,
    input: { reason?: unknown; isMedical?: boolean; releaseSeat?: boolean },
    berkas?: BerkasUnggahan,
    now = new Date(),
  ): Promise<PengajuanPembatalan> {
    this.policy.requireCapability(principal.capabilities, 'booking:cancel:assisted');
    if (!UUID.test(bookingId)) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
    if (reason.length < 10 || reason.length > 200) throw alasanTidakValid();
    // Admin wajib melampirkan bukti (tangkapan layar chat member, surat dokter, dan sejenisnya).
    const bukti = periksaBuktiPengajuan(berkas);
    if (!bukti) throw buktiWajibAda();
    const id = randomUUID();
    const hapusBukti = await simpanBuktiPengajuan(this.storage, id, bukti);

    const dibuat = await this.db.$transaction(
      async (tx) => {
        const booking = await tx.pemesananKelas.findUnique({
          where: { id: bookingId },
          include: { attendance: true, classSlot: { select: { branchId: true, startAt: true } } },
        });
        if (
          !booking ||
          !this.bolehDiCabang(principal, 'booking:cancel:assisted', booking.classSlot.branchId)
        )
          throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
        if (!['BOOKED', 'ATTENDED'].includes(booking.status))
          throw new ApiProblem('BOOKING_NOT_ACTIVE', HttpStatus.CONFLICT);
        // Kelas yang sudah dimulai bukan pembatalan lagi; koreksinya lewat Penyesuaian Sesi.
        if (booking.classSlot.startAt <= now)
          throw new ApiProblem('CLASS_ALREADY_STARTED', HttpStatus.CONFLICT);
        const ada = await tx.sessionAdjustRequest.findFirst({
          where: { bookingId, reasonCode: KODE_PEMBATALAN_TERLAMBAT, status: 'PENDING' },
          select: { id: true },
        });
        if (ada) throw new ApiProblem('LATE_CANCELLATION_ALREADY_PENDING', HttpStatus.CONFLICT);

        const isMedical = Boolean(input?.isMedical || input?.releaseSeat);

        // Bila izin medis / pelepasan kursi diminta: langsung batalkan booking & kurangi bookedCount agar kursi terbuka bagi yang lain
        if (isMedical) {
          if (booking.attendance) {
            await tx.kehadiranPelanggan.delete({ where: { id: booking.attendance.id } });
          }
          await tx.pemesananKelas.update({
            where: { id: bookingId },
            data: {
              status: 'CANCELLED',
              cancelledAt: now,
              cancellationReason: `Izin sakit (surat dokter): ${reason}`.slice(0, 1000),
              cancelledById: principal.userId,
            },
          });
          await tx.slotKelas.update({
            where: { id: booking.classSlotId },
            data: { bookedCount: { decrement: 1 } },
          });
        }

        return tx.sessionAdjustRequest.create({
          data: {
            id,
            customerPackageId: booking.customerPackageId,
            bookingId,
            requestedById: principal.userId,
            sessionCount: await sesiTerpotong(tx, booking),
            reason: (isMedical ? `[IZIN MEDIS] ${reason}` : reason).slice(0, 500),
            reasonCode: KODE_PEMBATALAN_TERLAMBAT,
          },
          include: { requestedBy: { select: { displayName: true } } },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ).catch(async (error: unknown) => {
      await hapusBukti();
      throw error;
    });

    await kirimNotifikasiPengajuanPembatalan(this.notificationWriter, this.db, {
      pengajuanId: dibuat.id,
      bookingId,
    });

    return this.tampilan(dibuat);
  }

  /**
   * Pengajuan yang menunggu keputusan. Dengan `classSlotId`: untuk satu kelas (daftar peserta di
   * timetable). Tanpa `classSlotId`: semua cabang yang boleh diputus pengguna, untuk kotak masuk
   * penyetuju, dengan paginasi kursor.
   */
  async tertunda(principal: SessionPrincipal, classSlotId: string): Promise<PengajuanPembatalan[]>;
  async tertunda(
    principal: SessionPrincipal,
    classSlotId: '',
    halaman: { branchId?: string; cursor?: string; limit?: string | number },
  ): Promise<HalamanPengajuan>;
  async tertunda(
    principal: SessionPrincipal,
    classSlotId: string,
    halaman?: { branchId?: string; cursor?: string; limit?: string | number },
  ): Promise<PengajuanPembatalan[] | HalamanPengajuan> {
    // Pengajuan yang booking/kelasnya sudah dibatalkan ditutup dulu supaya tidak tertahan di antrean.
    await tutupPembatalanUsang(this.db);
    if (!classSlotId) return this.tertundaSemua(principal, halaman ?? {});
    this.policy.requireAnyCapability(principal.capabilities, [
      'booking:read',
      'booking:cancel:assisted',
    ]);
    if (!UUID.test(classSlotId)) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const slot = await this.db.slotKelas.findUnique({
      where: { id: classSlotId },
      select: { branchId: true },
    });
    if (
      !slot ||
      !(
        this.bolehDiCabang(principal, 'booking:read', slot.branchId) ||
        this.bolehDiCabang(principal, 'booking:cancel:assisted', slot.branchId)
      )
    )
      throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const rows = await this.db.sessionAdjustRequest.findMany({
      where: {
        reasonCode: KODE_PEMBATALAN_TERLAMBAT,
        status: 'PENDING',
        booking: { classSlotId },
      },
      include: { requestedBy: { select: { displayName: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const bukti = await Promise.all(rows.map((row) => alamatBuktiPengajuan(this.storage, row.id)));
    return rows.map((row, i) => ({ ...this.tampilan(row), buktiUrl: bukti[i] ?? null }));
  }

  private async tertundaSemua(
    principal: SessionPrincipal,
    input: { branchId?: string; cursor?: string; limit?: string | number },
  ): Promise<HalamanPengajuan> {
    this.policy.requireAnyCapability(principal.capabilities, [
      CAP_PUTUS_PEMBATALAN,
      'ledger:adjust:decide',
    ]);
    const limit = Math.min(50, Math.max(1, Number(input.limit) || 20));
    // Cabang yang boleh diputus: gabungan kedua kapabilitas penyetuju.
    const cakupan = [CAP_PUTUS_PEMBATALAN, 'ledger:adjust:decide']
      .filter((cap) => principal.capabilities.includes(cap))
      .map((cap) => this.policy.capabilityBranchScope(principal, cap));
    const semua = cakupan.some((c) => c.all);
    const izin = [...new Set(cakupan.flatMap((c) => c.included))];
    let cabang: Prisma.StringFilter | string | undefined = semua ? undefined : { in: izin };
    if (input.branchId) {
      if (!semua && !izin.includes(input.branchId))
        throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
      cabang = input.branchId;
    }
    let kursor: { createdAt: Date; id: string } | null = null;
    if (input.cursor) {
      const [iso, id] = Buffer.from(input.cursor, 'base64url').toString('utf8').split('|');
      const createdAt = new Date(iso ?? '');
      if (!id || Number.isNaN(createdAt.getTime()))
        throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
          { field: 'cursor', issue: 'INVALID' },
        ]);
      kursor = { createdAt, id };
    }
    const rows = await this.db.sessionAdjustRequest.findMany({
      where: {
        reasonCode: KODE_PEMBATALAN_TERLAMBAT,
        status: 'PENDING',
        ...(cabang ? { booking: { is: { classSlot: { branchId: cabang } } } } : {}),
        ...(kursor
          ? {
              OR: [
                { createdAt: { gt: kursor.createdAt } },
                { createdAt: kursor.createdAt, id: { gt: kursor.id } },
              ],
            }
          : {}),
      },
      include: {
        requestedBy: { select: { displayName: true } },
        booking: {
          select: {
            user: { select: { displayName: true } },
            classSlot: {
              select: {
                branchId: true,
                startAt: true,
                branch: { select: { name: true } },
                classType: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    const lebih = rows.length > limit;
    const dipakai = lebih ? rows.slice(0, limit) : rows;
    const akhir = dipakai.at(-1);
    const superOwner = principal.roles.some((r) => r.role === 'SUPER_OWNER');
    const bukti = await Promise.all(dipakai.map((row) => alamatBuktiPengajuan(this.storage, row.id)));
    return {
      items: dipakai.map((row, i) => ({
        ...this.tampilan(row),
        buktiUrl: bukti[i] ?? null,
        customerName: row.booking?.user?.displayName ?? null,
        className: row.booking?.classSlot.classType?.name ?? null,
        classStartAt: row.booking?.classSlot.startAt.toISOString() ?? null,
        branchId: row.booking?.classSlot.branchId ?? null,
        branchName: row.booking?.classSlot.branch?.name ?? null,
        // Pengaju tidak memutus pengajuannya sendiri, kecuali Super Owner (lihat putuskan()).
        canDecide: superOwner || row.requestedById !== principal.userId,
      })),
      nextCursor:
        lebih && akhir
          ? Buffer.from(`${akhir.createdAt.toISOString()}|${akhir.id}`, 'utf8').toString('base64url')
          : null,
    };
  }

  async putuskan(
    principal: SessionPrincipal,
    id: string,
    keputusan: string,
    input: { expectedVersion?: unknown; note?: unknown },
    now = new Date(),
  ) {
    this.policy.requireAnyCapability(principal.capabilities, [
      CAP_PUTUS_PEMBATALAN,
      'ledger:adjust:decide',
    ]);
    if (keputusan !== 'approve' && keputusan !== 'reject')
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST);
    if (!UUID.test(id)) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (!Number.isInteger(input?.expectedVersion))
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'expectedVersion', issue: 'REQUIRED' },
      ]);
    const note =
      typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 500) : null;

    return this.db.$transaction(
      async (tx) => {
        const row = await tx.sessionAdjustRequest.findUnique({
          where: { id },
          include: { booking: { include: { classSlot: { select: { branchId: true } }, user: { select: { id: true, displayName: true } } } } },
        });
        if (!row || row.reasonCode !== KODE_PEMBATALAN_TERLAMBAT || !row.booking)
          throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
        const cabang = row.booking.classSlot.branchId;
        if (
          !this.bolehDiCabang(principal, CAP_PUTUS_PEMBATALAN, cabang) &&
          !this.bolehDiCabang(principal, 'ledger:adjust:decide', cabang)
        )
          throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
        // Yang mengajukan tidak memutus pengajuannya sendiri, kecuali Super Owner.
        const superOwner = principal.roles.some((r) => r.role === 'SUPER_OWNER');
        if (!superOwner && row.requestedById === principal.userId)
          throw new ApiProblem('SEPARATION_OF_DUTIES', HttpStatus.FORBIDDEN);
        if (row.status !== 'PENDING')
          throw new ApiProblem('ADJUSTMENT_ALREADY_DECIDED', HttpStatus.CONFLICT);

        const klaim = await tx.sessionAdjustRequest.updateMany({
          where: { id, status: 'PENDING', version: input.expectedVersion as number },
          data: {
            status: keputusan === 'approve' ? 'APPROVED' : 'REJECTED',
            approvedById: principal.userId,
            decisionCode: keputusan === 'approve' ? KODE_SETUJU : KODE_TOLAK,
            decisionNote: note,
            decisionReason: note ?? (keputusan === 'approve' ? KODE_SETUJU : KODE_TOLAK),
            decidedAt: now,
            version: { increment: 1 },
          },
        });
        if (klaim.count !== 1)
          throw new ApiProblem('ADJUSTMENT_VERSION_CONFLICT', HttpStatus.CONFLICT);

        const hasil =
          keputusan === 'approve'
            ? await jalankanPembatalanTerlambat(tx, row, principal.userId, now)
            : { resultingBalance: null, sessionsReturned: 0 };
        const statusBooking =
          keputusan === 'reject' ? await prosesBookingSetelahDitolak(tx, row.bookingId, principal.userId, now) : null;

        if (this.notificationWriter && row.booking?.userId) {
          const approved = keputusan === 'approve';
          await this.notificationWriter
            .writeForUser(tx, {
              userId: row.booking.userId,
              branchId: cabang,
              eventKey: `late_cancel.decided:${id}:${keputusan}`,
              category: 'BOOKING',
              tone: approved ? 'SUCCESS' : 'DANGER',
              title: approved ? 'Pembatalan Terlambat Disetujui' : 'Pembatalan Terlambat Ditolak',
              message: approved
                ? 'Permohonan pembatalan terlambat Anda telah disetujui. Sesi kelas Anda telah dikembalikan.'
                : `Permohonan pembatalan terlambat Anda ditolak${note ? ` (${note})` : '.'}`,
              href: '/bookings',
            })
            .catch(() => {});
        }

        return {
          id,
          status: keputusan === 'approve' ? 'APPROVED' : 'REJECTED',
          bookingId: row.bookingId,
          sessionsReturned: hasil.sessionsReturned,
          resultingBalance: hasil.resultingBalance,
          /** Diisi bila kelas sudah berakhir saat ditolak: booking langsung Hadir atau Tidak hadir. */
          bookingStatus: statusBooking,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private tampilan(row: {
    id: string;
    version: number;
    bookingId: string | null;
    sessionCount: number;
    reason: string;
    requestedById: string;
    createdAt: Date;
    requestedBy?: { displayName: string } | null;
  }): PengajuanPembatalan {
    return {
      id: row.id,
      version: row.version,
      bookingId: row.bookingId ?? '',
      sessionCount: row.sessionCount,
      reason: row.reason,
      requestedById: row.requestedById,
      requestedByName: row.requestedBy?.displayName ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
