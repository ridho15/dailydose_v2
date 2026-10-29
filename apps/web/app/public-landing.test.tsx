import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountClient } from '@/api-clients/account-client';
import { PublicLanding } from './public-landing';

const mockReplace = vi.fn();
let mockSessionContext: any = null;

vi.mock('./components/app-loading', () => ({
  useTrackedRouter: () => ({ replace: mockReplace, push: vi.fn() }),
}));

vi.mock('./session-context', () => ({
  useSessionContext: () => mockSessionContext,
}));

describe('public landing page', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockSessionContext = null;
    mockReplace.mockClear();
  });

  it('renders the full public journey without requiring a session', async () => {
    vi.spyOn(accountClient, 'siteConfig').mockResolvedValue({
      branches: [
        {
          id: 'branch-jakarta',
          code: 'DD-JKT',
          name: 'Daily Dose Jakarta',
          timezone: 'Asia/Jakarta',
          supportWhatsappE164: null,
        },
        {
          id: 'branch-bsd',
          code: 'DD-BSD',
          name: 'Daily Dose BSD',
          timezone: 'Asia/Jakarta',
          supportWhatsappE164: null,
        },
      ],
      classes: [
        {
          code: 'REFORMER',
          name: 'Reformer Pilates',
          slug: 'reformer-pilates',
          summary: 'Latihan seluruh tubuh dengan reformer.',
          description: 'Latihan terarah.',
          level: 'Semua level',
          durationMinutes: 50,
          equipment: ['Reformer'],
          benefits: ['Kekuatan'],
          heroImageKey: 'classes/reformer-pilates.png',
        },
        {
          code: 'MAT',
          name: 'Mat Pilates',
          slug: 'mat-pilates',
          summary: 'Gerak presisi di atas mat.',
          description: 'Bangun kontrol tubuh.',
          level: 'Semua level',
          durationMinutes: 50,
          equipment: ['Mat'],
          benefits: ['Kontrol'],
          heroImageKey: 'classes/mat-pilates.png',
        },
        {
          code: 'BARRE',
          name: 'Barre',
          slug: 'barre',
          summary: 'Latihan stabilitas dan daya tahan.',
          description: 'Gerak fungsional.',
          level: 'Pemula–menengah',
          durationMinutes: 50,
          equipment: ['Barre'],
          benefits: ['Stabilitas'],
          heroImageKey: 'landing/studio-showcase.png',
        },
      ],
      fallbackWhatsappE164: null,
    });
    const view = render(<PublicLanding />);

    expect(
      screen.getByRole('heading', {
        name: 'Stronger Body. Calmer Mind.',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Reformer Pilates' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Mat Pilates' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Barre' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Cadillac Pilates' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Customer Demo|Synthetic/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
    expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/register');
    expect(screen.getAllByRole('link', { name: 'See Packages' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Choose a Package' })).toHaveAttribute('href', '/packages');
    expect(
      screen.getByText('Prices and packages depend on where you train.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Use your active package to pick an available time.'),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'See Schedule' })).toHaveLength(2);
    screen.getAllByRole('link', { name: 'See Schedule' }).forEach((link) => {
      expect(link).toHaveAttribute('href', '/classes#schedule');
    });
    expect(view.container).not.toHaveTextContent(/trial class/i);
    // Seksi studio dan thumbnail kelas sudah dihapus; menu About tetap punya tujuan.
    expect(view.container.querySelector('[data-testid="studio-showcase"]')).toBeNull();
    expect(view.container.querySelector('#about')).not.toBeNull();
    expect(view.container.querySelectorAll('#popular-title ~ * img, ol img')).toHaveLength(0);
    expect((await axe(view.container)).violations).toHaveLength(0);
  }, 30_000);

  it('redirects authenticated customer from root (/) to member home (/account) - Tiket T-03', () => {
    mockSessionContext = {
      status: 'authenticated',
      session: {
        id: 'cust-1',
        roles: ['CUSTOMER'],
        capabilities: ['customer:self'],
      },
    };

    render(<PublicLanding />);
    expect(screen.getByText('Taking you to your member home…')).toBeInTheDocument();
    expect(mockReplace).toHaveBeenCalledWith('/account');
  });
});
