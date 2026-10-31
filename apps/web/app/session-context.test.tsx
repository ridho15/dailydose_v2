import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationShell } from './application-shell';
import { Dashboard } from './dashboard';
import { PublicHeader } from './components/public/public-header';
import { AppFeedbackProvider } from './components/app-feedback';
import {
  defaultSessionDestination,
  forbiddenSessionDestination,
  canAccessSessionPath,
  resolveSessionDestination,
  safeReturnTo,
  SessionProvider,
  useSessionContext,
} from './session-context';
import { setSessionHint, type SessionClient, type WebSession } from '@/api-clients/session-client';
import type { ClassSlotClient } from '@/api-clients/class-slot-client';
import type { AvailabilityClient } from '@/api-clients/availability-client';

const navigation = vi.hoisted(() => ({ pathname: '/workspace', replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(),
}));

const adminSession: WebSession = {
  id: 'user-1',
  displayName: 'Admin Jakarta',
  roles: ['ADMIN'],
  branchIds: ['branch-1', 'branch-2'],
  capabilities: ['user:read', 'ledger:read', 'booking:read'],
  sessionExpiresAt: new Date(Date.now() + 60_000),
  branches: [
    { id: 'branch-1', code: 'JKT', name: 'Jakarta', timezone: 'Asia/Jakarta' },
    { id: 'branch-2', code: 'BDG', name: 'Bandung', timezone: 'Asia/Jakarta' },
  ],
};

const instructorSession: WebSession = {
  id: 'instructor-1',
  displayName: 'Coach Sarah',
  roles: ['INSTRUCTOR'],
  branchIds: ['branch-1'],
  capabilities: ['class:assigned:read', 'attendance:self', 'class-slot:read'],
  sessionExpiresAt: new Date(Date.now() + 60_000),
  branches: [{ id: 'branch-1', code: 'JKT', name: 'Jakarta', timezone: 'Asia/Jakarta' }],
};

const customerSession: WebSession = {
  id: 'customer-1',
  displayName: 'Nadia Customer',
  roles: ['CUSTOMER'],
  branchIds: [],
  capabilities: [
    'customer:self',
    'package:read',
    'ledger:read',
    'class-slot:read',
    'booking:self:read',
    'booking:self:create',
  ],
  identityVerificationStatus: 'PENDING',
  sessionExpiresAt: new Date(Date.now() + 60_000),
  branches: [],
};

function ContextProbe() {
  const context = useSessionContext();
  return <output>{context?.activeBranch?.name ?? 'Belum dipilih'}</output>;
}

describe('capability-aware session shell', () => {
  beforeEach(() => {
    navigation.pathname = '/workspace';
    navigation.replace.mockReset();
    if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
    if (typeof localStorage !== 'undefined') localStorage.clear();
  });

  it('loads authoritative context, filters navigation and requires explicit branch selection', async () => {
    const client: SessionClient = { me: vi.fn().mockResolvedValue(adminSession), logout: vi.fn() };
    render(
      <SessionProvider client={client}>
        <ApplicationShell>
          <ContextProbe />
        </ApplicationShell>
      </SessionProvider>,
    );
    expect(screen.getByRole('status', { name: 'Memuat sesi' })).toBeInTheDocument();
    expect(await screen.findByText('Admin Jakarta')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Member & Paket' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Evaluasi kuota H-24' })).not.toBeInTheDocument();
    const branchSelect = screen.getByRole('combobox', { name: 'Cabang aktif' });
    expect(branchSelect).toHaveValue('');
    await userEvent.click(branchSelect);
    const listbox = await screen.findByRole('listbox');
    await userEvent.click(within(listbox).getByRole('option', { name: /Bandung/ }));
    expect(screen.getAllByText('Bandung').length).toBeGreaterThan(0);
    expect(sessionStorage.getItem('dd_active_branch')).toBe('branch-2');

    fireEvent.click(screen.getByRole('button', { name: 'Notifikasi' }));
    expect(screen.getByRole('region', { name: 'Pusat notifikasi' })).toBeVisible();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Pusat notifikasi' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Menu profil Admin Jakarta' }));
    expect(screen.getByRole('region', { name: 'Menu akun internal' })).toBeVisible();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('region', { name: 'Menu akun internal' })).not.toBeInTheDocument();
  });

  it('shows package promotions and vouchers for a database-authorized Super Owner', async () => {
    const user = userEvent.setup();
    navigation.pathname = '/workspace/payments';
    const superOwnerSession: WebSession = {
      ...adminSession,
      id: 'super-owner-1',
      displayName: 'Super Owner Daily Dose',
      roles: ['SUPER_OWNER'],
      branchIds: [],
      branches: [],
      capabilities: [
        'branch:all',
        'payment:review',
        'package-promotion:read',
        'package-promotion:manage',
        'voucher:read',
        'voucher:manage',
      ],
    };
    const client: SessionClient = {
      me: vi.fn().mockResolvedValue(superOwnerSession),
      logout: vi.fn(),
    };

    render(
      <SessionProvider client={client}>
        <ApplicationShell>
          <div>Antrean pembayaran</div>
        </ApplicationShell>
      </SessionProvider>,
    );

    const navigationRegion = await screen.findByRole('navigation', { name: 'Navigasi utama' });
    expect(within(navigationRegion).getByRole('link', { name: /^(Kelola )?Paket$/ })).toHaveAttribute(
      'href',
      '/workspace/packages',
    );
    expect(within(navigationRegion).getByRole('link', { name: 'Voucher' })).toHaveAttribute(
      'href',
      '/workspace/vouchers',
    );
    await user.keyboard('{Control>}k{/Control}');
    const commandSearch = await screen.findByRole('dialog', { name: 'Pencarian halaman' });
    expect(within(commandSearch).getByText('Kelola Paket & Promo')).toBeVisible();
    expect(within(commandSearch).getByText('Voucher & promo')).toBeVisible();
    expect(canAccessSessionPath(superOwnerSession, '/workspace/packages')).toBe(true);
    expect(canAccessSessionPath(superOwnerSession, '/workspace/vouchers')).toBe(true);
  });

  it('disables the branch selector on pages that cover every branch and keeps it on branch pages', async () => {
    const session: WebSession = {
      ...adminSession,
      capabilities: ['user:read', 'ledger:read', 'booking:read', 'customer:read', 'voucher:read'],
    };
    const client: SessionClient = { me: vi.fn().mockResolvedValue(session), logout: vi.fn() };

    navigation.pathname = '/workspace/vouchers';
    const view = render(
      <SessionProvider client={client}>
        <ApplicationShell>
          <div>Voucher</div>
        </ApplicationShell>
      </SessionProvider>,
    );
    expect(await screen.findByRole('combobox', { name: 'Cabang aktif' })).toBeDisabled();
    view.unmount();

    navigation.pathname = '/workspace/bookings';
    render(
      <SessionProvider client={client}>
        <ApplicationShell>
          <div>Booking</div>
        </ApplicationShell>
      </SessionProvider>,
    );
    expect(await screen.findByRole('combobox', { name: 'Cabang aktif' })).toBeEnabled();
  });

  it('shows Daily Dose › page in the breadcrumb and links back from a detail page', async () => {
    const session: WebSession = { ...adminSession, capabilities: ['customer:read'] };
    const client: SessionClient = { me: vi.fn().mockResolvedValue(session), logout: vi.fn() };
    navigation.pathname = '/customers/abc-123';
    render(
      <SessionProvider client={client}>
        <ApplicationShell>
          <div>Detail pelanggan</div>
        </ApplicationShell>
      </SessionProvider>,
    );
    const breadcrumb = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    // Bilah atas mengikuti mockup: "Daily Dose <halaman>", tanpa nama kelompok menu.
    expect(breadcrumb).toHaveTextContent('Daily Dose');
    expect(within(breadcrumb).getByRole('link', { name: 'Member & Paket' })).toHaveAttribute(
      'href',
      '/customers',
    );
    expect(breadcrumb).toHaveTextContent('Detail');
  });

  it('sends a member without a WhatsApp number to complete the account first', () => {
    const tanpaNomor: WebSession = { ...customerSession, phoneRequired: true };
    expect(defaultSessionDestination(tanpaNomor)).toBe('/account/lengkapi');
    expect(canAccessSessionPath(tanpaNomor, '/account/lengkapi')).toBe(true);
    expect(canAccessSessionPath(tanpaNomor, '/account')).toBe(false);
    expect(canAccessSessionPath(tanpaNomor, '/checkout')).toBe(false);
    expect(canAccessSessionPath(tanpaNomor, '/packages')).toBe(true);
    expect(defaultSessionDestination(customerSession)).toBe('/account');
    expect(canAccessSessionPath(customerSession, '/account/lengkapi')).toBe(true);
  });

  it('keeps the WhatsApp automation route capability-scoped instead of closed for everyone', () => {
    expect(canAccessSessionPath(adminSession, '/workspace/reminders')).toBe(false);
    expect(
      canAccessSessionPath(
        { ...adminSession, capabilities: [...adminSession.capabilities, 'automation:read'] },
        '/workspace/reminders',
      ),
    ).toBe(true);
  });

  it('keeps voucher and promotion routes capability-scoped', () => {
    expect(canAccessSessionPath(adminSession, '/workspace/vouchers')).toBe(false);
    expect(canAccessSessionPath(adminSession, '/workspace/packages')).toBe(false);
    expect(
      canAccessSessionPath(
        { ...adminSession, roles: ['OWNER'], capabilities: ['voucher:read'] },
        '/workspace/vouchers',
      ),
    ).toBe(true);
    expect(
      canAccessSessionPath(
        { ...adminSession, roles: ['OWNER'], capabilities: ['package-promotion:read'] },
        '/workspace/packages',
      ),
    ).toBe(true);
  });

  it('keeps branch management and its detail route capability-scoped', () => {
    expect(canAccessSessionPath(adminSession, '/workspace/branches')).toBe(false);
    expect(
      canAccessSessionPath(
        { ...adminSession, capabilities: [...adminSession.capabilities, 'master:read'] },
        '/workspace/branches',
      ),
    ).toBe(true);
    expect(
      canAccessSessionPath(
        { ...adminSession, capabilities: [...adminSession.capabilities, 'master:manage'] },
        '/workspace/branches/branch-1',
      ),
    ).toBe(true);
  });

  it('clears an unauthorized stored branch and redirects a protected route on 401', async () => {
    navigation.pathname = '/ledger';
    sessionStorage.setItem('dd_active_branch', 'foreign');
    const client: SessionClient = {
      me: vi.fn().mockRejectedValue({ response: { status: 401 } }),
      logout: vi.fn(),
    };
    render(
      <SessionProvider client={client}>
        <div>Protected</div>
      </SessionProvider>,
    );
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith('/sign-in?returnTo=%2Fledger'),
    );
    expect(sessionStorage.getItem('dd_active_branch')).toBeNull();
    expect(screen.queryByText('Protected')).not.toBeInTheDocument();
  });

  it('does not call /me (and so never logs a 401) for an anonymous visitor on a public page', async () => {
    navigation.pathname = '/';
    const client: SessionClient = { me: vi.fn().mockRejectedValue({ response: { status: 401 } }), logout: vi.fn() };
    render(
      <SessionProvider client={client}>
        <PublicHeader />
      </SessionProvider>,
    );
    expect((await screen.findAllByRole('link', { name: /Masuk/ }))[0]).toBeVisible();
    expect(client.me).not.toHaveBeenCalled();
  });

  it('still asks the server on a public page when this browser has signed in before', async () => {
    navigation.pathname = '/';
    setSessionHint();
    const client: SessionClient = { me: vi.fn().mockResolvedValue(customerSession), logout: vi.fn() };
    render(
      <SessionProvider client={client}>
        <PublicHeader />
      </SessionProvider>,
    );
    await waitFor(() => expect(client.me).toHaveBeenCalled());
  });

  it('always checks the server on a protected page, even without a hint', async () => {
    navigation.pathname = '/workspace';
    const client: SessionClient = { me: vi.fn().mockResolvedValue(adminSession), logout: vi.fn() };
    render(
      <SessionProvider client={client}>
        <ContextProbe />
      </SessionProvider>,
    );
    await waitFor(() => expect(client.me).toHaveBeenCalled());
  });

  it('shows the not-found content instead of a stuck skeleton for a guest on an unknown URL', async () => {
    navigation.pathname = '/halaman-yang-tidak-ada';
    const client: SessionClient = {
      me: vi.fn().mockRejectedValue({ response: { status: 401 } }),
      logout: vi.fn(),
    };
    render(
      <SessionProvider client={client}>
        <ApplicationShell>
          <div>Konten 404</div>
        </ApplicationShell>
      </SessionProvider>,
    );
    expect(await screen.findByText('Konten 404')).toBeVisible();
    expect(screen.queryByText('Mengarahkan ke halaman masuk')).not.toBeInTheDocument();
    expect(document.querySelector('[data-admin-shell]')).toBeNull();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it.each(['/notification-management', '/users'])(
    'still redirects a guest from the protected route %s to sign-in',
    async (path) => {
      navigation.pathname = path;
      const client: SessionClient = {
        me: vi.fn().mockRejectedValue({ response: { status: 401 } }),
        logout: vi.fn(),
      };
      render(
        <SessionProvider client={client}>
          <div>Protected</div>
        </SessionProvider>,
      );
      await waitFor(() =>
        expect(navigation.replace).toHaveBeenCalledWith(
          `/sign-in?returnTo=${encodeURIComponent(path)}`,
        ),
      );
      expect(screen.queryByText('Protected')).not.toBeInTheDocument();
    },
  );

  it('renders consistent recovery actions when the session dependency fails', async () => {
    const client: SessionClient = {
      me: vi
        .fn()
        .mockRejectedValueOnce({ response: { status: 503 } })
        .mockResolvedValue(adminSession),
      logout: vi.fn(),
    };
    render(
      <SessionProvider client={client}>
        <div>Protected</div>
      </SessionProvider>,
    );

    const retry = await screen.findByRole('button', { name: 'Coba lagi' });
    expect(retry).toHaveClass('min-h-11', 'bg-dd-forest', 'text-white');
    expect(screen.getByRole('link', { name: 'Kunjungi situs utama' })).toHaveClass(
      'min-h-11',
      'border-dd-forest/25',
      'bg-white',
    );

    await userEvent.click(retry);
    expect(await screen.findByText('Protected')).toBeVisible();
    expect(client.me).toHaveBeenCalledTimes(2);
  });

  it('routes staff away from the customer verification page to the reviewer queue', async () => {
    navigation.pathname = '/account/verification';
    const reviewer = {
      ...adminSession,
      roles: ['SUPER_OWNER'],
      capabilities: [...adminSession.capabilities, 'identity-verification:read'],
    };
    const client: SessionClient = { me: vi.fn().mockResolvedValue(reviewer), logout: vi.fn() };
    render(
      <SessionProvider client={client}>
        <div>Customer verification</div>
      </SessionProvider>,
    );

    expect(await screen.findByText(/Halaman verifikasi akun hanya untuk customer/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Buka antrean verifikasi' })).toHaveAttribute(
      'href',
      '/identity-verifications',
    );
    expect(screen.getByRole('link', { name: 'Buka antrean verifikasi' })).toHaveClass(
      'min-h-11',
      'bg-dd-forest',
      'text-white',
    );
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/identity-verifications'));
  });

  it('routes instructor/coach-only accounts to their today workspace instead of the general operational workspace', () => {
    expect(defaultSessionDestination(instructorSession)).toBe('/workspace');
    expect(canAccessSessionPath(instructorSession, '/workspace')).toBe(true);
    expect(canAccessSessionPath(instructorSession, '/workspace/classes')).toBe(true);
    expect(canAccessSessionPath(instructorSession, '/workspace/payments')).toBe(false);
  });

  it('lets an instructor open their own static QR but not the staff-only pages', () => {
    // Instruktur menunjukkan QR-nya; yang memindai adalah staf di halaman Check-in.
    expect(canAccessSessionPath(instructorSession, '/check-in-pass')).toBe(true);
    expect(canAccessSessionPath(instructorSession, '/workspace/check-in')).toBe(false);
    expect(canAccessSessionPath(instructorSession, '/workspace/bookings')).toBe(false);
  });

  it('keeps dual-role instructor+admin accounts on the full operational workspace', () => {
    const dualRole = { ...instructorSession, roles: ['INSTRUCTOR', 'ADMIN'] };
    expect(defaultSessionDestination(dualRole)).toBe('/workspace');
    expect(canAccessSessionPath(dualRole, '/workspace')).toBe(true);
  });

  it("shows only the instructor's class schedule in the sidebar, not the blocked operational overview", async () => {
    navigation.pathname = '/workspace/classes';
    const client: SessionClient = { me: vi.fn().mockResolvedValue(instructorSession), logout: vi.fn() };
    render(
      <SessionProvider client={client}>
        <ApplicationShell>
          <div>Jadwal kelas instruktur</div>
        </ApplicationShell>
      </SessionProvider>,
    );
    const navigationRegion = await screen.findByRole('navigation', { name: 'Navigasi utama' });
    expect(within(navigationRegion).getByText('Instruktur', { exact: true })).toBeVisible();
    expect(within(navigationRegion).getByRole('link', { name: 'Jadwal Saya' })).toHaveAttribute(
      'href',
      '/workspace/classes',
    );
    expect(within(navigationRegion).getByRole('link', { name: 'Hari ini' })).toHaveAttribute(
      'href',
      '/workspace',
    );
    expect(within(navigationRegion).queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
    expect(within(navigationRegion).queryByText('Penjualan & Keuangan')).not.toBeInTheDocument();
    expect(within(navigationRegion).queryByText('Member & Pelanggan')).not.toBeInTheDocument();
  });

  it('renders the instructor today view instead of branch operational data', async () => {
    navigation.pathname = '/workspace';
    const client: SessionClient = { me: vi.fn().mockResolvedValue(instructorSession), logout: vi.fn() };
    const mockSlotClient = {
      discover: vi.fn().mockResolvedValue({ slots: [], classTypes: [], studios: [] }),
    } as unknown as ClassSlotClient;
    const mockAvailabilityClient = {
      list: vi.fn().mockResolvedValue({ items: [] }),
    } as unknown as AvailabilityClient;
    render(
      <SessionProvider client={client}>
        <Dashboard slotClient={mockSlotClient} availabilityClient={mockAvailabilityClient} />
      </SessionProvider>,
    );
    expect(
      await screen.findByRole('heading', { name: /Halo, Coach/ }),
    ).toBeVisible();
    expect(screen.getByRole('heading', { name: 'QR kehadiran saya' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Perbesar' })).toHaveAttribute('href', '/check-in-pass');
    expect(screen.queryByText('Pilih cabang aktif di bagian atas', { exact: false })).not.toBeInTheDocument();
  });

  it('accepts only same-origin relative return targets', () => {
    expect(safeReturnTo('/ledger?cursor=one')).toBe('/ledger?cursor=one');
    expect(safeReturnTo('/classes?studio=Green%20Garden#schedule')).toBe(
      '/classes?studio=Green%20Garden#schedule',
    );
    expect(safeReturnTo('/account/verification')).toBe('/account/verification');
    expect(safeReturnTo('/sign-in?returnTo=/sign-in')).toBe('/workspace');
    expect(safeReturnTo('//evil.example/path')).toBe('/workspace');
    expect(safeReturnTo('https://evil.example/path')).toBe('/workspace');
  });

  it('resolves role-aware defaults and verification-gated return targets', () => {
    expect(canAccessSessionPath(customerSession, '/ledger')).toBe(false);
    expect(canAccessSessionPath(adminSession, '/ledger')).toBe(true);
    expect(canAccessSessionPath(adminSession, '/health')).toBe(false);
    expect(
      canAccessSessionPath(
        { ...adminSession, capabilities: [...adminSession.capabilities, 'operations:read'] },
        '/health',
      ),
    ).toBe(true);
    expect(defaultSessionDestination(customerSession)).toBe('/account');
    expect(
      defaultSessionDestination({
        ...customerSession,
        identityVerificationStatus: 'APPROVED',
      }),
    ).toBe('/account');
    expect(defaultSessionDestination(adminSession)).toBe('/workspace');
    expect(canAccessSessionPath(adminSession, '/bookings')).toBe(false);
    expect(canAccessSessionPath(adminSession, '/bookings/booking-1')).toBe(false);
    expect(forbiddenSessionDestination(adminSession, '/bookings')).toBe('/workspace/bookings');
    expect(forbiddenSessionDestination(adminSession, '/bookings/booking-1')).toBe(
      '/workspace/bookings/booking-1',
    );
    expect(
      forbiddenSessionDestination(
        {
          ...adminSession,
          roles: ['SUPER_OWNER'],
          capabilities: [...adminSession.capabilities, 'identity-verification:read'],
        },
        '/account/verification',
      ),
    ).toBe('/identity-verifications');
    expect(forbiddenSessionDestination(adminSession, '/account/verification')).toBe('/workspace');
    expect(resolveSessionDestination(customerSession, '/account/verification')).toBe('/account/verification');
    expect(
      resolveSessionDestination(
        {
          ...customerSession,
          roles: ['CUSTOMER', 'ADMIN'],
          capabilities: [...customerSession.capabilities, 'identity-verification:read'],
        },
        '/account/verification',
      ),
    ).toBe('/workspace');
    expect(
      defaultSessionDestination({
        ...customerSession,
        roles: ['CUSTOMER', 'ADMIN'],
      }),
    ).toBe('/workspace');
    expect(
      canAccessSessionPath(
        {
          ...customerSession,
          roles: ['CUSTOMER', 'ADMIN'],
          identityVerificationStatus: 'APPROVED',
        },
        '/bookings/booking-1',
      ),
    ).toBe(false);

    expect(resolveSessionDestination(customerSession, '/classes?slot=one')).toBe(
      '/classes?slot=one',
    );
    expect(resolveSessionDestination(customerSession, '/bookings')).toBe('/bookings');
    expect(resolveSessionDestination(customerSession, '/purchases?package=one')).toBe(
      '/purchases?package=one',
    );
    expect(resolveSessionDestination(customerSession, '//evil.example/path')).toBe(
      '/account',
    );
    expect(
      resolveSessionDestination(
        { ...customerSession, identityVerificationStatus: 'APPROVED' },
        '/bookings',
      ),
    ).toBe('/bookings');
    expect(
      canAccessSessionPath(
        { ...customerSession, identityVerificationStatus: 'APPROVED' },
        '/workspace/bookings/booking-1',
      ),
    ).toBe(false);
    expect(
      forbiddenSessionDestination(
        { ...customerSession, identityVerificationStatus: 'APPROVED' },
        '/workspace/bookings/booking-1',
      ),
    ).toBe('/bookings/booking-1');
  });

  it('opens the front desk page, not the dashboard, for an Admin-only session', async () => {
    const client: SessionClient = { me: vi.fn().mockResolvedValue(adminSession), logout: vi.fn() };
    render(
      <AppFeedbackProvider>
        <SessionProvider client={client}>
          <Dashboard />
        </SessionProvider>
      </AppFeedbackProvider>,
    );
    expect(await screen.findByText('Pilih cabang aktif di bagian atas', { exact: false })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Selamat datang, Admin Jakarta' })).not.toBeInTheDocument();
  });

  it('renders a role-aware dashboard without exposing unavailable workspaces', async () => {
    const client: SessionClient = {
      me: vi.fn().mockResolvedValue({ ...adminSession, roles: ['MANAGER'] }),
      logout: vi.fn(),
    };
    render(
      <SessionProvider client={client}>
        <Dashboard />
      </SessionProvider>,
    );
    expect(
      await screen.findByRole('heading', { name: 'Selamat datang, Admin Jakarta' }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: /^Booking/ })).toBeVisible();
    expect(screen.getByRole('link', { name: /^(Paket & Sesi|Sesi Pelanggan)/ })).toBeVisible();
    expect(screen.queryByRole('link', { name: /Evaluasi kuota H-24/ })).not.toBeInTheDocument();
    expect(screen.getByText('Pilih cabang aktif di bagian atas', { exact: false })).toBeVisible();
  });

  it('keeps logged-in customers inside the customer shell on the public catalog routes', async () => {
    // Pelanggan yang sudah masuk membawa tanda sesi di peramban ini.
    setSessionHint();
    navigation.pathname = '/classes';
    const client: SessionClient = {
      me: vi.fn().mockResolvedValue({
        ...customerSession,
        identityVerificationStatus: 'APPROVED',
        preferredBranch: {
          id: 'branch-1',
          code: 'JKT',
          name: 'Jakarta',
          timezone: 'Asia/Jakarta',
        },
      }),
      logout: vi.fn(),
    };
    const view = render(
      <SessionProvider client={client}>
        <ApplicationShell>
          <div>Katalog kelas customer</div>
        </ApplicationShell>
      </SessionProvider>,
    );
    expect(
      await screen.findByRole('navigation', { name: 'Navigasi customer' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Jadwal' })[0]).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(view.container.querySelector('[data-customer-shell]')).toBeInTheDocument();
    expect(view.container.querySelector('[data-admin-shell]')).not.toBeInTheDocument();
  });

  it('separates the customer dashboard from the public landing destination', async () => {
    navigation.pathname = '/account';
    const client: SessionClient = {
      me: vi.fn().mockResolvedValue({
        ...customerSession,
        identityVerificationStatus: 'APPROVED',
      }),
      logout: vi.fn(),
    };
    render(
      <SessionProvider client={client}>
        <ApplicationShell>
          <div>Dashboard customer</div>
        </ApplicationShell>
      </SessionProvider>,
    );

    const customerNav = await screen.findByRole('navigation', { name: 'Navigasi customer' });
    expect(
      customerNav.querySelector<HTMLAnchorElement>('a[aria-current="page"]'),
    ).toHaveTextContent('Beranda');
    expect(screen.getAllByRole('link', { name: 'Beranda' })[0]).toHaveAttribute(
      'href',
      '/account',
    );
    expect(
      screen.getByRole('link', { name: 'Daily Dose Pilates — Kembali ke situs utama' }),
    ).toHaveAttribute('href', '/');

    fireEvent.click(screen.getByRole('button', { name: 'Menu profil Nadia Customer' }));
    expect(
      screen.getByRole('region', { name: 'Menu akun customer' }).querySelector('a[href="/"]'),
    ).toHaveTextContent('Kunjungi situs utama');

    fireEvent.click(screen.getByRole('button', { name: 'Buka navigasi akun' }));
    const mobileNav = screen.getByRole('dialog', { name: 'Navigasi akun' });
    expect(mobileNav).toHaveAttribute('aria-hidden', 'false');
    expect(within(mobileNav).getByRole('link', { name: 'Kunjungi situs utama' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(within(mobileNav).getByRole('button', { name: 'Keluar' })).toBeVisible();
  });

  it('keeps the public landing header aware of an authenticated customer', async () => {
    // Pelanggan yang sudah masuk membawa tanda sesi di peramban ini.
    setSessionHint();
    navigation.pathname = '/';
    const client: SessionClient = {
      me: vi.fn().mockResolvedValue(customerSession),
      logout: vi.fn(),
    };
    render(
      <SessionProvider client={client}>
        <PublicHeader />
      </SessionProvider>,
    );

    const accountLinks = await screen.findAllByRole('link', { name: 'Akun Saya' });
    expect(accountLinks.some((link) => link.getAttribute('href') === '/account')).toBe(true);
    expect(screen.queryByRole('link', { name: 'Masuk ke akun' })).not.toBeInTheDocument();
  });

  it('keeps the session active and uses global feedback when logout fails', async () => {
    navigation.pathname = '/account';
    const client: SessionClient = {
      me: vi.fn().mockResolvedValue(customerSession),
      logout: vi.fn().mockRejectedValue(new Error('network unavailable')),
    };
    render(
      <AppFeedbackProvider>
        <SessionProvider client={client}>
          <ApplicationShell>
            <div>Dashboard customer</div>
          </ApplicationShell>
        </SessionProvider>
      </AppFeedbackProvider>,
    );

    await screen.findByRole('navigation', { name: 'Navigasi customer' });
    fireEvent.click(screen.getByRole('button', { name: 'Menu profil Nadia Customer' }));
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Menu akun customer' })).getByRole('button', {
        name: 'Keluar',
      }),
    );

    expect(await screen.findByRole('heading', { name: 'Keluar belum berhasil' })).toBeVisible();
    expect(client.logout).toHaveBeenCalledOnce();
    expect(navigation.replace).not.toHaveBeenCalledWith('/sign-in');
    expect(screen.getByText('Dashboard customer')).toBeVisible();
  });
});
