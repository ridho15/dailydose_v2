import { paketBerlakuDi, type CabangPaket } from './cabang-paket';

export type AlasanPaketDitolak =
  | 'PURCHASE_NOT_PAID'
  | 'PACKAGE_NOT_ACTIVE'
  | 'PACKAGE_EXPIRED_FOR_SLOT'
  | 'PACKAGE_BRANCH_MISMATCH'
  | 'PACKAGE_CLASS_TYPE_MISMATCH';

type PaketUntukSlot = {
  status: string;
  validUntil: Date;
  purchaseId?: string | null;
  purchase?: { status: string; branchId?: string | null } | null;
  package?: {
    classTypeId?: string | null;
    isMultiBranch?: boolean | null;
    branchId?: string | null;
  } | null;
};

/**
 * Satu-satunya aturan "paket ini boleh dipakai untuk kelas ini" selain sisa sesi dan hak milik.
 * Dipakai booking, pilihan booking member, dan walk-in supaya hasilnya tidak berbeda.
 * Urutan pengecekan menentukan kode yang dikembalikan.
 */
export function alasanPaketDitolak(
  cp: PaketUntukSlot,
  slot: { startAt: Date; branchId: string; classTypeId: string },
): AlasanPaketDitolak | null {
  if ((cp.purchase || cp.purchaseId) && cp.purchase?.status !== 'PAID') return 'PURCHASE_NOT_PAID';
  if (cp.status !== 'ACTIVE') return 'PACKAGE_NOT_ACTIVE';
  // Paket harus masih berlaku saat kelasnya dimulai, bukan hanya hari ini.
  if (cp.validUntil <= slot.startAt) return 'PACKAGE_EXPIRED_FOR_SLOT';
  if (!paketBerlakuDi(cp, slot.branchId)) return 'PACKAGE_BRANCH_MISMATCH';
  if (cp.package?.classTypeId && cp.package.classTypeId !== slot.classTypeId)
    return 'PACKAGE_CLASS_TYPE_MISMATCH';
  return null;
}

export type { CabangPaket };
