import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppFeedbackProvider } from '../components/app-feedback';
import { PindahJam, type PindahJamClient } from './pindah-jam';

const slot = (id: string, jamUtc: string, o: Record<string, unknown> = {}) => ({
  id,
  className: 'Reformer',
  branchName: 'Untar',
  startAt: `2026-11-20T${jamUtc}:00Z`,
  endAt: `2026-11-20T${jamUtc}:50Z`,
  terisi: 3,
  capacity: 8,
  memberSudahBooking: false,
  bisaDipilih: true,
  ...o,
});

describe('PindahJam', () => {
  it('pilih jam tujuan, isi alasan, lampirkan bukti (wajib), lalu kirim', async () => {
    const user = userEvent.setup();
    const client: PindahJamClient = {
      pilihan: vi.fn(async () => ({
        items: [slot('s-12', '05', { memberSudahBooking: true }), slot('s-17', '10', { bisaDipilih: false, terisi: 8 })],
      })),
      pindah: vi.fn(async () => ({ cara: 'BATAL_SLOT_LAMA' as const })),
    };
    const onBerubah = vi.fn();
    render(
      <AppFeedbackProvider>
        <PindahJam bookingId="b-1" nama="Shelly Shella" client={client} onBerubah={onBerubah} />
      </AppFeedbackProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Pindah jam' }));
    const dialog = await screen.findByRole('dialog', { name: 'Pindah jam Shelly Shella' });
    expect(await within(dialog).findByText('sudah dibooking member')).toBeVisible();
    expect(within(dialog).getAllByRole('radio')[1]).toBeDisabled();
    await user.click(within(dialog).getAllByRole('radio')[0]!);
    await user.type(within(dialog).getByLabelText(/Alasan/), 'Member pindah ke jam 12 lewat WA');
    const kirim = within(dialog).getByRole('button', { name: 'Pindahkan' });
    expect(kirim).toBeDisabled();
    const bukti = new File(['x'], 'chat.png', { type: 'image/png' });
    await user.upload(within(dialog).getByLabelText(/Bukti pendukung, wajib/), bukti);
    await user.click(kirim);
    await waitFor(() =>
      expect(client.pindah).toHaveBeenCalledWith('b-1', {
        targetClassSlotId: 's-12',
        reason: 'Member pindah ke jam 12 lewat WA',
        bukti,
      }),
    );
    expect(onBerubah).toHaveBeenCalled();
    expect(await screen.findByText(/Booking lama dibatalkan, sesinya utuh/)).toBeVisible();
  });
});
