import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError, parseApiError } from '../lib/api-client';
import { accessFailureCode, type AccessClient, type AccessRole, type CapabilityDefinition, type UserAccess } from '../api-clients/access-client';
import { RolePermissionsView } from './roles-permissions/role-permissions-view';
import { UserDetailView } from './[id]/user-detail-view';
import { AppFeedbackProvider } from '../components/app-feedback';
import type { IdentityClient, UserSummary } from '../api-clients/identity-client';
import type { MasterClient } from '../api-clients/master-client';
import type { WebSession } from '../api-clients/session-client';

let currentMockSession: WebSession | null = null;

vi.mock('@/session-context', () => ({
  useSessionContext: () => ({
    session: currentMockSession,
    status: currentMockSession ? 'authenticated' : 'unauthenticated',
    hasCapability: (cap: string) => currentMockSession?.capabilities.includes(cap) ?? false,
    activeBranchId: currentMockSession?.branches[0]?.id ?? null,
  }),
  useActiveBranchState: () => [currentMockSession?.branches[0]?.id ?? 'branch-1', vi.fn()],
}));

vi.mock('../../session-context', () => ({
  useSessionContext: () => ({
    session: currentMockSession,
    status: currentMockSession ? 'authenticated' : 'unauthenticated',
    hasCapability: (cap: string) => currentMockSession?.capabilities.includes(cap) ?? false,
    activeBranchId: currentMockSession?.branches[0]?.id ?? null,
  }),
  useActiveBranchState: () => [currentMockSession?.branches[0]?.id ?? 'branch-1', vi.fn()],
}));

describe('Tahap 1: Pondasi Normalisasi Error (parseApiError)', () => {
  it('parses ApiError with nested data and code correctly', () => {
    const error = new ApiError('Conflict occurred', 409, { error: { code: 'LAST_SUPER_OWNER', message: 'Tidak boleh hapus Super Owner terakhir' } }, 'LAST_SUPER_OWNER');
    const parsed = parseApiError(error);

    expect(parsed.status).toBe(409);
    expect(parsed.code).toBe('LAST_SUPER_OWNER');
    expect(parsed.message).toBe('Tidak boleh hapus Super Owner terakhir');
  });

  it('parses legacy Axios-like { response: { status, data } } without failing', () => {
    const error = {
      response: {
        status: 409,
        data: {
          error: {
            code: 'CANNOT_MODIFY_OWN_ACCESS',
            message: 'Super Owner tidak boleh mengubah akses akunnya sendiri.',
          },
        },
      },
    };
    const parsed = parseApiError(error);

    expect(parsed.status).toBe(409);
    expect(parsed.code).toBe('CANNOT_MODIFY_OWN_ACCESS');
    expect(parsed.message).toBe('Super Owner tidak boleh mengubah akses akunnya sendiri.');
  });

  it('parses legacy direct code on payload', () => {
    const error = {
      response: {
        status: 422,
        data: {
          code: 'BRANCH_REQUIRED',
          detail: 'Cabang wajib dipilih untuk peran ini.',
        },
      },
    };
    const parsed = parseApiError(error);

    expect(parsed.status).toBe(422);
    expect(parsed.code).toBe('BRANCH_REQUIRED');
    expect(parsed.message).toBe('Cabang wajib dipilih untuk peran ini.');
  });

  it('handles nullish or unknown errors gracefully', () => {
    expect(parseApiError(null)).toEqual({});
    expect(parseApiError(undefined)).toEqual({});
    expect(parseApiError('unknown error')).toEqual({ message: undefined, status: undefined, code: undefined, data: undefined, details: undefined });
  });
});

describe('Tahap 2: accessFailureCode error code extraction', () => {
  it('extracts LAST_SUPER_OWNER from ApiError', () => {
    const err = new ApiError('Conflict', 409, { error: { code: 'LAST_SUPER_OWNER' } }, 'LAST_SUPER_OWNER');
    expect(accessFailureCode(err)).toBe('LAST_SUPER_OWNER');
  });

  it('extracts CANNOT_MODIFY_OWN_ACCESS from ApiError', () => {
    const err = new ApiError('Forbidden', 403, { code: 'CANNOT_MODIFY_OWN_ACCESS' }, 'CANNOT_MODIFY_OWN_ACCESS');
    expect(accessFailureCode(err)).toBe('CANNOT_MODIFY_OWN_ACCESS');
  });

  it('falls back to FORBIDDEN on status 403 when code is missing', () => {
    const err = new ApiError('Forbidden', 403);
    expect(accessFailureCode(err)).toBe('FORBIDDEN');
  });

  it('falls back to ROLE_CODE_CONFLICT on status 409 when code is missing', () => {
    const err = new ApiError('Conflict', 409);
    expect(accessFailureCode(err)).toBe('ROLE_CODE_CONFLICT');
  });
});

describe('Tahap 2: Super Admin RBAC UI Protection & Guard', () => {
  beforeEach(() => {
    currentMockSession = {
      id: 'user-super-1',
      displayName: 'Super Admin Utama',
      roles: ['SUPER_OWNER'],
      branchIds: [],
      capabilities: ['user:admin', 'access:manage', 'audit:read', 'ledger:read'],
      sessionExpiresAt: new Date(Date.now() + 3600_000),
      branches: [{ id: 'branch-1', code: 'BDG01', name: 'Bandung', timezone: 'Asia/Jakarta' }],
    };
  });

  const sampleRoles: AccessRole[] = [
    {
      id: 'role-1',
      code: 'SUPER_OWNER',
      displayName: 'Super Owner',
      description: 'Akses penuh',
      scope: 'GLOBAL',
      systemRole: 'SUPER_OWNER',
      system: true,
      protected: true,
      active: true,
      version: 1,
      affectedUsers: 1,
      capabilities: [],
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
    {
      id: 'role-2',
      code: 'BRANCH_MANAGER',
      displayName: 'Branch Manager',
      description: 'Pengelola cabang',
      scope: 'BRANCH',
      systemRole: 'MANAGER',
      system: false,
      protected: false,
      active: true,
      version: 1,
      affectedUsers: 2,
      capabilities: [],
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
  ];

  const sampleCaps: CapabilityDefinition[] = [
    {
      key: 'user:admin',
      label: 'Kelola Pengguna',
      description: 'Mengelola data pengguna',
      category: 'USER',
      sensitive: false,
      active: true,
      systemOnly: false,
      globalOnly: false,
    },
  ];

  const createMockAccessClient = (overrides: Partial<AccessClient> = {}): AccessClient => ({
    listRoles: vi.fn().mockResolvedValue(sampleRoles),
    listCapabilities: vi.fn().mockResolvedValue(sampleCaps),
    getUserAccess: vi.fn().mockImplementation(async (userId: string) => ({
      user: {
        id: userId,
        displayName: userId === 'user-super-1' ? 'Super Admin Utama' : 'Staff Operasional',
        status: 'ACTIVE',
        version: 1,
      },
      roleAssignments: [
        {
          id: 'asgn-1',
          roleId: 'role-1',
          roleCode: 'SUPER_OWNER',
          displayName: 'Super Owner',
          scope: 'GLOBAL',
          branchId: null,
          branch: null,
          source: 'DIRECT',
        },
      ],
      overrides: [],
      effective: { capabilities: [], branches: [], grants: [], denials: [] },
    } as UserAccess)),
    replaceUserRoles: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });

  const createMockMasterClient = (): MasterClient => ({
    listBranches: vi.fn().mockResolvedValue({
      items: [{ id: 'branch-1', code: 'BDG01', name: 'Bandung', active: true }],
      page: { hasMore: false, nextCursor: null },
    }),
  } as unknown as MasterClient);

  const createMockIdentityClient = (overrides: Partial<IdentityClient> = {}): IdentityClient => ({
    lookupUsers: vi.fn().mockResolvedValue({
      items: [{ id: 'user-other', label: 'Staff Operasional', description: 'staff@example.test', metadata: { roles: ['ADMIN'], branchIds: [] } }],
      page: { nextCursor: null, hasMore: false },
    }),
    getUser: vi.fn().mockResolvedValue({
      id: 'user-other',
      displayName: 'Staff Operasional',
      status: 'ACTIVE',
      version: 1,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      roles: [],
      directRoles: [],
      assignmentRoles: [],
      effectiveCapabilities: [],
      phoneE164: null, audience: 'STAFF',
    } as UserSummary),
    roleCatalog: vi.fn().mockResolvedValue([]),
    listAudit: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as IdentityClient);

  it('protects Super Owner from modifying own roles with visual warning banner and disabled button', async () => {
    window.history.replaceState({}, '', '/users/roles-permissions?tab=users&user=user-super-1');

    const access = createMockAccessClient();

    render(
      <AppFeedbackProvider>
        <RolePermissionsView
          accessClient={access}
          masterClient={createMockMasterClient()}
          identityClient={createMockIdentityClient()}
        />
      </AppFeedbackProvider>,
    );

    // Wait for self user to be loaded
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 3, name: 'Super Admin Utama' })).toBeInTheDocument();
    });

    // Check warning banner exists
    expect(screen.getByText('Peran Akun Sendiri Terproteksi')).toBeInTheDocument();
    expect(screen.getByText(/perubahan peran Super Owner pada akun sendiri harus dilakukan oleh Super Owner lainnya/i)).toBeInTheDocument();

    // Check submit button is disabled
    const saveBtn = screen.getByRole('button', { name: /Review perubahan role/i });
    expect(saveBtn).toBeDisabled();
    expect(access.replaceUserRoles).not.toHaveBeenCalled();
  });

  it('displays accurate Indonesian error alert when server returns LAST_SUPER_OWNER conflict', async () => {
    window.history.replaceState({}, '', '/users/roles-permissions?tab=users&user=user-other');

    const access = createMockAccessClient({
      replaceUserRoles: vi.fn().mockRejectedValue(
        new ApiError('Conflict', 409, { error: { code: 'LAST_SUPER_OWNER' } }, 'LAST_SUPER_OWNER'),
      ),
    });

    render(
      <AppFeedbackProvider>
        <RolePermissionsView
          accessClient={access}
          masterClient={createMockMasterClient()}
          identityClient={createMockIdentityClient()}
        />
      </AppFeedbackProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 3, name: 'Staff Operasional' })).toBeInTheDocument();
    });

    const saveBtn = screen.getByRole('button', { name: /Review perubahan role/i });
    await userEvent.click(saveBtn);

    // Confirm dialog appears
    const confirmBtn = await screen.findByRole('button', { name: /Ganti role/i });
    await userEvent.click(confirmBtn);

    // Expect friendly alert message translated from LAST_SUPER_OWNER
    expect(await screen.findByText('Perubahan ditolak karena akan menghilangkan Super Owner aktif terakhir.')).toBeInTheDocument();
  });

  it('hides delete and self-deactivate buttons when viewing own profile in UserDetailView', async () => {
    const identity = createMockIdentityClient({
      getUser: vi.fn().mockResolvedValue({
        id: 'user-super-1',
        displayName: 'Super Admin Utama',
        status: 'ACTIVE',
        version: 1,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
        roles: [{ role: 'SUPER_OWNER', branchId: null, branch: null, source: 'DIRECT' }],
        directRoles: [{ role: 'SUPER_OWNER', branchId: null, branch: null, source: 'DIRECT' }],
        assignmentRoles: [],
        effectiveCapabilities: ['user:admin'],
        audience: 'STAFF',
      }),
    });

    render(
      <AppFeedbackProvider>
        <UserDetailView id="user-super-1" client={identity} />
      </AppFeedbackProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Super Admin Utama' })).toBeInTheDocument();
    });

    // Super Owner viewing own account must NOT have "Hapus akun" or "Nonaktifkan"
    expect(screen.queryByRole('button', { name: /Hapus akun/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Nonaktifkan/i })).not.toBeInTheDocument();
  });

  it('renders "Pengguna tidak ditemukan" instead of "Layanan tidak tersedia" when getUser returns 404', async () => {
    const identity = createMockIdentityClient({
      getUser: vi.fn().mockRejectedValue(new ApiError('User not found', 404, { code: 'NOT_FOUND' }, 'NOT_FOUND')),
    });

    render(
      <AppFeedbackProvider>
        <UserDetailView id="user-non-existent" client={identity} />
      </AppFeedbackProvider>,
    );

    expect(await screen.findByText('Pengguna tidak ditemukan')).toBeInTheDocument();
    expect(screen.queryByText(/Layanan identitas tidak dapat dihubungi/i)).not.toBeInTheDocument();
  });
});
