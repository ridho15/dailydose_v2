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

  it('merampingkan sidebar Admin Cabang menjadi tepat 5 Menu Inti studio', () => {
    render(<AppNavigation mobileOpen={false} />);
    const nav = screen.getByRole('navigation', { name: 'Navigasi utama' });

    // Header khusus studio cabang
    expect(screen.getByRole('heading', { name: 'Menu Utama Cabang' })).toBeVisible();

    // Pastikan tidak ada kategori grup rumit yang membingungkan admin awam
    expect(screen.queryByRole('heading', { name: 'Operasional Studio' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Member & Pelanggan' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Penjualan & Keuangan' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Pengaturan & Sistem' })).not.toBeInTheDocument();

    // Memverifikasi 5 menu inti
    const links = within(nav).getAllByRole('link');
    const linkTexts = links
      .map((l) => l.textContent?.trim())
      .filter((t) => t && !t.includes('Daily Dose'));

    expect(linkTexts).toEqual([
      'Hari Ini & Presensi',
      'Kalender Kelas',
      'Booking Kelas',
      'Member & Paket',
      'Kasir & Pengeluaran',
    ]);

    // Memverifikasi tautan href
    const hrefs = links.map((l) => l.getAttribute('href')).filter((h) => h !== '/workspace' || linkTexts.includes('Hari Ini & Presensi'));
    expect(hrefs).toContain('/workspace');
    expect(hrefs).toContain('/workspace/classes');
    expect(hrefs).toContain('/workspace/bookings');
    expect(hrefs).toContain('/customers');
    expect(hrefs).toContain('/workspace/kas');

    // Menu lanjutan disembunyikan untuk staf front desk
    expect(screen.queryByText('Alat & Sistem Lanjutan')).not.toBeInTheDocument();
  });

  it('menampilkan badge antrean pada 5 menu inti admin cabang bila ada', () => {
    render(
      <AppNavigation
        mobileOpen={false}
        queueCounts={{ reschedules: 3 }}
      />,
    );
    // Antrean perubahan jadwal muncul di menu Member & Booking
    expect(screen.getByText('3')).toBeVisible();
  });

  it('tetap menampilkan menu lengkap dan alat lanjutan untuk Super Owner / Manager', () => {
    mockSession = {
      id: 'session-owner',
      userId: 'user-owner',
      displayName: 'Super Owner Boss',
      roles: ['SUPER_OWNER'],
      capabilities: [
        'dashboard:read',
        'class-slot:read',
        'booking:read',
        'automation:read',
        'payment:review',
        'master:read',
      ],
      branches: [{ id: 'branch-1', name: 'All Branches', code: 'ALL' }],
    };

    render(<AppNavigation mobileOpen={false} />);
    expect(screen.getByRole('heading', { name: 'Operasional Studio' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Pengaturan & Sistem' })).toBeVisible();
    expect(screen.getByText('Alat & Sistem Lanjutan')).toBeVisible();
  });
});
