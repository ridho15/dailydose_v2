import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { LedgerBalance } from '@/api-clients/ledger-client';
import type { CustomerOrder } from '@/api-clients/order-client';
import { CustomerPackagesView, sejak } from './packages-view';

const paket = (over: Partial<LedgerBalance> = {}): LedgerBalance =>
  ({
    id: 'cp-1',
    branchId: 'branch-1',
    status: 'ACTIVE',
    activationDate: new Date('2026-01-01'),
    expiryAt: new Date('2099-12-01'),
    ledgerBalance: 10,
    reserved: 0,
    available: 10,
    packageName: 'Paket 1',
    branchName: 'Untar',
    ...over,
  }) as LedgerBalance;

const pesanan = (over: Partial<CustomerOrder> = {}): CustomerOrder =>
  ({
    id: 'ord-1',
    branchId: 'branch-1',
    branchName: 'Untar',
    packageName: 'FLASH SALE 10.10',
    payableAmountRp: 850221,
    status: 'PENDING',
    submittedAt: new Date(Date.now() - 4 * 3_600_000),
    decidedAt: null,
    expiresAt: null,
    paymentProofId: 'proof-1',
    activation: null,
    ...over,
  }) as CustomerOrder;

function setup({
  items = [] as LedgerBalance[],
  orders = [] as CustomerOrder[],
  ledgerList,
}: {
  items?: LedgerBalance[];
  orders?: CustomerOrder[];
  ledgerList?: ReturnType<typeof vi.fn>;
} = {}) {
  const ledger = {
    list:
      ledgerList ??
      vi.fn().mockResolvedValue({
        items,
        summary: { packageCount: items.length, ledgerBalance: 0, reserved: 0, available: 0 },
        nextCursor: null,
      }),
  };
  const orderClient = { list: vi.fn().mockResolvedValue({ items: orders, nextCursor: null }) };
  const bookings = { list: vi.fn().mockResolvedValue({ items: [], nextCursor: null }) };
  render(
    <CustomerPackagesView
      ledger={ledger as never}
      orders={orderClient as never}
      bookings={bookings as never}
    />,
  );
  return { ledger, orderClient, bookings };
}

describe('Paket Saya (satu tampilan)', () => {
  it('keeps the add-package action and shows the empty state', async () => {
    setup();
    const add = screen.getByRole('link', { name: 'Tambah paket' });
    expect(add).toHaveAttribute('href', '/packages');
    expect(await screen.findByText('Belum ada paket aktif')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Lihat paket' })).toHaveAttribute('href', '/packages');
  });

  it('shows an order under review on the same page with its stage and elapsed time', async () => {
    setup({ orders: [pesanan()] });
    const section = await screen.findByRole('region', { name: 'Pesanan sedang diproses' });
    expect(within(section).getByText('FLASH SALE 10.10')).toBeVisible();
    expect(within(section).getByText('Sedang diperiksa')).toBeVisible();
    expect(within(section).getByText(/Bukti transfer terkirim 4 jam lalu/)).toBeVisible();
    expect(within(section).getByText('Diperiksa studio').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(within(section).getByRole('link', { name: 'Detail pesanan' })).toHaveAttribute(
      'href',
      '/orders/ord-1?returnTo=%2Faccount%2Fpackages',
    );
    expect(screen.getByText('Paket muncul di sini setelah pesanan di atas disetujui.')).toBeVisible();
  });

  it('asks for a new proof when the order needs action, and hides finished orders from the top', async () => {
    setup({
      orders: [
        pesanan({ id: 'ord-2', status: 'ACTION_REQUIRED', packageName: 'Paket Ganti Bukti' }),
        pesanan({ id: 'ord-3', status: 'APPROVED', packageName: 'Paket Lama' }),
      ],
    });
    expect(await screen.findByRole('link', { name: 'Ganti bukti transfer' })).toBeVisible();
    expect(screen.queryByText('Paket Lama')).not.toBeInTheDocument();
    expect(screen.getByText('Riwayat paket dan pesanan')).toBeVisible();
  });

  it('lists active packages with remaining sessions and moves expired ones into history as hangus', async () => {
    setup({
      items: [
        paket({ id: 'a', packageName: 'Paket Reformer Aktif', available: 8 }),
        paket({ id: 'b', packageName: 'Paket Mat Kedaluwarsa', available: 2, expiryAt: new Date('2025-01-01') }),
      ],
    });
    const aktif = await screen.findByRole('region', { name: 'Paket aktif' });
    expect(within(aktif).getByText('Paket Reformer Aktif')).toBeVisible();
    expect(within(aktif).getByText('8')).toBeVisible();
    expect(within(aktif).getByRole('link', { name: 'Booking kelas' })).toHaveAttribute(
      'href',
      '/classes?branch=branch-1#schedule',
    );
    expect(within(aktif).queryByText('Paket Mat Kedaluwarsa')).not.toBeInTheDocument();
    expect(screen.getByText('8 sesi tersisa dari 1 paket aktif.')).toBeVisible();

    await userEvent.click(screen.getByText('Riwayat paket dan pesanan'));
    expect(screen.getByText('Paket Mat Kedaluwarsa')).toBeVisible();
    expect(screen.getByText(/2 sesi hangus/)).toBeVisible();
  });

  it('loads every page of packages instead of paginating', async () => {
    const ledgerList = vi.fn((_branch?: string, cursor?: string) =>
      Promise.resolve({
        items: cursor
          ? [paket({ id: 'p21', packageName: 'Paket 21' })]
          : Array.from({ length: 20 }, (_, i) => paket({ id: `p${i + 1}`, packageName: `Paket ${i + 1}` })),
        summary: { packageCount: 21, ledgerBalance: 0, reserved: 0, available: 0 },
        nextCursor: cursor ? null : 'page-2',
      }),
    );
    setup({ ledgerList });
    expect(await screen.findByText('Paket 21')).toBeVisible();
    expect(screen.getByText('Paket 1')).toBeVisible();
    expect(ledgerList).toHaveBeenCalledTimes(2);
  });
});

describe('sejak', () => {
  it('describes elapsed time in plain Indonesian', () => {
    const now = Date.parse('2026-11-02T10:00:00Z');
    expect(sejak('2026-11-02T09:59:30Z', now)).toBe('baru saja');
    expect(sejak('2026-11-02T09:35:00Z', now)).toBe('25 menit lalu');
    expect(sejak('2026-11-02T06:00:00Z', now)).toBe('4 jam lalu');
    expect(sejak('2026-10-31T10:00:00Z', now)).toBe('2 hari lalu');
  });
});
