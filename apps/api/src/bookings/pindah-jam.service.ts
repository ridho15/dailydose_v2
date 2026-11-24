import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../foundation/audit.service';
import type { SessionPrincipal } from '../identity/identity.service';
import { PolicyService } from '../identity/policy.service';
import { PRIVATE_FILE_STORAGE, type PrivateFileStorage } from '../identity/private-file-storage';
import { ApiProblem } from '../identity/security';
import { tanggalWib } from '../packages/instructor-fee-calculator';
import { JENIS_BUKTI, kunciBukti } from '../packages/penyesuaian-bukti.service';
import { paketBerlakuDi } from './cabang-paket';
import { buktiWajibAda, periksaBuktiPengajuan, simpanBuktiPengajuan, type BerkasUnggahan } from './bukti-pengajuan';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const CAP = 'booking:cancel:assisted';
const MIN_ALASAN = 10;

export type HasilPindahJam = {
  id: string;
  /** PINDAH: booking dipindah ke slot baru. BATAL_SLOT_LAMA: member sudah booking slot baru, slot lama dibatalkan. */
  cara: 'PINDAH' | 'BATAL_SLOT_LAMA';
  bookingId: string;
  sourceClassSlotId: string;
  targetClassSlotId: string;
};

/**
 * "Pindah jam" oleh staf di hari yang sama (audit 24 November 2026: member yang pindah jam di hari
 * yang sama tercatat tidak hadir di slot lama dan sesinya hangus). Booking lama tidak dipotong:
 * - bila member belum punya booking di slot baru, booking dipindah ke slot itu (kursi slot baru dipakai);
 * - bila member sudah booking slot baru sendiri, booking lama dibatalkan tanpa memotong sesi.
 * Perubahan kurang dari 12 jam oleh admin wajib alasan dan bukti (keputusan pemilik 24 November 2026).
 * Tercatat di riwayat ganti jadwal (ubah_jadwal, APPROVED) dan audit log.
 */
@Injectable()
export class PindahJamService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    @Optional() private readonly audit?: AuditService,
    @Optional() @Inject(PRIVATE_FILE_STORAGE) private readonly storage?: PrivateFileStorage,
  ) {}

  private boleh(principal: SessionPrincipal, branchId: string) {
    return this.policy.hasCapability(principal, 'branch:all', branchId) || this.policy.hasCapability(principal, CAP, branchId);
  }

  /** Slot lain di hari yang sama (WIB) yang bisa dipakai paket booking ini. */
  async pilihan(principal: SessionPrincipal, bookingId: string) {
    this.policy.requireCapability(principal.capabilities, CAP);
    const booking = await this.bookingAktif(principal, bookingId, this.db);
    const hari = tanggalWib(booking.classSlot.startAt);
    const awal = new Date(`${hari}T00:00:00+07:00`);
    const akhir = new Date(awal.getTime() + 86_400_000);
    const slots = await this.db.slotKelas.findMany({
      where: {
        id: { not: booking.classSlotId },
        status: { in: ['PUBLISHED', 'CONFIRMED'] },
        startAt: { gte: awal, lt: akhir },
        ...(booking.customerPackage?.package?.classTypeId ? { classTypeId: booking.customerPackage.package.classTypeId } : {}),
      },
      include: {
        classType: { select: { name: true } },
        branch: { select: { name: true } },
        bookings: { where: { status: { in: ['BOOKED', 'ATTENDED', 'NO_SHOW'] } }, select: { userId: true } },
      },
      orderBy: { startAt: 'asc' },
      take: 50,
    });
    return {
      items: slots
        .filter((s) => this.boleh(principal, s.branchId))
        .filter((s) => !booking.customerPackage || paketBerlakuDi(booking.customerPackage as never, s.branchId))
        .map((s) => {
          const sudahBooking = s.bookings.some((b) => b.userId === booking.userId);
          return {
            id: s.id,
            className: s.classType?.name ?? 'Kelas',
            branchName: s.branch?.name ?? null,
            startAt: s.startAt.toISOString(),
            endAt: s.endAt.toISOString(),
            terisi: s.bookings.length,
            capacity: s.capacity,
            memberSudahBooking: sudahBooking,
            bisaDipilih: sudahBooking || s.bookings.length < s.capacity,
          };
        }),
    };
  }

  async pindah(
    principal: SessionPrincipal,
    bookingId: string,
    input: { targetClassSlotId?: unknown; reason?: unknown },
    berkas: BerkasUnggahan,
    now = new Date(),
  ): Promise<HasilPindahJam> {
    this.policy.requireCapability(principal.capabilities, CAP);
    const targetId = typeof input.targetClassSlotId === 'string' ? input.targetClassSlotId : '';
    if (!UUID.test(bookingId) || !UUID.test(targetId))
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'targetClassSlotId', issue: 'REQUIRED' },
      ]);
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (reason.length < MIN_ALASAN || reason.length > 200)
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'reason', issue: reason.length < MIN_ALASAN ? 'TOO_SHORT' : 'TOO_LONG' },
      ]);
    const bukti = periksaBuktiPengajuan(berkas);
    if (!bukti) throw buktiWajibAda();
    const id = randomUUID();
    const hapusBukti = await simpanBuktiPengajuan(this.storage, id, bukti);

    try {
      return await this.db.$transaction(
        async (tx) => {
          const booking = await this.bookingAktif(principal, bookingId, tx);
          const target = await tx.slotKelas.findUnique({ where: { id: targetId } });
          if (!target || target.id === booking.classSlotId || !this.boleh(principal, target.branchId))
            throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
          if (!['PUBLISHED', 'CONFIRMED'].includes(target.status))
            throw new ApiProblem('CLASS_NOT_BOOKABLE', HttpStatus.CONFLICT);
          if (tanggalWib(target.startAt) !== tanggalWib(booking.classSlot.startAt))
            throw new ApiProblem('MOVE_NOT_SAME_DAY', HttpStatus.UNPROCESSABLE_ENTITY);
          const cp = booking.customerPackage;
          if (cp) {
            if (!paketBerlakuDi(cp as never, target.branchId))
              throw new ApiProblem('PACKAGE_BRANCH_MISMATCH', HttpStatus.CONFLICT);
            if (cp.package?.classTypeId && cp.package.classTypeId !== target.classTypeId)
              throw new ApiProblem('PACKAGE_CLASS_TYPE_MISMATCH', HttpStatus.CONFLICT);
          }

          const [a, b] = [booking.classSlotId, target.id].sort();
          if (typeof (tx as { $queryRaw?: unknown }).$queryRaw === 'function')
            await tx.$queryRaw`SELECT id FROM slot_kelas WHERE id IN (${a}, ${b}) ORDER BY id FOR UPDATE`;

          const bookingBaru = await tx.pemesananKelas.findFirst({
            where: { userId: booking.userId, classSlotId: target.id, status: { in: ['BOOKED', 'ATTENDED'] } },
            select: { id: true },
          });
          let cara: HasilPindahJam['cara'];
          if (bookingBaru) {
            // Member sudah booking slot baru sendiri: slot lama dibatalkan tanpa memotong sesi.
            cara = 'BATAL_SLOT_LAMA';
            await tx.pemesananKelas.update({
              where: { id: booking.id },
              data: {
                status: 'CANCELLED',
                cancelledAt: now,
                cancelledById: principal.userId || null,
                cancellationReason: `Pindah jam di hari yang sama: ${reason}`.slice(0, 1000),
              },
            });
          } else {
            const terisi = await tx.pemesananKelas.count({
              where: { classSlotId: target.id, status: { in: ['BOOKED', 'ATTENDED', 'NO_SHOW'] } },
            });
            if (terisi >= target.capacity) throw new ApiProblem('CLASS_CAPACITY_FULL', HttpStatus.CONFLICT);
            cara = 'PINDAH';
            await tx.pemesananKelas.update({ where: { id: booking.id }, data: { classSlotId: target.id } });
            await tx.slotKelas.update({ where: { id: target.id }, data: { bookedCount: terisi + 1 } });
          }
          await tx.slotKelas.update({ where: { id: booking.classSlotId }, data: { bookedCount: { decrement: 1 } } });
          // Token QR lama tidak boleh dipakai lagi di slot lama.
          await tx.checkInToken.updateMany({ where: { bookingId: booking.id, isUsed: false }, data: { isUsed: true } });

          await tx.ubahJadwal.create({
            data: {
              id,
              bookingId: booking.id,
              sourceSlotId: booking.classSlotId,
              targetSlotId: target.id,
              requestedById: principal.userId,
              status: 'APPROVED',
              reason: `[PINDAH JAM STAF] ${reason}`.slice(0, 1000),
            },
          });
          await this.audit?.catat(tx, {
            actorId: principal.userId,
            branchId: target.branchId,
            action: 'booking.moved_same_day',
            objectType: 'Reschedule',
            objectId: id,
            targetUserId: booking.userId,
            reason,
            beforeMasked: { bookingId: booking.id, sourceSlotId: booking.classSlotId },
            afterMasked: { targetSlotId: target.id, cara, bukti: true },
          });
          return { id, cara, bookingId: booking.id, sourceClassSlotId: booking.classSlotId, targetClassSlotId: target.id };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      await hapusBukti();
      throw error;
    }
  }

  /** Bukti pindah jam; hanya untuk staf yang boleh di cabang asal atau tujuan. */
  async bukti(principal: SessionPrincipal, id: string) {
    this.policy.requireAnyCapability(principal.capabilities, [CAP, 'reschedule:read']);
    if (!UUID.test(id)) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const row = await this.db.ubahJadwal.findUnique({
      where: { id },
      select: { sourceSlot: { select: { branchId: true } }, targetSlot: { select: { branchId: true } } },
    });
    const cabang = [row?.sourceSlot?.branchId, row?.targetSlot?.branchId].filter((x): x is string => Boolean(x));
    if (!row || !cabang.some((c) => this.boleh(principal, c) || this.policy.hasCapability(principal, 'reschedule:read', c)))
      throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (this.storage)
      for (const jenis of JENIS_BUKTI) {
        const kunci = kunciBukti(id, jenis.ext);
        if (await this.storage.exists(kunci).catch(() => false))
          return { mimeType: jenis.mime, stream: await this.storage.read(kunci) };
      }
    throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
  }

  private async bookingAktif(principal: SessionPrincipal, bookingId: string, db: Prisma.TransactionClient | PrismaService) {
    if (!UUID.test(bookingId)) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const booking = await db.pemesananKelas.findUnique({
      where: { id: bookingId },
      include: {
        attendance: { select: { id: true } },
        classSlot: { select: { id: true, branchId: true, startAt: true, status: true } },
        customerPackage: { include: { package: true, purchase: { select: { branchId: true } } } },
      },
    });
    if (!booking || !this.boleh(principal, booking.classSlot.branchId))
      throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    // Hanya booking yang belum dipakai: sudah hadir atau kelasnya sudah diselesaikan tidak dipindah
    // (koreksinya lewat Penyesuaian Sesi).
    if (booking.status !== 'BOOKED' || booking.attendance || booking.classSlot.status === 'COMPLETED')
      throw new ApiProblem('BOOKING_NOT_ACTIVE', HttpStatus.CONFLICT);
    return booking;
  }
}
