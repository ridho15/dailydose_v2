import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type { SessionPrincipal } from '../identity/identity.service';
import { PolicyService } from '../identity/policy.service';
import { ApiProblem } from '../identity/security';
import {
  CAP_PUTUS_PEMBATALAN,
  KODE_PEMBATALAN_TERLAMBAT,
  jalankanPembatalanTerlambat,
  sesiTerpotong,
} from './pembatalan-terlambat';

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
    input: { reason?: unknown },
    now = new Date(),
  ): Promise<PengajuanPembatalan> {
    this.policy.requireCapability(principal.capabilities, 'booking:cancel:assisted');
    if (!UUID.test(bookingId)) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
    if (reason.length < 10 || reason.length > 200) throw alasanTidakValid();

    const dibuat = await this.db.$transaction(
      async (tx) => {
        const booking = await tx.pemesananKelas.findUnique({
          where: { id: bookingId },
          include: { classSlot: { select: { branchId: true, startAt: true } } },
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

        return tx.sessionAdjustRequest.create({
          data: {
            customerPackageId: booking.customerPackageId,
            bookingId,
            requestedById: principal.userId,
            sessionCount: await sesiTerpotong(tx, booking),
            reason,
            reasonCode: KODE_PEMBATALAN_TERLAMBAT,
          },
          include: { requestedBy: { select: { displayName: true } } },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.tampilan(dibuat);
  }

  /** Pengajuan yang menunggu keputusan untuk satu kelas; dipakai daftar peserta di timetable. */
  async tertunda(principal: SessionPrincipal, classSlotId: string): Promise<PengajuanPembatalan[]> {
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
    return rows.map((row) => this.tampilan(row));
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
          include: { booking: { include: { classSlot: { select: { branchId: true } } } } },
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
        return {
          id,
          status: keputusan === 'approve' ? 'APPROVED' : 'REJECTED',
          bookingId: row.bookingId,
          sessionsReturned: hasil.sessionsReturned,
          resultingBalance: hasil.resultingBalance,
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
