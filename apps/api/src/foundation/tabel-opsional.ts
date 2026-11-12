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

const tabelDiketahuiAda = new Set<string>();
const terakhirDicek = new Map<string, number>();

/**
 * Untuk PENULISAN ke tabel tambahan di tengah transaksi: cek dulu tabelnya ada lewat
 * information_schema (selalu berhasil dan mendukung placeholder `?` di MySQL prepared statement,
 * berbeda dengan `SHOW TABLES LIKE ?` yang ditolak MySQL error 1064), supaya tidak ada perintah
 * gagal yang menjatuhkan seluruh transaksi utama (mis. membuat atau merevisi paket).
 * "Ada" disimpan selamanya; "belum ada" dicek ulang tiap 5 menit.
 */
export async function tabelOpsionalAda(db: unknown, tabel: string): Promise<boolean> {
  if (tabelDiketahuiAda.has(tabel)) return true;
  const exec = (db as { $queryRawUnsafe?: (sql: string, ...v: unknown[]) => Promise<unknown> })?.$queryRawUnsafe;
  if (typeof exec !== 'function') return true; // db tiruan di test
  const dicek = terakhirDicek.get(tabel) ?? 0;
  if (Date.now() - dicek < 300_000) return false;
  terakhirDicek.set(tabel, Date.now());
  const rows = await exec.call(
    db,
    'SELECT 1 AS ada FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1',
    tabel,
  );
  const ada = Array.isArray(rows) && rows.length > 0;
  if (ada) tabelDiketahuiAda.add(tabel);
  else if (!sudahDiperingatkan.has(tabel)) {
    sudahDiperingatkan.add(tabel);
    logger.warn(`Tabel ${tabel} belum ada di database; penulisannya dilewati. Buat tabelnya dengan SQL di docs/DEPLOY.md.`);
  }
  return ada;
}
