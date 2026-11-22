import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingClient, CustomerRescheduleOptions } from '@/api-clients/booking-client';
import { BookingDetailView } from './booking-detail-view';
import { AppFeedbackProvider } from '../../components/app-feedback';

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

const tampilkan = (client: BookingClient) =>
  render(
    <AppFeedbackProvider>
      <BookingDetailView id={bookingId} client={client} />
    </AppFeedbackProvider>,
  );

const bolehBatal = { canCancel: true, unavailableReason: null, supportAction: null, cutoffAt: '2026-08-09T15:00:00Z' };
const lewatBatas = {
  canCancel: false,
  unavailableReason: 'CANCELLATION_CUTOFF_PASSED',
  supportAction: 'CONTACT_STUDIO',
  cutoffAt: '2026-08-09T15:00:00Z',
};

describe('BookingDetailView: ganti jadwal dan pembatalan member', () => {
  beforeEach(() => {
    sessionState.context = null;
  });

  it('ganti jadwal: tekan, pilih jam pengganti, Pindah; langsung terkirim tanpa tahap tinjau', async () => {
    const user = userEvent.setup();
    const client = makeClient(eligible);
    client.cancellationOptions = vi.fn().mockResolvedValue(bolehBatal);
    tampilkan(client);

    await user.click(await screen.findByRole('button', { name: 'Ganti jadwal' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ganti jadwal' });
    await user.click(await within(dialog).findByRole('button', { name: /3 tempat tersisa/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Pindah ke jadwal ini' }));

    await waitFor(() =>
      expect(client.requestReschedule).toHaveBeenCalledWith(
        expect.objectContaining({ bookingId, targetClassSlotId: targetId, expectedBookingVersion: 0 }),
        expect.any(String),
      ),
    );
    // Detail dimuat ulang setelah pindah.
    await waitFor(() => expect(client.detail).toHaveBeenCalledTimes(2));
  });

  it('kegagalan pindah tetap di dalam dialog dengan pesan yang jelas', async () => {
    const user = userEvent.setup();
    const client = makeClient(eligible);
    client.cancellationOptions = vi.fn().mockResolvedValue(bolehBatal);
    vi.mocked(client.requestReschedule).mockRejectedValue({ code: 'SCHEDULE_CONFLICT' });
    tampilkan(client);

    await user.click(await screen.findByRole('button', { name: 'Ganti jadwal' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ganti jadwal' });
    await user.click(await within(dialog).findByRole('button', { name: /3 tempat tersisa/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Pindah ke jadwal ini' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('bertabrakan');
  });

  it('lewat batas ganti jadwal: dialog mengarahkan ke Ajukan pembatalan', async () => {
    const user = userEvent.setup();
    const client = makeClient({
      ...eligible,
      canRequest: false,
      unavailableReason: 'RESCHEDULE_CUTOFF_PASSED',
      supportAction: 'CONTACT_STUDIO',
      targets: [],
    });
    client.cancellationOptions = vi.fn().mockResolvedValue(lewatBatas);
    client.statusPembatalanSaya = vi.fn().mockResolvedValue({ bisaMengajukan: true, pengajuan: null });
    tampilkan(client);

    await user.click(await screen.findByRole('button', { name: 'Ganti jadwal' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ganti jadwal' });
    expect(await within(dialog).findByText(/hanya bisa sampai 12 jam sebelum kelas/)).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Ajukan pembatalan' })).toBeVisible();
  });

  it('sebelum batas: Batalkan memakai dialog konfirmasi lalu memanggil server', async () => {
    const user = userEvent.setup();
    const client = makeClient(eligible);
    client.cancellationOptions = vi.fn().mockResolvedValue(bolehBatal);
    tampilkan(client);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Batalkan' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Batalkan' }));
    const dialog = await screen.findByRole('dialog', { name: 'Batalkan booking ini?' });
    await user.click(within(dialog).getByRole('button', { name: 'Ya, batalkan' }));

    await waitFor(() => expect(client.cancel).toHaveBeenCalledWith(bookingId, expect.any(String), expect.any(String)));
  });

  it('Esc menutup dialog batal', async () => {
    const user = userEvent.setup();
    const client = makeClient(eligible);
    client.cancellationOptions = vi.fn().mockResolvedValue(bolehBatal);
    tampilkan(client);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Batalkan' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Batalkan' }));
    await screen.findByRole('dialog', { name: 'Batalkan booking ini?' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Batalkan booking ini?' })).not.toBeInTheDocument());
    expect(client.cancel).not.toHaveBeenCalled();
  });

  it('pengajuan pembatalan yang menunggu keputusan ditampilkan, tombolnya tidak ditawarkan lagi', async () => {
    const client = makeClient(eligible);
    client.cancellationOptions = vi.fn().mockResolvedValue(lewatBatas);
    client.statusPembatalanSaya = vi.fn().mockResolvedValue({
      bisaMengajukan: false,
      pengajuan: { id: 'req-1', status: 'PENDING', diajukanPada: '2026-08-10T00:00:00Z' },
    });
    tampilkan(client);

    expect(await screen.findByText(/Pengajuan pembatalan sudah terkirim/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Ajukan pembatalan' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Batalkan' })).not.toBeInTheDocument();
  });

  it('menyebut batas dari cutoff API, bukan angka tetap', async () => {
    const client = makeClient(eligible);
    client.cancellationOptions = vi.fn().mockResolvedValue({ ...bolehBatal, cutoffAt: '2026-08-09T15:00:00Z' });
    tampilkan(client);
    expect(await screen.findByText(/sampai 12 jam sebelum kelas dimulai/)).toBeVisible();
  });

  it('shows a blocking error only when booking detail cannot be loaded', async () => {
    const client = makeClient(eligible);
    vi.mocked(client.detail).mockRejectedValue({ code: 'RESOURCE_NOT_FOUND' });
    tampilkan(client);

    expect(await screen.findByRole('heading', { name: 'Booking tidak tersedia' })).toBeVisible();
    expect(screen.getByText('Detail belum dapat dimuat')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Reformer' })).not.toBeInTheDocument();
    expect(client.rescheduleOptions).not.toHaveBeenCalled();
  });

  it('does not request reschedule options without the customer capability', async () => {
    sessionState.context = {
      status: 'authenticated',
      session: { roles: ['CUSTOMER'] },
      hasCapability: () => false,
    };
    const client = makeClient(eligible);
    tampilkan(client);

    expect(await screen.findByRole('heading', { name: 'Reformer' })).toBeVisible();
    await waitFor(() => expect(client.detail).toHaveBeenCalledTimes(1));
    expect(client.rescheduleOptions).not.toHaveBeenCalled();
  });

  it('has no accessibility violations on the detail page', async () => {
    const client = makeClient(eligible);
    client.cancellationOptions = vi.fn().mockResolvedValue(bolehBatal);
    const { container } = tampilkan(client);
    await screen.findByRole('button', { name: 'Ganti jadwal' });
    expect((await axe(container)).violations).toEqual([]);
  });
});
