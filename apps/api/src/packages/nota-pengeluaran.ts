import { HttpStatus } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { bacaOpsional, tabelOpsionalAda } from '../foundation/tabel-opsional';
import type { PrivateFileStorage } from '../identity/private-file-storage';
import { ApiProblem } from '../identity/security';
import { JENIS_BUKTI, kenaliBukti } from './penyesuaian-bukti.service';

/**
 * Nota pengeluaran (keputusan pemilik 26 November 2026): setiap pengeluaran cabang wajib disertai foto
 * atau PDF nota, termasuk pembelian stok minuman. Berkas disimpan di penyimpanan privat dengan kunci
 * dari id `other_cost`; tabel tambahan `nota_pengeluaran` mencatat pengeluaran mana yang punya nota
 * supaya daftar Jurnal kas tidak perlu memeriksa penyimpanan satu per satu. Pengeluaran lama tanpa
 * nota tetap tampil dengan tanda "Tanpa nota".
 */
export const MAKS_NOTA_BYTE = 8_000_000;
export type BerkasNota = { buffer?: Buffer; size?: number } | undefined;

type Db = {
  notaPengeluaran?: {
    create(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<Array<{ otherCostId: string }>>;
    findUnique(args: unknown): Promise<{ storageKey: string; mimeType: string } | null>;
  };
};

export const kunciNota = (otherCostId: string, ext: string) => `expense-receipts/${otherCostId}.${ext}`;

/** Wajib ada, maksimal 8 MB, JPG/PNG/WEBP/PDF (dikenali dari byte awal, bukan nama berkas). */
export function periksaNota(berkas: BerkasNota) {
  if (!berkas?.buffer || berkas.buffer.length === 0)
    throw new ApiProblem('RECEIPT_REQUIRED', HttpStatus.UNPROCESSABLE_ENTITY, false, [{ field: 'nota', issue: 'REQUIRED' }]);
  if (berkas.buffer.length > MAKS_NOTA_BYTE)
    throw new ApiProblem('UPLOAD_REJECTED', HttpStatus.PAYLOAD_TOO_LARGE, false, [{ field: 'nota', issue: 'TOO_LARGE' }]);
  const jenis = kenaliBukti(berkas.buffer);
  if (!jenis)
    throw new ApiProblem('UPLOAD_REJECTED', HttpStatus.UNPROCESSABLE_ENTITY, false, [{ field: 'nota', issue: 'UNSUPPORTED_TYPE' }]);
  return { buffer: berkas.buffer, jenis };
}

/** Simpan berkas nota lebih dulu; kembalikan fungsi hapus bila pencatatan pengeluaran gagal. */
export async function simpanBerkasNota(
  storage: PrivateFileStorage | undefined,
  otherCostId: string,
  nota: ReturnType<typeof periksaNota>,
): Promise<() => Promise<void>> {
  if (!storage) throw new ApiProblem('STORAGE_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE, true);
  const kunci = kunciNota(otherCostId, nota.jenis.ext);
  await storage.put({ key: kunci, content: nota.buffer });
  return () => storage.delete(kunci).catch(() => undefined);
}

/** Catat penanda nota; dilewati bila tabelnya belum dibuat (berkas tetap tersimpan dan bisa dibuka). */
export async function catatNota(
  db: Db,
  cek: unknown,
  data: { otherCostId: string; ext: string; mimeType: string; ukuranByte: number; diunggahOleh: string | null },
) {
  if (typeof db.notaPengeluaran?.create !== 'function') return;
  if (!(await tabelOpsionalAda(cek, 'nota_pengeluaran'))) return;
  await db.notaPengeluaran.create({
    data: {
      otherCostId: data.otherCostId,
      storageKey: kunciNota(data.otherCostId, data.ext),
      mimeType: data.mimeType,
      ukuranByte: data.ukuranByte,
      diunggahOleh: data.diunggahOleh,
    },
  });
}

/** Id pengeluaran yang punya nota, untuk tanda di daftar. */
export async function idDenganNota(db: Db, ids: string[]): Promise<Set<string>> {
  if (!ids.length || typeof db.notaPengeluaran?.findMany !== 'function') return new Set();
  const rows = await bacaOpsional(
    'nota_pengeluaran',
    () => db.notaPengeluaran!.findMany({ where: { otherCostId: { in: ids } }, select: { otherCostId: true } }),
    [],
  );
  return new Set(rows.map((r) => r.otherCostId));
}

/** Buka berkas nota; cari dari penanda, lalu (tabel belum ada) coba setiap jenis berkas. */
export async function bacaNota(
  storage: PrivateFileStorage | undefined,
  db: Db,
  otherCostId: string,
): Promise<{ mimeType: string; stream: Readable }> {
  const tidakAda = () => new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
  if (!storage) throw tidakAda();
  const penanda =
    typeof db.notaPengeluaran?.findUnique === 'function'
      ? await bacaOpsional('nota_pengeluaran', () => db.notaPengeluaran!.findUnique({ where: { otherCostId } }), null)
      : null;
  if (penanda) return { mimeType: penanda.mimeType, stream: await storage.read(penanda.storageKey) };
  for (const jenis of JENIS_BUKTI) {
    const kunci = kunciNota(otherCostId, jenis.ext);
    if (await storage.exists(kunci).catch(() => false)) return { mimeType: jenis.mime, stream: await storage.read(kunci) };
  }
  throw tidakAda();
}
