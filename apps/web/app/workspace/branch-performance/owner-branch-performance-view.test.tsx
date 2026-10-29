import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OwnerBranchPerformanceView } from './owner-branch-performance-view';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('branch=branch-1'),
}));

vi.mock('../../session-context', () => ({
  useSessionContext: () => ({
    status: 'authenticated',
    activeBranchId: 'branch-1',
    session: {
      branches: [{ id: 'branch-1', name: 'Daily Dose Green Garden', code: 'DD-GG' }],
    },
  }),
}));

const mockDataWithMissingFee = {
  branch: { id: 'branch-1', code: 'DD-GG', name: 'Daily Dose Green Garden' },
  period: '2026-10',
  omsetRp: 15_000_000,
  otherCostRp: 2_000_000,
  totalInstructorFeeRp: 600_000,
  totalUnverifiedFeeRp: 0,
  unverifiedClassCount: 0,
  unconfiguredClassCount: 2,
  instructorFeeMissing: true,
  estimatedProfitRp: 12_400_000,
  instructorCount: 1,
  totalClassHours: 4,
  instructors: [
    {
      instructorId: 'inst-1',
      instructorName: 'Sarah Jenkins',
      groupHours: 4,
      groupFeeRp: 600_000,
      semiPrivateHours: 0,
      semiPrivateFeeRp: 0,
      privateHours: 0,
      privateFeeRp: 0,
      totalHours: 4,
      totalFeeRp: 600_000,
      unverifiedClassCount: 0,
      unconfiguredFeeClassCount: 2,
    },
  ],
};

const mockDataConfigured = {
  branch: { id: 'branch-1', code: 'DD-GG', name: 'Daily Dose Green Garden' },
  period: '2026-10',
  omsetRp: 15_000_000,
  otherCostRp: 2_000_000,
  totalInstructorFeeRp: 700_000,
  totalUnverifiedFeeRp: 0,
  unverifiedClassCount: 0,
  unconfiguredClassCount: 0,
  instructorFeeMissing: false,
  estimatedProfitRp: 12_300_000,
  instructorCount: 1,
  totalClassHours: 4,
  instructors: [
    {
      instructorId: 'inst-1',
      instructorName: 'Sarah Jenkins',
      groupHours: 4,
      groupFeeRp: 700_000,
      semiPrivateHours: 0,
      semiPrivateFeeRp: 0,
      privateHours: 0,
      privateFeeRp: 0,
      totalHours: 4,
      totalFeeRp: 700_000,
      unverifiedClassCount: 0,
      unconfiguredFeeClassCount: 0,
    },
  ],
};

describe('OwnerBranchPerformanceView - Poin 11: Peringatan Tarif Honor Instruktur', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('menampilkan banner peringatan dan penanda pada kartu ketika tarif honor belum diset', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockDataWithMissingFee,
    } as any);

    render(<OwnerBranchPerformanceView />);

    await waitFor(() => {
      expect(screen.getByText('Perhatian Operasional:')).toBeInTheDocument();
    });
    expect(
      screen.getByText(/Sebagian atau seluruh tarif honor instruktur belum dikonfigurasi/i),
    ).toBeInTheDocument();

    expect(screen.getByText(/Tarif belum diset \(2 kelas butuh konfigurasi\)/i)).toBeInTheDocument();
    // Profit memakai modal sesi, jadi tidak lagi bergantung pada tarif honor instruktur.
    expect(screen.getByText('Omset − modal sesi − biaya operasional')).toBeInTheDocument();
    expect(screen.getByText(/2 kelas tarif belum diset/i)).toBeInTheDocument();
  });

  it('tidak menampilkan banner peringatan ketika seluruh tarif honor telah terkonfigurasi', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockDataConfigured,
    } as any);

    render(<OwnerBranchPerformanceView />);

    await waitFor(() => {
      expect(screen.getByText('Omset Cabang')).toBeInTheDocument();
    });

    expect(
      screen.queryByText(/Perhatian Operasional: Sebagian atau seluruh tarif honor instruktur belum dikonfigurasi/i),
    ).toBeNull();
    expect(screen.queryByText(/kelas tarif belum diset/i)).toBeNull();
  });

  it('meminta data menurut rentang tanggal yang dipilih, bukan satu bulan', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => mockDataConfigured } as any);
    global.fetch = fetchMock;

    render(<OwnerBranchPerformanceView />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const first = new URL(String(fetchMock.mock.calls[0]![0]), 'http://localhost');
    expect(first.searchParams.get('from')).toMatch(/^\d{4}-\d{2}-01$/);
    expect(first.searchParams.get('until')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(first.searchParams.has('period')).toBe(false);

    fireEvent.change(screen.getByLabelText(/Dari tanggal/), { target: { value: '2026-09-10' } });
    fireEvent.change(screen.getByLabelText(/Sampai tanggal/), { target: { value: '2026-09-20' } });
    await waitFor(() => {
      const last = new URL(String(fetchMock.mock.calls.at(-1)![0]), 'http://localhost');
      expect(last.searchParams.get('from')).toBe('2026-09-10');
      expect(last.searchParams.get('until')).toBe('2026-09-20');
    });
  });
});
