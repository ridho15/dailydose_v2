import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { KontakWhatsapp } from './kontak-whatsapp';

let studios: unknown[] = [];
vi.mock('../components/public/public-experience', () => ({
  useStudioPreference: () => ({ whatsappStudios: studios }),
}));

const cabang = (id: string, nama: string, area: string | null, studioSaya = false) => ({
  id,
  nama,
  area,
  href: `https://wa.me/62811${id}?text=halo`,
  studioSaya,
});

describe('KontakWhatsapp', () => {
  it('membuka pilihan cabang di halaman yang sama dan menutupnya dengan Escape', async () => {
    studios = [cabang('1', 'Green Garden', 'Jakarta Barat', true), cabang('2', 'Surabaya', null)];
    const view = render(
      <ol>
        <KontakWhatsapp />
      </ol>,
    );
    const tombol = screen.getByRole('button', { name: /Chat WhatsApp CS/ });
    expect(tombol).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region')).toBeNull();

    await userEvent.click(tombol);
    expect(tombol).toHaveAttribute('aria-expanded', 'true');
    const pilihan = screen.getByRole('region', { name: 'Pilih studio yang ingin dihubungi' });
    expect(pilihan).toBeVisible();
    expect(screen.getByRole('link', { name: /Green Garden/ })).toHaveAttribute(
      'href',
      'https://wa.me/628111?text=halo',
    );
    expect(screen.getByText('Studio Anda')).toBeVisible();
    expect((await axe(view.container)).violations).toHaveLength(0);

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('region')).toBeNull();
    expect(tombol).toHaveFocus();
  });

  it('langsung membuka WhatsApp bila hanya ada satu cabang atau daftar belum siap', () => {
    studios = [];
    const { rerender } = render(
      <ol>
        <KontakWhatsapp />
      </ol>,
    );
    expect(screen.getByRole('link', { name: /Chat WhatsApp CS/ })).toHaveAttribute(
      'href',
      expect.stringContaining('https://wa.me/'),
    );
    studios = [cabang('1', 'Green Garden', null)];
    rerender(
      <ol>
        <KontakWhatsapp />
      </ol>,
    );
    expect(screen.getByRole('link', { name: /Chat WhatsApp CS/ })).toHaveAttribute(
      'href',
      'https://wa.me/628111?text=halo',
    );
  });
});
