import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import type { PayrollClient, PayrollSaya } from '@/api-clients/payroll-client';
import { PayrollView } from './payroll-view';

const data: PayrollSaya = {
  period: '2026-10',
  totalRp: 400_000,
  terverifikasiRp: 200_000,
  koreksiRp: 200_000,
  belumTerverifikasiRp: 200_000,
  kelasTerverifikasi: 1,
  kelasBelumTerverifikasi: 1,
  jamTerverifikasi: 1,
  kelas: [
    {
      classSlotId: 's1',
      mulai: '2026-10-20T02:00:00.000Z',
      selesai: '2026-10-20T03:00:00.000Z',
      namaKelas: 'Group Reformer',
      namaCabang: 'Gading',
      jam: 1,
      tarifPerJamRp: 200_000,
      honorRp: 200_000,
      terverifikasi: true,
      hadirPada: '2026-10-20T01:55:00.000Z',
    },
    {
      classSlotId: 's2',
      mulai: '2026-10-21T02:00:00.000Z',
      selesai: '2026-10-21T03:00:00.000Z',
      namaKelas: 'Private Class',
      namaCabang: 'Gading',
      jam: 1,
      tarifPerJamRp: 200_000,
      honorRp: 200_000,
      terverifikasi: false,
      hadirPada: null,
    },
  ],
  koreksi: [
    {
      id: 'k1',
      kelasMulai: '2026-10-21T02:00:00.000Z',
      jam: 1,
      nilaiRp: 200_000,
      alasan: 'QR tidak terpindai',
      dicatatPada: '2026-10-22T00:00:00.000Z',
    },
  ],
};

describe('PayrollView', () => {
  it('menampilkan total, kelas belum terverifikasi, riwayat, dan koreksi', async () => {
    const client: PayrollClient = { milikSaya: vi.fn().mockResolvedValue(data) };
    const { container } = render(
      <PayrollView client={client} now={Date.parse('2026-10-28T03:00:00Z')} />,
    );

    expect(await screen.findByText('Rp 400.000')).toBeInTheDocument();
    expect(client.milikSaya).toHaveBeenCalledWith('2026-10');
    expect(screen.getByText(/1 kelas selesai belum ada check-in Anda/)).toBeInTheDocument();
    expect(screen.getByText('Check-in terverifikasi')).toBeInTheDocument();
    expect(screen.getByText('QR tidak terpindai')).toBeInTheDocument();
    expect((await axe(container)).violations).toHaveLength(0);
  });

  it('memberi pesan bila gagal dimuat', async () => {
    const client: PayrollClient = { milikSaya: vi.fn().mockRejectedValue(new Error('x')) };
    render(<PayrollView client={client} />);
    expect(await screen.findByText(/Payroll belum dapat dimuat/)).toBeInTheDocument();
  });

  it('membatasi riwayat kelas dengan pagination 10 baris per halaman saat data lebih dari 10', async () => {
    const user = userEvent.setup();
    const kelasBanyak = Array.from({ length: 15 }, (_, i) => ({
      classSlotId: `slot-${i + 1}`,
      mulai: `2026-10-${String(i + 1).padStart(2, '0')}T02:00:00.000Z`,
      selesai: `2026-10-${String(i + 1).padStart(2, '0')}T03:00:00.000Z`,
      namaKelas: `Kelas Ke-${String(i + 1).padStart(2, '0')}`,
      namaCabang: 'Gading',
      jam: 1,
      tarifPerJamRp: 200_000,
      honorRp: 200_000,
      terverifikasi: true,
      hadirPada: `2026-10-${String(i + 1).padStart(2, '0')}T01:55:00.000Z`,
    }));
    const dataBanyak: PayrollSaya = {
      ...data,
      kelas: kelasBanyak,
    };
    const client: PayrollClient = { milikSaya: vi.fn().mockResolvedValue(dataBanyak) };
    render(<PayrollView client={client} now={Date.parse('2026-10-28T03:00:00Z')} />);

    // Kelas diurutkan descending (mulai terbaru lebih dulu: Kelas Ke-15 sampai Ke-06 di hal 1)
    expect(await screen.findByText('Kelas Ke-15')).toBeVisible();
    expect(screen.getByText('Kelas Ke-06')).toBeVisible();
    expect(screen.queryByText('Kelas Ke-05')).toBeNull();

    const tombolBerikutnya = screen.getByRole('button', { name: 'Berikutnya' });
    await user.click(tombolBerikutnya);

    expect(screen.getByText('Kelas Ke-05')).toBeVisible();
    expect(screen.getByText('Kelas Ke-01')).toBeVisible();
    expect(screen.queryByText('Kelas Ke-15')).toBeNull();
  });
});
