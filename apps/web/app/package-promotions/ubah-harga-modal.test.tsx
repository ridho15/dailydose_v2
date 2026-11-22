import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppFeedbackProvider } from '../components/app-feedback';
import {
  browserPackagePromotionClient,
  type InternalPackageRecord,
} from '@/api-clients/package-promotion-client';
import { UbahHargaModal } from './packages-management-view';

vi.mock('next/navigation', () => ({
  usePathname: () => '/workspace/packages',
  useSearchParams: () => new URLSearchParams(),
}));

const paket = (over: Partial<InternalPackageRecord> = {}): InternalPackageRecord => ({
  id: 'pkg-1',
  branchId: 'gg',
  classTypeId: 'rf',
  businessKey: 'RF10',
  name: 'Reformer 10 Sesi',
  sessionCount: 10,
  durationDays: 60,
  priceRp: 3_000_000,
  status: 'ACTIVE',
  effectiveFrom: '2026-01-01',
  effectiveUntil: null,
  version: 3,
  maksTeman: 1,
  _count: { purchases: 4, customerPackages: 4 },
  ...over,
});

const tampil = (pkg: InternalPackageRecord) => {
  const onSaved = vi.fn().mockResolvedValue(undefined);
  render(
    <AppFeedbackProvider>
      <UbahHargaModal pkg={pkg} onClose={vi.fn()} onSaved={onSaved} />
    </AppFeedbackProvider>,
  );
  return onSaved;
};

describe('UbahHargaModal', () => {
  afterEach(() => vi.restoreAllMocks());

  it('paket yang sudah dibeli: harga baru dicatat sebagai revisi, isian lain tetap', async () => {
    const revise = vi.spyOn(browserPackagePromotionClient, 'revisePackage').mockResolvedValue({} as never);
    const update = vi.spyOn(browserPackagePromotionClient, 'updatePackage').mockResolvedValue({} as never);
    const user = userEvent.setup();
    const onSaved = tampil(paket());
    expect(screen.getByText(/Member yang sudah membeli tidak terpengaruh/)).toBeVisible();
    const simpan = screen.getByRole('button', { name: 'Simpan harga' });
    const harga = screen.getByLabelText('Harga normal (Rp)');
    await user.clear(harga);
    await user.type(harga, '3250000');
    // Alasan wajib (audit): tombol belum aktif sebelum alasan dipilih.
    expect(simpan).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Penyesuaian harga berkala' }));
    await user.click(simpan);
    await waitFor(() => expect(revise).toHaveBeenCalled());
    expect(revise).toHaveBeenCalledWith(
      'pkg-1',
      expect.objectContaining({
        expectedVersion: 3,
        priceRp: 3_250_000,
        sessionCount: 10,
        durationDays: 60,
        maksTeman: 1,
        reason: 'Penyesuaian harga berkala',
      }),
    );
    expect(update).not.toHaveBeenCalled();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('paket yang belum berlaku dan belum dibeli: harga diganti di tempat', async () => {
    const update = vi.spyOn(browserPackagePromotionClient, 'updatePackage').mockResolvedValue({} as never);
    const revise = vi.spyOn(browserPackagePromotionClient, 'revisePackage').mockResolvedValue({} as never);
    const user = userEvent.setup();
    tampil(paket({ effectiveFrom: '2099-01-01', _count: { purchases: 0, customerPackages: 0 } }));
    const harga = screen.getByLabelText('Harga normal (Rp)');
    await user.clear(harga);
    await user.type(harga, '2900000');
    await user.type(screen.getByLabelText('Alasan perubahan'), 'Salah ketik');
    await user.click(screen.getByRole('button', { name: 'Simpan harga' }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('pkg-1', expect.objectContaining({ priceRp: 2_900_000 })),
    );
    expect(revise).not.toHaveBeenCalled();
  });

  it('harga sama dengan sekarang tidak bisa disimpan', () => {
    tampil(paket());
    expect(screen.getByRole('button', { name: 'Simpan harga' })).toBeDisabled();
  });
});
