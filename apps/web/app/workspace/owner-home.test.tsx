import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeuanganClient, RingkasanBulanan } from '@/api-clients/keuangan-client';
import type { WorkQueueClient } from '@/api-clients/work-queue-client';
import { capaianTarget, OwnerHome, tigaBulan } from './owner-home';

const caps = vi.hoisted(() => ({ list: ['finance:read'] as string[] }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../session-context', () => ({
  useSessionContext: () => ({
    session: {
      displayName: 'Rina Wijaya',
      roles: ['SUPER_OWNER'],
      capabilities: caps.list,
      branches: [],
    },
    activeBranchId: '',
    activeBranch: null,
    hasCapability: (c: string) => caps.list.includes(c),
  }),
}));

const NOW = new Date('2026-10-28T03:00:00Z').getTime();
const cabang = (
  id: string,
  name: string,
  omsetRp: number,
  modalSesiRp: number,
  pengeluaranRp: number,
  targetRp: number | null = null,
) => ({
  branchId: id,
  branchName: name,
  omsetRp,
  // Payroll hanya informasi (yang dibayar ke instruktur); laba memakai modal sesi.
  payrollRp: 1_000_000,
  koreksiPayrollRp: 0,
  pengeluaranRp,
  modalSesiRp,
  sesiTerjual: 40,
  sesiTanpaModal: 0,
  profitRp: omsetRp - modalSesiRp - pengeluaranRp,
  targetRp,
  transaksi: 3,
  kelasSelesai: 10,
  pengeluaranPerKategori: [],
});
const ringkasan = (): RingkasanBulanan => {
  const gg = cabang('gg', 'Green Garden', 40_000_000, 9_000_000, 6_000_000, 50_000_000);
  const mk = cabang('mk', 'Muara Karang', 5_000_000, 4_000_000, 2_000_000);
  return {
    period: '2026-10',
    from: '2026-10-01',
    until: '2026-10-31',
    cabang: [gg, mk],
    total: {
      omsetRp: 45_000_000,
      payrollRp: 2_000_000,
      koreksiPayrollRp: 200_000,
      pengeluaranRp: 8_000_000,
      modalSesiRp: 13_000_000,
      sesiTerjual: 80,
      sesiTanpaModal: 0,
      profitRp: 24_000_000,
      targetRp: 50_000_000,
      transaksi: 6,
      kelasSelesai: 20,
      pengeluaranPerKategori: [
        { category: 'SEWA', amountRp: 5_000_000 },
        { category: 'PEMBELIAN_BARANG', amountRp: 3_000_000 },
      ],
    },
    tarifBelumDipasang: 0,
  };
};
const client = (r = ringkasan()): KeuanganClient =>
  ({ ringkasanBulanan: vi.fn().mockResolvedValue(r) }) as unknown as KeuanganClient;
const queue: WorkQueueClient = {
  tertinggal: vi.fn().mockResolvedValue({ dibuatPada: '', items: [], gagal: [] }),
};
const ownerReport = {
  laporan: vi
    .fn()
    .mockResolvedValue({
      range: {},
      dibawahKuota: { total: 0, totalBebanRp: 0, rows: [] },
      pindaiDitolak: { total: 0, perAlasan: [] },
    }),
};

describe('OwnerHome', () => {
  beforeEach(() => {
    caps.list = ['finance:read'];
  });

  it('menampilkan laba besar, omzet, payroll, dan pengeluaran bulan ini', async () => {
    render(
      <OwnerHome now={NOW} client={client()} queueClient={queue} ownerReportClient={ownerReport} />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Halo, Rina' })).toBeVisible();
    const laba = (await screen.findByText('Laba sebelum pajak')).parentElement!;
    expect(within(laba).getByText('Rp 24.000.000')).toBeVisible();
    const omzet = screen.getByText('Omzet', { selector: 'p' }).parentElement!;
    expect(within(omzet).getByText('Rp 45.000.000')).toBeVisible();
    expect(screen.getByText(/6 pembayaran lunas · 90% dari target/)).toBeVisible();
    expect(screen.getByText(/termasuk koreksi jam Rp 200.000/)).toBeVisible();
    const modal = screen.getByText('Modal sesi', { selector: 'p' }).parentElement!;
    expect(within(modal).getByText('Rp 13.000.000')).toBeVisible();
    expect(within(modal).getByText('80 sesi terjual x modal per sesi')).toBeVisible();
    expect(screen.getByText(/Tidak mengurangi laba/)).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Keuangan, 1 sampai 31 Oktober 2026' }),
    ).toBeVisible();
  });

  it('memperingatkan sesi terjual yang belum punya modal per sesi', async () => {
    const r = ringkasan();
    r.total.sesiTanpaModal = 12;
    render(
      <OwnerHome now={NOW} client={client(r)} queueClient={queue} ownerReportClient={ownerReport} />,
    );
    expect(
      await screen.findByText(/12 sesi terjual belum punya modal per sesi dan dihitung Rp0/),
    ).toBeVisible();
  });

  it('merinci per cabang dengan baris total dan menandai laba negatif', async () => {
    const r = ringkasan();
    r.cabang[1] = cabang('mk', 'Muara Karang', 5_000_000, 4_000_000, 3_000_000);
    render(
      <OwnerHome
        now={NOW}
        client={client(r)}
        queueClient={queue}
        ownerReportClient={ownerReport}
      />,
    );
    const tabel = await screen.findByRole('table');
    const baris = within(tabel).getAllByRole('row');
    expect(baris.map((b) => within(b).queryByRole('rowheader')?.textContent)).toEqual([
      undefined,
      'Green Garden80% dari target',
      'Muara Karang',
      'Total90% dari target',
    ]);
    expect(within(baris[2]!).getByText('−Rp 2.000.000')).toHaveClass('text-dd-danger');
  });

  it('memuat bulan lain saat dipilih dan menampilkan pengeluaran per kategori', async () => {
    const user = userEvent.setup();
    const c = client();
    render(<OwnerHome now={NOW} client={c} queueClient={queue} ownerReportClient={ownerReport} />);
    expect(await screen.findByText('Sewa tempat')).toBeVisible();
    expect(screen.getByText('Pembelian barang')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'September 2026' }));
    expect(c.ringkasanBulanan).toHaveBeenLastCalledWith('2026-09');
  });

  it('hanya menautkan laporan lengkap bagi yang boleh membukanya', async () => {
    render(
      <OwnerHome now={NOW} client={client()} queueClient={queue} ownerReportClient={ownerReport} />,
    );
    expect(await screen.findByRole('link', { name: 'Jurnal kas per cabang' })).toHaveAttribute(
      'href',
      '/workspace/kas',
    );
    expect(screen.queryByRole('link', { name: 'Laporan keuangan lengkap' })).toBeNull();
  });

  it('menaruh keputusan yang telat atau bertenggat di atas angka', async () => {
    const q: WorkQueueClient = {
      tertinggal: vi.fn().mockResolvedValue({
        dibuatPada: '',
        gagal: [],
        items: [
          {
            key: 'bukti',
            jumlah: 7,
            nada: 'TELAT',
            acuanPada: null,
            umurJam: 60,
            nilaiRp: 12_000_000,
            href: '/workspace/payments',
          },
          {
            key: 'ubahJadwal',
            jumlah: 1,
            nada: 'MENUNGGU',
            acuanPada: null,
            umurJam: 2,
            href: '/x',
          },
        ],
      }),
    };
    render(
      <OwnerHome now={NOW} client={client()} queueClient={q} ownerReportClient={ownerReport} />,
    );
    const bagian = await screen.findByRole('region', { name: 'Perlu keputusan Anda' });
    expect(within(bagian).getAllByRole('listitem')).toHaveLength(1);
    expect(within(bagian).getByText(/Total Rp 12.000.000/)).toBeVisible();
  });
});

describe('perhitungan beranda owner', () => {
  it('menghitung tiga bulan terakhir menurut jam Jakarta', () => {
    expect(tigaBulan(new Date('2026-10-31T18:00:00Z').getTime())).toEqual([
      '2026-11',
      '2026-10',
      '2026-09',
    ]);
    expect(tigaBulan(new Date('2026-01-10T00:00:00Z').getTime())).toEqual([
      '2026-01',
      '2025-12',
      '2025-11',
    ]);
  });

  it('capaian target kosong bila target belum dipasang', () => {
    expect(capaianTarget(45, null)).toBeNull();
    expect(capaianTarget(45, 50)).toBe(90);
  });
});
