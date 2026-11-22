import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckInPassView } from './check-in-pass-view';

vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn().mockResolvedValue(undefined) } }));

let roles = ['INSTRUCTOR'];
vi.mock('../session-context', () => ({
  useSessionContext: () => ({ session: { roles, displayName: 'Asrida Putri' } }),
}));

const respond = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('QR tetap: teks mengikuti peran pemiliknya', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('instruktur melihat aturan 45 menit sebelum sampai 10 menit setelah kelas mulai, bukan teks member', async () => {
    roles = ['INSTRUCTOR'];
    vi.stubGlobal('fetch', vi.fn(async () => respond({ pass: 'dd-pass:v1:abc' })));
    render(<CheckInPassView />);

    expect(await screen.findByText(/45 menit sebelum kelas sampai 10 menit setelah kelas mulai/)).toBeVisible();
    expect(screen.queryByText(/sampai kelas selesai/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kembali ke Beranda' })).toHaveAttribute('href', '/workspace');
  });

  it('member melihat aturan 45 menit sebelum kelas sampai kelas selesai', async () => {
    roles = ['CUSTOMER'];
    vi.stubGlobal('fetch', vi.fn(async () => respond({ pass: 'dd-pass:v1:abc' })));
    render(<CheckInPassView />);

    expect(await screen.findByText(/mulai 45 menit sebelum kelas sampai kelas selesai/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Kembali ke Beranda' })).toHaveAttribute('href', '/account');
  });
});
