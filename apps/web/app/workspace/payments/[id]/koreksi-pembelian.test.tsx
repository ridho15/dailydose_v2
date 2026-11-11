import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const apiFetch = vi.fn();
vi.mock('@/lib/api-client', async (asli) => ({ ...(await asli<object>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { KoreksiPembelian } from './koreksi-pembelian';

const pratinjau = {
  purchaseId: 'p1',
  invoiceNumber: 'INV-1',
  status: 'PAID',
  member: { id: 'm1', displayName: 'Felicia' },
  paket: { id: 'k1', name: 'PILATES NOVEMBER' },
  nominalRp: 330_360,
  sisaSesi: 6,
  sesiTerpakai: 0,
  bookingAktif: 0,
  riwayat: [],
};

describe('koreksi pembelian (Super Owner)', () => {
  it('membatalkan pembelian lewat dua langkah dengan kode alasan dan alasan', async () => {
    apiFetch.mockImplementation(async (path: string) => (path.endsWith('/koreksi') ? pratinjau : {}));
    const selesai = vi.fn();
    render(<KoreksiPembelian purchaseId="p1" onSelesai={selesai} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Batalkan pembelian' }));
    const lanjut = screen.getByRole('button', { name: 'Lanjut' });
    expect(lanjut).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Alasan/), 'Salah input akun, seharusnya untuk Jessica');
    await userEvent.click(lanjut);
    expect(screen.getByText(/akan dibatalkan dan keluar dari omzet/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Ya, batalkan pembelian' }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/purchases/p1/void',
        expect.objectContaining({ method: 'POST', body: expect.stringContaining('SALAH_INPUT_AKUN') }),
      ),
    );
    expect(selesai).toHaveBeenCalled();
  });
});
