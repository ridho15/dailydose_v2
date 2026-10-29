import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomerDashboard } from './customer-dashboard';

const session = vi.hoisted(() => ({
  displayName: 'Nadia Customer',
  roles: ['CUSTOMER'],
  identityVerificationStatus: 'PENDING',
}));

vi.mock('../session-context', () => ({
  useSessionContext: () => ({ session }),
}));

describe('customer dashboard (Tiket T-02)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    session.identityVerificationStatus = 'PENDING';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          generatedAt: '2026-07-28T00:00:00.000Z',
          upcomingBookings: [],
          packages: [],
          actionableOrders: [
            {
              id: 'order-1',
              packageName: 'Reformer 10',
              branchName: 'Daily Dose Jakarta',
              status: 'AWAITING_PAYMENT',
              payableAmountRp: 1_600_123,
              expiresAt: '2026-07-29T00:00:00.000Z',
            },
          ],
          verification: { status: 'PENDING', documents: [] },
          unreadNotifications: 2,
        }),
      }),
    );
  });

  it('shows pending verification banner when verification is PENDING', async () => {
    render(<CustomerDashboard />);

    expect(await screen.findByRole('heading', { name: 'Halo, Nadia' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Data kamu sedang diperiksa' })).toBeVisible();
    expect(
      screen.getByText(
        'Data kamu sedang diperiksa tim studio. Kami kabari lewat WhatsApp kalau sudah selesai.',
      ),
    ).toBeVisible();
    const btn = screen.getByRole('link', { name: 'Lihat status verifikasi' });
    expect(btn).toBeVisible();
    expect(btn.getAttribute('href')).toBe('/account/verification?returnTo=%2Faccount');
  });

  it('shows unverified banner with prompt to complete verification (ACTION_REQUIRED)', async () => {
    session.identityVerificationStatus = 'ACTION_REQUIRED';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          generatedAt: '2026-07-28T00:00:00.000Z',
          upcomingBookings: [],
          packages: [],
          actionableOrders: [],
          verification: { status: 'ACTION_REQUIRED', documents: [] },
          unreadNotifications: 0,
        }),
      }),
    );

    render(<CustomerDashboard />);

    expect(await screen.findByRole('heading', { name: 'Halo, Nadia' })).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Ambil foto selfie dulu' }),
    ).toBeVisible();
    expect(
      screen.getByText(
        'Satu foto wajah, tanpa KTP. Wajib sebelum membeli paket dan booking kelas.',
      ),
    ).toBeVisible();
    const btn = screen.getByRole('link', { name: 'Ambil foto selfie' });
    expect(btn).toBeVisible();
    expect(btn.getAttribute('href')).toBe('/account/verification?returnTo=%2Faccount');
  });

  it('shows rejected verification banner with reason when verification is REJECTED', async () => {
    session.identityVerificationStatus = 'REJECTED';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          generatedAt: '2026-07-28T00:00:00.000Z',
          upcomingBookings: [],
          packages: [],
          actionableOrders: [],
          verification: {
            status: 'REJECTED',
            rejectionReason: 'Foto KTP terlalu buram',
            documents: [],
          },
          unreadNotifications: 0,
        }),
      }),
    );

    render(<CustomerDashboard />);

    expect(await screen.findByRole('heading', { name: 'Halo, Nadia' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Foto selfie perlu diambil ulang' })).toBeVisible();
    expect(
      screen.getByText('Foto sebelumnya belum bisa dipakai (Foto KTP terlalu buram). Ambil foto baru untuk lanjut.'),
    ).toBeVisible();
    const btn = screen.getByRole('link', { name: 'Ambil foto baru' });
    expect(btn).toBeVisible();
    expect(btn.getAttribute('href')).toBe('/account/verification?returnTo=%2Faccount');
  });

  it('hides verification banner completely when verification is APPROVED', async () => {
    session.identityVerificationStatus = 'APPROVED';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          generatedAt: '2026-07-28T00:00:00.000Z',
          upcomingBookings: [],
          packages: [],
          actionableOrders: [],
          verification: { status: 'APPROVED', documents: [] },
          unreadNotifications: 0,
        }),
      }),
    );

    render(<CustomerDashboard />);

    expect(await screen.findByRole('heading', { name: 'Halo, Nadia' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Ambil foto selfie dulu' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Data kamu sedang diperiksa' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Foto selfie perlu diambil ulang' })).toBeNull();
  });

  it('renders the QR at the top and the nearest booking with a cancel link (Tiket T-08)', async () => {
    session.identityVerificationStatus = 'APPROVED';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          generatedAt: '2026-07-28T00:00:00.000Z',
          upcomingBookings: [
            {
              id: 'booking-xyz-123',
              status: 'BOOKED',
              className: 'Reformer Flow Level 1',
              branchName: 'Studio Senopati - Studio 1',
              timezone: 'Asia/Jakarta',
              startAt: '2026-07-29T02:00:00.000Z',
              endAt: '2026-07-29T02:50:00.000Z',
            },
          ],
          packages: [
            {
              id: 'pkg-1',
              packageName: 'Reformer 10 Sesi',
              classTypeName: 'Reformer',
              branchName: 'Daily Dose Jakarta',
              expiryAt: '2026-12-31T00:00:00.000Z',
              available: 8,
            },
          ],
          actionableOrders: [],
          verification: { status: 'APPROVED', documents: [] },
          unreadNotifications: 1,
        }),
      }),
    );

    render(<CustomerDashboard />);

    // 1. Heading greeting
    expect(await screen.findByRole('heading', { name: 'Halo, Nadia' })).toBeVisible();

    // 2. Kartu booking terdekat di paling atas
    const nearestSection = screen.getByLabelText('Booking terdekat');
    expect(within(nearestSection).getByText('Booking terdekat')).toBeVisible();
    expect(
      within(nearestSection).getByRole('heading', { name: 'Reformer Flow Level 1' }),
    ).toBeVisible();
    expect(within(nearestSection).getByText('Studio Senopati - Studio 1')).toBeVisible();

    // 3. QR statis ada di paling atas beranda, bukan per booking.
    expect(screen.getByRole('heading', { name: 'QR kehadiran saya' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Perbesar' })).toHaveAttribute(
      'href',
      '/check-in-pass',
    );
    expect(
      within(nearestSection).getByRole('link', { name: 'Batalkan booking ini' }),
    ).toHaveAttribute('href', '/bookings/booking-xyz-123');

    // 4. Tanpa kartu statistik pasif.
    expect(screen.queryByText('Notifikasi belum dibaca')).toBeNull();
  });

  it('menampilkan kelas minggu ini di studio utama dan membuka lembar booking kelas itu', async () => {
    session.identityVerificationStatus = 'APPROVED';
    (session as Record<string, unknown>).preferredBranch = {
      id: 'branch-gg',
      name: 'Green Garden',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          generatedAt: '2026-10-28T00:00:00.000Z',
          upcomingBookings: [],
          packages: [
            {
              id: 'p',
              packageName: 'Group 10',
              classTypeName: 'Group',
              branchName: 'Green Garden',
              expiryAt: '2026-12-31T00:00:00.000Z',
              available: 4,
            },
          ],
          actionableOrders: [],
          verification: { status: 'APPROVED' },
          unreadNotifications: 0,
        }),
      }),
    );
    const classCatalogClient = {
      list: vi.fn().mockResolvedValue({
        branches: [],
        range: { from: '', until: '' },
        items: [
          {
            id: 'slot-7',
            timezone: 'Asia/Jakarta',
            status: 'PUBLISHED',
            capacity: 8,
            available: 3,
            canBook: true,
            branchId: 'branch-gg',
            startAt: '2026-10-29T00:00:00.000Z',
            endAt: '2026-10-29T00:55:00.000Z',
            classType: { name: 'Semi Private Reformer' },
            instructor: { displayName: 'Devi' },
          },
        ],
      }),
    };

    render(<CustomerDashboard classCatalogClient={classCatalogClient as never} />);

    const week = await screen.findByRole('region', { name: 'Kelas minggu ini di Green Garden' });
    expect(within(week).getByText('3 slot tersisa')).toBeVisible();
    expect(within(week).getByRole('link', { name: /Semi Private Reformer/ })).toHaveAttribute(
      'href',
      '/classes?branch=branch-gg&slot=slot-7',
    );
    expect(classCatalogClient.list).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: 'branch-gg' }),
    );
  });

  it('renders friendly empty state when member has no upcoming bookings per Spec 6 (Tiket T-08)', async () => {
    session.identityVerificationStatus = 'APPROVED';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          generatedAt: '2026-07-28T00:00:00.000Z',
          upcomingBookings: [],
          packages: [
            {
              id: 'pkg-1',
              packageName: 'Mat Pilates 5',
              classTypeName: 'Mat',
              branchName: 'Daily Dose Jakarta',
              expiryAt: '2026-12-31T00:00:00.000Z',
              available: 5,
            },
          ],
          actionableOrders: [],
          verification: { status: 'APPROVED', documents: [] },
          unreadNotifications: 0,
        }),
      }),
    );

    render(<CustomerDashboard />);

    expect(await screen.findByRole('heading', { name: 'Halo, Nadia' })).toBeVisible();
    expect(
      screen.getByText('Belum ada booking mendatang. Pilih jadwal kelas untuk mulai latihan.'),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Lihat jadwal kelas' })).toBeVisible();
  });
  describe('tujuan tombol "Booking kelas"', () => {
    const stubOverview = (packages: unknown[]) =>
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            generatedAt: '2026-07-28T00:00:00.000Z',
            upcomingBookings: [],
            packages,
            actionableOrders: [],
            verification: { status: 'APPROVED', documents: [] },
            unreadNotifications: 0,
          }),
        }),
      );

    it('tanpa paket aktif membuka jadwal studio utama', async () => {
      (session as Record<string, unknown>).preferredBranch = {
        id: 'branch-mk',
        name: 'Muara Karang',
      };
      stubOverview([]);
      render(<CustomerDashboard />);
      await screen.findByRole('heading', { name: 'Halo, Nadia' });
      expect(screen.getByRole('link', { name: 'Booking kelas' })).toHaveAttribute(
        'href',
        '/classes?branch=branch-mk',
      );
    });

    it('dengan paket aktif membuka jadwal tanpa memaksa studio utama (halaman jadwal memilih studio paket)', async () => {
      (session as Record<string, unknown>).preferredBranch = {
        id: 'branch-mk',
        name: 'Muara Karang',
      };
      stubOverview([
        {
          id: 'cp-1',
          packageName: 'Paket Green Garden',
          classTypeName: 'Group',
          branchName: 'Green Garden',
          expiryAt: '2026-12-20T00:00:00.000Z',
          available: 5,
        },
      ]);
      render(<CustomerDashboard />);
      await screen.findByRole('heading', { name: 'Halo, Nadia' });
      expect(screen.getByRole('link', { name: 'Booking kelas' })).toHaveAttribute(
        'href',
        '/classes',
      );
    });
  });

  it('menaruh QR paling atas, lalu sisa sesi paket, tiga sesi terakhir, dan promo yang berlaku', async () => {
    session.identityVerificationStatus = 'APPROVED';
    (session as Record<string, unknown>).preferredBranch = {
      id: 'branch-gg',
      name: 'Green Garden',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          generatedAt: '2026-10-28T00:00:00.000Z',
          upcomingBookings: [],
          packages: [
            {
              id: 'p',
              packageName: 'Group 10 sesi',
              classTypeName: 'Group',
              branchName: 'Green Garden',
              expiryAt: '2026-12-31T00:00:00.000Z',
              available: 7,
            },
          ],
          actionableOrders: [],
          verification: { status: 'APPROVED' },
          unreadNotifications: 0,
        }),
      }),
    );
    const riwayat = (
      id: string,
      status: string,
      kelas: string,
      instruktur: string,
      startAt: string,
    ) => ({
      id,
      status,
      classSlot: {
        id: 's',
        startAt,
        endAt: startAt,
        timezone: 'Asia/Jakarta',
        status: 'COMPLETED',
        classType: { id: 'c', name: kelas },
        instructor: { displayName: instruktur },
      },
    });
    const bookingClient = {
      list: vi.fn().mockResolvedValue({
        items: [
          riwayat('b1', 'ATTENDED', 'Group Reformer', 'Asrida Putri', '2026-10-27T10:00:00Z'),
          riwayat('b2', 'CANCELLED', 'Batal', 'X', '2026-10-26T10:00:00Z'),
          riwayat('b3', 'NO_SHOW', 'Semi Private', 'Devi', '2026-10-24T10:00:00Z'),
          riwayat('b4', 'ATTENDED', 'Private', 'Anna', '2026-10-22T10:00:00Z'),
          riwayat('b5', 'ATTENDED', 'Lama', 'Anna', '2026-10-20T10:00:00Z'),
        ],
      }),
    };
    const promo = (id: string, until: string, from = '2026-10-01T00:00:00Z') => ({
      id,
      name: `Paket ${id}`,
      branchId: 'branch-gg',
      classType: { id: 'c', name: 'Group' },
      effectiveUntil: null,
      promotion: {
        id: `pr-${id}`,
        name: 'Promo',
        label: 'Hemat 20%',
        discountType: 'PERCENTAGE',
        discountValue: 20,
        discountRp: 300_000,
        promotionalPriceRp: 1_200_000,
        activeFrom: from,
        activeUntil: until,
        version: 1,
      },
    });
    const packageCatalogClient = {
      list: vi.fn().mockResolvedValue({
        branches: [],
        items: [
          promo('lama', '2026-10-01T00:00:00Z', '2026-09-01T00:00:00Z'),
          promo('a', '2026-11-30T00:00:00Z'),
          { ...promo('tanpa', '2026-11-30T00:00:00Z'), promotion: null },
        ],
      }),
    };

    render(
      <CustomerDashboard
        now={new Date('2026-10-28T03:00:00Z').getTime()}
        muatQr={() => Promise.resolve('dd-pass:v1:x')}
        bookingClient={bookingClient as never}
        packageCatalogClient={packageCatalogClient as never}
        classCatalogClient={{
          list: vi
            .fn()
            .mockResolvedValue({ branches: [], items: [], range: { from: '', until: '' } }),
        }}
      />,
    );

    const judul = (await screen.findAllByRole('heading', { level: 2 })).map((h) => h.textContent);
    expect(judul[0]).toBe('QR kehadiran saya');
    expect(judul[1]).toBe('Sisa paket saya');
    expect(
      within(screen.getByRole('region', { name: 'Sisa paket saya' })).getByText('7'),
    ).toBeVisible();

    const terakhir = await screen.findByRole('region', { name: 'Sesi terakhir yang terpakai' });
    expect(within(terakhir).getAllByRole('listitem')).toHaveLength(3);
    expect(within(terakhir).getByText('Asrida Putri')).toBeVisible();
    expect(within(terakhir).getByText('Tidak hadir · sesi hangus')).toBeVisible();
    expect(within(terakhir).queryByText('Batal')).toBeNull();

    const promoBagian = await screen.findByRole('region', { name: 'Promo yang sedang berlaku' });
    expect(within(promoBagian).getAllByRole('listitem')).toHaveLength(1);
    expect(within(promoBagian).getByText('Paket a')).toBeVisible();
    expect(within(promoBagian).getByText('Hemat 20%')).toBeVisible();
  });
});
