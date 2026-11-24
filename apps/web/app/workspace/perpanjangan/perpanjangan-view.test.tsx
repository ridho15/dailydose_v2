import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PerpanjanganView, sisaHari } from './perpanjangan-view';

const baris = {
  id: 'cp-1',
  packageName: 'Private Group 10 sesi',
  branchName: 'Gading',
  expiryAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
  ledgerBalance: 4,
  customer: { id: 'm-1', displayName: 'Saras Wulandari' },
};

describe('PerpanjanganView', () => {
  it('meminta paket berakhir ≤14 hari dan menampilkan sisa sesi serta hari tersisa', async () => {
    const muat = vi.fn().mockResolvedValue({ items: [baris], page: { nextCursor: null } });
    render(<PerpanjanganView muat={muat} />);
    expect(await screen.findByRole('link', { name: 'Saras Wulandari' })).toHaveAttribute('href', '/ledger/cp-1');
    expect(screen.getByText(/sisa 4 sesi/)).toHaveTextContent('5 hari lagi');
    expect(muat).toHaveBeenCalledWith({ branchId: undefined, cursor: undefined });
  });

  it('daftar kosong dan galat muat ditampilkan dengan jelas', async () => {
    const kosong = vi.fn().mockResolvedValue({ items: [], page: { nextCursor: null } });
    const { unmount } = render(<PerpanjanganView muat={kosong} />);
    expect(await screen.findByText(/Tidak ada member dengan sisa sesi/)).toBeInTheDocument();
    unmount();
    render(<PerpanjanganView muat={vi.fn().mockRejectedValue(new Error('x'))} />);
    await waitFor(() => expect(screen.getByText(/belum dapat dimuat/)).toBeInTheDocument());
  });

  it('sisaHari membulatkan ke atas dan tidak negatif', () => {
    const now = Date.parse('2026-11-24T00:00:00Z');
    expect(sisaHari('2026-11-24T16:59:59Z', now)).toBe(1);
    expect(sisaHari('2026-11-20T16:59:59Z', now)).toBe(0);
  });
});
