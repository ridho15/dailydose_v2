import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppFeedbackProvider } from '../components/app-feedback';
import { PublicContentManagementView as View } from './public-content-management-view';

const PublicContentManagementView = () => (
  <AppFeedbackProvider>
    <View />
  </AppFeedbackProvider>
);

vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} />,
}));
vi.mock('../session-context', () => ({
  useSessionContext: () => ({ session: { branches: [] } }),
}));

const slide = (id: string, title: string) => ({
  id,
  title,
  description: 'Deskripsi',
  imageSrc: '/images/public/landing/hero-pilates.png',
  active: true,
  order: 1,
});
const item = (overrides: Record<string, unknown>) => ({
  id: 'c1',
  contentKey: 'HOME_HERO_CAROUSEL',
  kind: 'HERO_CAROUSEL',
  branchId: null,
  locale: 'en-US',
  version: 1,
  status: 'PUBLISHED',
  payload: { autoplay: true, intervalMs: 6000, slides: [slide('s1', 'Slide Terbit')] },
  updatedAt: '2026-09-01T00:00:00Z',
  ...overrides,
});

describe('PublicContentManagementView', () => {
  const fetchMock = vi.fn();
  let items: unknown[];
  let failure: { status: number; body: unknown } | null;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchMock.mockReset();
    failure = null;
    items = [item({})];
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method && init.method !== 'GET' && failure)
        return { ok: false, status: failure.status, json: async () => failure!.body };
      return {
        ok: true,
        status: 200,
        json: async () => (init?.method && init.method !== 'GET' ? { id: 'c1' } : items),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  const writes = () => fetchMock.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET');

  it('saves the slider in place and shows it on the site right away', async () => {
    render(<PublicContentManagementView />);
    await screen.findByText(/Hero Carousel Beranda \(1 Slide\)/);
    await userEvent.click(screen.getByRole('button', { name: 'Simpan & Tampilkan di Website' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    const [url, init] = writes()[0]!;
    expect(url).toBe('/api/v1/public-content-management/HERO_CAROUSEL');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toMatchObject({
      payload: { slides: [expect.objectContaining({ title: 'Slide Terbit' })] },
    });
    expect(await screen.findByText(/Slider beranda tersimpan/)).toBeVisible();
    expect(screen.queryByText(/Draft|Draf|versi/i)).toBeNull();
  });

  it('can return the home page to the built-in slides after confirming', async () => {
    render(<PublicContentManagementView />);
    await screen.findByText(/Hero Carousel Beranda/);
    await userEvent.click(screen.getByRole('button', { name: 'Kembalikan ke Bawaan' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kembalikan' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]![0]).toBe('/api/v1/public-content-management/HERO_CAROUSEL/reset');
    expect(writes()[0]![1].method).toBe('POST');
  });

  it('offers no reset while the site still uses the built-in slides', async () => {
    items = [];
    render(<PublicContentManagementView />);
    await screen.findByText(/Hero Carousel Beranda/);
    expect(screen.queryByRole('button', { name: 'Kembalikan ke Bawaan' })).toBeNull();
  });

  it('loads the old Indonesian slides for translation without treating them as live', async () => {
    items = [item({ locale: 'id-ID' })];
    render(<PublicContentManagementView />);
    await screen.findByText(/Hero Carousel Beranda \(1 Slide\)/);
    expect(screen.getByText(/belum tampil di beranda/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Kembalikan ke Bawaan' })).toBeNull();
  });

  it('removes a slide only after the in-app confirmation, without the native browser dialog', async () => {
    const nativeConfirm = vi.fn(() => true);
    vi.stubGlobal('confirm', nativeConfirm);
    render(<PublicContentManagementView />);
    await screen.findByText(/Hero Carousel Beranda \(1 Slide\)/);

    await userEvent.click(screen.getByRole('button', { name: 'Hapus slide' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Batal' }));
    expect(screen.getByText(/Hero Carousel Beranda \(1 Slide\)/)).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Hapus slide' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus slide' }));
    expect(await screen.findByText(/Hero Carousel Beranda \(0 Slide\)/)).toBeVisible();
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  it('explains an unsafe link instead of a generic failure', async () => {
    failure = {
      status: 422,
      body: { error: { code: 'VALIDATION_ERROR', details: [{ field: 'slides[0].imageSrc', issue: 'UNSAFE_URL' }] } },
    };
    render(<PublicContentManagementView />);
    await screen.findByText(/Hero Carousel Beranda/);
    await userEvent.click(screen.getByRole('button', { name: 'Simpan & Tampilkan di Website' }));
    expect(await screen.findByText(/tidak aman/)).toBeVisible();
  });
});
