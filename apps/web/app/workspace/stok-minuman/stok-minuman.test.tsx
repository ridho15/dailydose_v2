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
      const harga = input.hargaSatuanRp ?? 0;
      return { id: 'm1', ...input, hargaSatuanRp: harga, totalRp: harga * input.jumlah, namaBarang: air.nama, satuan: air.satuan, catatan: null, oleh: null, stokSesudah: stok };
    }),
    buatBarang: vi.fn(),
    ubahBarang: vi.fn(),
  };
}

describe('StokMinumanView', () => {
  it('admin mencatat barang masuk dengan harga beli; pesan menyebut pengeluaran dan stok baru', async () => {
    caps = ['inventory:read', 'inventory:record'];
    const user = userEvent.setup();
    const client = klien();
    render(<StokMinumanView client={client} />);
    expect(await screen.findByText('10 botol')).toBeVisible();
    expect(screen.queryByRole('tab', { name: 'Master barang' })).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'Catat' }));
    await user.selectOptions(screen.getByLabelText('Barang'), 'b1');
    await user.type(screen.getByLabelText(/^Jumlah/), '24');
    const tombol = screen.getByRole('button', { name: 'Catat barang masuk' });
    expect(tombol).toBeDisabled();
    await user.type(screen.getByLabelText('Harga beli per satuan (Rp)'), '3500');
    await user.click(tombol);
    await waitFor(() =>
      expect(client.catat).toHaveBeenCalledWith(expect.objectContaining({ branchId: 'gg', barangId: 'b1', jenis: 'MASUK', jumlah: 24, hargaSatuanRp: 3500 })),
    );
    expect(await screen.findByText(/Rp84\.000 dan masuk pengeluaran cabang\. Stok sekarang 34\./)).toBeVisible();
  });

  it('dijual memakai harga jual master; jumlah melebihi stok menahan tombol', async () => {
    caps = ['inventory:record'];
    const user = userEvent.setup();
    const client = klien(2);
    render(<StokMinumanView client={client} />);
    await user.click(await screen.findByRole('tab', { name: 'Catat' }));
    await user.click(screen.getByLabelText('Dijual'));
    await user.selectOptions(screen.getByLabelText('Barang'), 'b1');
    await user.type(screen.getByLabelText(/^Jumlah/), '3');
    expect(await screen.findByText('Stok hanya 2.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Catat dijual' })).toBeDisabled();
    await user.clear(screen.getByLabelText(/^Jumlah/));
    await user.type(screen.getByLabelText(/^Jumlah/), '2');
    await user.click(screen.getByRole('button', { name: 'Catat dijual' }));
    await waitFor(() => expect(client.catat).toHaveBeenCalledWith(expect.objectContaining({ jenis: 'DIJUAL', jumlah: 2, hargaSatuanRp: 8000 })));
  });

  it('tombol cepat Jual di daftar stok membuka form dengan barang dan jenis terisi; tombol + menambah jumlah', async () => {
    caps = ['inventory:record'];
    const user = userEvent.setup();
    const client = klien(5);
    render(<StokMinumanView client={client} />);
    await user.click(await screen.findByRole('button', { name: 'Catat jual Air mineral' }));
    expect(screen.getByRole('tab', { name: 'Catat' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Dijual')).toBeChecked();
    expect(screen.getByLabelText('Barang')).toHaveValue('b1');
    expect(screen.getByLabelText(/^Jumlah/)).toHaveValue('1');
    await user.click(screen.getByRole('button', { name: 'Tambah jumlah' }));
    expect(screen.getByLabelText(/^Jumlah/)).toHaveValue('2');
    await user.click(screen.getByRole('button', { name: 'Catat dijual' }));
    await waitFor(() => expect(client.catat).toHaveBeenCalledWith(expect.objectContaining({ jenis: 'DIJUAL', barangId: 'b1', jumlah: 2 })));
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
