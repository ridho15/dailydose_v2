import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ClassSlotClient } from '../api-clients/class-slot-client';
import { EmptyWeeksNotice } from '../workspace/empty-weeks-notice';
import { FrontDeskTodayView } from '../workspace/front-desk-today-view';
import { Dashboard } from '../dashboard';
import { ClassSlotView } from '../classes/class-slot-view';
import { AppFeedbackProvider } from '../components/app-feedback';
import type { DashboardClient, DashboardOverview } from '../api-clients/dashboard-client';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/workspace',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const mockSession = {
  id: 'usr-1',
  displayName: 'Owner Cabang',
  roles: ['OWNER', 'ADMIN'],
  capabilities: ['class-slot:read', 'class-slot:manage', 'attendance:manage', 'booking:read'],
  branches: [
    { id: 'b1', code: 'SCBD', name: 'Cabang SCBD', timezone: 'Asia/Jakarta' },
    { id: 'b2', code: 'KMG', name: 'Cabang Kemang', timezone: 'Asia/Jakarta' },
  ],
};

vi.mock('../session-context', () => ({
  useSessionContext: () => ({
    status: 'AUTHENTICATED',
    session: mockSession,
    activeBranchId: 'b1',
    activeBranch: { id: 'b1', code: 'SCBD', name: 'Cabang SCBD', timezone: 'Asia/Jakarta' },
    setActiveBranchId: vi.fn(),
    hasCapability: (cap: string) => mockSession.capabilities.includes(cap),
    refresh: vi.fn(),
    completeSignIn: vi.fn(),
    logout: vi.fn(),
  }),
}));

const testNow = new Date('2026-10-26T03:00:00Z'); // Senin 26 Okt 2026

const makeSlot = (id: string, isoStart: string, status = 'PUBLISHED') => ({
  id,
  branchId: 'b1',
  startAt: new Date(isoStart),
  endAt: new Date(new Date(isoStart).getTime() + 3600_000),
  status,
  capacity: 10,
  bookedCount: 3,
  minimumQuota: 1,
  classTypeId: 'ct1',
  instructorUserId: 'inst1',
  studioId: 'std1',
});

const createMockSlotClient = (slots: unknown[] = []): ClassSlotClient =>
  ({
    discover: vi.fn().mockResolvedValue({
      slots,
      classTypes: [{ id: 'ct1', name: 'Reformer Intro' }],
      instructors: [{ id: 'inst1', displayName: 'Instruktur Maya' }],
      studios: [{ id: 'std1', name: 'Studio Utama' }],
    }),
  }) as unknown as ClassSlotClient;

const mockDashboardClient: DashboardClient = {
  overview: vi.fn().mockResolvedValue({
    generatedAt: new Date('2026-10-26T03:00:00Z'),
    period: {
      from: new Date('2026-10-01T00:00:00Z'),
      until: new Date('2026-10-26T00:00:00Z'),
      previousFrom: new Date('2026-09-05T00:00:00Z'),
      previousUntil: new Date('2026-09-30T00:00:00Z'),
    },
    financial: {
      grossSalesRp: 50_000_000,
      packagePromotionDiscountRp: 0,
      voucherDiscountRp: 0,
      revenueRp: 50_000_000,
      instructorRealtimeRp: 10_000_000,
      otherCostRp: 5_000_000,
      profitRp: 35_000_000,
      completeness: 'COMPLETE',
      anomalyCount: 0,
      sourceCutoffAt: new Date('2026-10-26T03:00:00Z'),
      controlHash: 'hash-abc',
    },
    views: { finance: true, operations: true },
    sections: { trend: true, queue: true, risk: true, branchComparison: true },
    metrics: [],
    trend: [],
    queues: [],
    risks: [],
    branchComparison: [],
    branches: [],
  } as DashboardOverview),
} as unknown as DashboardClient;

describe('Tiket T-19: Papan Peringatan Minggu Kosong', () => {
  describe('Kriteria 1: Deret Chip Per Minggu & Peringatan Banner (Spesifikasi T-19)', () => {
    it('menampilkan deret chip dengan minggu berisi kelas berwarna netral dan minggu kosong bertuliskan "Kosong" berwarna merah', async () => {
      // 2 minggu ada kelas (minggu 1 dan 3), 2 minggu kosong (minggu 2 dan 4)
      const slotClient = createMockSlotClient([
        makeSlot('s1', '2026-10-27T02:00:00Z'), // Minggu 1
        makeSlot('s2', '2026-11-10T02:00:00Z'), // Minggu 3
      ]);

      render(
        <EmptyWeeksNotice
          branchId="b1"
          timezone="Asia/Jakarta"
          client={slotClient}
          initialNow={testNow}
        />,
      );

      // Pastikan ada peringatan banner
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(/2 minggu dalam empat minggu ke depan belum punya kelas/);

      // Deret chip minggu kosong dan terisi
      const emptyChips = screen.getAllByText(/: Kosong/);
      expect(emptyChips).toHaveLength(2);
      expect(emptyChips[0]!.className).toContain('border-dd-danger');
      expect(emptyChips[0]!.className).toContain('text-dd-danger');

      const filledChips = screen.getAllByText(/1 kelas/);
      expect(filledChips).toHaveLength(2);
      expect(filledChips[0]!.className).toContain('border-dd-border-interactive');
      expect(filledChips[0]!.className).toContain('text-dd-ink');
    });

    it('menyediakan tombol aksi utama "Isi pakai jadwal rutin" dan tautan "Isi pakai salin jadwal"', async () => {
      const slotClient = createMockSlotClient([
        makeSlot('s1', '2026-10-27T02:00:00Z'),
      ]);

      render(
        <EmptyWeeksNotice
          branchId="b1"
          timezone="Asia/Jakarta"
          client={slotClient}
          initialNow={testNow}
          canFill={true}
        />,
      );

      const alert = await screen.findByRole('alert');

      // Tombol aksi utama: Isi pakai jadwal rutin (/workspace/classes/rutin)
      const routineButton = within(alert).getByRole('link', { name: 'Isi pakai jadwal rutin' });
      expect(routineButton).toHaveAttribute('href', '/workspace/classes/rutin');
      expect(routineButton.className).toContain('bg-dd-forest');
      expect(routineButton.className).toContain('text-white');

      // Tautan aksi pendukung: Isi pakai salin jadwal (/workspace/classes/salin)
      const copyLink = within(alert).getByRole('link', { name: 'Isi pakai salin jadwal' });
      expect(copyLink).toHaveAttribute('href', '/workspace/classes/salin');
    });

    it('tidak menampilkan banner peringatan bila seluruh 4 minggu terisi kelas', async () => {
      const slotClient = createMockSlotClient([
        makeSlot('s1', '2026-10-27T02:00:00Z'), // M1
        makeSlot('s2', '2026-11-03T02:00:00Z'), // M2
        makeSlot('s3', '2026-11-10T02:00:00Z'), // M3
        makeSlot('s4', '2026-11-17T02:00:00Z'), // M4
      ]);

      render(
        <EmptyWeeksNotice
          branchId="b1"
          timezone="Asia/Jakarta"
          client={slotClient}
          initialNow={testNow}
        />,
      );

      await screen.findByRole('region', { name: 'Jadwal empat minggu ke depan' });

      // Banner alert tidak muncul
      expect(screen.queryByRole('alert')).toBeNull();
      // Tidak ada chip dengan label Kosong
      expect(screen.queryByText(/Kosong/)).toBeNull();
    });

    it('menyembunyikan tombol isi jadwal bila pengguna tidak memiliki izin canFill', async () => {
      const slotClient = createMockSlotClient([]);

      render(
        <EmptyWeeksNotice
          branchId="b1"
          timezone="Asia/Jakarta"
          client={slotClient}
          initialNow={testNow}
          canFill={false}
        />,
      );

      await screen.findByRole('alert');
      expect(screen.queryByRole('link', { name: 'Isi pakai jadwal rutin' })).toBeNull();
      expect(screen.queryByRole('link', { name: 'Isi pakai salin jadwal' })).toBeNull();
    });
  });

  describe('Kriteria 2: Pemasangan di Layar-Layar Utama (Timetable, Front Desk, Owner)', () => {
    it('terpasang di atas Timetable kelas mingguan (class-slot-view.tsx)', async () => {
      const slotClient = createMockSlotClient([
        makeSlot('s1', '2026-10-27T02:00:00Z'),
      ]);

      render(
        <AppFeedbackProvider>
          <ClassSlotView
            client={slotClient}
            bookingClient={{} as any}
            branchOverride={{ id: 'b1', name: 'Cabang SCBD', timezone: 'Asia/Jakarta' }}
          />
        </AppFeedbackProvider>,
      );

      // Memastikan EmptyWeeksNotice ter-render di atas timetable
      const region = await screen.findByRole('region', { name: 'Jadwal empat minggu ke depan' });
      expect(region).toBeInTheDocument();

      // Memastikan ada tombol "Isi pakai jadwal rutin" di halaman timetable
      const alert = await within(region).findByRole('alert');
      expect(within(alert).getByRole('link', { name: 'Isi pakai jadwal rutin' })).toBeInTheDocument();
    });

    it('terpasang di halaman Dashboard Owner / Ringkasan Eksekutif (dashboard.tsx)', async () => {
      const slotClient = createMockSlotClient([
        makeSlot('s1', '2026-10-27T02:00:00Z'),
      ]);

      render(
        <AppFeedbackProvider>
          <Dashboard
            client={mockDashboardClient}
            slotClient={slotClient}
          />
        </AppFeedbackProvider>,
      );

      // Memastikan EmptyWeeksNotice ter-render di halaman Dashboard
      const region = await screen.findByRole('region', { name: 'Jadwal empat minggu ke depan' });
      expect(region).toBeInTheDocument();

      const alert = await within(region).findByRole('alert');
      expect(within(alert).getByRole('link', { name: 'Isi pakai jadwal rutin' })).toBeInTheDocument();
    });

    it('terpasang di halaman Hari Ini Front Desk (front-desk-today-view.tsx)', async () => {
      const slotClient = createMockSlotClient([
        makeSlot('s1', '2026-10-27T02:00:00Z'),
      ]);

      render(
        <AppFeedbackProvider>
          <FrontDeskTodayView
            client={slotClient}
            bookingClient={{} as any}
            initialNow={testNow}
          />
        </AppFeedbackProvider>,
      );

      // Memastikan EmptyWeeksNotice ter-render di halaman Hari Ini
      const region = await screen.findByRole('region', { name: 'Jadwal empat minggu ke depan' });
      expect(region).toBeInTheDocument();

      const alert = await within(region).findByRole('alert');
      expect(within(alert).getByRole('link', { name: 'Isi pakai jadwal rutin' })).toBeInTheDocument();
    });
  });
});
