import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppFeedbackProvider } from '../components/app-feedback';
import type { ClassSlotClient, ClassWorkspace } from '../api-clients/class-slot-client';
import type { BookingClient } from '../api-clients/booking-client';
import type { DashboardClient } from '../api-clients/dashboard-client';
import { FrontDeskTodayView } from '../workspace/front-desk-today-view';

const capabilities = vi.hoisted(() => ({
  list: ['attendance:manage', 'class-slot:read', 'booking:read'] as string[],
}));
const branch = {
  id: 'branch-senopati',
  code: 'DD-SNP',
  name: 'Daily Dose Senopati',
  timezone: 'Asia/Jakarta',
};

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('../session-context', () => ({
  useSessionContext: () => ({
    session: {
      id: 'u-frontdesk',
      displayName: 'Petugas Meja Depan',
      roles: ['ADMIN'],
      branches: [branch],
    },
    activeBranchId: 'branch-senopati',
    activeBranch: branch,
    hasCapability: (cap: string) => capabilities.list.includes(cap),
  }),
}));

// Waktu uji: 27 Oktober 2026, 08.42 WIB = 01.42 UTC
const now = new Date('2026-10-27T01:42:00.000Z');

const slot = (
  id: string,
  startUtc: string,
  endUtc: string,
  overrides: Record<string, unknown> = {},
) => ({
  id,
  branchId: 'branch-senopati',
  classTypeId: 'type-group',
  studioId: 'studio-1',
  instructorUserId: 'coach-sarah',
  startAt: new Date(startUtc),
  endAt: new Date(endUtc),
  timezone: 'Asia/Jakarta',
  status: 'CONFIRMED',
  minimumQuota: 2,
  capacity: 4,
  bookedCount: 3,
  version: 1,
  ...overrides,
});

const workspaceFixture = (slots = [
  // Berjalan sekarang: 08.00 - 09.00 WIB (01.00 - 02.00 UTC)
  slot('running', '2026-10-27T01:00:00Z', '2026-10-27T02:00:00Z', {
    classTypeId: 'type-group',
    bookedCount: 3,
    capacity: 4,
  }),
  // Mulai 18 menit lagi: 09.00 - 10.00 WIB (02.00 - 03.00 UTC)
  slot('next-18m', '2026-10-27T02:00:00Z', '2026-10-27T03:00:00Z', {
    classTypeId: 'type-intro',
    instructorUserId: 'coach-budi',
    bookedCount: 6,
    capacity: 6,
  }),
  // Sisa kelas: overcapacity 6 dari 4
  slot('overcap', '2026-10-27T04:00:00Z', '2026-10-27T05:00:00Z', {
    classTypeId: 'type-chair',
    bookedCount: 6,
    capacity: 4,
  }),
]): ClassWorkspace => ({
  slots: slots as never,
  classTypes: [
    { id: 'type-group', code: 'PG', name: 'Private Group' },
    { id: 'type-intro', code: 'RI', name: 'Reformer Intro' },
    { id: 'type-chair', code: 'CP', name: 'Chair Pilates' },
  ],
  instructors: [
    { id: 'coach-sarah', displayName: 'Coach Sarah' },
    { id: 'coach-budi', displayName: 'Coach Budi' },
  ],
  studios: [
    { id: 'studio-1', branchId: 'branch-senopati', code: 'S1', name: 'Studio 1', rooms: [] },
    { id: 'studio-2', branchId: 'branch-senopati', code: 'S2', name: 'Studio 2', rooms: [] },
  ],
});

const bookingFixture = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
  id,
  version: 1,
  status: 'BOOKED',
  customer: { id: `c-${id}`, displayName: name, phoneMasked: null },
  package: { id: 'pkg-1', name: 'Paket 10 Sesi' },
  sessionBalance: { ledgerBalance: 8, reserved: 0, available: 8 },
  ...overrides,
});

const createTestClients = (overrides: {
  slots?: ClassWorkspace;
  bookings?: unknown[];
  queues?: unknown[];
} = {}) => {
  const classClient = {
    discover: vi.fn().mockResolvedValue(overrides.slots ?? workspaceFixture()),
  } as unknown as ClassSlotClient;

  const bookingClient = {
    list: vi.fn().mockResolvedValue({
      items: overrides.bookings ?? [
        bookingFixture('b1', 'Amanda Manopo', {
          attendance: { checkedInAt: new Date('2026-10-27T00:54:00.000Z'), source: 'QR' },
          status: 'ATTENDED',
        }),
        bookingFixture('b2', 'Budi Hartono', { status: 'BOOKED' }),
      ],
    }),
    backfillAttendance: vi.fn().mockResolvedValue({ ok: true }),
  } as unknown as BookingClient;

  const dashboardClient = {
    overview: vi.fn().mockResolvedValue({
      queues: overrides.queues ?? [
        { key: 'payments', label: 'Pembayaran menunggu', count: 2, href: '/workspace/payments?status=PENDING' },
      ],
    }),
  } as unknown as DashboardClient;

  return { classClient, bookingClient, dashboardClient };
};

const renderView = (c: ReturnType<typeof createTestClients>) =>
  render(
    <AppFeedbackProvider>
      <FrontDeskTodayView
        client={c.classClient}
        bookingClient={c.bookingClient}
        dashboardClient={c.dashboardClient}
        initialNow={now}
      />
    </AppFeedbackProvider>,
  );

describe('Tiket T-20: Halaman Hari Ini untuk Front Desk (Papan 14)', () => {
  beforeEach(() => {
    capabilities.list = ['attendance:manage', 'class-slot:read', 'booking:read'];
  });

  it('1. Menampilkan tanggal hari ini dan judul meja depan', async () => {
    renderView(createTestClients());
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Hari ini di meja depan' }),
    ).toBeVisible();
    expect(screen.getByText('Selasa, 27 Oktober 2026')).toBeVisible();
  });

  it('2. Menampilkan kelas yang berjalan sebagai kartu utama dan kelas berikutnya di bawahnya', async () => {
    renderView(createTestClients());
    const running = await screen.findByRole('region', { name: 'Berjalan sekarang' });
    expect(within(running).getByText('08.00 – 09.00')).toBeVisible();
    expect(within(running).getByText('Private Group')).toBeVisible();
    expect(
      within(running).getByText(/Studio 1 · bersama Coach Sarah · Terisi 3 dari 4/),
    ).toBeVisible();

    const next = screen.getByRole('region', { name: 'Berikutnya hari ini' });
    expect(within(next).getByText('09.00 – 10.00')).toBeVisible();
    expect(within(next).getByText('Reformer Intro')).toBeVisible();
    expect(within(next).getByText(/6 dari 6 peserta/)).toBeVisible();
  });

  it('3. Tidak menampilkan QR untuk dipindai member; meja depan membuka halaman Check-in', async () => {
    renderView(createTestClients());
    // Arah yang disepakati: member menyimpan QR statis, studio yang memindai.
    expect(await screen.findByRole('link', { name: /Buka Check-in/ })).toHaveAttribute(
      'href',
      '/workspace/check-in',
    );
    expect(screen.queryByRole('button', { name: /QR check-in/ })).toBeNull();
  });

  it('4. Menampilkan presensi peserta dengan jam kehadiran 07.54 dan tombol tandai hadir', async () => {
    const user = userEvent.setup();
    const c = createTestClients();
    renderView(c);

    expect(await screen.findByText('Amanda Manopo')).toBeVisible();
    expect(screen.getByText('Hadir, 07.54')).toBeVisible();
    expect(screen.getByText('Sudah tercatat')).toBeVisible();

    expect(screen.getByText('Budi Hartono')).toBeVisible();
    const markBtn = screen.getByRole('button', { name: 'Tandai hadir' });
    await user.click(markBtn);
    const dialog = await screen.findByRole('dialog', { name: 'Tandai hadir' });
    expect(within(dialog).getByText(/Pilih alasan, atau tulis sendiri/)).toBeVisible();
    await user.click(
      within(dialog).getByRole('button', {
        name: 'Petugas melihat langsung pelanggan mengikuti kelas',
      }),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Catat kehadiran' }));

    await waitFor(() => {
      expect(c.bookingClient.backfillAttendance).toHaveBeenCalledWith(
        'b2',
        'Petugas melihat langsung pelanggan mengikuti kelas',
        1,
        expect.any(String),
      );
    });
  });

  it('5. Menandai kelas kelebihan kapasitas dan menampilkan keputusan yang menunggu', async () => {
    renderView(createTestClients());
    const next = await screen.findByRole('region', { name: 'Berikutnya hari ini' });
    expect(within(next).getByText(/Kelebihan kapasitas \(6\/4\)/)).toBeVisible();

    const decisions = await screen.findByRole('region', { name: '2 hal menunggu keputusan Anda' });
    expect(within(decisions).getByRole('link', { name: /Pembayaran menunggu/ })).toHaveAttribute(
      'href',
      '/workspace/payments?status=PENDING',
    );
  });

  it('6. Menyediakan pendaftaran member dan bebas dari kartu statistik pasif', async () => {
    renderView(createTestClients());
    expect(await screen.findByRole('link', { name: /Daftarkan member baru/ })).toHaveAttribute(
      'href',
      '/customers',
    );
    expect(screen.queryByText(/Total Omzet|Pendapatan Harian|Rata-rata/i)).toBeNull();
  });
});
