import { HttpStatus } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { bacaOpsional, tabelOpsionalAda } from '../foundation/tabel-opsional';
import { ApiProblem } from './security';

/**
 * Versi Syarat & Ketentuan yang berlaku. Harus sama dengan `VERSI_SYARAT` di
 * apps/web/app/lib/syarat-ketentuan.ts. Menaikkan versi membuat member diminta menyetujui ulang
 * pada kunjungan berikutnya (lewat halaman Lengkapi akun) sebelum bisa membeli atau booking.
 */
export const VERSI_SYARAT = '2026-11-25';

/** PROMO dan DOKUMENTASI adalah persetujuan pilihan (Pasal 14): hanya dicatat bila member mencentangnya. */
export type JenisPersetujuan = 'DAFTAR' | 'PEMBELIAN' | 'PEMBELIAN_STAF' | 'PROMO' | 'DOKUMENTASI';

type Db = {
  persetujuanSyarat?: {
    create(args: unknown): Promise<unknown>;
    findFirst(args: unknown): Promise<unknown>;
  };
};

/** Nilai centang dari JSON atau multipart: hanya `true`/"true" yang dianggap setuju. */
export function setuju(nilai: unknown): boolean {
  return nilai === true || nilai === 'true';
}

/** Tolak permintaan tanpa centang persetujuan (422 dengan field yang jelas untuk formulir). */
export function wajibSetuju(nilai: unknown, field: string): void {
  if (!setuju(nilai))
    throw new ApiProblem('TERMS_CONSENT_REQUIRED', HttpStatus.UNPROCESSABLE_ENTITY, false, [
      { field, issue: 'REQUIRED' },
    ]);
}

/**
 * Catat persetujuan. `db` boleh berupa klien transaksi. Bila tabelnya belum dibuat, pencatatan
 * dilewati (alur utama tidak boleh gagal), dengan peringatan di log dari `tabelOpsionalAda`.
 */
export async function catatPersetujuan(
  db: Db,
  cek: unknown,
  data: { userId: string; jenis: JenisPersetujuan; purchaseId?: string | null; dicatatOleh?: string | null; userAgent?: string | null },
): Promise<boolean> {
  if (typeof db.persetujuanSyarat?.create !== 'function') return false;
  if (!(await tabelOpsionalAda(cek, 'persetujuan_syarat'))) return false;
  await db.persetujuanSyarat.create({
    data: {
      id: randomUUID(),
      userId: data.userId,
      jenis: data.jenis,
      versi: VERSI_SYARAT,
      purchaseId: data.purchaseId ?? null,
      dicatatOleh: data.dicatatOleh ?? null,
      userAgent: data.userAgent ? data.userAgent.slice(0, 255) : null,
    },
  });
  return true;
}

/**
 * Sudahkah member menyetujui versi yang berlaku (lewat pendaftaran atau layar persetujuan)?
 * Tabel belum ada dianggap sudah setuju, supaya member tidak terkunci di layar persetujuan yang
 * tidak bisa disimpan.
 */
export async function sudahSetujuVersiIni(db: Db, userId: string): Promise<boolean> {
  if (typeof db.persetujuanSyarat?.findFirst !== 'function') return true;
  const ada = await bacaOpsional(
    'persetujuan_syarat',
    () =>
      db.persetujuanSyarat!.findFirst({
        where: { userId, jenis: 'DAFTAR', versi: VERSI_SYARAT },
        select: { id: true },
      }),
    { id: 'tabel-belum-ada' },
  );
  return Boolean(ada);
}
