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
  cancelled: 'HR Group sign-in was cancelled.',
  state: 'Your HR Group sign-in timed out. Please try again.',
  token: "We couldn't verify your HR Group account. Please try again.",
  ambiguous:
    'Your HR Group number or email matches more than one Daily Dose account. Please contact the studio so we can sort it out.',
  inactive: 'Your Daily Dose account is inactive. Please contact the studio.',
  server: 'HR Group sign-in is unavailable right now. Try again later, or sign in with your password.',
};

export function hrGroupErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return hrGroupErrors[code] ?? hrGroupErrors.server!;
}
