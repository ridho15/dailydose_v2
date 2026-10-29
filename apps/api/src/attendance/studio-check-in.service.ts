import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../foundation/audit.service';
import type { SessionPrincipal } from '../identity/identity.service';
import { PolicyService } from '../identity/policy.service';
import { ApiProblem } from '../identity/security';
import { StudioScanService, type ScanResult } from './studio-scan.service';

/**
 * Mencatat kehadiran dari pindaian di meja check-in.
 *
 * Staf yang sudah masuk memindai QR tetap milik member atau instruktur (kamera atau barcode
 * scanner). Lokasi terbukti dari cabang yang boleh ditangani staf itu, bukan dari PIN perangkat.
 *
 * `StudioScanService` memutuskan apakah pass itu milik orang yang punya kelas sekarang; layanan ini
 * yang menulis. Penulisan diulang-periksa di dalam transaksi karena dua pindaian beruntun bisa
 * datang hampir bersamaan dari antrean di pintu, dan baris kehadiran yang unik per booking (atau
 * per kelas untuk instruktur) menjadi pengaman terakhir: pindaian kedua dijawab "sudah tercatat",
 * bukan galat.
 *
 * Pindaian yang ditolak ikut dicatat di audit, supaya "datang tanpa kelas yang cocok" bisa
 * dilaporkan, bukan hilang begitu saja.
 */

/** Kelas yang masih boleh menerima kehadiran; kuota minimum dinilai saat check-in, bukan sebelumnya. */
const STATUS_TERBUKA = new Set(['PUBLISHED', 'CONFIRMED']);

export interface HasilPindaiStudio extends ScanResult {
  tercatat: boolean;
  tercatatPada?: string;
  namaCabang: string;
  timezone: string;
}

@Injectable()
export class StudioCheckInService {
  constructor(
    private readonly db: PrismaService,
    private readonly scan: StudioScanService,
    private readonly policy: PolicyService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  async pindai(
    principal: SessionPrincipal,
    branchId: string | undefined,
    pass: unknown,
    now = new Date(),
  ): Promise<HasilPindaiStudio> {
    this.policy.requireCapability(principal.capabilities, 'attendance:manage');
    if (!branchId) {
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'branchId', issue: 'REQUIRED' },
      ]);
    }
    if (!principal.capabilities.includes('branch:all') && !principal.branchIds.includes(branchId)) {
      throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
    }
    const cabang = await this.db.cabang.findUnique({
      where: { id: branchId },
      select: { id: true, name: true, timezone: true },
    });
    if (!cabang) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const dasar = { namaCabang: cabang.name, timezone: cabang.timezone };

    const hasil = await this.scan.resolve(typeof pass === 'string' ? pass : '', cabang.id, now);
    if (!hasil.diterima || !hasil.orang || !hasil.kelas) {
      await this.catatPenolakan(cabang.id, hasil, principal.userId);
      return { ...hasil, ...dasar, tercatat: false };
    }

    const sudahAda = await this.tulis(hasil, now);
    if (sudahAda) {
      return { ...hasil, ...dasar, diterima: false, alasan: 'SUDAH_TERCATAT', tercatat: false };
    }

    await this.audit?.catat(null, {
      actorId: principal.userId,
      branchId: cabang.id,
      action: 'attendance.studio_scan',
      objectType: hasil.orang.peran === 'INSTRUKTUR' ? 'ClassSlot' : 'Booking',
      objectId: hasil.kelas.bookingId ?? hasil.kelas.classSlotId,
      targetUserId: hasil.orang.userId,
      afterMasked: { peran: hasil.orang.peran, classSlotId: hasil.kelas.classSlotId },
    });

    return { ...hasil, ...dasar, tercatat: true, tercatatPada: now.toISOString() };
  }

  /** Menulis kehadiran; `true` berarti ternyata sudah tercatat oleh pindaian lain. */
  private async tulis(hasil: ScanResult, now: Date): Promise<boolean> {
    const { orang, kelas } = hasil;
    try {
      return await this.db.$transaction(
        async (tx) => {
          const slot = await tx.slotKelas.findUnique({
            where: { id: kelas!.classSlotId },
            select: { status: true },
          });
          if (!slot || !STATUS_TERBUKA.has(slot.status)) {
            throw new ApiProblem('INVALID_STATE_TRANSITION', HttpStatus.CONFLICT);
          }

          if (orang!.peran === 'INSTRUKTUR') {
            const ada = await tx.kehadiranInstruktur.findUnique({
              where: { classSlotId: kelas!.classSlotId },
              select: { id: true },
            });
            if (ada) return true;
            await tx.kehadiranInstruktur.create({
              data: {
                id: randomUUID(),
                classSlotId: kelas!.classSlotId,
                instructorId: orang!.userId,
                method: 'QR_SCAN',
                checkedInAt: now,
                // Dipindai staf di meja cabang itu, jadi instruktur memang berada di studionya.
                isWithinGeofence: true,
                notes: 'Dipindai di meja check-in',
              },
            });
            return false;
          }

          const booking = await tx.pemesananKelas.findUnique({
            where: { id: kelas!.bookingId! },
            select: { status: true, attendance: { select: { id: true } } },
          });
          if (!booking) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
          if (booking.attendance) return true;
          if (booking.status !== 'BOOKED') {
            throw new ApiProblem('INVALID_STATE_TRANSITION', HttpStatus.CONFLICT);
          }
          await tx.kehadiranPelanggan.create({
            data: {
              id: randomUUID(),
              bookingId: kelas!.bookingId!,
              method: 'QR_SCAN',
              checkedInAt: now,
            },
          });
          await tx.pemesananKelas.update({
            where: { id: kelas!.bookingId! },
            data: { status: 'ATTENDED' },
          });
          return false;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      // Baris kehadiran unik per booking atau per kelas: pindaian kedua yang balapan kalah di sini.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        return true;
      throw error;
    }
  }

  private async catatPenolakan(branchId: string, hasil: ScanResult, actorId: string) {
    if (hasil.alasan === 'SUDAH_TERCATAT') return;
    await this.audit?.catat(null, {
      actorId,
      branchId,
      action: 'attendance.studio_scan_rejected',
      objectType: 'Branch',
      objectId: branchId,
      targetUserId: hasil.orang?.userId ?? null,
      reason: hasil.alasan ?? null,
      afterMasked: { alasan: hasil.alasan, classSlotId: hasil.kelas?.classSlotId ?? null },
    });
  }
}
