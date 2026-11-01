import type { WebSession } from '@/api-clients/session-client';

export type PackageAudienceState = 'GUEST' | 'CUSTOMER_UNVERIFIED' | 'CUSTOMER_APPROVED' | 'STAFF';

const publicRoutePrefixes = ['/classes', '/packages', '/schedule', '/locations', '/check-in'] as const;

export function isPublicExperiencePath(pathname: string) {
  return (
    [
      '/',
      '/contact',
      '/sign-in',
      '/register',
      '/activate-account',
      '/forgot-password',
      '/reset-password',
      '/check-in-pass',
      '/guide',
      '/help',
      '/terms',
      '/privacy',
    ].includes(pathname) ||
    publicRoutePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  );
}

export function isCustomerCatalogPath(pathname: string) {
  return (
    pathname === '/check-in-pass' ||
    pathname.startsWith('/check-in-pass/') ||
    publicRoutePrefixes.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  );
}

export const internalStaffRoles = new Set([
  'SUPER_OWNER',
  'OWNER',
  'ADMIN',
  'MANAGER',
  'FINANCE',
  'INSTRUCTOR',
]);

export function isCustomerOnlySession(session: WebSession | null | undefined): boolean {
  if (!session || !session.roles || session.roles.length === 0) return false;
  const hasStaffRole = session.roles.some((role) => internalStaffRoles.has(role));
  if (hasStaffRole) return false;
  return session.roles.some((role) => role === 'CUSTOMER');
}

/** True bila semua peran yang dipegang adalah ADMIN (petugas meja depan cabang). */
export function isFrontDeskOnlySession(session: WebSession | null | undefined): boolean {
  if (!session || !session.roles || session.roles.length === 0) return false;
  return session.roles.every((role) => role === 'ADMIN');
}

/** True only when every role held is INSTRUCTOR — a dual role (e.g. + ADMIN) keeps full access. */
export function isInstructorOnlySession(session: WebSession | null | undefined): boolean {
  if (!session || !session.roles || session.roles.length === 0) return false;
  return session.roles.every((role) => role === 'INSTRUCTOR');
}

export function packageAudienceState(session: WebSession | null | undefined): PackageAudienceState {
  if (!session) return 'GUEST';
  if (!isCustomerOnlySession(session)) return 'STAFF';
  return 'CUSTOMER_APPROVED';
}
