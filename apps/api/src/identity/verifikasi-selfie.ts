import type { Prisma } from '@prisma/client';

/**
 * Verifikasi member cukup dengan foto selfie; KTP tidak diminta lagi.
 *
 * - Punya selfie: terverifikasi, boleh membeli paket dan booking. Staf mengenali wajahnya di meja
 *   check-in dari foto ini.
 * - Belum punya selfie: wajib mengambilnya dulu.
 * - Foto ditolak staf (buram, bukan wajah): fotonya dihapus, jadi kembali "belum punya selfie",
 *   dengan alasan penolakan terakhir ditampilkan.
 *
 * Tidak ada lagi antrean "menunggu persetujuan": status PENDING tidak pernah muncul untuk akun baru.
 */

export type StatusSelfie = 'APPROVED' | 'ACTION_REQUIRED' | 'REJECTED';

type ProfilSelfie = { selfieUrl?: string | null; notes?: string | null } | null | undefined;

/** Penanda keputusan terakhir di catatan profil, mis. `KYC_REJECTED: FOTO_BURAM`. */
function keputusanTerakhir(notes: string | null | undefined): 'APPROVED' | 'REJECTED' | null {
  if (!notes) return null;
  const semua = [...notes.matchAll(/KYC_(APPROVED|REJECTED)\b/gu)];
  const akhir = semua.at(-1)?.[1];
  return akhir === 'APPROVED' || akhir === 'REJECTED' ? akhir : null;
}

export function statusSelfie(profile: ProfilSelfie): StatusSelfie {
  if (profile?.selfieUrl) return 'APPROVED';
  return keputusanTerakhir(profile?.notes) === 'REJECTED' ? 'REJECTED' : 'ACTION_REQUIRED';
}

export function punyaSelfie(profile: ProfilSelfie): boolean {
  return Boolean(profile?.selfieUrl);
}

/** Alasan penolakan terakhir, untuk ditampilkan ke member saat diminta foto ulang. */
export function alasanPenolakanSelfie(notes: string | null | undefined): string | null {
  if (keputusanTerakhir(notes) !== 'REJECTED' || !notes) return null;
  const cocok = [...notes.matchAll(/KYC_REJECTED: ([^|(]+)/gu)].at(-1);
  return cocok?.[1]?.trim() || null;
}

/** Filter Prisma yang setara dengan `statusSelfie`. */
export function filterStatusSelfie(
  status: 'APPROVED' | 'PENDING' | 'ACTION_REQUIRED' | 'REJECTED',
): Prisma.UserWhereInput {
  if (status === 'APPROVED') return { profile: { selfieUrl: { not: null } } };
  // Tidak ada lagi yang menunggu persetujuan.
  if (status === 'PENDING') return { id: { in: [] } };
  return { OR: [{ profile: null }, { profile: { selfieUrl: null } }] };
}
