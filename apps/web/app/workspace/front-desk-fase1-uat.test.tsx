import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppFeedbackProvider } from '../components/app-feedback';
import type { ClassSlot, ClassSlotClient, ClassWorkspace } from '../api-clients/class-slot-client';
import type { BookingClient } from '../api-clients/booking-client';
import type { DashboardClient } from '../api-clients/dashboard-client';
import { FrontDeskTodayView } from './front-desk-today-view';
import { CreatePanel } from '../classes/class-slot-panels';
import { ATTENDANCE_REASON_PRESETS, attendanceWindow } from './front-desk-today';

const capabilities = vi.hoisted(() => ({
  list: ['attendance:manage', 'class-slot:read', 'booking:read'] as string[],
}));

const branch1 = {
  id: 'branch-1',
  code: 'DD-GG',
  name: 'Daily Dose Green Garden',
  timezone: 'Asia/Jakarta',
};

const branch2 = {
  id: 'branch-2',
  code: 'DD-MK',
  name: 'Daily Dose Muara Karang',
  timezone: 'Asia/Jakarta',
};

const mockSetActiveBranchId = vi.fn();
let mockActiveBranch: typeof branch1 | null = branch1;

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
      branches: [branch1, branch2],
    },
    activeBranchId: mockActiveBranch?.id ?? '',
    activeBranch: mockActiveBranch,
    setActiveBranchId: mockSetActiveBranchId,
    hasCapability: (cap: string) => capabilities.list.includes(cap),
  }),
}));

const now = new Date('2026-10-27T04:30:00.000Z');

const slot = (id: string, startUtc: string, endUtc: string, status = 'CONFIRMED'): ClassSlot => ({
  id,
  branchId: 'branch-1',
  classTypeId: 'type-1',
  studioId: 'studio-1',
  instructorUserId: 'inst-1',
  startAt: new Date(startUtc),
  endAt: new Date(endUtc),
  capacity: 6,
  minimumQuota: 1,
  timezone: 'Asia/Jakarta',
  bookedCount: 4,
  status,
  version: 1,
});

const workspace: ClassWorkspace = {
  slots: [
    slot('s-1', '2026-10-27T04:00:00.000Z', '2026-10-27T05:00:00.000Z'),
    slot('s-2', '2026-10-27T07:00:00.000Z', '2026-10-27T08:00:00.000Z'),
  ],
  classTypes: [{ id: 'type-1', code: 'RF', name: 'Reformer Flow' }],
  studios: [{ id: 'studio-1', code: 'ST-1', branchId: 'branch-1', name: 'Studio Utama', rooms: [] }],
  instructors: [{ id: 'inst-1', displayName: 'Coach Sarah' }],
};

const makeClients = () => ({
  classClient: {
    discover: vi.fn().mockResolvedValue(workspace),
  } as unknown as ClassSlotClient,
  bookingClient: {
    list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    backfillAttendance: vi.fn().mockResolvedValue(undefined),
  } as unknown as BookingClient,
  dashboardClient: {
    overview: vi.fn().mockResolvedValue({ queues: [], sections: {} }),
  } as unknown as DashboardClient,
});

describe('FASE 1 UAT & NEGATIVE VERIFICATION (QA REPORT)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveBranch = branch1;
    capabilities.list = ['attendance:manage', 'class-slot:read', 'booking:read', 'class-slot:manage'];
  });

  // --------------------------------------------------------------------------
  // 1. HAPPY PATH: BERANDA MEJA DEPAN TERBUKA DENGAN CABANG TERPILIH
  // --------------------------------------------------------------------------
  it('UAT Happy Path 1: Menampilkan jadwal berjalan dan berikutnya jika cabang aktif terpilih', async () => {
    const c = makeClients();
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

    const running = await screen.findByRole('region', { name: 'Berjalan sekarang' });
    expect(within(running).getByText('11.00 – 12.00')).toBeVisible();
    expect(within(running).getByText('Reformer Flow')).toBeVisible();
  });

  // --------------------------------------------------------------------------
  // 2. NO HAPPY PATH: ADMIN MULTI-CABANG TANPA CABANG AKTIF (!branch)
  // --------------------------------------------------------------------------
  it('UAT No Happy Path 1: Ketika cabang belum dipilih, tidak crash dan menampilkan tombol interaktif ramah awam', async () => {
    mockActiveBranch = null; // Simulasi belum pilih cabang
    const c = makeClients();
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

    expect(
      screen.getByText(/Pilih cabang aktif di bagian atas supaya jadwal dan daftar hadir cabang itu tampil/),
    ).toBeVisible();
    expect(screen.getByText('Atau pilih cabang bertugas Anda hari ini:')).toBeVisible();

    // Verifikasi tombol cabang interaktif muncul untuk seluruh cabang yang dimiliki staf
    const btnGG = screen.getByRole('button', { name: /🏢 Daily Dose Green Garden/ });
    const btnMK = screen.getByRole('button', { name: /🏢 Daily Dose Muara Karang/ });
    expect(btnGG).toBeVisible();
    expect(btnMK).toBeVisible();

    // Klik tombol cabang interaktif
    await userEvent.click(btnMK);
    expect(mockSetActiveBranchId).toHaveBeenCalledWith('branch-2');
  });

  // --------------------------------------------------------------------------
  // 3. HAPPY PATH & NO HAPPY PATH: PRESET DURASI CEPAT (+50 mnt, +60 mnt)
  // --------------------------------------------------------------------------
  it('UAT Happy Path & No Happy Path 2: Preset durasi cepat di form buat kelas', async () => {
    const handleCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <CreatePanel
        busy={false}
        formId="test-form"
        classTypes={workspace.classTypes}
        studios={workspace.studios}
        instructors={workspace.instructors}
        branches={[branch1, branch2]}
        branchId="branch-1"
        timezone="Asia/Jakarta"
        onCreate={handleCreate}
      />,
    );

    const startTimeInput = screen.getByLabelText('Mulai');
    const endTimeInput = screen.getByLabelText('Selesai eksklusif');

    // NO HAPPY PATH: Sebelum Mulai diisi, tombol preset durasi cepat tidak ada (aman dari salah kalkulasi)
    expect(screen.queryByRole('button', { name: '+50 mnt' })).toBeNull();

    // HAPPY PATH: Isi Waktu Mulai 08:00
    await userEvent.type(startTimeInput, '08:00');

    // Tombol preset muncul
    const btn50 = await screen.findByRole('button', { name: '+50 mnt' });
    const btn60 = screen.getByRole('button', { name: '+60 mnt' });
    expect(btn50).toBeVisible();
    expect(btn60).toBeVisible();

    // Klik +50 mnt -> Harap endTime jadi 08:50
    await userEvent.click(btn50);
    expect(endTimeInput).toHaveValue('08:50');

    // Klik +60 mnt -> Harap endTime jadi 09:00
    await userEvent.click(btn60);
    expect(endTimeInput).toHaveValue('09:00');
  });

  // --------------------------------------------------------------------------
  // 4. HUMANISASI ISTILAH PRESENSI & PRESET OPERASIONAL
  // --------------------------------------------------------------------------
  it('UAT Happy Path 3: Preset presensi ramah awam tersedia', () => {
    expect(ATTENDANCE_REASON_PRESETS).toContain('Hadir langsung di studio (tanpa HP)');
    expect(ATTENDANCE_REASON_PRESETS).toContain('Ponsel pelanggan bermasalah saat konfirmasi');
    expect(ATTENDANCE_REASON_PRESETS).toContain('Pelanggan hadir tetapi belum mengonfirmasi lewat tautan');
    expect(ATTENDANCE_REASON_PRESETS).toContain('Petugas melihat langsung pelanggan mengikuti kelas');
  });

  // --------------------------------------------------------------------------
  // 5. NO HAPPY PATH: TOLERANSI KOREKSI ABSENSI 2 JAM (GRACE PERIOD)
  // --------------------------------------------------------------------------
  it('UAT No Happy Path 3: Kelas yang sudah selesai lebih dari 2 jam tidak dapat dipresensi susulan', () => {
    // Kelas selesai jam 05.00 UTC, sekarang jam 08.30 UTC (lewat 3.5 jam)
    const oldEndedSlot = slot('s-old', '2026-10-27T04:00:00.000Z', '2026-10-27T05:00:00.000Z');
    const lateNow = new Date('2026-10-27T08:30:00.000Z');

    const win = attendanceWindow(oldEndedSlot, lateNow);
    expect(win.open).toBe(false);
    expect(win.reason).toMatch(/Lewat 2 jam setelah kelas selesai/);
    expect(win.reason).toMatch(/hubungi Manager jika perlu susulan/);
  });
});
