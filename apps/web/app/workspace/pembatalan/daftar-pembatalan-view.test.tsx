import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppFeedbackProvider } from '../../components/app-feedback';
import { DaftarPembatalanView, hariMenunggu, type BarisPengajuan, type DaftarPembatalanClient } from './daftar-pembatalan-view';

const baris = (id: string, o: Partial<BarisPengajuan> = {}): BarisPengajuan => ({
  id,
  version: 1,
  bookingId: `b-${id}`,
  sessionCount: 0,
  reason: 'Member sakit',
  requestedByName: 'Admin Untar',
  createdAt: new Date(Date.now() - 23 * 86_400_000).toISOString(),
  buktiUrl: null,
  customerName: id,
  className: 'Reformer',
  classStartAt: '2026-11-19T02:00:00Z',
  branchId: 'untar',
  branchName: 'Untar',
  canDecide: true,
  ...o,
});

function setup(items: BarisPengajuan[], putuskan = vi.fn(async () => ({}))) {
  const muat = vi.fn(async () => ({ items, nextCursor: null }));
  const client: DaftarPembatalanClient = { muat, putuskan };
  render(
    <AppFeedbackProvider>
      <DaftarPembatalanView client={client} />
    </AppFeedbackProvider>,
  );
  return { muat, putuskan };
}

describe('DaftarPembatalanView', () => {
  it('filter dikirim ke server; lama menunggu dan izin medis tanpa bukti terlihat', async () => {
    const user = userEvent.setup();
    const c = setup([baris('Noriko', { reason: '[IZIN MEDIS] Member sakit dengan surat dokter resmi' })]);
    expect(await screen.findByText(/menunggu 23 hari/)).toBeVisible();
    expect(screen.getByText('Izin medis tanpa bukti')).toBeVisible();
    await user.selectOptions(screen.getByLabelText('Jenis alasan'), 'medis');
    await user.type(screen.getByLabelText('Kelas dari tanggal'), '2026-11-05');
    await user.type(screen.getByLabelText('Cari alasan atau member'), ' noriko ');
    await user.click(screen.getByRole('button', { name: 'Terapkan filter' }));
    await waitFor(() =>
      expect(c.muat).toHaveBeenLastCalledWith(expect.objectContaining({ jenis: 'medis', dari: '2026-11-05', q: 'noriko' })),
    );
  });

  it('tolak massal: pilih semua yang boleh diputus, konfirmasi, tiap pengajuan dikirim dengan versinya; gagal dirangkum', async () => {
    const user = userEvent.setup();
    const putuskan = vi.fn(async (id: string) => {
      if (id === 'Nana') throw new Error('x');
      return {};
    });
    setup([baris('Noriko'), baris('Nana', { version: 3 }), baris('Anggun', { canDecide: false })], putuskan);
    await screen.findByText(/Noriko · Reformer/);
    await user.click(screen.getByLabelText('Pilih semua yang tampil'));
    expect(screen.getByText('2 dipilih')).toBeVisible();
    expect(screen.getByLabelText('Pilih Anggun')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Tolak terpilih' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tolak 2 pengajuan?' });
    await user.click(within(dialog).getByRole('button', { name: 'Tolak semua' }));
    await waitFor(() => expect(putuskan).toHaveBeenCalledTimes(2));
    expect(putuskan).toHaveBeenCalledWith('Noriko', 'reject', 1);
    expect(putuskan).toHaveBeenCalledWith('Nana', 'reject', 3);
    expect(await screen.findByText(/1 pengajuan ditolak\. 1 gagal: Nana/)).toBeVisible();
  });

  it('hariMenunggu dibulatkan ke bawah, tidak negatif', () => {
    const now = Date.parse('2026-11-24T00:00:00Z');
    expect(hariMenunggu('2026-11-01T00:00:00Z', now)).toBe(23);
    expect(hariMenunggu('2026-11-25T00:00:00Z', now)).toBe(0);
  });
});
