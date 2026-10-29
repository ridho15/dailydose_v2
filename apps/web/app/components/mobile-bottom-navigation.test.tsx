import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileBottomNavigation } from './mobile-bottom-navigation';

let capabilities: string[] = [];
let roles: string[] = [];
let pathname = '/workspace';

vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
vi.mock('./customer/use-customer-badges', () => ({
  useCustomerBadges: () => ({
    actionableOrdersCount: 0,
    upcomingBookingsCount: 0,
    verificationActionRequired: false,
    expiringPackagesCount: 0,
  }),
}));
vi.mock('../session-context', () => ({
  useSessionContext: () => ({
    session: { capabilities, roles },
    hasCapability: (...required: string[]) =>
      required.some((capability) => capabilities.includes(capability)),
  }),
}));

const tabs = () =>
  within(screen.getByRole('navigation', { name: 'Navigasi Bawah Workspace' }))
    .getAllByRole('link')
    .map((link) => link.textContent);

describe('MobileBottomNavigation (staff)', () => {
  beforeEach(() => {
    pathname = '/workspace';
    capabilities = [];
  });

  it('only shows tabs the account may open', () => {
    capabilities = ['finance:reconcile', 'payment:review'];
    render(<MobileBottomNavigation customerOnly={false} />);
    expect(tabs()).toEqual(['Beranda', 'Pembayaran', 'Keuangan']);
    expect(screen.getByRole('button', { name: 'Buka semua menu navigasi' })).toBeVisible();
  });

  it('keeps at most four tabs plus the menu, in priority order', () => {
    capabilities = [
      'booking:read',
      'payment:review',
      'class-slot:read',
      'finance:reconcile',
      'ledger:adjust:read',
    ];
    render(<MobileBottomNavigation customerOnly={false} />);
    expect(tabs()).toEqual(['Beranda', 'Booking', 'Pembayaran', 'Kelas']);
  });

  it('shows queue badges from the shared queue counts', () => {
    capabilities = ['booking:read', 'payment:review'];
    render(
      <MobileBottomNavigation
        customerOnly={false}
        queueCounts={{ reschedules: 2, payments: 120 }}
      />,
    );
    expect(screen.getByLabelText('2 antrean')).toHaveTextContent('2');
    expect(screen.getByLabelText('120 antrean')).toHaveTextContent('99+');
  });

  it('marks the menu when a queue lives in a page that is not a tab', () => {
    capabilities = ['booking:read', 'payment:review', 'class-slot:read', 'ledger:adjust:read'];
    render(<MobileBottomNavigation customerOnly={false} queueCounts={{ adjustments: 3 }} />);
    expect(tabs()).toEqual(['Beranda', 'Booking', 'Pembayaran', 'Kelas']);
    expect(screen.getByLabelText('Ada antrean baru di menu lain')).toBeInTheDocument();
  });

  it('does not mark the menu for queues the account cannot open', () => {
    capabilities = ['booking:read'];
    render(<MobileBottomNavigation customerOnly={false} queueCounts={{ adjustments: 3 }} />);
    expect(screen.queryByLabelText('Ada antrean baru di menu lain')).not.toBeInTheDocument();
  });
});

describe('MobileBottomNavigation (customer - Tiket T-03)', () => {
  it('renders the 5 standardized customer tabs in correct order', () => {
    pathname = '/account';
    render(<MobileBottomNavigation customerOnly approved={false} />);
    const nav = screen.getByRole('navigation', { name: 'Navigasi Bawah Mobile' });
    const links = within(nav).getAllByRole('link');

    expect(links).toHaveLength(5);
    expect(links.map((l) => l.textContent?.trim())).toEqual([
      'Beranda',
      'Jadwal',
      'Booking',
      'Paket',
      'Akun',
    ]);

    expect(links[0]?.getAttribute('href')).toBe('/account');
    expect(links[1]?.getAttribute('href')).toBe('/classes');
    expect(links[2]?.getAttribute('href')).toBe('/bookings');
    expect(links[3]?.getAttribute('href')).toBe('/packages');
    expect(links[4]?.getAttribute('href')).toBe('/account/profile');
  });

  it('marks active tab with #396552 color and top indicator line', () => {
    pathname = '/bookings';
    render(<MobileBottomNavigation customerOnly approved={true} />);
    const nav = screen.getByRole('navigation', { name: 'Navigasi Bawah Mobile' });
    const links = within(nav).getAllByRole('link');
    const bookingLink = links.find((l) => l.textContent?.includes('Booking'))!;
    const berandaLink = links.find((l) => l.textContent?.includes('Beranda'))!;

    expect(bookingLink).toHaveAttribute('aria-current', 'page');
    expect(bookingLink.className).toContain('text-[#396552]');
    expect(berandaLink).not.toHaveAttribute('aria-current');

    // Check 68px height container
    const grid = nav.querySelector('div.grid');
    expect(grid?.className).toContain('h-[68px]');
  });
});

describe('MobileBottomNavigation (instructor - Tiket T-10)', () => {
  beforeEach(() => {
    pathname = '/workspace';
    capabilities = ['class-slot:read', 'attendance:self'];
    roles = ['INSTRUCTOR'];
  });

  it('renders the 4 standardized instructor tabs in correct order', () => {
    render(<MobileBottomNavigation customerOnly={false} />);
    const nav = screen.getByRole('navigation', { name: 'Navigasi Bawah Instruktur' });
    const links = within(nav).getAllByRole('link');

    expect(links).toHaveLength(4);
    expect(links.map((l) => l.textContent?.trim())).toEqual([
      'Hari Ini',
      'Jadwal Saya',
      'Ketersediaan',
      'Payroll',
    ]);

    expect(links[0]?.getAttribute('href')).toBe('/workspace');
    expect(links[1]?.getAttribute('href')).toBe('/workspace/classes');
    expect(links[2]?.getAttribute('href')).toBe('/workspace/availability');
    expect(links[3]?.getAttribute('href')).toBe('/workspace/payroll');

    // Does NOT render the 5th "Menu" button
    expect(screen.queryByRole('button', { name: 'Buka semua menu navigasi' })).not.toBeInTheDocument();

    // Check 4-column 68px container
    const grid = nav.querySelector('div.grid');
    expect(grid?.className).toContain('grid-cols-4');
    expect(grid?.className).toContain('h-[68px]');
  });

  it('marks active tab for instructor with #396552 color and indicator line', () => {
    pathname = '/workspace/payroll';
    render(<MobileBottomNavigation customerOnly={false} />);
    const nav = screen.getByRole('navigation', { name: 'Navigasi Bawah Instruktur' });
    const links = within(nav).getAllByRole('link');
    const scanLink = links.find((l) => l.textContent?.includes('Payroll'))!;
    const hariIniLink = links.find((l) => l.textContent?.includes('Hari Ini'))!;

    expect(scanLink).toHaveAttribute('aria-current', 'page');
    expect(scanLink.className).toContain('text-[#396552]');
    expect(hariIniLink).not.toHaveAttribute('aria-current');
  });
});

