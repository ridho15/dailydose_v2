import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { UlasanInstruktur } from './ulasan-instruktur';

const tertunda = (id: string, instruktur: string) => ({
  bookingId: id,
  classSlotId: `slot-${id}`,
  namaKelas: 'Reformer',
  namaInstruktur: instruktur,
  namaCabang: 'Green Garden',
  mulai: '2026-10-28T00:00:00Z',
  timezone: 'Asia/Jakarta',
});

const klien = (items = [tertunda('b1', 'Dina'), tertunda('b2', 'Sari')]) => ({
  tertunda: vi.fn().mockResolvedValue(items),
  kirim: vi.fn().mockResolvedValue({ id: 'u1', skipped: false }),
});

describe('UlasanInstruktur', () => {
  it('menilai instruktur dengan bintang dan catatan, lalu lanjut ke kelas berikutnya', async () => {
    const client = klien();
    const view = render(<UlasanInstruktur client={client} />);
    expect(
      await screen.findByRole('heading', { name: 'Bagaimana kelas bersama Dina?' }),
    ).toBeInTheDocument();
    const kirim = screen.getByRole('button', { name: 'Kirim ulasan' });
    expect(kirim).toBeDisabled();
    expect(screen.queryByLabelText('Catatan (opsional)')).toBeNull();

    await userEvent.click(screen.getByLabelText('4 bintang, Sangat baik'));
    await userEvent.type(screen.getByLabelText('Catatan (opsional)'), 'Cue napasnya jelas');
    expect((await axe(view.container)).violations).toHaveLength(0);
    await userEvent.click(kirim);

    expect(client.kirim).toHaveBeenCalledWith({
      bookingId: 'b1',
      rating: 4,
      comment: 'Cue napasnya jelas',
    });
    expect(
      await screen.findByRole('heading', { name: 'Bagaimana kelas bersama Sari?' }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Catatan (opsional)')).toBeNull();
  });

  it('boleh dilewati, dan tidak tampil apa pun tanpa kelas tertunda', async () => {
    const client = klien([tertunda('b1', 'Dina')]);
    const { container } = render(<UlasanInstruktur client={client} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Lewati' }));
    expect(client.kirim).toHaveBeenCalledWith({ bookingId: 'b1', skip: true });
    expect(screen.queryByRole('heading')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it('memberi tahu bila ulasan gagal terkirim tanpa menghapus isian', async () => {
    const client = klien([tertunda('b1', 'Dina')]);
    client.kirim.mockRejectedValueOnce(new Error('jaringan'));
    render(<UlasanInstruktur client={client} />);
    await userEvent.click(await screen.findByLabelText('5 bintang, Luar biasa'));
    await userEvent.click(screen.getByRole('button', { name: 'Kirim ulasan' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ulasan belum terkirim');
    expect(screen.getByLabelText('5 bintang, Luar biasa')).toBeChecked();
  });
});
