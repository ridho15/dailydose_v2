import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppFeedbackProvider } from '../components/app-feedback';
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


const bookingTerdekat = (overrides: Record<string, unknown> = {}) => ({
  id: 'booking-xyz-123',
  classSlotId: 'slot-1',
  customerPackageId: 'pkg-1',
  status: 'BOOKED',
  className: 'Reformer Flow Level 1',
  branchName: 'Studio Senopati - Studio 1',
  timezone: 'Asia/Jakarta',
  startAt: '2026-07-29T02:00:00.000Z',
  endAt: '2026-07-29T02:50:00.000Z',
  ...overrides,
});

const paketAktif = () => ({
  id: 'pkg-1',
  packageName: 'Reformer 10 Sesi',
  classTypeName: 'Reformer',
  branchName: 'Daily Dose Jakarta',
  expiryAt: '2026-12-31T00:00:00.000Z',
  available: 8,
});

function stubDashboard(isi: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        generatedAt: '2026-07-28T00:00:00.000Z',
        upcomingBookings: [],
        packages: [],
        actionableOrders: [],
        verification: { status: 'APPROVED' },
        unreadNotifications: 0,
        ...isi,
      }),
    }),
  );
}

function klienBooking(overrides: Record<string, unknown> = {}) {
  return {
    list: vi.fn().mockResolvedValue({ items: [] }),
    cancellationOptions: vi.fn().mockResolvedValue({
      canCancel: true,
      unavailableReason: null,
      supportAction: null,
      cutoffAt: '2026-07-28T14:00:00.000Z',
    }),
    cancel: vi.fn().mockResolvedValue(undefined),
    rescheduleOptions: vi.fn().mockResolvedValue({
      bookingId: 'booking-xyz-123',
      bookingVersion: 1,
      sourceClassSlotId: 'slot-1',
      cutoffAt: new Date('2026-07-28T14:00:00.000Z'),
      canRequest: true,
      unavailableReason: null,
      supportAction: null,
      latestRequest: null,
      targets: [
        {
          id: 'slot-baru',
          startAt: new Date('2026-07-30T02:00:00.000Z'),
          endAt: new Date('2026-07-30T02:50:00.000Z'),
          timezone: 'Asia/Jakarta',
          status: 'PUBLISHED',
          availableCapacity: 3,
          eligible: true,
          classType: { id: 'c', name: 'Reformer' },
          instructor: { id: 'i', displayName: 'Asrida' },
        },
      ],
    }),
    requestReschedule: vi.fn().mockResolvedValue({ id: 'r-1', status: 'APPROVED' }),
    create: vi.fn().mockResolvedValue({ id: 'bk-teman', status: 'BOOKED' }),
    statusPembatalanSaya: vi.fn().mockResolvedValue({ bisaMengajukan: true, pengajuan: null }),
    ajukanPembatalanSaya: vi.fn().mockResolvedValue({ id: 'req-1', status: 'PENDING', reason: 'x' }),
    ...overrides,
  };
}

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

  it('kartu booking terdekat memuat QR, Ganti jadwal, dan Batalkan dalam satu tempat', async () => {
    session.identityVerificationStatus = 'APPROVED';
    stubDashboard({ upcomingBookings: [bookingTerdekat()], packages: [paketAktif()] });

    render(
      <AppFeedbackProvider>
        <CustomerDashboard bookingClient={klienBooking() as never} muatQr={() => Promise.resolve('dd-pass:v1:x')} />
      </AppFeedbackProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Halo, Nadia' })).toBeVisible();
    const kartu = screen.getByLabelText('Booking terdekat');
    expect(within(kartu).getByRole('heading', { name: 'Reformer Flow Level 1' })).toBeVisible();
    expect(within(kartu).getByText('Studio Senopati - Studio 1')).toBeVisible();
    // QR check-in ada di kartu itu sendiri, dengan tombol Perbesar.
    expect(within(kartu).getByRole('heading', { name: 'QR kehadiran saya' })).toBeVisible();
    expect(within(kartu).getByRole('link', { name: 'Perbesar' })).toHaveAttribute('href', '/check-in-pass');
    expect(within(kartu).getByRole('button', { name: 'Ganti jadwal' })).toBeVisible();
    await waitFor(() => expect(within(kartu).getByRole('button', { name: 'Batalkan' })).toBeEnabled());
    expect(within(kartu).queryByRole('button', { name: 'Ajukan pembatalan' })).toBeNull();
    expect(screen.queryByText('Notifikasi belum dibaca')).toBeNull();
  });

  it('kurang dari 12 jam: tombolnya Ajukan pembatalan, alasan dari pilihan, terkirim ke server', async () => {
    const user = userEvent.setup();
    session.identityVerificationStatus = 'APPROVED';
    stubDashboard({ upcomingBookings: [bookingTerdekat()], packages: [paketAktif()] });
    const client = klienBooking({
      cancellationOptions: vi.fn().mockResolvedValue({
        canCancel: false,
        unavailableReason: 'CANCELLATION_CUTOFF_PASSED',
        supportAction: 'CONTACT_STUDIO',
        cutoffAt: '2026-07-28T14:00:00.000Z',
      }),
    });

    render(
      <AppFeedbackProvider>
        <CustomerDashboard bookingClient={client as never} muatQr={() => Promise.resolve('dd-pass:v1:x')} />
      </AppFeedbackProvider>,
    );

    const kartu = await screen.findByLabelText('Booking terdekat');
    await user.click(await within(kartu).findByRole('button', { name: 'Ajukan pembatalan' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ajukan pembatalan' });
    const kirim = within(dialog).getByRole('button', { name: 'Kirim pengajuan' });
    expect(kirim).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Sakit atau kurang sehat' }));
    await user.click(kirim);

    await waitFor(() =>
      // Bukti tidak wajib bagi member: tanpa berkas tetap terkirim.
      expect(client.ajukanPembatalanSaya).toHaveBeenCalledWith('booking-xyz-123', 'SAKIT', undefined, null),
    );
  });

  it('ganti jadwal: pilih kartu jam pengganti lalu Pindah, tiga langkah', async () => {
    const user = userEvent.setup();
    session.identityVerificationStatus = 'APPROVED';
    stubDashboard({ upcomingBookings: [bookingTerdekat()], packages: [paketAktif()] });
    const client = klienBooking();

    render(
      <AppFeedbackProvider>
        <CustomerDashboard bookingClient={client as never} muatQr={() => Promise.resolve('dd-pass:v1:x')} />
      </AppFeedbackProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'Ganti jadwal' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ganti jadwal' });
    await user.click(await within(dialog).findByRole('button', { name: /3 tempat tersisa/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Pindah ke jadwal ini' }));

    await waitFor(() =>
      expect(client.requestReschedule).toHaveBeenCalledWith(
        expect.objectContaining({ bookingId: 'booking-xyz-123', targetClassSlotId: 'slot-baru' }),
        expect.any(String),
      ),
    );
  });

  it('kursi teman dari kartu booking: isi nama lalu tambah, memakai paket booking itu', async () => {
    const user = userEvent.setup();
    session.identityVerificationStatus = 'APPROVED';
    stubDashboard({ upcomingBookings: [bookingTerdekat({ bisaTambahTeman: true })], packages: [paketAktif()] });
    const client = klienBooking();

    render(
      <AppFeedbackProvider>
        <CustomerDashboard bookingClient={client as never} muatQr={() => Promise.resolve('dd-pass:v1:x')} />
      </AppFeedbackProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'Kursi teman' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tambah kursi teman' });
    await user.type(within(dialog).getByLabelText('Nama teman'), 'Rani');
    await user.click(within(dialog).getByRole('button', { name: 'Tambah kursi teman' }));

    await waitFor(() =>
      expect(client.create).toHaveBeenCalledWith(
        { classSlotId: 'slot-1', customerPackageId: 'pkg-1', source: 'SELF', namaTeman: 'Rani' },
        expect.any(String),
      ),
    );
  });

  it('saran Booking lagi membuka konfirmasi booking kelas yang sama minggu depan', async () => {
    session.identityVerificationStatus = 'APPROVED';
    stubDashboard({
      packages: [paketAktif()],
      bookingLagi: {
        classSlotId: 'slot-minggu-depan',
        className: 'Reformer Flow Level 1',
        branchName: 'Senopati',
        timezone: 'Asia/Jakarta',
        startAt: '2026-08-05T02:00:00.000Z',
        endAt: '2026-08-05T02:50:00.000Z',
        instructorName: 'Asrida',
      },
    });
    render(<CustomerDashboard bookingClient={klienBooking() as never} />);
    expect(await screen.findByRole('link', { name: /Booking lagi Reformer Flow Level 1/ })).toHaveAttribute(
      'href',
      '/bookings/new?slot=slot-minggu-depan',
    );
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

  it('tanpa booking: sisa paket, tombol Perpanjang 30 hari bila hampir habis, tiga sesi terakhir, dan promo', async () => {
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
              expiryAt: '2026-11-05T16:59:59.000Z',
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
          { ...promo('ext', '2026-11-30T00:00:00Z'), promotion: null, perpanjanganMasaAktif: true },
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

    const paketSaya = await screen.findByRole('region', { name: 'Sisa paket saya' });
    expect(within(paketSaya).getByText('7')).toBeVisible();
    // Berlaku 8 hari lagi: tombol perpanjang membawa paket ini sebagai target.
    expect(await within(paketSaya).findByRole('link', { name: 'Perpanjang 30 hari' })).toHaveAttribute(
      'href',
      '/checkout?package=ext&branch=branch-gg&target=p',
    );
    // Tanpa booking mendatang, QR tidak ditampilkan (tidak ada kelas untuk check-in).
    expect(screen.queryByRole('heading', { name: 'QR kehadiran saya' })).toBeNull();

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
