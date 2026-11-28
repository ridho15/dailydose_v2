import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { InfoWaTertaut, WaTertautClient } from '@/api-clients/wa-tertaut-client';
import { AppFeedbackProvider } from '@/components/app-feedback';
import { PengingatWhatsAppAdmin, WhatsAppOtomatis } from './whatsapp-otomatis';

const Panel = (p: { client: WaTertautClient }) => (
  <AppFeedbackProvider>
    <WhatsAppOtomatis client={p.client} />
  </AppFeedbackProvider>
);

const info = (o: Partial<InfoWaTertaut> = {}): InfoWaTertaut => ({ siap: true, status: 'BELUM_TERSAMBUNG', nomor: null, qr: null, galat: null, ...o });
const client = (awal: InfoWaTertaut, setelahMulai = info({ status: 'MENUNGGU_SCAN', qr: 'data:image/png;base64,AAAA' })): WaTertautClient => ({
  status: vi.fn().mockResolvedValue(awal),
  mulai: vi.fn().mockResolvedValue(setelahMulai),
  uji: vi.fn().mockResolvedValue({ terkirim: true }),
  putuskan: vi.fn().mockResolvedValue({}),
});

describe('WhatsAppOtomatis', () => {
  it('Sambungkan menampilkan QR dan langkah scan dari Perangkat tertaut', async () => {
    const user = userEvent.setup();
    const c = client(info());
    render(<Panel client={c} />);
    await user.click(await screen.findByRole('button', { name: 'Sambungkan WhatsApp' }));
    expect(await screen.findByRole('img', { name: 'QR untuk menautkan WhatsApp' })).toHaveAttribute('src', 'data:image/png;base64,AAAA');
    expect(screen.getByText(/Perangkat tertaut/)).toBeInTheDocument();
    expect(screen.getByText('Menunggu scan')).toBeInTheDocument();
  });

  it('tersambung: nomor tampil dan pesan uji bisa dikirim', async () => {
    const user = userEvent.setup();
    const c = client(info({ status: 'TERSAMBUNG', nomor: '6281111111111' }));
    render(<Panel client={c} />);
    expect(await screen.findByText('Tersambung · +6281111111111')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Kirim pesan uji' }));
    expect(c.uji).toHaveBeenCalled();
    expect(await screen.findByText('Pesan uji terkirim ke chat WhatsApp Anda sendiri.')).toBeInTheDocument();
  });

  it('server belum disiapkan: tidak ada tombol, ada penjelasan', async () => {
    render(<Panel client={client(info({ siap: false }))} />);
    expect(await screen.findByText(/belum disiapkan di server/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('PengingatWhatsAppAdmin', () => {
  it('muncul bila terputus, diam bila tersambung', async () => {
    const { unmount } = render(<PengingatWhatsAppAdmin client={client(info({ status: 'TERPUTUS' }))} />);
    expect(await screen.findByText(/WhatsApp otomatis Anda terputus/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sambungkan WhatsApp' })).toHaveAttribute('href', '/account/profile#whatsapp');
    unmount();
    const c = client(info({ status: 'TERSAMBUNG' }));
    const { container } = render(<PengingatWhatsAppAdmin client={c} />);
    await vi.waitFor(() => expect(c.status).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
