import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppFeedbackProvider } from '../../components/app-feedback';
import type { AvailabilityClient, AvailabilityWindow } from '@/api-clients/availability-client';
import { AvailabilityView } from './availability-view';

let capabilities: string[] = [];
let activeBranch: { id: string; name: string; timezone: string } | null = {
  id: 'branch-1',
  name: 'Daily Dose Green Garden',
  timezone: 'Asia/Jakarta',
};

vi.mock('../../session-context', () => ({
  useSessionContext: () => ({
    status: 'authenticated',
    session: { capabilities },
    activeBranch,
    hasCapability: (...required: string[]) =>
      required.some((capability) => capabilities.includes(capability)),
  }),
}));

const window1: AvailabilityWindow = {
  id: 'avail-1',
  instructorUserId: 'instructor-1',
  branchId: 'branch-1',
  startAt: new Date('2026-11-21T01:00:00.000Z'),
  endAt: new Date('2026-11-21T02:00:00.000Z'),
  timezone: 'Asia/Jakarta',
  version: 1,
  status: 'ACTIVE',
};

const makeClient = (overrides: Partial<AvailabilityClient> = {}): AvailabilityClient => ({
  list: vi.fn().mockResolvedValue({ items: [window1], page: { hasMore: false, nextCursor: null } }),
  create: vi.fn().mockResolvedValue({ ...window1, id: 'avail-2', idempotentReplay: false }),
  update: vi.fn().mockResolvedValue(window1),
  remove: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

const renderView = (client: AvailabilityClient) =>
  render(
    <AppFeedbackProvider>
      <AvailabilityView client={client} />
    </AppFeedbackProvider>,
  );

// Data uji memakai 21 November 2026; hanya Date yang dibekukan sebelum tanggal itu supaya
// jendela ketersediaan tetap "akan datang" kapan pun tes dijalankan.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-15T00:00:00.000Z'));
});
afterAll(() => vi.useRealTimers());

describe('AvailabilityView', () => {
  beforeEach(() => {
    capabilities = ['availability:self:read', 'availability:self:create'];
    activeBranch = { id: 'branch-1', name: 'Daily Dose Green Garden', timezone: 'Asia/Jakarta' };
  });

  it('is forbidden without availability:self:read and never loads the list', async () => {
    capabilities = [];
    const client = makeClient();
    renderView(client);
    expect(
      await screen.findByText('Anda tidak memiliki izin untuk membaca ketersediaan mengajar.'),
    ).toBeVisible();
    expect(client.list).not.toHaveBeenCalled();
  });

  it('asks for an active branch before loading anything', async () => {
    activeBranch = null;
    const client = makeClient();
    renderView(client);
    expect(
      await screen.findByText('Pilih cabang aktif untuk mengajukan atau melihat ketersediaan mengajar Anda.'),
    ).toBeVisible();
    expect(client.list).not.toHaveBeenCalled();
  });

  it('lists submitted availability windows for the active branch', async () => {
    const client = makeClient();
    renderView(client);
    await waitFor(() => expect(client.list).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: 'branch-1' }),
    ));
    expect(await screen.findAllByText('Aktif')).not.toHaveLength(0);
  });

  it('hides the submission form for a read-only session', async () => {
    capabilities = ['availability:self:read'];
    const client = makeClient();
    renderView(client);
    await waitFor(() => expect(client.list).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Ajukan ketersediaan' })).toBeNull();
  });

  it('rejects an end time before the start time without calling the API', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    renderView(client);
    await waitFor(() => expect(client.list).toHaveBeenCalled());

    await user.type(screen.getByLabelText('Tanggal'), '2026-12-01');
    await user.type(screen.getByLabelText('Mulai'), '10:00');
    await user.type(screen.getByLabelText('Selesai'), '09:00');
    await user.click(screen.getByRole('button', { name: 'Ajukan ketersediaan' }));

    expect(await screen.findByText('Waktu selesai harus setelah waktu mulai.')).toBeVisible();
    expect(client.create).not.toHaveBeenCalled();
  });

  it('submits a valid range after confirmation and refreshes the list', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    renderView(client);
    await waitFor(() => expect(client.list).toHaveBeenCalled());
    // Grid Pagi/Siang/Sore memuat minggunya sendiri; yang diuji di sini daftar dimuat ulang sekali lagi.
    await waitFor(() => expect(client.list).toHaveBeenCalledTimes(2));

    await user.type(screen.getByLabelText('Tanggal'), '2026-12-01');
    await user.type(screen.getByLabelText('Mulai'), '08:00');
    await user.type(screen.getByLabelText('Selesai'), '09:00');
    await user.click(screen.getByRole('button', { name: 'Ajukan ketersediaan' }));

    await screen.findByRole('dialog', { name: 'Ajukan ketersediaan?' });
    await user.click(screen.getByRole('button', { name: 'Ajukan' }));

    await waitFor(() => expect(client.create).toHaveBeenCalledTimes(1));
    expect(client.create).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: 'branch-1' }),
    );
    expect(await screen.findByText('Ketersediaan berhasil diajukan.')).toBeVisible();
    expect(client.list).toHaveBeenCalledTimes(3);
  });

  it('surfaces the overlap conflict message from the API', async () => {
    const user = userEvent.setup();
    const client = makeClient({
      create: vi.fn().mockRejectedValue({ status: 409, data: { error: { code: 'EFFECTIVE_PERIOD_OVERLAP' } } }),
    });
    renderView(client);
    await waitFor(() => expect(client.list).toHaveBeenCalled());

    await user.type(screen.getByLabelText('Tanggal'), '2026-12-01');
    await user.type(screen.getByLabelText('Mulai'), '08:00');
    await user.type(screen.getByLabelText('Selesai'), '09:00');
    await user.click(screen.getByRole('button', { name: 'Ajukan ketersediaan' }));
    await screen.findByRole('dialog', { name: 'Ajukan ketersediaan?' });
    await user.click(screen.getByRole('button', { name: 'Ajukan' }));

    expect(
      await screen.findByText('Rentang waktu ini tumpang tindih dengan kelas yang sudah Anda ajar.'),
    ).toBeVisible();
  });

  it('changes the hours of an upcoming window through the row menu, with the current values prefilled', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    renderView(client);
    await waitFor(() => expect(client.list).toHaveBeenCalled());

    await user.click((await screen.findAllByRole('button', { name: /Aksi ketersediaan/ }))[0]!);
    await user.click(screen.getByRole('menuitem', { name: 'Ubah jam' }));

    const dialog = await screen.findByRole('dialog', { name: 'Ubah jam ketersediaan' });
    expect(within(dialog).getByLabelText('Tanggal')).toHaveValue('2026-11-21');
    expect(within(dialog).getByLabelText('Mulai')).toHaveValue('08:00');
    expect(within(dialog).getByLabelText('Selesai')).toHaveValue('09:00');

    await user.clear(within(dialog).getByLabelText('Selesai'));
    await user.type(within(dialog).getByLabelText('Selesai'), '10:30');
    await user.click(within(dialog).getByRole('button', { name: 'Simpan perubahan' }));

    await waitFor(() => expect(client.update).toHaveBeenCalledTimes(1));
    const [id, range] = (client.update as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(id).toBe('avail-1');
    expect(range.startAt.toISOString()).toBe('2026-11-21T01:00:00.000Z');
    expect(range.endAt.toISOString()).toBe('2026-11-21T03:30:00.000Z');
    expect(await screen.findByText('Ketersediaan diperbarui.')).toBeVisible();
  });

  it('withdraws a window only after confirmation', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    renderView(client);
    await waitFor(() => expect(client.list).toHaveBeenCalled());

    await user.click((await screen.findAllByRole('button', { name: /Aksi ketersediaan/ }))[0]!);
    await user.click(screen.getByRole('menuitem', { name: 'Tarik' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tarik ketersediaan?' });
    await user.click(within(dialog).getByRole('button', { name: 'Batal' }));
    expect(client.remove).not.toHaveBeenCalled();

    await user.click(screen.getAllByRole('button', { name: /Aksi ketersediaan/ })[0]!);
    await user.click(screen.getByRole('menuitem', { name: 'Tarik' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Tarik ketersediaan?' })).getByRole('button', {
        name: 'Tarik ketersediaan',
      }),
    );
    await waitFor(() => expect(client.remove).toHaveBeenCalledWith('avail-1'));
    expect(await screen.findByText('Ketersediaan ditarik.')).toBeVisible();
  });

  it('offers no change or withdraw for ended windows or read-only sessions', async () => {
    const ended = { ...window1, status: 'ENDED' };
    const client = makeClient({
      list: vi.fn().mockResolvedValue({ items: [ended], page: { hasMore: false, nextCursor: null } }),
    });
    renderView(client);
    await waitFor(() => expect(client.list).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Aksi ketersediaan/ })).toBeNull();
  });

  it('submits recurring weekly availability windows until the selected date', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    renderView(client);
    await waitFor(() => expect(client.list).toHaveBeenCalled());

    await user.type(screen.getByLabelText('Tanggal'), '2026-12-01');
    await user.type(screen.getByLabelText('Mulai'), '08:00');
    await user.type(screen.getByLabelText('Selesai'), '09:00');

    // Click checkbox "Ulangi setiap minggu sampai tanggal tertentu"
    await user.click(screen.getByLabelText('Ulangi setiap minggu sampai tanggal tertentu'));

    // The repeatUntil date input appears
    const repeatInput = await screen.findByLabelText('Ulangi setiap minggu sampai');
    // Dec 15, 2026 gives 3 occurrences: Dec 1, Dec 8, Dec 15
    await user.type(repeatInput, '2026-12-15');

    await user.click(screen.getByRole('button', { name: 'Ajukan ketersediaan' }));

    await screen.findByRole('dialog', { name: 'Ajukan ketersediaan?' });
    expect(screen.getByText(/3 minggu berturut-turut/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ajukan' }));

    await waitFor(() => expect(client.create).toHaveBeenCalledTimes(3));
    expect(await screen.findByText('Ketersediaan berhasil diajukan untuk 3 minggu berturut-turut.')).toBeVisible();
  });
});

