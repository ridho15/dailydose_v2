import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppFeedbackProvider } from '../components/app-feedback';
import { BranchDetailView } from './branch-detail-view';

const cabang = vi.hoisted(() => ({ detail: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/workspace/branches/dd-gg',
}));
vi.mock('@/api-clients/branch-client', async (original) => ({
  ...(await original<typeof import('@/api-clients/branch-client')>()),
  browserBranchClient: cabang,
}));
vi.mock('../session-context', async (original) => ({
  ...(await original<typeof import('../session-context')>()),
  useSessionContext: () => ({ status: 'authenticated', hasCapability: () => true }),
  useActiveBranchState: () => ['dd-gg', vi.fn()],
}));

describe('Foto cabang', () => {
  beforeEach(() => {
    cabang.detail.mockResolvedValue({
      id: 'dd-gg',
      code: 'GG',
      name: 'Daily Dose Green Garden',
      timezone: 'Asia/Jakarta',
      active: true,
      archivedAt: null,
      heroImageKey: 'branches/green-garden.png',
      publicProfile: null,
      auditActivity: [],
      dependencies: {
        staff: 3,
        futureClasses: 10,
        packages: 4,
        paymentAccounts: 1,
        assignments: 3,
        classTypes: 4,
      },
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            branch: {
              publicProfile: {
                slug: 'green-garden',
                area: 'Kedoya',
                city: 'Jakarta Barat',
                address: 'Jl. Green Garden',
                description: 'Studio',
                openingHours: [],
                amenities: [],
                arrivalInformation: null,
                parkingInformation: null,
                heroImageKey: 'branches/green-garden.png',
                galleryImageKeys: [],
                version: 1,
              },
            },
            assetKeys: [],
            items: [],
            page: { hasMore: false, nextCursor: null },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
    );
  });

  it('tombol Ganti foto di banner membuka form foto yang sama dengan halaman Lokasi', async () => {
    const user = userEvent.setup();
    render(
      <AppFeedbackProvider>
        <BranchDetailView id="dd-gg" />
      </AppFeedbackProvider>,
    );
    await user.click(await screen.findByRole('button', { name: 'Ganti foto' }));
    const laci = await screen.findByRole('dialog', {
      name: 'Edit Profil Publik: Daily Dose Green Garden',
    });
    expect(await within(laci).findByText(/halaman Lokasi publik/)).toBeInTheDocument();
  });
});
