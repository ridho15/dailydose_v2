import type { Prisma } from '@prisma/client';
import { HITUNG_TERISI, terisi } from '../classes/terisi';

const MINGGU = 7 * 86_400_000;

export interface BookingLagi {
  classSlotId: string;
  className: string;
  branchName: string;
  timezone: string;
  startAt: Date;
  endAt: Date;
  instructorName: string | null;
}

type Db = Pick<Prisma.TransactionClient, 'pemesananKelas' | 'slotKelas'>;

/**
 * Saran "Booking lagi" di Beranda member: kelas yang sama (cabang, jenis kelas, jam mulai) pada
 * minggu berikutnya setelah booking terakhirnya, selama masih dibuka, belum penuh, dan belum ia
 * booking. Dasarnya booking terakhir dalam 3 minggu terakhir; lebih lama dari itu kebiasaannya
 * dianggap sudah berubah.
 */
export async function bookingLagiUntuk(db: Db, userId: string, now: Date): Promise<BookingLagi | null> {
  if (typeof db.pemesananKelas.findFirst !== 'function' || typeof db.slotKelas.findMany !== 'function')
    return null;
  const dasar = await db.pemesananKelas.findFirst({
    where: {
      userId,
      status: { in: ['BOOKED', 'ATTENDED'] },
      classSlot: { startAt: { gte: new Date(now.getTime() - 3 * MINGGU) } },
    },
    orderBy: { classSlot: { startAt: 'desc' } },
    select: { classSlot: { select: { branchId: true, classTypeId: true, startAt: true } } },
  });
  if (!dasar?.classSlot) return null;

  // Minggu berikutnya setelah booking itu; bila sudah lewat, minggu terdekat yang belum lewat.
  const kandidat: Date[] = [];
  for (let minggu = 1; minggu <= 4 && kandidat.length < 2; minggu += 1) {
    const jam = new Date(dasar.classSlot.startAt.getTime() + minggu * MINGGU);
    if (jam > now) kandidat.push(jam);
  }
  if (kandidat.length === 0) return null;

  const slots = await db.slotKelas.findMany({
    where: {
      branchId: dasar.classSlot.branchId,
      classTypeId: dasar.classSlot.classTypeId,
      startAt: { in: kandidat },
      status: { in: ['PUBLISHED', 'CONFIRMED'] },
      bookings: { none: { userId, status: { in: ['BOOKED', 'ATTENDED'] } } },
    },
    include: {
      classType: { select: { name: true } },
      branch: { select: { name: true, timezone: true } },
      instructor: { select: { displayName: true } },
      ...HITUNG_TERISI,
    },
    orderBy: { startAt: 'asc' },
  });
  const slot = slots.find((item) => terisi(item) < item.capacity);
  if (!slot) return null;
  return {
    classSlotId: slot.id,
    className: slot.classType.name,
    branchName: slot.branch.name,
    timezone: slot.branch.timezone,
    startAt: slot.startAt,
    endAt: slot.endAt,
    instructorName: slot.instructor?.displayName ?? null,
  };
}
