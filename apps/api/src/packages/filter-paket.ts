import { PackageStatus, Prisma } from '@prisma/client';
import { bacaOpsional } from '../foundation/tabel-opsional';

/** Filter daftar Kelola Paket; dipakai daftar per halaman dan "pilih semua hasil filter". */
export interface FilterPaket {
  status?: string;
  /** ACTIVE, SCHEDULED, EXPIRED, atau INACTIVE (status efektif di layar). */
  effectiveState?: string;
  branchId?: string;
  classTypeId?: string;
  /** 'true' = Bisa Dipakai Bersama, 'false' = Biasa (individu). */
  shareable?: string;
  q?: string;
}

/** Tanggal hari ini (WIB) sebagai tanggal UTC tengah malam, sama dengan kolom DATE `paket_masa_jual`. */
function hariIniWib(now: Date) {
  const wib = new Date(now.getTime() + 7 * 3_600_000);
  return new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate()));
}

/**
 * Paket yang masa jualnya belum mulai (terjadwal) atau sudah lewat (berakhir). Tabel
 * `paket_masa_jual` kecil (hanya paket yang punya tanggal), jadi dibaca utuh.
 */
async function idMasaJual(db: any, now: Date): Promise<{ terjadwal: string[]; berakhir: string[] }> {
  if (typeof db?.paketMasaJual?.findMany !== 'function') return { terjadwal: [], berakhir: [] };
  const hari = hariIniWib(now).getTime();
  const rows = await bacaOpsional<Array<{ packageId: string; mulai: Date | null; berakhir: Date | null }>>(
    'paket_masa_jual',
    () => db.paketMasaJual.findMany({ select: { packageId: true, mulai: true, berakhir: true } }),
    [],
  );
  return {
    terjadwal: rows.filter((r) => r.mulai && r.mulai.getTime() > hari).map((r) => r.packageId),
    berakhir: rows.filter((r) => r.berakhir && r.berakhir.getTime() < hari).map((r) => r.packageId),
  };
}

/**
 * `baseWhere`: semua filter kecuali status efektif (dipakai juga untuk angka ringkasan);
 * `where`: ditambah status efektif. Status efektif:
 * - ACTIVE: status ACTIVE dan sedang dalam masa jual;
 * - SCHEDULED / EXPIRED: masa jual belum mulai / sudah lewat (status apa pun selain nonaktif);
 * - INACTIVE: status INACTIVE atau ARCHIVED.
 */
export async function whereDaftarPaket(db: any, query: FilterPaket, now = new Date()) {
  const q = query.q?.trim();
  const and: Prisma.PaketWhereInput[] = [];
  if (query.classTypeId) and.push({ classTypeId: query.classTypeId });
  // Paket multi-cabang berlaku untuk semua cabang, jadi ikut tampil pada filter cabang mana pun.
  if (query.branchId)
    and.push({ OR: [{ branchId: query.branchId }, { isMultiBranch: true }, { branchId: null }] });
  if (query.shareable === 'true') and.push({ isShareable: true });
  if (query.shareable === 'false') and.push({ isShareable: false });
  if (q) and.push({ OR: [{ name: { contains: q } }, { code: { contains: q } }] });
  const baseWhere: Prisma.PaketWhereInput = and.length ? { AND: and } : {};

  const masa = await idMasaJual(db, now);
  const diLuarMasaJual = [...masa.terjadwal, ...masa.berakhir];
  const nonaktif = { status: { in: ['INACTIVE', 'ARCHIVED'] as PackageStatus[] } };
  const perStatus: Record<string, Prisma.PaketWhereInput> = {
    ACTIVE: { status: 'ACTIVE', ...(diLuarMasaJual.length ? { id: { notIn: diLuarMasaJual } } : {}) },
    SCHEDULED: { id: { in: masa.terjadwal }, NOT: nonaktif },
    EXPIRED: { id: { in: masa.berakhir }, NOT: nonaktif },
    INACTIVE: nonaktif,
  };
  const efektif = query.effectiveState ? perStatus[query.effectiveState] : undefined;
  const where: Prisma.PaketWhereInput = {
    AND: [
      baseWhere,
      ...(efektif ? [efektif] : []),
      ...(query.status ? [{ status: query.status as PackageStatus }] : []),
    ],
  };
  return { baseWhere, where, perStatus };
}
