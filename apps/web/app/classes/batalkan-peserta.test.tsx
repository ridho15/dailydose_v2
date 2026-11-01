import { render as rtlRender, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppFeedbackProvider } from '@/components/app-feedback';
import { BatalkanPeserta } from './batalkan-peserta';

let session: { id: string; roles: string[]; capabilities: string[] } = {
  id: 'admin-1',
  roles: ['ADMIN'],
  capabilities: ['booking:cancel:assisted'],
};
vi.mock('../session-context', () => ({ useSessionContext: () => ({ session }) }));

const render = (view: React.ReactNode) =>
  rtlRender(<AppFeedbackProvider>{view}</AppFeedbackProvider>);
const besok = new Date(Date.now() + 20 * 3_600_000);
const booking = {
  id: 'b1',
  status: 'ATTENDED',
  customer: { id: 'c1', displayName: 'Theresia', phoneMasked: null },
};

const klien = () => ({
  cancelAsStaff: vi.fn().mockResolvedValue(undefined),
  cancellationOptions: vi.fn().mockResolvedValue({
    canCancel: false,
    unavailableReason: 'CANCELLATION_CUTOFF_PASSED',
    supportAction: 'USE_SESSION_ADJUSTMENT',
    cutoffAt: '',
  }),
  ajukanPembatalanTerlambat: vi.fn().mockResolvedValue({ id: 'r1' }),
  putuskanPembatalan: vi.fn().mockResolvedValue({ status: 'APPROVED', sessionsReturned: 1 }),
});

describe('BatalkanPeserta', () => {
  it('di bawah H-24 (atau booking terkunci Hadir) mengirim pengajuan, bukan membatalkan langsung', async () => {
    const client = klien();
    const onBerubah = vi.fn();
    render(
      <BatalkanPeserta
        booking={booking}
        kelasMulai={besok}
        client={client}
        onBerubah={onBerubah}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Batalkan booking Theresia' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ajukan pembatalan Theresia?' });
    expect(dialog).toHaveTextContent(/disetujui Manager atau Owner/);
    await user.type(within(dialog).getByLabelText(/Alasan/), 'Sakit, minta batal lewat WA');
    await user.click(within(dialog).getByRole('button', { name: 'Kirim pengajuan' }));
    expect(client.ajukanPembatalanTerlambat).toHaveBeenCalledWith(
      'b1',
      'Sakit, minta batal lewat WA',
    );
    expect(client.cancelAsStaff).not.toHaveBeenCalled();
    expect(onBerubah).toHaveBeenCalled();
  });

  it('pengajuan yang menunggu: admin hanya melihat statusnya, Manager bisa menyetujui', async () => {
    const pengajuan = {
      id: 'r1',
      version: 1,
      bookingId: 'b1',
      sessionCount: 1,
      reason: 'Sakit, minta batal lewat WA',
      requestedById: 'admin-1',
      requestedByName: 'Admin MK',
      createdAt: '',
    };
    const client = klien();
    const { unmount } = render(
      <BatalkanPeserta
        booking={booking}
        kelasMulai={besok}
        client={client}
        pengajuan={pengajuan}
        onBerubah={vi.fn()}
      />,
    );
    expect(screen.getByText('Menunggu persetujuan batal')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Setujui' })).toBeNull();
    unmount();

    session = { id: 'mgr-1', roles: ['MANAGER'], capabilities: ['booking:late-cancel:decide'] };
    const onBerubah = vi.fn();
    render(
      <BatalkanPeserta
        booking={booking}
        kelasMulai={besok}
        client={client}
        pengajuan={pengajuan}
        onBerubah={onBerubah}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Setujui' }));
    const konfirmasi = await screen.findByRole('dialog', { name: 'Setujui pembatalan Theresia?' });
    expect(konfirmasi).toHaveTextContent('1 sesi dikembalikan ke paket member');
    await user.click(within(konfirmasi).getByRole('button', { name: 'Setujui pembatalan' }));
    expect(client.putuskanPembatalan).toHaveBeenCalledWith('r1', 'approve', 1);
    expect(onBerubah).toHaveBeenCalled();
  });

  it('tidak ada tombol untuk kelas yang sudah dimulai', () => {
    session = { id: 'admin-1', roles: ['ADMIN'], capabilities: ['booking:cancel:assisted'] };
    const { container } = render(
      <BatalkanPeserta
        booking={{ ...booking, status: 'BOOKED' }}
        kelasMulai={new Date(Date.now() - 60_000)}
        client={klien()}
        onBerubah={vi.fn()}
      />,
    );
    expect(within(container).queryByRole('button')).toBeNull();
  });
  it('Fase 4: admin mengajukan izin sakit (medis), mencentang checkbox dan opsi cepat surat dokter untuk langsung membuka kursi', async () => {
    session = { id: 'admin-1', roles: ['ADMIN'], capabilities: ['booking:cancel:assisted'] };
    const client = klien();
    const onBerubah = vi.fn();
    render(
      <BatalkanPeserta
        booking={booking}
        kelasMulai={besok}
        client={client}
        onBerubah={onBerubah}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Batalkan booking Theresia' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ajukan pembatalan Theresia?' });

    // Centang Izin Sakit / Medis
    const checkMedis = within(dialog).getByLabelText(/Izin Sakit/i);
    await user.click(checkMedis);

    // Klik preset Surat Dokter
    const presetBtn = within(dialog).getByRole('button', { name: /Surat Dokter/ });
    await user.click(presetBtn);

    expect(within(dialog).getByLabelText(/Alasan/)).toHaveValue('Member sakit dengan surat dokter resmi');

    // Klik tombol submit izin medis & buka kursi
    const submitBtn = within(dialog).getByRole('button', { name: 'Ajukan Izin Medis & Buka Kursi' });
    await user.click(submitBtn);

    expect(client.ajukanPembatalanTerlambat).toHaveBeenCalledWith(
      'b1',
      'Member sakit dengan surat dokter resmi',
      { isMedical: true, releaseSeat: true },
    );
    expect(onBerubah).toHaveBeenCalled();
  });
});
