import { PolicyService, ROLE_CAPABILITIES } from './policy.service';

describe('PolicyService role catalog', () => {
  it('derives read-only metadata from mutation capabilities', () => {
    const catalog = new PolicyService().roleCatalog();
    expect(catalog.find(({ role }) => role === 'SUPER_OWNER')?.readOnly).toBe(false);
    expect(catalog.find(({ role }) => role === 'ADMIN')?.readOnly).toBe(false);
    // Owner hanya punya satu izin ubah: menyetujui pembatalan booking setelah batas H-24.
    expect(catalog.find(({ role }) => role === 'OWNER')?.readOnly).toBe(false);
    expect(catalog.find(({ role }) => role === 'CUSTOMER')?.readOnly).toBe(false);
  });

  it('keeps voucher and package promotion access explicit and duplicate-free', () => {
    const superOwner = ROLE_CAPABILITIES.SUPER_OWNER;
    expect(new Set(superOwner).size).toBe(superOwner.length);
    expect(superOwner).toEqual(
      expect.arrayContaining([
        'voucher:read',
        'voucher:manage',
        'package-promotion:read',
        'package-promotion:manage',
      ]),
    );
    expect(ROLE_CAPABILITIES.OWNER).toEqual(
      expect.arrayContaining(['voucher:read', 'package-promotion:read']),
    );
    expect(ROLE_CAPABILITIES.FINANCE).toContain('voucher:read');
    expect(ROLE_CAPABILITIES.CUSTOMER).toContain('voucher:redeem');
    for (const role of ['ADMIN', 'MANAGER', 'INSTRUCTOR'] as const) {
      expect(ROLE_CAPABILITIES[role]).not.toContain('voucher:manage');
      expect(ROLE_CAPABILITIES[role]).not.toContain('package-promotion:manage');
    }
  });

  it('grants Super Owner the administrative matrix (including requesting adjustments) without customer duties', () => {
    const superOwner = ROLE_CAPABILITIES.SUPER_OWNER;
    expect(superOwner).toEqual(
      expect.arrayContaining([
        'role-permission:manage',
        'user:admin',
        'branch:all',
        'master:manage',
        'voucher:manage',
        'package-promotion:manage',
        'payment-account:manage',
        'payment:decide',
        'finance:manage',
        // Super Owner mengelola semuanya: boleh mengajukan sekaligus memutus (SoD di LedgerService).
        'ledger:adjust:request',
        'ledger:adjust:decide',
        'customer:write',
        'class-slot:manage',
        'operations:recover',
        'booking:create:assisted',
        'attendance:manage',
        'reschedule:decide',
        'identity-verification:decide',
      ]),
    );
    expect(superOwner).not.toContain('customer:self');
  });

  it('keeps capability and branch bound together and applies matching deny first', () => {
    const policy = new PolicyService();
    const principal = {
      capabilities: ['booking:read', 'ledger:read'],
      branchIds: ['branch-a', 'branch-b'],
      capabilityGrants: [
        {
          capability: 'booking:read',
          branchId: 'branch-a',
          source: 'CUSTOM_ROLE' as const,
          sourceId: 'role-a',
        },
        {
          capability: 'ledger:read',
          branchId: 'branch-b',
          source: 'CUSTOM_ROLE' as const,
          sourceId: 'role-b',
        },
      ],
      capabilityDenials: [{ capability: 'booking:read', branchId: 'branch-b', sourceId: 'deny-b' }],
    };
    expect(policy.hasCapability(principal, 'booking:read', 'branch-a')).toBe(true);
    expect(policy.hasCapability(principal, 'booking:read', 'branch-b')).toBe(false);
    expect(policy.hasCapability(principal, 'ledger:read', 'branch-b')).toBe(true);
    expect(policy.capabilityBranchScope(principal, 'booking:read')).toEqual({
      all: false,
      included: ['branch-a'],
      excluded: [],
    });
  });

  it('represents global grant with branch-specific exclusions for list queries', () => {
    const policy = new PolicyService();
    expect(
      policy.capabilityBranchScope(
        {
          capabilities: ['attendance:read'],
          branchIds: ['branch-b'],
          capabilityGrants: [
            {
              capability: 'attendance:read',
              branchId: null,
              source: 'USER_OVERRIDE',
              sourceId: 'grant-global',
            },
          ],
          capabilityDenials: [
            { capability: 'attendance:read', branchId: 'branch-b', sourceId: 'deny-b' },
          ],
        },
        'attendance:read',
      ),
    ).toEqual({ all: true, included: [], excluded: ['branch-b'] });
  });

  it('requires a true global grant for identity verification capabilities', () => {
    const policy = new PolicyService();
    const branchReviewer = {
      capabilities: ['identity-verification:read'],
      branchIds: ['branch-a'],
      capabilityGrants: [
        {
          capability: 'identity-verification:read',
          branchId: 'branch-a',
          source: 'CUSTOM_ROLE' as const,
          sourceId: 'branch-reviewer',
        },
      ],
    };
    expect(policy.hasGlobalCapability(branchReviewer, 'identity-verification:read')).toBe(false);
    expect(() =>
      policy.requireGlobalCapability(branchReviewer, 'identity-verification:read'),
    ).toThrow('FORBIDDEN');

    expect(
      policy.hasGlobalCapability(
        {
          ...branchReviewer,
          capabilityGrants: [
            {
              capability: 'identity-verification:read',
              branchId: null,
              source: 'CUSTOM_ROLE',
              sourceId: 'global-reviewer',
            },
          ],
        },
        'identity-verification:read',
      ),
    ).toBe(true);
  });

  it('grants branch:all to staff roles when branchId is null, and restricts when branchId is specified', () => {
    const policy = new PolicyService();

    // Admin without specific branch -> gets branch:all
    const globalAdminAccess = policy.resolveAccess('user-admin-1', [
      { role: 'ADMIN', branchId: null },
    ]);
    expect(globalAdminAccess.capabilities).toContain('branch:all');
    expect(policy.hasCapability(globalAdminAccess, 'branch:all')).toBe(true);
    expect(policy.hasCapability(globalAdminAccess, 'class-slot:manage', 'any-branch-id')).toBe(true);

    // Admin with specific branch -> does NOT get branch:all, strictly scoped
    const scopedAdminAccess = policy.resolveAccess('user-admin-2', [
      { role: 'ADMIN', branchId: 'branch-jkt' },
    ]);
    expect(scopedAdminAccess.capabilities).not.toContain('branch:all');
    expect(scopedAdminAccess.branchIds).toEqual(['branch-jkt']);
    expect(policy.hasCapability(scopedAdminAccess, 'class-slot:manage', 'branch-jkt')).toBe(true);
    expect(policy.hasCapability(scopedAdminAccess, 'class-slot:manage', 'branch-bsd')).toBe(false);

    // Coach without specific branch -> gets branch:all
    const globalCoachAccess = policy.resolveAccess('user-coach-1', [
      { role: 'INSTRUCTOR', branchId: null },
    ]);
    expect(globalCoachAccess.capabilities).toContain('branch:all');

    // Customer/Member without branch -> does NOT get branch:all
    const customerAccess = policy.resolveAccess('user-customer-1', [
      { role: 'CUSTOMER', branchId: null },
    ]);
    expect(customerAccess.capabilities).not.toContain('branch:all');
  });
});

