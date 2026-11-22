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

describe('MobileBottomNavigation (staf: empat menu utama peran)', () => {
  beforeEach(() => {
    pathname = '/workspace';
    capabilities = [];
    roles = [];
  });

  it('Admin Cabang: Hari ini, Jadwal, Member, Pengeluaran, lalu tombol Menu', () => {
    roles = ['ADMIN'];
    capabilities = ['class-slot:read', 'customer:read', 'expense:create'];
    render(<MobileBottomNavigation customerOnly={false} />);
    expect(tabs()).toEqual(['Hari ini', 'Jadwal', 'Member', 'Pengeluaran']);
    expect(screen.getByRole('button', { name: 'Buka semua menu navigasi' })).toBeVisible();
  });

  it('Owner cabang: Beranda, Laporan, Jadwal', () => {
    roles = ['OWNER'];
    capabilities = ['finance:read', 'class-slot:read', 'booking:late-cancel:decide'];
    render(<MobileBottomNavigation customerOnly={false} />);
    expect(tabs()).toEqual(['Beranda', 'Laporan', 'Jadwal']);
  });

  it('Super Owner: hanya empat tab pertama dari enam menu utama', () => {
    roles = ['SUPER_OWNER'];
    capabilities = [
      'class-slot:read',
      'customer:read',
      'finance:reconcile',
      'package-promotion:read',
      'assignment:read',
    ];
    render(<MobileBottomNavigation customerOnly={false} />);
    expect(tabs()).toEqual(['Beranda', 'Jadwal', 'Member', 'Keuangan']);
  });

  it('badge Beranda berisi jumlah keputusan yang menunggu', () => {
    roles = ['MANAGER'];
    capabilities = ['attendance:manage', 'class-slot:read'];
    render(<MobileBottomNavigation customerOnly={false} queueCounts={{ tindakan: 4 }} />);
    expect(screen.getByLabelText('4 antrean')).toBeVisible();
  });

  it('menu utama yang tidak boleh dibuka akun tidak tampil', () => {
    roles = ['FINANCE'];
    capabilities = ['finance:reconcile'];
    render(<MobileBottomNavigation customerOnly={false} />);
    expect(tabs()).toEqual(['Beranda', 'Keuangan']);
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
    expect(links[3]?.getAttribute('href')).toBe('/account/packages');
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

