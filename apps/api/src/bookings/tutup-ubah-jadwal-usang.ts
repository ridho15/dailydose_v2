import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../database/prisma.service';

export const AKSI_TUTUP_OTOMATIS = 'reschedule.auto_closed';

export type AlasanUsang = 'BOOKING_TIDAK_AKTIF' | 'BOOKING_SUDAH_PINDAH' | 'KELAS_SUDAH_LEWAT';

/** Kenapa permintaan ganti jadwal tidak bisa lagi disetujui; null bila masih berlaku. */
export function alasanUsang(
  r: {
    sourceSlotId: string;
    booking: { status: string; classSlotId: string } | null;
    sourceSlot: { startAt: Date } | null;
    targetSlot: { startAt: Date } | null;
  },
  now: Date,
): AlasanUsang | null {
  if (!r.booking || r.booking.status !== 'BOOKED') return 'BOOKING_TIDAK_AKTIF';
  if (r.booking.classSlotId !== r.sourceSlotId) return 'BOOKING_SUDAH_PINDAH';
  const lewat = (s: { startAt: Date } | null) => !s || s.startAt.getTime() <= now.getTime();
  if (lewat(r.sourceSlot) || lewat(r.targetSlot)) return 'KELAS_SUDAH_LEWAT';
  return null;
}

/**
 * Menutup permintaan ganti jadwal yang sudah tidak bisa disetujui: booking asal dibatalkan atau
 * dipindah staf secara manual, atau kelas asal/tujuan sudah mulai. Tanpa ini permintaan tetap
 * "menunggu" di antrean walau sudah selesai ditangani. Dijalankan sebelum antrean dibaca.
 * Tiap penutupan tercatat di audit log. Mengembalikan jumlah yang ditutup.
 */
export async function tutupUbahJadwalUsang(db: PrismaService, now = new Date()): Promise<number> {
  // Pembersihan tidak boleh menghalangi antrean tampil; gagal berarti dicoba lagi saat antrean dibuka berikutnya.
  return tutup(db, now).catch(() => 0);
}

async function tutup(db: PrismaService, now: Date): Promise<number> {
  const menunggu = await db.ubahJadwal.findMany({
    where: { status: 'PENDING' },
    select: {
      id: true,
      bookingId: true,
      sourceSlotId: true,
      booking: { select: { status: true, classSlotId: true } },
      sourceSlot: { select: { startAt: true, branchId: true } },
      targetSlot: { select: { startAt: true } },
    },
    take: 500,
  });
  const usang = menunggu
    .map((r) => ({ r, alasan: alasanUsang(r, now) }))
    .filter((x): x is { r: (typeof menunggu)[number]; alasan: AlasanUsang } => x.alasan !== null);
  if (!usang.length) return 0;

  const { count } = await db.ubahJadwal.updateMany({
    where: { id: { in: usang.map((x) => x.r.id) }, status: 'PENDING' },
    data: { status: 'CANCELLED' },
  });
  await db.auditLog
    .createMany({
      data: usang.map(({ r, alasan }) => ({
        id: randomUUID(),
        action: AKSI_TUTUP_OTOMATIS,
        actorId: null,
        branchId: r.sourceSlot?.branchId ?? null,
        objectType: 'UbahJadwal',
        objectId: r.id,
        reason: 'Ditutup otomatis: permintaan sudah tidak bisa disetujui',
        detail: { alasan, bookingId: r.bookingId },
      })),
    })
    .catch(() => undefined);
  return count;
}
