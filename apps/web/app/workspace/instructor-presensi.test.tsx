import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  InstructorTodayView,
  SELANG_CEK_PRESENSI_MS,
  dalamJendelaPresensi,
} from './instructor-today-view';
import type { ClassSlotClient, ClassWorkspace } from '../api-clients/class-slot-client';
import type { BookingClient } from '../api-clients/booking-client';
import type { AvailabilityClient } from '../api-clients/availability-client';

const sesi = {
  id: 'inst-1',
  displayName: 'Sarah Jenkins',
  roles: ['INSTRUCTOR'],
  capabilities: ['class-slot:read', 'attendance:self'],
  branches: [{ id: 'b-1', code: 'TBT', name: 'Tebet', timezone: 'Asia/Jakarta' }],
};
vi.mock('../session-context', () => ({
  useSessionContext: () => ({ session: sesi, activeBranch: sesi.branches[0], hasCapability: () => true }),
}));

// Kelas 10.00 WIB (03.00Z); sekarang 09.40 WIB, di dalam jendela 45 menit sebelum sampai 10 menit sesudah.
const MULAI = new Date('2026-11-23T03:00:00.000Z');
const SEKARANG = new Date('2026-11-23T02:40:00.000Z').getTime();

const workspace = (checkedInAt: string | null): ClassWorkspace => ({
  slots: [
    {
      id: 'slot-1',
      branchId: 'b-1',
      classTypeId: 't-1',
      studioId: 's-1',
      instructorUserId: 'inst-1',
      startAt: MULAI,
      endAt: new Date(MULAI.getTime() + 50 * 60_000),
      timezone: 'Asia/Jakarta',
      status: 'PUBLISHED',
      minimumQuota: 1,
      capacity: 6,
      bookedCount: 2,
      version: 1,
      instructorAttendance: checkedInAt ? { checkedInAt, method: 'QR_SCAN' } : null,
    },
  ],
  classTypes: [{ id: 't-1', code: 'RF', name: 'Reformer Flow' }],
  instructors: [],
  studios: [{ id: 's-1', branchId: 'b-1', code: 'S1', name: 'Studio 1', rooms: [] }],
});

const availability = {
  list: vi.fn().mockResolvedValue({ items: [], page: { hasMore: false, nextCursor: null } }),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
} as AvailabilityClient;
const selfie = { mine: vi.fn().mockResolvedValue({ status: 'APPROVED' }), submit: vi.fn() } as never;

describe('Presensi instruktur di HP', () => {
  afterEach(() => vi.useRealTimers());

  it('jendela presensi: 45 menit sebelum sampai 10 menit setelah kelas mulai', () => {
    expect(dalamJendelaPresensi(MULAI, MULAI.getTime() - 46 * 60_000)).toBe(false);
    expect(dalamJendelaPresensi(MULAI, MULAI.getTime() - 45 * 60_000)).toBe(true);
    expect(dalamJendelaPresensi(MULAI, MULAI.getTime() + 10 * 60_000)).toBe(true);
    expect(dalamJendelaPresensi(MULAI, MULAI.getTime() + 11 * 60_000)).toBe(false);
  });

  it('memeriksa ulang selama jendela terbuka, lalu banner "Presensi tercatat" tetap tampil', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const discover = vi
      .fn()
      .mockResolvedValueOnce(workspace(null))
      .mockResolvedValue(workspace('2026-11-23T02:42:00.000Z'));
    render(
      <InstructorTodayView
        client={{ discover } as unknown as ClassSlotClient}
        bookingClient={{ list: vi.fn() } as unknown as BookingClient}
        availabilityClient={availability}
        selfieClient={selfie}
        initialDate={new Date(SEKARANG)}
        now={() => SEKARANG}
        muatQr={() => Promise.resolve('dd-pass:v1:x')}
      />,
    );
    expect(await screen.findByText('NANTI')).toBeVisible();
    expect(screen.queryByRole('status', { name: 'Presensi tercatat' })).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SELANG_CEK_PRESENSI_MS);
    });
    const banner = await screen.findByRole('status', { name: 'Presensi tercatat' });
    expect(banner).toHaveTextContent('Presensi tercatat pukul 09.42');
    expect(discover).toHaveBeenCalledTimes(2);

    // Tidak hilang sendiri: lewat beberapa menit banner masih ada, dan pemeriksaan berhenti.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(screen.getByRole('status', { name: 'Presensi tercatat' })).toBeVisible();
    expect(discover).toHaveBeenCalledTimes(2);
  });

  it('daftar peserta menandai kursi teman: "Teman dari" pemilik paket', async () => {
    const user = userEvent.setup();
    const bookingClient = {
      list: vi.fn().mockResolvedValue({
        items: [
          { id: 'bk-1', status: 'BOOKED', customer: { id: 'c-1', displayName: 'Bu Ratna' } },
          { id: 'bk-2', status: 'BOOKED', kursiTeman: true, namaTeman: 'Rani', customer: { id: 'c-1', displayName: 'Bu Ratna' } },
        ],
      }),
    } as unknown as BookingClient;
    render(
      <InstructorTodayView
        client={{ discover: vi.fn().mockResolvedValue(workspace(null)) } as unknown as ClassSlotClient}
        bookingClient={bookingClient}
        availabilityClient={availability}
        selfieClient={selfie}
        initialDate={new Date(SEKARANG)}
        now={() => SEKARANG}
        muatQr={() => Promise.resolve('dd-pass:v1:x')}
      />,
    );
    await user.click(await screen.findByRole('button', { name: /Sesi Reformer Flow/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Peserta Sesi' });
    expect(await within(dialog).findByText('Rani')).toBeVisible();
    expect(within(dialog).getByText('Teman dari Bu Ratna')).toBeVisible();
  });

  it('Jadwal Saya: kelas seminggu dengan kartu yang sama, minggu berikutnya bisa dibuka', async () => {
    const user = userEvent.setup();
    const discover = vi.fn().mockResolvedValue(workspace(null));
    render(
      <InstructorTodayView
        mode="minggu"
        client={{ discover } as unknown as ClassSlotClient}
        bookingClient={{ list: vi.fn() } as unknown as BookingClient}
        availabilityClient={availability}
        selfieClient={selfie}
        initialDate={new Date(SEKARANG)}
        now={() => SEKARANG}
      />,
    );
    expect(await screen.findByRole('heading', { name: 'Jadwal Saya' })).toBeVisible();
    expect(await screen.findByText('Senin, 23 Nov')).toBeVisible();
    // Senin 00.00 sampai Minggu 23.59 WIB.
    expect(discover.mock.calls[0]![0]).toMatchObject({
      from: new Date('2026-11-22T17:00:00.000Z'),
      until: new Date('2026-11-29T16:59:00.000Z'),
    });
    // QR dan kartu ketersediaan hanya di Hari Ini.
    expect(screen.queryByRole('heading', { name: 'QR kehadiran saya' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Minggu berikutnya' }));
    await waitFor(() =>
      expect(discover.mock.calls.at(-1)![0]).toMatchObject({ from: new Date('2026-11-29T17:00:00.000Z') }),
    );
  });
});
