import type { Prisma } from '@prisma/client';

/**
 * Jumlah peserta sebuah kelas dihitung dari booking yang benar-benar ada, bukan dari kolom
 * `slot_kelas.bookedCount`. Kolom itu hanya penghitung yang bisa melenceng: sinkronisasi V1
 * menambahnya setiap kali dijalankan, dan booking yang batal di V1 tidak menguranginya, sehingga
 * timetable menulis "3/8" padahal daftar pesertanya kosong.
 *
 * Booking tidak hadir tetap menempati kursi (sesinya juga terpotong); yang batal tidak.
 */
export const STATUS_MENEMPATI_KURSI = ['BOOKED', 'ATTENDED', 'NO_SHOW'] as const;

export const HITUNG_TERISI = {
  _count: {
    select: { bookings: { where: { status: { in: [...STATUS_MENEMPATI_KURSI] } } } },
  },
} satisfies Prisma.SlotKelasInclude;

/** Terisi dari hitungan booking bila tersedia; kolom lama hanya cadangan. */
export function terisi(slot: { bookedCount: number; _count?: { bookings?: number } | null }) {
  return slot._count?.bookings ?? slot.bookedCount;
}
