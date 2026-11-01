import { render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { bookingFailure, bookingProblem, type BookingClient } from '@/api-clients/booking-client';
import { ApiError } from '@/lib/api-client';
import { BookingView } from '@/bookings/booking-view';
import { AppFeedbackProvider } from '@/components/app-feedback';

const render = (view: React.ReactNode) =>
  rtlRender(view, {
    wrapper: ({ children }) => <AppFeedbackProvider>{children}</AppFeedbackProvider>,
  });

const branchId = '00000000-0000-4000-8000-000000000202';
const customerId = '00000000-0000-4000-8000-000000000204';
const packageId = '00000000-0000-4000-8000-000000000205';
const classTypeId = '00000000-0000-4000-8000-000000000208';
const slotId = '00000000-0000-4000-8000-000000000203';
const booking = {
  id: '00000000-0000-4000-8000-000000000201',
  branchId,
  classSlotId: slotId,
  customerUserId: customerId,
  customerPackageId: packageId,
  reservationId: '00000000-0000-4000-8000-000000000206',
  createdById: '00000000-0000-4000-8000-000000000207',
  source: 'ADMIN_ASSISTED' as const,
  status: 'BOOKED' as const,
  reservedQuantity: 1,
  createdAt: new Date('2027-01-01T00:00:00Z'),
  version: 0,
  idempotentReplay: false,
};
const customerPackage = {
  id: packageId,
  branchId,
  customerUserId: customerId,
  packageId: '00000000-0000-4000-8000-000000000209',
  classTypeId,
  status: 'ACTIVE' as const,
  activationDate: new Date('2026-01-01'),
  expiryAt: new Date('2028-01-01T00:00:00Z'),
  ledgerBalance: 10,
  reserved: 2,
  available: 8,
  salePriceRp: 1000000,
  sessionCountSnapshot: 10,
  durationDaysSnapshot: 30,
  projectionRateRp: 100000,
  version: 0,
};
const slot = {
  id: slotId,
  branchId,
  classTypeId,
  startAt: new Date('2027-01-02T02:00:00Z'),
  endAt: new Date('2027-01-02T03:00:00Z'),
  timezone: 'Asia/Jakarta',
  status: 'PUBLISHED' as const,
  minimumQuota: 2,
  capacity: 10,
  bookedCount: 3,
  version: 0,
  idempotentReplay: false,
};
const reschedule = {
  id: '00000000-0000-4000-8000-000000000211',
  branchId,
  bookingId: booking.id,
  sourceClassSlotId: slotId,
  targetClassSlotId: '00000000-0000-4000-8000-000000000212',
  requestedById: customerId,
  requestReasonCode: 'PERSONAL_UNAVAILABLE' as const,
  status: 'PENDING' as const,
  entitlementCutoffAt: new Date('2027-01-01T02:00:00Z'),
  entitledAtRequest: true as const,
  requestedAt: new Date('2026-12-31T00:00:00Z'),
  version: 0,
  idempotentReplay: false,
};

function client(overrides: Partial<BookingClient> = {}): BookingClient {
  return {
    options: vi.fn().mockRejectedValue(new Error('not used by assisted booking tests')),
    discover: vi.fn().mockResolvedValue({
      customers: [{ id: customerId, displayName: 'Customer Synthetic' }],
      packages: [customerPackage],
      slots: [slot],
    }),
    list: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    detail: vi.fn().mockResolvedValue(booking),
    rescheduleOptions: vi.fn().mockRejectedValue(new Error('not used by assisted booking tests')),
    create: vi.fn().mockResolvedValue(booking),
    listReschedules: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    requestReschedule: vi.fn().mockResolvedValue(reschedule),
    decideReschedule: vi.fn().mockResolvedValue({
      reschedule: { ...reschedule, status: 'APPROVED', version: 1 },
      booking: { ...booking, classSlotId: reschedule.targetClassSlotId, version: 2 },
      idempotentReplay: false,
    }),
    ...overrides,
  };
}

async function selectBooking(user: ReturnType<typeof userEvent.setup>) {
  if (!screen.queryByRole('form', { name: 'Buat booking bantuan' }))
    await user.click(screen.getByRole('button', { name: 'Buat booking manual' }));
  const customer = await screen.findByRole('combobox', { name: /Pelanggan/ });
  await user.click(customer);
  await user.click(await screen.findByRole('option', { name: /Customer Synthetic/ }));
  const customerPackage = screen.getByRole('combobox', { name: /Paket pelanggan/ });
  await user.click(customerPackage);
  await user.click(await screen.findByRole('option', { name: /Paket aktif/i }));
  const classSlot = screen.getByRole('combobox', { name: /Kelas/ });
  await user.click(classSlot);
  await user.click(await screen.findByRole('option', { name: /2 Jan 2027/ }));
}

describe('BookingView', () => {
  it('keeps global read mode but asks for a branch when creating', () => {
    render(<BookingView client={client()} activeBranchId="" />);
    expect(screen.getByText(/Saat membuat booking, Anda akan diminta memilih cabang/)).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Buat booking bantuan' })).not.toBeInTheDocument();
  });

  it('discovers eligible options and creates one assisted booking accessibly', async () => {
    const bookingClient = client();
    const view = render(<BookingView client={bookingClient} activeBranchId={branchId} />);
    const user = userEvent.setup();
    await selectBooking(user);
    expect(screen.getByText(/Saldo tersedia berubah dari 8 menjadi 7/)).toBeInTheDocument();
    expect((await axe(view.container)).violations).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Konfirmasi booking satu sesi' }));
    await user.click(screen.getByRole('button', { name: 'Buat booking' }));
    expect(await screen.findByText(/Booking dibuat/)).toBeInTheDocument();
    expect(bookingClient.create).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'ADMIN_ASSISTED', customerUserId: customerId }),
      expect.any(String),
    );
  });

  it('keeps the same intent key for a safe retry and maps the failure', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce({ code: 'CLASS_CAPACITY_FULL' })
      .mockResolvedValueOnce({ ...booking, idempotentReplay: true });
    const bookingClient = client({ create });
    render(<BookingView client={bookingClient} activeBranchId={branchId} />);
    const user = userEvent.setup();
    await selectBooking(user);
    await user.click(screen.getByRole('button', { name: 'Konfirmasi booking satu sesi' }));
    await user.click(screen.getByRole('button', { name: 'Buat booking' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Kapasitas kelas sudah penuh.');
    await user.click(screen.getByRole('button', { name: 'Konfirmasi booking satu sesi' }));
    await user.click(screen.getByRole('button', { name: 'Buat booking' }));
    expect(await screen.findByText(/tidak ada reservasi ganda/)).toBeInTheDocument();
    expect(create.mock.calls[0]?.[1]).toBe(create.mock.calls[1]?.[1]);
  });

  it('lets authorised staff cancel a booking with a mandatory reason and maps the H-24 rule', async () => {
    const withCustomer = {
      ...booking,
      customer: { id: customerId, displayName: 'Customer Synthetic' },
    };
    const cancelAsStaff = vi
      .fn()
      .mockRejectedValueOnce({
        response: new Response(JSON.stringify({ error: { code: 'CANCELLATION_CUTOFF_PASSED' } }), {
          status: 409,
        }),
      })
      .mockResolvedValue(undefined);
    const list = vi.fn().mockResolvedValue({ items: [withCustomer], nextCursor: null });
    render(
      <BookingView
        client={client({ list, cancelAsStaff })}
        activeBranchId={branchId}
        access={{
          canRead: true,
          canCreate: true,
          canReview: false,
          canDecide: false,
          canCancel: true,
        }}
      />,
    );
    const user = userEvent.setup();
    const actionMenu = (await screen.findAllByRole('button', { name: /Aksi booking/i }))[0]!;
    await user.click(actionMenu);
    await user.click(screen.getByRole('menuitem', { name: /Batalkan booking/i }));
    const dialog = await screen.findByRole('dialog', { name: /Batalkan booking pelanggan/ });
    const confirm = within(dialog).getByRole('button', { name: 'Batalkan booking' });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText('Alasan pembatalan'), 'Pelanggan sakit');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(await screen.findByText(/Batas pembatalan H-24 sudah terlewati/)).toBeVisible();
    const adjLink = screen.getByRole("link", { name: /Buka Form Penyesuaian Sesi/i });
    expect(adjLink).toBeVisible();
    expect(adjLink).toHaveAttribute("href", `/ledger/${packageId}?tab=adjustments`);
    expect(cancelAsStaff).toHaveBeenCalledWith(booking.id, 'Pelanggan sakit', expect.any(String));
    await user.click(confirm);
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(await screen.findByText(/sesi pelanggan tidak terpotong/)).toBeVisible();
  });

  it('does not open the cancel dialog when the API says the H-24 cutoff has passed, and points to Penyesuaian Sesi', async () => {
    const withCustomer = { ...booking, customer: { id: customerId, displayName: 'Customer Synthetic' } };
    const cancellationOptions = vi.fn().mockResolvedValue({
      canCancel: false,
      unavailableReason: 'CANCELLATION_CUTOFF_PASSED',
      supportAction: 'USE_SESSION_ADJUSTMENT',
      cutoffAt: '2027-01-01T00:00:00Z',
    });
    const cancelAsStaff = vi.fn();
    const list = vi.fn().mockResolvedValue({ items: [withCustomer], nextCursor: null });
    render(
      <BookingView
        client={client({ list, cancelAsStaff, cancellationOptions })}
        activeBranchId={branchId}
        access={{ canRead: true, canCreate: true, canReview: false, canDecide: false, canCancel: true }}
      />,
    );
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: /Aksi booking/i }))[0]!);
    await user.click(screen.getByRole('menuitem', { name: /Batalkan booking/i }));
    expect(await screen.findByText(/Gunakan Penyesuaian Sesi/)).toBeVisible();
    expect(cancellationOptions).toHaveBeenCalledWith(booking.id);
    expect(screen.queryByRole('dialog', { name: /Batalkan booking pelanggan/ })).not.toBeInTheDocument();
    expect(cancelAsStaff).not.toHaveBeenCalled();
  });

  it('opens the cancel dialog when the API allows it', async () => {
    const withCustomer = { ...booking, customer: { id: customerId, displayName: 'Customer Synthetic' } };
    const cancellationOptions = vi.fn().mockResolvedValue({ canCancel: true, unavailableReason: null, supportAction: null, cutoffAt: '2027-01-01T00:00:00Z' });
    const list = vi.fn().mockResolvedValue({ items: [withCustomer], nextCursor: null });
    render(
      <BookingView
        client={client({ list, cancelAsStaff: vi.fn(), cancellationOptions })}
        activeBranchId={branchId}
        access={{ canRead: true, canCreate: true, canReview: false, canDecide: false, canCancel: true }}
      />,
    );
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: /Aksi booking/i }))[0]!);
    await user.click(screen.getByRole('menuitem', { name: /Batalkan booking/i }));
    expect(await screen.findByRole('dialog', { name: /Batalkan booking pelanggan/ })).toBeVisible();
  });

  it('does not offer cancellation without the capability', async () => {
    const list = vi.fn().mockResolvedValue({ items: [booking], nextCursor: null });
    render(
      <BookingView
        client={client({ list, cancelAsStaff: vi.fn() })}
        activeBranchId={branchId}
        access={{
          canRead: true,
          canCreate: true,
          canReview: false,
          canDecide: false,
          canCancel: false,
        }}
      />,
    );
    await screen.findAllByRole('link', { name: 'Lihat detail' });
    expect(screen.queryByRole('button', { name: 'Batalkan' })).not.toBeInTheDocument();
  });

  it('navigates stable booking pages forward and backward without accumulating rows', async () => {
    const second = { ...booking, id: '00000000-0000-4000-8000-000000000210' };
    const list = vi
      .fn()
      .mockImplementation(({ cursor }: { cursor?: string }) =>
        Promise.resolve(
          cursor === 'cursor-2'
            ? { items: [second], nextCursor: null }
            : { items: [booking], nextCursor: 'cursor-2' },
        ),
      );
    render(<BookingView client={client({ list })} activeBranchId={branchId} />);
    const user = userEvent.setup();
    expect(await screen.findByRole('navigation', { name: 'Paginasi data' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sebelumnya' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Berikutnya' }));
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(
        expect.objectContaining({ branchId, cursor: 'cursor-2' }),
      ),
    );
    expect(
      screen
        .getAllByRole('link', { name: 'Lihat detail' })
        .every((link) => link.getAttribute('href')?.includes(second.id)),
    ).toBe(true);
    expect(screen.getByRole('button', { name: 'Berikutnya' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Sebelumnya' }));
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(
        expect.objectContaining({ branchId, cursor: undefined }),
      ),
    );
  });

  it('continues cursor pagination in global read mode without requiring a branch', async () => {
    const second = { ...booking, id: '00000000-0000-4000-8000-000000000299' };
    const list = vi
      .fn()
      .mockImplementation(({ cursor }: { cursor?: string }) =>
        Promise.resolve(
          cursor === 'global-cursor'
            ? { items: [second], nextCursor: null }
            : { items: [booking], nextCursor: 'global-cursor' },
        ),
      );
    render(<BookingView client={client({ list })} activeBranchId="" />);
    const user = userEvent.setup();
    await screen.findByRole('navigation', { name: 'Paginasi data' });
    await user.click(screen.getByRole('button', { name: 'Berikutnya' }));
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(
        expect.objectContaining({ branchId: undefined, cursor: 'global-cursor' }),
      ),
    );
  });

  it('clears downstream selections when active branch changes', async () => {
    const bookingClient = client();
    const view = render(<BookingView client={bookingClient} activeBranchId={branchId} />);
    const user = userEvent.setup();
    await selectBooking(user);
    expect(screen.getByRole('combobox', { name: /Kelas/ })).toHaveValue('Kelas · 2 Jan 2027, 09.00');
    view.rerender(
      <BookingView client={bookingClient} activeBranchId="00000000-0000-4000-8000-000000000299" />,
    );
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /Pelanggan/ })).toHaveValue(''),
    );
    expect(screen.getByRole('combobox', { name: /Paket pelanggan/ })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: /Kelas/ })).toHaveValue('');
  });

  it('maps stable booking problems to safe Indonesian copy', async () => {
    const cases = [
      ['BOOKING_CUTOFF_PASSED', 'Waktu pemesanan kelas ini sudah ditutup.'],
      ['INSUFFICIENT_AVAILABLE_SESSIONS', 'Saldo sesi pelanggan tidak mencukupi.'],
      ['DUPLICATE_ACTIVE_BOOKING', 'Pelanggan sudah memiliki booking aktif untuk kelas ini.'],
      ['RESOURCE_NOT_FOUND', 'Data tidak tersedia dalam cabang yang dipilih.'],
      ['CONFIGURATION_REQUIRED', 'Fitur booking yang diminta belum tersedia.'],
      ['IDEMPOTENCY_IN_PROGRESS', 'Permintaan yang sama masih diproses. Silakan coba lagi.'],
      ['SESSION_EXPIRED', 'Sesi berakhir. Silakan masuk kembali.'],
    ] as const;
    for (const [code, message] of cases) expect(await bookingFailure({ code })).toBe(message);
    expect(await bookingProblem({ code: 'CONFIGURATION_REQUIRED' })).toEqual({
      code: 'CONFIGURATION_REQUIRED',
      message: 'Fitur booking yang diminta belum tersedia.',
    });
    expect(
      await bookingFailure({
        response: new Response(JSON.stringify({ error: { code: 'DUPLICATE_ACTIVE_BOOKING' } }), {
          status: 409,
          headers: { 'content-type': 'application/problem+json' },
        }),
      }),
    ).toBe('Pelanggan sudah memiliki booking aktif untuk kelas ini.');
  });

  it('membaca kode galat dari ApiError yang dilempar apiFetch', async () => {
    // Bentuk nyata galat saat membuat booking: ApiError { status, data = badan problem server }.
    const problem = (status: number, code?: string) =>
      new ApiError('Permintaan tidak dapat diproses.', status, code ? { error: { code } } : null);
    expect(await bookingProblem(problem(409, 'CLASS_CAPACITY_FULL'))).toEqual({
      code: 'CLASS_CAPACITY_FULL',
      message: 'Kapasitas kelas sudah penuh.',
    });
    expect((await bookingProblem(problem(409, 'DUPLICATE_ACTIVE_BOOKING'))).message).toBe(
      'Pelanggan sudah memiliki booking aktif untuk kelas ini.',
    );
    expect((await bookingProblem(problem(401))).code).toBe('SESSION_EXPIRED');
    expect((await bookingProblem(problem(422))).code).toBe('VALIDATION_ERROR');
    expect((await bookingProblem(new TypeError('Failed to fetch'))).code).toBe(
      'OFFLINE_OR_REQUEST_FAILED',
    );
  });

  it('reviews and approves a pending reschedule with controlled reason', async () => {
    const decideReschedule = vi.fn().mockResolvedValue({
      reschedule: { ...reschedule, status: 'APPROVED', version: 1 },
      booking: { ...booking, classSlotId: reschedule.targetClassSlotId, version: 2 },
      idempotentReplay: false,
    });
    const view = render(
      <BookingView
        client={client({
          listReschedules: vi.fn().mockResolvedValue({ items: [reschedule], nextCursor: null }),
          decideReschedule,
        })}
        activeBranchId={branchId}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Antrean Reschedule/ }));
    await screen.findByRole('button', { name: /Tinjau reschedule/ });
    await user.click(screen.getByRole('button', { name: /Tinjau reschedule/ }));
    expect((await axe(view.container)).violations).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Setujui reschedule' }));
    expect(
      await screen.findByText('Reschedule disetujui dan jadwal booking berhasil dipindahkan.'),
    ).toBeInTheDocument();
    expect(decideReschedule).toHaveBeenCalledWith(
      reschedule.id,
      'approve',
      { reasonCode: 'ELIGIBILITY_VERIFIED', expectedVersion: 0 },
      expect.any(String),
    );
  });
});
