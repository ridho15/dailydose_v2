import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { BookingClient, CustomerBookingOptions } from '@/api-clients/booking-client';
import { AppFeedbackProvider } from '../../components/app-feedback';
import { CustomerBookingFlow } from './customer-booking-flow';

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: navigation.replace,
    push: navigation.push,
  }),
}));

const options: CustomerBookingOptions = {
  slot: {
    id: '00000000-0000-4000-8000-000000000101',
    branchId: '00000000-0000-4000-8000-000000000102',
    classTypeId: '00000000-0000-4000-8000-000000000103',
    startAt: new Date('2027-01-10T03:00:00Z'),
    endAt: new Date('2027-01-10T04:00:00Z'),
    timezone: 'Asia/Jakarta',
    status: 'PUBLISHED',
    capacity: 10,
    bookedCount: 2,
    available: 8,
    branch: {
      id: '00000000-0000-4000-8000-000000000102',
      code: 'JKT',
      name: 'Jakarta',
      timezone: 'Asia/Jakarta',
    },
    classType: {
      id: '00000000-0000-4000-8000-000000000103',
      code: 'REFORMER',
      name: 'Reformer Pilates',
    },
  },
  packages: [
    {
      id: '00000000-0000-4000-8000-000000000104',
      packageId: '00000000-0000-4000-8000-000000000105',
      name: 'Reformer 10',
      available: 6,
      projectedAvailable: 5,
      expiryAt: new Date('2027-03-01T00:00:00Z'),
    },
  ],
  eligibility: {
    canBook: true,
    reasonCode: null,
    requiredAction: null,
    cutoffAt: new Date('2027-01-10T01:00:00Z'),
  },
};

function bookingClient(value: CustomerBookingOptions): BookingClient {
  return {
    options: vi.fn().mockResolvedValue(value),
    discover: vi.fn(),
    list: vi.fn(),
    create: vi.fn().mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000106',
      status: 'BOOKED',
      createdAt: new Date(),
    }),
    listReschedules: vi.fn(),
    requestReschedule: vi.fn(),
    decideReschedule: vi.fn(),
  } as unknown as BookingClient;
}

describe('customer self booking flow', () => {
  it('books the selected slot using the authenticated customer package', async () => {
    window.history.replaceState({}, '', `?slot=${options.slot.id}`);
    const client = bookingClient(options);
    render(
      <AppFeedbackProvider>
        <CustomerBookingFlow client={client} />
      </AppFeedbackProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Konfirmasi reservasi kelas' })).toBeVisible();
    expect(screen.getByText('Reformer 10')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Lanjutkan ke review booking' }));
    expect(screen.getByText('6 → 5 sesi')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Ya, konfirmasi booking' }));

    expect(client.create).toHaveBeenCalledWith(
      {
        classSlotId: options.slot.id,
        customerPackageId: options.packages[0]!.id,
        source: 'SELF',
      },
      expect.any(String),
    );
    expect(await screen.findByText('Booking berhasil')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Ya, konfirmasi booking' }),
    ).not.toBeInTheDocument();
  });

  it('preserves the slot when the customer needs to buy a matching package', async () => {
    window.history.replaceState({}, '', `?slot=${options.slot.id}`);
    render(
      <AppFeedbackProvider>
        <CustomerBookingFlow
          client={bookingClient({
            ...options,
            packages: [],
            eligibility: {
              ...options.eligibility,
              canBook: false,
              reasonCode: 'MATCHING_PACKAGE_REQUIRED',
              requiredAction: 'BUY_MATCHING_PACKAGE',
            },
          })}
        />
      </AppFeedbackProvider>,
    );

    expect(await screen.findByText('Paket yang sesuai diperlukan', { exact: false })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Beli paket yang sesuai' })).toHaveAttribute(
      'href',
      `/packages?branch=${options.slot.branchId}&classType=${options.slot.classTypeId}&slot=${options.slot.id}`,
    );
  });

  it('member yang sudah terdaftar bisa booking kursi teman dengan paket bawa teman', async () => {
    window.history.replaceState({}, '', `?slot=${options.slot.id}`);
    const client = bookingClient({
      ...options,
      packages: [{ ...options.packages[0]!, name: 'Double Trouble Deal', kursiTeman: true }],
    });
    render(
      <AppFeedbackProvider>
        <CustomerBookingFlow client={client} />
      </AppFeedbackProvider>,
    );
    expect(await screen.findByText(/Kursi untuk teman Anda/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Lanjutkan ke review booking' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ya, konfirmasi booking' }));
    expect(client.create).toHaveBeenCalled();
  });

  it('menjelaskan bila member sudah terdaftar dan tidak punya paket bawa teman', async () => {
    window.history.replaceState({}, '', `?slot=${options.slot.id}`);
    render(
      <AppFeedbackProvider>
        <CustomerBookingFlow
          client={bookingClient({
            ...options,
            packages: [],
            eligibility: {
              ...options.eligibility,
              canBook: false,
              reasonCode: 'ALREADY_BOOKED',
              requiredAction: null,
            },
          })}
        />
      </AppFeedbackProvider>,
    );
    expect(await screen.findByText('Anda sudah terdaftar di kelas ini', { exact: false })).toBeVisible();
  });

  it('keeps the retry key for one intent and rotates it when the selected package changes', async () => {
    window.history.replaceState({}, '', `?slot=${options.slot.id}`);
    const secondPackage = {
      ...options.packages[0]!,
      id: '00000000-0000-4000-8000-000000000107',
      name: 'Reformer 20',
    };
    const client = bookingClient({
      ...options,
      packages: [...options.packages, secondPackage],
    });
    vi.mocked(client.create).mockRejectedValue(new Error('network unavailable'));
    render(
      <AppFeedbackProvider>
        <CustomerBookingFlow client={client} />
      </AppFeedbackProvider>,
    );

    await screen.findByText('Reformer 10');
    await userEvent.click(screen.getByRole('button', { name: 'Lanjutkan ke review booking' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ya, konfirmasi booking' }));
    await waitFor(() => expect(client.create).toHaveBeenCalledTimes(1));
    const firstKey = vi.mocked(client.create).mock.calls[0]![1];

    await userEvent.click(screen.getByRole('button', { name: 'Ya, konfirmasi booking' }));
    await waitFor(() => expect(client.create).toHaveBeenCalledTimes(2));
    expect(vi.mocked(client.create).mock.calls[1]![1]).toBe(firstKey);

    await userEvent.click(screen.getByRole('button', { name: 'Kembali ubah paket' }));
    await userEvent.click(screen.getByRole('radio', { name: /Reformer 20/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Lanjutkan ke review booking' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ya, konfirmasi booking' }));
    await waitFor(() => expect(client.create).toHaveBeenCalledTimes(3));
    expect(vi.mocked(client.create).mock.calls[2]![1]).not.toBe(firstKey);
  });

  it('redirects directly to /classes when no slot is selected (no intermediary screen)', async () => {
    window.history.replaceState(null, '', '/bookings/new');
    const client = bookingClient(options);
    render(
      <AppFeedbackProvider>
        <CustomerBookingFlow client={client} />
      </AppFeedbackProvider>,
    );

    expect(navigation.replace).toHaveBeenCalledWith('/classes');
    expect(screen.queryByText('Pilih jadwal kelas terlebih dahulu')).not.toBeInTheDocument();
  });
  it('labels the class by its real kind instead of an invented "Group Reformer"', async () => {
    window.history.replaceState({}, '', `?slot=${options.slot.id}`);
    const grouped = {
      ...options,
      slot: {
        ...options.slot,
        classType: { ...options.slot.classType, name: 'Group Class', modality: 'GROUP' },
      },
    } as CustomerBookingOptions;
    render(
      <AppFeedbackProvider>
        <CustomerBookingFlow client={bookingClient(grouped)} />
      </AppFeedbackProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Group Class' })).toBeVisible();
    expect(screen.getByText('Kelas grup')).toBeVisible();
    expect(screen.queryByText('Group Reformer')).toBeNull();
  });
  it("surfaces SCHEDULE_CONFLICT clearly with toast when booking collides with existing class", async () => {
    window.history.replaceState({}, "", `?slot=${options.slot.id}`);
    const client = bookingClient(options);
    vi.mocked(client.create).mockRejectedValue({ code: "SCHEDULE_CONFLICT" });

    render(
      <AppFeedbackProvider>
        <CustomerBookingFlow client={client} />
      </AppFeedbackProvider>,
    );

    await screen.findByText("Reformer 10");
    await userEvent.click(screen.getByRole("button", { name: "Lanjutkan ke review booking" }));
    await userEvent.click(screen.getByRole("button", { name: "Ya, konfirmasi booking" }));

    expect(
      (await screen.findAllByText("Jadwal kelas bertabrakan dengan jadwal kelas lain yang sudah Anda ikuti."))[0],
    ).toBeVisible();
  });

  it("surfaces CLASS_ALREADY_FINISHED clearly when booking an ended class", async () => {
    window.history.replaceState({}, "", `?slot=${options.slot.id}`);
    const client = bookingClient(options);
    vi.mocked(client.create).mockRejectedValue({ code: "CLASS_ALREADY_FINISHED" });

    render(
      <AppFeedbackProvider>
        <CustomerBookingFlow client={client} />
      </AppFeedbackProvider>,
    );

    await screen.findByText("Reformer 10");
    await userEvent.click(screen.getByRole("button", { name: "Lanjutkan ke review booking" }));
    await userEvent.click(screen.getByRole("button", { name: "Ya, konfirmasi booking" }));

    expect(
      (await screen.findAllByText("Kelas ini sudah selesai dan tidak dapat dipesan lagi."))[0],
    ).toBeVisible();
  });
});
