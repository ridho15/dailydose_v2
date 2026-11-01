'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  browserSessionClient,
  clearSessionHint,
  hasSessionHint,
  sessionFailure,
  setSessionHint,
  type SessionClient,
  type SessionStatus,
  type WebSession,
} from '@/api-clients/session-client';
import { Feedback, Skeleton } from './ui';
import {
  internalStaffRoles,
  isCustomerOnlySession,
  isInstructorOnlySession,
  isPublicExperiencePath,
} from '@/lib/session-audience';
import { useOptionalAppFeedback } from './components/app-feedback';
import { useTrackedRouter } from './components/app-loading';
import { ActionGroup, Button, ButtonLink } from './components/actions';

const ACTIVE_BRANCH_KEY = 'dd_active_branch';
const anonymousEntryPaths = new Set([
  '/sign-in',
  '/register',
  '/activate-account',
  '/forgot-password',
  '/reset-password',
]);

const routeCapabilities: Array<[string, string[]]> = [
  ['/account/verification', ['customer:self']],
  ['/account/lengkapi', ['customer:self']],
  ['/account/profile', []],
  ['/account/settings', []],
  ['/account/security', []],
  ['/account', ['customer:self']],
  ['/identity-verifications', ['identity-verification:read']],
  ['/audit', ['audit:read']],
  ['/users/roles-permissions', ['user:admin']],
  ['/users', ['user:read']],
  ['/customers', ['customer:read']],
  ['/instructors', ['assignment:read']],
  ['/notification-management', ['notification:manage']],
  ['/notifications', []],
  ['/public-content-management', ['public-content:read']],
  ['/assignments', ['assignment:read']],
  ['/master', ['master:read']],
  ['/checkout', ['customer:self']],
  ['/orders', ['customer:self']],
  ['/account/packages', ['customer:self']],
  ['/workspace/payments', ['payment:review', 'purchase:review']],
  ['/workspace/reminders', ['automation:read']],
  ['/workspace/bookings', ['booking:read', 'reschedule:read']],
  ['/workspace/branches', ['master:read', 'master:manage']],
  ['/workspace/branch-performance', ['finance:read']],
  ['/workspace/packages', ['package-promotion:read', 'package-promotion:manage']],
  ['/workspace/vouchers', ['voucher:read', 'voucher:manage']],
  ['/purchases', ['package:read', 'payment:review', 'purchase:review']],
  ['/finance', ['finance:reconcile']],
  ['/ledger/adjustments', ['ledger:adjust:read']],
  ['/ledger', ['ledger:read']],
  ['/health', ['operations:read']],
  ['/workspace/classes/salin', ['class-slot:manage']],
  ['/workspace/classes/rutin', ['class-slot:manage']],
  ['/workspace/classes', ['class-slot:read']],
  ['/workspace/check-in', ['attendance:manage']],
  ['/workspace/antrean', ['payment:review', 'purchase:review', 'identity-verification:read', 'reschedule:read', 'package:read']],
  ['/workspace/renewal', ['package:read']],
  ['/workspace/kas', ['expense:create', 'finance:read']],
  ['/workspace/koreksi-jam', ['instructor:hours:adjust']],
  ['/workspace/ulasan', ['instructor-review:read']],
  ['/workspace/availability', ['availability:self:read']],
  ['/workspace/payroll', ['attendance:self']],
  ['/operations', ['operations:read']],
  ['/bookings', ['booking:self:read']],
  ['/help', []],
  ['/workspace/guide', []],
];

const protectedPathPrefixes = [
  '/workspace',
  '/account',
  '/checkout',
  '/orders',
  '/bookings',
  '/ledger',
  '/notifications',
  '/notification-management',
  '/assignments',
  '/master',
  '/purchases',
  '/finance',
  '/health',
  '/operations',
  '/public-content-management',
  '/package-promotions',
  '/identity-verifications',
  '/users',
  '/audit',
  '/vouchers',
  '/customers',
  '/instructors',
];

export function isRecognizedProtectedPath(pathname: string): boolean {
  return protectedPathPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

interface SessionContextValue {
  status: SessionStatus;
  session: WebSession | null;
  activeBranchId: string;
  activeBranch: WebSession['branches'][number] | null;
  setActiveBranchId(id: string): void;
  hasCapability(...required: string[]): boolean;
  refresh(options?: { quiet?: boolean }): Promise<WebSession | null>;
  completeSignIn(returnTo: string): Promise<boolean>;
  logout(): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/workspace';
  try {
    const url = new URL(value, 'http://local.invalid');
    if (url.origin !== 'http://local.invalid') return '/workspace';
    const forbidden = [
      '/sign-in',
      '/register',
      '/activate-account',
      '/forgot-password',
      '/reset-password',
    ];
    if (forbidden.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)))
      return '/workspace';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/workspace';
  }
}

/** Halaman melengkapi nomor WhatsApp dan selfie untuk akun yang mendaftar lewat Google. */
export const LENGKAPI_AKUN = '/account/lengkapi';

export function defaultSessionDestination(session: WebSession): string {
  if (session.passwordChangeRequired) return '/account/security?required=true';
  if (session.phoneRequired && isCustomerOnlySession(session)) return LENGKAPI_AKUN;
  if (isInstructorOnlySession(session)) return '/workspace';
  if (session.roles.some((role) => internalStaffRoles.has(role))) return '/workspace';
  if (session.roles.some((role) => role === 'CUSTOMER'))
    return '/account';
  return '/workspace';
}

export function forbiddenSessionDestination(session: WebSession, pathname: string): string {
  const customerOnly = isCustomerOnlySession(session);
  if (customerOnly && pathname.startsWith('/workspace/bookings'))
    return `/bookings${pathname.slice('/workspace/bookings'.length)}`;
  if (!customerOnly && (pathname === '/bookings' || pathname.startsWith('/bookings/')))
    return `/workspace/bookings${pathname.slice('/bookings'.length)}`;
  if (pathname === '/account/verification' && session.roles.some((role) => internalStaffRoles.has(role)))
    return session.capabilities.includes('identity-verification:read')
      ? '/identity-verifications'
      : '/workspace';
  return defaultSessionDestination(session);
}

export function canAccessSessionPath(session: WebSession, value: string): boolean {
  const path = new URL(value, 'http://local.invalid').pathname;
  if (isPublicExperiencePath(path)) return true;
  if (session.passwordChangeRequired) return path === '/account/security';
  const customerOnly = isCustomerOnlySession(session);
  // Nomor WhatsApp dulu; halaman publik tetap bisa dibuka.
  if (customerOnly && session.phoneRequired) return path === LENGKAPI_AKUN;
  if (!customerOnly && (path === '/bookings' || path.startsWith('/bookings/'))) return false;
  if (customerOnly && (path === '/workspace/bookings' || path.startsWith('/workspace/bookings/')))
    return false;
  if (customerOnly && path === '/ledger') return false;
  if (path === '/account/verification' && !customerOnly) return false;
  if (path === '/workspace')
    return session.roles.some((role) => internalStaffRoles.has(role));
  const rule = routeCapabilities.find(([route]) => path === route || path.startsWith(`${route}/`));
  if (!rule) return false;
  return rule[1].length === 0 || rule[1].some((cap) => session.capabilities.includes(cap));
}

export function resolveSessionDestination(
  session: WebSession,
  requestedReturnTo?: string | null,
): string {
  const fallback = defaultSessionDestination(session);
  if (!requestedReturnTo) return fallback;
  const safe = safeReturnTo(requestedReturnTo);
  if (safe === '/workspace' && requestedReturnTo !== '/workspace') return fallback;
  if (!canAccessSessionPath(session, safe)) return fallback;
  return safe;
}

export function SessionProvider({
  children,
  client = browserSessionClient,
}: {
  children: React.ReactNode;
  client?: SessionClient;
}) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const statusRef = useRef<SessionStatus>(status);
  statusRef.current = status;
  const [session, setSession] = useState<WebSession | null>(null);
  const [activeBranchId, setBranch] = useState('');
  const pathname = usePathname();
  const router = useTrackedRouter();
  const feedback = useOptionalAppFeedback();

  const setActiveBranchId = useCallback(
    (id: string) => {
      const valid = session?.branches.some((branch) => branch.id === id) ? id : '';
      setBranch(valid);
      if (valid) sessionStorage.setItem(ACTIVE_BRANCH_KEY, valid);
      else sessionStorage.removeItem(ACTIVE_BRANCH_KEY);
    },
    [session],
  );

  const refresh = useCallback(
    async (options?: { quiet?: boolean }) => {
      if (!options?.quiet) setStatus('loading');
      try {
        const current = await client.me();
        if (
          !Number.isFinite(current.sessionExpiresAt.getTime()) ||
          current.sessionExpiresAt <= new Date()
        ) {
          setSession(null);
          setStatus('expired');
          sessionStorage.removeItem(ACTIVE_BRANCH_KEY);
          return null;
        }
        setSession(current);
        const stored = sessionStorage.getItem(ACTIVE_BRANCH_KEY) ?? '';
        const defaultBranch =
          current.branches.length === 1 || isInstructorOnlySession(current)
            ? (current.branches[0]?.id ?? '')
            : '';
        setBranch(current.branches.some(({ id }) => id === stored) ? stored : defaultBranch);
        if (stored && !current.branches.some(({ id }) => id === stored))
          sessionStorage.removeItem(ACTIVE_BRANCH_KEY);
        setStatus('authenticated');
        return current;
      } catch (error) {
        setSession(null);
        setBranch('');
        sessionStorage.removeItem(ACTIVE_BRANCH_KEY);
        setStatus(sessionFailure(error));
        return null;
      }
    },
    [client],
  );

  useEffect(() => {
    if (anonymousEntryPaths.has(pathname)) {
      setStatus('unauthenticated');
      return;
    }
    if (statusRef.current === 'unauthenticated' && isPublicExperiencePath(pathname)) {
      return;
    }
    // Pengunjung anonim di halaman publik tidak perlu memanggil /me (hasilnya pasti 401 dan memenuhi konsol).
    // Tanda sesi diset saat masuk dan setelah /me berhasil; halaman terlindungi tetap selalu memeriksa server.
    if (isPublicExperiencePath(pathname) && !hasSessionHint()) {
      setSession(null);
      setStatus('unauthenticated');
      return;
    }
    void refresh();
  }, [pathname, refresh]);

  useEffect(() => {
    if (!session) return;
    const remaining = session.sessionExpiresAt.getTime() - Date.now();
    const timer = window.setTimeout(
      () => {
        void refresh();
      },
      Math.min(remaining, 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [refresh, session]);

  useEffect(() => {
    const revoked = () => {
      clearSessionHint();
      setSession(null);
      setBranch('');
      sessionStorage.removeItem(ACTIVE_BRANCH_KEY);
      setStatus('expired');
    };
    window.addEventListener('dd-session-revoked', revoked);
    return () => window.removeEventListener('dd-session-revoked', revoked);
  }, []);

  useEffect(() => {
    if (isPublicExperiencePath(pathname) || status === 'loading' || status === 'dependency-error')
      return;
    if (!isRecognizedProtectedPath(pathname)) return;
    if (status !== 'authenticated') {
      const returnTo = encodeURIComponent(
        `${pathname}${window.location.search}${window.location.hash}`,
      );
      router.replace(`/sign-in?returnTo=${returnTo}`);
    }
  }, [pathname, router, status]);

  const logout = useCallback(async () => {
    clearSessionHint();
    try {
      await client.logout();
    } catch {
      feedback?.showAlert({
        tone: 'danger',
        title: 'Keluar belum berhasil',
        message:
          'Sesi belum dapat ditutup dengan aman. Periksa koneksi lalu coba kembali sebelum meninggalkan perangkat ini.',
      });
      return;
    }
    setSession(null);
    setBranch('');
    sessionStorage.removeItem(ACTIVE_BRANCH_KEY);
    setStatus('unauthenticated');
    router.replace('/sign-in');
  }, [client, feedback, router]);

  const completeSignIn = useCallback(
    async (returnTo: string) => {
      setSessionHint();
      const current = await refresh();
      if (!current) return false;
      router.replace(resolveSessionDestination(current, returnTo));
      return true;
    },
    [refresh, router],
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      session,
      activeBranchId,
      activeBranch:
        session?.branches.find(({ id }) => id === activeBranchId) ??
        ((isInstructorOnlySession(session) || session?.branches.length === 1)
          ? (session?.branches[0] ?? null)
          : null),
      setActiveBranchId,
      hasCapability: (...required) =>
        required.some((capability) => session?.capabilities.includes(capability)),
      refresh,
      completeSignIn,
      logout,
    }),
    [activeBranchId, completeSignIn, logout, refresh, session, setActiveBranchId, status],
  );

  const required = routeCapabilities.find(
    ([route]) => pathname === route || pathname.startsWith(`${route}/`),
  )?.[1];
  const publicRoute = isPublicExperiencePath(pathname);
  const allowed = session ? canAccessSessionPath(session, pathname) : !required;
  const fallback = session ? forbiddenSessionDestination(session, pathname) : '/workspace';
  const staffVerificationRedirect = Boolean(
    session &&
    pathname === '/account/verification' &&
    session.roles.some((role) => internalStaffRoles.has(role)),
  );

  useEffect(() => {
    if (status === 'authenticated' && session && !publicRoute && !allowed) router.replace(fallback);
  }, [allowed, fallback, publicRoute, router, session, status]);

  const isProtected = isRecognizedProtectedPath(pathname);

  return (
    <SessionContext.Provider value={value}>
      {isProtected && status === 'loading' ? (
        <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
          <Skeleton label="Memuat sesi" />
        </main>
      ) : isProtected && status === 'dependency-error' ? (
        <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-10 sm:px-6">
          <Feedback kind="error">
            Konteks sesi tidak dapat dimuat. Layanan sedang mengalami gangguan sementara atau pembaruan sistem.
          </Feedback>
          <ActionGroup>
            <Button id="retry-session-load-btn" onClick={() => void refresh()}>Coba lagi</Button>
            <ButtonLink variant="secondary" href="/">
              Kunjungi situs utama
            </ButtonLink>
          </ActionGroup>
        </main>
      ) : !publicRoute && status === 'authenticated' && !allowed ? (
        <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-10 sm:px-6">
          <Feedback kind={staffVerificationRedirect ? 'info' : 'error'}>
            {staffVerificationRedirect
              ? 'Halaman verifikasi akun hanya untuk customer. Anda sedang diarahkan ke antrean reviewer.'
              : 'Anda tidak memiliki akses ke area ini.'}
          </Feedback>
          <ActionGroup>
            <ButtonLink href={fallback}>
              {staffVerificationRedirect ? 'Buka antrean verifikasi' : 'Kembali ke ringkasan'}
            </ButtonLink>
          </ActionGroup>
        </main>
      ) : isProtected && status !== 'authenticated' ? (
        <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
          <Skeleton label="Mengarahkan ke halaman masuk" />
        </main>
      ) : (
        children
      )}
    </SessionContext.Provider>
  );
}

export function useSessionContext() {
  return useContext(SessionContext);
}

export function useActiveBranchState(): [string, (id: string) => void] {
  const context = useSessionContext();
  const [localBranchId, setLocalBranchId] = useState('');
  return context
    ? [context.activeBranchId, context.setActiveBranchId]
    : [localBranchId, setLocalBranchId];
}
