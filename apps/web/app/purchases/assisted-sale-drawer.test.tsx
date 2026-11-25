import { render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AssistedSaleClient, Package } from '@/api-clients/purchase-client';
import { AppFeedbackProvider } from '@/components/app-feedback';
import { AssistedSaleDrawer } from '@/purchases/assisted-sale-drawer';

const branch = { id: 'branch-1', name: 'Green Garden' };
const pkg = (overrides: Partial<Package>): Package => ({
  id: 'pkg-1',
  name: 'Paket 8 Sesi',
  sessionCount: 8,
  durationDays: 60,
  priceRp: 1_000_000,
  status: 'ACTIVE',
  effectiveFrom: new Date('2026-01-01'),
  ...overrides,
});
const fake = (overrides: Partial<AssistedSaleClient> = {}): AssistedSaleClient => ({
  record: vi.fn().mockResolvedValue({ id: 'purchase-1' }),
  searchPackages: vi.fn().mockResolvedValue([
    pkg({}),
    pkg({ id: 'pkg-2', name: 'Paket Cabang Lain', branchId: 'branch-2' }),
    pkg({ id: 'pkg-3', name: 'Paket Cabang Ini', branchId: 'branch-1' }),
  ]),
  ...overrides,
});
const open = (client: AssistedSaleClient, onClose = vi.fn(), onRecorded = vi.fn()) =>
  rtlRender(
    <AppFeedbackProvider>
      <AssistedSaleDrawer
        open
        branch={branch}
        customer={{ id: 'customer-1', name: 'Maya Pelanggan' }}
        client={client}
        onClose={onClose}
        onRecorded={onRecorded}
      />
    </AppFeedbackProvider>,
  );

async function pickPackage(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, name: RegExp) {
  await user.click(within(dialog).getByRole('combobox', { name: /Paket/ }));
  await user.click(await screen.findByRole('option', { name }));
}

describe('AssistedSaleDrawer', () => {
  it('locks the customer, lists only packages valid for the branch, and keeps submit disabled until a package is chosen', async () => {
    const user = userEvent.setup();
    open(fake());
    const dialog = screen.getByRole('dialog', { name: 'Catat penjualan paket' });
    expect(within(dialog).getByLabelText('Pelanggan')).toHaveValue('Maya Pelanggan');
    expect(within(dialog).getByRole('button', { name: 'Catat penjualan' })).toBeDisabled();
    await user.click(within(dialog).getByRole('combobox', { name: /Paket/ }));
    expect(await screen.findByRole('option', { name: /Paket 8 Sesi/ })).toBeVisible();
    expect(screen.getByRole('option', { name: /Paket Cabang Ini/ })).toBeVisible();
    expect(screen.queryByRole('option', { name: /Paket Cabang Lain/ })).toBeNull();
  });

  it('confirms, records with the branch, method and idempotency key, then reports success', async () => {
    const user = userEvent.setup();
    const client = fake();
    const onClose = vi.fn();
    const onRecorded = vi.fn();
    open(client, onClose, onRecorded);
    const dialog = screen.getByRole('dialog', { name: 'Catat penjualan paket' });
    await pickPackage(user, dialog, /Paket 8 Sesi/);
    await user.selectOptions(within(dialog).getByLabelText('Metode pembayaran'), 'QRIS');
    await user.type(within(dialog).getByLabelText('Kode voucher (opsional)'), 'HEMAT');
    await user.type(within(dialog).getByLabelText('Catatan (opsional)'), 'Bayar di meja');
    await user.click(within(dialog).getByRole('button', { name: 'Catat penjualan' }));
    const confirm = await screen.findByRole('dialog', { name: 'Catat penjualan paket?' });
    expect(confirm).toHaveTextContent(/persetujuan|penyetuju lain/i);
    await user.click(within(confirm).getByRole('button', { name: 'Catat penjualan' }));
    await waitFor(() => expect(client.record).toHaveBeenCalledTimes(1));
    expect(client.record).toHaveBeenCalledWith(
      {
        customerUserId: 'customer-1',
        packageId: 'pkg-1',
        branchId: 'branch-1',
        paymentMethod: 'QRIS',
        voucherCode: 'HEMAT',
        note: 'Bayar di meja',
      },
      expect.any(String),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onRecorded).toHaveBeenCalled();
  });

  it('shows a readable failure and retries with the same idempotency key', async () => {
    const user = userEvent.setup();
    const record = vi
      .fn()
      .mockRejectedValueOnce({ status: 422, data: { code: 'VOUCHER_NOT_APPLICABLE' } })
      .mockResolvedValueOnce({ id: 'purchase-1' });
    const client = fake({ record });
    open(client);
    const dialog = screen.getByRole('dialog', { name: 'Catat penjualan paket' });
    await pickPackage(user, dialog, /Paket 8 Sesi/);
    const submit = async () => {
      await user.click(within(dialog).getByRole('button', { name: 'Catat penjualan' }));
      const confirm = await screen.findByRole('dialog', { name: 'Catat penjualan paket?' });
      await user.click(within(confirm).getByRole('button', { name: 'Catat penjualan' }));
    };
    await submit();
    expect(await within(dialog).findByText('Kode voucher tidak dapat dipakai untuk paket ini.')).toBeVisible();
    await submit();
    await waitFor(() => expect(record).toHaveBeenCalledTimes(2));
    expect(record.mock.calls[1]![1]).toBe(record.mock.calls[0]![1]);
  });

  it('asks for the sale branch when the page has no active branch, then loads packages for it', async () => {
    const user = userEvent.setup();
    const client = fake();
    rtlRender(
      <AppFeedbackProvider>
        <AssistedSaleDrawer
          open
          branch={null}
          branches={[
            { id: 'branch-1', name: 'Green Garden' },
            { id: 'branch-2', name: 'Muara Karang' },
          ]}
          customer={{ id: 'customer-1', name: 'Maya Pelanggan' }}
          client={client}
          onClose={vi.fn()}
        />
      </AppFeedbackProvider>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Catat penjualan paket' });
    expect(within(dialog).getByRole('combobox', { name: /Paket/ })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Catat penjualan' })).toBeDisabled();
    await user.click(within(dialog).getByRole('combobox', { name: /Cabang penjualan/ }));
    await user.click(await screen.findByRole('option', { name: 'Muara Karang' }));
    await user.click(within(dialog).getByRole('combobox', { name: /Paket/ }));
    // Paket khusus cabang lain tidak muncul; paket cabang terpilih dan paket umum muncul.
    expect(await screen.findByRole('option', { name: /Paket 8 Sesi/ })).toBeVisible();
    expect(screen.queryByRole('option', { name: /Paket Cabang Ini/ })).toBeNull();
    expect(screen.getByRole('option', { name: /Paket Cabang Lain/ })).toBeVisible();
  });

  it('paket perpanjangan: memuat paket aktif member, wajib memilih satu, lalu mengirim id paket itu', async () => {
    const user = userEvent.setup();
    const target = (customerPackageId: string, packageName: string, extensionsLeft: number) => ({
      customerPackageId,
      packageName,
      remainingSessions: 2,
      totalSessions: 8,
      validUntil: '2026-11-30T16:59:59.000Z',
      validUntilAfterExtension: '2026-12-30T16:59:59.000Z',
      extensionsUsed: 3 - extensionsLeft,
      extensionsPending: 0,
      extensionsLeft,
    });
    const extensionTargets = vi.fn().mockResolvedValue({
      days: 30,
      maxPerPackage: 3,
      items: [target('cp-1', 'Paket 8 Sesi Lama', 0), target('cp-2', 'Paket 4 Sesi', 2)],
    });
    const client = fake({
      searchPackages: vi
        .fn()
        .mockResolvedValue([
          pkg({ id: 'pkg-ext', name: 'Perpanjangan 30 Hari', sessionCount: 0, priceRp: 150_000, perpanjanganMasaAktif: true }),
        ]),
      extensionTargets,
    });
    open(client);
    const dialog = screen.getByRole('dialog', { name: 'Catat penjualan paket' });
    await pickPackage(user, dialog, /Perpanjangan 30 Hari/);
    // ID paket perpanjangan ikut dikirim: lama tambahan masa aktif mengikuti paket itu.
    expect(extensionTargets).toHaveBeenCalledWith('customer-1', 'branch-1', 'pkg-ext');
    expect(await within(dialog).findByRole('radio', { name: /Paket 8 Sesi Lama/ })).toBeDisabled();
    // Satu-satunya paket yang masih bisa diperpanjang langsung terpilih.
    expect(within(dialog).getByRole('radio', { name: /Paket 4 Sesi/ })).toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: 'Catat penjualan' }));
    const confirm = await screen.findByRole('dialog', { name: 'Catat penjualan paket?' });
    expect(confirm).toHaveTextContent(/Masa aktif Paket 4 Sesi bertambah 30 hari/);
    await user.click(within(confirm).getByRole('button', { name: 'Catat penjualan' }));
    await waitFor(() => expect(client.record).toHaveBeenCalledTimes(1));
    expect(vi.mocked(client.record).mock.calls[0]![0]).toMatchObject({
      packageId: 'pkg-ext',
      targetCustomerPackageId: 'cp-2',
    });
  });

  it('paket perpanjangan tanpa paket aktif member: tombol catat tetap nonaktif dan ada arahan', async () => {
    const user = userEvent.setup();
    const client = fake({
      searchPackages: vi
        .fn()
        .mockResolvedValue([
          pkg({ id: 'pkg-ext', name: 'Perpanjangan 30 Hari', sessionCount: 0, perpanjanganMasaAktif: true }),
        ]),
      extensionTargets: vi.fn().mockResolvedValue({ days: 30, maxPerPackage: 3, items: [] }),
    });
    open(client);
    const dialog = screen.getByRole('dialog', { name: 'Catat penjualan paket' });
    await pickPackage(user, dialog, /Perpanjangan 30 Hari/);
    expect(await within(dialog).findByText(/tidak punya paket aktif yang bisa diperpanjang/)).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Catat penjualan' })).toBeDisabled();
  });
});
