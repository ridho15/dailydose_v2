import { PaymentProofService } from '../packages/bukti-pembayaran.service';
import { FinanceService } from '../packages/finance.service';
import { IdentityDocumentAccessService } from './identity-document-access.service';
import { IdentityService } from './identity.service';
import { PolicyService } from './policy.service';
import { UserAdministrationService } from './user-administration.service';

const branchA = '00000000-0000-4000-8000-000000000001';
const branchB = '00000000-0000-4000-8000-000000000002';

const principal = (
  capabilities: string[],
  roles: Array<{ role: string; branchId: string | null }> = [],
  branchIds: string[] = [branchA],
  userId = '00000000-0000-4000-8000-0000000000aa',
) => ({ sessionId: 's', userId, roles: roles as never, capabilities, branchIds });

// Pelanggan: tidak punya satu pun kapabilitas staf.
const customer = principal(
  ['customer:self', 'ledger:read'],
  [{ role: 'CUSTOMER', branchId: null }],
  [],
  '00000000-0000-4000-8000-0000000000cc',
);

describe('lookups only serve staff pages that need them', () => {
  const findMany = jest.fn().mockResolvedValue([
    { id: 'u1', displayName: 'Coach A', role: 'INSTRUCTOR', phone: '+6281234567890', preferredBranchId: null },
  ]);
  const service = new UserAdministrationService(
    {
      user: { findMany },
      auditLog: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    } as never,
    new PolicyService(),
    {} as never,
  );

  beforeEach(() => findMany.mockClear());

  it('refuses customers and staff without a picker page', async () => {
    await expect(service.lookupUsers(customer, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      service.lookupUsers(principal(['booking:read']), { instructorsOnly: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('serves users to assignment/master/user admins without phone numbers', async () => {
    const result = await service.lookupUsers(principal(['assignment:manage']), {});
    expect(result.items[0]).toMatchObject({ id: 'u1', label: 'Coach A', description: 'INSTRUCTOR' });
    expect(JSON.stringify(result)).not.toContain('+6281234567890');
  });

  it('serves instructors to timetable managers but not to audit-only roles', async () => {
    await expect(
      service.lookupUsers(principal(['class-slot:manage']), { instructorsOnly: true }),
    ).resolves.toMatchObject({ items: expect.any(Array) });
    await expect(
      service.lookupUsers(principal(['audit:read']), { instructorsOnly: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('requires audit:read for a per-user audit trail', async () => {
    await expect(service.listUserAudit(customer, 'x')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.listUserAudit(principal(['audit:read']), 'x')).resolves.toMatchObject({
      items: [],
    });
  });
});

describe('FinanceService capability gates', () => {
  const db = {
    cabang: { findUnique: jest.fn().mockResolvedValue({ id: branchA }) },
    otherCost: { findUnique: jest.fn().mockResolvedValue({ id: "id", branchId: branchA, createdById: "other" }) },
  };
  const service = new FinanceService(db as never, new PolicyService(), { catat: jest.fn() } as never);
  const branchManager = principal(['booking:read'], [{ role: 'MANAGER', branchId: branchA }]);

  it('denies reports and stubs without finance:read even to a branch member', async () => {
    await expect(service.overview(branchManager, { branchId: branchA })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(service.omsetReport(branchManager, { branchId: branchA })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(service.anomalies(customer, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.legacyCashflow(customer, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('denies finance writes without finance:manage', async () => {
    const reader = principal(['finance:read'], [{ role: 'OWNER', branchId: branchA }]);
    await expect(
      service.createOtherCost(reader, {
        branchId: branchA,
        period: '2026-01',
        category: 'X',
        description: 'x',
        amountRp: 1,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.deleteOtherCost(reader, 'id')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('IdentityDocumentAccessService', () => {
  it('binds a view authorization to the principal that requested it', async () => {
    const service = new IdentityDocumentAccessService(new PolicyService());
    const owner = principal(
      ['customer:self'],
      [{ role: 'CUSTOMER', branchId: null }],
      [],
      '00000000-0000-4000-8000-0000000000c1',
    );
    const stranger = { ...owner, userId: '00000000-0000-4000-8000-0000000000c2' };
    const { url } = await service.authorizeSelf(owner, 'KTP');
    const authorizationId = /identity-verification-files\/([^/]+)\/content/u.exec(url)?.[1] ?? '';
    await expect(service.read(stranger, authorizationId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(service.read(owner, authorizationId)).resolves.toMatchObject({
      mimeType: expect.any(String),
    });
  });
});

describe('IdentityService.requestPasswordSetup', () => {
  const service = Object.create(IdentityService.prototype) as IdentityService;
  (service as unknown as { policy: PolicyService }).policy = new PolicyService();
  const body = { email: 'a@b.test', reason: 'x' };

  it('requires user:admin and never claims a link was sent', async () => {
    await expect(service.requestPasswordSetup(customer, 'u', body, 'c')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      service.requestPasswordSetup(principal(['user:admin']), 'u', body, 'c'),
    ).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
  });
});

describe('PaymentProofService ownership', () => {
  const owner = principal(['customer:self'], [{ role: 'CUSTOMER', branchId: null }], [], 'owner-1');
  const other = { ...owner, userId: 'other-1' };
  const build = () => {
    const db = {
      pembelian: {
        findFirst: jest.fn(async ({ where }: { where: { userId: string } }) =>
          where.userId === 'owner-1' ? { id: 'purchase-1', userId: 'owner-1' } : null,
        ),
      },
      buktiPembayaran: {
        upsert: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({
          id: 'proof-1',
          fileUrl: '/uploads/payment-proofs/proof-1',
          bankName: 'BCA',
          accountHolder: 'Maya',
          uploadedAt: new Date(),
          purchase: { userId: 'owner-1' },
        }),
      },
    };
    const service = new PaymentProofService(
      db as never,
      { catalog: jest.fn() } as never,
      {} as never,
      { record: jest.fn() } as never,
    );
    return { db, service };
  };

  it('does not let another user attach or replace the proof of a purchase', async () => {
    const { db, service } = build();
    await expect(
      service.finalize(other, 'proof-2', { purchaseId: 'purchase-1' }, 'c'),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(db.buktiPembayaran.upsert).not.toHaveBeenCalled();
    await service.finalize(owner, 'proof-2', { purchaseId: 'purchase-1' }, 'c');
    expect(db.buktiPembayaran.upsert).toHaveBeenCalledTimes(1);
  });

  it('does not disclose proof details to another user', async () => {
    const { service } = build();
    const foreign = await service.status(other, 'proof-1');
    expect(JSON.stringify(foreign)).not.toContain('BCA');
    const own = await service.status(owner, 'proof-1');
    expect(own).toMatchObject({ bankName: 'BCA' });
  });
});
