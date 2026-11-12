import { HttpStatus } from '@nestjs/common';
import { bacaOpsional } from '../foundation/tabel-opsional';
import { ApiProblem } from '../identity/security';

/**
 * Masa jual paket: tanggal mulai dan berakhir paket dijual di katalog (field "Mulai berlaku" dan
 * "Berakhir" di form paket). Disimpan di `paket_masa_jual` supaya tabel `paket` tidak berubah;
 * dulu kedua field ini dikirim form tetapi dibuang server.
 */
export type MasaJual = { mulai: Date | null; berakhir: Date | null };

const TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

function tanggal(value: unknown, field: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '' || value === 'null' || value === 'undefined') return null;
  const teks = String(value).slice(0, 10);
  if (!TANGGAL.test(teks)) throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [{ field, issue: 'INVALID_DATE' }]);
  return new Date(`${teks}T00:00:00.000Z`);
}

/** Dari body form paket; field yang tidak dikirim dibiarkan (undefined). */
export function bacaMasaJual(body: any): { mulai?: Date | null; berakhir?: Date | null } {
  const mulai = tanggal(body?.effectiveFrom, 'effectiveFrom');
  const berakhir = tanggal(body?.effectiveUntil, 'effectiveUntil');
  if (mulai && berakhir && berakhir < mulai)
    throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
      { field: 'effectiveUntil', issue: 'BEFORE_FROM' },
    ]);
  return { ...(mulai !== undefined ? { mulai } : {}), ...(berakhir !== undefined ? { berakhir } : {}) };
}

export async function simpanMasaJual(
  tx: any,
  packageId: string,
  masa: { mulai?: Date | null; berakhir?: Date | null },
  actorId: string,
): Promise<{ mulai?: Date | null; berakhir?: Date | null }> {
  if ((masa.mulai === undefined && masa.berakhir === undefined) || typeof tx.paketMasaJual?.upsert !== 'function')
    return {};
  return bacaOpsional(
    'paket_masa_jual',
    async () => {
      await tx.paketMasaJual.upsert({
        where: { packageId },
        create: { packageId, mulai: masa.mulai ?? null, berakhir: masa.berakhir ?? null, updatedById: actorId },
        update: { ...masa, updatedById: actorId },
      });
      return masa;
    },
    {},
  );
}

export async function masaJualPaket(db: any, packageIds: readonly string[]): Promise<Map<string, MasaJual>> {
  const ids = [...new Set(packageIds.filter(Boolean))];
  if (!ids.length || typeof db?.paketMasaJual?.findMany !== 'function') return new Map();
  const rows = await bacaOpsional<Array<{ packageId: string; mulai: Date | null; berakhir: Date | null }>>(
    'paket_masa_jual',
    () => db.paketMasaJual.findMany({ where: { packageId: { in: ids } } }),
    [],
  );
  return new Map(rows.map((r) => [r.packageId, { mulai: r.mulai, berakhir: r.berakhir }]));
}

/** Tanggal hari ini di WIB, dalam bentuk tanggal UTC tengah malam (sama dengan kolom DATE). */
function hariIniWib(now: Date) {
  const wib = new Date(now.getTime() + 7 * 3_600_000);
  return new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate()));
}

/** Paket dijual hari ini: setelah tanggal mulai (bila ada) dan sampai tanggal berakhir (inklusif). */
export function sedangDijual(masa: MasaJual | undefined, now = new Date()): boolean {
  if (!masa) return true;
  const hari = hariIniWib(now).getTime();
  if (masa.mulai && hari < masa.mulai.getTime()) return false;
  if (masa.berakhir && hari > masa.berakhir.getTime()) return false;
  return true;
}
