import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppFeedbackProvider } from '../app-feedback';
import { PublicExperience } from './public-experience';

const account = vi.hoisted(() => ({
  siteConfig: vi.fn(),
  profile: vi.fn(),
  updateProfile: vi.fn(),
}));

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('@/api-clients/account-client', async (original) => ({
  ...(await original<typeof import('@/api-clients/account-client')>()),
  accountClient: account,
}));
vi.mock('../../session-context', () => ({ useSessionContext: () => ({ session: null }) }));

const cabang = [
  { id: 'gg', name: 'Daily Dose Green Garden', nomor: '+6281211110001', area: 'Kedoya' },
  { id: 'mk', name: 'Daily Dose Muara Karang', nomor: null, area: 'Pluit' },
].map((c) => ({
  id: c.id,
  name: c.name,
  code: c.id.toUpperCase(),
  timezone: 'Asia/Jakarta',
  supportWhatsappE164: c.nomor,
  publicProfile: { area: c.area, city: 'Jakarta Barat' },
}));

describe('Tombol WhatsApp di beranda', () => {
  beforeEach(() => {
    account.siteConfig.mockResolvedValue({
      branches: cabang,
      fallbackWhatsappE164: '+6289500000000',
    });
  });

  it('membuka pilihan cabang di tempat, dan tiap cabang langsung ke WhatsApp-nya', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <AppFeedbackProvider>
        <PublicExperience>
          <p>Beranda</p>
        </PublicExperience>
      </AppFeedbackProvider>,
    );
    const tombol = await screen.findByRole('button', { name: 'Chat with Daily Dose on WhatsApp' });
    await user.click(tombol);

    const panel = screen.getByRole('region', { name: 'Chat with a studio' });
    const gg = within(panel).getByRole('link', { name: /Green Garden/ });
    expect(gg).toHaveAttribute('target', '_blank');
    expect(gg.getAttribute('href')).toContain('https://wa.me/6281211110001?text=');
    expect(decodeURIComponent(gg.getAttribute('href')!)).toContain('Hi Daily Dose Green Garden');
    // Cabang tanpa nomor sendiri memakai nomor pusat.
    expect(
      within(panel)
        .getByRole('link', { name: /Muara Karang/ })
        .getAttribute('href'),
    ).toContain('https://wa.me/6289500000000');
    expect(gg).toHaveFocus();
    expect((await axe(container)).violations).toHaveLength(0);

    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Chat with a studio' })).not.toBeInTheDocument(),
    );
    expect(tombol).toHaveFocus();
  });
});
