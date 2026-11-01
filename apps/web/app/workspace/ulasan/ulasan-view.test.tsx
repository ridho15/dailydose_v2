import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { UlasanView } from './ulasan-view';

vi.mock('../../session-context', () => ({
  useSessionContext: () => ({
    activeBranch: { id: 'gg', name: 'Green Garden', timezone: 'Asia/Jakarta' },
  }),
}));

const baris = (
  id: string,
  instructorId: string,
  nama: string,
  rating: number,
  comment: string | null,
) => ({
  id,
  rating,
  comment,
  createdAt: '2026-10-28T03:00:00Z',
  namaMember: 'Ayu',
  instructorId,
  namaInstruktur: nama,
  namaKelas: 'Reformer',
  namaCabang: 'Green Garden',
  kelasMulai: '2026-10-28T00:00:00Z',
});

describe('UlasanView', () => {
  it('merangkum per instruktur, memfilter catatan, dan meminta cabang aktif', async () => {
    const laporan = vi.fn().mockResolvedValue({
      from: '',
      until: '',
      instruktur: [
        {
          instructorId: 'i1',
          namaInstruktur: 'Dina',
          jumlahUlasan: 2,
          rataRata: 4.5,
          sebaran: [0, 0, 0, 1, 1],
        },
        {
          instructorId: 'i2',
          namaInstruktur: 'Sari',
          jumlahUlasan: 1,
          rataRata: 3,
          sebaran: [0, 0, 1, 0, 0],
        },
      ],
      ulasan: [
        baris('u1', 'i1', 'Dina', 5, 'Sangat membantu'),
        baris('u2', 'i2', 'Sari', 3, 'Terlalu cepat'),
      ],
    });
    const view = render(
      <UlasanView client={{ laporan }} now={Date.parse('2026-10-29T00:00:00Z')} />,
    );
    const tabel = await screen.findByRole('table');
    expect(within(tabel).getAllByRole('row')).toHaveLength(3);
    expect(laporan.mock.calls[0]![0]).toMatchObject({ branchId: 'gg' });
    expect(screen.getByText('Terlalu cepat')).toBeInTheDocument();
    expect((await axe(view.container)).violations).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Dina' }));
    expect(screen.getByRole('heading', { name: 'Ulasan untuk Dina' })).toBeInTheDocument();
    expect(screen.queryByText('Terlalu cepat')).toBeNull();
    expect(screen.getByText('Sangat membantu')).toBeInTheDocument();
  });

  it('menjelaskan bila belum ada ulasan', async () => {
    const laporan = vi.fn().mockResolvedValue({ from: '', until: '', instruktur: [], ulasan: [] });
    render(<UlasanView client={{ laporan }} />);
    expect(await screen.findByText(/Belum ada ulasan pada rentang ini/)).toBeInTheDocument();
  });

  it('membatasi daftar ulasan dengan pagination 10 baris per halaman saat data lebih dari 10', async () => {
    const user = userEvent.setup();
    const ulasanBanyak = Array.from({ length: 15 }, (_, i) =>
      baris(`u-${i + 1}`, 'i1', 'Dina', 5, `Catatan ulasan nomor ${i + 1}`),
    );
    const laporan = vi.fn().mockResolvedValue({
      from: '',
      until: '',
      instruktur: [
        {
          instructorId: 'i1',
          namaInstruktur: 'Dina',
          jumlahUlasan: 15,
          rataRata: 5,
          sebaran: [0, 0, 0, 0, 15],
        },
      ],
      ulasan: ulasanBanyak,
    });

    render(<UlasanView client={{ laporan }} now={Date.parse('2026-10-29T00:00:00Z')} />);

    expect(await screen.findByText('Catatan ulasan nomor 1')).toBeVisible();
    expect(screen.getByText('Catatan ulasan nomor 10')).toBeVisible();
    expect(screen.queryByText('Catatan ulasan nomor 11')).toBeNull();

    const tombolBerikutnya = screen.getByRole('button', { name: 'Berikutnya' });
    await user.click(tombolBerikutnya);

    expect(screen.getByText('Catatan ulasan nomor 11')).toBeVisible();
    expect(screen.getByText('Catatan ulasan nomor 15')).toBeVisible();
    expect(screen.queryByText('Catatan ulasan nomor 1')).toBeNull();
  });
});
