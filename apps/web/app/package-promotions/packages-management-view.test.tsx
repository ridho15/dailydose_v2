import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppFeedbackProvider } from '../components/app-feedback';
import { PackagesManagementView } from './packages-management-view';
import { browserPackagePromotionClient } from '@/api-clients/package-promotion-client';
import { browserMasterClient } from '@/api-clients/master-client';

const mockDeletability = vi.fn();
const mockRemove = vi.fn();
vi.mock('../api-clients/lifecycle-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api-clients/lifecycle-client')>();
  return {
    ...actual,
    lifecycleClient: {
      deletability: (...args: unknown[]) => mockDeletability(...args),
      remove: (...args: unknown[]) => mockRemove(...args),
      archive: vi.fn(),
    },
  };
});

const mockPush = vi.fn();
const mockReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/workspace/packages',
}));

vi.mock('../components/app-loading', () => ({
  useTrackedRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
  foregroundFetch: vi.fn(),
}));

vi.mock('../session-context', () => ({
  useSessionContext: () => ({
    status: 'authenticated',
    activeBranchId: 'branch-1',
    hasCapability: (cap: string) => true,
    session: {
      branches: [
        { id: 'branch-1', name: 'Studio Kebon Jeruk' },
        { id: 'branch-2', name: 'Studio Gading Serpong' },
      ],
    },
  }),
}));

    vi.mock('@/api-clients/package-promotion-client', () => ({
  browserPackagePromotionClient: {
    packages: vi.fn(),
    createPackage: vi.fn(),
    updatePackage: vi.fn(),
    revisePackage: vi.fn(),
    transitionPackage: vi.fn(),
  },
  promotionFailure: vi.fn((_, fallback) => Promise.resolve(fallback)),
}));

vi.mock('@/api-clients/master-client', () => ({
  browserMasterClient: {
    listClassTypes: vi.fn(),
  },
}));

describe('PackagesManagementView duplicate feature', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (browserPackagePromotionClient.packages as unknown as { mockResolvedValue(v: unknown): void }).mockResolvedValue({
      items: [
        {
          id: 'pkg-1',
          name: '10x Group Reformer',
          businessKey: 'PKG-10X-GROUP',
          sessionCount: 10,
          durationDays: 60,
          priceRp: 1500000,
          effectiveState: 'ACTIVE',
          effectiveFrom: '2026-01-01',
          effectiveUntil: '2026-12-31',
          isMultiBranch: true,
          branchScopes: [],
          classTypeScopes: [{ classTypeId: 'ct-reformer', active: true }],
        },
      ],
      summary: { ACTIVE: 1 },
      page: { hasMore: false, nextCursor: null },
    });
    (browserMasterClient.listClassTypes as unknown as { mockResolvedValue(v: unknown): void }).mockResolvedValue([
      {
        id: 'ct-reformer',
        name: 'Group Reformer',
        branchScopes: [
          { branchId: 'branch-1', active: true },
          { branchId: 'branch-2', active: true },
        ],
      },
    ]);
  });

  it('renders Duplikasi button and opens create form with pre-filled duplicate template', async () => {
    const user = userEvent.setup();
    render(
      <AppFeedbackProvider>
        <PackagesManagementView />
      </AppFeedbackProvider>,
    );

    expect((await screen.findAllByText('10x Group Reformer'))[0]).toBeInTheDocument();

    const actionMenu = screen.getAllByRole('button', { name: /Pilihan tindakan untuk 10x Group Reformer/i })[0]!;
    await user.click(actionMenu);

    const duplicateBtn = (await screen.findAllByRole('menuitem', { name: /Duplikasi/i }))[0]!;
    await user.click(duplicateBtn);

    expect(await screen.findByRole('heading', { name: 'Duplikasi paket' })).toBeInTheDocument();
    expect(screen.getByText(/Mode Duplikasi/i)).toBeInTheDocument();

    const nameInput = screen.getByLabelText('Nama paket') as HTMLInputElement;
    expect(nameInput.value).toBe('10x Group Reformer (Salinan)');

    const keyInput = screen.getByLabelText('Business key') as HTMLInputElement;
    expect(keyInput.value).toBe('PKG-10X-GROUP-copy');

    const sessionsInput = screen.getByLabelText('Jumlah sesi') as HTMLInputElement;
    expect(sessionsInput.value).toBe('10');

    const durationInput = screen.getByLabelText('Masa berlaku (hari)') as HTMLInputElement;
    expect(durationInput.value).toBe('60');

    const priceInput = screen.getByLabelText('Harga normal') as HTMLInputElement;
    expect(priceInput.value).toBe('1500000');

    const reasonInput = screen.getByLabelText(/^Alasan/) as HTMLInputElement;
    expect(reasonInput.value).toBe('Duplikasi dari paket 10x Group Reformer');
  });

  it('renders Edit button and opens EditPackageModal, submitting updates successfully', async () => {
    (browserPackagePromotionClient.updatePackage as unknown as { mockResolvedValue(v: unknown): void }).mockResolvedValue({
      id: 'pkg-1',
      name: '10x Group Reformer Updated',
      version: 1,
    });

    const user = userEvent.setup();
    render(
      <AppFeedbackProvider>
        <PackagesManagementView />
      </AppFeedbackProvider>,
    );

    expect((await screen.findAllByText('10x Group Reformer'))[0]).toBeInTheDocument();

    const actionMenu = screen.getAllByRole('button', { name: /Pilihan tindakan untuk 10x Group Reformer/i })[0]!;
    await user.click(actionMenu);

    const editBtn = (await screen.findAllByRole('menuitem', { name: /Edit/i }))[0]!;
    await user.click(editBtn);

    expect(await screen.findByRole('heading', { name: 'Ubah Paket: 10x Group Reformer' })).toBeInTheDocument();

    const nameInput = screen.getByLabelText('Nama paket') as HTMLInputElement;
    expect(nameInput.value).toBe('10x Group Reformer');

    const priceInput = screen.getByLabelText('Harga normal') as HTMLInputElement;
    expect(priceInput.value).toBe('1500000');

    const reasonInput = screen.getByLabelText('Alasan perubahan (Audit Log)') as HTMLInputElement;
    await user.type(reasonInput, 'Pembaruan nama paket kuartal 2');

    const submitBtn = screen.getByRole('button', { name: 'Simpan perubahan' });
    await user.click(submitBtn);

    // Confirm dialog button is the last one in DOM
    const confirmBtns = await screen.findAllByRole('button', { name: 'Simpan perubahan' });
    await user.click(confirmBtns[confirmBtns.length - 1]!);

    await waitFor(() => {
      expect(browserPackagePromotionClient.updatePackage).toHaveBeenCalledWith(
        'pkg-1',
        expect.objectContaining({
          name: '10x Group Reformer',
          reason: 'Pembaruan nama paket kuartal 2',
        }),
      );
    });
  });

  const openPackageMenu = async (itemName: RegExp) => {
    const user = userEvent.setup();
    render(
      <AppFeedbackProvider>
        <PackagesManagementView />
      </AppFeedbackProvider>,
    );
    expect((await screen.findAllByText('10x Group Reformer'))[0]).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: /Pilihan tindakan untuk 10x Group Reformer/i })[0]!);
    await user.click((await screen.findAllByRole('menuitem', { name: itemName }))[0]!);
    return user;
  };

  it('deletes a clean package only with a reason, after the server confirms nothing depends on it', async () => {
    mockDeletability.mockResolvedValue({ kind: 'package', id: 'pkg-1', deletable: true, blockers: [] });
    mockRemove.mockResolvedValue({ id: 'pkg-1', deleted: true });
    const user = await openPackageMenu(/Hapus/i);
    expect(await screen.findByRole('heading', { name: 'Hapus paket permanen?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hapus permanen' })).toBeDisabled();
    await user.type(screen.getByLabelText(/^Alasan/), 'Salah input paket');
    await user.click(screen.getByRole('button', { name: 'Hapus permanen' }));
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('package', 'pkg-1', 'Salah input paket'));
  });

  it('explains what blocks deleting a package that has purchases', async () => {
    mockDeletability.mockResolvedValue({
      kind: 'package',
      id: 'pkg-1',
      deletable: false,
      blockers: [{ kind: 'pembelian', label: 'pembelian', count: 4 }],
    });
    await openPackageMenu(/Hapus/i);
    expect(await screen.findByText('Paket belum dapat dihapus')).toBeInTheDocument();
    expect(screen.getByText('Pembelian')).toBeInTheDocument();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('deactivates a package with a typed reason and no invented default', async () => {
    (browserPackagePromotionClient.transitionPackage as unknown as { mockResolvedValue(v: unknown): void }).mockResolvedValue({});
    const user = await openPackageMenu(/^Nonaktifkan$/);
    await user.type(await screen.findByLabelText(/^Alasan/), 'Paket tidak dijual lagi');
    await user.click(screen.getByRole('button', { name: 'Nonaktifkan' }));
    await waitFor(() =>
      expect(browserPackagePromotionClient.transitionPackage).toHaveBeenCalledWith(
        'pkg-1',
        'deactivate',
        undefined, // fixture tanpa versi
        'Paket tidak dijual lagi',
      ),
    );
  });
  it('generates a business key automatically when clicking Generate Otomatis button', async () => {
    const user = userEvent.setup();
    render(
      <AppFeedbackProvider>
        <PackagesManagementView />
      </AppFeedbackProvider>,
    );
    await user.click(await screen.findByRole('button', { name: /Buat paket/i }));
    const generateBtn = await screen.findByRole('button', { name: /Generate Otomatis/i });
    expect(generateBtn).toBeInTheDocument();
    await user.click(generateBtn);
    const input = screen.getByPlaceholderText('Contoh: PKG-10X-GROUP') as HTMLInputElement;
    expect(input.value).toMatch(/^PKG-[A-Z0-9]+-[A-Z0-9]{4}$/);
  });
});
