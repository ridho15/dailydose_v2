import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppFeedbackProvider } from '../components/app-feedback';
import type { ClassSlotClient, ClassWorkspace } from '../api-clients/class-slot-client';
import type { BookingClient } from '../api-clients/booking-client';
import type { KotakTindakan, WorkQueueClient } from '../api-clients/work-queue-client';
import { FrontDeskTodayView } from './front-desk-today-view';

const capabilities = vi.hoisted(() => ({
  list: ['attendance:manage', 'class-slot:read', 'booking:read'] as string[],
}));
const branch = {
  id: 'branch-1',
  code: 'DD-GG',
  name: 'Daily Dose Green Garden',
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
      id: 'u-admin',
      displayName: 'Admin Meja Depan',
      roles: ['ADMIN'],
      capabilities: capabilities.list,
      branches: [branch],
    },
    activeBranchId: 'branch-1',
    activeBranch: branch,
    hasCapability: (cap: string) => capabilities.list.includes(cap),
  }),
}));

// 27 Okt 2026, 11.30 WIB = 04.30 UTC
const now = new Date('2026-10-27T04:30:00.000Z');
const slot = (id: string, startUtc: string, endUtc: string, status = 'CONFIRMED') => ({
  id,
  branchId: 'branch-1',
  classTypeId: 'type-1',
  studioId: 'studio-1',
  instructorUserId: 'inst-1',
  startAt: new Date(startUtc),
  endAt: new Date(endUtc),
  timezone: 'Asia/Jakarta',
  status,
  minimumQuota: 2,
  capacity: 6,
  bookedCount: 4,
  version: 1,
});
const workspace = (
  slots = [
    slot('running', '2026-10-27T04:00:00Z', '2026-10-27T05:00:00Z'),
    slot('next', '2026-10-27T07:00:00Z', '2026-10-27T08:00:00Z', 'PUBLISHED'),
  ],
): ClassWorkspace => ({
  slots: slots as never,
  classTypes: [{ id: 'type-1', code: 'RF', name: 'Reformer Flow' }],
  instructors: [{ id: 'inst-1', displayName: 'Coach Sarah' }],
  studios: [{ id: 'studio-1', branchId: 'branch-1', code: 'S1', name: 'Studio Utama', rooms: [] }],
});
const booking = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
  id,
  version: 2,
  status: 'BOOKED',
  customer: { id: `c-${id}`, displayName: name, phoneMasked: null },
  package: { id: 'p', name: 'Paket 10 Sesi' },
  sessionBalance: { ledgerBalance: 6, reserved: 0, available: 6 },
  ...overrides,
});

const clients = (
  overrides: { slots?: ClassWorkspace; bookings?: unknown[]; queues?: unknown[] } = {},
) => {
  const classClient = {
    discover: vi.fn().mockResolvedValue(overrides.slots ?? workspace()),
  } as unknown as ClassSlotClient;
  const bookingClient = {
    list: vi
      .fn()
      .mockResolvedValue({
        items: overrides.bookings ?? [
          booking('b1', 'Pelanggan Satu'),
          booking('b2', 'Pelanggan Dua', { attendance: { checkedInAt: new Date(), source: 'QR' } }),
        ],
      }),
    backfillAttendance: vi.fn().mockResolvedValue({ ok: true }),
  } as unknown as BookingClient;
  const items = (overrides.queues ?? [
    {
      id: 'rs-1',
      jenis: 'RESCHEDULE',
      version: 1,
      masukPada: '2026-10-27T02:00:00.000Z',
      branchId: 'branch-1',
      branchName: 'Daily Dose Green Garden',
      nama: 'Rina Wijaya',
      rincian: 'Reformer Flow pindah ke Reformer Flow',
      kelas: { nama: 'Reformer Flow', mulai: '2026-10-28T02:00:00.000Z' },
      kelasTujuan: { nama: 'Reformer Flow', mulai: '2026-10-29T02:00:00.000Z' },
    },
  ]) as KotakTindakan['items'];
  const queueClient: WorkQueueClient = {
    tertinggal: vi.fn(),
    tindakan: vi.fn().mockResolvedValue({
      dibuatPada: '',
      ringkasan: items.length ? [{ jenis: 'RESCHEDULE', jumlah: items.length }] : [],
      items,
      nextCursor: null,
      pengingat: [],
      gagal: [],
    } satisfies KotakTindakan),
  };
  return { classClient, bookingClient, queueClient };
};

const renderDesk = (c: ReturnType<typeof clients>) =>
  render(
    <AppFeedbackProvider>
      <FrontDeskTodayView
        client={c.classClient}
        bookingClient={c.bookingClient}
        queueClient={c.queueClient}
        initialNow={now}
      />
    </AppFeedbackProvider>,
  );

describe('FrontDeskTodayView', () => {
  beforeEach(() => {
    capabilities.list = ['attendance:manage', 'class-slot:read', 'booking:read'];
  });

  it('shows the running and next class with instructor, studio and occupancy, and no statistic cards', async () => {
    renderDesk(clients());
    const running = await screen.findByRole('region', { name: 'Berjalan sekarang' });
    expect(within(running).getByText('11.00 – 12.00')).toBeVisible();
    expect(within(running).getByText('Reformer Flow')).toBeVisible();
    expect(
      within(running).getByText(/Studio Utama · bersama Coach Sarah · Terisi 4 dari 6/),
    ).toBeVisible();
    const upcoming = screen.getByRole('region', { name: 'Berikutnya hari ini' });
    expect(within(upcoming).getByText('14.00 – 15.00')).toBeVisible();
    expect(screen.queryByText(/Total|Omzet|Pendapatan/i)).toBeNull();
  });

  it('lists who has arrived and marks a person present with a reason the officer chose', async () => {
    const user = userEvent.setup();
    const c = clients();
    renderDesk(c);
    expect(await screen.findByText('Pelanggan Satu')).toBeVisible();
    expect(screen.getAllByText(/sisa 6 sesi/)).toHaveLength(2);
    expect(screen.getByText(/^Hadir, \d{2}\.\d{2}$/)).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Tandai hadir' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tandai hadir' });
    const confirm = within(dialog).getByRole('button', { name: 'Catat kehadiran' });
    expect(confirm).toBeDisabled();
    await user.click(
      within(dialog).getByRole('button', { name: 'Ponsel pelanggan bermasalah saat konfirmasi' }),
    );
    await user.click(confirm);
    await waitFor(() =>
      expect(c.bookingClient.backfillAttendance).toHaveBeenCalledWith(
        'b1',
        'Ponsel pelanggan bermasalah saat konfirmasi',
        2,
        expect.any(String),
      ),
    );
  });

  it('explains why attendance cannot be marked yet for a class that is not confirmed', async () => {
    const c = clients({
      slots: workspace([slot('only', '2026-10-27T04:00:00Z', '2026-10-27T05:00:00Z', 'PUBLISHED')]),
    });
    renderDesk(c);
    expect(await screen.findByRole('note')).toHaveTextContent(/setelah kelas dikonfirmasi/);
    expect(screen.queryByRole('button', { name: 'Tandai hadir' })).toBeNull();
    expect((await screen.findAllByText('Belum hadir')).length).toBeGreaterThan(0);
  });

  it('lets staff open a class that already ended, to mark people present within 2 hours', async () => {
    const user = userEvent.setup();
    const ended = slot('ended', '2026-10-27T02:00:00Z', '2026-10-27T03:00:00Z'); // selesai 90 menit lalu
    const old = slot('old', '2026-10-26T23:00:00Z', '2026-10-27T00:00:00Z'); // selesai 4,5 jam lalu
    const next = slot('later', '2026-10-27T07:00:00Z', '2026-10-27T08:00:00Z', 'PUBLISHED');
    const c = clients({ slots: workspace([old, ended, next]) });
    renderDesk(c);

    // Kelas yang sudah lewat dilipat di bawah, kelas berikutnya tetap terlihat.
    expect(await screen.findByText('Sudah selesai hari ini (2 kelas)')).toBeInTheDocument();
    const all = screen.getByText('Sudah selesai hari ini (2 kelas)').closest('details')!;
    expect(within(all).getAllByRole('button')).toHaveLength(2);

    // Tanpa kelas berjalan, yang terbuka adalah kelas berikutnya; kelas yang baru selesai dipilih dari daftar.
    await user.click(screen.getByText('Sudah selesai hari ini (2 kelas)'));
    await user.click(screen.getByRole('button', { name: /Lihat peserta Reformer Flow 09\.00/ }));
    await waitFor(() =>
      expect(c.bookingClient.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ classSlotId: 'ended' }),
      ),
    );
    expect(await screen.findByRole('button', { name: 'Tandai hadir' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: /Lihat peserta Reformer Flow 06\.00/ }));
    await waitFor(() =>
      expect(c.bookingClient.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ classSlotId: 'old' }),
      ),
    );
    expect(await screen.findByRole('note')).toHaveTextContent(/Lewat 2 jam setelah kelas selesai/);
    expect(screen.queryByRole('button', { name: 'Tandai hadir' })).toBeNull();
  });

  it('opens the last class that ended when nothing is running or coming up', async () => {
    const c = clients({
      slots: workspace([slot('ended', '2026-10-27T02:00:00Z', '2026-10-27T03:00:00Z')]),
    });
    renderDesk(c);
    await waitFor(() =>
      expect(c.bookingClient.list).toHaveBeenCalledWith(
        expect.objectContaining({ classSlotId: 'ended' }),
      ),
    );
    expect(await screen.findByText('Pelanggan Satu')).toBeVisible();
  });

  it('hides the mark button without the attendance permission', async () => {
    capabilities.list = ['class-slot:read', 'booking:read'];
    renderDesk(clients());
    await screen.findByText('Pelanggan Satu');
    expect(screen.queryByRole('button', { name: 'Tandai hadir' })).toBeNull();
  });

  it('memindai QR langsung di Hari ini dan menampilkan keputusan yang boleh diambil', async () => {
    renderDesk(clients());
    expect(
      await screen.findByRole('heading', { name: 'Pindai QR member atau instruktur' }),
    ).toBeVisible();
    expect(screen.getByLabelText('Isi QR')).toBeVisible();
    expect(screen.getByRole('link', { name: /Layar check-in dengan foto member/ })).toHaveAttribute(
      'href',
      '/workspace/check-in',
    );
    expect(screen.queryByRole('button', { name: /Tampilkan QR check-in/ })).toBeNull();
    const kotak = await screen.findByRole('region', { name: 'Perlu tindakan (1)' });
    expect(within(kotak).getByText('Rina Wijaya')).toBeVisible();
    expect(within(kotak).getByRole('button', { name: 'Setujui' })).toBeVisible();
  });

  it('tanpa izin presensi, pemindai tidak tampil', async () => {
    capabilities.list = ['class-slot:read', 'booking:read'];
    renderDesk(clients());
    await screen.findByRole('region', { name: 'Berjalan sekarang' });
    expect(screen.queryByLabelText('Isi QR')).toBeNull();
  });

  it('satu baris tombol: Walk-in, Jual paket, Catat pengeluaran sesuai izin', async () => {
    capabilities.list = [
      'attendance:manage',
      'class-slot:read',
      'booking:read',
      'purchase:record',
      'expense:create',
    ];
    const user = userEvent.setup();
    renderDesk(clients());
    expect(await screen.findByRole('button', { name: 'Walk-in' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Jual paket' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Catat pengeluaran' }));
    const dialog = await screen.findByRole('dialog', { name: 'Catat pengeluaran' });
    expect(within(dialog).getByRole('button', { name: 'Simpan pengeluaran' })).toBeDisabled();
  });

  it('kartu kelas punya Tambah member dan tombol X batal per peserta', async () => {
    capabilities.list = [
      'attendance:manage',
      'class-slot:read',
      'booking:read',
      'booking:create:assisted',
      'booking:cancel:assisted',
    ];
    // Tombol X hanya untuk kelas yang belum dimulai menurut jam sebenarnya.
    const c = clients({ slots: workspace([slot('next', '2099-10-27T07:00:00Z', '2099-10-27T08:00:00Z', 'PUBLISHED')]) });
    (c.bookingClient as unknown as Record<string, unknown>).cancelAsStaff = vi.fn();
    (c.bookingClient as unknown as Record<string, unknown>).searchRosterCandidates = vi
      .fn()
      .mockResolvedValue({ customers: [], packages: [] });
    const user = userEvent.setup();
    renderDesk(c);
    await screen.findByText('Pelanggan Satu');
    expect(screen.getByRole('button', { name: 'Batalkan booking Pelanggan Satu' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Tambah member' }));
    expect(screen.getByLabelText('Tambah member ke Reformer Flow')).toBeVisible();
  });

  it('lists members coming today whose package is almost used up, once per person', async () => {
    const c = clients();
    const startAt = new Date('2026-10-27T04:00:00Z');
    (c.bookingClient.list as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: { classSlotId?: string }) =>
        input.classSlotId
          ? { items: [] }
          : {
              items: [
                booking('a1', 'Sari Dewi', {
                  sessionBalance: { ledgerBalance: 1, reserved: 1, available: 0 },
                  classSlot: { startAt },
                }),
                booking('a2', 'Sari Dewi', {
                  customer: { id: 'c-a1', displayName: 'Sari Dewi', phoneMasked: null },
                  sessionBalance: { ledgerBalance: 1, reserved: 1, available: 0 },
                  classSlot: { startAt: new Date('2026-10-27T09:00:00Z') },
                }),
                booking('a3', 'Maya Putri', {
                  customer: { id: 'c-maya', displayName: 'Maya Putri', phoneMasked: null },
                  sessionBalance: { ledgerBalance: 2, reserved: 1, available: 1 },
                  classSlot: { startAt },
                }),
                booking('a4', 'Banyak Sesi', { classSlot: { startAt } }),
              ],
            },
    );
    renderDesk(c);
    const aside = await screen.findByRole('complementary', { name: 'Paketnya akan habis' });
    expect(await within(aside).findByText('Sari Dewi')).toBeVisible();
    expect(within(aside).getByText('Ini sesi terakhirnya')).toBeVisible();
    expect(within(aside).getByText('Sisa 1 sesi')).toBeVisible();
    expect(within(aside).queryByText('Banyak Sesi')).toBeNull();
    expect(c.bookingClient.list).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: 'branch-1', limit: 100 }),
    );
  });

  it('says so, with a next step, when there are no classes today', async () => {
    renderDesk(clients({ slots: workspace([]) }));
    expect(
      await screen.findByText(/Tidak ada kelas hari ini di Daily Dose Green Garden/),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Buka jadwal kelas' })).toHaveAttribute(
      'href',
      '/workspace/classes',
    );
    // Keputusan yang menunggu tetap tampil meski belum ada kelas.
    expect(await screen.findByRole('region', { name: 'Perlu tindakan (1)' })).toBeVisible();
  });

  it('shows no decision banner when nothing needs attention', async () => {
    renderDesk(clients({ queues: [] }));
    await screen.findByText('Pelanggan Satu');
    expect(screen.queryByText(/menunggu keputusan Anda/)).toBeNull();
  });

  it('opens Walk-In drawer when clicking the primary "Walk-in" button', async () => {
    const user = userEvent.setup();
    const c = clients();
    renderDesk(c);
    const walkInBtn = await screen.findByRole('button', { name: 'Walk-in' });
    expect(walkInBtn).toBeVisible();

    await user.click(walkInBtn);

    expect(await screen.findByText('Alur Cepat Walk-In & Booking Kasir')).toBeInTheDocument();
    expect(screen.getByText('Pilih Status Member')).toBeInTheDocument();
  });
});
