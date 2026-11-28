import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PembelianBaru, PembelianBaruClient } from '../api-clients/pembelian-baru-client';
import { PembelianBaruCard, pesanSyarat, TAUTAN_SYARAT } from './pembelian-baru';

const NOW = new Date('2026-12-10T05:00:00Z').getTime();
const beli = (o: Partial<PembelianBaru> = {}): PembelianBaru => ({
  id: 'p1',
  invoiceNumber: 'INV-1',
  namaMember: 'Sinta',
  telepon: '0812-3456-7890',
  namaPaket: 'Group 10x',
  masaBerlakuHari: 60,
  perpanjangan: false,
  totalRp: 1_500_123,
  dibayarPada: new Date(NOW - 86_400_000).toISOString(),
  terkirimPada: null,
  ...o,
});
const client = (items: PembelianBaru[], siap = true): PembelianBaruClient => ({
  daftar: vi.fn().mockResolvedValue({ items, siap }),
  tandaiTerkirim: vi.fn().mockResolvedValue({ purchaseId: 'p1', terkirimPada: new Date(NOW).toISOString() }),
});

describe('pesanSyarat', () => {
  it('berterima kasih, menyatakan persetujuan, merangkum aturan, dan menautkan S&K lengkap', () => {
    const teks = pesanSyarat(beli());
    expect(teks).toContain('Halo Sinta, terima kasih telah membeli paket Group 10x di Daily Dose Pilates.');
    expect(teks).toContain('Dengan membeli dan memakai paket ini, Anda telah menyetujui Syarat & Ketentuan');
    expect(teks).toContain('Masa berlaku paket ini 60 hari');
    expect(teks).toContain('12 jam sebelum kelas');
    expect(teks).toContain(TAUTAN_SYARAT);
  });
});

describe('PembelianBaruCard', () => {
  it('tombol WhatsApp membuka chat member dengan pesan S&K lalu menandai terkirim', async () => {
    const user = userEvent.setup();
    const c = client([beli(), beli({ id: 'p2', namaMember: 'Dewi', terkirimPada: new Date(NOW).toISOString() })]);
    render(<PembelianBaruCard branchId="gg" now={NOW} client={c} />);
    const kartu = await screen.findByRole('region', { name: 'Pembelian baru' });
    expect(within(kartu).getByText('1 belum dikirimi Syarat & Ketentuan')).toBeInTheDocument();
    expect(within(kartu).getAllByText('Group 10x · dibayar kemarin')).toHaveLength(2);

    const tombol = within(kartu).getByRole('link', { name: 'Kirim S&K lewat WhatsApp' });
    const href = tombol.getAttribute('href')!;
    expect(href.startsWith('https://wa.me/6281234567890?text=')).toBe(true);
    expect(decodeURIComponent(href.split('text=')[1]!)).toBe(pesanSyarat(beli()));
    expect(tombol).toHaveAttribute('target', '_blank');

    tombol.addEventListener('click', (e) => e.preventDefault());
    await user.click(tombol);
    expect(c.tandaiTerkirim).toHaveBeenCalledWith('p1');
    expect(await within(kartu).findByText('Semua sudah dikirimi Syarat & Ketentuan')).toBeInTheDocument();
    expect(within(kartu).getAllByRole('link', { name: 'Kirim ulang' })).toHaveLength(2);
  });

  it('tanpa nomor WhatsApp: tidak ada tombol; tanpa pembelian: kartu tidak tampil', async () => {
    render(<PembelianBaruCard branchId="gg" now={NOW} client={client([beli({ telepon: null })])} />);
    expect(await screen.findByText('Nomor WhatsApp belum ada')).toBeInTheDocument();
    const kosong = client([]);
    const { container } = render(<PembelianBaruCard branchId="mk" now={NOW} client={kosong} />);
    await vi.waitFor(() => expect(kosong.daftar).toHaveBeenCalledWith('mk'));
    expect(container).toBeEmptyDOMElement();
  });

  it('tabel belum dibuat: staf diberi tahu tanda terkirim belum aktif', async () => {
    const c = client([beli()], false);
    render(<PembelianBaruCard branchId="gg" now={NOW} client={c} />);
    expect(await screen.findByText(/tabel syarat_terkirim_wa belum dibuat/)).toBeInTheDocument();
  });
});
