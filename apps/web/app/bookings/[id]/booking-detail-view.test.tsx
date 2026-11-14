import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingClient, CustomerRescheduleOptions } from '@/api-clients/booking-client';
import { BookingDetailView } from './booking-detail-view';

const sessionState = vi.hoisted(() => ({ context: null as any }));
vi.mock('../../session-context', () => ({
  useSessionContext: () => sessionState.context,
}));

const bookingId = '00000000-0000-4000-8000-000000000401';
const sourceId = '00000000-0000-4000-8000-000000000402';
const targetId = '00000000-0000-4000-8000-000000000403';
const booking = {
  id: bookingId,
  branchId: '00000000-0000-4000-8000-000000000404',
  classSlotId: sourceId,
  customerUserId: '00000000-0000-4000-8000-000000000405',
  customerPackageId: '00000000-0000-4000-8000-000000000406',
  reservationId: '00000000-0000-4000-8000-000000000407',
  createdById: '00000000-0000-4000-8000-000000000405',
  source: 'SELF' as const,
  status: 'BOOKED' as const,
  reservedQuantity: 1,
  version: 0,
  createdAt: new Date('2026-08-01T00:00:00Z'),
  idempotentReplay: false,
  branch: { id: '00000000-0000-4000-8000-000000000404', name: 'Jakarta', timezone: 'Asia/Jakarta' },
  classSlot: {
    id: sourceId,
    startAt: new Date('2026-08-10T03:00:00Z'),
    endAt: new Date('2026-08-10T04:00:00Z'),
    timezone: 'Asia/Jakarta',
    status: 'CONFIRMED',
    classType: { id: '00000000-0000-4000-8000-000000000408', name: 'Reformer' },
  },
  package: { id: '00000000-0000-4000-8000-000000000409', name: 'Reformer 10' },
};

const eligible: CustomerRescheduleOptions = {
  bookingId,
  bookingVersion: 0,
  sourceClassSlotId: sourceId,
  cutoffAt: new Date('2026-08-09T03:00:00Z'),
  canRequest: true,
  unavailableReason: null,
  supportAction: null,
  latestRequest: null,
  targets: [
    {
      id: targetId,
      startAt: new Date('2026-08-12T03:00:00Z'),
      endAt: new Date('2026-08-12T04:00:00Z'),
      timezone: 'Asia/Jakarta',
      status: 'PUBLISHED',
      availableCapacity: 3,
      branch: { id: booking.branchId, name: 'Jakarta', timezone: 'Asia/Jakarta' },
      classType: booking.classSlot.classType,
    },
  ],
};

const request = {
  id: '00000000-0000-4000-8000-000000000410',
  branchId: booking.branchId,
  bookingId,
  sourceClassSlotId: sourceId,
  targetClassSlotId: targetId,
  requestedById: booking.customerUserId,
  requestReasonCode: 'PERSONAL_UNAVAILABLE' as const,
  status: 'PENDING' as const,
  entitlementCutoffAt: eligible.cutoffAt,
  entitledAtRequest: true as const,
  requestedAt: new Date('2026-08-01T01:00:00Z'),
  version: 0,
};

const makeClient = (options: CustomerRescheduleOptions): BookingClient => ({
  discover: vi.fn(),
  options: vi.fn(),
  list: vi.fn(),
  detail: vi.fn().mockResolvedValue(booking),
  rescheduleOptions: vi.fn().mockResolvedValue(options),
  create: vi.fn(),
  cancel: vi.fn().mockResolvedValue(undefined),
  listReschedules: vi.fn(),
  requestReschedule: vi.fn().mockResolvedValue(request),
  decideReschedule: vi.fn(),
});

describe('BookingDetailView reschedule customer', () => {
  beforeEach(() => {
    sessionState.context = null;
  });

  it('submits an eligible request through an explicit confirmation step', async () => {
    const client = makeClient(eligible);
    vi.mocked(client.rescheduleOptions)
      .mockResolvedValueOnce(eligible)
      .mockResolvedValueOnce({
        ...eligible,
        canRequest: false,
        unavailableReason: 'RESCHEDULE_PENDING',
        latestRequest: request,
        targets: [],
      });
    const view = render(<BookingDetailView id={bookingId} client={client} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Ajukan reschedule' }));
    expect((await axe(view.container)).violations).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Tinjau permintaan' }));
    expect(screen.getByText('Konfirmasi perubahan jadwal')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Kirim permintaan' }));

    expect(client.requestReschedule).toHaveBeenCalledWith(
      {
        bookingId,
        targetClassSlotId: targetId,
        reasonCode: 'PERSONAL_UNAVAILABLE',
        expectedBookingVersion: 0,
      },
      expect.any(String),
    );
    expect(await screen.findByText('Reschedule sedang ditinjau')).toBeVisible();
  });

  it('shows studio guidance after the inclusive cutoff has passed', async () => {
    const client = makeClient({
      ...eligible,
      canRequest: false,
      unavailableReason: 'RESCHEDULE_CUTOFF_PASSED',
      supportAction: 'CONTACT_STUDIO',
      targets: [],
    });
    render(<BookingDetailView id={bookingId} client={client} />);
    expect(await screen.findByText('Batas reschedule telah lewat')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Ajukan reschedule' })).not.toBeInTheDocument();
  });

  describe('cancel button follows what the API allows (T-16)', () => {
    const cutoff = {
      canCancel: false,
      unavailableReason: 'CANCELLATION_CUTOFF_PASSED',
      supportAction: 'CONTACT_STUDIO',
      cutoffAt: '2026-08-09T03:00:00Z',
    };
    const withCancelCheck = (result: unknown) => {
      const client = makeClient(eligible);
      client.cancellationOptions = result instanceof Error ? vi.fn().mockRejectedValue(result) : vi.fn().mockResolvedValue(result);
      return client;
    };

    it('offers the button while cancelling is still possible', async () => {
      const client = withCancelCheck({ ...cutoff, canCancel: true, unavailableReason: null, supportAction: null });
      render(<BookingDetailView id={bookingId} client={client} />);
      expect(await screen.findByRole('button', { name: 'Batalkan booking' })).toBeVisible();
      expect(client.cancellationOptions).toHaveBeenCalledWith(bookingId);
    });

    it('states the self-service limit from the API cutoff, not a fixed H-24', async () => {
      // Kelas mulai 2026-08-10T03:00Z, cutoff 12 jam sebelumnya.
      const client = withCancelCheck({ ...cutoff, canCancel: true, unavailableReason: null, supportAction: null, cutoffAt: '2026-08-09T15:00:00Z' });
      render(<BookingDetailView id={bookingId} client={client} />);
      expect(await screen.findByText(/dapat dilakukan paling lambat 12 jam sebelum kelas dimulai\./)).toBeVisible();
      expect(screen.queryByText(/H-24/)).not.toBeInTheDocument();
    });

    it('hides the button after the cutoff and says why, with the time', async () => {
      render(<BookingDetailView id={bookingId} client={withCancelCheck(cutoff)} />);
      expect(await screen.findByRole('note')).toHaveTextContent(/Batas pembatalan mandiri ditutup pada/);
      expect(screen.getByRole('note')).toHaveTextContent(/Hubungi studio/);
      expect(screen.queryByRole('button', { name: 'Batalkan booking' })).not.toBeInTheDocument();
    });

    it('does not repeat the explanation when the reschedule banner already gives it', async () => {
      const client = withCancelCheck(cutoff);
      vi.mocked(client.rescheduleOptions).mockResolvedValue({
        ...eligible,
        canRequest: false,
        unavailableReason: 'RESCHEDULE_CUTOFF_PASSED',
        supportAction: 'CONTACT_STUDIO',
        targets: [],
      });
      render(<BookingDetailView id={bookingId} client={client} />);
      expect(await screen.findByText('Batas reschedule telah lewat')).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Batalkan booking' })).not.toBeInTheDocument();
      expect(screen.queryByRole('note')).not.toBeInTheDocument();
    });

    it('keeps the button when the check itself fails, so the server still decides', async () => {
      render(<BookingDetailView id={bookingId} client={withCancelCheck(new Error('offline'))} />);
      expect(await screen.findByRole('button', { name: 'Batalkan booking' })).toBeVisible();
    });

    it('executes cancellation successfully and shows success message with quota refund note', async () => {
      const client = withCancelCheck({ ...cutoff, canCancel: true, unavailableReason: null, supportAction: null });
      render(<BookingDetailView id={bookingId} client={client} />);
      const user = userEvent.setup();

      await user.click(await screen.findByRole('button', { name: 'Batalkan booking' }));
      expect(screen.getByText('Konfirmasi Pembatalan Booking')).toBeVisible();
      expect(screen.getByText(/Kuota sesi paket Anda akan otomatis dikembalikan secara utuh/)).toBeVisible();

      await user.click(screen.getByRole('button', { name: 'Ya, Batalkan' }));
      expect(client.cancel).toHaveBeenCalledWith(bookingId);
      expect(await screen.findByText('Booking berhasil dibatalkan')).toBeVisible();
      expect(screen.getByText(/Kuota sesi paket Anda telah dikembalikan secara utuh/)).toBeVisible();
    });

    it('displays cutoff error in dialog when cancellation cutoff passes during submission', async () => {
      const client = withCancelCheck({ ...cutoff, canCancel: true, unavailableReason: null, supportAction: null });
      vi.mocked(client.cancel!).mockRejectedValueOnce({ code: 'CANCELLATION_CUTOFF_PASSED' });
      render(<BookingDetailView id={bookingId} client={client} />);
      const user = userEvent.setup();

      await user.click(await screen.findByRole('button', { name: 'Batalkan booking' }));
      await user.click(screen.getByRole('button', { name: 'Ya, Batalkan' }));

      expect(
        await screen.findByText(
          'Batas waktu pembatalan mandiri (24 jam sebelum kelas dimulai) telah terlewati. Hubungi admin studio jika terdapat kondisi darurat medis.',
        ),
      ).toBeVisible();
    });

    it('displays error in dialog when attendance has already been recorded', async () => {
      const client = withCancelCheck({ ...cutoff, canCancel: true, unavailableReason: null, supportAction: null });
      vi.mocked(client.cancel!).mockRejectedValueOnce({ code: 'ATTENDANCE_RECORDED' });
      render(<BookingDetailView id={bookingId} client={client} />);
      const user = userEvent.setup();

      await user.click(await screen.findByRole('button', { name: 'Batalkan booking' }));
      await user.click(screen.getByRole('button', { name: 'Ya, Batalkan' }));

      expect(
        await screen.findByText(
          'Kehadiran kelas sudah tercatat atau sesi telah berjalan. Booking tidak dapat dibatalkan.',
        ),
      ).toBeVisible();
    });
  });

  it('keeps booking detail readable while reschedule policy is disabled', async () => {
    const client = makeClient(eligible);
    vi.mocked(client.rescheduleOptions).mockRejectedValue({ code: 'CONFIGURATION_REQUIRED' });
    render(<BookingDetailView id={bookingId} client={client} />);

    expect(await screen.findByRole('heading', { name: 'Reformer' })).toBeVisible();
    expect(screen.getByText('Perubahan jadwal sedang tidak tersedia')).toBeVisible();
    expect(screen.getByText(/Booking Anda tetap aktif/)).toBeVisible();
    expect(screen.queryByText('Permintaan belum dapat diproses')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Hubungi studio' })).toHaveAttribute(
      'href',
      '/contact',
    );
  });

  it('retries only reschedule options without reloading booking detail', async () => {
    const client = makeClient(eligible);
    vi.mocked(client.rescheduleOptions)
      .mockRejectedValueOnce({ code: 'OFFLINE_OR_REQUEST_FAILED' })
      .mockResolvedValueOnce(eligible);
    render(<BookingDetailView id={bookingId} client={client} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Coba lagi' }));
    expect(await screen.findByRole('button', { name: 'Ajukan reschedule' })).toBeVisible();
    expect(client.detail).toHaveBeenCalledTimes(1);
    expect(client.rescheduleOptions).toHaveBeenCalledTimes(2);
  });

  it('shows a blocking error only when booking detail cannot be loaded', async () => {
    const client = makeClient(eligible);
    vi.mocked(client.detail).mockRejectedValue({ code: 'RESOURCE_NOT_FOUND' });
    render(<BookingDetailView id={bookingId} client={client} />);

    expect(await screen.findByRole('heading', { name: 'Booking tidak tersedia' })).toBeVisible();
    expect(screen.getByText('Detail belum dapat dimuat')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Reformer' })).not.toBeInTheDocument();
    expect(client.rescheduleOptions).not.toHaveBeenCalled();
  });

  it('keeps submit failures inside the reschedule form', async () => {
    const client = makeClient(eligible);
    vi.mocked(client.requestReschedule).mockRejectedValue({ code: 'TARGET_CLASS_FULL' });
    render(<BookingDetailView id={bookingId} client={client} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Ajukan reschedule' }));
    await user.click(screen.getByRole('button', { name: 'Tinjau permintaan' }));
    await user.click(screen.getByRole('button', { name: 'Kirim permintaan' }));

    const form = screen.getByRole('form', { name: 'Pengajuan reschedule' });
    expect(await within(form).findByText('Permintaan belum dapat diproses')).toBeVisible();
    expect(within(form).getByText('Kelas tujuan sudah penuh.')).toBeVisible();
  });

  it('displays schedule conflict error inside the reschedule form', async () => {
    const client = makeClient(eligible);
    vi.mocked(client.requestReschedule).mockRejectedValue({ code: 'SCHEDULE_CONFLICT' });
    render(<BookingDetailView id={bookingId} client={client} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Ajukan reschedule' }));
    await user.click(screen.getByRole('button', { name: 'Tinjau permintaan' }));
    await user.click(screen.getByRole('button', { name: 'Kirim permintaan' }));

    const form = screen.getByRole('form', { name: 'Pengajuan reschedule' });
    expect(await within(form).findByText('Permintaan belum dapat diproses')).toBeVisible();
    expect(
      within(form).getByText('Jadwal kelas bertabrakan dengan jadwal kelas lain yang sudah Anda ikuti.'),
    ).toBeVisible();
  });

  it('does not request reschedule options without the customer capability', async () => {
    sessionState.context = {
      status: 'authenticated',
      session: { roles: ['CUSTOMER'] },
      hasCapability: () => false,
    };
    const client = makeClient(eligible);
    render(<BookingDetailView id={bookingId} client={client} />);

    expect(await screen.findByRole('heading', { name: 'Reformer' })).toBeVisible();
    await waitFor(() => expect(client.detail).toHaveBeenCalledTimes(1));
    expect(client.rescheduleOptions).not.toHaveBeenCalled();
    expect(screen.queryByText('Perubahan jadwal sedang tidak tersedia')).not.toBeInTheDocument();
  });
});
