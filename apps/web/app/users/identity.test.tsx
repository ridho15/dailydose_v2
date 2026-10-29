import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { SignInView } from '@/sign-in/sign-in-view';
import { UsersView } from '@/users/users-view';
import { UserDetailView } from '@/users/[id]/user-detail-view';
import type { IdentityClient } from '@/api-clients/identity-client';
import { AssignmentsView } from '@/assignments/assignments-view';
import type { AssignmentClient } from '@/api-clients/assignment-client';
import { MasterView } from '@/master/master-view';
import type { MasterClient } from '@/api-clients/master-client';
import { ActivateAccountView } from '@/activate-account/activate-account-view';
import { ForgotPasswordView } from '@/forgot-password/forgot-password-view';
import { ResetPasswordView } from '@/reset-password/reset-password-view';
import { SecurityView } from '@/account/security/security-view';
import { AuditView } from '@/audit/audit-view';
import { RolePermissionsView } from '@/users/roles-permissions/role-permissions-view';
import { AppFeedbackProvider } from '@/components/app-feedback';
import type { AccessClient } from '@/api-clients/access-client';
import type { LedgerClient } from '@/api-clients/ledger-client';

const client = (overrides: Partial<IdentityClient> = {}): IdentityClient => ({
  signIn: vi.fn().mockResolvedValue(undefined),
  signInWithPassword: vi.fn().mockResolvedValue(undefined),
  signInWithGoogleToken: vi.fn().mockResolvedValue(undefined),
  activatePassword: vi.fn().mockResolvedValue(undefined),
  requestPasswordReset: vi.fn().mockResolvedValue(undefined),
  resetPassword: vi.fn().mockResolvedValue(undefined),
  securityStatus: vi.fn().mockResolvedValue({
    passwordEnabled: true,
    passwordChangedAt: null,
  }),
  changePassword: vi.fn().mockResolvedValue(undefined),
  listUsers: vi.fn().mockResolvedValue({
    items: [],
    page: { nextCursor: null, hasMore: false },
    summary: { total: 0, active: 0, pendingActivation: 0, inactive: 0 },
  }),
  lookupUsers: vi.fn().mockResolvedValue({ items: [], page: { nextCursor: null, hasMore: false } }),
  createAuditExport: vi.fn(),
  getAuditExport: vi.fn(),
  authorizeAuditExport: vi.fn(),
  getUser: vi.fn(),
  getUserIdentityVerification: vi.fn(),
  updateProfile: vi.fn(),
  roleCatalog: vi.fn().mockResolvedValue([
    {
      role: 'FINANCE',
      capabilities: ['user:read'],
      assignable: true,
      readOnly: false,
      scope: 'GLOBAL',
    },
  ]),
  listAudit: vi.fn().mockResolvedValue([]),
  listAuditLogs: vi.fn().mockResolvedValue({
    items: [],
    page: { nextCursor: null, hasMore: false },
  }),
  invite: vi.fn().mockResolvedValue('CREATED'),
  requestPasswordSetup: vi.fn().mockResolvedValue(undefined),
  resetPasswordDirect: vi.fn().mockResolvedValue(undefined),
  updateRoles: vi.fn(),
  deactivate: vi.fn().mockResolvedValue(undefined),
  reactivate: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

const accessClient = (overrides: Partial<AccessClient> = {}): AccessClient => ({
  listCapabilities: vi.fn().mockResolvedValue([
    {
      key: 'user:read',
      label: 'Lihat user',
      description: 'Melihat user dalam scope.',
      category: 'USER',
      sensitive: false,
      active: true,
      systemOnly: false,
    },
    {
      key: 'ledger:adjust:decide',
      label: 'Putuskan adjustment sesi',
      description: 'Menyetujui atau menolak adjustment.',
      category: 'LEDGER',
      sensitive: true,
      active: true,
      systemOnly: false,
    },
  ]),
  listRoles: vi.fn().mockResolvedValue([
    {
      id: 'role-manager',
      code: 'MANAGER',
      displayName: 'Manager',
      description: 'Manager cabang.',
      scope: 'BRANCH',
      systemRole: 'MANAGER',
      system: true,
      protected: true,
      active: true,
      version: 1,
      affectedUsers: 2,
      capabilities: [
        {
          key: 'user:read',
          label: 'Lihat user',
          category: 'USER',
          sensitive: false,
          systemOnly: false,
        },
      ],
      createdAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-28T00:00:00.000Z',
    },
  ]),
  getUserAccess: vi.fn(),
  replaceUserRoles: vi.fn(),
  ...overrides,
});

describe('identity UI', () => {
  it('renders an accessible sign-in success and safe failure', async () => {
    const view = render(<SignInView client={client()} />);
    expect((await axe(view.container)).violations).toHaveLength(0);
    await userEvent.type(screen.getByLabelText(/Email/i), 'owner@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-password-123');
    await userEvent.click(screen.getByRole('button', { name: /Masuk ke Akun/ }));
    expect(await screen.findByText('Identitas terverifikasi.')).toBeVisible();
    view.unmount();
    render(
      <SignInView
        client={client({
          signInWithPassword: vi.fn().mockRejectedValue({ response: { status: 429 } }),
        })}
      />,
    );
    await userEvent.type(screen.getByLabelText(/Email/i), 'owner@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'incorrect-password');
    await userEvent.click(screen.getByRole('button', { name: /Masuk ke Akun/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Terlalu banyak');
  });

  it('describes sign-in as email, username or WhatsApp number and offers a single register link', () => {
    render(<SignInView client={client()} />);
    expect(screen.getByText(/email, username, atau nomor WhatsApp yang terdaftar/i)).toBeVisible();
    expect(screen.queryByText(/Gunakan email dan password/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Belum punya akun\?/)).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: /Daftar akun/ })).toHaveLength(1);
  });

  it('holds the sign-in submit until hydration so credentials can never be posted into the URL', async () => {
    const { renderToString } = await import('react-dom/server');
    const html = renderToString(<SignInView client={client()} />);
    const submit = html.match(/<button[^>]*type="submit"[^>]*>/)?.[0] ?? '';
    expect(submit).toContain('disabled');
    expect(html).toContain('method="post"');
    for (const view of [
      <ResetPasswordView key="reset" client={client()} />,
      <ActivateAccountView key="activate" client={client()} />,
    ]) {
      expect(renderToString(view)).toContain('method="post"');
    }
  });

  it('shows a safe correlation reference for internal authentication failures', async () => {
    render(
      <SignInView
        client={client({
          signInWithPassword: vi.fn().mockRejectedValue({
            response: { status: 500 },
            code: 'INTERNAL_ERROR',
            correlationId: 'auth-reference-456',
          }),
        })}
      />,
    );
    await userEvent.type(screen.getByLabelText(/Email/i), 'owner@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-password-123');
    await userEvent.click(screen.getByRole('button', { name: /Masuk ke Akun/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Layanan masuk sedang mengalami gangguan. Kode bantuan: auth-reference-456.',
    );
  });

  it('supports password visibility without exposing synthetic environment controls', async () => {
    const fake = client();
    render(<SignInView client={fake} />);
    const password = screen.getByLabelText('Password');
    expect(password).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Lihat' }));
    expect(password).toHaveAttribute('type', 'text');
    expect(screen.queryByText(/synthetic non-production/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Email Google synthetic/i)).not.toBeInTheDocument();
    // Tombol Google boleh tampil; yang tidak boleh adalah teks konfigurasi teknis.
    expect(screen.queryByText(/konfigurasi|production|client ID/i)).not.toBeInTheDocument();
  });

  it('supports authoritative invite and links every user to a dedicated detail route', async () => {
    const user = {
      id: 'user-1',
      displayName: 'Staff Finance',
      status: 'ACTIVE' as const,
      version: 1,
      createdAt: '2026-07-23T00:00:00.000Z',
      updatedAt: '2026-07-23T00:00:00.000Z',
      roles: [],
      directRoles: [],
      assignmentRoles: [],
      effectiveCapabilities: [],
    };
    const fake = client({
      listUsers: vi.fn().mockResolvedValue({
        items: [user],
        page: { nextCursor: null, hasMore: false },
        summary: { total: 1, active: 1, pendingActivation: 0, inactive: 0 },
      }),
      getUser: vi.fn().mockResolvedValue(user),
    });
    render(
      <UsersView client={fake} capabilitiesOverride={['user:read', 'user:admin', 'audit:read']} />,
    );
    expect((await screen.findAllByText('Staff Finance'))[0]).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Buat pengguna internal' }));
    await userEvent.type(screen.getByLabelText('Nama Lengkap'), 'Staff Baru');
    await userEvent.type(screen.getByLabelText('Alamat Email'), 'staff@example.test');
    await userEvent.click(screen.getByRole('checkbox', { name: /Finance/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Simpan Pengguna & Aktifkan' }));
    expect(await screen.findByRole('status')).toHaveTextContent('berhasil');
    expect(fake.invite).toHaveBeenCalledWith(
      'staff@example.test',
      'Staff Baru',
      [{ role: 'FINANCE', branchId: null }],
      { password: undefined, phone: undefined },
    );
    expect(screen.getAllByRole('link', { name: 'Staff Finance' })[0]).toHaveAttribute(
      'href',
      '/users/user-1',
    );
  });

  it('keeps customer management separate from the internal user list', async () => {
    const customer = {
      id: 'customer-1',
      displayName: 'Ayu Customer',
      phoneE164: null,
      status: 'ACTIVE' as const,
      audience: 'CUSTOMER' as const,
      version: 1,
      createdAt: '2026-07-23T00:00:00.000Z',
      updatedAt: '2026-07-23T00:00:00.000Z',
      roles: [],
      directRoles: [],
      assignmentRoles: [],
      effectiveCapabilities: [],
      identityVerification: {
        status: 'ACTION_REQUIRED' as const,
        documents: [
          {
            kind: 'SELFIE' as const,
            status: 'REJECTED',
            uploadStatus: 'FINALIZED',
            scanStatus: 'CLEAN',
            rejectionReasonCode: 'BLURRY',
            uploadedAt: '2026-07-23T00:00:00.000Z',
            reviewedAt: null,
            updatedAt: '2026-07-23T00:00:00.000Z',
          },
        ],
      },
    };
    const listUsers = vi.fn().mockResolvedValue({
      items: [customer],
      page: { nextCursor: null, hasMore: false },
      summary: { total: 1, active: 1, pendingActivation: 0, inactive: 0 },
    });
    render(
      <UsersView
        client={client({ listUsers })}
        capabilitiesOverride={['branch:all', 'user:read', 'identity-verification:read']}
      />,
    );
    await waitFor(() =>
      expect(listUsers).toHaveBeenLastCalledWith(expect.objectContaining({ audience: 'STAFF' })),
    );
    expect(screen.queryByRole('tab', { name: 'Customer' })).not.toBeInTheDocument();
    expect(screen.getByText(/Pelanggan dikelola lewat Data Pelanggan/)).toBeVisible();
  });

  it('shows customer identity metadata without loading images on the user detail page', async () => {
    const customer = {
      id: 'customer-1',
      displayName: 'Ayu Customer',
      phoneE164: null,
      status: 'ACTIVE' as const,
      audience: 'CUSTOMER' as const,
      version: 1,
      createdAt: '2026-07-23T00:00:00.000Z',
      updatedAt: '2026-07-23T00:00:00.000Z',
      roles: [],
      directRoles: [],
      assignmentRoles: [],
      effectiveCapabilities: [],
    };
    const fake = client({
      getUser: vi.fn().mockResolvedValue(customer),
      getUserIdentityVerification: vi.fn().mockResolvedValue({
        id: customer.id,
        user: {
          id: customer.id,
          displayName: customer.displayName,
          phoneMasked: '+628*****6789',
          status: customer.status,
        },
        verificationStatus: 'PENDING',
        oldestAt: '2026-07-23T00:00:00.000Z',
        documents: [
          {
            id: 'document-selfie',
            kind: 'SELFIE',
            status: 'PENDING',
            uploadStatus: 'FINALIZED',
            scanStatus: 'CLEAN',
            fileName: 'selfie.png',
            mimeType: 'image/png',
            sizeBytes: 1024,
            rejectionReasonCode: null,
            rejectionNote: null,
            reviewedAt: null,
            deletedAt: null,
            version: 1,
          },
        ],
      }),
    });
    const view = render(
      <UserDetailView
        id={customer.id}
        client={fake}
        ledgerClient={
          {
            list: vi.fn().mockResolvedValue({
              items: [
                {
                  id: 'customer-package-1',
                  branchId: 'branch-1',
                  status: 'ACTIVE',
                  activationDate: new Date('2026-07-01'),
                  expiryAt: new Date('2026-10-01'),
                  ledgerBalance: 8,
                  reserved: 1,
                  available: 7,
                  sessionCountSnapshot: 10,
                  usage: {
                    initialSessions: 10,
                    usedSessions: 2,
                    reversedSessions: 0,
                    adjustmentDelta: 0,
                  },
                  packageName: 'Reformer 10',
                  branchName: 'Daily Dose BSD',
                  classTypeName: 'Reformer',
                },
              ],
              summary: { packageCount: 1, ledgerBalance: 8, reserved: 1, available: 7 },
              nextCursor: null,
            }),
          } as unknown as LedgerClient
        }
        capabilitiesOverride={[
          'branch:all',
          'user:read',
          'identity-verification:read',
          'ledger:read',
        ]}
      />,
    );
    expect(await screen.findByRole('heading', { name: 'Verifikasi Identitas' })).toBeVisible();
    expect(screen.getByText('PENDING · FINALIZED · CLEAN')).toBeVisible();
    expect(screen.getByRole('link', { name: /Periksa dokumen/ })).toHaveAttribute(
      'href',
      '/identity-verifications?customerUserId=customer-1',
    );
    expect(view.container.querySelector('img')).toBeNull();
    expect(await screen.findByRole('heading', { name: 'Paket & Sesi' })).toBeVisible();
    expect(screen.getByText('7')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Lihat detail' })).toHaveAttribute(
      'href',
      '/ledger/customer-package-1',
    );
    expect(screen.queryByRole('button', { name: 'Nonaktifkan' })).not.toBeInTheDocument();
  });

  it('manages lifecycle from the dedicated user detail page', async () => {
    window.history.replaceState({}, '', '/users/user-1');
    const user = {
      id: 'user-1',
      displayName: 'Staff Finance',
      phoneE164: null,
      status: 'ACTIVE' as const,
      version: 1,
      createdAt: '2026-07-23T00:00:00.000Z',
      updatedAt: '2026-07-23T00:00:00.000Z',
      roles: [],
      directRoles: [],
      assignmentRoles: [],
      effectiveCapabilities: [],
    };
    const fake = client({ getUser: vi.fn().mockResolvedValue(user) });
    render(
      <UserDetailView
        id="user-1"
        client={fake}
        capabilitiesOverride={['user:read', 'user:admin', 'audit:read']}
      />,
    );
    expect(await screen.findByRole('heading', { name: 'Staff Finance' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Nonaktifkan' }));
    const confirm = screen.getByRole('button', { name: 'Konfirmasi Nonaktifkan' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Alasan'), 'Cuti panjang');
    await userEvent.click(confirm);
    expect(await screen.findByRole('status')).toHaveTextContent('dinonaktifkan');
    expect(fake.deactivate).toHaveBeenCalledWith('user-1', 1, 'Cuti panjang');
  });

  it('asks for a reason before saving a role change and sends it (no invented default)', async () => {
    window.history.replaceState({}, '', '/users/user-2?action=roles');
    const user = {
      id: 'user-2',
      displayName: 'Staff Finance',
      phoneE164: null,
      status: 'ACTIVE' as const,
      version: 3,
      createdAt: '2026-07-23T00:00:00.000Z',
      updatedAt: '2026-07-23T00:00:00.000Z',
      roles: [{ role: 'FINANCE' as const, branchId: null }],
      directRoles: [{ role: 'FINANCE' as const, branchId: null }],
      assignmentRoles: [],
      effectiveCapabilities: [],
    };
    const fake = client({
      getUser: vi.fn().mockResolvedValue(user),
      roleCatalog: vi.fn().mockResolvedValue([
        { role: 'FINANCE', capabilities: ['user:read'], assignable: true, readOnly: false, scope: 'GLOBAL' },
      ]),
      updateRoles: vi.fn().mockResolvedValue(user),
    });
    render(
      <UserDetailView
        id="user-2"
        client={fake}
        capabilitiesOverride={['user:read', 'user:admin', 'audit:read']}
      />,
    );
    const save = await screen.findByRole('button', { name: 'Simpan Perubahan Role' });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Alasan perubahan role'), 'Pindah divisi');
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() =>
      expect(fake.updateRoles).toHaveBeenCalledWith(
        'user-2',
        [{ role: 'FINANCE', branchId: null }],
        3,
        'Pindah divisi',
      ),
    );
    window.history.replaceState({}, '', '/');
  });

  it('defaults user mutations to deny and exposes searchable dynamic role management', async () => {
    const fake = client({
      roleCatalog: vi.fn().mockResolvedValue([
        {
          role: 'FINANCE',
          capabilities: ['user:read', 'finance:reconcile'],
          assignable: true,
          readOnly: false,
          scope: 'GLOBAL',
        },
        {
          role: 'MANAGER',
          capabilities: ['user:read', 'ledger:adjust:decide'],
          assignable: true,
          readOnly: false,
          scope: 'BRANCH',
        },
      ]),
    });
    const users = render(<UsersView client={fake} />);
    await screen.findByText('Total pengguna');
    expect(
      screen.queryByRole('button', { name: 'Buat pengguna internal' }),
    ).not.toBeInTheDocument();
    users.unmount();

    const dynamicAccess = accessClient();
    const matrix = render(
      <AppFeedbackProvider>
        <RolePermissionsView
          identityClient={fake}
          accessClient={dynamicAccess}
          masterClient={masterClient()}
        />
      </AppFeedbackProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Peran & Hak Akses' })).toBeVisible();
    expect(await screen.findByText('Manager cabang.')).toBeVisible();
    // Peran/izin ditetapkan sistem: tidak ada aksi buat/duplikasi peran khusus, dan jelas hanya-baca.
    expect(screen.getByText('Peran bawaan sistem (hanya baca)')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Buat' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Duplikasi' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Daftar pengguna/ })).toHaveAttribute('href', '/users');
    expect(screen.getByRole('tab', { name: /Role & Izin/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.queryAllByRole('checkbox', { name: /user:read/ })).toHaveLength(0);
    await userEvent.type(screen.getByLabelText('Cari izin'), 'user');
    expect(screen.getByText('user:read')).toBeVisible();
    expect(screen.queryByText('ledger:adjust:decide')).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Cari izin'));
    await userEvent.type(screen.getByLabelText('Cari izin'), 'tidak-ada');
    expect(screen.queryByText('user:read')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /Akses Pengguna/ }));
    expect(screen.getByRole('tab', { name: /Akses Pengguna/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByLabelText('Cari pengguna')).toBeVisible();
    expect(window.location.search).toContain('tab=users');
    expect((await axe(matrix.container)).violations).toHaveLength(0);
    window.history.replaceState({}, '', '/');
  });

  it('filters the masked global access audit without exposing credential data', async () => {
    const fake = client({
      listAuditLogs: vi.fn().mockResolvedValue({
        items: [
          {
            id: 'audit-1',
            occurredAt: '2026-07-26T08:00:00.000Z',
            action: 'security.user_roles_changed',
            actorId: 'actor-1',
            targetUserId: 'target-1',
            branchId: 'branch-1',
            objectType: 'User',
            objectId: 'target-1',
            correlationId: 'correlation-1',
          },
        ],
        page: { nextCursor: null, hasMore: false },
      }),
    });
    const view = render(<AuditView client={fake} />);
    await userEvent.type(screen.getByLabelText('Tindakan'), 'security.user');
    await userEvent.click(screen.getByRole('button', { name: 'Terapkan' }));
    expect((await screen.findAllByText('Role dan cakupan pengguna diubah'))[0]).toBeVisible();
    expect(fake.listAuditLogs).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'security.user' }),
    );
    expect(view.container).not.toHaveTextContent('super-secret-value');
    expect((await axe(view.container)).violations).toHaveLength(0);
  });

  it('enables a private audit export only after a valid date range is provided', async () => {
    const createAuditExport = vi.fn().mockResolvedValue({
      id: 'export-1',
      status: 'QUEUED',
      requestedAt: '2026-07-29T00:00:00.000Z',
      completedAt: null,
      expiresAt: '2026-07-30T00:00:00.000Z',
      rowCount: 0,
      failureCode: null,
    });
    render(<AuditView client={client({ createAuditExport })} />);
    const exportButton = screen.getByRole('button', { name: 'Buat export' });
    expect(exportButton).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Dari tanggal'), '2026-07-01');
    await userEvent.type(screen.getByLabelText('Sampai tanggal'), '2026-07-29');
    // Alasan tidak terisi otomatis; tombol tetap mati sampai pengguna menuliskannya.
    expect(exportButton).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Alasan/), 'Audit bulanan');
    expect(exportButton).toBeEnabled();
    await userEvent.click(exportButton);
    await waitFor(() =>
      expect(createAuditExport).toHaveBeenCalledWith(
        expect.objectContaining({
          from: '2026-06-30T17:00:00.000Z',
          to: '2026-07-29T16:59:59.999Z',
        }),
        expect.any(String),
      ),
    );
  });

  it('keeps password recovery enumeration-safe and validates matching reset values', async () => {
    const fake = client();
    const forgot = render(<ForgotPasswordView client={fake} />);
    expect((await axe(forgot.container)).violations).toHaveLength(0);
    await userEvent.type(screen.getByLabelText('Email'), 'member@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Kirim tautan reset' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Jika akun cocok');
    forgot.unmount();

    window.history.replaceState({}, '', '/reset-password?token=one-time-token');
    render(<ResetPasswordView client={fake} />);
    await userEvent.type(screen.getByLabelText('Password baru'), 'a-new-secure-password');
    await userEvent.type(screen.getByLabelText('Ulangi password baru'), 'different-password');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan password baru' }));
    expect(fake.resetPassword).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent('Password harus sama');
  });

  it('activates an invitation and exposes password security management', async () => {
    const fake = client();
    window.history.replaceState({}, '', '/activate-account?token=activation-token');
    const activation = render(<ActivateAccountView client={fake} />);
    await userEvent.type(screen.getByLabelText('Password'), 'a-secure-invite-password');
    await userEvent.type(screen.getByLabelText('Ulangi password'), 'a-secure-invite-password');
    await userEvent.click(screen.getByRole('button', { name: 'Aktifkan akun' }));
    expect(fake.activatePassword).toHaveBeenCalledWith(
      'activation-token',
      'a-secure-invite-password',
    );
    activation.unmount();

    const security = render(
      <AppFeedbackProvider>
        <SecurityView client={fake} />
      </AppFeedbackProvider>,
    );
    expect(await screen.findByText('Password aktif')).toBeVisible();
    expect((await axe(security.container)).violations).toHaveLength(0);
  });
});

const assignmentClient = (overrides: Partial<AssignmentClient> = {}): AssignmentClient => ({
  list: vi.fn().mockResolvedValue({
    items: [],
    summary: { total: 0, active: 0, ended: 0 },
    page: { nextCursor: null, hasMore: false },
  }),
  listUsers: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockResolvedValue(undefined),
  end: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

describe('assignment UI', () => {
  const branches = [{ id: 'branch-1', code: 'GG', name: 'Green Garden' }];
  it('is accessible and exposes scoped loading/empty state', async () => {
    const view = render(
      <AssignmentsView
        client={assignmentClient()}
        branchOptions={branches}
        access={{ canRead: true, canManage: true }}
      />,
    );
    expect(await screen.findByText(/Belum ada penugasan/)).toBeInTheDocument();
    expect((await axe(view.container)).violations).toHaveLength(0);
    expect(screen.getByText(/Kelola periode Owner dan Instruktur/)).toBeInTheDocument();
  });

  it('creates and ends with expected version through keyboard-operable forms', async () => {
    const fake = assignmentClient({
      listUsers: vi.fn().mockResolvedValue([{ id: 'user-1', displayName: 'Instructor Satu' }]),
      list: vi.fn().mockResolvedValue({
        items: [
          {
            id: 'assignment-1',
            userId: 'user-1',
            branchId: 'branch-1',
            assignmentType: 'INSTRUCTOR',
            activeFrom: '2026-08-01',
            activeUntil: null,
            status: 'ACTIVE',
            user: { id: 'user-1', displayName: 'Instructor Satu', phoneMasked: null },
            branch: { id: 'branch-1', code: 'GG', name: 'Green Garden' },
            version: 3,
          },
        ],
        summary: { total: 1, active: 1, ended: 0 },
        page: { nextCursor: null, hasMore: false },
      }),
    });
    render(
      <AssignmentsView
        client={fake}
        branchOptions={branches}
        activeBranchId="branch-1"
        access={{ canRead: true, canManage: true }}
      />,
    );
    await screen.findAllByText('Instructor Satu');
    await userEvent.click(screen.getByRole('button', { name: 'Buat penugasan' }));
    const assignmentDialog = await screen.findByRole('dialog', { name: 'Buat penugasan' });
    expect(assignmentDialog).toBeVisible();
    const assignmentForm = within(assignmentDialog);
    await userEvent.type(assignmentForm.getByLabelText('Pengguna'), 'Ins');
    await userEvent.click(await assignmentForm.findByRole('option', { name: /Instructor Satu/ }));
    await userEvent.type(assignmentForm.getByLabelText(/Aktif mulai/), '2026-08-01');
    await userEvent.type(assignmentForm.getByLabelText(/Alasan/), 'assignment baru');
    await userEvent.click(assignmentForm.getByRole('button', { name: 'Buat penugasan' }));
    expect(fake.create).toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: 'Akhiri' }));
    const endDialog = await screen.findByRole('dialog', { name: 'Akhiri penugasan' });
    const endForm = within(endDialog);
    fireEvent.change(endForm.getByLabelText(/Efektif berakhir/), {
      target: { value: '2026-08-10T00:00' },
    });
    fireEvent.change(endForm.getByLabelText(/Alasan/), {
      target: { value: 'periode selesai' },
    });
    await userEvent.click(endForm.getByRole('button', { name: 'Akhiri penugasan' }));
    await waitFor(() =>
      expect(fake.end).toHaveBeenCalledWith(
        'assignment-1',
        '2026-08-10T00:00',
        3,
        'periode selesai',
      ),
    );
  });

  it.each([
    [403, 'FORBIDDEN'],
    [409, 'EFFECTIVE_PERIOD_OVERLAP'],
    [404, 'RESOURCE_NOT_FOUND'],
    [422, 'VALIDATION_ERROR'],
  ])('shows safe failure for HTTP %s', async (status, code) => {
    render(
      <AssignmentsView
        branchOptions={branches}
        activeBranchId="branch-1"
        access={{ canRead: true, canManage: true }}
        client={assignmentClient({
          listUsers: vi.fn().mockResolvedValue([{ id: 'user-1', displayName: 'Instructor Satu' }]),
          create: vi.fn().mockRejectedValue({ response: { status } }),
        })}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Buat penugasan' }));
    const assignmentDialog = await screen.findByRole('dialog', { name: 'Buat penugasan' });
    const assignmentForm = within(assignmentDialog);
    await userEvent.type(assignmentForm.getByLabelText('Pengguna'), 'Ins');
    await userEvent.click(await assignmentForm.findByRole('option', { name: /Instructor Satu/ }));
    await userEvent.type(assignmentForm.getByLabelText(/Aktif mulai/), '2026-08-01');
    await userEvent.type(assignmentForm.getByLabelText(/Alasan/), 'test failure');
    await userEvent.click(assignmentForm.getByRole('button', { name: 'Buat penugasan' }));
    expect(
      await screen.findByText(
        new RegExp(
          code === 'FORBIDDEN'
            ? 'tidak memiliki izin'
            : code === 'RESOURCE_NOT_FOUND'
              ? 'tidak ditemukan'
              : code === 'VALIDATION_ERROR'
                ? 'Periksa kembali'
                : 'bertabrakan',
          'i',
        ),
      ),
    ).toBeInTheDocument();
  });

  it('supports self-contained branch selection in global mode without active branch', async () => {
    const fake = assignmentClient({
      listUsers: vi.fn().mockResolvedValue([{ id: 'user-2', displayName: 'Coach Dua' }]),
    });
    const view = render(
      <AssignmentsView
        branchOptions={branches}
        access={{ canRead: true, canManage: true }}
        client={fake}
      />,
    );
    expect(
      screen.getByText(/Mode semua cabang menampilkan data seluruh lokasi/),
    ).toBeInTheDocument();
    const createBtn = screen.getByRole('button', { name: 'Buat penugasan' });
    expect(createBtn).toBeEnabled();
    await userEvent.click(createBtn);
    const assignmentDialog = await screen.findByRole('dialog', { name: 'Buat penugasan' });
    expect(assignmentDialog).toBeVisible();
    const assignmentForm = within(assignmentDialog);
    expect(assignmentForm.getByLabelText(/Cabang Penugasan/)).toBeVisible();
    await userEvent.type(assignmentForm.getByLabelText('Pengguna'), 'Coa');
    await userEvent.click(await assignmentForm.findByRole('option', { name: /Coach Dua/ }));
    await userEvent.type(assignmentForm.getByLabelText(/Aktif mulai/), '2026-08-01');
    await userEvent.type(assignmentForm.getByLabelText(/Alasan/), 'penugasan global');
    await userEvent.click(assignmentForm.getByRole('button', { name: 'Buat penugasan' }));
    expect(fake.create).toHaveBeenCalledWith(
      expect.objectContaining({
        branchId: 'branch-1',
        userId: 'user-2',
        reason: 'penugasan global',
      }),
    );
    expect((await axe(view.container)).violations).toHaveLength(0);
  });
});

const masterClient = (overrides: Partial<MasterClient> = {}): MasterClient => ({
  listBranches: vi.fn().mockResolvedValue({
    items: [],
    summary: { total: 0, active: 0, inactive: 0 },
    page: { hasMore: false, nextCursor: null },
  }),
  listClassTypes: vi.fn().mockResolvedValue([]),
  listStudios: vi.fn().mockResolvedValue([]),
  listSettings: vi.fn().mockResolvedValue([]),
  createBranch: vi.fn().mockResolvedValue(undefined),
  createClassType: vi.fn().mockResolvedValue(undefined),
  createStudio: vi.fn().mockResolvedValue(undefined),
  updateStudio: vi.fn().mockResolvedValue(undefined),
  createRoom: vi.fn().mockResolvedValue(undefined),
  updateRoom: vi.fn().mockResolvedValue(undefined),
  replaceClassTypeScopes: vi.fn().mockResolvedValue(undefined),
  updateClassType: vi.fn().mockResolvedValue(undefined),
  deactivateBranch: vi.fn().mockResolvedValue(undefined),
  deactivateClassType: vi.fn().mockResolvedValue(undefined),
  reactivateClassType: vi.fn().mockResolvedValue(undefined),
  createSetting: vi.fn().mockResolvedValue(undefined),
  deleteSetting: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

describe('effective master UI', () => {
  it('is accessible and has no production numeric defaults', async () => {
    const view = render(
      <AppFeedbackProvider>
        <MasterView client={masterClient()} activeTab="capacity" access={{ canManage: true, canFinance: true }} />
      </AppFeedbackProvider>,
    );
    expect((await axe(view.container)).violations).toHaveLength(0);
    expect(screen.queryByRole('heading', { name: 'Daftar cabang' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Tipe kelas' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /\+ Atur kuota baru/i }));
    expect(screen.getByLabelText(/Minimum peserta/)).toHaveValue(null);
    expect(screen.getByLabelText(/Kapasitas maksimum/)).toHaveValue(null);
    await userEvent.click(screen.getByRole('button', { name: 'Muat master data' }));
    expect(await screen.findByRole('status')).toHaveTextContent('berhasil dimuat');
  });

  it('submits a half-open quota setting and displays safe conflicts', async () => {
    const fake = masterClient({
      listBranches: vi.fn().mockResolvedValue({
        items: [
          {
            id: 'branch-1',
            code: 'DD-JKT',
            name: 'Daily Dose Jakarta',
            timezone: 'Asia/Jakarta',
            active: true,
            version: 0,
          },
        ],
        summary: { total: 1, active: 1, inactive: 0 },
        page: { hasMore: false, nextCursor: null },
      }),
      listClassTypes: vi
        .fn()
        .mockResolvedValue([
          { id: 'class-1', code: 'REFORMER', name: 'Reformer Pilates', active: true, version: 0 },
        ]),
    });
    render(
      <AppFeedbackProvider>
        <MasterView client={fake} activeTab="capacity" access={{ canManage: true, canFinance: true }} />
      </AppFeedbackProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Muat master data' }));
    expect(await screen.findByRole('heading', { name: 'Kuota & kapasitas kelas' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /\+ Atur kuota baru/i }));
    // Form baru selalu mulai tanpa tipe kelas; pilihan sebelumnya tidak boleh terbawa.
    expect(screen.getByRole('button', { name: 'Simpan konfigurasi' })).toBeDisabled();
    await userEvent.click(screen.getByRole('combobox', { name: 'Tipe kelas' }));
    await userEvent.click(await screen.findByRole('option', { name: /Reformer Pilates/i }));
    await userEvent.type(screen.getByLabelText(/Minimum peserta/), '4');
    await userEvent.type(screen.getByLabelText(/Kapasitas maksimum/), '8');
    await userEvent.type(screen.getByLabelText(/Efektif mulai/), '2026-08-01');
    await userEvent.type(screen.getByLabelText(/Alasan perubahan/), 'Penyesuaian operasional');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan konfigurasi' }));
    expect(fake.createSetting).toHaveBeenCalledWith(
      expect.objectContaining({ value: 4, capacity: 8 }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('berhasil dibuat');
  });
});
