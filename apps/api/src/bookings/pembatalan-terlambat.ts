import { HttpStatus } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, SessionMutationType } from '@prisma/client';
import { ApiProblem } from '../identity/security';

/**
 * Pembatalan booking yang tidak lagi boleh dibatalkan langsung: kurang dari H-24, atau booking yang
 * sudah terkunci "Hadir" sebelum kelasnya berjalan (data V1 menandai booking lewat H-24 sebagai hadir).
 *
 * Admin mengajukan, Manager atau Owner memutuskan. Pengajuan disimpan di `session_adjust_request`
 * dengan kode di bawah, tanpa tabel baru, sehingga juga tampil di antrean Penyesuaian Sesi.
 */
export const KODE_PEMBATALAN_TERLAMBAT = 'LATE_CANCELLATION';
export const CAP_PUTUS_PEMBATALAN = 'booking:late-cancel:decide';

/**
 * Sesi yang dikembalikan bila disetujui: 1 bila sesinya sudah terpotong (ada potongan ATTEND untuk
 * booking ini, atau booking sudah berstatus Hadir), 0 bila belum (booking aktif biasa).
 */
export async function sesiTerpotong(
  tx: Prisma.TransactionClient,
  booking: { id: string; status: string },
): Promise<number> {
  if (booking.status === 'ATTENDED') return 1;
  const potongan = await tx.sessionLedger.findFirst({
    where: { referenceId: booking.id, type: SessionMutationType.ATTEND },
    select: { id: true },
  });
  return potongan ? 1 : 0;
}

/** Menjalankan pembatalan yang sudah disetujui, di dalam transaksi pemanggil. */
export async function jalankanPembatalanTerlambat(
  tx: Prisma.TransactionClient,
  pengajuan: {
    id: string;
    bookingId: string | null;
    customerPackageId: string;
    sessionCount: number;
    reason: string;
  },
  actorId: string,
  now: Date,
): Promise<{ resultingBalance: number | null; sessionsReturned: number }> {
  if (!pengajuan.bookingId) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
  const booking = await tx.pemesananKelas.findUnique({
    where: { id: pengajuan.bookingId },
    include: { attendance: true, classSlot: { select: { branchId: true } } },
  });
  if (!booking) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
  if (booking.status === 'CANCELLED')
    throw new ApiProblem('BOOKING_NOT_ACTIVE', HttpStatus.CONFLICT);
  // Dihitung saat diputuskan: bila kelasnya keburu selesai, sesinya sudah terpotong sejak itu.
  const sesiKembali = await sesiTerpotong(tx, booking);

  await tx.pemesananKelas.update({
    where: { id: booking.id },
    data: {
      status: 'CANCELLED',
      cancelledAt: now,
      cancellationReason: `Pembatalan H-24 disetujui: ${pengajuan.reason}`.slice(0, 1000),
      cancelledById: actorId,
    },
  });
  // Booking yang batal tidak boleh tetap tercatat hadir.
  if (booking.attendance)
    await tx.kehadiranPelanggan.delete({ where: { id: booking.attendance.id } });
  await tx.slotKelas.update({
    where: { id: booking.classSlotId },
    data: { bookedCount: { decrement: 1 } },
  });

  let resultingBalance: number | null = null;
  if (sesiKembali > 0) {
    const pkg = await tx.paketPelanggan.findUniqueOrThrow({
      where: { id: pengajuan.customerPackageId },
    });
    resultingBalance = pkg.remainingSessions + sesiKembali;
    await tx.paketPelanggan.update({
      where: { id: pkg.id },
      data: {
        remainingSessions: resultingBalance,
        ...(pkg.status === 'DEPLETED' && pkg.validUntil > now ? { status: 'ACTIVE' } : {}),
      },
    });
    await tx.sessionLedger.create({
      data: {
        customerPackageId: pkg.id,
        type: SessionMutationType.ADJUST_MANUAL,
        amount: sesiKembali,
        balanceAfter: resultingBalance,
        referenceId: pengajuan.id,
        notes: `Pembatalan H-24 disetujui, sesi dikembalikan: ${pengajuan.reason}`.slice(0, 1000),
        createdById: actorId,
      },
    });
  }

  await tx.auditLog.create({
    data: {
      id: randomUUID(),
      action: 'booking.late_cancellation_approved',
      actorId,
      targetUserId: booking.userId,
      branchId: booking.classSlot.branchId,
      reason: pengajuan.reason.slice(0, 500),
      detail: {
        bookingId: booking.id,
        previousStatus: booking.status,
        sessionsReturned: sesiKembali,
        requestId: pengajuan.id,
      },
    },
  });
  return { resultingBalance, sessionsReturned: sesiKembali };
}
