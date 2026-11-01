import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ExpiryCohort, RetentionClient, RetentionRow } from '@/api-clients/retention-client';
import { belumKembaliPer, nomorWhatsApp, RenewalView, urutDaftar } from './renewal-view';

const NOW = new Date('2026-10-28T03:00:00Z').getTime();
const ringkas = (customers: number, paidRp: number) => ({
  customers,
  packages: customers,
  paidRp,
  paidPerCustomerRp: customers ? Math.round(paidRp / customers) : null,
  packagesWithoutValue: 0,
});
const baris = (over: Partial<RetentionRow>): RetentionRow => ({
  customerPackageId: Math.random().toString(36),
  userId: 'u',
  customerName: 'Member',
  phone: '081234567890',
  packageName: 'Private Group 10 sesi',
  branchId: 'gg',
  endReason: 'EXPIRED',
  validUntil: '2026-10-14T00:00:00Z',
  remainingSessions: 3,
  paidRp: 1_500_000,
  renewed: false,
  renewedAt: null,
  ...over,
});

const kohort: ExpiryCohort = {
  range: { from: '2026-10-01', until: '2026-10-31', label: 'Oktober 2026' },
  renewalWindowDays: 60,
  segments: { expired: ringkas(6, 9_000_000), hot: ringkas(4, 6_000_000) },
  total: ringkas(10, 15_000_000),
  renewed: ringkas(5, 7_500_000),
  potentialLoss: ringkas(5, 7_500_000),
  renewalRatePct: 50,
  rows: [
    baris({ customerName: 'Lewat Lama', endReason: 'EXPIRED', validUntil: '2026-10-05T00:00:00Z' }),
    baris({
      customerName: 'Hot Belum',
      endReason: 'HOT',
      validUntil: '2026-10-09T00:00:00Z',
      phone: null,
    }),
    baris({
      customerName: 'Sudah Renew',
      endReason: 'HOT',
      renewed: true,
      renewedAt: '2026-10-20T00:00:00Z',
    }),
  ],
};

function client(k: ExpiryCohort = kohort): RetentionClient {
  return {
    cohort: vi.fn().mockResolvedValue(k),
    trend: vi.fn().mockResolvedValue({
      cohorts: [
        {
          period: '2026-08',
          label: 'Agustus',
          total: ringkas(13, 1),
          renewed: ringkas(8, 1),
          potentialLoss: ringkas(5, 2_000_000),
          renewalRatePct: 61.5,
        },
        {
          period: '2026-09',
          label: 'September',
          total: ringkas(11, 1),
          renewed: ringkas(6, 1),
          potentialLoss: ringkas(5, 3_000_000),
          renewalRatePct: 54.5,
        },
        {
          period: '2026-10',
          label: 'Oktober',
          total: ringkas(10, 1),
          renewed: ringkas(5, 1),
          potentialLoss: ringkas(5, 7_500_000),
          renewalRatePct: 50,
        },
      ],
    }),
  };
}

describe('aturan halaman renewal', () => {
  it('mengurutkan yang belum renew lebih dulu, HOT di atas, lalu yang paling lama menunggu', () => {
    const urut = urutDaftar(kohort.rows).map((r) => r.customerName);
    expect(urut).toEqual(['Hot Belum', 'Lewat Lama', 'Sudah Renew']);
  });

  it('menghitung nilai belum kembali per alasan hanya dari yang belum renew', () => {
    expect(belumKembaliPer(kohort.rows, 'HOT')).toBe(1_500_000);
    expect(belumKembaliPer(kohort.rows, 'EXPIRED')).toBe(1_500_000);
  });

  it('mengubah nomor lokal ke format WhatsApp internasional', () => {
    expect(nomorWhatsApp('0812-3456-7890')).toBe('6281234567890');
    expect(nomorWhatsApp('+62 812 3456 7890')).toBe('6281234567890');
    expect(nomorWhatsApp('812')).toBeNull();
    expect(nomorWhatsApp(null)).toBeNull();
  });
});

describe('RenewalView', () => {
  it('menampilkan nilai yang belum kembali sebagai angka besar dan alasannya', async () => {
    render(<RenewalView client={client()} now={NOW} />);

    const hero = await screen.findByRole('region', { name: 'Belum kembali dari Oktober 2026' });
    expect(within(hero).getByText('Rp 7.500.000')).toBeVisible();
    expect(screen.getByRole('meter', { name: '50% nilai sudah kembali' })).toBeInTheDocument();
  });

  it('memberi tombol WhatsApp berisi pesan, atau mengatakan nomornya belum ada', async () => {
    render(<RenewalView client={client()} now={NOW} />);

    const tabel = await screen.findByRole('table');
    const wa = within(tabel).getByRole('link', { name: 'WhatsApp' });
    expect(wa.getAttribute('href')).toMatch(
      /^https:\/\/wa\.me\/6281234567890\?text=Halo%20Lewat%20Lama/,
    );
    expect(within(tabel).getByText('Nomor belum ada')).toBeVisible();
    expect(within(tabel).getByText('Selesai')).toBeVisible();
  });

  it('berganti bulan lewat tombol bulan', async () => {
    const c = client();
    const user = userEvent.setup();
    render(<RenewalView client={c} now={NOW} />);

    await user.click(await screen.findByRole('button', { name: 'Agustus 2026' }));

    expect(c.cohort).toHaveBeenLastCalledWith('2026-08', undefined);
  });

  it('mengatakan tidak ada paket habis, bukan menampilkan Rp 0', async () => {
    const kosong = { ...kohort, total: ringkas(0, 0), potentialLoss: ringkas(0, 0), rows: [] };
    render(<RenewalView client={client(kosong)} now={NOW} />);

    expect(await screen.findByText(/Tidak ada paket yang habis pada Oktober 2026/)).toBeVisible();
    expect(screen.queryByText('Rp 0')).toBeNull();
  });

  it('membatasi daftar dengan pagination 10 baris per halaman saat data lebih dari 10', async () => {
    const barisBanyak: RetentionRow[] = Array.from({ length: 15 }, (_, i) =>
      baris({
        customerPackageId: `pkg-${i + 1}`,
        customerName: `Member ${String(i + 1).padStart(2, '0')}`,
        validUntil: `2026-10-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      }),
    );
    const kohortBanyak: ExpiryCohort = {
      ...kohort,
      total: ringkas(15, 22_500_000),
      rows: barisBanyak,
    };
    const user = userEvent.setup();
    render(<RenewalView client={client(kohortBanyak)} now={NOW} />);

    expect(await screen.findByText('Member 01')).toBeVisible();
    expect(screen.getByText('Member 10')).toBeVisible();
    expect(screen.queryByText('Member 11')).toBeNull();

    const navigasi = screen.getByRole('navigation', { name: 'Paginasi data' });
    expect(navigasi).toBeVisible();

    const tombolBerikutnya = screen.getByRole('button', { name: 'Berikutnya' });
    await user.click(tombolBerikutnya);

    expect(screen.getByText('Member 11')).toBeVisible();
    expect(screen.getByText('Member 15')).toBeVisible();
    expect(screen.queryByText('Member 01')).toBeNull();
  });
});
