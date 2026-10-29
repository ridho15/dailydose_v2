import { act, render as rtlRender, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CheckInDeskClient,
  MejaCheckIn,
  TercatatMeja,
} from '@/api-clients/check-in-desk-client';
import { AppFeedbackProvider } from '@/components/app-feedback';
import { CheckInDeskView, DURASI_KARTU_MS, pilihKartuBaru } from './check-in-desk-view';

const menit = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

const tercatat = (over: Partial<TercatatMeja> = {}): TercatatMeja => ({
  id: 't1',
  jenis: 'MEMBER',
  nama: 'Maya Putri',
  fotoUrl: '/uploads/selfie-maya.jpg',
  namaKelas: 'Private Group Reformer',
  mulaiKelas: menit(-10),
  selesaiKelas: menit(45),
  namaStudio: 'Studio 2',
  tercatatPada: menit(-5),
  manual: false,
  dicatatOleh: null,
  ...over,
});

const meja = (over: Partial<MejaCheckIn> = {}): MejaCheckIn => ({
  branchId: 'gg',
  namaCabang: 'Green Garden',
  timezone: 'Asia/Jakarta',
  tanggal: '2026-10-28',
  kelas: [],
  tercatat: [tercatat()],
  ...over,
});

const kelasKurang = {
  id: 'k-kurang',
  startAt: menit(17),
  endAt: menit(72),
  namaKelas: 'Group Reformer',
  namaStudio: 'Studio 2',
  namaInstruktur: 'Anna',
  status: 'PUBLISHED',
  version: 5,
  kapasitas: 8,
  terdaftar: 3,
  hadir: 2,
  kuota: {
    status: 'KURANG' as const,
    hadir: 2,
    minimum: 3,
    kurang: 1,
    menitTersisa: 12,
    perluKeputusan: true,
  },
  keputusan: null,
  berjalan: false,
  perluDitutup: false,
};

function deskClient(respons: MejaCheckIn[]): CheckInDeskClient {
  const meja = vi.fn();
  respons.forEach((r) => meja.mockResolvedValueOnce(r));
  meja.mockResolvedValue(respons.at(-1));
  return {
    meja,
    tetapJalan: vi.fn().mockResolvedValue({ selisihBebanRp: 100_000 }),
    tidakHadir: vi.fn().mockResolvedValue([]),
    pindai: vi.fn().mockResolvedValue({
      diterima: true,
      tercatat: true,
      orang: { userId: 'i-1', nama: 'Asrida', peran: 'INSTRUKTUR' },
      kelas: {
        classSlotId: 'k',
        bookingId: null,
        namaKelas: 'Group',
        studio: 'Studio 2',
        mulai: '2026-10-28T02:00:00Z',
        selesai: '2026-10-28T02:55:00Z',
      },
      tercatatPada: '2026-10-28T01:50:00Z',
      namaCabang: 'Green Garden',
      timezone: 'Asia/Jakarta',
    }),
  };
}

const render = (view: React.ReactNode) =>
  rtlRender(<AppFeedbackProvider>{view}</AppFeedbackProvider>);

describe('pilihKartuBaru', () => {
  it('memilih member terbaru yang belum pernah terlihat', () => {
    const daftar = [tercatat({ id: 'baru' }), tercatat({ id: 'lama' })];
    expect(pilihKartuBaru(daftar, new Set(['lama']))?.id).toBe('baru');
  });

  it('tidak memunculkan kartu untuk instruktur', () => {
    const daftar = [tercatat({ id: 'ins', jenis: 'INSTRUKTUR' })];
    expect(pilihKartuBaru(daftar, new Set())).toBeNull();
  });
});

describe('CheckInDeskView kartu check-in', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('tidak memunculkan kartu untuk kehadiran yang sudah ada sebelum layar dibuka', async () => {
    render(<CheckInDeskView client={deskClient([meja()])} branchIdOverride="gg" />);

    expect(await screen.findByText(/Belum ada check-in baru/)).toBeVisible();
    expect(screen.queryByText(/sudah check-in/)).toBeNull();
  });

  it('memunculkan kartu dengan foto selfie untuk check-in baru lalu menutupnya setelah 8 detik', async () => {
    const baru = tercatat({ id: 't2', nama: 'Sari Dewi', fotoUrl: '/uploads/selfie-sari.jpg' });
    const client = deskClient([meja(), meja({ tercatat: [baru, tercatat()] })]);
    render(<CheckInDeskView client={client} branchIdOverride="gg" />);
    await screen.findByText(/Belum ada check-in baru/);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(await screen.findByRole('heading', { name: 'Sari Dewi sudah check-in' })).toBeVisible();
    expect(screen.getByRole('img', { name: 'Foto Sari Dewi saat mendaftar' })).toHaveAttribute(
      'src',
      expect.stringContaining('selfie-sari.jpg'),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DURASI_KARTU_MS);
    });
    expect(screen.queryByRole('heading', { name: 'Sari Dewi sudah check-in' })).toBeNull();
  });

  it('menutup kartu seketika dengan Tutup sekarang', async () => {
    const baru = tercatat({ id: 't2', nama: 'Sari Dewi' });
    const client = deskClient([meja(), meja({ tercatat: [baru, tercatat()] })]);
    render(<CheckInDeskView client={client} branchIdOverride="gg" />);
    await screen.findByText(/Belum ada check-in baru/);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await user.click(await screen.findByRole('button', { name: 'Tutup sekarang' }));

    expect(screen.queryByRole('heading', { name: 'Sari Dewi sudah check-in' })).toBeNull();
  });

  it('mengatakan terus terang bila member belum punya selfie', async () => {
    const baru = tercatat({ id: 't2', nama: 'Sari Dewi', fotoUrl: null });
    const client = deskClient([meja(), meja({ tercatat: [baru] })]);
    render(<CheckInDeskView client={client} branchIdOverride="gg" />);
    await screen.findByText(/Belum ada check-in baru/);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(await screen.findByText('Belum ada foto selfie')).toBeVisible();
    expect(screen.getByText(/belum mengunggah selfie/)).toBeVisible();
  });
});

describe('CheckInDeskView keputusan kuota', () => {
  it('meminta alasan sebelum mencatat kelas tetap berjalan', async () => {
    const client = deskClient([meja({ kelas: [kelasKurang] })]);
    render(<CheckInDeskView client={client} branchIdOverride="gg" />);
    const user = userEvent.setup();

    const kartu = await screen.findByRole('article', { name: /Group Reformer/ });
    expect(within(kartu).getByText('Kurang 1 orang')).toBeVisible();
    await user.click(within(kartu).getByRole('button', { name: 'Tetap jalankan kelas' }));

    const kirim = within(kartu).getByRole('button', { name: 'Kirim, tetap jalankan' });
    expect(kirim).toBeDisabled();
    await user.type(
      within(kartu).getByLabelText('Alasan tetap menjalankan kelas'),
      'Dua peserta sudah di studio',
    );
    await user.click(kirim);

    expect(client.tetapJalan).toHaveBeenCalledWith('k-kurang', 'Dua peserta sudah di studio');
    expect(await screen.findByText(/sudah dilaporkan ke Super Owner/)).toBeVisible();
  });

  it('membatalkan kelas dengan versi terbaru setelah dikonfirmasi', async () => {
    const classClient = {
      cancel: vi.fn().mockResolvedValue({}),
      completionControl: vi.fn(),
      complete: vi.fn(),
    };
    render(
      <CheckInDeskView
        client={deskClient([meja({ kelas: [kelasKurang] })])}
        classClient={classClient}
        branchIdOverride="gg"
      />,
    );
    const user = userEvent.setup();

    const kartu = await screen.findByRole('article', { name: /Group Reformer/ });
    await user.click(within(kartu).getByRole('button', { name: 'Batalkan, kembalikan sesi' }));
    await user.click(await screen.findByRole('button', { name: 'Batalkan kelas' }));

    expect(classClient.cancel).toHaveBeenCalledWith(
      'k-kurang',
      'OTHER_REVIEW_REQUIRED',
      5,
      expect.stringContaining('2 hadir dari minimum 3'),
    );
  });

  it('menunjukkan keputusan yang sudah diambil alih-alih tombol lagi', async () => {
    const sudah = {
      ...kelasKurang,
      keputusan: { oleh: 'Rina', pada: menit(-2), alasan: 'Peserta sudah datang' },
    };
    render(
      <CheckInDeskView client={deskClient([meja({ kelas: [sudah] })])} branchIdOverride="gg" />,
    );

    const kartu = await screen.findByRole('article', { name: /Group Reformer/ });
    expect(within(kartu).getByText(/diputuskan Rina/)).toBeVisible();
    expect(within(kartu).queryByRole('button', { name: 'Tetap jalankan kelas' })).toBeNull();
  });
});

describe('CheckInDeskView tutup kelas dan tidak hadir', () => {
  it('menutup kelas lewat token kontrol setelah staf melihat dampaknya', async () => {
    const lewat = {
      ...kelasKurang,
      id: 'k-lewat',
      startAt: menit(-200),
      endAt: menit(-145),
      perluDitutup: true,
      kuota: { ...kelasKurang.kuota, perluKeputusan: false, status: 'TERPENUHI' as const },
    };
    const classClient = {
      cancel: vi.fn(),
      completionControl: vi.fn().mockResolvedValue({
        classSlotId: 'k-lewat',
        expectedVersion: 7,
        controlHash: 'h'.repeat(64),
        attendanceCount: 2,
        noShowCount: 1,
        activeReservationCount: 3,
      }),
      complete: vi.fn().mockResolvedValue({}),
    };
    render(
      <CheckInDeskView
        client={deskClient([meja({ kelas: [lewat] })])}
        classClient={classClient}
        branchIdOverride="gg"
      />,
    );
    const user = userEvent.setup();

    const tombol = await screen.findByRole('button', { name: /^Tutup kelas \d{2}\.\d{2}$/ });
    await user.click(tombol);
    expect(await screen.findByText(/1 peserta tidak hadir/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Tutup kelas' }));

    expect(classClient.complete).toHaveBeenCalledWith(
      'k-lewat',
      7,
      'h'.repeat(64),
      expect.any(String),
    );
  });

  it('menautkan Kembalikan sesi ke Penyesuaian dengan member dan booking terisi', async () => {
    const client = deskClient([meja()]);
    vi.mocked(client.tidakHadir).mockResolvedValue([
      {
        bookingId: 'b-9',
        userId: 'm-9',
        nama: 'Dina Pratiwi',
        classSlotId: 'k',
        namaKelas: 'Semi Private',
        mulai: menit(-200),
        sisaSesi: 5,
        sudahDikoreksi: false,
      },
    ]);
    render(<CheckInDeskView client={client} branchIdOverride="gg" />);

    const tautan = await screen.findByRole('link', { name: 'Kembalikan sesi' });

    expect(tautan).toHaveAttribute('href', '/ledger/adjustments?member=m-9&booking=b-9&sesi=1');
    expect(screen.getByText('Hangus, 1 sesi')).toBeVisible();
  });

  it('meminta cabang dipilih sebelum menampilkan apa pun', () => {
    const client = deskClient([meja()]);
    render(<CheckInDeskView client={client} branchIdOverride="" />);

    expect(screen.getByText('Pilih cabang dulu')).toBeVisible();
    expect(client.meja).not.toHaveBeenCalled();
  });
});
