import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ItemTindakan, KotakTindakan, WorkQueueClient } from '@/api-clients/work-queue-client';
import { AppFeedbackProvider } from '../components/app-feedback';
import { ActionInbox } from './action-inbox';

beforeAll(() => {
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:bukti');
  globalThis.URL.revokeObjectURL = vi.fn();
});

const transfer = (n: number): ItemTindakan => ({
  id: `p-${n}`,
  jenis: 'TRANSFER',
  version: 1,
  masukPada: `2026-11-22T00:0${n % 10}:00.000Z`,
  branchId: 'gg',
  branchName: 'Gading',
  nama: `Member ${n}`,
  rincian: '10 Sesi',
});
const semua = Array.from({ length: 8 }, (_, i) => transfer(i + 1));
const kotak = (items: ItemTindakan[], nextCursor: string | null = null): KotakTindakan => ({
  dibuatPada: '',
  ringkasan: [{ jenis: 'TRANSFER', jumlah: 8 }],
  items,
  nextCursor,
  pengingat: [],
  gagal: [],
});

describe('Periksa transfer satu per satu: lebih dari 5 item', () => {
  it('setelah 5 item pertama dilewati, item ke-6 dimuat dan tampil', async () => {
    const user = userEvent.setup();
    const tindakan = vi.fn(async (q: { jenis?: string; cursor?: string }) => {
      if (!q.jenis) return kotak(semua.slice(0, 5));
      return q.cursor ? kotak([]) : kotak(semua, null);
    });
    const queueClient: WorkQueueClient = { tertinggal: vi.fn(), tindakan } as never;
    const purchaseClient = {
      detail: vi.fn(async (id: string) => ({
        purchase: {
          id,
          version: 1,
          status: 'WAITING_VERIFICATION',
          paymentMethod: 'BANK_TRANSFER',
          payableAmountRpSnapshot: 1_500_123,
          packageNameSnapshot: '10 Sesi',
          customer: { displayName: `Member ${id.slice(2)}` },
          branch: { name: 'Gading' },
          paymentProof: { id: `proof-${id}`, scanStatus: 'CLEAN', mimeType: 'image/png' },
        },
      })),
      loadProof: vi.fn().mockResolvedValue(new Blob(['x'], { type: 'image/png' })),
      approve: vi.fn(),
      reject: vi.fn(),
    };
    render(
      <AppFeedbackProvider>
        <ActionInbox
          branchId="gg"
          now={Date.parse('2026-11-22T03:00:00Z')}
          queueClient={queueClient}
          purchaseClient={purchaseClient as never}
          bookingClient={{} as never}
          ledgerClient={{} as never}
          tampilan="ringkas"
        />
      </AppFeedbackProvider>,
    );
    await user.click(await screen.findByRole('button', { name: 'Periksa 8 transfer' }));
    for (let n = 1; n <= 5; n++) {
      const d = await screen.findByRole('dialog', { name: new RegExp(`Bukti transfer Member ${n} `) });
      fireEvent.load(await within(d).findByRole('img'));
      await user.click(within(d).getByRole('button', { name: 'Lewati' }));
    }
    expect(await screen.findByRole('dialog', { name: /Bukti transfer Member 6 / })).toBeVisible();
  });
});

describe('Pembatalan izin medis tanpa bukti', () => {
  it('penyetuju diberi peringatan; yang ada buktinya mendapat tautan Lihat bukti pendukung', async () => {
    const pembatalan = (id: string, alasan: string, buktiUrl: string | null): ItemTindakan => ({
      id,
      jenis: 'PEMBATALAN',
      version: 1,
      masukPada: '2026-11-22T00:00:00.000Z',
      branchId: 'untar',
      branchName: 'Untar',
      nama: id,
      rincian: 'Reformer',
      alasan,
      buktiUrl,
    });
    const items = [
      pembatalan('Noriko', '[IZIN MEDIS] Member sakit dengan surat dokter resmi', null),
      pembatalan('Nana', '[IZIN MEDIS] Member sakit dengan surat dokter resmi', '/api/v1/session-adjustments/r-2/evidence'),
    ];
    const queueClient = {
      tertinggal: vi.fn(),
      tindakan: vi.fn(async () => ({
        dibuatPada: '',
        ringkasan: [{ jenis: 'PEMBATALAN', jumlah: 2 }],
        items,
        nextCursor: null,
        pengingat: [],
        gagal: [],
      })),
    } as never;
    render(
      <AppFeedbackProvider>
        <ActionInbox
          branchId="untar"
          now={Date.parse('2026-11-22T03:00:00Z')}
          queueClient={queueClient}
          purchaseClient={{} as never}
          bookingClient={{} as never}
          ledgerClient={{} as never}
        />
      </AppFeedbackProvider>,
    );
    expect(await screen.findAllByText(/Izin medis tanpa bukti/)).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Lihat bukti pendukung' })).toHaveAttribute(
      'href',
      '/api/v1/session-adjustments/r-2/evidence',
    );
  });
});
