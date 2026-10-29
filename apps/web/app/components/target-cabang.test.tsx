import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { TargetCabang } from './target-cabang';

describe('TargetCabang', () => {
  it('menampilkan capaian dan laju harian yang dibutuhkan', async () => {
    const muat = vi.fn().mockResolvedValue({
      branchName: 'Green Garden',
      ringkasan: '',
      pace: {
        targetRp: 100_000_000,
        tercapaiRp: 84_200_000,
        sisaRp: 15_800_000,
        tercapaiPersen: 84.2,
        hariTersisa: 4,
        lajuDibutuhkanRp: 3_950_000,
        status: 'PERLU_NAIK',
      },
    });
    const { container } = render(<TargetCabang branchId="gg" muat={muat} />);
    expect(await screen.findByText('Rp 84.200.000')).toBeVisible();
    expect(muat).toHaveBeenCalledWith('gg');
    expect(screen.getByText('Perlu dikejar')).toBeVisible();
    expect(screen.getByText(/perlu Rp 3.950.000 per hari selama 4 hari lagi/)).toBeVisible();
    expect((await axe(container)).violations).toHaveLength(0);
  });

  it('tidak tampil bila target tidak dapat dimuat', async () => {
    const muat = vi.fn().mockRejectedValue(new Error('FORBIDDEN'));
    const { container } = render(<TargetCabang branchId="gg" muat={muat} />);
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
  });
});
