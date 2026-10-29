import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InstructorTodayView } from './instructor-today-view';
import type { ClassSlotClient, ClassWorkspace } from '../api-clients/class-slot-client';
import type { BookingClient } from '../api-clients/booking-client';
import type { AvailabilityClient } from '../api-clients/availability-client';

const mockSession = {
  id: 'user-inst-1',
  displayName: 'Sarah Jenkins',
  roles: ['INSTRUCTOR'],
  capabilities: ['class-slot:read', 'attendance:self', 'availability:self:read'],
  branches: [
    { id: 'branch-1', code: 'TBT', name: 'Studio Daily Dose Tebet', timezone: 'Asia/Jakarta' },
  ],
};

vi.mock('../session-context', () => ({
  useSessionContext: () => ({
    session: mockSession,
    activeBranchId: 'branch-1',
    activeBranch: mockSession.branches[0],
    hasCapability: (cap: string) => mockSession.capabilities.includes(cap),
  }),
}));

const testDate = new Date('2026-10-26T09:00:00.000Z');

const mockWorkspace: ClassWorkspace = {
  slots: [
    {
      id: 'slot-1',
      branchId: 'branch-1',
      classTypeId: 'type-1',
      studioId: 'studio-1',
      instructorUserId: 'user-inst-1',
      startAt: new Date('2026-10-26T02:00:00.000Z'), // 09:00 WIB
      endAt: new Date('2026-10-26T02:50:00.000Z'), // 09:50 WIB
      timezone: 'Asia/Jakarta',
      status: 'PUBLISHED',
      minimumQuota: 1,
      capacity: 6,
      bookedCount: 4,
      version: 1,
      instructorAttendance: { checkedInAt: '2026-10-26T01:55:00.000Z', method: 'QR_SCAN' },
    },
    {
      id: 'slot-2',
      branchId: 'branch-1',
      classTypeId: 'type-2',
      studioId: 'studio-1',
      instructorUserId: 'user-inst-1',
      startAt: new Date('2026-10-26T07:00:00.000Z'), // 14:00 WIB
      endAt: new Date('2026-10-26T07:50:00.000Z'), // 14:50 WIB
      timezone: 'Asia/Jakarta',
      status: 'PUBLISHED',
      minimumQuota: 1,
      capacity: 6,
      bookedCount: 2,
      version: 1,
      instructorAttendance: null, // Nanti
    },
  ],
  classTypes: [
    { id: 'type-1', code: 'RF1', name: 'Reformer Flow Level 1' },
    { id: 'type-2', code: 'RF2', name: 'Reformer Intermediate' },
  ],
  instructors: [
    { id: 'user-inst-1', displayName: 'Sarah Jenkins' },
  ],
  studios: [
    { id: 'studio-1', branchId: 'branch-1', code: 'S1', name: 'Studio 1 - Tebet', rooms: [] },
  ],
};

const mockSlotClient = {
  discover: vi.fn().mockResolvedValue(mockWorkspace),
  create: vi.fn(),
  update: vi.fn(),
  assign: vi.fn(),
  publish: vi.fn(),
  cancel: vi.fn(),
  completionControl: vi.fn(),
  complete: vi.fn(),
} as unknown as ClassSlotClient;

const mockBookingClient = {
  list: vi.fn().mockResolvedValue({
    items: [
      {
        id: 'booking-1',
        status: 'ATTENDED',
        customer: { id: 'cust-1', displayName: 'Budi Santoso' },
      },
      {
        id: 'booking-2',
        status: 'BOOKED',
        customer: { id: 'cust-2', displayName: 'Dewi Lestari' },
      },
    ],
    nextCursor: null,
  }),
} as unknown as BookingClient;

const mockAvailabilityClient: AvailabilityClient = {
  list: vi.fn().mockResolvedValue({
    items: [
      {
        id: 'avail-1',
        instructorUserId: 'user-inst-1',
        branchId: 'branch-1',
        startAt: new Date('2026-10-27T02:00:00.000Z'),
        endAt: new Date('2026-10-27T05:00:00.000Z'),
        timezone: 'Asia/Jakarta',
        version: 1,
        status: 'ACTIVE',
      },
    ],
    page: { hasMore: false, nextCursor: null },
  }),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
};

describe('InstructorTodayView (Tiket T-10 / Spesifikasi 5.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders header with instructor first name, formatted date, and studio name', async () => {
    render(
      <InstructorTodayView
        client={mockSlotClient}
        bookingClient={mockBookingClient}
        availabilityClient={mockAvailabilityClient}
        initialDate={testDate}
      />,
    );

    const judul = await screen.findByRole('heading', { level: 1, name: /Halo, Sarah/i });
    // Cabang di header diambil dari kelas hari ini.
    expect(await within(judul.parentElement!).findByText(/Studio Daily Dose Tebet/i)).toBeVisible();
  });

  it('memuat kelas dari semua cabang instruktur dan menyebut cabang tiap kelas (instruktur GG dan MK)', async () => {
    const asli = mockSession.branches;
    mockSession.branches = [
      { id: 'gg', code: 'GG', name: 'Daily Dose Green Garden', timezone: 'Asia/Jakarta' },
      { id: 'mk', code: 'MK', name: 'Daily Dose Muara Karang', timezone: 'Asia/Jakarta' },
    ];
    const client = {
      ...mockSlotClient,
      discover: vi.fn().mockResolvedValue({
        ...mockWorkspace,
        slots: [{ ...mockWorkspace.slots[0]!, branchId: 'mk' }],
        classTypes: [],
        studios: [],
      }),
    } as unknown as typeof mockSlotClient;
    try {
      render(
        <InstructorTodayView
          client={client}
          bookingClient={mockBookingClient}
          availabilityClient={mockAvailabilityClient}
          initialDate={testDate}
        />,
      );
      const judul = await screen.findByRole('heading', { level: 1, name: /Halo, Sarah/i });
      expect(await within(judul.parentElement!).findByText(/Daily Dose Muara Karang/)).toBeVisible();
      expect(within(judul.parentElement!).queryByText(/Green Garden/)).toBeNull();
      const argumen = (client.discover as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(argumen.branchId).toBeUndefined();
      expect(argumen.branches.map((b: { id: string }) => b.id)).toEqual(['gg', 'mk']);
    } finally {
      mockSession.branches = asli;
    }
  });

  it('asks an instructor without a selfie to take one, and hides the prompt once saved', async () => {
    const user = userEvent.setup();
    const selfieClient = {
      mine: vi.fn().mockResolvedValue({ status: 'ACTION_REQUIRED', documents: [] }),
      submit: vi.fn().mockResolvedValue({ status: 'APPROVED', message: 'ok' }),
    };
    render(
      <InstructorTodayView
        client={mockSlotClient}
        bookingClient={mockBookingClient}
        availabilityClient={mockAvailabilityClient}
        initialDate={testDate}
        muatQr={() => Promise.resolve('dd-pass:v1:instruktur')}
        selfieClient={selfieClient as never}
      />,
    );
    expect(await screen.findByRole('heading', { name: 'Ambil foto selfie dulu' })).toBeVisible();
    const foto = new File(['x'], 'selfie.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText('Pilih foto selfie'), foto);
    await user.click(screen.getByRole('button', { name: 'Simpan foto selfie' }));
    expect(selfieClient.submit).toHaveBeenCalledWith({ selfie: foto });
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Ambil foto selfie dulu' })).toBeNull(),
    );
  });

  it('shows the instructor own static QR at the top of the home page', async () => {
    render(
      <InstructorTodayView
        client={mockSlotClient}
        bookingClient={mockBookingClient}
        availabilityClient={mockAvailabilityClient}
        initialDate={testDate}
        muatQr={() => Promise.resolve('dd-pass:v1:instruktur')}
      />,
    );

    const judul = await screen.findAllByRole('heading', { level: 2 });
    expect(judul[0]).toHaveTextContent('QR kehadiran saya');
    expect(screen.getByText(/Tunjukkan ke staf di meja check-in/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Perbesar' })).toHaveAttribute('href', '/check-in-pass');
  });

  it('renders assigned classes with 22px time, duration, studio, quota, and HADIR / NANTI status badge', async () => {
    render(
      <InstructorTodayView
        client={mockSlotClient}
        bookingClient={mockBookingClient}
        availabilityClient={mockAvailabilityClient}
        initialDate={testDate}
      />,
    );

    expect(await screen.findByText('Reformer Flow Level 1')).toBeInTheDocument();
    expect(screen.getByText('Reformer Intermediate')).toBeInTheDocument();

    // Check status badges
    expect(screen.getByText('HADIR')).toBeInTheDocument();
    expect(screen.getByText('NANTI')).toBeInTheDocument();

    // Check participant quota
    expect(screen.getByText('4/6 peserta')).toBeInTheDocument();
    expect(screen.getByText('2/6 peserta')).toBeInTheDocument();

    // Check duration
    const durations = screen.getAllByText('50 menit');
    expect(durations.length).toBeGreaterThanOrEqual(2);
  });

  it('shows empty state when no classes are scheduled today', async () => {
    const emptyClient: ClassSlotClient = {
      ...mockSlotClient,
      discover: vi.fn().mockResolvedValue({
        slots: [],
        classTypes: [],
        instructors: [],
        studios: [],
      }),
    };

    render(
      <InstructorTodayView
        client={emptyClient}
        bookingClient={mockBookingClient}
        availabilityClient={mockAvailabilityClient}
        initialDate={testDate}
      />,
    );

    expect(
      await screen.findByText('Tidak ada kelas terjadwal untuk kamu hari ini.'),
    ).toBeInTheDocument();

    const weeklyButton = screen.getByRole('link', { name: /Buka jadwal mingguan/i });
    expect(weeklyButton).toBeInTheDocument();
    expect(weeklyButton.getAttribute('href')).toBe('/workspace/classes');
  });

  it('opens attendee panel on card click with HADIR/NANTI badges and privacy footnote without payment data', async () => {
    const user = userEvent.setup();

    render(
      <InstructorTodayView
        client={mockSlotClient}
        bookingClient={mockBookingClient}
        availabilityClient={mockAvailabilityClient}
        initialDate={testDate}
      />,
    );

    const firstCard = await screen.findByRole('button', {
      name: /Sesi Reformer Flow Level 1/i,
    });
    await user.click(firstCard);

    // Attendee panel appears
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Peserta Sesi' })).toBeInTheDocument();

    // Participants list
    expect(screen.getByText('Budi Santoso')).toBeInTheDocument();
    expect(screen.getByText('Dewi Lestari')).toBeInTheDocument();

    // Required privacy footnote (Spec 5.4 point 4)
    expect(
      screen.getByText('Instruktur tidak melihat data pembayaran peserta.'),
    ).toBeInTheDocument();
  });

  it('renders availability summary card with link to /workspace/availability', async () => {
    render(
      <InstructorTodayView
        client={mockSlotClient}
        bookingClient={mockBookingClient}
        availabilityClient={mockAvailabilityClient}
        initialDate={testDate}
      />,
    );

    expect(await screen.findByRole('heading', { level: 2, name: /Ketersediaan Mengajar/i })).toBeInTheDocument();
    expect(screen.getByText(/1 slot ketersediaan mengajar aktif diajukan/i)).toBeInTheDocument();

    const manageLink = screen.getByRole('link', { name: 'Atur' });
    expect(manageLink).toBeInTheDocument();
    expect(manageLink.getAttribute('href')).toBe('/workspace/availability');
  });
});
