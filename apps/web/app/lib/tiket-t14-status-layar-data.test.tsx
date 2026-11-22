import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Skeleton } from '../ui';
import { AdminSkeleton, StatCard } from '../components/admin/admin-ui';
import { CustomerDashboard } from '../account/customer-dashboard';
import { PublicClassesView } from '../classes/public-classes-view';
import { InstructorTodayView } from '../workspace/instructor-today-view';
import { BookingConfirmationSheet } from '../components/booking/booking-confirmation-sheet';
import type { PublicClassCatalogClient } from '@/api-clients/public-class-catalog-client';

// Stable mock session context
const mockSession = {
  id: 'user-1',
  userId: 'user-1',
  displayName: 'Adelia Fitri',
  email: 'adelia@example.com',
  identityVerificationStatus: 'APPROVED' as const,
  roles: ['CUSTOMER', 'INSTRUCTOR'] as ('CUSTOMER' | 'INSTRUCTOR')[],
  branches: [{ id: 'b1', code: 'DD-GG', name: 'Daily Dose Green Garden', timezone: 'Asia/Jakarta' }],
  preferredBranch: { id: 'b1', code: 'DD-GG', name: 'Daily Dose Green Garden', timezone: 'Asia/Jakarta' },
};
const mockActiveBranch = mockSession.branches[0];
const mockContextValue = {
  session: mockSession,
  activeBranch: mockActiveBranch,
};

vi.mock('../session-context', () => ({
  useSessionContext: () => mockContextValue,
}));

const dummyLedgerClient = {
  list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  balance: vi.fn().mockResolvedValue({ available: 0, held: 0 }),
};

describe('Tiket T-14: Status kosong, memuat, dan error di semua layar data', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    window.history.replaceState(null, '', '/');
    if (typeof window.localStorage === 'undefined') {
      const storage: Record<string, string> = {};
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: (key: string) => storage[key] ?? null,
          setItem: (key: string, val: string) => {
            storage[key] = val;
          },
          removeItem: (key: string) => {
            delete storage[key];
          },
          clear: () => {
            Object.keys(storage).forEach((k) => delete storage[k]);
          },
        },
        configurable: true,
        writable: true,
      });
    } else {
      window.localStorage.clear();
    }
  });

  describe('Kriteria 1 & 3: Kerangka memuat tanpa animasi berulang (animate-pulse)', () => {
    it('memastikan Skeleton ui.tsx tidak memakai animate-pulse', () => {
      const { container } = render(<Skeleton label="Memuat konten studio" />);
      const pulseElements = container.querySelectorAll('.animate-pulse');
      expect(pulseElements.length).toBe(0);
      expect(screen.getByRole('status', { name: 'Memuat konten studio' })).toBeInTheDocument();
    });

    it('memastikan AdminSkeleton tidak memakai animate-pulse', () => {
      const { container } = render(<AdminSkeleton rows={3} />);
      const pulseElements = container.querySelectorAll('.animate-pulse');
      expect(pulseElements.length).toBe(0);
      expect(screen.getByRole('status', { name: 'Memuat data' })).toBeInTheDocument();
    });

    it('memastikan StatCard saat loading tidak memakai animate-pulse', () => {
      const { container } = render(
        <StatCard label="Total Omset" value="Rp 50.000.000" loading={true} />,
      );
      const pulseElements = container.querySelectorAll('.animate-pulse');
      expect(pulseElements.length).toBe(0);
      expect(screen.getByLabelText('Memuat nilai...')).toBeInTheDocument();
    });
  });

  describe('Kriteria 4: Beranda member tidak menampilkan angka 0 sementara saat memuat', () => {
    it('merender kerangka abu saat dashboard sedang memuat bukan angka 0', () => {
      let resolveFetch!: (val: unknown) => void;
      const pendingFetch = new Promise((resolve) => {
        resolveFetch = resolve;
      });
      globalThis.fetch = vi.fn().mockReturnValue(pendingFetch);

      render(<CustomerDashboard />);

      // Kartu metrik tidak boleh menampilkan angka 0 saat memuat
      expect(screen.queryByText('0')).toBeNull();

      // Memastikan elemen loading skeleton hadir
      expect(screen.getByRole('status', { name: 'Menyiapkan Beranda' })).toBeInTheDocument();

      // Selesaikan promise dengan struktur data lengkap agar tidak error saat re-render
      resolveFetch({
        ok: true,
        json: async () => ({
          upcomingBookings: [],
          packages: [],
          actionableOrders: [],
          verification: { status: 'APPROVED' },
          unreadNotifications: 0,
        }),
      });
    });

    it('menampilkan status belum ada paket aktif dan tombol lihat pilihan paket setelah selesai memuat', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          upcomingBookings: [],
          packages: [],
          actionableOrders: [],
          verification: { status: 'APPROVED' },
          unreadNotifications: 0,
        }),
      });

      render(<CustomerDashboard />);

      // Setelah data selesai dimuat dan paket kosong:
      expect(
        await screen.findByText(
          'Belum ada paket aktif. Kamu perlu paket sesi sebelum bisa booking kelas.',
        ),
      ).toBeInTheDocument();

      const btnLihatPaket = screen.getByRole('link', { name: /Lihat pilihan paket/i });
      expect(btnLihatPaket).toBeInTheDocument();
      expect(btnLihatPaket).toHaveAttribute('href', '/packages');
    });
  });

  describe('Kriteria 1 & 5: Jadwal kelas publik menerapkan status memuat, error, dan kosong (Bagian 6)', () => {
    it('menampilkan status memuat jadwal dengan nama studio dan kerangka abu statis', () => {
      let resolveCatalog!: (val: unknown) => void;
      const pendingCatalog = new Promise((resolve) => {
        resolveCatalog = resolve;
      });
      const mockCatalogClient: PublicClassCatalogClient = {
        list: vi.fn().mockReturnValue(pendingCatalog),
      };

      const { container } = render(
        <PublicClassesView
          client={mockCatalogClient}
          ledgerClient={dummyLedgerClient as any}
        />,
      );

      // Status memuat dengan nama studio
      expect(screen.getByText(/Memuat jadwal Daily Dose Green Garden…/i)).toBeInTheDocument();

      // Kerangka abu tanpa animate-pulse di dalam daftar sesi
      const pulseElements = container.querySelectorAll('.animate-pulse');
      expect(pulseElements.length).toBe(0);

      // Selesaikan promise agar tidak menggantung teardown vitest
      resolveCatalog({ branches: [], items: [] });
    });

    it('menampilkan status error dengan tombol coba muat ulang', async () => {
      const mockCatalogClient: PublicClassCatalogClient = {
        list: vi.fn().mockRejectedValue(new Error('Koneksi internet terputus saat mengambil data.')),
      };

      render(
        <PublicClassesView
          client={mockCatalogClient}
          ledgerClient={dummyLedgerClient as any}
        />,
      );

      expect(await screen.findByText('Jadwal gagal dimuat')).toBeInTheDocument();
      expect(
        screen.getByText(/Koneksi internet terputus saat mengambil data\./i),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Coba muat ulang' })).toBeInTheDocument();
    });

    it('menampilkan status tanggal tanpa kelas dengan nama studio dan tombol lihat tanggal berikutnya', async () => {
      window.history.replaceState(null, '', '/classes?branch=b1&date=2026-11-05');
      const mockCatalogClient: PublicClassCatalogClient = {
        list: vi.fn().mockResolvedValue({
          branches: [{ id: 'b1', code: 'DD-GG', name: 'Daily Dose Green Garden', timezone: 'Asia/Jakarta' }],
          range: { from: '2026-11-01T00:00:00Z', until: '2026-11-30T00:00:00Z' },
          items: [],
        }),
      };

      render(
        <PublicClassesView
          client={mockCatalogClient}
          ledgerClient={dummyLedgerClient as any}
        />,
      );

      // Teks empty state menyebutkan tanggal dan studio
      expect(await screen.findByText(/Tidak ada kelas pada/i)).toBeInTheDocument();
      expect(
        screen.getByText(/Studio Daily Dose Green Garden belum membuka kelas di tanggal ini\./i),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Lihat tanggal berikutnya' })).toBeInTheDocument();
    });
  });

  describe('Kriteria 1 & 5: Instruktur dan konfirmasi booking berhasil (Bagian 6)', () => {
    it('menampilkan status instruktur tidak ada kelas hari ini dan tombol buka jadwal mingguan', async () => {
      const mockClient = {
        discover: vi.fn().mockResolvedValue({
          branch: { id: 'b1', code: 'DD-GG', name: 'Daily Dose Green Garden', timezone: 'Asia/Jakarta' },
          slots: [],
        }),
      };
      const mockBookingClient = {
        list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      };
      const mockAvailabilityClient = {
        list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
        upsert: vi.fn(),
        delete: vi.fn(),
      };

      render(
        <InstructorTodayView
          client={mockClient as any}
          bookingClient={mockBookingClient as any}
          availabilityClient={mockAvailabilityClient as any}
          initialDate={new Date('2026-10-27T02:00:00Z')}
        />,
      );

      expect(
        await screen.findByText('Tidak ada kelas terjadwal untuk kamu hari ini.'),
      ).toBeInTheDocument();
      const linkJadwal = screen.getByRole('link', { name: /Buka jadwal mingguan/i });
      expect(linkJadwal).toBeInTheDocument();
      expect(linkJadwal).toHaveAttribute('href', '/workspace/classes');
    });

    it('menampilkan status booking berhasil dengan ringkasan lengkap dan tombol Lihat QR Pass & Tutup', async () => {
      const mockSlot = {
        id: 'slot-123',
        branchId: 'b1',
        studioId: 's1',
        classType: { id: 'ct-1', name: 'Reformers Pilates', code: 'GROUP' },
        startAt: '2026-11-02T09:00:00Z',
        endAt: '2026-11-02T10:00:00Z',
        capacity: 10,
        bookedCount: 3,
        priceRp: 200000,
        timezone: 'Asia/Jakarta',
        isBookedByMe: false,
        canBook: true,
      };

      const mockBookingClient = {
        create: vi.fn().mockResolvedValue({
          id: 'bk-123',
          bookingNumber: 'BK-20261102-001',
          classSlotId: 'slot-123',
          status: 'CONFIRMED',
        }),
      };

      render(
        <BookingConfirmationSheet
          isOpen={true}
          onClose={vi.fn()}
          slot={mockSlot as any}
          studioName="Daily Dose Green Garden"
          bookingClient={mockBookingClient as any}
          packageItem={{ id: 'pkg-1', available: 5 } as any}
        />,
      );

      // Klik tombol konfirmasi booking
      const btnKonfirmasi = screen.getByRole('button', { name: 'Konfirmasi booking sekarang' });
      await userEvent.click(btnKonfirmasi);

      // Verifikasi status berhasil
      expect(await screen.findByRole('heading', { name: 'Booking berhasil' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Lihat QR Pass' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Tutup' })).toBeInTheDocument();
    });
  });
});
