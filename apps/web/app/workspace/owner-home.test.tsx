import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeuanganClient, RingkasanBulanan } from '@/api-clients/keuangan-client';
import type { WorkQueueClient } from '@/api-clients/work-queue-client';
import { capaianTarget, OwnerHome, tigaBulan } from './owner-home';
import { AppFeedbackProvider } from '../components/app-feedback';

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
  sesiTerpakai: 40,
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
      sesiTerpakai: 80,
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
    expect(within(modal).getByText('80 sesi terpakai x modal per sesi')).toBeVisible();
    expect(screen.getByText(/Tidak mengurangi laba/)).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Keuangan, 1 sampai 31 Oktober 2026' }),
    ).toBeVisible();
  });

  it('November 2026: modal paket terjual, payroll dari kas simpanan, dan kartu kas payroll simpanan', async () => {
    const r = ringkasan();
    r.period = '2026-11';
    r.from = '2026-11-01';
    r.until = '2026-11-30';
    r.metodeModal = 'PAKET_TERJUAL';
    r.total.modalSesiRp = 73_250_000;
    r.total.sesiTerjual = 877;
    r.kasPayroll = {
      berlaku: true,
      cabang: [
        {
          branchId: 'gg',
          branchName: 'Green Garden',
          saldoAwalRp: 0,
          masukRp: 19_520_000,
          keluarPayrollRp: 1_000_000,
          keluarBalikRp: 0,
          saldoAkhirRp: 18_520_000,
        },
        {
          branchId: 'mk',
          branchName: 'Muara Karang',
          saldoAwalRp: 0,
          masukRp: 23_460_000,
          keluarPayrollRp: 1_000_000,
          keluarBalikRp: 0,
          saldoAkhirRp: 22_460_000,
        },
      ],
      total: {
        saldoAwalRp: 0,
        masukRp: 42_980_000,
        keluarPayrollRp: 2_000_000,
        keluarBalikRp: 0,
        saldoAkhirRp: 40_980_000,
      },
    };
    render(
      <OwnerHome
        now={new Date('2026-11-16T03:00:00Z').getTime()}
        client={client(r)}
        queueClient={queue}
        ownerReportClient={ownerReport}
      />,
    );
    const modal = (await screen.findByText('Modal paket terjual', { selector: 'p' })).parentElement!;
    expect(within(modal).getByText('Rp 73.250.000')).toBeVisible();
    expect(within(modal).getByText('877 sesi terjual x modal per sesi')).toBeVisible();
    expect(screen.getByText(/Dibayar dari kas payroll simpanan · tidak mengurangi laba/)).toBeVisible();
    const kas = screen.getByText('Kas payroll simpanan', { selector: 'p' }).parentElement!;
    expect(within(kas).getByText('Rp 40.980.000')).toBeVisible();
    expect(within(kas).getByText(/Saldo awal Rp 0 · masuk Rp 42.980.000 · keluar Rp 2.000.000/)).toBeVisible();
    const tabel = screen.getByRole('heading', { name: 'Kas payroll simpanan' }).closest('section')!;
    expect(within(tabel).getByRole('rowheader', { name: 'Muara Karang' })).toBeVisible();
    expect(within(tabel).getByText('Rp 22.460.000')).toBeVisible();
    expect(screen.queryByText(/sesi terpakai/)).toBeNull();
  });

  it('memperingatkan sesi terpakai yang belum punya modal per sesi', async () => {
    const r = ringkasan();
    r.total.sesiTanpaModal = 12;
    render(
      <OwnerHome now={NOW} client={client(r)} queueClient={queue} ownerReportClient={ownerReport} />,
    );
    expect(
      await screen.findByText(/12 sesi terpakai belum punya modal per sesi dan dihitung Rp0/),
    ).toBeVisible();
    // Tanpa izin mengubah Data Master: tidak ada tautan, hanya arahan.
    expect(screen.queryByRole('link', { name: 'Atur modal per sesi' })).toBeNull();
  });

  it('Super Owner langsung dibawa ke tab Modal per Sesi dan Honor Instruktur', async () => {
    caps.list = ['finance:read', 'master:manage'];
    const r = ringkasan();
    r.total.sesiTanpaModal = 3;
    r.tarifBelumDipasang = 2;
    render(
      <OwnerHome now={NOW} client={client(r)} queueClient={queue} ownerReportClient={ownerReport} />,
    );
    expect(await screen.findByRole('link', { name: 'Atur modal per sesi' })).toHaveAttribute(
      'href',
      '/master?tab=modal',
    );
    expect(screen.getByRole('link', { name: 'Pasang tarif honor' })).toHaveAttribute(
      'href',
      '/master?tab=fees',
    );
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

  it('menaruh kotak Perlu tindakan (pembatalan kurang dari H-12) di atas angka keuangan', async () => {
    const q: WorkQueueClient = {
      tertinggal: vi.fn(),
      tindakan: vi.fn().mockResolvedValue({
        dibuatPada: '',
        ringkasan: [{ jenis: 'PEMBATALAN', jumlah: 1 }],
        items: [
          {
            id: 'lc-1',
            jenis: 'PEMBATALAN',
            version: 1,
            masukPada: '2026-10-28T01:00:00.000Z',
            branchId: 'gg',
            branchName: 'Green Garden',
            nama: 'Rina',
            rincian: 'Reformer',
            alasan: 'Sakit mendadak pagi ini',
            sesi: 0,
            kelas: { nama: 'Reformer', mulai: '2026-10-28T05:00:00.000Z' },
          },
        ],
        nextCursor: null,
        pengingat: [],
        gagal: [],
      }),
    };
    render(
      <AppFeedbackProvider>
        <OwnerHome now={NOW} client={client()} queueClient={q} ownerReportClient={ownerReport} />
      </AppFeedbackProvider>,
    );
    // Beranda Owner memakai tampilan ringkas: satu ubin per jenis, detail dibuka saat diperiksa.
    const kotak = await screen.findByRole('region', { name: 'Perlu keputusan (1)' });
    expect(within(kotak).getByRole('button', { name: 'Periksa 1 batal < 12 jam' })).toBeVisible();
    expect(within(kotak).queryByText('Rina')).toBeNull();
    const keuangan = screen.getByRole('heading', { name: /^Keuangan/ });
    expect(kotak.compareDocumentPosition(keuangan) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
