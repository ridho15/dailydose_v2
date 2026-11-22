import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppNavigation, badgePeran, MENU_FRONT_DESK, MENU_INSTRUKTUR } from './app-navigation';

let mockSession: any = null;
let mockPathname = '/workspace';

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

vi.mock('./session-context', () => ({
  useSessionContext: () => ({
    session: mockSession,
    status: mockSession ? 'authenticated' : 'unauthenticated',
    activeBranchId: mockSession?.branches?.[0]?.id ?? '',
    activeBranch: mockSession?.branches?.[0] ?? null,
    setActiveBranchId: vi.fn(),
    hasCapability: (...required: string[]) =>
      required.some((cap: string) => mockSession?.capabilities?.includes(cap)),
  }),
}));

describe('AppNavigation - Fase 5 Perampingan Navigasi Admin Cabang', () => {
  beforeEach(() => {
    mockPathname = '/workspace';
    mockSession = {
      id: 'session-admin',
      userId: 'user-admin',
      displayName: 'Admin Green Garden',
      roles: ['ADMIN'],
      capabilities: [
        'assignment:read',
        'attendance:manage',
        'attendance:read',
        'automation:read',
        'booking:cancel:assisted',
        'booking:create:assisted',
        'booking:read',
        'branch:operate',
        'class-slot:manage',
        'class-slot:read',
        'customer-package:manage',
        'customer:credential:initialize',
        'customer:manage',
        'customer:read',
        'expense:create',
        'ledger:adjust:read',
        'ledger:adjust:request',
        'ledger:read',
        'package:read',
        'payment:review',
        'purchase:record',
        'purchase:review',
        'reschedule:decide',
        'reschedule:read',
        'user:read',
      ],
      branches: [
        { id: 'branch-1', name: 'Daily Dose Green Garden', code: 'DD-GG' },
      ],
    };
  });

  it('menampilkan badge peran "Admin Cabang" untuk staf dengan peran ADMIN', () => {
    expect(badgePeran(['ADMIN'], false)).toBe('Admin Cabang');
    expect(badgePeran(['INSTRUCTOR'], true)).toBe('Instruktur');
    expect(badgePeran(['SUPER_OWNER'], false)).toBe('Super Owner');
    expect(badgePeran(['OWNER'], false)).toBe('Owner');
    expect(badgePeran(['MANAGER'], false)).toBe('Manager');
    expect(badgePeran(['FINANCE'], false)).toBe('Finance');
  });

  it('Admin Cabang: empat menu utama, sisanya terlipat di Lainnya', async () => {
    render(<AppNavigation mobileOpen={false} />);
    const nav = screen.getByRole('navigation', { name: 'Navigasi utama' });
    const utama = within(nav).getByRole('region', { name: 'Menu utama' });
    expect(
      within(utama)
        .getAllByRole('link')
        .map((l) => [l.textContent?.trim(), l.getAttribute('href')]),
    ).toEqual([
      ['Hari ini', '/workspace'],
      ['Jadwal', '/workspace/classes'],
      ['Member', '/customers'],
      ['Pengeluaran', '/workspace/kas'],
    ]);
    expect(MENU_FRONT_DESK).toEqual(['/workspace', '/workspace/classes', '/customers', '/workspace/kas']);

    // Halaman lain tidak hilang: Booking ada di "Lainnya" setelah dibuka.
    const lainnya = within(nav).getByRole('button', { name: 'Lainnya' });
    expect(lainnya).toHaveAttribute('aria-expanded', 'false');
    expect(within(nav).queryByRole('link', { name: 'Booking' })).toBeNull();
    lainnya.click();
    expect(await within(nav).findByRole('link', { name: 'Booking' })).toHaveAttribute(
      'href',
      '/workspace/bookings',
    );
  });

  it('Lainnya terbuka sendiri bila halaman aktif ada di dalamnya', () => {
    mockPathname = '/workspace/bookings';
    render(<AppNavigation mobileOpen={false} />);
    expect(screen.getByRole('link', { name: 'Booking' })).toHaveAttribute('aria-current', 'page');
  });

  it('badge keputusan menunggu tampil di menu Hari ini', () => {
    render(<AppNavigation mobileOpen={false} queueCounts={{ tindakan: 3 }} />);
    const hariIni = screen.getByRole('link', { name: /Hari ini/ });
    expect(within(hariIni).getByText('3')).toBeVisible();
  });

  it('Super Owner: enam menu utama dan bagian Pengaturan', () => {
    mockSession = {
      id: 'session-owner',
      userId: 'user-owner',
      displayName: 'Super Owner Boss',
      roles: ['SUPER_OWNER'],
      capabilities: [
        'class-slot:read',
        'customer:read',
        'finance:reconcile',
        'package-promotion:read',
        'assignment:read',
        'master:read',
        'automation:read',
      ],
      branches: [{ id: 'branch-1', name: 'All Branches', code: 'ALL' }],
    };
    render(<AppNavigation mobileOpen={false} />);
    const utama = screen.getByRole('region', { name: 'Menu utama' });
    expect(within(utama).getAllByRole('link').map((l) => l.textContent?.trim())).toEqual([
      'Beranda',
      'Jadwal',
      'Member',
      'Keuangan',
      'Paket & Promo',
      'Instruktur & Staf',
    ]);
    expect(screen.getByRole('button', { name: 'Pengaturan' })).toBeVisible();
  });
});
