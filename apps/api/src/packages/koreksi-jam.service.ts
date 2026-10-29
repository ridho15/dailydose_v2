import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { PrismaService } from '../database/prisma.service';
import type { SessionPrincipal } from '../identity/identity.service';
import { PolicyService } from '../identity/policy.service';
import { PRIVATE_FILE_STORAGE, type PrivateFileStorage } from '../identity/private-file-storage';
import { ApiProblem } from '../identity/security';
import { calculateSlotFee, sortFeesNewestFirst } from './instructor-fee-calculator';
import { kenaliBukti, MIN_ALASAN_PENYESUAIAN } from './penyesuaian-bukti.service';

/**
 * Koreksi jam mengajar instruktur, dengan alasan dan bukti.
 *
 * Honor instruktur dihitung dari kelas yang selesai dikali tarif per jam. Kadang hitungan itu
 * keliru: QR instruktur tidak terpindai, kelas salah ditandai batal, atau instruktur pengganti
 * yang mengajar. Koreksi menambah atau mengurangi jam pada satu kelas tertentu, dinilai dengan
 * tarif kelas itu sendiri, dan ikut dalam laporan honor bulan kelas tersebut.
 *
 * Disimpan di `audit_log` (aksi `instructor.hours_adjusted`, objek `InstructorHourAdjustment`
 * dengan id koreksi), tanpa tabel baru: catatan audit memang tidak bisa diubah, sehingga koreksi
 * yang keliru diperbaiki dengan koreksi lawan, bukan dengan menimpa catatan lama.
 */

export const AKSI_KOREKSI_JAM = 'instructor.hours_adjusted';
const OBJEK = 'InstructorHourAdjustment';
const MAKS_ALASAN = 500;
const MAKS_BUKTI_BYTE = 8_000_000;
/** Koreksi dalam kelipatan setengah jam, paling banyak delapan jam sekali catat. */
const LANGKAH_JAM = 0.5;
const MAKS_JAM = 8;

const kunciBukti = (id: string, ext: string) => `instructor-hours-evidence/${id}.${ext}`;
const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

export interface KoreksiJam {
  id: string;
  branchId: string;
  instructorId: string;
  instructorName: string | null;
  classSlotId: string;
  className: string | null;
  /** Mulai kelas; koreksi masuk ke laporan honor bulan kelas ini. */
  classStartAt: string;
  hours: number;
  /** Null bila peran tidak berhak melihat nominal honor (mis. Manager). */
  feePerJamRp: number | null;
  amountRp: number | null;
  reason: string;
  decidedByName: string | null;
  createdAt: string;
  evidenceUrl: string;
}

interface DetailKoreksi {
  instructorId: string;
  classSlotId: string;
  classStartAt: string;
  hours: number;
  feePerJamRp: number;
  amountRp: number;
  evidenceExt: string;
}

export function detailKoreksi(detail: unknown): DetailKoreksi | null {
  const after = (detail as { after?: Partial<DetailKoreksi> } | null)?.after;
  if (!after || typeof after.amountRp !== 'number' || typeof after.classStartAt !== 'string')
    return null;
  return after as DetailKoreksi;
}

/** Nominal honor hanya untuk peran dengan akses honor; Manager mencatat jam tanpa melihat rupiah. */
const bolehLihatHonor = (principal: SessionPrincipal) =>
  principal.capabilities.includes('instructor:fee:read') ||
  principal.capabilities.includes('finance:read');

type BarisAudit = {
  objectId: string | null;
  branchId: string | null;
  actorId: string | null;
  reason: string | null;
  detail: unknown;
  createdAt: Date;
};

/**
 * Jumlah koreksi honor per cabang untuk kelas yang mulai di dalam rentang. Dipakai laporan honor
 * dan laporan laba supaya keduanya selalu memuat koreksi yang sama.
 */
export async function koreksiHonorDalamRentang(
  db: PrismaService,
  params: {
    branchFilter: { branchId?: string | { in: string[] } };
    fromDate: Date;
    untilExclusive: Date;
  },
): Promise<{ totalRp: number; perCabang: Map<string, number>; jumlah: number }> {
  if (typeof db.auditLog?.findMany !== 'function') {
    return { totalRp: 0, perCabang: new Map(), jumlah: 0 };
  }
  // Koreksi dibuat setelah kelasnya berlangsung, jadi tidak mungkin lebih awal dari rentang.
  const baris: BarisAudit[] = await db.auditLog.findMany({
    where: {
      action: AKSI_KOREKSI_JAM,
      ...params.branchFilter,
      createdAt: { gte: params.fromDate },
    },
    select: {
      objectId: true,
      branchId: true,
      actorId: true,
      reason: true,
      detail: true,
      createdAt: true,
    },
  });
  const perCabang = new Map<string, number>();
  let totalRp = 0;
  let jumlah = 0;
  for (const b of baris) {
    const d = detailKoreksi(b.detail);
    if (!d || !b.branchId) continue;
    const mulai = new Date(d.classStartAt);
    if (mulai < params.fromDate || mulai >= params.untilExclusive) continue;
    totalRp += d.amountRp;
    jumlah += 1;
    perCabang.set(b.branchId, (perCabang.get(b.branchId) ?? 0) + d.amountRp);
  }
  return { totalRp, perCabang, jumlah };
}

@Injectable()
export class KoreksiJamService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    @Optional() @Inject(PRIVATE_FILE_STORAGE) private readonly storage?: PrivateFileStorage,
  ) {}

  private aksesCabang(principal: SessionPrincipal, branchId: string) {
    if (principal.capabilities.includes('branch:all')) return;
    if (!principal.branchIds.includes(branchId)) {
      throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
    }
  }

  async koreksi(
    principal: SessionPrincipal,
    body: { classSlotId?: string; instructorId?: string; hours?: number | string; reason?: string },
    bukti: { buffer?: Buffer } | undefined,
  ): Promise<KoreksiJam> {
    this.policy.requireCapability(principal.capabilities, 'instructor:hours:adjust');

    const hours = typeof body.hours === 'string' ? Number(body.hours) : body.hours;
    if (
      typeof hours !== 'number' ||
      !Number.isFinite(hours) ||
      hours === 0 ||
      Math.abs(hours) > MAKS_JAM ||
      Math.round(hours / LANGKAH_JAM) * LANGKAH_JAM !== hours
    ) {
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'hours', issue: 'INVALID' },
      ]);
    }
    const alasan = (body.reason ?? '').trim();
    if (alasan.length < MIN_ALASAN_PENYESUAIAN || alasan.length > MAKS_ALASAN) {
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        {
          field: 'reason',
          issue: alasan.length < MIN_ALASAN_PENYESUAIAN ? 'TOO_SHORT' : 'TOO_LONG',
        },
      ]);
    }
    if (!bukti?.buffer || bukti.buffer.length === 0) {
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'evidence', issue: 'REQUIRED' },
      ]);
    }
    if (bukti.buffer.length > MAKS_BUKTI_BYTE) {
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'evidence', issue: 'TOO_LARGE' },
      ]);
    }
    const jenis = kenaliBukti(bukti.buffer);
    if (!jenis) {
      throw new ApiProblem('UPLOAD_REJECTED', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'evidence', issue: 'UNSUPPORTED_TYPE' },
      ]);
    }
    if (!body.classSlotId) {
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'classSlotId', issue: 'REQUIRED' },
      ]);
    }

    const slot = await this.db.slotKelas.findUnique({
      where: { id: body.classSlotId },
      select: {
        id: true,
        branchId: true,
        classTypeId: true,
        instructorId: true,
        startAt: true,
        endAt: true,
        instructorFeeRp: true,
        isManualFee: true,
        classType: { select: { name: true } },
      },
    });
    if (!slot) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    this.aksesCabang(principal, slot.branchId);

    // Instruktur pengganti boleh dipilih; tanpa pilihan, instruktur yang tercatat di kelas.
    const instructorId = body.instructorId || slot.instructorId;
    if (!instructorId) {
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'instructorId', issue: 'REQUIRED' },
      ]);
    }
    const instruktur = await this.db.user.findUnique({
      where: { id: instructorId },
      select: { id: true, displayName: true },
    });
    if (!instruktur) {
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'instructorId', issue: 'NOT_FOUND' },
      ]);
    }

    const fees = await this.db.instructorFee.findMany({ where: { instructorId } });
    const tarif = calculateSlotFee(sortFeesNewestFirst(fees), {
      ...slot,
      instructorId,
      // Honor manual milik instruktur asal; instruktur pengganti dinilai dengan tarifnya sendiri.
      isManualFee: instructorId === slot.instructorId ? slot.isManualFee : false,
    });
    const amountRp = Math.round(hours * tarif.feePerJamRp);

    if (!this.storage) throw new ApiProblem('STORAGE_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE);
    const id = randomUUID();
    const kunci = kunciBukti(id, jenis.ext);
    await this.storage.put({ key: kunci, content: bukti.buffer });

    const detail: DetailKoreksi = {
      instructorId,
      classSlotId: slot.id,
      classStartAt: slot.startAt.toISOString(),
      hours,
      feePerJamRp: tarif.feePerJamRp,
      amountRp,
      evidenceExt: jenis.ext,
    };
    try {
      // Ditulis langsung, bukan lewat AuditService.catat yang menelan galat: koreksi honor yang
      // gagal tercatat harus gagal terlihat, bukan dilaporkan berhasil.
      await this.db.auditLog.create({
        data: {
          actorId: principal.userId,
          branchId: slot.branchId,
          targetUserId: instructorId,
          action: AKSI_KOREKSI_JAM,
          objectType: OBJEK,
          objectId: id,
          reason: alasan,
          detail: { after: { ...detail } },
        },
      });
    } catch (error) {
      // Tanpa catatan audit, koreksinya tidak ada; buktinya tidak boleh tertinggal sendirian.
      await this.storage.delete(kunci).catch(() => undefined);
      throw error;
    }

    return {
      id,
      branchId: slot.branchId,
      instructorId,
      instructorName: instruktur.displayName,
      classSlotId: slot.id,
      className: slot.classType?.name ?? null,
      classStartAt: detail.classStartAt,
      hours,
      feePerJamRp: bolehLihatHonor(principal) ? tarif.feePerJamRp : null,
      amountRp: bolehLihatHonor(principal) ? amountRp : null,
      reason: alasan,
      decidedByName: null,
      createdAt: new Date().toISOString(),
      evidenceUrl: `/api/v1/instructor-hour-adjustments/${id}/evidence`,
    };
  }

  /** Koreksi terbaru di cabang yang boleh dilihat, paling baru lebih dulu. */
  async daftar(
    principal: SessionPrincipal,
    input: { branchId?: string; limit?: number } = {},
  ): Promise<{ items: KoreksiJam[] }> {
    this.policy.requireAnyCapability(principal.capabilities, [
      'instructor:hours:adjust',
      'finance:read',
    ]);
    if (input.branchId) this.aksesCabang(principal, input.branchId);
    const cabang = input.branchId
      ? { branchId: input.branchId }
      : principal.capabilities.includes('branch:all')
        ? {}
        : { branchId: { in: principal.branchIds } };

    const baris: BarisAudit[] = await this.db.auditLog.findMany({
      where: { action: AKSI_KOREKSI_JAM, ...cabang },
      select: {
        objectId: true,
        branchId: true,
        actorId: true,
        reason: true,
        detail: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(input.limit ?? 20, 1), 100),
    });
    const valid = baris
      .map((b) => ({ b, d: detailKoreksi(b.detail) }))
      .filter((x): x is { b: BarisAudit; d: DetailKoreksi } => Boolean(x.d && x.b.objectId));

    const userIds = [
      ...new Set(valid.flatMap(({ b, d }) => [d.instructorId, b.actorId]).filter(Boolean)),
    ] as string[];
    const slotIds = [...new Set(valid.map(({ d }) => d.classSlotId))];
    const [users, slots] = await Promise.all([
      userIds.length
        ? this.db.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, displayName: true },
          })
        : [],
      slotIds.length
        ? this.db.slotKelas.findMany({
            where: { id: { in: slotIds } },
            select: { id: true, classType: { select: { name: true } } },
          })
        : [],
    ]);
    const nama = new Map(
      (users as { id: string; displayName: string }[]).map((u) => [u.id, u.displayName]),
    );
    const kelas = new Map(
      (slots as { id: string; classType: { name: string } | null }[]).map((s) => [
        s.id,
        s.classType?.name ?? null,
      ]),
    );

    return {
      items: valid.map(({ b, d }) => ({
        id: b.objectId!,
        branchId: b.branchId ?? '',
        instructorId: d.instructorId,
        instructorName: nama.get(d.instructorId) ?? null,
        classSlotId: d.classSlotId,
        className: kelas.get(d.classSlotId) ?? null,
        classStartAt: d.classStartAt,
        hours: d.hours,
        feePerJamRp: bolehLihatHonor(principal) ? d.feePerJamRp : null,
        amountRp: bolehLihatHonor(principal) ? d.amountRp : null,
        reason: b.reason ?? '',
        decidedByName: b.actorId ? (nama.get(b.actorId) ?? null) : null,
        createdAt: b.createdAt.toISOString(),
        evidenceUrl: `/api/v1/instructor-hour-adjustments/${b.objectId}/evidence`,
      })),
    };
  }

  async bukti(
    principal: SessionPrincipal,
    id: string,
  ): Promise<{ mimeType: string; stream: Readable }> {
    this.policy.requireAnyCapability(principal.capabilities, [
      'instructor:hours:adjust',
      'finance:read',
    ]);
    const tidakAda = () => new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const baris = await this.db.auditLog.findFirst({
      where: { action: AKSI_KOREKSI_JAM, objectType: OBJEK, objectId: id },
      select: { branchId: true, detail: true },
    });
    const d = baris ? detailKoreksi(baris.detail) : null;
    if (!baris || !d || !baris.branchId || !this.storage) throw tidakAda();
    this.aksesCabang(principal, baris.branchId);
    const kunci = kunciBukti(id, d.evidenceExt);
    if (!(await this.storage.exists(kunci).catch(() => false))) throw tidakAda();
    return {
      mimeType: MIME[d.evidenceExt] ?? 'application/octet-stream',
      stream: await this.storage.read(kunci),
    };
  }
}
