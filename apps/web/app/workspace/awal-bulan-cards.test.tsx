import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeuanganClient } from '@/api-clients/keuangan-client';
import { AwalBulanCards, awalBulan } from './awal-bulan-cards';

const caps = vi.hoisted(() => ({ list: [] as string[] }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../session-context', () => ({
  useSessionContext: () => ({ hasCapability: (c: string) => caps.list.includes(c) }),
}));

// 2 Desember 2026 08.00 WIB
const TANGGAL_2 = new Date('2026-12-02T01:00:00Z').getTime();
// 6 Desember 2026: sudah lewat masa awal bulan.
const TANGGAL_6 = new Date('2026-12-06T01:00:00Z').getTime();

const client = () =>
  ({
    ringkasanBulanan: vi.fn(),
    transferHonor: vi.fn().mockResolvedValue({
      from: '2026-11-01',
      until: '2026-11-30',
      baris: [],
      siapRp: 12_500_000,
      jumlahSiap: 7,
      tanpaRekening: 1,
      kelasBelumTerverifikasi: 0,
    }),
    unduhTransferHonor: vi
      .fn()
      .mockResolvedValue({ fileName: 'honor.xlsx', base64: 'AA==', jumlahBaris: 7, totalRp: 12_500_000 }),
    settlementOwner: vi.fn().mockResolvedValue({
      period: '2026-11',
      owners: [{ id: 'o1', nama: 'Rina', hakRp: 1, reimburseRp: 0, totalRp: 8_000_000 }],
      cabang: [],
      labaBelumDibagiRp: 0,
    }),
  }) as unknown as KeuanganClient;

describe('AwalBulanCards', () => {
  beforeEach(() => {
    caps.list = ['finance:export', 'owner-settlement:manage'];
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  it('menghitung tanggal dan bulan lalu menurut jam Jakarta', () => {
    // 1 Januari 00.30 WIB masih 31 Desember UTC.
    expect(awalBulan(new Date('2026-12-31T17:30:00Z').getTime())).toEqual({
      tanggal: 1,
      bulanLalu: '2026-12',
    });
  });

  it('tanggal 1 sampai 5: unduh honor KlikBCA dan settlement bulan lalu dalam satu klik', async () => {
    const c = client();
    const user = userEvent.setup();
    render(<AwalBulanCards client={c} now={TANGGAL_2} />);
    expect(await screen.findByText('Rp 12.500.000')).toBeVisible();
    expect(screen.getByText(/1 belum punya rekening/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Lengkapi rekening' })).toHaveAttribute(
      'href',
      '/workspace/kas#transfer-title',
    );
    expect(await screen.findByText('Rp 8.000.000')).toBeVisible();
    expect(c.settlementOwner).toHaveBeenCalledWith('2026-11');
    await user.click(screen.getByRole('button', { name: 'Unduh Excel KlikBCA' }));
    await waitFor(() => expect(c.unduhTransferHonor).toHaveBeenCalled());
    expect(await screen.findByText(/honor\.xlsx terunduh/)).toBeVisible();
  });

  it('setelah tanggal 5 tidak tampil dan tidak memanggil server', () => {
    const c = client();
    const { container } = render(<AwalBulanCards client={c} now={TANGGAL_6} />);
    expect(container).toBeEmptyDOMElement();
    expect(c.transferHonor).not.toHaveBeenCalled();
  });

  it('tiap kartu hanya untuk pemegang izinnya', async () => {
    caps.list = ['owner-settlement:manage'];
    const c = client();
    render(<AwalBulanCards client={c} now={TANGGAL_2} />);
    expect(await screen.findByText('Settlement bulan lalu')).toBeVisible();
    expect(screen.queryByText('Transfer honor instruktur')).toBeNull();
    expect(c.transferHonor).not.toHaveBeenCalled();
  });
});
