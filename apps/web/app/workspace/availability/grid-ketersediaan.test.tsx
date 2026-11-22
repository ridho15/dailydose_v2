import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AvailabilityClient, AvailabilityWindow } from '@/api-clients/availability-client';
import { AppFeedbackProvider } from '../../components/app-feedback';
import { GridKetersediaan, blokTerisi } from './grid-ketersediaan';

const branch = { id: 'b-1', name: 'Tebet', timezone: 'Asia/Jakarta' };
// Minggu, 22 November 2026 10.00 WIB: grid membuka minggu depan (Senin 23 sampai Minggu 29).
const SEKARANG = new Date('2026-11-22T03:00:00.000Z').getTime();

const jendela = (startIso: string, endIso: string): AvailabilityWindow => ({
  id: startIso,
  instructorUserId: 'inst-1',
  branchId: 'b-1',
  startAt: new Date(startIso),
  endAt: new Date(endIso),
  timezone: 'Asia/Jakarta',
  version: 1,
  status: 'ACTIVE',
});

const klien = (items: AvailabilityWindow[]) =>
  ({
    list: vi.fn().mockResolvedValue({ items, page: { hasMore: false, nextCursor: null } }),
    create: vi.fn().mockImplementation(async (input) => ({ ...input, id: 'baru', idempotentReplay: false })),
    update: vi.fn(),
    remove: vi.fn(),
  }) as unknown as AvailabilityClient;

const tampil = (client: AvailabilityClient, onTersimpan = vi.fn()) =>
  render(
    <AppFeedbackProvider>
      <GridKetersediaan client={client} branch={branch} onTersimpan={onTersimpan} now={() => SEKARANG} />
    </AppFeedbackProvider>,
  );

describe('Grid ketersediaan instruktur', () => {
  it('memetakan baris ketersediaan ke blok Pagi/Siang/Sore', () => {
    // 08.00 sampai 16.00 WIB mencakup blok Siang (11.00) dan Sore (15.00), bukan Pagi (07.00).
    const terisi = blokTerisi([jendela('2026-11-23T01:00:00.000Z', '2026-11-23T09:00:00.000Z')], 'Asia/Jakarta');
    expect([...terisi].sort()).toEqual(['2026-11-23|SIANG', '2026-11-23|SORE']);
  });

  it('tekan dua kotak lalu Kirim: dua baris baru di tabel ketersediaan dengan jam bloknya', async () => {
    const user = userEvent.setup();
    const client = klien([]);
    const onTersimpan = vi.fn();
    tampil(client, onTersimpan);

    await user.click(await screen.findByRole('gridcell', { name: 'Senin, 23 Nov Pagi' }));
    await user.click(screen.getByRole('gridcell', { name: 'Rabu, 25 Nov Sore' }));
    await user.click(screen.getByRole('button', { name: 'Kirim 2 blok jam' }));

    await waitFor(() => expect(client.create).toHaveBeenCalledTimes(2));
    expect(client.create).toHaveBeenCalledWith({
      branchId: 'b-1',
      startAt: new Date('2026-11-23T00:00:00.000Z'),
      endAt: new Date('2026-11-23T04:00:00.000Z'),
    });
    expect(client.create).toHaveBeenCalledWith({
      branchId: 'b-1',
      startAt: new Date('2026-11-25T08:00:00.000Z'),
      endAt: new Date('2026-11-25T13:00:00.000Z'),
    });
    await waitFor(() => expect(onTersimpan).toHaveBeenCalled());
  });

  it('"Sama seperti minggu lalu" memilih blok minggu sebelumnya, yang sudah diajukan tidak dikirim ulang', async () => {
    const user = userEvent.setup();
    const client = klien([
      // Minggu lalu: Senin 16 Nov Pagi dan Selasa 17 Nov Siang.
      jendela('2026-11-16T00:00:00.000Z', '2026-11-16T04:00:00.000Z'),
      jendela('2026-11-17T04:00:00.000Z', '2026-11-17T08:00:00.000Z'),
      // Minggu ini sudah ada: Selasa 24 Nov Siang.
      jendela('2026-11-24T04:00:00.000Z', '2026-11-24T08:00:00.000Z'),
    ]);
    tampil(client);

    await user.click(await screen.findByRole('button', { name: 'Sama seperti minggu lalu (1 blok)' }));
    expect(screen.getByRole('gridcell', { name: 'Selasa, 24 Nov Siang, sudah diajukan' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Kirim 1 blok jam' }));

    await waitFor(() => expect(client.create).toHaveBeenCalledTimes(1));
    expect(client.create).toHaveBeenCalledWith(
      expect.objectContaining({ startAt: new Date('2026-11-23T00:00:00.000Z') }),
    );
  });
});
