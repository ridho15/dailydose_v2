import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BookingConfirmationSheet } from './booking-confirmation-sheet';
import type { PublicClassSlot } from '@/api-clients/public-class-catalog-client';
import type { LedgerBalance } from '@/api-clients/ledger-client';
import type { Booking, BookingClient } from '@/api-clients/booking-client';
import { ApiError } from '@/lib/api-client';

const mockSlot: PublicClassSlot = {
  id: 'slot-123',
  branchId: 'branch-kemang',
  classType: {
    id: 'type-group',
    code: 'GROUP_REFORMER',
    name: 'Group Reformer',
  },
  instructor: {
    displayName: 'Sarah Jenkins',
  },
  startAt: '2026-07-25T03:00:00.000Z',
  endAt: '2026-07-25T03:50:00.000Z',
  timezone: 'Asia/Jakarta',
  status: 'PUBLISHED',
  capacity: 6,
  available: 3,
  canBook: true,
};

const mockPackage: LedgerBalance = {
  id: 'pkg-1',
  branchId: 'branch-kemang',
  packageBranchId: 'branch-kemang',
  status: 'ACTIVE',
  activationDate: new Date('2026-01-01'),
  expiryAt: new Date('2026-12-31'),
  ledgerBalance: 5,
  reserved: 0,
  available: 5,
  packageName: '5x Group Reformer Kemang',
  branchName: 'Daily Dose Kemang',
  classTypeName: 'Group Reformer',
  classTypeId: 'type-group',
};

describe('BookingConfirmationSheet (Tiket T-05 / Spesifikasi 5.3)', () => {
  it('renders nothing when isOpen is false or slot is null', () => {
    const { rerender } = render(
      <BookingConfirmationSheet
        isOpen={false}
        onClose={vi.fn()}
        slot={mockSlot}
        packageItem={mockPackage}
        studioName="Daily Dose Kemang"
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(
      <BookingConfirmationSheet
        isOpen={true}
        onClose={vi.fn()}
        slot={null}
        packageItem={mockPackage}
        studioName="Daily Dose Kemang"
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders Keadaan 1 (Siap) with 5 spec detail rows, package card, and 52px CTA', () => {
    render(
      <BookingConfirmationSheet
        isOpen={true}
        onClose={vi.fn()}
        slot={mockSlot}
        packageItem={mockPackage}
        studioName="Daily Dose Kemang"
      />,
    );

    // Dialog & Title
    expect(screen.getByRole('dialog', { name: 'Group Reformer' })).toBeVisible();
    expect(screen.getByText('Konfirmasi Booking')).toBeVisible();

    // 5 Detail Rows
    expect(screen.getByText(/Sabtu, 25 Juli 2026/)).toBeVisible();
    expect(screen.getByText(/10[:.]00 - 10[:.]50 \(50 menit\)/)).toBeVisible();
    expect(screen.getByText('Instruktur: Sarah Jenkins')).toBeVisible();
    expect(screen.getByText('Studio: Daily Dose Kemang')).toBeVisible();
    expect(screen.getByText('Sisa 3 slot tersedia')).toBeVisible();

    // Kotak #e8f0ec Paket yang Digunakan
    expect(screen.getByText('Paket yang Digunakan')).toBeVisible();
    expect(screen.getByText('5x Group Reformer Kemang')).toBeVisible();
    expect(screen.getByText(/Sisa sesi setelah booking:/)).toBeVisible();
    expect(screen.getByText('4 sesi')).toBeVisible();

    // CTA Button (52px full-width) and Cancel
    const confirmBtn = screen.getByRole('button', { name: 'Konfirmasi booking sekarang' });
    expect(confirmBtn).toBeVisible();
    expect(confirmBtn).toHaveClass('h-[52px]');
    expect(screen.getByRole('button', { name: 'Batal' })).toBeVisible();
  });

  it('handles Keadaan 2 (Diproses) and Keadaan 3 (Berhasil) when booking succeeds', async () => {
    let resolveCreate: (value: Booking) => void = () => {};
    const bookingPromise = new Promise<Booking>((resolve) => {
      resolveCreate = resolve;
    });

    const mockBookingClient = {
      create: vi.fn().mockReturnValue(bookingPromise),
    } as unknown as BookingClient;

    const handleSuccess = vi.fn();
    const handleClose = vi.fn();

    render(
      <BookingConfirmationSheet
        isOpen={true}
        onClose={handleClose}
        slot={mockSlot}
        packageItem={mockPackage}
        studioName="Daily Dose Kemang"
        bookingClient={mockBookingClient}
        onBookingSuccess={handleSuccess}
      />,
    );

    const confirmBtn = screen.getByRole('button', { name: 'Konfirmasi booking sekarang' });
    await userEvent.click(confirmBtn);

    // Keadaan 2: Diproses
    expect(screen.getByText('Memproses booking...')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Memproses booking...' })).toBeDisabled();

    // Resolve booking
    const fakeBooking: Booking = {
      id: 'bk-12345',
      bookingNumber: 'BK-2026-0001',
      branchId: 'branch-kemang',
      classSlotId: mockSlot.id,
      customerUserId: 'cust-1',
      customerPackageId: mockPackage.id,
      status: 'BOOKED',
      reservedQuantity: 1,
      source: 'SELF',
      createdAt: new Date(),
      version: 1,
    };
    resolveCreate(fakeBooking);

    // Keadaan 3: Berhasil
    await waitFor(() => {
      expect(screen.getByText('Booking berhasil')).toBeVisible();
    });
    expect(screen.getByText('BK-2026-0001')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Lihat QR Pass' })).toHaveAttribute(
      'href',
      '/check-in-pass?bookingId=bk-12345',
    );
    expect(handleSuccess).toHaveBeenCalledWith(fakeBooking);

    // Clicking Tutup calls onClose
    const closeBtn = screen.getByRole('button', { name: 'Tutup' });
    await userEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('shows Slot Habis when apiFetch rejects with the real ApiError for a full class', async () => {
    const mockBookingClient = {
      create: vi
        .fn()
        .mockRejectedValue(
          new ApiError('Permintaan tidak dapat diproses.', 409, {
            error: { code: 'CLASS_CAPACITY_FULL' },
          }),
        ),
    } as unknown as BookingClient;

    render(
      <BookingConfirmationSheet
        isOpen={true}
        onClose={vi.fn()}
        slot={mockSlot}
        packageItem={mockPackage}
        studioName="Daily Dose Kemang"
        bookingClient={mockBookingClient}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Konfirmasi booking sekarang' }));

    expect(
      await screen.findByRole('heading', { name: 'Slot kelas ini baru saja penuh' }),
    ).toBeVisible();
  });

  it('keeps the confirm button outside the scrolling area so it stays visible with many packages', () => {
    render(
      <BookingConfirmationSheet
        isOpen={true}
        onClose={vi.fn()}
        slot={mockSlot}
        packageItem={mockPackage}
        availablePackages={Array.from({ length: 12 }, (_, i) => ({ ...mockPackage, id: `pkg-${i}` }))}
        studioName="Daily Dose Kemang"
        bookingClient={{ create: vi.fn() } as unknown as BookingClient}
      />,
    );
    const confirm = screen.getByRole('button', { name: 'Konfirmasi booking sekarang' });
    expect(confirm.closest('.overflow-y-auto')).toBeNull();
    expect(screen.getAllByRole('radio')).toHaveLength(12);
  });

  it.each([
    ['CLASS_CAPACITY_FULL', 'Kapasitas kelas sudah penuh.'],
    ['DUPLICATE_ACTIVE_BOOKING', 'Pelanggan sudah memiliki booking aktif untuk kelas ini.'],
  ])('tells the list to refresh when the server answers %s', async (code) => {
    const onSlotUnavailable = vi.fn();
    render(
      <BookingConfirmationSheet
        isOpen={true}
        onClose={vi.fn()}
        slot={mockSlot}
        packageItem={mockPackage}
        studioName="Daily Dose Kemang"
        onSlotUnavailable={onSlotUnavailable}
        bookingClient={
          {
            create: vi
              .fn()
              .mockRejectedValue(new ApiError('x', 409, { error: { code } })),
          } as unknown as BookingClient
        }
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Konfirmasi booking sekarang' }));
    await waitFor(() => expect(onSlotUnavailable).toHaveBeenCalledTimes(1));
  });

  it('handles Keadaan 4A (Gagal: Slot Habis) when server throws CLASS_CAPACITY_FULL', async () => {
    const mockBookingClient = {
      create: vi.fn().mockRejectedValue({
        code: 'CLASS_CAPACITY_FULL',
        message: 'Kapasitas kelas sudah penuh.',
      }),
    } as unknown as BookingClient;

    const handleClose = vi.fn();

    render(
      <BookingConfirmationSheet
        isOpen={true}
        onClose={handleClose}
        slot={mockSlot}
        packageItem={mockPackage}
        studioName="Daily Dose Kemang"
        bookingClient={mockBookingClient}
      />,
    );

    const confirmBtn = screen.getByRole('button', { name: 'Konfirmasi booking sekarang' });
    await userEvent.click(confirmBtn);

    // Keadaan 4A: Slot Habis
    await waitFor(() => {
      expect(
        screen.getByText('Slot kelas ini baru saja penuh. Pilih jam lain di hari yang sama.'),
      ).toBeVisible();
    });
    expect(screen.getByRole('heading', { name: 'Slot kelas ini baru saja penuh' })).toBeVisible();

    const changeHourBtn = screen.getByRole('button', { name: 'Lihat jam lain' });
    await userEvent.click(changeHourBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('handles Keadaan 4B (Gagal: Belum Verifikasi) when isVerified is false', async () => {
    render(
      <BookingConfirmationSheet
        isOpen={true}
        onClose={vi.fn()}
        slot={mockSlot}
        packageItem={mockPackage}
        studioName="Daily Dose Kemang"
        isVerified={false}
      />,
    );

    // Keadaan 4B: Belum Verifikasi
    expect(screen.getByText('Verifikasi identitas diperlukan')).toBeVisible();
    expect(
      screen.getByText(
        'Booking belum bisa diproses karena identitas kamu belum diverifikasi.',
      ),
    ).toBeVisible();

    const verifyLink = screen.getByRole('link', { name: 'Isi data verifikasi' });
    expect(verifyLink).toHaveAttribute('href', '/account/verification');
  });

  it('allows customer to switch between multiple available packages', async () => {
    const secondPackage: LedgerBalance = {
      id: 'pkg-2',
      branchId: 'branch-kemang',
      packageBranchId: 'branch-kemang',
      status: 'ACTIVE',
      activationDate: new Date('2026-01-01'),
      expiryAt: new Date('2026-12-31'),
      ledgerBalance: 10,
      reserved: 0,
      available: 10,
      packageName: '10x Unlimited Reformer',
      branchName: 'Daily Dose Kemang',
      classTypeName: 'Group Reformer',
      classTypeId: 'type-group',
    };

    const mockBookingClient = {
      create: vi.fn().mockResolvedValue({
        id: 'bk-999',
        status: 'BOOKED',
        createdAt: new Date(),
        version: 1,
      } as Booking),
    } as unknown as BookingClient;

    render(
      <BookingConfirmationSheet
        isOpen={true}
        onClose={vi.fn()}
        slot={mockSlot}
        packageItem={mockPackage}
        availablePackages={[mockPackage, secondPackage]}
        studioName="Daily Dose Kemang"
        bookingClient={mockBookingClient}
      />,
    );

    // Both radio options should be present
    expect(screen.getByText('5x Group Reformer Kemang')).toBeVisible();
    expect(screen.getByText('10x Unlimited Reformer')).toBeVisible();

    // Select second package
    const secondRadio = screen.getByLabelText(/10x Unlimited Reformer/);
    await userEvent.click(secondRadio);

    // Sisa sesi after booking should reflect second package (10 - 1 = 9)
    expect(screen.getByText('Sisa setelah booking: 9 sesi')).toBeVisible();

    // Confirm booking
    await userEvent.click(screen.getByRole('button', { name: 'Konfirmasi booking sekarang' }));

    expect(mockBookingClient.create).toHaveBeenCalledWith(
      expect.objectContaining({
        classSlotId: mockSlot.id,
        customerPackageId: 'pkg-2',
        source: 'SELF',
      }),
      expect.any(String),
    );
  });
  it("renders purchase link instead of disabled button when user has no matching package", () => {
    render(
      <BookingConfirmationSheet
        isOpen={true}
        onClose={vi.fn()}
        slot={mockSlot}
        packageItem={null}
        availablePackages={[]}
        studioName="Daily Dose Kemang"
      />,
    );

    expect(screen.getByText("Tidak ditemukan paket aktif yang sesuai untuk kelas ini.")).toBeVisible();
    const purchaseLink = screen.getByRole("link", { name: "Beli paket untuk kelas ini" });
    expect(purchaseLink).toBeVisible();
    expect(purchaseLink).toHaveAttribute(
      "href",
      "/packages?branch=branch-kemang&classType=type-group&slot=slot-123",
    );
  });

  it("supports bring-a-friend input when package is shareable", async () => {
    const shareablePackage: LedgerBalance = {
      ...mockPackage,
      id: "pkg-shareable",
      packageName: "Double Trouble Deal",
      isShareable: true,
    };

    const mockBookingClient = {
      create: vi.fn().mockResolvedValue({
        id: "bk-friend",
        status: "BOOKED",
        createdAt: new Date(),
        version: 1,
      } as Booking),
    } as unknown as BookingClient;

    render(
      <BookingConfirmationSheet
        isOpen={true}
        onClose={vi.fn()}
        slot={mockSlot}
        packageItem={shareablePackage}
        studioName="Daily Dose Kemang"
        bookingClient={mockBookingClient}
      />,
    );

    const friendInput = screen.getByLabelText("Bawa Teman (Opsional)");
    expect(friendInput).toBeVisible();
    await userEvent.type(friendInput, "Jessica");

    await userEvent.click(screen.getByRole("button", { name: "Konfirmasi booking sekarang" }));

    expect(mockBookingClient.create).toHaveBeenCalledWith(
      expect.objectContaining({
        classSlotId: mockSlot.id,
        customerPackageId: "pkg-shareable",
        namaTeman: "Jessica",
      }),
      expect.any(String),
    );
  });

  it("handles SCHEDULE_CONFLICT error with a clear Indonesian message", async () => {
    const mockBookingClient = {
      create: vi.fn().mockRejectedValue({
        code: "SCHEDULE_CONFLICT",
      }),
    } as unknown as BookingClient;

    render(
      <BookingConfirmationSheet
        isOpen={true}
        onClose={vi.fn()}
        slot={mockSlot}
        packageItem={mockPackage}
        studioName="Daily Dose Kemang"
        bookingClient={mockBookingClient}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Konfirmasi booking sekarang" }));

    await waitFor(() => {
      expect(
        screen.getByText("Jadwal kelas bertabrakan dengan jadwal kelas lain yang sudah Anda ikuti."),
      ).toBeVisible();
    });
  });
});
