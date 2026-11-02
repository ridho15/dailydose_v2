import { bacaOpsional } from '../foundation/tabel-opsional';

/**
 * Paket "bawa teman" (mis. Double Trouble Deal): pemilik paket boleh memasukkan dirinya sekali lagi
 * ke kelas yang sama sebagai kursi untuk temannya, yang tidak perlu menjadi member. Kursi teman
 * memakai satu sesi paket pemiliknya seperti booking biasa. Paket lain tetap tidak boleh ganda.
 *
 * Disimpan di tabel terpisah (`paket_bawa_teman`, `booking_teman`) supaya tabel lama tidak berubah.
 */
type Db = {
  paketBawaTeman?: {
    findMany(args: unknown): Promise<{ packageId: string; maksTeman: number }[]>;
  };
  bookingTeman?: {
    findMany(args: unknown): Promise<{ bookingId: string; namaTeman: string | null }[]>;
  };
};

/** Jumlah kursi teman per paket (0 bila paket tidak dicentang). */
export async function maksTemanPaket(
  db: Db,
  packageIds: readonly (string | null | undefined)[],
): Promise<Map<string, number>> {
  const ids = [...new Set(packageIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length || typeof db.paketBawaTeman?.findMany !== 'function') return new Map();
  const rows = await bacaOpsional(
    'paket_bawa_teman',
    () => db.paketBawaTeman!.findMany({ where: { packageId: { in: ids } } }),
    [],
  );
  return new Map(rows.map((r) => [r.packageId, r.maksTeman]));
}

/** Booking yang merupakan kursi teman, beserta nama temannya bila dicatat. */
export async function bookingTeman(
  db: Db,
  bookingIds: readonly string[],
): Promise<Map<string, string | null>> {
  if (!bookingIds.length || typeof db.bookingTeman?.findMany !== 'function') return new Map();
  const rows = await bacaOpsional(
    'booking_teman',
    () => db.bookingTeman!.findMany({ where: { bookingId: { in: [...bookingIds] } } }),
    [],
  );
  return new Map(rows.map((r) => [r.bookingId, r.namaTeman]));
}
