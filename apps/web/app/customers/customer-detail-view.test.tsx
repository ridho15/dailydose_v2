import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { customerClient } from './customer-client';
import { CustomerDetailView } from './[id]/customer-detail-view';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/customers/c1',
  useSearchParams: () => new URLSearchParams(),
}));
const caps = vi.hoisted(() => ({ allow: false }));
vi.mock('../session-context', () => ({
  useSessionContext: () => ({
    session: { branches: [], roles: ['SUPER_OWNER'], globalCapabilities: ['customer:impersonate'] },
    hasCapability: () => caps.allow,
    activeBranch: null,
  }),
}));

const detail = {
  id: 'c1',
  displayName: 'Dewi',
  email: 'dewi@example.test',
  phoneE164: '+628123456789',
  status: 'ACTIVE',
  stoppedAt: null,
  preferredBranch: null,
  profile: null,
  verificationStatus: 'ACTION_REQUIRED',
  createdAt: '2026-10-01T00:00:00.000Z',
  identities: [],
  identityDocuments: [],
  passwordCredential: null,
  purchases: [],
  customerBookings: [],
  voucherRedemptions: [],
  notifications: [],
  customerPackages: [
    { id: 'p1', status: 'EXPIRED', remainingSessions: 0, usedSessions: 4, package: { name: 'Paket lama' } },
    { id: 'p2', status: 'FROZEN', remainingSessions: 6, usedSessions: 2, package: { name: 'Belum dibayar' } },
  ],
  _count: { purchases: 0, customerBookings: 0, customerPackages: 2, voucherRedemptions: 0, notifications: 0 },
};

describe('CustomerDetailView konsistensi status', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    caps.allow = false;
    vi.spyOn(customerClient, 'detail').mockResolvedValue(detail as never);
  });

  it('menghitung hanya paket yang benar-benar aktif pada tab paket', async () => {
    render(<CustomerDetailView id="c1" />);
    expect(await screen.findByRole('button', { name: /Paket & Sesi \(0 aktif\)/ })).toBeVisible();
    expect(screen.getByText('Pelanggan belum memiliki paket aktif saat ini.')).toBeVisible();
  });

  it('memberi label jelas pada status akun dan status verifikasi', async () => {
    render(<CustomerDetailView id="c1" />);
    expect(await screen.findByText(/Status Akun:\s*AKTIF/i)).toBeVisible();
    expect(screen.getAllByText(/Verifikasi Identitas:\s*BELUM ADA SELFIE/i).length).toBeGreaterThan(0);
  });

  it('tidak menghitung paket dengan status ACTIVE jika remainingSessions 0', async () => {
    vi.spyOn(customerClient, 'detail').mockResolvedValue({
      ...detail,
      customerPackages: [
        { id: 'p3', status: 'ACTIVE', remainingSessions: 0, usedSessions: 8, package: { name: 'Paket Habis' } },
      ],
    } as never);
    render(<CustomerDetailView id="c1" />);
    expect(await screen.findByRole('button', { name: /Paket & Sesi \(0 aktif\)/ })).toBeVisible();
    expect(screen.getByText('Pelanggan belum memiliki paket aktif saat ini.')).toBeVisible();
  });
});

describe('CustomerDetailView nonaktifkan akun', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    caps.allow = true;
    vi.spyOn(customerClient, 'detail').mockResolvedValue(detail as never);
  });

  it('menolak menonaktifkan tanpa alasan dan mengirim alasan yang diketik (tanpa alasan bawaan)', async () => {
    const setStatus = vi.spyOn(customerClient, 'setStatus').mockResolvedValue({ id: 'c1', status: 'INACTIVE', version: 3 });
    const user = userEvent.setup();
    render(<CustomerDetailView id="c1" />);
    await user.click(await screen.findByRole('button', { name: /Ubah Status/i }));
    const dialog = await screen.findByRole('dialog');
    const reason = within(dialog).getByLabelText('Alasan menonaktifkan');
    expect(reason).toBeRequired();
    await user.click(within(dialog).getByRole('button', { name: 'Nonaktifkan Pelanggan' }));
    expect(setStatus).not.toHaveBeenCalled();

    await user.type(reason, 'Permintaan member');
    await user.click(within(dialog).getByRole('button', { name: 'Nonaktifkan Pelanggan' }));
    await waitFor(() => expect(setStatus).toHaveBeenCalledTimes(1));
    expect(setStatus.mock.calls[0]![1]).toBe('deactivate');
    expect(setStatus.mock.calls[0]![2]).toMatchObject({ reason: 'Permintaan member' });
  });
});

describe('CustomerDetailView contact masking (option D)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    caps.allow = true;
  });

  it('explains the masking and hides every change action for a customer outside the staff branch', async () => {
    vi.spyOn(customerClient, 'detail').mockResolvedValue({ ...detail, contactMasked: true, email: 'de***@example.test' } as never);
    render(<CustomerDetailView id="c1" />);
    expect(await screen.findByText(/belum berkaitan dengan cabang Anda/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /Ubah Status/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit/i })).not.toBeInTheDocument();
  });
});

describe('CustomerDetailView impersonation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    caps.allow = true;
  });

  it('allows Super Owner to open impersonate modal and enter customer portal', async () => {
    vi.spyOn(customerClient, 'detail').mockResolvedValue(detail as never);
    const impSpy = vi.spyOn(customerClient, 'impersonate').mockResolvedValue({ channel: 'WEB', user: {} } as never);
    render(<CustomerDetailView id="c1" />);
    const impBtn = await screen.findByRole('button', { name: /Login sebagai Pelanggan/i });
    expect(impBtn).toBeVisible();

    const user = userEvent.setup();
    await user.click(impBtn);

    expect(await screen.findByText(/Masuk sebagai Dewi/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Masuk Sekarang' }));
    expect(impSpy).toHaveBeenCalledWith('c1');
  });
});

