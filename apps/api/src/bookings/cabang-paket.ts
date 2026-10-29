/**
 * Cabang tempat paket member boleh dipakai.
 *
 * Paket multi-cabang berlaku di semua cabang. Selain itu, paket berlaku di cabang paketnya dan di
 * cabang tempat paket itu dibeli. Yang kedua penting untuk data V1: paket yang dulu berlaku di
 * beberapa lokasi dipindahkan sebagai paket satu cabang (lokasi pertama), sehingga member yang
 * membelinya di cabang lain tetap harus bisa booking di cabang pembeliannya.
 */
export type CabangPaket = 'SEMUA' | string[];

export function cabangPaket(cp: {
  package?: { isMultiBranch?: boolean | null; branchId?: string | null } | null;
  purchase?: { branchId?: string | null } | null;
}): CabangPaket {
  if (cp.package?.isMultiBranch) return 'SEMUA';
  const cabang = [cp.package?.branchId, cp.purchase?.branchId].filter((id): id is string =>
    Boolean(id),
  );
  return cabang.length ? [...new Set(cabang)] : 'SEMUA';
}

export function paketBerlakuDi(cp: Parameters<typeof cabangPaket>[0], branchId: string): boolean {
  const cabang = cabangPaket(cp);
  return cabang === 'SEMUA' || cabang.includes(branchId);
}
