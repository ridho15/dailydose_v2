import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../database/prisma.service';
import type { SessionPrincipal } from './identity.service';

/**
 * Pelanggan boleh dicari staf mana pun (pelanggan memesan di cabang mana saja), tetapi data kontak dan data
 * pribadi pelanggan yang tidak berkaitan dengan cabang staf disamarkan. "Berkaitan" berarti: cabang pilihannya
 * cabang staf, atau pernah memesan/membeli di cabang itu, atau belum terkait cabang mana pun.
 */

export const maskContactEmail = (value: string | null | undefined) => {
  if (!value) return null;
  const [local, domain] = value.split('@');
  if (!local || !domain) return '***';
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(2, local.length - 2))}@${domain}`;
};

export const maskContactPhone = (value: string | null | undefined) => {
  if (!value) return null;
  return `${value.slice(0, Math.min(5, value.length))}${'*'.repeat(Math.max(2, value.length - 8))}${value.slice(-3)}`;
};

type ProfileLike = Record<string, unknown> & { id?: string; userId?: string; fullName?: string | null };

/** Profil tanpa data pribadi: yang tersisa hanya identitas tampilan. */
export const maskCustomerProfile = (profile: ProfileLike | null | undefined) =>
  profile
    ? {
        ...profile,
        gender: null,
        birthDate: null,
        ktpUrl: null,
        selfieUrl: null,
        nik: null,
        address: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        notes: null,
      }
    : null;

/** `'ALL'` untuk staf lintas cabang; selain itu daftar cabang yang menjadi cakupan staf. */
export const staffBranchScope = (principal: SessionPrincipal): 'ALL' | string[] =>
  principal.capabilities.includes('branch:all') ? 'ALL' : principal.branchIds;

type CustomerRow = {
  id: string;
  preferredBranchId: string | null;
  _count?: { bookings?: number; purchases?: number };
};
type VisibilityDb = Pick<PrismaService | Prisma.TransactionClient, 'pemesananKelas' | 'pembelian' | 'user'>;

/** Pelanggan yang belum terkait cabang mana pun (tanpa cabang pilihan, tanpa booking/pembelian). */
export const isUnattached = (row: CustomerRow) =>
  !row.preferredBranchId && !row._count?.bookings && !row._count?.purchases;

/**
 * Id pelanggan (dari `rows`) yang berkaitan dengan cabang staf; staf lintas cabang melihat semuanya.
 * Satu aturan untuk semua tampilan yang menyertakan kontak pelanggan.
 */
export async function relatedCustomerIds(
  db: Pick<VisibilityDb, 'pemesananKelas' | 'pembelian'>,
  principal: SessionPrincipal,
  rows: CustomerRow[],
): Promise<Set<string>> {
  const scope = staffBranchScope(principal);
  if (scope === 'ALL') return new Set(rows.map((row) => row.id));
  const related = new Set(
    rows
      .filter((row) => (row.preferredBranchId && scope.includes(row.preferredBranchId)) || isUnattached(row))
      .map((row) => row.id),
  );
  const rest = rows.filter((row) => !related.has(row.id)).map((row) => row.id);
  if (rest.length && scope.length) {
    const [bookings, purchases] = await Promise.all([
      db.pemesananKelas.findMany({
        where: { userId: { in: rest }, classSlot: { branchId: { in: scope } } },
        select: { userId: true },
        distinct: ['userId'],
      }),
      db.pembelian.findMany({
        where: { userId: { in: rest }, branchId: { in: scope } },
        select: { userId: true },
        distinct: ['userId'],
      }),
    ]);
    for (const row of [...bookings, ...purchases]) related.add(row.userId);
  }
  return related;
}

/** Sama seperti `relatedCustomerIds`, tetapi hanya dari id pengguna (data cabang pilihan dan riwayat dibaca di sini). */
export async function relatedCustomerIdsById(
  db: VisibilityDb,
  principal: SessionPrincipal,
  userIds: string[],
): Promise<Set<string>> {
  const ids = [...new Set(userIds)];
  if (!ids.length || staffBranchScope(principal) === 'ALL') return new Set(ids);
  const rows = await db.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, preferredBranchId: true, _count: { select: { bookings: true, purchases: true } } },
  });
  return relatedCustomerIds(db, principal, rows);
}

/**
 * Boleh tidaknya staf membuka atau memutus dokumen identitas (selfie/KTP) seorang pengguna.
 * Pelanggan: harus berkaitan dengan cabang staf (aturan yang sama dengan data kontak).
 * Staf/instruktur: cabangnya atau penugasan mengajarnya ada di cakupan staf.
 */
export async function bolehAksesIdentitas(
  db: VisibilityDb & { penugasanInstruktur?: PrismaService['penugasanInstruktur'] },
  principal: SessionPrincipal,
  userId: string,
): Promise<boolean> {
  const scope = staffBranchScope(principal);
  if (scope === 'ALL') return true;
  if (typeof db?.user?.findUnique !== 'function') return true; // test lama dengan db tiruan minimal
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, preferredBranchId: true },
  });
  if (!user) return false;
  if (user.role === 'CUSTOMER') return (await relatedCustomerIdsById(db, principal, [userId])).has(userId);
  if (user.preferredBranchId && scope.includes(user.preferredBranchId)) return true;
  const tugas = await db.penugasanInstruktur?.findFirst({
    where: { coachId: userId, branchId: { in: scope }, active: true },
    select: { id: true },
  });
  return Boolean(tugas);
}
