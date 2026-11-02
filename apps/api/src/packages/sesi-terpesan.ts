import type { Prisma } from '@prisma/client';

/**
 * Booking yang masih "memegang" satu sesi paket yang belum dipotong. Sesi baru dipotong saat kelas
 * selesai, jadi selain BOOKED, peserta yang sudah check-in (ATTENDED) di kelas yang belum
 * diselesaikan juga masih memegang sesinya. Tanpa ini, sisa sesi terlihat lebih banyak dari
 * sebenarnya dan paket bisa menjadi minus saat kelas-kelasnya diselesaikan.
 */
export const MEMEGANG_SESI: Prisma.PemesananKelasWhereInput = {
  OR: [
    { status: 'BOOKED' },
    { status: 'ATTENDED', classSlot: { status: { notIn: ['COMPLETED', 'CANCELLED'] } } },
  ],
};
