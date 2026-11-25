import { bacaOpsional } from '../foundation/tabel-opsional';

type DbPetugas = { petugasCheckin?: { findUnique(args: unknown): Promise<{ branchId: string } | null> } };

/**
 * Cabang tempat akun ini bertugas sebagai Petugas Check-in, atau null bila bukan petugas.
 * Tabel belum dibuat berarti belum ada petugas (akunnya memang tidak bisa dibuat tanpa tabel itu);
 * galat database lain dilempar supaya login gagal, bukan diam-diam memberi akses Admin penuh.
 */
export async function cabangPetugasCheckin(db: DbPetugas, userId: string): Promise<string | null> {
  if (typeof db.petugasCheckin?.findUnique !== 'function') return null;
  const baris = await bacaOpsional(
    'petugas_checkin',
    () => db.petugasCheckin!.findUnique({ where: { userId }, select: { branchId: true } }),
    null,
  );
  return baris?.branchId ?? null;
}
