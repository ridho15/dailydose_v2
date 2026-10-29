import { render, screen } from '@testing-library/react';
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
});
