import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomerSessionDetailView } from '@/ledger/[customerPackageId]/customer-session-detail-view';

const detail = vi.hoisted(() => vi.fn());
const manage = vi.hoisted(() => vi.fn());
const capabilities = vi.hoisted(() => ({ current: ['ledger:read', 'customer-package:manage'] as string[] }));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/api-clients/ledger-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api-clients/ledger-client')>()),
  browserLedgerClient: { detail },
  manageCustomerPackage: manage,
}));
vi.mock('@/session-context', () => ({
  useSessionContext: () => ({ hasCapability: (...required: string[]) => required.some((c) => capabilities.current.includes(c)) }),
}));

const history = (status: string, overrides: Record<string, unknown> = {}) => ({
  balance: {
    id: 'pkg-1',
    branchId: 'branch-1',
    status,
    activationDate: new Date('2026-01-01'),
    expiryAt: new Date('2026-12-31T00:00:00Z'),
    ledgerBalance: 4,
    reserved: 0,
    available: 4,
    packageName: 'Paket 8 Sesi',
    branchName: 'Green Garden',
    classTypeName: 'Reformer',
    customer: { id: 'customer-1', displayName: 'Maya', phoneMasked: null },
    ...overrides,
  },
  reservations: { activeQuantity: 0, items: [] },
  entries: [],
  nextCursor: null,
  previousCursor: null,
});

beforeEach(() => {
  detail.mockReset();
  manage.mockReset().mockResolvedValue({});
  capabilities.current = ['ledger:read', 'customer-package:manage'];
});

describe('customer package actions panel', () => {
  it('offers extend and freeze for an active package and sends reason, days and the loaded expiry', async () => {
    detail.mockResolvedValue(history('ACTIVE'));
    const user = userEvent.setup();
    render(<CustomerSessionDetailView id="pkg-1" />);
    await user.click(await screen.findByRole('button', { name: 'Perpanjang masa berlaku' }));
    expect(screen.getByRole('button', { name: 'Bekukan paket' })).toBeVisible();
    const dialog = screen.getByRole('dialog', { name: 'Perpanjang masa berlaku paket' });
    const confirm = within(dialog).getByRole('button', { name: 'Perpanjang' });
    expect(confirm).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: '+14 hari' }));
    await user.type(within(dialog).getByLabelText('Alasan'), 'Kompensasi kelas ditiadakan');
    await user.click(confirm);
    await waitFor(() => expect(manage).toHaveBeenCalledTimes(1));
    expect(manage).toHaveBeenCalledWith('pkg-1', 'extend', expect.objectContaining({
      reason: 'Kompensasi kelas ditiadakan',
      expectedValidUntil: '2026-12-31T00:00:00.000Z',
    }));
    expect(await screen.findByText('Masa berlaku paket diperpanjang.')).toBeVisible();
  });

  it('shows only "Buka kembali" for a frozen package and explains the failure in Indonesian', async () => {
    detail.mockResolvedValue(history('FROZEN'));
    manage.mockRejectedValue({ status: 409, data: { code: 'PACKAGE_CHANGED' } });
    const user = userEvent.setup();
    render(<CustomerSessionDetailView id="pkg-1" />);
    await user.click(await screen.findByRole('button', { name: 'Buka kembali paket' }));
    expect(screen.queryByRole('button', { name: 'Bekukan paket' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Perpanjang masa berlaku' })).toBeNull();
    const dialog = screen.getByRole('dialog', { name: 'Buka kembali paket pelanggan?' });
    await user.type(within(dialog).getByLabelText('Alasan'), 'Pelanggan sudah sembuh');
    await user.click(within(dialog).getByRole('button', { name: 'Buka kembali' }));
    expect(
      await within(dialog).findByText('Paket berubah sejak halaman dimuat. Perbarui halaman lalu ulangi.'),
    ).toBeVisible();
  });

  it('hides every action without customer-package:manage', async () => {
    capabilities.current = ['ledger:read'];
    detail.mockResolvedValue(history('ACTIVE'));
    render(<CustomerSessionDetailView id="pkg-1" />);
    await screen.findByText('Status paket');
    expect(screen.queryByRole('button', { name: 'Bekukan paket' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Perpanjang masa berlaku' })).toBeNull();
  });
  it("menampilkan panel transparansi pemakaian paket bersama lengkap dengan riwayat utilisasi per anggota", async () => {
    detail.mockResolvedValue({
      ...history("ACTIVE", { isShareable: true }),
      sharedUtilization: [
        {
          userId: "owner-1",
          displayName: "Maya Owner",
          phoneMasked: "0812****",
          role: "OWNER",
          relationship: "Pemilik Utama",
          activeBookings: 1,
          attendedSessions: 3,
          totalBookings: 4,
        },
        {
          userId: "friend-1",
          displayName: "Budi Teman",
          phoneMasked: "0813****",
          role: "MEMBER",
          relationship: "Teman / Rekan",
          activeBookings: 0,
          attendedSessions: 2,
          totalBookings: 2,
        },
      ],
      reservations: {
        activeQuantity: 1,
        items: [
          {
            id: "res-1",
            quantity: 1,
            createdAt: new Date(),
            className: "Reformer Core",
            branchName: "Green Garden",
            bookedByUser: {
              id: "owner-1",
              displayName: "Maya Owner",
              phoneMasked: "0812****",
              isOwner: true,
            },
          },
        ],
      },
      entries: [
        {
          id: "ent-1",
          type: "ATTEND",
          quantity: -1,
          occurredAt: new Date(),
          referenceLabel: "Check-in Reformer",
          usedByUser: {
            id: "friend-1",
            displayName: "Budi Teman",
            phoneMasked: "0813****",
            isOwner: false,
          },
        },
      ],
    });

    render(<CustomerSessionDetailView id="pkg-1" />);

    expect(await screen.findByText("Transparansi Riwayat Pemakaian Paket Bersama")).toBeInTheDocument();
    expect(screen.getByText("Maya Owner")).toBeInTheDocument();
    expect(screen.getByText("Budi Teman")).toBeInTheDocument();
    expect(screen.getByText("3 sesi")).toBeInTheDocument();
    expect(screen.getByText("2 sesi")).toBeInTheDocument();
    expect(screen.getByText(/Dipesan oleh: Maya Owner/)).toBeInTheDocument();
    expect(screen.getByText(/Digunakan oleh: Budi Teman/)).toBeInTheDocument();
  });
});
