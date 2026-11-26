import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { canAccessSessionPath } from '../../session-context';
import { pesanGalatStok, StokMinumanView, type StokMinumanClient } from './stok-minuman-view';

let caps: string[] = [];
vi.mock('../../session-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../session-context')>()),
  useSessionContext: () => ({
    activeBranchId: 'gg',
    session: { branches: [{ id: 'gg', name: 'Green Garden' }] },
    hasCapability: (...c: string[]) => c.some((x) => caps.includes(x)),
  }),
}));

const air = { id: 'b1', nama: 'Air mineral', satuan: 'botol', hargaJualRp: 8000, aktif: true };

function klien(stokAwal = 10): StokMinumanClient {
  let stok = stokAwal;
  return {
    barang: vi.fn(async () => ({ items: [air] })),
    stok: vi.fn(async () => ({ items: [{ barang: air, stok }] })),
    riwayat: vi.fn(async () => ({ items: [], nextCursor: null })),
    catat: vi.fn(async (input) => {
      stok += input.jenis === 'MASUK' ? input.jumlah : -input.jumlah;
      // Server memakai harga jual master untuk penjualan; harga beli dari isian admin.
      const harga = input.jenis === 'DIJUAL' ? air.hargaJualRp : (input.hargaSatuanRp ?? 0);
      return { id: 'm1', ...input, hargaSatuanRp: harga, totalRp: harga * input.jumlah, namaBarang: air.nama, satuan: air.satuan, catatan: null, oleh: null, stokSesudah: stok };
    }),
    buatBarang: vi.fn(),
    ubahBarang: vi.fn(),
  };
}

describe('StokMinumanView', () => {
  it('admin mencatat pembelian dengan harga beli; pesan menyebut pengeluaran dan stok baru', async () => {
    caps = ['inventory:read', 'inventory:record'];
    const user = userEvent.setup();
    const client = klien();
    render(<StokMinumanView client={client} />);
    expect(await screen.findByText('10 botol')).toBeVisible();
    expect(screen.queryByRole('tab', { name: 'Master barang' })).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'Catat' }));
    await user.selectOptions(screen.getByLabelText('Barang'), 'b1');
    await user.type(screen.getByLabelText(/^Jumlah/), '24');
    const tombol = screen.getByRole('button', { name: 'Catat pembelian' });
    expect(tombol).toBeDisabled();
    await user.type(screen.getByLabelText('Harga beli per satuan (Rp)'), '3500');
    // Pembelian wajib nota: tanpa nota tombol tetap terkunci.
    expect(tombol).toBeDisabled();
    await user.upload(screen.getByLabelText(/Foto nota/), new File(['%PDF-1.4'], 'nota.pdf', { type: 'application/pdf' }));
    await user.click(tombol);
    await waitFor(() =>
      expect(client.catat).toHaveBeenCalledWith(expect.objectContaining({ branchId: 'gg', barangId: 'b1', jenis: 'MASUK', jumlah: 24, hargaSatuanRp: 3500, nota: expect.any(File) })),
    );
    // Admin hanya melihat Beli barang dan Jual; Dipakai owner khusus Super Owner.
    expect(screen.queryByLabelText('Dipakai owner')).toBeNull();
    expect(await screen.findByText(/Dibeli: Air mineral 24 botol senilai Rp84\.000, tercatat sebagai pengeluaran cabang\. Stok sekarang 34\./)).toBeVisible();
  });

  it('jual memakai harga jual master yang tidak bisa diubah; jumlah melebihi stok menahan tombol', async () => {
    caps = ['inventory:record'];
    const user = userEvent.setup();
    const client = klien(2);
    render(<StokMinumanView client={client} />);
    await user.click(await screen.findByRole('tab', { name: 'Catat' }));
    await user.click(screen.getByLabelText('Jual'));
    await user.selectOptions(screen.getByLabelText('Barang'), 'b1');
    await user.type(screen.getByLabelText(/^Jumlah/), '3');
    expect(await screen.findByText('Stok hanya 2.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Catat penjualan' })).toBeDisabled();
    await user.clear(screen.getByLabelText(/^Jumlah/));
    await user.type(screen.getByLabelText(/^Jumlah/), '2');
    await user.click(screen.getByRole('button', { name: 'Catat penjualan' }));
    await waitFor(() => expect(client.catat).toHaveBeenCalledWith(expect.objectContaining({ jenis: 'DIJUAL', jumlah: 2 })));
  });

  it('tombol cepat Jual di daftar stok membuka form dengan barang dan jenis terisi; tombol + menambah jumlah', async () => {
    caps = ['inventory:record'];
    const user = userEvent.setup();
    const client = klien(5);
    render(<StokMinumanView client={client} />);
    await user.click(await screen.findByRole('button', { name: 'Catat jual Air mineral' }));
    expect(screen.getByRole('tab', { name: 'Catat' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Jual')).toBeChecked();
    expect(screen.getByLabelText('Barang')).toHaveValue('b1');
    expect(screen.getByLabelText(/^Jumlah/)).toHaveValue('1');
    await user.click(screen.getByRole('button', { name: 'Tambah jumlah' }));
    expect(screen.getByLabelText(/^Jumlah/)).toHaveValue('2');
    await user.click(screen.getByRole('button', { name: 'Catat penjualan' }));
    await waitFor(() => expect(client.catat).toHaveBeenCalledWith(expect.objectContaining({ jenis: 'DIJUAL', barangId: 'b1', jumlah: 2 })));
  });

  it('jual: harga tampil dari master tanpa kolom isian; barang tanpa harga jual tidak bisa dijual', async () => {
    caps = ['inventory:record'];
    const user = userEvent.setup();
    const client = klien(5);
    render(<StokMinumanView client={client} />);
    await user.click(await screen.findByRole('tab', { name: 'Catat' }));
    await user.click(screen.getByLabelText('Jual'));
    await user.selectOptions(screen.getByLabelText('Barang'), 'b1');
    expect(screen.getByText('Rp8.000')).toBeVisible();
    expect(screen.getByText('Ditetapkan Super Owner')).toBeVisible();
    expect(screen.queryByLabelText(/Harga jual per satuan/)).toBeNull();
    expect(screen.queryByLabelText(/Harga beli/)).toBeNull();
  });

  it('tombol Jual di daftar stok nonaktif bila harga jual belum diisi', async () => {
    caps = ['inventory:record'];
    const client = klien(5);
    vi.mocked(client.stok).mockResolvedValue({ items: [{ barang: { ...air, hargaJualRp: null }, stok: 5 }] });
    render(<StokMinumanView client={client} />);
    expect(await screen.findByRole('button', { name: 'Catat jual Air mineral' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Catat pembelian Air mineral' })).toBeEnabled();
  });

  it('owner hanya melihat stok dan riwayat, tanpa tab catat', async () => {
    caps = ['inventory:read'];
    render(<StokMinumanView client={klien()} />);
    expect(await screen.findByRole('tab', { name: 'Riwayat' })).toBeVisible();
    expect(screen.queryByRole('tab', { name: 'Catat' })).toBeNull();
  });

  it('pesan galat menyebut sisa stok dan tabel yang belum dibuat', () => {
    expect(pesanGalatStok({ data: { error: { code: 'DRINK_STOCK_INSUFFICIENT', details: [{ field: 'jumlah', issue: 'STOK_3' }] } } })).toMatch(/sisa 3/);
    expect(pesanGalatStok({ data: { error: { code: 'DRINK_STOCK_UNAVAILABLE' } } })).toMatch(/barang_minuman/);
  });

  it('rute: petugas check-in tidak bisa membuka stok minuman', () => {
    const petugas = { roles: ['CHECKIN_STAFF'], capabilities: ['attendance:desk'], globalCapabilities: [], branches: [] } as never;
    expect(canAccessSessionPath(petugas, '/workspace/stok-minuman')).toBe(false);
  });
});
