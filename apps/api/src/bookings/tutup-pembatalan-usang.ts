import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../database/prisma.service';
import { KODE_PEMBATALAN_TERLAMBAT } from './pembatalan-terlambat';

export const KODE_TUTUP_OTOMATIS = 'AUTO_CLOSED_INACTIVE';
export const AKSI_TUTUP_PEMBATALAN = 'booking.late_cancellation_auto_closed';

export type AlasanPembatalanUsang = 'BOOKING_TIDAK_ADA' | 'BOOKING_SUDAH_DIBATALKAN' | 'KELAS_DIBATALKAN';

/**
 * Pengajuan batal < 12 jam yang tidak bisa lagi diputus: booking-nya hilang, sudah dibatalkan dengan
 * jalan lain (staf), atau kelasnya dibatalkan. Izin medis membatalkan booking sejak diajukan (kursi
 * langsung dilepas), jadi booking batal pada izin medis BUKAN tanda usang kecuali kelasnya dibatalkan.
 */
export function alasanPembatalanUsang(r: {
  reason: string;
  booking: { status: string; classSlot: { status: string } | null } | null;
}): AlasanPembatalanUsang | null {
  if (!r.booking) return 'BOOKING_TIDAK_ADA';
  if (r.booking.classSlot?.status === 'CANCELLED') return 'KELAS_DIBATALKAN';
  const medis = r.reason.startsWith('[IZIN MEDIS]');
  if (r.booking.status === 'CANCELLED' && !medis) return 'BOOKING_SUDAH_DIBATALKAN';
  return null;
}

const CATATAN: Record<AlasanPembatalanUsang, string> = {
  BOOKING_TIDAK_ADA: 'Ditutup otomatis: booking sudah tidak ada.',
  BOOKING_SUDAH_DIBATALKAN: 'Ditutup otomatis: booking sudah dibatalkan staf sebelum pengajuan diputus.',
  KELAS_DIBATALKAN: 'Ditutup otomatis: kelasnya dibatalkan studio.',
};

/**
 * Menutup pengajuan usang supaya tidak tertahan di antrean dan tidak memunculkan galat 409 saat
 * disetujui (audit 24 November 2026). Status REJECTED dengan kode AUTO_CLOSED_INACTIVE: tidak ada
 * sesi yang berubah. Dipanggil sebelum antrean dibaca; kegagalan tidak menghalangi antrean tampil.
 */
export async function tutupPembatalanUsang(db: PrismaService, now = new Date()): Promise<number> {
  return tutup(db, now).catch(() => 0);
}

async function tutup(db: PrismaService, now: Date): Promise<number> {
  const menunggu = await db.sessionAdjustRequest.findMany({
    where: { status: 'PENDING', reasonCode: KODE_PEMBATALAN_TERLAMBAT },
    select: {
      id: true,
      reason: true,
      bookingId: true,
      booking: { select: { status: true, classSlot: { select: { status: true, branchId: true } } } },
    },
    take: 500,
  });
  const usang = menunggu
    .map((r) => ({ r, alasan: alasanPembatalanUsang(r) }))
    .filter((x): x is { r: (typeof menunggu)[number]; alasan: AlasanPembatalanUsang } => x.alasan !== null);
  let ditutup = 0;
  for (const { r, alasan } of usang) {
    const { count } = await db.sessionAdjustRequest.updateMany({
      where: { id: r.id, status: 'PENDING' },
      data: {
        status: 'REJECTED',
        decisionCode: KODE_TUTUP_OTOMATIS,
        decisionNote: CATATAN[alasan],
        decisionReason: CATATAN[alasan],
        decidedAt: now,
        version: { increment: 1 },
      },
    });
    ditutup += count;
  }
  if (usang.length)
    await db.auditLog
      .createMany({
        data: usang.map(({ r, alasan }) => ({
          id: randomUUID(),
          action: AKSI_TUTUP_PEMBATALAN,
          actorId: null,
          branchId: r.booking?.classSlot?.branchId ?? null,
          objectType: 'SessionAdjustRequest',
          objectId: r.id,
          reason: CATATAN[alasan],
          detail: { alasan, bookingId: r.bookingId },
        })),
      })
      .catch(() => undefined);
  return ditutup;
}
