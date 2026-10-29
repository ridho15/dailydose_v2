import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicClassesView } from '@/classes/public-classes-view';
import type { PublicClassCatalogClient } from '@/api-clients/public-class-catalog-client';
import type { LedgerClient, LedgerBalance } from '@/api-clients/ledger-client';
import { ApiError } from '@/lib/api-client';

const session = vi.hoisted(() => ({
  displayName: 'Nadia Customer',
  roles: ['CUSTOMER'],
  identityVerificationStatus: 'APPROVED',
  user: { verificationStatus: 'APPROVED' },
}));

vi.mock('../session-context', () => ({
  useSessionContext: () => ({ session }),
}));

const branchKemang = { id: 'branch-kemang', code: 'KM', name: 'Daily Dose Kemang', timezone: 'Asia/Jakarta' };
const branchBSD = { id: 'branch-bsd', code: 'BSD', name: 'Daily Dose BSD', timezone: 'Asia/Jakarta' };

const typeGroup = { id: 'type-group', code: 'GROUP_CLASS', name: 'Group Reformer' };
const typePrivate = { id: 'type-private', code: 'PRIVATE_CLASS', name: 'Private Pilates' };

describe('Customer Smart Booking on Public Classes Catalog', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  const matchingPackage: LedgerBalance = {
    id: 'cpkg-1',
    branchId: branchKemang.id,
    packageBranchId: branchKemang.id,
    status: 'ACTIVE',
    activationDate: new Date('2026-01-01'),
    expiryAt: new Date('2026-12-31'),
    ledgerBalance: 5,
    reserved: 0,
    available: 5,
    packageName: '5x Group Reformer Kemang',
    branchName: branchKemang.name,
    classTypeName: typeGroup.name,
    classTypeId: typeGroup.id,
  };

  it('differentiates buttons: shows "Lanjutkan booking" for matching slots and "Beli paket untuk kelas ini" for non-matching slots', async () => {
    const itemsList = [
      {
        id: 'slot-matching',
        branchId: branchKemang.id,
        classTypeId: typeGroup.id,
        classType: typeGroup,
        startAt: '2026-07-25T03:00:00.000Z',
        endAt: '2026-07-25T03:50:00.000Z',
        timezone: branchKemang.timezone,
        status: 'PUBLISHED',
        capacity: 6,
        available: 4,
        canBook: true,
      },
      {
        id: 'slot-nonmatching',
        branchId: branchKemang.id,
        classTypeId: typePrivate.id,
        classType: typePrivate,
        startAt: '2026-07-25T05:00:00.000Z',
        endAt: '2026-07-25T05:50:00.000Z',
        timezone: branchKemang.timezone,
        status: 'PUBLISHED',
        capacity: 1,
        available: 1,
        canBook: true,
      },
    ];

    const client: PublicClassCatalogClient = {
      list: vi.fn().mockImplementation((input: { branchId?: string }) => {
        if (input?.branchId) {
          return Promise.resolve({
            branches: [branchKemang, branchBSD],
            range: { from: '2026-07-23T00:00:00.000Z', until: '2026-08-06T00:00:00.000Z' },
            items: itemsList,
          });
        }
        return Promise.resolve({
          branches: [branchKemang, branchBSD],
          items: [],
          range: { from: '', until: '' },
        });
      }),
    };

    const mockLedgerClient: LedgerClient = {
      list: vi.fn().mockResolvedValue({
        items: [matchingPackage],
        summary: { packageCount: 1, ledgerBalance: 5, reserved: 0, available: 5 },
        page: {},
      }),
      detail: vi.fn(),
      listAdjustments: vi.fn(),
      getAdjustment: vi.fn(),
      requestAdjustment: vi.fn(),
      decideAdjustment: vi.fn(),
    };

    render(<PublicClassesView client={client} ledgerClient={mockLedgerClient} />);

    // 1. Active package banner should be visible and studio auto-selected from customer package
    expect(await screen.findByText(/Paket Aktif:/)).toBeVisible();
    expect(screen.getByText('5x Group Reformer Kemang')).toBeVisible();
    expect(screen.getByText('5 sesi')).toBeVisible();

    // 2. Both classes should be loaded automatically via auto-select
    expect(await screen.findByText('Group Reformer')).toBeVisible();
    expect(screen.getByText('Private Pilates')).toBeVisible();

    // 3. Slot 1 (Matching Group Reformer) should have "Lanjutkan booking" and "Paket Sesuai" badge
    const continueBtn = screen.getByRole('link', { name: 'Lanjutkan booking' });
    expect(continueBtn).toHaveAttribute('href', '/bookings/new?slot=slot-matching');
    expect(screen.getByText(/Paket Sesuai \(5 sesi\)/)).toBeVisible();

    // 4. Slot 2 (Private class) should have "Beli paket untuk kelas ini" and warning badge
    const buyPackageBtn = screen.getByRole('link', { name: 'Beli paket untuk kelas ini' });
    expect(buyPackageBtn).toHaveAttribute(
      'href',
      expect.stringContaining(`/packages?branch=${branchKemang.id}&classType=${typePrivate.id}`),
    );
    expect(screen.getByText('Perlu paket studio/kelas ini')).toBeVisible();
  });

  it('filters out non-matching classes when "Hanya kelas sesuai paket saya" toggle is checked', async () => {
    const itemsList = [
      {
        id: 'slot-1',
        branchId: branchKemang.id,
        classTypeId: typeGroup.id,
        classType: typeGroup,
        startAt: '2026-07-25T03:00:00.000Z',
        endAt: '2026-07-25T03:50:00.000Z',
        timezone: branchKemang.timezone,
        status: 'PUBLISHED',
        capacity: 6,
        available: 4,
        canBook: true,
      },
      {
        id: 'slot-2',
        branchId: branchKemang.id,
        classTypeId: typePrivate.id,
        classType: typePrivate,
        startAt: '2026-07-25T05:00:00.000Z',
        endAt: '2026-07-25T05:50:00.000Z',
        timezone: branchKemang.timezone,
        status: 'PUBLISHED',
        capacity: 1,
        available: 1,
        canBook: true,
      },
    ];

    const client: PublicClassCatalogClient = {
      list: vi.fn().mockImplementation((input: { branchId?: string }) => {
        if (input?.branchId) {
          return Promise.resolve({
            branches: [branchKemang],
            range: { from: '2026-07-23T00:00:00.000Z', until: '2026-08-06T00:00:00.000Z' },
            items: itemsList,
          });
        }
        return Promise.resolve({
          branches: [branchKemang],
          items: [],
          range: { from: '', until: '' },
        });
      }),
    };

    const mockLedgerClient: LedgerClient = {
      list: vi.fn().mockResolvedValue({
        items: [matchingPackage],
        summary: { packageCount: 1, ledgerBalance: 5, reserved: 0, available: 5 },
        page: {},
      }),
      detail: vi.fn(),
      listAdjustments: vi.fn(),
      getAdjustment: vi.fn(),
      requestAdjustment: vi.fn(),
      decideAdjustment: vi.fn(),
    };

    render(<PublicClassesView client={client} ledgerClient={mockLedgerClient} />);

    // Both should be visible initially via auto-select
    expect(await screen.findByText('Group Reformer')).toBeVisible();
    expect(screen.getByText('Private Pilates')).toBeVisible();

    // Toggle filter
    const toggle = screen.getByRole('checkbox', { name: 'Hanya kelas sesuai paket saya' });
    await userEvent.click(toggle);

    // Now Private Pilates should be filtered out
    expect(screen.getByText('Group Reformer')).toBeVisible();
    expect(screen.queryByText('Private Pilates')).not.toBeInTheDocument();
  });

  it('opens confirmation bottom sheet in-place when "Lanjutkan booking" is clicked (3-Tap Flow)', async () => {
    const itemsList = [
      {
        id: 'slot-tap2',
        branchId: branchKemang.id,
        classTypeId: typeGroup.id,
        classType: typeGroup,
        startAt: '2026-07-25T03:00:00.000Z',
        endAt: '2026-07-25T03:50:00.000Z',
        timezone: branchKemang.timezone,
        status: 'PUBLISHED',
        capacity: 6,
        available: 4,
        canBook: true,
      },
    ];

    const client: PublicClassCatalogClient = {
      list: vi.fn().mockImplementation((input: { branchId?: string }) => {
        if (input?.branchId) {
          return Promise.resolve({
            branches: [branchKemang],
            range: { from: '2026-07-23T00:00:00.000Z', until: '2026-08-06T00:00:00.000Z' },
            items: itemsList,
          });
        }
        return Promise.resolve({
          branches: [branchKemang],
          items: [],
          range: { from: '', until: '' },
        });
      }),
    };

    const mockLedgerClient: LedgerClient = {
      list: vi.fn().mockResolvedValue({
        items: [matchingPackage],
        summary: { packageCount: 1, ledgerBalance: 5, reserved: 0, available: 5 },
        page: {},
      }),
      detail: vi.fn(),
      listAdjustments: vi.fn(),
      getAdjustment: vi.fn(),
      requestAdjustment: vi.fn(),
      decideAdjustment: vi.fn(),
    };

    const mockBookingClient = {
      create: vi.fn().mockResolvedValue({
        id: 'bk-tap3',
        bookingNumber: 'BK-3TAP-SUCCESS',
        status: 'BOOKED',
        createdAt: new Date(),
        version: 1,
      }),
      list: vi.fn(),
      get: vi.fn(),
      cancel: vi.fn(),
      reschedule: vi.fn(),
      requestAdjustment: vi.fn(),
      listAdjustments: vi.fn(),
      getAdjustment: vi.fn(),
      decideAdjustment: vi.fn(),
      getCheckInPass: vi.fn(),
      verifyAttendance: vi.fn(),
    };

    render(
      <PublicClassesView
        client={client}
        ledgerClient={mockLedgerClient}
        bookingClient={mockBookingClient as any}
      />,
    );

    // Ensure customer package is loaded and matching badge is visible
    expect(await screen.findByText(/Paket Aktif:/)).toBeVisible();
    expect(await screen.findByText(/Paket Sesuai \(5 sesi\)/)).toBeVisible();

    // Tap 2: Click "Lanjutkan booking"
    const continueBtn = screen.getByRole('link', { name: 'Lanjutkan booking' });
    fireEvent.click(continueBtn);

    // Bottom sheet opens in-place
    expect(await screen.findByRole('dialog', { name: 'Group Reformer' })).toBeVisible();
    expect(screen.getByText('Konfirmasi Booking')).toBeVisible();
    expect(screen.getByText('Daily Dose Kemang')).toBeVisible();

    // Tap 3: Click "Konfirmasi booking sekarang"
    const confirmBtn = screen.getByRole('button', { name: 'Konfirmasi booking sekarang' });
    await userEvent.click(confirmBtn);

    // Booking success in-place
    expect(await screen.findByText('Booking berhasil')).toBeVisible();
    expect(screen.getByText('BK-3TAP-SUCCESS')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Lihat QR Pass' })).toBeVisible();
  });

  describe('kelas yang sudah dipesan dan slot yang baru penuh', () => {
    const baseSlot = {
      id: 'slot-x',
      branchId: branchKemang.id,
      classTypeId: typeGroup.id,
      classType: typeGroup,
      startAt: '2026-07-25T03:00:00.000Z',
      endAt: '2026-07-25T03:50:00.000Z',
      timezone: branchKemang.timezone,
      status: 'PUBLISHED',
      capacity: 6,
      available: 4,
      canBook: true,
    };
    const ledgerClient = (): LedgerClient => ({
      list: vi.fn().mockResolvedValue({
        items: [matchingPackage],
        summary: { packageCount: 1, ledgerBalance: 5, reserved: 0, available: 5 },
        page: {},
      }),
      detail: vi.fn(),
      listAdjustments: vi.fn(),
      getAdjustment: vi.fn(),
      requestAdjustment: vi.fn(),
      decideAdjustment: vi.fn(),
    });
    const catalog = (itemsFor: () => unknown[]): PublicClassCatalogClient => ({
      list: vi.fn().mockImplementation(() =>
        Promise.resolve({
          branches: [branchKemang],
          range: { from: '2026-07-23T00:00:00.000Z', until: '2026-08-06T00:00:00.000Z' },
          items: itemsFor(),
        }),
      ),
    });

    it('menandai kelas yang sudah dipesan dan mengganti tombolnya dengan "Lihat booking"', async () => {
      const client = catalog(() => [
        { ...baseSlot, id: 'slot-booked' },
        { ...baseSlot, id: 'slot-free', startAt: '2026-07-25T05:00:00.000Z', endAt: '2026-07-25T05:50:00.000Z' },
      ]);
      const bookingClient = {
        list: vi.fn().mockResolvedValue({ items: [{ id: 'bk-77', classSlotId: 'slot-booked' }] }),
      };

      render(
        <PublicClassesView
          client={client}
          ledgerClient={ledgerClient()}
          bookingClient={bookingClient as any}
        />,
      );

      expect(await screen.findByText('Sudah Anda booking')).toBeVisible();
      expect(screen.getByRole('link', { name: 'Lihat booking' })).toHaveAttribute(
        'href',
        '/bookings/bk-77',
      );
      // Hanya kelas yang belum dipesan yang masih menawarkan booking.
      const offers = screen.getAllByRole('link', { name: 'Lanjutkan booking' });
      expect(offers).toHaveLength(1);
      expect(offers[0]).toHaveAttribute('href', '/bookings/new?slot=slot-free');
      expect(bookingClient.list).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'BOOKED', timeline: 'UPCOMING' }),
      );
    });

    it('memuat ulang jadwal saat server menolak karena kelas baru saja penuh', async () => {
      let full = false;
      const client = catalog(() => [{ ...baseSlot, available: full ? 0 : 1 }]);
      const bookingClient = {
        list: vi.fn().mockResolvedValue({ items: [] }),
        create: vi.fn().mockImplementation(() => {
          full = true; // orang lain mengambil kursi terakhir
          return Promise.reject(
            new ApiError('Permintaan tidak dapat diproses.', 409, {
              error: { code: 'CLASS_CAPACITY_FULL' },
            }),
          );
        }),
      };

      render(
        <PublicClassesView
          client={client}
          ledgerClient={ledgerClient()}
          bookingClient={bookingClient as any}
        />,
      );

      fireEvent.click(await screen.findByRole('link', { name: 'Lanjutkan booking' }));
      await userEvent.click(
        await screen.findByRole('button', { name: 'Konfirmasi booking sekarang' }),
      );
      expect(
        await screen.findByRole('heading', { name: 'Slot kelas ini baru saja penuh' }),
      ).toBeVisible();

      await userEvent.click(screen.getByRole('button', { name: 'Lihat jam lain' }));
      // Daftar sudah disegarkan: kartu menjadi penuh dan tidak lagi bisa dipesan.
      await waitFor(() => expect(screen.getAllByText('Penuh, 0 slot').length).toBeGreaterThan(0));
      expect(screen.queryByRole('link', { name: 'Lanjutkan booking' })).not.toBeInTheDocument();
    });
  });
  describe('banner verifikasi di jadwal', () => {
    const emptyCatalog = (): PublicClassCatalogClient => ({
      list: vi.fn().mockResolvedValue({
        branches: [branchKemang],
        range: { from: '2026-07-23T00:00:00.000Z', until: '2026-08-06T00:00:00.000Z' },
        items: [],
      }),
    });
    const noPackages = (): LedgerClient =>
      ({
        list: vi.fn().mockResolvedValue({ items: [], summary: {}, page: {} }),
      }) as unknown as LedgerClient;

    it.each([
      [
        'ACTION_REQUIRED',
        'Ambil foto selfie dulu supaya bisa memesan kelas. Tidak perlu KTP.',
        'Lengkapi verifikasi',
        /^\/account\/verification\?returnTo=%2F/,
      ],
      [
        'PENDING',
        'Dokumen verifikasi Anda sedang diperiksa tim studio. Anda bisa memesan kelas setelah disetujui.',
        'Cek status verifikasi',
        /^\/account\/verification$/,
      ],
      [
        'REJECTED',
        'Verifikasi identitas Anda belum disetujui. Perbaiki dokumen untuk bisa memesan kelas.',
        'Perbaiki dokumen',
        /^\/account\/verification\?returnTo=%2F/,
      ],
    ])('menjelaskan status %s dengan kalimat dan tautan yang sesuai', async (status, message, action, href) => {
      session.identityVerificationStatus = status;
      window.history.replaceState({}, '', '/classes?branch=branch-kemang&date=2026-07-25');
      try {
        render(<PublicClassesView client={emptyCatalog()} ledgerClient={noPackages()} />);
        expect(await screen.findByText(message)).toBeVisible();
        const link = screen.getByRole('link', { name: new RegExp(action) });
        expect(link.getAttribute('href')).toMatch(href);
        if (status !== 'PENDING') {
          expect(decodeURIComponent(link.getAttribute('href') ?? '')).toContain(
            '/classes?branch=branch-kemang&date=2026-07-25',
          );
        }
      } finally {
        session.identityVerificationStatus = 'APPROVED';
      }
    });

    it('tidak menampilkan banner untuk akun yang sudah terverifikasi', async () => {
      render(<PublicClassesView client={emptyCatalog()} ledgerClient={noPackages()} />);
      await screen.findByText(/Jadwal kelas/i);
      expect(screen.queryByText(/verifikasi identitas/i)).not.toBeInTheDocument();
    });
  });
});
