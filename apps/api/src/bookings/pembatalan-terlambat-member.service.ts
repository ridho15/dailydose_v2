import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RuntimeConfigService } from '../configuration/runtime-config.service';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../foundation/audit.service';
import type { SessionPrincipal } from '../identity/identity.service';
import { PolicyService } from '../identity/policy.service';
import { ApiProblem, ENTITY_ID_REGEX } from '../identity/security';
import { NotificationWriterService } from '../notifications/notification-writer.service';
import {
  KODE_PEMBATALAN_TERLAMBAT,
  kirimNotifikasiPengajuanPembatalan,
  sesiTerpotong,
} from './pembatalan-terlambat';
import { isCancellationEntitled } from './pemesanan-kelas.service';

/**
 * Pengajuan pembatalan terlambat oleh member sendiri (keputusan pemilik 22 November 2026).
 *
 * Kurang dari batas H-12 member tidak bisa membatalkan langsung. Ia mengajukan dari kartu booking,
 * lalu Manager, Owner, atau Super Owner memutuskan di kotak masuk staf. Record yang dibuat sama
 * persis dengan pengajuan staf (`session_adjust_request`, kode LATE_CANCELLATION), jadi pemutusan
 * memakai `PembatalanTerlambatService.putuskan` yang sudah ada. Booking tetap BOOKED sampai diputus.
 */

export const ALASAN_MEMBER = {
  SAKIT: 'Sakit atau kurang sehat',
  PEKERJAAN: 'Ada pekerjaan mendadak',
  KELUARGA: 'Keperluan keluarga',
} as const;
export type KodeAlasanMember = keyof typeof ALASAN_MEMBER | 'LAINNYA';

export interface StatusPengajuanMember {
  /** Member boleh mengajukan sekarang (booking aktif, kelas belum mulai, sudah lewat batas H-12). */
  bisaMengajukan: boolean;
  pengajuan: { id: string; status: 'PENDING' | 'APPROVED' | 'REJECTED'; diajukanPada: string } | null;
}

const UUID = ENTITY_ID_REGEX;

export function teksAlasanMember(kode: unknown, lainnya: unknown): string {
  if (typeof kode === 'string' && kode in ALASAN_MEMBER)
    return ALASAN_MEMBER[kode as keyof typeof ALASAN_MEMBER];
  const teks = typeof lainnya === 'string' ? lainnya.trim() : '';
  if (kode === 'LAINNYA' && teks.length >= 3 && teks.length <= 200) return `Lainnya: ${teks}`;
  throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
    { field: kode === 'LAINNYA' ? 'lainnya' : 'kodeAlasan', issue: 'REASON_REQUIRED' },
  ]);
}

@Injectable()
export class PembatalanTerlambatMemberService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly config: RuntimeConfigService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly notificationWriter?: NotificationWriterService,
  ) {}

  private batasJam() {
    const { enabled, cutoffHours } = this.config.value.bookingCancellation;
    if (!enabled || cutoffHours === null)
      throw new ApiProblem('CONFIGURATION_REQUIRED', HttpStatus.SERVICE_UNAVAILABLE);
    return cutoffHours;
  }

  async status(principal: SessionPrincipal, bookingId: string, now = new Date()): Promise<StatusPengajuanMember> {
    this.policy.requireCapability(principal.capabilities, 'booking:self:cancel');
    if (!UUID.test(bookingId)) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const booking = await this.db.pemesananKelas.findFirst({
      where: { id: bookingId, userId: principal.userId },
      include: { classSlot: { select: { startAt: true } } },
    });
    if (!booking) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const terakhir = await this.db.sessionAdjustRequest.findFirst({
      where: { bookingId, reasonCode: KODE_PEMBATALAN_TERLAMBAT },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, createdAt: true },
    });
    const menunggu = terakhir?.status === 'PENDING';
    return {
      bisaMengajukan:
        !menunggu &&
        booking.status === 'BOOKED' &&
        booking.classSlot.startAt > now &&
        !isCancellationEntitled(booking.classSlot.startAt, now, this.batasJam()),
      pengajuan: terakhir
        ? {
            id: terakhir.id,
            status: terakhir.status as 'PENDING' | 'APPROVED' | 'REJECTED',
            diajukanPada: terakhir.createdAt.toISOString(),
          }
        : null,
    };
  }

  async ajukan(
    principal: SessionPrincipal,
    bookingId: string,
    input: { kodeAlasan?: unknown; lainnya?: unknown },
    now = new Date(),
  ) {
    this.policy.requireCapability(principal.capabilities, 'booking:self:cancel');
    if (!UUID.test(bookingId)) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const reason = teksAlasanMember(input?.kodeAlasan, input?.lainnya);
    const batas = this.batasJam();

    const dibuat = await this.db.$transaction(
      async (tx) => {
        // Kepemilikan diperiksa di query: booking orang lain sama dengan tidak ada.
        const booking = await tx.pemesananKelas.findFirst({
          where: { id: bookingId, userId: principal.userId },
          include: {
            classSlot: { select: { branchId: true, startAt: true } },
          },
        });
        if (!booking) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
        if (booking.status !== 'BOOKED')
          throw new ApiProblem('BOOKING_NOT_ACTIVE', HttpStatus.CONFLICT);
        if (booking.classSlot.startAt <= now)
          throw new ApiProblem('CLASS_ALREADY_STARTED', HttpStatus.CONFLICT);
        // Sebelum batas H-12 member membatalkan sendiri tanpa persetujuan; pengajuan tidak perlu.
        if (isCancellationEntitled(booking.classSlot.startAt, now, batas))
          throw new ApiProblem('SELF_CANCELLATION_AVAILABLE', HttpStatus.CONFLICT);
        const ada = await tx.sessionAdjustRequest.findFirst({
          where: { bookingId, reasonCode: KODE_PEMBATALAN_TERLAMBAT, status: 'PENDING' },
          select: { id: true },
        });
        if (ada) throw new ApiProblem('LATE_CANCELLATION_ALREADY_PENDING', HttpStatus.CONFLICT);

        const pengajuan = await tx.sessionAdjustRequest.create({
          data: {
            customerPackageId: booking.customerPackageId,
            bookingId,
            requestedById: principal.userId,
            sessionCount: await sesiTerpotong(tx, booking),
            reason: reason.slice(0, 500),
            reasonCode: KODE_PEMBATALAN_TERLAMBAT,
          },
        });
        await this.audit?.catat(tx, {
          actorId: principal.userId,
          branchId: booking.classSlot.branchId,
          correlationId: pengajuan.id,
          action: 'booking.late_cancellation_requested_by_member',
          objectType: 'SessionAdjustRequest',
          objectId: pengajuan.id,
          targetUserId: principal.userId,
          reason,
          afterMasked: { bookingId, status: 'PENDING' },
        });
        return { pengajuan, booking };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    // Penerima sama dengan kotak masuk pembatalan staf: Manager, Owner cabang, dan Super Owner.
    await kirimNotifikasiPengajuanPembatalan(this.notificationWriter, this.db, {
      pengajuanId: dibuat.pengajuan.id,
      bookingId,
    });

    return {
      id: dibuat.pengajuan.id,
      status: 'PENDING' as const,
      bookingId,
      reason,
      diajukanPada: dibuat.pengajuan.createdAt.toISOString(),
    };
  }
}
