import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { KirimQrWhatsApp, pesanHasilKirim } from './kirim-qr-whatsapp';

const caps = vi.hoisted(() => ({ list: ['attendance:manage'] as string[] }));
vi.mock('../session-context', () => ({
  useSessionContext: () => ({ hasCapability: (c: string) => caps.list.includes(c) }),
}));

describe('KirimQrWhatsApp', () => {
  it('mengirim QR dan memberi tahu hasilnya', async () => {
    const user = userEvent.setup();
    const kirim = vi.fn().mockResolvedValue({ status: 'SENT', provider: 'META_CLOUD_API' });
    render(<KirimQrWhatsApp userId="m-1" nama="Lia" punyaNomor kirim={kirim} />);
    await user.click(screen.getByRole('button', { name: 'Kirim QR via WhatsApp' }));
    expect(kirim).toHaveBeenCalledWith('m-1');
    expect(await screen.findByText('QR kehadiran terkirim ke WhatsApp Lia.')).toBeVisible();
  });

  it('tidak bisa ditekan tanpa nomor, dan tidak tampil tanpa izin', () => {
    const { unmount } = render(
      <KirimQrWhatsApp userId="m-1" nama="Lia" punyaNomor={false} kirim={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Kirim QR via WhatsApp' })).toBeDisabled();
    unmount();
    caps.list = [];
    render(<KirimQrWhatsApp userId="m-1" nama="Lia" punyaNomor kirim={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Kirim QR via WhatsApp' })).toBeNull();
    caps.list = ['attendance:manage'];
  });
});

describe('pesanHasilKirim', () => {
  it('jujur saat WhatsApp masih mode uji atau baru saja dikirim', () => {
    expect(pesanHasilKirim({ status: 'SENT', provider: 'MOCK' }, 'Lia').pesan).toMatch(
      /belum benar-benar terkirim/,
    );
    expect(
      pesanHasilKirim({ status: 'SKIPPED_DUPLICATE', provider: 'IDEMPOTENCY_GUARD' }, 'Lia').tone,
    ).toBe('warning');
    expect(pesanHasilKirim({ status: 'FAILED', provider: 'META_CLOUD_API' }, 'Lia').tone).toBe(
      'danger',
    );
  });
});
