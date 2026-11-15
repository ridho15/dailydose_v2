/**
 * Masuk dengan Akun HR Group (SSO). Tombol hanya tampil bila API juga menyalakannya: syaratnya sama
 * dengan `hrGroupConfig` di apps/api/src/identity/hr-group.ts (web dan API berbagi env yang sama di
 * container). Dibaca di server saat permintaan, jadi tidak perlu build ulang untuk menyalakan/mematikan.
 */
const REQUIRED = ['HRG_ISSUER', 'HRG_CLIENT_ID', 'HRG_CLIENT_SECRET', 'HRG_REDIRECT_URI', 'HRG_BRIDGE_SECRET'] as const;

export function hrGroupEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.HRG_ENABLED?.trim() === 'true' && REQUIRED.every((key) => Boolean(env[key]?.trim()));
}

export function hrGroupStartHref(returnTo: string): string {
  return `/api/v1/auth/hr-group/start?returnTo=${encodeURIComponent(returnTo || '/workspace')}`;
}

/** Pesan untuk `?hrg_error=<kode>` dari callback API. */
const hrGroupErrors: Record<string, string> = {
  cancelled: 'Masuk dengan Akun HR Group dibatalkan.',
  state: 'Sesi masuk Akun HR Group sudah kedaluwarsa. Silakan coba lagi.',
  token: 'Akun HR Group tidak dapat diverifikasi. Silakan coba lagi.',
  ambiguous:
    'Hubungi admin, akun ganda: nomor atau email Akun HR Group Anda cocok dengan lebih dari satu akun Daily Dose.',
  inactive: 'Akun Daily Dose Anda tidak aktif. Hubungi admin studio.',
  server: 'Layanan Akun HR Group sedang tidak tersedia. Coba lagi nanti atau masuk dengan password.',
};

export function hrGroupErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return hrGroupErrors[code] ?? hrGroupErrors.server!;
}
