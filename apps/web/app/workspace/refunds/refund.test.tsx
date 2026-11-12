import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const apiFetch = vi.fn();
vi.mock('@/lib/api-client', async (asli) => ({ ...(await asli<object>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams('paket=pkg-1'),
}));
const foregroundFetch = vi.fn();
vi.mock('../../components/app-loading', async (asli) => ({
  ...(await asli<object>()),
  foregroundFetch: (...a: unknown[]) => foregroundFetch(...a),
}));

import { RefundBaruView } from './baru/refund-baru-view';
import { SuratRefundView } from './[id]/surat-refund-view';

const pratinjau = {
  customerPackageId: 'pkg-1',
  member: { id: 'm1', displayName: 'Citra Meilia' },
  paket: { id: 'k1', name: 'Paket 22 Sesi', code: 'P22' },
  status: 'ACTIVE',
  hargaDibayarRp: 3_000_000,
  totalSesi: 22,
  sisaSesi: 15,
  sesiTerpakai: 7,
  hargaPerSesiRp: 136_364,
  nominalRefundRp: 2_045_455,
  bookingAktif: 0,
  bisaRefund: true,
};

describe('refund paket', () => {
  it('menampilkan perhitungan prorata lalu mengirim rekening, alasan, dan bukti', async () => {
    apiFetch.mockResolvedValue(pratinjau);
    foregroundFetch.mockResolvedValue(new Response(JSON.stringify({ id: 'r1' }), { status: 201 }));
    render(<RefundBaruView />);
    expect(await screen.findByText('Rp 2.045.455')).toBeVisible();
    await userEvent.type(screen.getByLabelText('Nama bank'), 'BCA');
    await userEvent.type(screen.getByLabelText('Nomor rekening'), '1234567890');
    await userEvent.type(screen.getByLabelText('Nama pemilik rekening'), 'Citra Meilia');
    await userEvent.type(screen.getByLabelText(/Alasan refund/), 'Pindah domisili ke luar kota');
    const bukti = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'bukti.jpg', { type: 'image/jpeg' });
    await userEvent.upload(screen.getByLabelText(/Bukti transfer refund/), bukti);
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
    expect(screen.getByText(/Sisa 15 sesi paket akan dinolkan/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Ya, proses refund' }));
    expect(foregroundFetch).toHaveBeenCalledWith('/api/v1/package-refunds/pkg-1', expect.objectContaining({ method: 'POST' }), expect.any(String));
    const body = foregroundFetch.mock.calls[0]![1].body as FormData;
    expect(body.get('nomorRekening')).toBe('1234567890');
    expect(push).toHaveBeenCalledWith('/workspace/refunds/r1');
  });

  it('surat konfirmasi menampilkan perhitungan, rekening, dan total refund', async () => {
    apiFetch.mockResolvedValue({
      id: 'r1', tanggal: '2026-11-12T03:00:00Z', member: { id: 'm1', nama: 'Citra Meilia', telepon: null }, cabang: 'Untar',
      paket: { nama: 'Paket 22 Sesi', kode: 'P22', berlakuSejak: '2026-10-31T00:00:00Z', berlakuSampai: null },
      hargaDibayarRp: 3_000_000, totalSesi: 22, sesiTerpakai: 7, sisaSesi: 15, hargaPerSesiRp: 136_364,
      nominalRefundRp: 2_045_455, rekening: { bank: 'BCA', nomor: '1234567890', nama: 'Citra Meilia' },
      alasan: 'Pindah domisili ke luar kota', petugas: 'Admin Untar', adaBukti: true,
    });
    render(<SuratRefundView id="r1" />);
    expect(await screen.findByText('Konfirmasi Refund Paket')).toBeVisible();
    expect(screen.getByText('1234567890')).toBeVisible();
    expect(screen.getAllByText('Rp 2.045.455').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Lihat bukti transfer' })).toHaveAttribute('href', '/api/v1/refunds/r1/bukti');
  });
});
