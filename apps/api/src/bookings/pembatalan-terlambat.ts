import { HttpStatus } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, SessionMutationType } from '@prisma/client';
import { ApiProblem } from '../identity/security';

/**
 * Pembatalan booking yang tidak lagi boleh dibatalkan langsung: kurang dari batas pembatalan (H-12), atau booking yang
 * sudah terkunci "Hadir" sebelum kelasnya berjalan (data V1 menandai booking lewat H-24 sebagai hadir).
 *
 * Admin mengajukan, Manager atau Owner memutuskan. Pengajuan disimpan di `session_adjust_request`
 * dengan kode di bawah, tanpa tabel baru, sehingga juga tampil di antrean Penyesuaian Sesi.
 */
export const KODE_PEMBATALAN_TERLAMBAT = 'LATE_CANCELLATION';
export const CAP_PUTUS_PEMBATALAN = 'booking:late-cancel:decide';

/**
 * Sesi yang dikembalikan bila disetujui: 1 hanya bila sesinya memang sudah terpotong, 0 bila belum.
 * Terpotong berarti ada potongan ATTEND untuk booking ini (sesi V2 dipotong saat kelas selesai),
 * atau booking hasil migrasi V1 yang sudah Hadir/Tidak hadir (V1 memotong saat booking dikunci
 * dan migrasi tidak membuat baris potongan). Booking V2 yang sudah check-in tetapi kelasnya belum
 * selesai belum terpotong, jadi tidak ada yang dikembalikan.
 */
export async function sesiTerpotong(
  tx: Prisma.TransactionClient,
  booking: { id: string; status: string; bookingNumber?: string | null },
): Promise<number> {
  const potongan = await tx.sessionLedger.findFirst({
    where: { referenceId: booking.id, type: SessionMutationType.ATTEND },
    select: { id: true },
  });
  if (potongan) return 1;
  const dariV1 = booking.bookingNumber?.startsWith('BKG-V1-') ?? false;
  return dariV1 && (booking.status === 'ATTENDED' || booking.status === 'NO_SHOW') ? 1 : 0;
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
  const isMedical = pengajuan.reason.startsWith('[IZIN MEDIS]');
  const isAlreadyCancelledForMedical = booking.status === 'CANCELLED' && isMedical;
  if (booking.status === 'CANCELLED' && !isAlreadyCancelledForMedical)
    throw new ApiProblem('BOOKING_NOT_ACTIVE', HttpStatus.CONFLICT);

  // Dihitung saat diputuskan (juga untuk izin medis): hanya sesi yang benar-benar sudah terpotong
  // yang dikembalikan, supaya pembatalan tidak menghasilkan sesi gratis.
  const sesiKembali = await sesiTerpotong(tx, booking);

  if (!isAlreadyCancelledForMedical) {
    await tx.pemesananKelas.update({
      where: { id: booking.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: now,
        cancellationReason: `Pembatalan terlambat disetujui: ${pengajuan.reason}`.slice(0, 1000),
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
  }

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
        // Sesi yang dikembalikan tidak lagi terpakai; tanpa ini "terpakai" lebih besar dari potongan nyata.
        usedSessions: Math.max(0, pkg.usedSessions - sesiKembali),
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
        notes: `Pembatalan terlambat disetujui, sesi dikembalikan: ${pengajuan.reason}`.slice(0, 1000),
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

/**
 * Penyetuju pengajuan pembatalan terlambat (PRD 5.6): Manager cabang, Owner pemilik cabang, dan
 * Super Owner. Dipakai baik untuk pengajuan admin maupun pengajuan member sendiri.
 */
export const PENERIMA_PEMBATALAN_TERLAMBAT = ['MANAGER', 'OWNER', 'SUPER_OWNER'] as const;

/** Notifikasi pengajuan membuka kotak masuk "Perlu tindakan" di beranda staf, bukan daftar umum. */
export const HREF_KOTAK_MASUK_PEMBATALAN = '/workspace?tindakan=pembatalan';

interface PenulisNotifikasi {
  writeForUser(
    tx: Prisma.TransactionClient,
    input: {
      userId: string;
      branchId?: string;
      eventKey: string;
      category: 'APPROVAL';
      tone: 'WARNING';
      title: string;
      message: string;
      href?: string;
    },
  ): Promise<void>;
}

/**
 * Mengirim notifikasi pengajuan pembatalan terlambat ke semua penyetuju yang berwenang di cabang
 * booking. Manager dicari dari cabang utamanya, Owner dari `owner_cabang`, Super Owner semua.
 * Kegagalan notifikasi tidak membatalkan pengajuan.
 */
export async function kirimNotifikasiPengajuanPembatalan(
  writer: PenulisNotifikasi | undefined,
  db: Prisma.TransactionClient,
  input: { pengajuanId: string; bookingId: string },
): Promise<void> {
  if (!writer) return;
  try {
    const booking = await db.pemesananKelas.findUnique({
      where: { id: input.bookingId },
      select: {
        bookingNumber: true,
        user: { select: { displayName: true } },
        classSlot: { select: { branchId: true } },
      },
    });
    const branchId = booking?.classSlot.branchId;
    if (!booking || !branchId) return;
    const penerima = await db.user.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { role: 'MANAGER', preferredBranchId: branchId },
          { role: 'OWNER', ownedBranches: { some: { branchId } } },
          { role: { in: ['SUPER_OWNER', 'SUPERADMIN'] } },
        ],
      },
      select: { id: true },
    });
    for (const user of penerima) {
      await writer
        .writeForUser(db, {
          userId: user.id,
          branchId,
          eventKey: `late_cancel.requested:${input.pengajuanId}`,
          category: 'APPROVAL',
          tone: 'WARNING',
          title: 'Pengajuan pembatalan menunggu keputusan',
          message: `${booking.user?.displayName || 'Member'} mengajukan pembatalan kurang dari 12 jam sebelum kelas (booking #${booking.bookingNumber}).`,
          href: HREF_KOTAK_MASUK_PEMBATALAN,
        })
        .catch(() => {});
    }
  } catch {
    // Notifikasi bersifat pelengkap; pengajuan tetap tersimpan dan tampil di kotak masuk.
  }
}

/**
 * Pengajuan batal yang DITOLAK untuk kelas yang sudah berakhir: booking langsung diproses seperti
 * kelas selesai, Hadir bila ada presensi, Tidak hadir bila tidak, dan sesinya dipotong sekali
 * (audit 24 November 2026: sebelumnya booking kembali "Booking Aktif" walau kelasnya sudah lewat).
 * Izin medis sudah membatalkan booking sejak diajukan; penolakan berarti pembatalannya tidak
 * diterima, jadi diproses sama. Kelas yang belum berakhir tidak disentuh: booking tetap seperti semula.
 */
export async function prosesBookingSetelahDitolak(
  tx: Prisma.TransactionClient,
  bookingId: string | null,
  actorId: string,
  now: Date,
): Promise<'ATTENDED' | 'NO_SHOW' | null> {
  if (!bookingId) return null;
  const booking = await tx.pemesananKelas.findUnique({
    where: { id: bookingId },
    include: {
      attendance: { select: { id: true } },
      classSlot: {
        select: { endAt: true, status: true, classType: { select: { name: true } }, branch: { select: { name: true } } },
      },
    },
  });
  if (!booking?.classSlot || booking.classSlot.status === 'CANCELLED') return null;
  if (booking.classSlot.endAt.getTime() > now.getTime()) return null;
  // Booking hasil migrasi V1 sudah diperhitungkan V1 (lihat penyelesaian kelas).
  if (booking.bookingNumber?.startsWith('BKG-V1-')) return null;

  const hadir = booking.status === 'ATTENDED' || Boolean(booking.attendance);
  const statusBaru = hadir ? 'ATTENDED' : 'NO_SHOW';
  if (booking.status !== statusBaru)
    await tx.pemesananKelas.update({ where: { id: booking.id }, data: { status: statusBaru } });

  const sudahDipotong = await tx.sessionLedger.findFirst({
    where: { referenceId: booking.id, type: SessionMutationType.ATTEND },
    select: { id: true },
  });
  if (!sudahDipotong && booking.customerPackageId) {
    const paket = await tx.paketPelanggan.findUnique({ where: { id: booking.customerPackageId } });
    if (paket) {
      const sisa = Math.max(0, paket.remainingSessions - 1);
      const kelas = `${booking.classSlot.classType?.name ?? 'Kelas'} di ${booking.classSlot.branch?.name ?? 'studio'}`;
      await tx.sessionLedger.create({
        data: {
          customerPackageId: paket.id,
          type: SessionMutationType.ATTEND,
          amount: -1,
          balanceAfter: sisa,
          referenceId: booking.id,
          notes: hadir
            ? `Pembatalan ditolak, kelas sudah berlangsung: ${kelas}`
            : `Sesi hangus (NO SHOW): pembatalan terlambat ditolak, kelas ${kelas} sudah berlangsung`,
          createdById: actorId || null,
        },
      });
      await tx.paketPelanggan.update({
        where: { id: paket.id },
        data: {
          usedSessions: { increment: 1 },
          remainingSessions: paket.remainingSessions > 0 ? { decrement: 1 } : { set: 0 },
          status: sisa <= 0 ? 'DEPLETED' : paket.status,
        },
      });
    }
  }
  return statusBaru;
}
