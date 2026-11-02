import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { browserLedgerClient } from '@/api-clients/ledger-client';
import { CustomerPackagesView } from '../account/packages/packages-view';
import { CustomerBookingsView, formatBookingSlotTime } from '../bookings/customer-bookings-view';
import { BookingDetailView } from '../bookings/[id]/booking-detail-view';
import { Pagination } from '../components/admin/admin-ui';
import type { BookingClient, CustomerBookingRecord } from '@/api-clients/booking-client';

const mockBookingRecord = (overrides: Partial<CustomerBookingRecord> = {}): CustomerBookingRecord =>
  ({
    id: '00000000-0000-4000-8000-000000000101',
    branchId: '00000000-0000-4000-8000-000000000102',
    classSlotId: '00000000-0000-4000-8000-000000000103',
    customerUserId: '00000000-0000-4000-8000-000000000104',
    customerPackageId: '00000000-0000-4000-8000-000000000105',
    reservationId: '00000000-0000-4000-8000-000000000106',
    createdById: '00000000-0000-4000-8000-000000000104',
    source: 'SELF',
    status: 'BOOKED',
    reservedQuantity: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    version: 0,
    idempotentReplay: false,
    branch: {
      id: '00000000-0000-4000-8000-000000000102',
      name: 'Daily Dose Green Garden',
      timezone: 'Asia/Jakarta',
    },
    classSlot: {
      id: '00000000-0000-4000-8000-000000000103',
      startAt: new Date('2026-10-30T03:00:00Z'),
      endAt: new Date('2026-10-30T04:00:00Z'),
      timezone: 'Asia/Jakarta',
      status: 'CONFIRMED',
      capacity: 10,
      bookedCount: 4,
      classType: {
        id: '00000000-0000-4000-8000-000000000107',
        name: 'Reformer Pilates',
      },
      instructor: {
        id: '00000000-0000-4000-8000-000000000108',
        displayName: 'Coach Sarah',
      },
      studio: {
        id: '00000000-0000-4000-8000-000000000109',
        name: 'Studio 1',
      },
    },
    ...overrides,
  }) as CustomerBookingRecord;

describe('Tiket T-16: Aturan Tampilan Menurut Status', () => {
  describe('Kriteria 1: Paket Kedaluwarsa (B-17)', () => {
    it('memastikan paket kedaluwarsa masuk ke riwayat dan tombolnya diganti menjadi "Beli paket baru"', async () => {
      vi.spyOn(browserLedgerClient, 'list').mockResolvedValue({
        items: [
          {
            id: 'pkg-active',
            branchId: 'branch-1',
            status: 'ACTIVE' as const,
            activationDate: new Date('2026-01-01'),
            expiryAt: new Date('2027-01-01'),
            ledgerBalance: 10,
            reserved: 0,
            available: 10,
            packageName: 'Paket 10 Sesi Aktif',
            branchName: 'Green Garden',
          },
          {
            id: 'pkg-expired',
            branchId: 'branch-1',
            status: 'ACTIVE' as const,
            activationDate: new Date('2024-01-01'),
            expiryAt: new Date('2024-09-30'), // Berakhir 30 September 2024
            ledgerBalance: 14,
            reserved: 0,
            available: 14,
            packageName: 'Paket Kedaluwarsa 2024',
            branchName: 'Green Garden',
          },
        ],
        summary: { packageCount: 2, ledgerBalance: 24, reserved: 0, available: 24 },
        nextCursor: null,
      });

      render(<CustomerPackagesView />);

      // Paket aktif: hanya paket yang masih berlaku, dengan tombol "Booking kelas"
      expect(await screen.findByText('Paket 10 Sesi Aktif')).toBeVisible();
      expect(screen.getAllByRole('link', { name: 'Booking kelas' })).toHaveLength(1);
      expect(screen.getByText('Paket Kedaluwarsa 2024')).not.toBeVisible();

      // Buka riwayat di halaman yang sama
      await userEvent.click(screen.getByText('Riwayat paket dan pesanan'));

      // Paket kedaluwarsa tampil di riwayat, sesi sisanya ditandai hangus
      expect(screen.getByText('Paket Kedaluwarsa 2024')).toBeVisible();
      expect(screen.getByText(/14 sesi hangus/)).toBeVisible();

      // Tombol "Booking kelas" tetap hanya satu (milik paket aktif)
      expect(screen.getAllByRole('link', { name: 'Booking kelas' })).toHaveLength(1);

      // Riwayat menawarkan "Beli paket baru" yang mengarah ke /packages
      const buyNewBtn = screen.getByRole('link', { name: 'Beli paket baru' });
      expect(buyNewBtn).toBeVisible();
      expect(buyNewBtn).toHaveAttribute('href', '/packages');
    });
  });

  describe('Kriteria 2: Booking Batal atau Selesai (B-19)', () => {
    it('memastikan booking dibatalkan tidak menampilkan "Ketersediaan Slot" dan aksi adalah "Lihat detail" tanpa QR Pass', async () => {
      const client = {
        list: vi.fn().mockResolvedValue({
          items: [
            mockBookingRecord({
              id: 'booking-cancelled-1',
              status: 'CANCELLED',
            }),
          ],
          nextCursor: null,
        }),
      } as unknown as BookingClient;

      render(<CustomerBookingsView client={client} />);

      expect(await screen.findByText('Reformer Pilates')).toBeVisible();

      // Ketersediaan slot TIDAK boleh muncul untuk booking yang dibatalkan
      expect(screen.queryByText('Ketersediaan Slot')).not.toBeInTheDocument();
      expect(screen.getByText('Booking dibatalkan')).toBeVisible();

      // Aksi harus berupa "Lihat detail" bukan "Lihat detail & QR Pass"
      expect(screen.getByText('Lihat detail')).toBeVisible();
      expect(screen.queryByText('Lihat detail & QR Pass')).not.toBeInTheDocument();
    });

    it('memastikan booking di tab riwayat (selesai) tidak menampilkan Ketersediaan Slot dan hanya Lihat detail', async () => {
      const client = {
        list: vi.fn().mockImplementation(({ timeline }) =>
          Promise.resolve({
            items:
              timeline === 'HISTORY'
                ? [
                    mockBookingRecord({
                      id: 'booking-attended-1',
                      status: 'ATTENDED',
                    }),
                  ]
                : [],
            nextCursor: null,
          }),
        ),
      } as unknown as BookingClient;

      render(<CustomerBookingsView client={client} />);

      await userEvent.click(screen.getByRole('tab', { name: 'Riwayat' }));

      expect(await screen.findByText('Reformer Pilates')).toBeVisible();
      expect(screen.queryByText('Ketersediaan Slot')).not.toBeInTheDocument();
      expect(screen.getByText('Lihat detail')).toBeVisible();
      expect(screen.queryByText('Lihat detail & QR Pass')).not.toBeInTheDocument();
    });

    it('memastikan detail booking menyembunyikan Kapasitas Slot dan generator QR Pass jika booking dibatalkan', async () => {
      const client = {
        detail: vi.fn().mockResolvedValue(
          mockBookingRecord({
            status: 'CANCELLED',
          }),
        ),
      } as unknown as BookingClient;

      render(<BookingDetailView id="booking-cancelled-1" client={client} />);

      expect(await screen.findByText('Status Booking')).toBeVisible();
      expect(screen.getByText('Booking dibatalkan')).toBeVisible();
      expect(screen.queryByText('Kapasitas Slot')).not.toBeInTheDocument();

      // Pass Check-in Studio QR tidak boleh dirender
      expect(screen.queryByLabelText('Pass Check-in Studio')).not.toBeInTheDocument();
      expect(screen.queryByText('Tunjukkan QR Ini Saat Tiba di Studio')).not.toBeInTheDocument();
    });
  });

  describe('Kriteria 3: Format Tanggal Menyertakan Tahun Jika Bukan Tahun Berjalan (B-18)', () => {
    it('menyertakan tahun secara eksplisit bila sesi bukan pada tahun berjalan', () => {
      const currentYear = new Date().getFullYear();
      const pastDate = new Date(`${currentYear - 2}-10-02T08:00:00Z`);

      const formatted = formatBookingSlotTime(pastDate, 'Asia/Jakarta', false);

      // Harus menyertakan tahun lama (misal 2024)
      expect(formatted).toContain(String(currentYear - 2));
    });

    it('selalu menyertakan tahun bila isHistory bernilai true', () => {
      const currentDate = new Date();
      const formatted = formatBookingSlotTime(currentDate, 'Asia/Jakarta', true);

      // Tab riwayat selalu menyertakan tahun
      expect(formatted).toContain(String(currentDate.getFullYear()));
    });
  });

  describe('Kriteria 4: Perbaikan Penghitung Pesanan (B-20)', () => {
    it('menampilkan "Menampilkan 1 pesanan" bukan "Menampilkan 1 dari 0 pesanan" atau "1 dari 1 pesanan"', () => {
      render(
        <Pagination
          currentPage={1}
          totalPages={1}
          totalItems={1}
          pageSize={20}
          hasPrevious={false}
          hasNext={false}
          totalLabel="1 pesanan"
          onPrevious={() => {}}
          onNext={() => {}}
        />,
      );

      // Verifikasi teks displayLabel tepat "Menampilkan 1 pesanan"
      expect(screen.getByText('Menampilkan 1 pesanan')).toBeVisible();
      expect(screen.queryByText(/dari 0/)).not.toBeInTheDocument();
      expect(screen.queryByText(/1–1 dari 1/)).not.toBeInTheDocument();
    });

    it('memotong anomali "dari 0" bila diberikan label mentah yang cacat dari sistem luar', () => {
      render(
        <Pagination
          currentPage={1}
          totalPages={1}
          totalItems={1}
          pageSize={20}
          hasPrevious={false}
          hasNext={false}
          totalLabel="1 dari 0 pesanan"
          onPrevious={() => {}}
          onNext={() => {}}
        />,
      );

      // Anomali "dari 0" harus dicegah
      expect(screen.queryByText(/dari 0/)).not.toBeInTheDocument();
      expect(screen.getByText(/1 pesanan/)).toBeVisible();
    });

    it('menampilkan format jamak "Menampilkan X dari Y" dengan benar bila totalItems > pageSize', () => {
      render(
        <Pagination
          currentPage={1}
          totalPages={3}
          totalItems={50}
          pageSize={20}
          hasPrevious={false}
          hasNext={true}
          totalLabel="20 dari 50 pesanan"
          onPrevious={() => {}}
          onNext={() => {}}
        />,
      );

      expect(screen.getByText('Menampilkan 20 dari 50 pesanan')).toBeVisible();
    });
  });
});
