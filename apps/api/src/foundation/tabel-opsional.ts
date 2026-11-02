import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Tabel tambahan (dibuat manual lewat SQL di docs/DEPLOY.md, bukan `db push`) bisa belum ada di
 * server yang sudah menjalankan kode terbarunya. Pembacaan dari tabel seperti itu tidak boleh
 * menjatuhkan layar utama (daftar peserta, booking, daftar paket): fitur tambahannya dianggap
 * kosong dan peringatan ditulis ke log sekali per tabel, supaya admin tetap bisa bekerja sambil
 * tabelnya dibuat.
 */
const logger = new Logger('TabelOpsional');
const sudahDiperingatkan = new Set<string>();

/** Galat Prisma karena tabel (P2021) atau kolom (P2022) belum ada di database. */
export function tabelBelumAda(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2021' || error.code === 'P2022')
  );
}

/** Menjalankan pembacaan dari tabel tambahan; bila tabelnya belum ada, kembalikan `cadangan`. */
export async function bacaOpsional<T>(
  tabel: string,
  baca: () => Promise<T>,
  cadangan: T,
): Promise<T> {
  try {
    return await baca();
  } catch (error) {
    if (!tabelBelumAda(error)) throw error;
    if (!sudahDiperingatkan.has(tabel)) {
      sudahDiperingatkan.add(tabel);
      logger.warn(
        `Tabel ${tabel} belum ada di database; fiturnya dimatikan sementara. Buat tabelnya dengan SQL di docs/DEPLOY.md.`,
      );
    }
    return cadangan;
  }
}
