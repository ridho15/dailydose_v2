import type { Prisma } from '@prisma/client';

/**
 * Booking yang masih "memegang" satu sesi paket yang belum dipotong. Sesi baru dipotong saat kelas
 * selesai, jadi selain BOOKED, peserta yang sudah check-in (ATTENDED) di kelas yang belum
 * diselesaikan juga masih memegang sesinya. Tanpa ini, sisa sesi terlihat lebih banyak dari
 * sebenarnya dan paket bisa menjadi minus saat kelas-kelasnya diselesaikan.
 *
 * Booking migrasi V1 (BKG-V1-*) dikecualikan karena sesinya sudah diperhitungkan pada saldo awal migrasi
 * dan tidak boleh menyandera saldo sesi aktif yang baru.
 */
export const MEMEGANG_SESI: Prisma.PemesananKelasWhereInput = {
  NOT: { bookingNumber: { startsWith: 'BKG-V1-' } },
  OR: [
    { status: 'BOOKED' },
    { status: 'ATTENDED', classSlot: { status: { notIn: ['COMPLETED', 'CANCELLED'] } } },
  ],
};

type DbSesi = Pick<Prisma.TransactionClient, 'pemesananKelas' | 'sessionLedger'>;

/**
 * Buang booking yang sesinya sudah dipotong (ada catatan ATTEND di buku besar untuk booking itu).
 * Sesi yang sudah dipotong dihitung sebagai "terpakai"; menghitungnya lagi sebagai "tertahan" membuat
 * satu sesi terhitung dua kali. Hanya booking ATTENDED yang perlu dicek: BOOKED belum pernah dipotong.
 */
export async function tanpaPotongan<T extends { id: string; status: string }>(
  db: DbSesi,
  rows: T[],
): Promise<T[]> {
  const hadir = rows.filter((row) => row.status === 'ATTENDED');
  if (hadir.length === 0) return rows;
  const potongan = await db.sessionLedger.findMany({
    where: { type: 'ATTEND', referenceId: { in: hadir.map((row) => row.id) } },
    select: { referenceId: true },
  });
  const sudah = new Set(potongan.map((item) => item.referenceId));
  return rows.filter((row) => !sudah.has(row.id));
}

/** Booking yang benar-benar masih menahan sesi: MEMEGANG_SESI dikurangi yang sudah dipotong. */
export async function bookingMenahanSesi(db: DbSesi, where: Prisma.PemesananKelasWhereInput) {
  const rows = await db.pemesananKelas.findMany({
    where: { AND: [MEMEGANG_SESI, where] },
    select: { id: true, status: true, customerPackageId: true },
  });
  return tanpaPotongan(db, rows);
}

/** Jumlah sesi tertahan per paket. Paket tanpa booking aktif tidak muncul di peta (anggap 0). */
export async function tertahanPerPaket(db: DbSesi, packageIds: Array<string | null | undefined>) {
  const ids = [...new Set(packageIds.filter((id): id is string => Boolean(id)))];
  const hasil = new Map<string, number>();
  if (ids.length === 0) return hasil;
  for (const row of await bookingMenahanSesi(db, { customerPackageId: { in: ids } }))
    hasil.set(row.customerPackageId, (hasil.get(row.customerPackageId) ?? 0) + 1);
  return hasil;
}

/**
 * Ringkasan booking satu paket untuk sinkronisasi saldo. "Terpakai" hanya booking yang sesinya
 * memang sudah dipotong: kelas sudah selesai, sudah ada catatan potongan, atau booking migrasi V1
 * (sudah ada di saldo awal). Hadir di kelas yang belum selesai masih "tertahan", bukan "terpakai".
 */
export async function ringkasBookingPaket(db: DbSesi, packageId: string) {
  const rows = await db.pemesananKelas.findMany({
    where: { customerPackageId: packageId },
    select: { id: true, status: true, bookingNumber: true, classSlot: { select: { status: true } } },
  });
  // Hadir/tidak hadir di kelas yang belum selesai: terpakai hanya bila potongannya sudah tercatat.
  const kandidat = rows.filter(
    (row) =>
      !row.bookingNumber.startsWith('BKG-V1-') &&
      row.classSlot.status !== 'COMPLETED' &&
      (row.status === 'ATTENDED' || row.status === 'NO_SHOW'),
  );
  const menunggu = new Set(
    (await tanpaPotongan(db, kandidat.map((row) => ({ id: row.id, status: 'ATTENDED' })))).map(
      (row) => row.id,
    ),
  );
  let hadir = 0;
  let tidakHadir = 0;
  let booked = 0;
  let dibatalkan = 0;
  let tertahanHadir = 0;
  let v1 = 0;
  for (const row of rows) {
    if (row.bookingNumber.startsWith('BKG-V1-')) v1 += 1;
    if (row.status === 'BOOKED') booked += 1;
    else if (row.status === 'CANCELLED') dibatalkan += 1;
    else if (row.status !== 'ATTENDED' && row.status !== 'NO_SHOW') continue;
    else if (menunggu.has(row.id)) {
      if (row.status === 'ATTENDED' && row.classSlot.status !== 'CANCELLED') tertahanHadir += 1;
    } else if (row.status === 'ATTENDED') hadir += 1;
    else tidakHadir += 1;
  }
  return { hadir, tidakHadir, booked, dibatalkan, tertahanHadir, v1 };
}
