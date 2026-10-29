import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HeroCarouselPayload } from '@/api-clients/account-client';
import { HeroCarousel } from './hero-carousel';

function mockReducedMotion(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation(() => ({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

describe('HeroCarousel (editorial)', () => {
  beforeEach(() => mockReducedMotion(false));
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('menampilkan slide default dengan judul, CTA, dan kontrol tanpa pelanggaran aksesibilitas', async () => {
    const view = render(<HeroCarousel />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Stronger Body. Calmer Mind.' }),
    ).toHaveAttribute('id', 'marketing-hero-title');
    expect(screen.getByRole('link', { name: 'See Schedule' })).toHaveAttribute(
      'href',
      '/classes#schedule',
    );
    expect(screen.getByRole('link', { name: 'See Packages' })).toHaveAttribute('href', '/packages');
    expect(screen.getByRole('navigation', { name: 'Choose a slide' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next slide' })).toBeInTheDocument();
    expect((await axe(view.container)).violations).toHaveLength(0);
  });

  it('berpindah slide lewat tombol berikutnya, sebelumnya, dan penanda', async () => {
    const user = userEvent.setup();
    render(<HeroCarousel />);

    await user.click(screen.getByRole('button', { name: 'Next slide' }));
    expect(
      screen.getByRole('heading', { level: 1, name: /Start Your Pilates Journey/ }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show slide 3 of 3' }));
    expect(screen.getByRole('heading', { level: 1, name: /Calm & Personal/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Previous slide' }));
    expect(screen.getByRole('heading', { level: 1, name: /Start Your Pilates/ })).toBeInTheDocument();
  });

  it('memakai slide dari CMS yang aktif dan terurut, tanpa kontrol bila hanya satu slide', () => {
    const config = {
      autoplay: false,
      slides: [
        {
          id: 'b',
          title: 'Kedua',
          description: 'Tidak aktif',
          imageSrc: '/x.png',
          active: false,
          order: 1,
        },
        {
          id: 'a',
          title: 'Hanya Satu',
          highlightTitle: 'Slide CMS',
          description: 'Deskripsi CMS',
          imageSrc: '/x.png',
          active: true,
          order: 2,
        },
      ],
    } as unknown as HeroCarouselPayload;
    render(<HeroCarousel config={config} />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Hanya Satu Slide CMS' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next slide' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Choose a slide' })).not.toBeInTheDocument();
  });

  it('autoplay berjalan, kecuali pengguna meminta gerak dikurangi', () => {
    vi.useFakeTimers();
    const { unmount } = render(<HeroCarousel />);
    act(() => {
      vi.advanceTimersByTime(6100);
    });
    expect(screen.getByRole('heading', { level: 1, name: /Start Your Pilates/ })).toBeInTheDocument();
    unmount();

    mockReducedMotion(true);
    render(<HeroCarousel />);
    act(() => {
      vi.advanceTimersByTime(20000);
    });
    expect(
      screen.getByRole('heading', { level: 1, name: 'Stronger Body. Calmer Mind.' }),
    ).toBeInTheDocument();
  });
});
