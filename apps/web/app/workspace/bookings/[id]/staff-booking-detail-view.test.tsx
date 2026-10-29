import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppFeedbackProvider } from '@/components/app-feedback';
import { describe, expect, it, vi } from 'vitest';
import type { BookingClient } from '@/api-clients/booking-client';
import { StaffBookingDetailView } from './staff-booking-detail-view';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
let caps = ['attendance:manage', 'booking:read'];
vi.mock('../../../session-context', () => ({
  useSessionContext: () => ({
    status: 'authenticated',
    activeBranchId: 'branch-1',
    session: { id: 'admin-1', roles: ['ADMIN'], capabilities: caps },
    hasCapability: (...wanted: string[]) => wanted.some((cap) => caps.includes(cap)),
  }),
}));

const hour = 3_600_000;
const bookingAt = (startOffsetH: number, overrides: Record<string, unknown> = {}) => ({
  id: 'booking-1',
  bookingNumber: 'B-1',
  branchId: 'branch-1',
  classSlotId: 'slot-1',
  customerUserId: 'u-1',
  customerPackageId: 'p-1',
  status: 'BOOKED',
  source: 'SELF',
  version: 1,
  createdAt: new Date(Date.now() - 48 * hour),
  customer: { id: 'u-1', displayName: 'Pelanggan Uji', phoneMasked: null },
  package: { id: 'p-1', name: 'Paket 10 Sesi' },
  branch: { id: 'branch-1', name: 'Green Garden', timezone: 'Asia/Jakarta' },
  classSlot: {
    id: 'slot-1',
    startAt: new Date(Date.now() + startOffsetH * hour),
    endAt: new Date(Date.now() + (startOffsetH + 1) * hour),
    timezone: 'Asia/Jakarta',
    status: 'CONFIRMED',
    classType: { id: 't-1', name: 'Reformer Flow' },
  },
  ...overrides,
});

const clientFor = (booking: unknown) =>
  ({
    detail: vi.fn().mockResolvedValue(booking),
    issueCheckIn: vi.fn(),
  }) as unknown as BookingClient;

describe('StaffBookingDetailView QR check-in (T-16)', () => {
  it('offers the QR button while the class can still check people in', async () => {
    render(<StaffBookingDetailView id="booking-1" client={clientFor(bookingAt(2))} />);
    expect(await screen.findByRole('button', { name: 'Buat Token QR Check-in' })).toBeVisible();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('does not offer the QR button once the class has ended, and points to the catch-up route', async () => {
    render(<StaffBookingDetailView id="booking-1" client={clientFor(bookingAt(-3))} />);
    expect(await screen.findByRole('note')).toHaveTextContent(/QR check-in tidak bisa dibuat/);
    expect(screen.getByRole('note')).toHaveTextContent(/halaman Hari ini/);
    expect(screen.queryByRole('button', { name: /QR/ })).not.toBeInTheDocument();
  });

  it('does not offer the QR button for a cancelled class slot', async () => {
    const booking = bookingAt(2);
    (booking.classSlot as { status: string }).status = 'CANCELLED';
    render(<StaffBookingDetailView id="booking-1" client={clientFor(booking)} />);
    expect(await screen.findByRole('note')).toBeVisible();
    expect(screen.queryByRole('button', { name: /QR/ })).not.toBeInTheDocument();
  });
});

describe('StaffBookingDetailView pembatalan', () => {
  it('booking Hadir dari V1 untuk kelas yang belum berjalan bisa diajukan batal dari halaman ini', async () => {
    caps = ['attendance:manage', 'booking:read', 'booking:cancel:assisted'];
    const client = {
      detail: vi.fn().mockResolvedValue(bookingAt(30, { status: 'ATTENDED' })),
      cancelAsStaff: vi.fn(),
      cancellationOptions: vi.fn(),
      ajukanPembatalanTerlambat: vi.fn().mockResolvedValue({ id: 'r1' }),
      pembatalanTertunda: vi.fn().mockResolvedValue([]),
    } as unknown as BookingClient;
    render(
      <AppFeedbackProvider>
        <StaffBookingDetailView id="booking-1" client={client} />
      </AppFeedbackProvider>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Batalkan booking' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ajukan pembatalan Pelanggan Uji?' });
    await user.type(within(dialog).getByLabelText(/Alasan/), 'Member sakit, kabar lewat WA');
    await user.click(within(dialog).getByRole('button', { name: 'Kirim pengajuan' }));
    expect(client.ajukanPembatalanTerlambat).toHaveBeenCalledWith(
      'booking-1',
      'Member sakit, kabar lewat WA',
    );
    expect(client.cancelAsStaff).not.toHaveBeenCalled();
  });
});
