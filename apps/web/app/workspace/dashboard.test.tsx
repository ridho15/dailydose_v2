import { render, screen, within } from '@testing-library/react';
import { AppFeedbackProvider } from '../components/app-feedback';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from '@/dashboard';
import type { DashboardClient, DashboardOverview } from '@/api-clients/dashboard-client';

const sessionState = vi.hoisted(() => ({
  roles: ['FINANCE', 'MANAGER'] as string[],
  capabilities: [
    'branch:all',
    'finance:read',
    'class-slot:read',
    'booking:read',
    'payment:review',
    'finance:reconcile',
  ] as string[],
}));

vi.mock('@/session-context', () => ({
  useSessionContext: () => ({
    activeBranchId: 'branch-1',
    activeBranch: { id: 'branch-1', code: 'JKT', name: 'Jakarta', timezone: 'Asia/Jakarta' },
    session: {
      displayName: 'Super Owner',
      roles: sessionState.roles,
      capabilities: sessionState.capabilities,
      branches: [
        { id: 'branch-1', code: 'JKT', name: 'Jakarta', timezone: 'Asia/Jakarta' },
        { id: 'branch-2', code: 'BDG', name: 'Bandung', timezone: 'Asia/Jakarta' },
      ],
    },
  }),
}));

const response = (): DashboardOverview =>
  ({
    generatedAt: new Date('2026-08-08T00:00:00.000Z'),
    period: {
      from: new Date('2026-08-01T00:00:00.000Z'),
      until: new Date('2026-08-08T00:00:00.000Z'),
      previousFrom: new Date('2026-07-24T00:00:00.000Z'),
      previousUntil: new Date('2026-07-31T00:00:00.000Z'),
    },
    financial: {
      grossSalesRp: 1_000_000,
      packagePromotionDiscountRp: 0,
      voucherDiscountRp: 0,
      revenueRp: 1_000_000,
      instructorRealtimeRp: 200_000,
      otherCostRp: 150_000,
      profitRp: 450_000,
      completeness: 'COMPLETE',
      anomalyCount: 0,
      sourceCutoffAt: new Date('2026-08-08T00:00:00.000Z'),
      controlHash: 'a'.repeat(64),
    },
    views: { finance: true, operations: true },
    sections: { trend: true, queue: true, risk: true, branchComparison: true },
    metrics: [
      { key: 'revenue', label: 'Omzet bersih', value: 1_000_000, unit: 'IDR', changePercent: 0 },
      { key: 'profit', label: 'Profit operasional', value: 450_000, unit: 'IDR', changePercent: 0 },
    ],
    queues: [],
    trend: [
      {
        date: new Date('2026-08-01T00:00:00.000Z'),
        revenue: 1_000_000,
        profit: 450_000,
        bookings: 1,
      },
      { date: new Date('2026-08-02T00:00:00.000Z'), revenue: 0, profit: 0, bookings: 0 },
    ],
    branches: [],
    risks: [],
  }) as DashboardOverview;

describe('Dashboard', () => {
  beforeEach(() => {
    // Owner dan Super Owner memakai beranda keuangan bulanan (OwnerHome); ringkasan ini untuk
    // Finance dan Manager.
    sessionState.roles = ['FINANCE', 'MANAGER'];
    sessionState.capabilities = [
      'branch:all',
      'finance:read',
      'class-slot:read',
      'booking:read',
      'payment:review',
      'finance:reconcile',
    ];
  });

  it('follows the topbar branch and has no local branch filter', async () => {
    const overview = vi.fn().mockResolvedValue(response());
    render(<Dashboard client={{ overview } as DashboardClient} />);

    expect(await screen.findByText('Omzet bersih')).toBeVisible();
    expect(screen.getByText('Profit operasional')).toBeVisible();
    expect(screen.getByText(/Cabang operasional: Jakarta/)).toBeVisible();
    expect(screen.queryByRole('combobox', { name: 'Studio/Cabang' })).not.toBeInTheDocument();
    expect(overview).toHaveBeenLastCalledWith(expect.objectContaining({ branchId: 'branch-1' }));
  });

  it('does not present incomplete financial facts as authoritative zeroes', async () => {
    const incomplete = response();
    incomplete.financial.completeness = 'INCOMPLETE';
    incomplete.financial.anomalyCount = 1;
    incomplete.metrics = [
      { key: 'revenue', label: 'Omzet bersih', value: 0, unit: 'IDR', changePercent: 0 },
    ];
    render(
      <Dashboard
        client={{ overview: vi.fn().mockResolvedValue(incomplete) } as unknown as DashboardClient}
      />,
    );

    expect(await screen.findByText('Belum tersedia')).toBeVisible();
    expect(screen.getByText('Konfigurasi atau sumber belum lengkap')).toBeVisible();
    expect(screen.getByText(/belum boleh digunakan/)).toBeVisible();
  });

  it('puts the Perlu tindakan inbox before the KPI cards, fed by the decide-gated endpoint', async () => {
    const tindakan = vi.fn().mockResolvedValue({
      dibuatPada: '',
      ringkasan: [{ jenis: 'PENYESUAIAN', jumlah: 1 }],
      items: [
        {
          id: 'adj-1',
          jenis: 'PENYESUAIAN',
          version: 1,
          masukPada: new Date().toISOString(),
          branchId: 'b',
          branchName: 'Gading',
          nama: 'Rina',
          rincian: '10 Sesi',
          sesi: 1,
          alasan: 'Salah potong sesi',
        },
      ],
      nextCursor: null,
      pengingat: [],
      gagal: [],
    });
    render(
      <AppFeedbackProvider>
        <Dashboard
          client={{ overview: vi.fn().mockResolvedValue(response()) } as never}
          queueClient={{ tertinggal: vi.fn(), tindakan }}
        />
      </AppFeedbackProvider>,
    );

    const kotak = await screen.findByRole('heading', { name: 'Perlu tindakan (1)' });
    const kpi = await screen.findByText('Omzet bersih');
    expect(kotak.compareDocumentPosition(kpi) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Setujui' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Perlu perhatian Anda' })).toBeNull();
  });

  it('hides the class-risk panel for roles without the risk section (Finance)', async () => {
    sessionState.roles = ['FINANCE'];
    const data = response();
    data.views = { finance: true, operations: false };
    data.sections = { ...data.sections, risk: false, queue: true };
    render(<Dashboard client={{ overview: vi.fn().mockResolvedValue(data) } as never} />);

    expect(await screen.findByText('Omzet bersih')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Kelas berisiko' })).not.toBeInTheDocument();
  });

  it('shows one header per summary: both, finance only, operations only', async () => {
    const cases: Array<[string[], { finance: boolean; operations: boolean }, RegExp]> = [
      [['FINANCE', 'MANAGER'], { finance: true, operations: true }, /Keuangan dan operasional dalam satu pandangan/],
      [['FINANCE'], { finance: true, operations: false }, /Arus transaksi dan pekerjaan keuangan/],
      [['MANAGER'], { finance: false, operations: true }, /Operasional cabang hari ini/],
    ];
    for (const [roles, views, heading] of cases) {
      sessionState.roles = roles;
      const data = response();
      data.views = views;
      const { unmount } = render(
        <Dashboard client={{ overview: vi.fn().mockResolvedValue(data) } as never} />,
      );
      expect(await screen.findByText(heading)).toBeVisible();
      expect(screen.queryByText('Kesehatan job')).not.toBeInTheDocument();
      unmount();
    }
  });

  it('builds shortcuts from the role and permissions instead of a fixed list', async () => {
    sessionState.roles = ['FINANCE'];
    sessionState.capabilities = ['payment:review', 'finance:reconcile', 'voucher:read'];
    const data = response();
    data.queues = [
      { key: 'payments', label: 'Pembayaran menunggu', count: 4, href: '/workspace/payments' },
    ];
    render(<Dashboard client={{ overview: vi.fn().mockResolvedValue(data) } as never} />);

    const shortcuts = await screen.findByRole('region', { name: 'Pintasan' });
    const links = within(shortcuts).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/workspace/guide',
      '/workspace/payments',
      '/workspace/vouchers',
      '/finance',
    ]);
    expect(within(shortcuts).getByLabelText('4 antrean')).toBeVisible();
    expect(within(shortcuts).queryByText('Kelas')).not.toBeInTheDocument();
  });

  it('memberi tahu bila tarif honor instruktur belum diisi, bukan diam-diam Rp 0', async () => {
    const data = response();
    data.financial.instructorFeeMissing = true;
    render(<Dashboard client={{ overview: vi.fn().mockResolvedValue(data) } as never} />);
    expect(await screen.findByText(/Tarif honor instruktur belum diisi/)).toBeVisible();
  });

  it('tidak menampilkan peringatan tarif honor bila tarif sudah ada', async () => {
    render(<Dashboard client={{ overview: vi.fn().mockResolvedValue(response()) } as never} />);
    await screen.findByRole('img', { name: /Tren pendapatan/ });
    expect(screen.queryByText(/Tarif honor instruktur belum diisi/)).not.toBeInTheDocument();
  });

  it('labels the trend axis and gives each point a tooltip', async () => {
    const { container } = render(
      <Dashboard client={{ overview: vi.fn().mockResolvedValue(response()) } as never} />,
    );
    await screen.findByRole('img', { name: /Tren pendapatan/ });
    expect(screen.getAllByText(/jt/).length).toBeGreaterThan(0);
    const tooltips = [...container.querySelectorAll('svg rect title')].map(
      (node) => node.textContent,
    );
    expect(tooltips).toHaveLength(2);
    expect(tooltips[0]).toMatch(/1 Agu 2026/);
    expect(tooltips[0]).not.toMatch(/2026-08-01/);
  });

  it('renders the branch table with a row per branch', async () => {
    const data = response();
    data.branches = [
      {
        id: 'branch-1',
        code: 'JKT',
        name: 'Jakarta',
        revenueRp: 1_000_000,
        instructorRealtimeRp: 0,
        otherCostRp: 0,
        profitRp: 500_000,
        bookings: 12,
        occupancyPercent: 60,
      },
    ] as DashboardOverview['branches'];
    render(<Dashboard client={{ overview: vi.fn().mockResolvedValue(data) } as never} />);

    expect(await screen.findByRole('heading', { name: 'Performa per cabang' })).toBeVisible();
    expect(screen.getAllByText('Jakarta').length).toBeGreaterThan(0);
    expect(screen.getAllByText('60%').length).toBeGreaterThan(0);
  });
  it('does not ask for the staff overview when an instructor opens the home page', async () => {
    sessionState.roles = ['INSTRUCTOR'];
    sessionState.capabilities = ['attendance:self', 'availability:self:read', 'class-slot:read'];
    const overview = vi.fn().mockResolvedValue(response());
    const slotClient = { discover: vi.fn().mockResolvedValue({ slots: [], classTypes: [], instructors: [], studios: [] }) };
    render(<Dashboard client={{ overview } as DashboardClient} slotClient={slotClient as never} />);
    await vi.waitFor(() => expect(slotClient.discover).toHaveBeenCalled());
    expect(overview).not.toHaveBeenCalled();
  });
});
