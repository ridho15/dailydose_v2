import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistedSaleClient, Package } from '@/api-clients/purchase-client';
import { AppFeedbackProvider } from '@/components/app-feedback';
import { AssistedSaleDrawer } from '@/purchases/assisted-sale-drawer';

const uploadProof = vi.fn().mockResolvedValue({});
vi.mock('@/api-clients/order-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api-clients/order-client')>()),
  browserOrderClient: { uploadProof: (...a: unknown[]) => uploadProof(...a) },
  sha256Upload: vi.fn().mockResolvedValue('hash'),
}));
vi.mock('@/lib/image-compression', () => ({ compressImageIfNeeded: async (f: File) => f }));

const paketPerpanjangan: Package = {
  id: 'pkg-ext',
  name: 'Perpanjangan 30 Hari',
  sessionCount: 0,
  durationDays: 30,
  priceRp: 150_000,
  status: 'ACTIVE',
  effectiveFrom: new Date('2026-01-01'),
  perpanjanganMasaAktif: true,
};

function makeClient(recordResult: Record<string, unknown> = {}): AssistedSaleClient {
  return {
    record: vi.fn().mockResolvedValue({
      id: 'purchase-1',
      paymentMethod: 'BANK_TRANSFER',
      paymentUniqueCode: 321,
      payableAmountRp: 150_321,
      ...recordResult,
    }),
    searchPackages: vi.fn().mockResolvedValue([paketPerpanjangan]),
    extensionTargets: vi.fn().mockResolvedValue({
      days: 30,
      maxPerPackage: 3,
      items: [
        {
          customerPackageId: 'cp-exp',
          packageName: 'Paket 10 Sesi',
          remainingSessions: 4,
          totalSessions: 10,
          validUntil: '2026-11-10T16:59:59.000Z',
          kedaluwarsa: true,
          validUntilAfterExtension: '2026-12-25T16:59:59.000Z',
          extensionsUsed: 0,
          extensionsPending: 0,
          extensionsLeft: 3,
        },
        {
          customerPackageId: 'cp-lain',
          packageName: 'Paket 4 Sesi',
          remainingSessions: 2,
          totalSessions: 4,
          validUntil: '2026-11-30T16:59:59.000Z',
          validUntilAfterExtension: '2026-12-30T16:59:59.000Z',
          extensionsUsed: 0,
          extensionsPending: 0,
          extensionsLeft: 3,
        },
      ],
    }),
  };
}

describe('Perpanjang berbayar untuk paket kedaluwarsa', () => {
  beforeEach(() => {
    uploadProof.mockClear();
    uploadProof.mockResolvedValue({});
  });

  it('BANK_TRANSFER alur dua tahap: catat dulu dapat kode unik, lalu unggah bukti di Tahap 2', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    render(
      <AppFeedbackProvider>
        <AssistedSaleDrawer
          open
          branch={{ id: 'branch-1', name: 'Untar' }}
          customer={{ id: 'customer-1', name: 'Maya' }}
          client={client}
          perpanjangTargetId="cp-exp"
          onClose={vi.fn()}
        />
      </AppFeedbackProvider>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Catat penjualan paket' });
    const radio = await within(dialog).findByRole('radio', { name: /Paket 10 Sesi/ });
    expect(radio).toBeChecked();
    expect(within(dialog).getByText(/kedaluwarsa sejak/)).toBeVisible();
    expect(within(dialog).getByLabelText('Metode pembayaran')).toHaveValue('BANK_TRANSFER');
    expect(within(dialog).queryByTestId('input-assisted-sale-proof')).toBeNull();

    const catat = within(dialog).getByRole('button', { name: 'Catat penjualan' });
    expect(catat).toBeEnabled();

    await user.click(catat);
    const confirm = await screen.findByRole('dialog', { name: 'Catat penjualan paket?' });
    expect(confirm).toHaveTextContent(/sudah kedaluwarsa; setelah penyetuju lain menyetujuinya/);
    await user.click(within(confirm).getByRole('button', { name: 'Catat penjualan' }));
    await waitFor(() => expect(client.record).toHaveBeenCalledTimes(1));
    expect(vi.mocked(client.record).mock.calls[0]![0]).toMatchObject({
      packageId: 'pkg-ext',
      targetCustomerPackageId: 'cp-exp',
      paymentMethod: 'BANK_TRANSFER',
    });
    expect(uploadProof).not.toHaveBeenCalled();

    const step2 = await within(dialog).findByTestId('assisted-sale-recorded-summary');
    expect(within(step2).getByText(/Rp\s*150\.321/)).toBeVisible();
    expect(within(step2).getByText(/kode unik transfer: 321/i)).toBeVisible();

    const bukti = new File(['x'], 'transfer.png', { type: 'image/png' });
    await user.upload(within(step2).getByTestId('input-assisted-sale-proof-step2'), bukti);
    await user.click(within(step2).getByTestId('btn-upload-proof-step2'));

    await waitFor(() => expect(uploadProof).toHaveBeenCalledTimes(1));
    expect(await within(step2).findByText(/Bukti transfer berhasil diunggah/)).toBeVisible();
  });

  it('metode non-transfer pada paket kedaluwarsa tetap mewajibkan bukti di Tahap 1 sebelum catat', async () => {
    const user = userEvent.setup();
    const client = makeClient({ paymentMethod: 'QRIS', paymentUniqueCode: null, payableAmountRp: 150_000 });
    render(
      <AppFeedbackProvider>
        <AssistedSaleDrawer
          open
          branch={{ id: 'branch-1', name: 'Untar' }}
          customer={{ id: 'customer-1', name: 'Maya' }}
          client={client}
          perpanjangTargetId="cp-exp"
          onClose={vi.fn()}
        />
      </AppFeedbackProvider>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Catat penjualan paket' });
    await within(dialog).findByRole('radio', { name: /Paket 10 Sesi/ });
    await user.selectOptions(within(dialog).getByLabelText('Metode pembayaran'), 'QRIS');

    expect(within(dialog).getByText(/wajib untuk paket kedaluwarsa/)).toBeVisible();
    const catat = within(dialog).getByRole('button', { name: 'Catat penjualan' });
    expect(catat).toBeDisabled();

    const bukti = new File(['x'], 'qris.png', { type: 'image/png' });
    await user.upload(within(dialog).getByTestId('input-assisted-sale-proof'), bukti);
    expect(catat).toBeEnabled();

    await user.click(catat);
    const confirm = await screen.findByRole('dialog', { name: 'Catat penjualan paket?' });
    await user.click(within(confirm).getByRole('button', { name: 'Catat penjualan' }));
    await waitFor(() => expect(client.record).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(uploadProof).toHaveBeenCalledTimes(1));
  });
});
