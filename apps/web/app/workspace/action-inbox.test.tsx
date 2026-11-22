import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { AppFeedbackProvider } from '../components/app-feedback';
import type { ItemTindakan, KotakTindakan, WorkQueueClient } from '../api-clients/work-queue-client';
import { ActionInbox } from './action-inbox';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

beforeAll(() => {
  // jsdom tidak punya URL blob; penampil bukti hanya butuh string-nya.
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:bukti');
  globalThis.URL.revokeObjectURL = vi.fn();
});

const NOW = new Date('2026-11-22T03:00:00.000Z').getTime();

const item = (over: Partial<ItemTindakan>): ItemTindakan => ({
  id: 'x',
  jenis: 'TRANSFER',
  version: 1,
  masukPada: '2026-11-22T00:00:00.000Z',
  branchId: 'gg',
  branchName: 'Gading',
  nama: 'Rina',
  rincian: '10 Sesi',
  ...over,
});

const kotak = (items: ItemTindakan[]): KotakTindakan => {
  const jumlah = new Map<string, number>();
  for (const i of items) jumlah.set(i.jenis, (jumlah.get(i.jenis) ?? 0) + 1);
  return {
    dibuatPada: '',
    ringkasan: [...jumlah].map(([jenis, n]) => ({ jenis: jenis as ItemTindakan['jenis'], jumlah: n })),
    items,
    nextCursor: null,
    pengingat: [],
    gagal: [],
  };
};

const purchase = {
  id: 'p-1',
  version: 4,
  status: 'WAITING_VERIFICATION',
  paymentMethod: 'BANK_TRANSFER',
  paymentUniqueCode: 123,
  payableAmountRpSnapshot: 1_500_123,
  priceRpSnapshot: 1_500_000,
  packageNameSnapshot: '10 Sesi',
  customer: { displayName: 'Rina' },
  branch: { name: 'Gading' },
  paymentProof: { id: 'proof-1', scanStatus: 'CLEAN', mimeType: 'image/png' },
};

function setup(items: ItemTindakan[]) {
  const queueClient: WorkQueueClient = {
    tertinggal: vi.fn(),
    tindakan: vi.fn().mockResolvedValue(kotak(items)),
  };
  const purchaseClient = {
    detail: vi.fn().mockResolvedValue({ purchase }),
    loadProof: vi.fn().mockResolvedValue(new Blob(['x'], { type: 'image/png' })),
    approve: vi.fn().mockResolvedValue({}),
    reject: vi.fn().mockResolvedValue({}),
  };
  const bookingClient = {
    putuskanPembatalan: vi.fn().mockResolvedValue({ status: 'APPROVED', sessionsReturned: 0 }),
    decideReschedule: vi.fn().mockResolvedValue({}),
  };
  const ledgerClient = { decideAdjustment: vi.fn().mockResolvedValue({}) };
  render(
    <AppFeedbackProvider>
      <ActionInbox
        branchId="gg"
        now={NOW}
        queueClient={queueClient}
        purchaseClient={purchaseClient as never}
        bookingClient={bookingClient as never}
        ledgerClient={ledgerClient as never}
      />
    </AppFeedbackProvider>,
  );
  return { queueClient, purchaseClient, bookingClient, ledgerClient };
}

describe('ActionInbox', () => {
  it('kosong: memberi tahu tidak ada yang perlu diputuskan', async () => {
    setup([]);
    expect(await screen.findByText('Tidak ada yang perlu Anda putuskan saat ini.')).toBeVisible();
  });

  it('transfer dalam dua langkah: bukti dibuka, Setujui baru aktif setelah gambar tampil, lalu ada 10 detik untuk membatalkan', async () => {
    const user = userEvent.setup();
    const c = setup([item({ id: 'p-1', nilaiRp: 1_500_123, buktiAda: true })]);
    await user.click(await screen.findByRole('button', { name: 'Periksa bukti' }));
    const viewer = await screen.findByRole('dialog', { name: 'Bukti transfer Rina' });
    const setujui = await within(viewer).findByRole('button', { name: 'Setujui dan aktifkan paket' });
    expect(setujui).toBeDisabled();
    fireEvent.load(await within(viewer).findByRole('img', { name: 'Bukti transfer Rina' }));
    expect(setujui).toBeEnabled();
    await user.click(setujui);

    const tunda = await screen.findByRole('status');
    expect(tunda).toHaveTextContent('Setujui pembayaran Rina');
    expect(c.purchaseClient.approve).not.toHaveBeenCalled();
    await user.click(within(tunda).getByRole('button', { name: 'Kirim sekarang' }));
    await waitFor(() =>
      expect(c.purchaseClient.approve).toHaveBeenCalledWith('p-1', 4, expect.any(String)),
    );
    await waitFor(() => expect(screen.queryByText('Rina')).toBeNull());
  });

  it('transfer dibatalkan dalam 10 detik: tidak ada yang dikirim', async () => {
    const user = userEvent.setup();
    const c = setup([item({ id: 'p-1', buktiAda: true })]);
    await user.click(await screen.findByRole('button', { name: 'Periksa bukti' }));
    const viewer = await screen.findByRole('dialog', { name: 'Bukti transfer Rina' });
    fireEvent.load(await within(viewer).findByRole('img', { name: 'Bukti transfer Rina' }));
    await user.click(within(viewer).getByRole('button', { name: 'Setujui dan aktifkan paket' }));
    await user.click(within(await screen.findByRole('status')).getByRole('button', { name: 'Batalkan' }));
    expect(c.purchaseClient.approve).not.toHaveBeenCalled();
    expect(screen.getByText('Rina')).toBeVisible();
  });

  it('tolak transfer memakai kode alasan yang dibaca member; "Lainnya" wajib catatan', async () => {
    const user = userEvent.setup();
    const c = setup([item({ id: 'p-1', buktiAda: true })]);
    await user.click(await screen.findByRole('button', { name: 'Tolak' }));
    const viewer = await screen.findByRole('dialog', { name: 'Bukti transfer Rina' });
    await user.click(await within(viewer).findByRole('button', { name: 'Tolak' }));
    const kirim = within(viewer).getByRole('button', { name: 'Tolak pembayaran' });
    expect(kirim).toBeDisabled();
    await user.click(within(viewer).getByRole('radio', { name: 'Lainnya' }));
    expect(kirim).toBeDisabled();
    await user.click(within(viewer).getByRole('radio', { name: 'Nominal tidak sesuai' }));
    expect(within(viewer).getByText(/Nominal transfer tidak sesuai/)).toBeVisible();
    await user.click(kirim);
    await user.click(within(await screen.findByRole('status')).getByRole('button', { name: 'Kirim sekarang' }));
    await waitFor(() =>
      expect(c.purchaseClient.reject).toHaveBeenCalledWith(
        'p-1',
        4,
        'AMOUNT_MISMATCH',
        expect.any(String),
        undefined,
      ),
    );
  });

  it('pembatalan kurang dari H-12: Setujui lewat konfirmasi, lalu kartunya hilang', async () => {
    const user = userEvent.setup();
    const c = setup([
      item({
        id: 'lc-1',
        jenis: 'PEMBATALAN',
        version: 3,
        alasan: 'Sakit mendadak pagi ini',
        sesi: 1,
        kelas: { nama: 'Reformer', mulai: '2026-11-22T05:00:00.000Z' },
      }),
    ]);
    await user.click(await screen.findByRole('button', { name: 'Setujui' }));
    const dialog = await screen.findByRole('dialog', { name: /Setujui pembatalan/ });
    expect(dialog).toHaveTextContent('1 sesi kembali ke paket');
    await user.click(within(dialog).getByRole('button', { name: 'Setujui' }));
    await waitFor(() =>
      expect(c.bookingClient.putuskanPembatalan).toHaveBeenCalledWith('lc-1', 'approve', 3),
    );
    await waitFor(() => expect(screen.queryByText('Rina')).toBeNull());
  });

  it('penjualan tunai ditolak dengan chip alasan, memakai versi terbaru dari server', async () => {
    const user = userEvent.setup();
    const c = setup([
      item({ id: 'p-1', jenis: 'PENJUALAN_LANGSUNG', metode: 'CASH', nilaiRp: 900_000, pencatat: 'Admin GG' }),
    ]);
    expect(await screen.findByText(/diajukan Admin GG/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Tolak' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tolak: Rina' });
    await user.click(within(dialog).getByRole('radio', { name: 'Tercatat ganda' }));
    await user.click(within(dialog).getByRole('button', { name: 'Tolak' }));
    await waitFor(() =>
      expect(c.purchaseClient.reject).toHaveBeenCalledWith(
        'p-1',
        4,
        'DUPLICATE_PURCHASE',
        expect.any(String),
        undefined,
      ),
    );
  });

  it('reschedule dan penyesuaian sesi: Setujui mengirim kode persetujuan yang diterima server', async () => {
    const user = userEvent.setup();
    const c = setup([
      item({ id: 'rs-1', jenis: 'RESCHEDULE', nama: 'Budi' }),
      item({ id: 'adj-1', jenis: 'PENYESUAIAN', nama: 'Sari', version: 2, sesi: 1 }),
    ]);
    const kartuBudi = (await screen.findByText('Budi')).closest('li')!;
    await user.click(within(kartuBudi).getByRole('button', { name: 'Setujui' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Setujui' }));
    await waitFor(() =>
      expect(c.bookingClient.decideReschedule).toHaveBeenCalledWith(
        'rs-1',
        'approve',
        { reasonCode: 'ELIGIBILITY_VERIFIED', expectedVersion: 1 },
        expect.any(String),
      ),
    );
    const kartuSari = screen.getByText('Sari').closest('li')!;
    await user.click(within(kartuSari).getByRole('button', { name: 'Setujui' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Setujui' }));
    await waitFor(() =>
      expect(c.ledgerClient.decideAdjustment).toHaveBeenCalledWith(
        'adj-1',
        'approve',
        { reasonCode: 'CORRECTION_VERIFIED', expectedVersion: 2 },
        expect.any(String),
      ),
    );
  });

  it('sumber yang gagal dimuat diberi tahu, bukan dianggap kosong', async () => {
    const queueClient: WorkQueueClient = {
      tertinggal: vi.fn(),
      tindakan: vi.fn().mockResolvedValue({ ...kotak([]), gagal: ['TRANSFER'] }),
    };
    render(
      <AppFeedbackProvider>
        <ActionInbox queueClient={queueClient} now={NOW} />
      </AppFeedbackProvider>,
    );
    expect(await screen.findByText(/Sebagian daftar belum dapat dimuat/)).toBeVisible();
    expect(screen.queryByText('Tidak ada yang perlu Anda putuskan saat ini.')).toBeNull();
  });
});
