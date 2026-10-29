import { render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ClassSlotView } from '@/classes/class-slot-view';
import type { ClassSlot, ClassSlotClient } from '@/api-clients/class-slot-client';
import type { BookingClient, BookingPage } from '@/api-clients/booking-client';
import { AppFeedbackProvider } from '@/components/app-feedback';
import { localDateKey } from '@/lib/class-time';

const TZ = 'Asia/Jakarta';
const hariIni = localDateKey(new Date(), TZ);
/** Pukul 10.00 WIB hari ini, supaya kelas selalu ada di minggu yang sedang tampil. */
const jamWib = (jam: number) => new Date(`${hariIni}T${String(jam).padStart(2, '0')}:00:00+07:00`);

const kelas = (over: Partial<ClassSlot> = {}): ClassSlot => ({
  id: 'slot-kosong',
  branchId: 'branch-1',
  classTypeId: 'type-1',
  studioId: 'studio-1',
  instructorUserId: 'instructor-1',
  startAt: jamWib(10),
  endAt: new Date(jamWib(10).getTime() + 55 * 60_000),
  timezone: TZ,
  status: 'PUBLISHED',
  minimumQuota: 2,
  capacity: 8,
  bookedCount: 0,
  version: 3,
  ...over,
});

const branch = { id: 'branch-1', name: 'Green Garden', timezone: TZ };
const manage = ['class-slot:read', 'class-slot:manage'];

function classClient(slots: ClassSlot[]): ClassSlotClient {
  return {
    discover: vi.fn().mockResolvedValue({
      slots,
      classTypes: [{ id: 'type-1', code: 'PG', name: 'Private Group' }],
      instructors: [{ id: 'instructor-1', displayName: 'Asrida Putri' }],
      studios: [{ id: 'studio-1', branchId: 'branch-1', code: 'S2', name: 'Studio 2', rooms: [] }],
    }),
    update: vi
      .fn()
      .mockImplementation(async (id: string, input: { startAt: Date; endAt: Date }) => ({
        ...slots.find((item) => item.id === id)!,
        startAt: input.startAt,
        endAt: input.endAt,
        version: 4,
      })),
  } as unknown as ClassSlotClient;
}

const render = (view: React.ReactNode) =>
  rtlRender(<AppFeedbackProvider>{view}</AppFeedbackProvider>);

const kalender = () => screen.getByRole('region', { name: 'Kalender kelas tujuh hari' });

describe('timetable: pemindahan bertahap', () => {
  it('memindahkan kelas kosong dengan keyboard dan baru menyimpan saat Simpan ditekan', async () => {
    const client = classClient([kelas()]);
    render(<ClassSlotView client={client} branchOverride={branch} capabilitiesOverride={manage} />);
    const user = userEvent.setup();

    const chip = await within(kalender()).findByRole('button', { name: /Private Group, Asrida/ });
    chip.focus();
    await user.keyboard('{Enter}{ArrowDown}{Enter}');

    // Belum ada yang tersimpan sebelum staf menekan tombol simpan.
    expect(client.update).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Simpan pemindahan' }));

    await waitFor(() =>
      expect(client.update).toHaveBeenCalledWith(
        'slot-kosong',
        expect.objectContaining({
          startAt: jamWib(11),
          expectedVersion: 3,
          reason: 'Dipindah lewat kalender',
        }),
      ),
    );
    expect(await screen.findByText('Satu kelas dipindah.')).toBeVisible();
  });

  it('membuang pemindahan yang belum disimpan dengan Batalkan', async () => {
    const client = classClient([kelas()]);
    render(<ClassSlotView client={client} branchOverride={branch} capabilitiesOverride={manage} />);
    const user = userEvent.setup();

    const chip = await within(kalender()).findByRole('button', { name: /Private Group, Asrida/ });
    chip.focus();
    await user.keyboard('{Enter}{ArrowDown}');
    expect(screen.getByRole('button', { name: 'Simpan pemindahan' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Batalkan' }));

    expect(screen.getByRole('button', { name: 'Simpan pemindahan' })).toBeDisabled();
    expect(client.update).not.toHaveBeenCalled();
  });

  it('tidak mengangkat kelas yang sudah ada pesertanya', async () => {
    const client = classClient([kelas({ bookedCount: 3 })]);
    render(<ClassSlotView client={client} branchOverride={branch} capabilitiesOverride={manage} />);
    const user = userEvent.setup();

    const chip = await within(kalender()).findByRole('button', { name: /jadwal terkunci/ });
    expect(chip).not.toHaveAttribute('draggable', 'true');
    chip.focus();
    await user.keyboard('{Enter}{ArrowDown}');

    expect(screen.getByRole('button', { name: 'Simpan pemindahan' })).toBeDisabled();
  });
});

describe('timetable: peserta kelas', () => {
  const peserta = {
    id: 'booking-1',
    status: 'BOOKED',
    classSlotId: 'slot-isi',
    customerUserId: 'member-1',
    customerPackageId: 'paket-sari',
    version: 1,
    customer: { id: 'member-1', displayName: 'Sari Dewi', phoneMasked: null },
    sessionBalance: { ledgerBalance: 8, reserved: 1, available: 7 },
  };

  function bookingClient(): Pick<BookingClient, 'list'> &
    Required<Pick<BookingClient, 'searchRosterCandidates' | 'create' | 'cancelAsStaff'>> {
    return {
      list: vi.fn().mockResolvedValue({
        items: [peserta],
        summary: { total: 1, booked: 1, reschedulePending: 0, attended: 0, cancelled: 0 },
        nextCursor: null,
      } as unknown as BookingPage),
      searchRosterCandidates: vi.fn().mockResolvedValue({
        customers: [
          { id: 'member-2', displayName: 'Ayu Lestari' },
          { id: 'member-3', displayName: 'Ayudia Ramadhani' },
        ],
        packages: [
          {
            id: 'paket-ayu',
            customerUserId: 'member-2',
            classTypeId: 'type-1',
            status: 'ACTIVE',
            available: 8,
            expiryAt: new Date('2099-01-01T00:00:00Z'),
            packageName: 'Private Group 10 sesi',
          },
          {
            id: 'paket-ayudia',
            customerUserId: 'member-3',
            classTypeId: 'type-1',
            status: 'EXPIRED',
            available: 3,
            expiryAt: new Date('2020-10-02T00:00:00Z'),
            packageName: 'Private Group 10 sesi',
          },
        ],
      }),
      create: vi.fn().mockResolvedValue({ id: 'booking-baru' }),
      cancelAsStaff: vi.fn().mockResolvedValue(undefined),
    };
  }

  const kapabilitas = [
    ...manage,
    'booking:read',
    'booking:create:assisted',
    'booking:cancel:assisted',
  ];

  async function bukaPanel(bookings: ReturnType<typeof bookingClient>) {
    render(
      <ClassSlotView
        client={classClient([kelas({ id: 'slot-isi', bookedCount: 1 })])}
        bookingClient={bookings}
        branchOverride={branch}
        capabilitiesOverride={kapabilitas}
      />,
    );
    const user = userEvent.setup();
    await user.click(
      await within(kalender()).findByRole('button', { name: /Private Group, Asrida/ }),
    );
    const panel = await screen.findByRole('dialog', { name: 'Private Group' });
    await within(panel).findByText('Sari Dewi');
    return { user, panel };
  }

  it('menambah member dengan satu tekan memakai paketnya yang masih berlaku', async () => {
    const bookings = bookingClient();
    const { user, panel } = await bukaPanel(bookings);

    await user.type(within(panel).getByLabelText('Tambah member ke kelas ini'), 'Ayu');
    await user.click(await within(panel).findByRole('button', { name: /Ayu Lestari/ }));

    expect(bookings.create).toHaveBeenCalledWith(
      {
        classSlotId: 'slot-isi',
        customerPackageId: 'paket-ayu',
        customerUserId: 'member-2',
        source: 'ADMIN_ASSISTED',
      },
      expect.any(String),
    );
  });

  it('membuka peserta di laci samping tanpa menggulir halaman, lalu kembali ke kelasnya', async () => {
    const gulir = vi.fn();
    const asli = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = gulir;
    try {
      const { user } = await bukaPanel(bookingClient());
      expect(gulir).not.toHaveBeenCalled();

      await user.keyboard('{Escape}');
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: 'Private Group' })).not.toBeInTheDocument(),
      );
      await waitFor(() =>
        expect(
          within(kalender()).getByRole('button', { name: /Private Group, Asrida/ }),
        ).toHaveFocus(),
      );
    } finally {
      HTMLElement.prototype.scrollIntoView = asli;
    }
  });

  it('menyebut paket yang sudah habis dan tidak menawarkan tombol Tambah', async () => {
    const { user, panel } = await bukaPanel(bookingClient());

    await user.type(within(panel).getByLabelText('Tambah member ke kelas ini'), 'Ayu');

    expect(await within(panel).findByText('Paket habis 2 Okt 2020')).toBeVisible();
    expect(within(panel).queryByRole('button', { name: /Ayudia Ramadhani/ })).toBeNull();
  });

  it('mengeluarkan peserta tanpa kotak konfirmasi lalu bisa diurungkan dengan paket yang sama', async () => {
    const bookings = bookingClient();
    const { user, panel } = await bukaPanel(bookings);

    await user.click(within(panel).getByRole('button', { name: 'Keluarkan Sari Dewi dari kelas' }));

    expect(bookings.cancelAsStaff).toHaveBeenCalledWith(
      'booking-1',
      expect.any(String),
      expect.any(String),
    );
    expect(await within(panel).findByText('Dikeluarkan, sesi dikembalikan')).toBeVisible();

    await user.click(within(panel).getByRole('button', { name: 'Urungkan' }));

    expect(bookings.create).toHaveBeenCalledWith(
      expect.objectContaining({
        classSlotId: 'slot-isi',
        customerPackageId: 'paket-sari',
        customerUserId: 'member-1',
        source: 'ADMIN_ASSISTED',
      }),
      expect.any(String),
    );
  });
});
