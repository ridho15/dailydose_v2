import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JurnalKas, KeuanganClient } from '@/api-clients/keuangan-client';
import { bacaNominal, KasView } from './kas-view';

const ctx = vi.hoisted(() => ({
  caps: ['expense:create'] as string[],
  branchId: 'gg' as string,
}));
vi.mock('../../session-context', () => ({
  useSessionContext: () => ({
    session: { branches: [{ id: 'gg', name: 'Green Garden' }] },
    activeBranchId: ctx.branchId,
    activeBranch: ctx.branchId
      ? { id: 'gg', name: 'Green Garden', timezone: 'Asia/Jakarta' }
      : null,
    hasCapability: (c: string) => ctx.caps.includes(c),
  }),
}));

const NOW = new Date('2026-10-28T03:00:00Z').getTime();
const jurnal = (): JurnalKas => ({
  period: '2026-10',
  branchId: 'gg',
  masukRp: 1_850_000,
  keluarRp: 450_000,
  selisihRp: 1_400_000,
  rows: [
    {
      id: 'out-1',
      tanggal: '2026-10-22',
      arah: 'KELUAR',
      keterangan: 'Handuk 10 pcs',
      kategori: 'PEMBELIAN_BARANG',
      amountRp: 450_000,
      dicatatOleh: 'Rina',
      branchId: 'gg',
    },
    {
      id: 'in-1',
      tanggal: '2026-10-21',
      arah: 'MASUK',
      keterangan: 'Group 10 sesi · Lia (INV-1)',
      kategori: 'BANK_TRANSFER',
      amountRp: 1_850_000,
      dicatatOleh: null,
      branchId: 'gg',
    },
  ],
});
const client = () =>
  ({
    jurnalKas: vi.fn().mockResolvedValue(jurnal()),
    catatPengeluaran: vi.fn().mockResolvedValue({}),
  }) as unknown as KeuanganClient;

describe('KasView', () => {
  beforeEach(() => {
    ctx.caps = ['expense:create'];
    ctx.branchId = 'gg';
  });

  it('menampilkan uang masuk, keluar, dan selisih beserta baris jurnal', async () => {
    render(<KasView now={NOW} client={client()} />);
    expect(await screen.findByText('Rp 1.400.000')).toBeVisible();
    const tabel = screen.getByRole('table');
    const baris = within(tabel).getAllByRole('row').slice(1);
    expect(within(baris[0]!).getByText('Handuk 10 pcs')).toBeVisible();
    expect(within(baris[0]!).getByText(/Pembelian barang · Rina/)).toBeVisible();
    expect(within(baris[1]!).getByText(/Transfer bank/)).toBeVisible();
  });

  it('admin mencatat pembelian barang dan jurnal dimuat ulang', async () => {
    const user = userEvent.setup();
    const c = client();
    render(<KasView now={NOW} client={c} />);
    await screen.findByText('Rp 1.400.000');

    const simpan = screen.getByRole('button', { name: 'Simpan pengeluaran' });
    expect(simpan).toBeDisabled();
    await user.type(screen.getByLabelText('Keterangan'), 'Matras 2 pcs');
    await user.type(screen.getByLabelText('Nominal (Rp)'), 'Rp 1.200.000');
    await user.click(simpan);

    expect(c.catatPengeluaran).toHaveBeenCalledWith({
      branchId: 'gg',
      incurredOn: '2026-10-28',
      categoryCode: 'PEMBELIAN_BARANG',
      description: 'Matras 2 pcs',
      amountRp: 1_200_000,
    });
    expect(
      await screen.findByText(/Pembelian barang Rp 1.200.000 tercatat untuk Green Garden/),
    ).toBeVisible();
    expect(c.jurnalKas).toHaveBeenCalledTimes(2);
  });

  it('tidak menampilkan formulir bagi yang hanya membaca, dan meminta cabang untuk mencatat', async () => {
    ctx.caps = ['finance:read'];
    const { unmount } = render(<KasView now={NOW} client={client()} />);
    await screen.findByText('Rp 1.400.000');
    expect(screen.queryByRole('button', { name: 'Simpan pengeluaran' })).toBeNull();
    unmount();

    ctx.caps = ['expense:create'];
    ctx.branchId = '';
    render(<KasView now={NOW} client={client()} />);
    expect(
      await screen.findByText(/Pilih cabang di bagian atas untuk mencatat pengeluaran/),
    ).toBeVisible();
  });
});

describe('bacaNominal', () => {
  it('membaca nominal yang diketik dengan titik atau Rp', () => {
    expect(bacaNominal('450.000')).toBe(450_000);
    expect(bacaNominal('Rp 1.200.000')).toBe(1_200_000);
    expect(bacaNominal('0')).toBeNull();
    expect(bacaNominal('')).toBeNull();
  });
});

describe('KasView: Dibayar oleh dan settlement Super Owner', () => {
  beforeEach(() => {
    ctx.caps = ['expense:create'];
    ctx.branchId = 'gg';
  });

  const owners = [
    { id: 'so-1', nama: 'Rina' },
    { id: 'so-2', nama: 'Budi' },
  ];

  it('pengeluaran yang dibayar uang pribadi Super Owner dikirim dengan pembayarnya', async () => {
    const user = userEvent.setup();
    const c = {
      ...client(),
      daftarOwner: vi.fn().mockResolvedValue(owners),
    } as unknown as KeuanganClient;
    render(<KasView now={NOW} client={c} />);
    await screen.findByText('Rp 1.400.000');
    await user.selectOptions(await screen.findByLabelText('Dibayar oleh'), 'so-2');
    await user.type(screen.getByLabelText('Keterangan'), 'Matras baru');
    await user.type(screen.getByLabelText('Nominal (Rp)'), '500000');
    await user.click(screen.getByRole('button', { name: 'Simpan pengeluaran' }));
    expect(c.catatPengeluaran).toHaveBeenCalledWith(
      expect.objectContaining({ amountRp: 500_000, dibayarOlehId: 'so-2' }),
    );
    expect(await screen.findByText(/dibayar Budi \(diganti saat settlement\)/)).toBeVisible();
  });

  it('Super Owner melihat berapa yang dibayar ke tiap Super Owner dan bisa mengatur porsi', async () => {
    ctx.caps = ['owner-settlement:manage', 'finance:read'];
    ctx.branchId = '';
    const user = userEvent.setup();
    const c = {
      ...client(),
      daftarOwner: vi.fn().mockResolvedValue(owners),
      settlementOwner: vi.fn().mockResolvedValue({
        period: '2026-10',
        owners: [
          { id: 'so-1', nama: 'Rina', hakRp: 6_000_000, reimburseRp: 0, totalRp: 6_000_000 },
          { id: 'so-2', nama: 'Budi', hakRp: 4_000_000, reimburseRp: 500_000, totalRp: 4_500_000 },
        ],
        cabang: [
          {
            branchId: 'gg',
            branchName: 'Green Garden',
            labaRp: 10_000_000,
            porsiLengkap: true,
            baris: [
              {
                ownerId: 'so-1',
                nama: 'Rina',
                persen: 60,
                hakRp: 6_000_000,
                reimburseRp: 0,
                totalRp: 6_000_000,
              },
              {
                ownerId: 'so-2',
                nama: 'Budi',
                persen: 40,
                hakRp: 4_000_000,
                reimburseRp: 500_000,
                totalRp: 4_500_000,
              },
            ],
          },
        ],
        labaBelumDibagiRp: 0,
      }),
      porsiOwner: vi
        .fn()
        .mockResolvedValue([
          { branchId: 'gg', branchName: 'Green Garden', porsi: [], lengkap: false },
        ]),
      simpanPorsi: vi.fn().mockResolvedValue({}),
    } as unknown as KeuanganClient;
    render(<KasView now={NOW} client={c} />);

    const bagian = await screen.findByRole('region', { name: /Settlement Super Owner/ });
    expect(await within(bagian).findByText('Dibayar ke Budi')).toBeVisible();
    expect(within(bagian).getAllByText('Rp 4.500.000').length).toBeGreaterThan(0);
    expect(within(bagian).getByText(/40% laba Rp 4.000.000 \+ reimburse Rp 500.000/)).toBeVisible();

    await user.click(within(bagian).getByRole('button', { name: 'Atur porsi' }));
    const dialog = await screen.findByRole('dialog', { name: 'Porsi Super Owner per cabang' });
    const simpan = await within(dialog).findByRole('button', { name: 'Simpan Green Garden' });
    await user.type(within(dialog).getByLabelText('Rina (%)'), '60');
    expect(simpan).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Budi (%)'), '40');
    await user.click(simpan);
    expect(c.simpanPorsi).toHaveBeenCalledWith('gg', [
      { ownerId: 'so-1', persen: 60 },
      { ownerId: 'so-2', persen: 40 },
    ]);
  });
});

describe('KasView: transfer honor instruktur', () => {
  const ringkasan = () => ({
    from: '2026-10-01',
    until: '2026-10-28',
    siapRp: 600_000,
    jumlahSiap: 1,
    tanpaRekening: 1,
    kelasBelumTerverifikasi: 1,
    baris: [
      {
        instructorId: 'anna',
        nama: 'Anna',
        totalRp: 600_000,
        terverifikasiRp: 400_000,
        koreksiRp: 200_000,
        kelasTerverifikasi: 2,
        belumTerverifikasiRp: 200_000,
        kelasBelumTerverifikasi: 1,
        rekening: {
          bankName: 'BCA',
          swiftCode: 'CENAIDJA',
          accountNumber: '0123456789',
          accountName: 'Anna Wijaya',
          email: null,
        },
      },
      {
        instructorId: 'citra',
        nama: 'Citra',
        totalRp: 175_000,
        terverifikasiRp: 175_000,
        koreksiRp: 0,
        kelasTerverifikasi: 1,
        belumTerverifikasiRp: 0,
        kelasBelumTerverifikasi: 0,
        rekening: null,
      },
    ],
  });
  const clientTransfer = () =>
    ({
      ...client(),
      transferHonor: vi.fn().mockResolvedValue(ringkasan()),
      unduhTransferHonor: vi.fn().mockResolvedValue({
        fileName: 'honor-instruktur-2026-10-01-sd-2026-10-28.xlsx',
        base64: btoa('PK'),
        jumlahBaris: 1,
        totalRp: 600_000,
      }),
      simpanRekeningInstruktur: vi.fn().mockResolvedValue({}),
    }) as unknown as KeuanganClient;

  beforeEach(() => {
    ctx.caps = ['finance:read', 'finance:export'];
    ctx.branchId = '';
  });

  it('tidak tampil tanpa izin ekspor keuangan', async () => {
    ctx.caps = ['expense:create'];
    render(<KasView now={NOW} client={clientTransfer()} />);
    await screen.findByText('Rp 1.400.000');
    expect(screen.queryByRole('heading', { name: 'Transfer honor instruktur' })).toBeNull();
  });

  it('menampilkan honor per instruktur, peringatan, dan mengunduh berkas KlikBCA', async () => {
    const user = userEvent.setup();
    const c = clientTransfer();
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    render(<KasView now={NOW} client={c} />);

    const bagian = (
      await screen.findByRole('heading', { name: 'Transfer honor instruktur' })
    ).closest('section')!;
    expect(
      await within(bagian).findByText('1 Oktober 2026 sampai 28 Oktober 2026.', { exact: false }),
    ).toBeVisible();
    expect(within(bagian).getByText(/1 instruktur berhonor belum punya rekening/)).toBeVisible();
    expect(within(bagian).getByText(/1 kelas selesai belum ada presensi/)).toBeVisible();
    expect(within(bagian).getByText('BCA 0123456789')).toBeVisible();
    expect(within(bagian).getByText('Belum ada')).toBeVisible();

    await user.click(within(bagian).getByRole('button', { name: 'Unduh Excel KlikBCA' }));
    expect(c.unduhTransferHonor).toHaveBeenCalled();
    expect(await within(bagian).findByText(/1 instruktur, Rp 600\.000/)).toBeVisible();
  });

  it('mengisi rekening instruktur bank lain dengan kode SWIFT', async () => {
    const user = userEvent.setup();
    const c = clientTransfer();
    render(<KasView now={NOW} client={c} />);

    await user.click(await screen.findByRole('button', { name: 'Isi rekening' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rekening Citra' });
    await user.selectOptions(within(dialog).getByLabelText('Bank'), 'Mandiri');
    await user.type(within(dialog).getByLabelText(/Nomor rekening/), '1230004567890');
    await user.click(within(dialog).getByRole('button', { name: 'Simpan rekening' }));

    expect(c.simpanRekeningInstruktur).toHaveBeenCalledWith('citra', {
      bankName: 'Mandiri',
      swiftCode: 'BMRIIDJA',
      accountNumber: '1230004567890',
      accountName: 'Citra',
      email: undefined,
    });
    expect(c.transferHonor).toHaveBeenCalledTimes(2);
  });
});
