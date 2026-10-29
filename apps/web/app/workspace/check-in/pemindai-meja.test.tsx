import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { HasilPindai } from '../../api-clients/check-in-desk-client';
import { kalimatHasil, PemindaiMeja } from './pemindai-meja';

vi.mock('@zxing/browser', () => ({ BrowserMultiFormatReader: vi.fn() }));

const dasar = { namaCabang: 'Green Garden', timezone: 'Asia/Jakarta' };
const kelas = {
  classSlotId: 'k',
  bookingId: 'b',
  namaKelas: 'Private Group',
  studio: 'Studio 2',
  mulai: '2026-10-28T02:00:00Z',
  selesai: '2026-10-28T02:55:00Z',
};
const tercatat: HasilPindai = {
  ...dasar,
  diterima: true,
  tercatat: true,
  orang: { userId: 'm', nama: 'Sari Dewi', peran: 'MEMBER' },
  kelas,
  tercatatPada: '2026-10-28T01:55:00Z',
};

describe('PemindaiMeja', () => {
  it('mencatat isi barcode scanner yang masuk ke kolom lalu Enter', async () => {
    const user = userEvent.setup();
    const pindai = vi.fn().mockResolvedValue(tercatat);
    const onTercatat = vi.fn();
    render(<PemindaiMeja pindai={pindai} onTercatat={onTercatat} kameraTersedia={false} />);

    const kolom = screen.getByLabelText('Isi QR');
    expect(kolom).toHaveFocus();
    await user.type(kolom, 'dd-pass:v1:abc{Enter}');

    expect(pindai).toHaveBeenCalledWith('dd-pass:v1:abc');
    expect(await screen.findByText('Sari Dewi tercatat')).toBeVisible();
    expect(onTercatat).toHaveBeenCalledWith(tercatat);
    expect(kolom).toHaveValue('');
  });

  it('tetap menangkap pindaian saat fokus di luar kolom isian, tetapi tidak saat staf mengetik alasan', async () => {
    const pindai = vi.fn().mockResolvedValue(tercatat);
    render(
      <>
        <PemindaiMeja pindai={pindai} onTercatat={vi.fn()} kameraTersedia={false} />
        <textarea aria-label="Alasan" />
        <button type="button">Tombol lain</button>
      </>,
    );
    const ketik = (target: Element, teks: string) => {
      for (const huruf of teks) fireEvent.keyDown(target, { key: huruf });
      fireEvent.keyDown(target, { key: 'Enter' });
    };

    ketik(screen.getByLabelText('Alasan'), 'dd-pass:v1:dari-alasan');
    expect(pindai).not.toHaveBeenCalled();

    ketik(screen.getByRole('button', { name: 'Tombol lain' }), 'dd-pass:v1:xyz');
    await waitFor(() => expect(pindai).toHaveBeenCalledWith('dd-pass:v1:xyz'));
  });

  it('menjelaskan penolakan dan gangguan koneksi', async () => {
    const user = userEvent.setup();
    const pindai = vi
      .fn()
      .mockResolvedValueOnce({
        ...dasar,
        diterima: false,
        tercatat: false,
        alasan: 'TIDAK_ADA_KELAS',
        orang: { userId: 'm', nama: 'Lia', peran: 'MEMBER' },
      })
      .mockRejectedValueOnce(new Error('offline'));
    render(<PemindaiMeja pindai={pindai} onTercatat={vi.fn()} kameraTersedia={false} />);

    await user.type(screen.getByLabelText('Isi QR'), 'dd-pass:v1:a{Enter}');
    expect(await screen.findByText('Tidak ada kelas')).toBeVisible();
    expect(screen.getByText(/dihitung tidak hadir/)).toBeVisible();

    await user.type(screen.getByLabelText('Isi QR'), 'dd-pass:v1:b{Enter}');
    expect(await screen.findByText(/Pindaian belum terkirim/)).toBeVisible();
  });
});

describe('kalimatHasil', () => {
  it('menandai instruktur dan menyebut bahwa honor ikut terhitung', () => {
    const k = kalimatHasil({
      ...tercatat,
      orang: { userId: 'i', nama: 'Asrida', peran: 'INSTRUKTUR' },
    });
    expect(k.judul).toBe('Asrida tercatat (instruktur)');
    expect(k.isi).toMatch(/Masuk ke hitungan honor/);
  });

  it('mengarahkan ke catat manual bila kelasnya sudah lewat', () => {
    const k = kalimatHasil({
      ...tercatat,
      tercatat: false,
      diterima: false,
      alasan: 'KELAS_SUDAH_LEWAT',
    });
    expect(k.isi).toMatch(/Catat kehadiran manual/);
  });
});
