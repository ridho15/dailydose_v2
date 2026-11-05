import { MEMEGANG_SESI } from './sesi-terpesan';
import { LedgerService } from './ledger.service';
import { PolicyService } from '../identity/policy.service';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const branchA = id(1);
const branchB = id(2);
const packageId = id(10);
const requestId = id(20);

const principalFor = (userId: string, capabilities: string[], branchIds = [branchA]) => ({
  sessionId: 's',
  userId,
  roles: [],
  capabilities,
  branchIds,
});

const admin = principalFor(id(100), ['ledger:read', 'ledger:adjust:read', 'ledger:adjust:request']);
const manager = principalFor(id(101), ['ledger:read', 'ledger:adjust:read', 'ledger:adjust:decide']);
// Pelanggan memegang `ledger:read` untuk data miliknya, tetapi tanpa cakupan cabang staf.
const customer = principalFor(id(102), ['ledger:read'], []);

const pkgRow = (overrides: Record<string, unknown> = {}) => ({
  id: packageId,
  userId: id(200),
  remainingSessions: 3,
  usedSessions: 1,
  totalSessions: 4,
  status: 'ACTIVE',
  validFrom: new Date('2026-01-01'),
  validUntil: new Date('2099-01-01'),
  purchaseId: id(30),
  user: { id: id(200), displayName: 'Maya', phone: '081234567890' },
  package: { id: id(40), name: 'Paket 4', classType: { id: id(41), name: 'Reformer' } },
  purchase: { branchId: branchA, branch: { id: branchA, name: 'Green Garden' } },
  ...overrides,
});

const requestRow = (overrides: Record<string, unknown> = {}) => ({
  id: requestId,
  customerPackageId: packageId,
  sessionCount: 1,
  reason: 'ATTENDANCE_CORRECTION',
  reasonCode: 'ATTENDANCE_CORRECTION',
  status: 'PENDING',
  version: 1,
  requestedById: admin.userId,
  approvedById: null,
  decisionCode: null,
  decisionNote: null,
  createdAt: new Date('2026-02-01T00:00:00Z'),
  decidedAt: null,
  requestedBy: { id: admin.userId, displayName: 'Admin MK' },
  approvedBy: null,
  customerPackage: pkgRow(),
  ...overrides,
});

function setup() {
  const tx = {
    paketPelanggan: {
      findUnique: jest.fn().mockResolvedValue(pkgRow()),
      findUniqueOrThrow: jest.fn().mockResolvedValue(pkgRow()),
      update: jest.fn().mockResolvedValue({}),
    },
    pemesananKelas: {
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _sum: { sessionCount: 0 } }),
    },
    sessionAdjustRequest: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation(async ({ data }) =>
        requestRow({
          sessionCount: data.sessionCount,
          reasonCode: data.reasonCode,
          status: data.status ?? 'PENDING',
        }),
      ),
      findUnique: jest.fn().mockResolvedValue(requestRow()),
      findUniqueOrThrow: jest.fn().mockResolvedValue(requestRow({ status: 'APPROVED', version: 2 })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      aggregate: jest.fn().mockResolvedValue({ _sum: { sessionCount: 0 } }),
    },
    sessionLedger: {
      create: jest.fn().mockImplementation(async ({ data }) => ({
        id: id(50),
        createdAt: new Date('2026-02-02T00:00:00Z'),
        ...data,
      })),
    },
  };
  const db = {
    ...tx,
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    sessionLedger: {
      ...tx.sessionLedger,
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    pemesananKelas: {
      ...tx.pemesananKelas,
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    sessionAdjustRequest: {
      ...tx.sessionAdjustRequest,
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    paketPelanggan: { ...tx.paketPelanggan, findMany: jest.fn().mockResolvedValue([]) },
  };
  const audit = { catat: jest.fn().mockResolvedValue(undefined) };
  const service = new LedgerService(db as never, new PolicyService(), audit as never);
  return { service, tx, db, audit };
}

const input = { customerPackageId: packageId, quantity: 1, reasonCode: 'ATTENDANCE_CORRECTION' };
const approve = { reasonCode: 'CORRECTION_VERIFIED', expectedVersion: 1 };

describe('LedgerService.requestAdjustment', () => {
  it('requires ledger:adjust:request', async () => {
    const { service, tx } = setup();
    await expect(service.requestAdjustment(manager, input)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(tx.sessionAdjustRequest.create).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...input, quantity: 0 }],
    [{ ...input, quantity: 51 }],
    [{ ...input, quantity: 1.5 }],
    [{ ...input, reasonCode: 'WHATEVER' }],
    [{ ...input, customerPackageId: 'not-a-uuid' }],
  ])('rejects invalid input %j before persistence', async (body) => {
    const { service, tx } = setup();
    await expect(service.requestAdjustment(admin, body as never)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(tx.sessionAdjustRequest.create).not.toHaveBeenCalled();
  });

  it('hides packages that belong to a foreign branch', async () => {
    const { service, tx } = setup();
    tx.paketPelanggan.findUnique.mockResolvedValue(
      pkgRow({ purchase: { branchId: branchB, branch: { id: branchB, name: 'Lain' } } }),
    );
    await expect(service.requestAdjustment(admin, input)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it('rejects a reduction that would break the balance or existing bookings', async () => {
    const { service, tx } = setup();
    await expect(
      service.requestAdjustment(admin, { ...input, quantity: -4 }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_SESSION_BALANCE' });
    tx.pemesananKelas.count.mockResolvedValue(3);
    await expect(
      service.requestAdjustment(admin, { ...input, quantity: -1 }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_SESSION_BALANCE' });
  });

  it('allows only one pending request per package', async () => {
    const { service, tx } = setup();
    tx.sessionAdjustRequest.count.mockResolvedValue(1);
    await expect(service.requestAdjustment(admin, input)).rejects.toMatchObject({
      code: 'ADJUSTMENT_ALREADY_PENDING',
    });
  });

  it('stores the real requester and returns the contract shape', async () => {
    const { service, tx, audit } = setup();
    const result = await service.requestAdjustment(admin, input);
    expect(tx.sessionAdjustRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requestedById: admin.userId,
          sessionCount: 1,
          reasonCode: 'ATTENDANCE_CORRECTION',
        }),
      }),
    );
    expect(result).toMatchObject({
      status: 'PENDING',
      quantity: 1,
      version: 1,
      requestedBy: { displayName: 'Admin MK' },
      branch: { id: branchA },
      customer: { phoneMasked: '0812****' },
      projectedLedgerBalance: 4,
    });
    expect(audit.catat).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ action: 'SESSION_ADJUSTMENT_REQUESTED' }),
    );
    // Saldo belum berubah sebelum ada keputusan.
    expect(tx.paketPelanggan.update).not.toHaveBeenCalled();
    expect(tx.sessionLedger.create).not.toHaveBeenCalled();
  });
});

describe('LedgerService.decideAdjustment', () => {
  it('requires ledger:adjust:decide', async () => {
    const { service } = setup();
    await expect(
      service.decideAdjustment(admin, requestId, 'approve', approve),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('enforces separation of duties', async () => {
    const { service, tx } = setup();
    const selfDeciding = principalFor(admin.userId, ['ledger:adjust:decide']);
    await expect(
      service.decideAdjustment(selfDeciding, requestId, 'approve', approve),
    ).rejects.toMatchObject({ code: 'SEPARATION_OF_DUTIES' });
    expect(tx.paketPelanggan.update).not.toHaveBeenCalled();
    expect(tx.sessionLedger.create).not.toHaveBeenCalled();
  });

  it('allows SUPER_OWNER to approve their own adjustment request', async () => {
    const { service, tx, audit } = setup();
    const superOwner = {
      sessionId: 's',
      userId: admin.userId,
      roles: [{ role: 'SUPER_OWNER' as const, branchId: null }],
      capabilities: ['ledger:adjust:decide', 'ledger:read', 'ledger:adjust:read'],
      branchIds: [branchA],
    };
    const result = await service.decideAdjustment(superOwner, requestId, 'approve', approve);
    expect(tx.paketPelanggan.update).toHaveBeenCalled();
    expect(tx.sessionLedger.create).toHaveBeenCalled();
    expect(result).toMatchObject({
      adjustment: { status: 'POSTED' },
    });
    expect(audit.catat).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ action: 'SESSION_ADJUSTMENT_APPROVED' }),
    );
  });

  it('validates decision and reason code combinations', async () => {
    const { service } = setup();
    await expect(
      service.decideAdjustment(manager, requestId, 'maybe', approve),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      service.decideAdjustment(manager, requestId, 'approve', {
        reasonCode: 'INVALID_EVIDENCE',
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      service.decideAdjustment(manager, requestId, 'reject', approve),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      service.decideAdjustment(manager, requestId, 'approve', { reasonCode: 'CORRECTION_VERIFIED' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('hides requests from a foreign branch', async () => {
    const { service, tx } = setup();
    tx.sessionAdjustRequest.findUnique.mockResolvedValue(
      requestRow({
        customerPackage: pkgRow({
          purchase: { branchId: branchB, branch: { id: branchB, name: 'Lain' } },
        }),
      }),
    );
    await expect(
      service.decideAdjustment(manager, requestId, 'approve', approve),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('rejects stale versions and already decided requests', async () => {
    const { service, tx } = setup();
    await expect(
      service.decideAdjustment(manager, requestId, 'approve', { ...approve, expectedVersion: 7 }),
    ).rejects.toMatchObject({ code: 'ADJUSTMENT_VERSION_CONFLICT' });
    tx.sessionAdjustRequest.findUnique.mockResolvedValue(requestRow({ status: 'APPROVED' }));
    await expect(
      service.decideAdjustment(manager, requestId, 'approve', approve),
    ).rejects.toMatchObject({ code: 'ADJUSTMENT_ALREADY_DECIDED' });
  });

  it('fails when a concurrent decision claims the row first', async () => {
    const { service, tx } = setup();
    tx.sessionAdjustRequest.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.decideAdjustment(manager, requestId, 'approve', approve),
    ).rejects.toMatchObject({ code: 'ADJUSTMENT_VERSION_CONFLICT' });
    expect(tx.sessionLedger.create).not.toHaveBeenCalled();
  });

  it('approval moves the balance and writes an ADJUST_MANUAL ledger entry by the approver', async () => {
    const { service, tx, audit } = setup();
    const result = await service.decideAdjustment(manager, requestId, 'approve', {
      ...approve,
      note: 'Surat dokter terlampir',
    });
    expect(tx.paketPelanggan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ remainingSessions: 4, status: 'ACTIVE' }),
      }),
    );
    expect(tx.sessionLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'ADJUST_MANUAL',
        amount: 1,
        balanceAfter: 4,
        referenceId: requestId,
        createdById: manager.userId,
      }),
    });
    expect(result).toMatchObject({
      resultingBalance: 4,
      ledgerEntry: { type: 'ADJUST_MANUAL', quantity: 1, balanceAfter: 4 },
      adjustment: { status: 'POSTED' },
    });
    expect(audit.catat).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ action: 'SESSION_ADJUSTMENT_APPROVED' }),
    );
  });

  it('approval revives a depleted package and depletes one that reaches zero', async () => {
    const { service, tx } = setup();
    tx.paketPelanggan.findUniqueOrThrow.mockResolvedValue(
      pkgRow({ remainingSessions: 0, status: 'DEPLETED' }),
    );
    await service.decideAdjustment(manager, requestId, 'approve', approve);
    expect(tx.paketPelanggan.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ remainingSessions: 1, status: 'ACTIVE' }),
      }),
    );

    tx.paketPelanggan.findUniqueOrThrow.mockResolvedValue(pkgRow({ remainingSessions: 1 }));
    tx.sessionAdjustRequest.findUnique.mockResolvedValue(requestRow({ sessionCount: -1 }));
    await service.decideAdjustment(manager, requestId, 'approve', approve);
    expect(tx.paketPelanggan.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ remainingSessions: 0, status: 'DEPLETED' }),
      }),
    );
  });

  it('re-checks the balance at approval time', async () => {
    const { service, tx } = setup();
    tx.sessionAdjustRequest.findUnique.mockResolvedValue(requestRow({ sessionCount: -3 }));
    tx.pemesananKelas.count.mockResolvedValue(1);
    await expect(
      service.decideAdjustment(manager, requestId, 'approve', approve),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_SESSION_BALANCE' });
    expect(tx.sessionLedger.create).not.toHaveBeenCalled();
  });

  it('rejection leaves the balance and ledger untouched', async () => {
    const { service, tx } = setup();
    tx.sessionAdjustRequest.findUniqueOrThrow.mockResolvedValue(
      requestRow({ status: 'REJECTED', version: 2, decisionCode: 'INVALID_EVIDENCE' }),
    );
    const result = await service.decideAdjustment(manager, requestId, 'reject', {
      reasonCode: 'INVALID_EVIDENCE',
      expectedVersion: 1,
    });
    expect(tx.paketPelanggan.update).not.toHaveBeenCalled();
    expect(tx.sessionLedger.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ledgerEntry: null,
      resultingBalance: null,
      adjustment: { status: 'REJECTED', decisionCode: 'INVALID_EVIDENCE' },
    });
  });
});

describe('LedgerService reads', () => {
  it('refuses the staff package list to a customer even though they hold ledger:read', async () => {
    const { service, db } = setup();
    await expect(service.listCustomerPackages(customer, {})).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(db.paketPelanggan.findMany).not.toHaveBeenCalled();
  });

  it('scopes package and adjustment lists to the principal branches', async () => {
    const { service, db } = setup();
    db.paketPelanggan.findMany.mockResolvedValue([]);
    await service.listAdjustments(admin, {});
    const where = JSON.stringify(db.sessionAdjustRequest.findMany.mock.calls[0][0].where);
    expect(where).toContain(branchA);
    await expect(service.listAdjustments(admin, { branchId: branchB })).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it('requires ledger:adjust:read to list or read adjustments', async () => {
    const { service } = setup();
    await expect(service.listAdjustments(customer, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.getAdjustment(customer, requestId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('lets the package owner read their own ledger but not another customer', async () => {
    const { service, db } = setup();
    const owner = principalFor(id(200), ['ledger:read'], []);
    const stranger = principalFor(id(201), ['ledger:read'], []);
    (db.paketPelanggan as unknown as { findUnique: jest.Mock }).findUnique.mockResolvedValue({
      ...pkgRow(),
      bookings: [],
    });
    await expect(service.getPackageLedger(owner, packageId)).resolves.toMatchObject({
      page: { hasMore: false },
    });
    await expect(service.getPackageLedger(stranger, packageId)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it('QA-LEDGER-DETAIL: returns accurate balance.usage and full bookingHistory for package', async () => {
    const { service, db } = setup();
    const owner = principalFor(id(200), ['ledger:read'], []);
    (db.paketPelanggan as unknown as { findUnique: jest.Mock }).findUnique.mockResolvedValue({
      ...pkgRow({
        totalSessions: 20,
        usedSessions: 1,
        remainingSessions: 19,
      }),
      bookings: [],
    });
    db.pemesananKelas.findMany = jest.fn().mockResolvedValue([
      {
        id: id(301),
        status: "ATTENDED",
        bookedAt: new Date("2025-01-01T10:00:00Z"),
        user: { id: id(200), displayName: "Maya", phone: "081234567890" },
        classSlot: {
          startAt: new Date("2025-01-02T10:00:00Z"),
          classType: { name: "Private Class" },
          branch: { name: "Green Garden" },
          instructor: { id: id(401), displayName: "Coach Sarah" },
        },
      },
      {
        id: id(302),
        status: "CANCELLED",
        bookedAt: new Date("2024-12-15T10:00:00Z"),
        user: { id: id(200), displayName: "Maya", phone: "081234567890" },
        classSlot: null,
      },
    ]);

    const result = await service.getPackageLedger(owner, packageId);

    // Verify balance.usage contains initialSessions and usedSessions
    expect(result.balance).toMatchObject({
      sessionCountSnapshot: 20,
      usage: {
        initialSessions: 20,
        usedSessions: 1,
      },
    });

    // Verify bookingHistory returns both attended and cancelled
    expect(result.bookingHistory).toHaveLength(2);
    expect(result.bookingHistory[0]).toMatchObject({
      id: id(301),
      bookingStatus: "ATTENDED",
      className: "Private Class",
      branchName: "Green Garden",
      instructorName: "Coach Sarah",
    });
    expect(result.bookingHistory[1]).toMatchObject({
      id: id(302),
      bookingStatus: "CANCELLED",
      className: "Kelas",
    });
  });

  it('NON-HAPPY-LEDGER-DETAIL: gracefully handles package with 0 bookings', async () => {
    const { service, db } = setup();
    const owner = principalFor(id(200), ['ledger:read'], []);
    (db.paketPelanggan as unknown as { findUnique: jest.Mock }).findUnique.mockResolvedValue({
      ...pkgRow({ totalSessions: 10, usedSessions: 0 }),
      bookings: [],
    });
    db.pemesananKelas.findMany = jest.fn().mockResolvedValue([]);

    const result = await service.getPackageLedger(owner, packageId);
    expect(result.bookingHistory).toEqual([]);
    expect(result.balance.usage.usedSessions).toBe(0);
  });
});

describe('LedgerService.getPackageLedger: sesi tertahan sama dengan daftar dan booking', () => {
  it('memakai aturan MEMEGANG_SESI, sehingga yang sudah hadir di kelas belum selesai ikut menahan sesi', async () => {
    const { service, db } = setup();
    const owner = principalFor(id(200), ['ledger:read'], []);
    const findUnique = (db.paketPelanggan as unknown as { findUnique: jest.Mock }).findUnique;
    const booking = (n: number, status: string) => ({
      id: id(500 + n),
      status,
      bookedAt: new Date('2026-11-01T10:00:00Z'),
      classSlot: { startAt: new Date('2026-11-02T10:00:00Z'), classType: { name: 'Group' }, branch: { name: 'MK' } },
    });
    // Sisa buku 3: 1 BOOKED + 2 ATTENDED di kelas yang belum diselesaikan = 3 tertahan.
    findUnique.mockResolvedValue({
      ...pkgRow({ totalSessions: 22, usedSessions: 19, remainingSessions: 3 }),
      bookings: [booking(1, 'BOOKED'), booking(2, 'ATTENDED'), booking(3, 'ATTENDED')],
    });
    db.pemesananKelas.findMany = jest.fn().mockResolvedValue([]);

    const result = await service.getPackageLedger(owner, packageId);

    expect(findUnique.mock.calls[0][0].include.bookings.where).toBe(MEMEGANG_SESI);
    expect(result.balance).toMatchObject({ ledgerBalance: 3, reserved: 3, available: 0 });
    expect(result.reservations.activeQuantity).toBe(3);
  });
});

describe('LedgerService.directAdjustment (Non-Happy Path & Direct Execution)', () => {
  it('TEST-1.1: requires ledger:adjust:decide capability (unauthorized admin is forbidden)', async () => {
    const { service } = setup();
    await expect(
      service.directAdjustment(admin, {
        customerPackageId: packageId,
        quantity: 1,
        reasonCode: 'PACKAGE_COMPENSATION',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('TEST-1.2: isolates branches (manager cannot adjust foreign branch package)', async () => {
    const { service } = setup();
    const managerBranchB = principalFor(id(101), ['ledger:adjust:decide', 'ledger:read'], [branchB]);
    await expect(
      service.directAdjustment(managerBranchB, {
        customerPackageId: packageId,
        quantity: 1,
        reasonCode: 'PACKAGE_COMPENSATION',
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('TEST-1.3: rejects reduction that exceeds remaining balance or active bookings', async () => {
    const { service } = setup();
    await expect(
      service.directAdjustment(manager, {
        customerPackageId: packageId,
        quantity: -10, // balance is 3, cannot reduce by 10
        reasonCode: 'ATTENDANCE_CORRECTION',
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_SESSION_BALANCE' });
  });

  it('TEST-1.4: rejects invalid inputs (0, float, >50, invalid code, bad uuid)', async () => {
    const { service } = setup();
    await expect(
      service.directAdjustment(manager, {
        customerPackageId: packageId,
        quantity: 0,
        reasonCode: 'PACKAGE_COMPENSATION',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      service.directAdjustment(manager, {
        customerPackageId: packageId,
        quantity: 1.5,
        reasonCode: 'PACKAGE_COMPENSATION',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      service.directAdjustment(manager, {
        customerPackageId: packageId,
        quantity: 51,
        reasonCode: 'PACKAGE_COMPENSATION',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      service.directAdjustment(manager, {
        customerPackageId: packageId,
        quantity: 1,
        reasonCode: 'INVALID_CODE',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      service.directAdjustment(manager, {
        customerPackageId: 'not-a-uuid',
        quantity: 1,
        reasonCode: 'PACKAGE_COMPENSATION',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('TEST-1.5: allows MANAGER to directly adjust sessions in 1 click', async () => {
    const { service, tx, audit } = setup();
    const branchManager = {
      ...manager,
      roles: [{ role: 'MANAGER' as const, branchId: branchA }],
    };
    const result = await service.directAdjustment(branchManager, {
      customerPackageId: packageId,
      quantity: 2,
      reasonCode: 'PACKAGE_COMPENSATION',
      note: 'Kompensasi AC ruang reformer bocor',
    });

    expect(tx.paketPelanggan.update).toHaveBeenCalledWith({
      where: { id: packageId },
      data: { remainingSessions: 5, status: 'ACTIVE' },
    });
    expect(tx.sessionAdjustRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'APPROVED',
          sessionCount: 2,
          requestedById: branchManager.userId,
          approvedById: branchManager.userId,
        }),
      }),
    );
    expect(tx.sessionLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'ADJUST_MANUAL',
          amount: 2,
          balanceAfter: 5,
          createdById: branchManager.userId,
        }),
      }),
    );
    expect(audit.catat).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ action: 'SESSION_ADJUSTMENT_DIRECT_APPLIED' }),
    );
    expect(result).toMatchObject({
      resultingBalance: 5,
      adjustment: { status: 'POSTED' },
    });
  });

  it('TEST-1.6: allows SUPER_OWNER to approve their own request via decideAdjustment without SEPARATION_OF_DUTIES', async () => {
    const { service, tx } = setup();
    const branchManager = {
      sessionId: 's',
      userId: admin.userId, // same user as requester
      roles: [{ role: 'SUPER_OWNER' as const, branchId: branchA }],
      capabilities: ['ledger:adjust:decide', 'ledger:read', 'ledger:adjust:read'],
      branchIds: [branchA],
    };
    const approve = { reasonCode: 'CORRECTION_VERIFIED', expectedVersion: 1 };
    const result = await service.decideAdjustment(branchManager, requestId, 'approve', approve);
    expect(tx.paketPelanggan.update).toHaveBeenCalled();
    expect(tx.sessionLedger.create).toHaveBeenCalled();
    expect(result).toMatchObject({
      adjustment: { status: 'POSTED' },
    });
  });

  it('TEST-1.7: requestAdjustment with direct: true executes directAdjustment directly', async () => {
    const { service, tx } = setup();
    const branchManager = {
      ...manager,
      roles: [{ role: 'MANAGER' as const, branchId: branchA }],
    };
    const result = await service.requestAdjustment(branchManager, {
      customerPackageId: packageId,
      quantity: 1,
      reasonCode: 'ATTENDANCE_CORRECTION',
      direct: true,
    });
    expect(tx.paketPelanggan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ remainingSessions: 4 }),
      }),
    );
    expect(result).toMatchObject({
      resultingBalance: 4,
      adjustment: { status: 'POSTED' },
    });
  });
});


describe("LedgerService.syncCustomerPackage & previewSyncCustomerPackage (Super Admin QA & Non-Happy Path)", () => {
  const superOwner = {
    sessionId: "s-super",
    userId: id(999),
    roles: [{ role: "SUPER_OWNER" as const, branchId: null }],
    capabilities: ["ledger:read", "ledger:adjust:read", "ledger:adjust:decide", "customer-package:manage"],
    branchIds: [],
  };

  const staffAdmin = {
    sessionId: "s-admin",
    userId: id(100),
    roles: [{ role: "ADMIN" as const, branchId: branchA }],
    capabilities: ["ledger:read", "ledger:adjust:read", "customer-package:manage"],
    branchIds: [branchA],
  };

  describe("previewSyncCustomerPackage", () => {
    it("QA-SYNC-1: calculates preview metrics accurately from booking history and adjustments", async () => {
      const { service, db } = setup();
      db.paketPelanggan.findUnique = jest.fn().mockResolvedValue(
        pkgRow({
          totalSessions: 10,
          remainingSessions: 5, // currently recorded 5
          usedSessions: 2,      // currently recorded 2
          status: "ACTIVE",
        }),
      );
      db.pemesananKelas.groupBy = jest.fn().mockResolvedValue([
        { status: "ATTENDED", _count: { _all: 3 } },
        { status: "NO_SHOW", _count: { _all: 1 } },
        { status: "BOOKED", _count: { _all: 2 } },
        { status: "CANCELLED", _count: { _all: 4 } },
      ]);
      db.sessionAdjustRequest.aggregate = jest.fn().mockResolvedValue({
        _sum: { sessionCount: 1 }, // +1 approved adjustment
      });

      const preview = await service.previewSyncCustomerPackage(superOwner, packageId);

      // calculatedUsed = 3 (ATTENDED) + 1 (NO_SHOW) = 4
      // calculatedRemaining = 10 - 4 + 1 = 7
      // drift = 7 - 5 = +2
      // reserved = 2 (BOOKED)
      // available = 7 - 2 = 5
      expect(preview).toEqual({
        packageId,
        packageName: "Paket 4",
        customerName: "Maya",
        totalSessions: 10,
        current: {
          remainingSessions: 5,
          usedSessions: 2,
          reservedSessions: 2,
          availableSessions: 3, // 5 - 2
          status: "ACTIVE",
        },
        calculated: {
          remainingSessions: 7,
          usedSessions: 4,
          reservedSessions: 2,
          availableSessions: 5, // 7 - 2
          status: "ACTIVE",
        },
        breakdown: {
          attendedCount: 3,
          noShowCount: 1,
          bookedCount: 2,
          cancelledCount: 4,
          approvedAdjustmentsDelta: 1,
        },
        drift: 2,
        hasDrift: true,
      });
    });

    it("NON-HAPPY-1: rejects non-SUPER_OWNER caller with 403 FORBIDDEN", async () => {
      const { service } = setup();
      await expect(service.previewSyncCustomerPackage(staffAdmin, packageId)).rejects.toMatchObject({
        status: 403,
        code: "FORBIDDEN",
      });
      await expect(service.previewSyncCustomerPackage(customer, packageId)).rejects.toMatchObject({
        status: 403,
        code: "FORBIDDEN",
      });
    });

    it("NON-HAPPY-2: rejects invalid UUID package id with 404 RESOURCE_NOT_FOUND", async () => {
      const { service } = setup();
      await expect(service.previewSyncCustomerPackage(superOwner, "invalid-uuid")).rejects.toMatchObject({
        status: 404,
        code: "RESOURCE_NOT_FOUND",
      });
    });

    it("NON-HAPPY-3: throws 404 RESOURCE_NOT_FOUND when package does not exist", async () => {
      const { service, db } = setup();
      db.paketPelanggan.findUnique = jest.fn().mockResolvedValue(null);
      await expect(service.previewSyncCustomerPackage(superOwner, packageId)).rejects.toMatchObject({
        status: 404,
        code: "RESOURCE_NOT_FOUND",
      });
    });
  });

  describe("syncCustomerPackage", () => {
    it("QA-SYNC-2: executes sync, writes session ledger and audit log, and updates package", async () => {
      const { service, tx, audit } = setup();
      tx.paketPelanggan.findUnique = jest.fn().mockResolvedValue(
        pkgRow({
          totalSessions: 10,
          remainingSessions: 5,
          usedSessions: 2,
          status: "ACTIVE",
        }),
      );
      tx.pemesananKelas.groupBy = jest.fn().mockResolvedValue([
        { status: "ATTENDED", _count: { _all: 3 } },
        { status: "NO_SHOW", _count: { _all: 1 } },
        { status: "BOOKED", _count: { _all: 1 } },
      ]);
      tx.sessionAdjustRequest.aggregate = jest.fn().mockResolvedValue({
        _sum: { sessionCount: 0 },
      });
      tx.paketPelanggan.findUniqueOrThrow = jest.fn().mockResolvedValue(
        pkgRow({
          totalSessions: 10,
          remainingSessions: 6,
          usedSessions: 4,
          status: "ACTIVE",
        }),
      );

      const result = await service.syncCustomerPackage(superOwner, packageId, {
        reason: "Koreksi riwayat kehadiran member oleh Super Admin",
      });

      // calculatedRemaining: 10 - 4 = 6. drift: 6 - 5 = 1
      expect(tx.paketPelanggan.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: packageId },
          data: {
            remainingSessions: 6,
            usedSessions: 4,
            status: "ACTIVE",
          },
        }),
      );

      expect(tx.sessionLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerPackageId: packageId,
            type: "ADJUST_MANUAL",
            amount: 1,
            balanceAfter: 6,
            createdById: superOwner.userId,
            notes: expect.stringContaining("Sinkronisasi riwayat sesi Super Admin (drift: +1)"),
          }),
        }),
      );

      expect(audit.catat).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          action: "CUSTOMER_PACKAGE_SYNC",
          objectId: packageId,
          objectType: "PaketPelanggan",
          actorId: superOwner.userId,
        }),
      );

      expect(result.drift).toBe(1);
      expect(result.calculated.remainingSessions).toBe(6);
      expect(result.calculated.usedSessions).toBe(4);
    });

    it("NON-HAPPY-4: rejects non-SUPER_OWNER caller with 403 FORBIDDEN", async () => {
      const { service } = setup();
      await expect(
        service.syncCustomerPackage(staffAdmin, packageId, { reason: "Valid reason here" }),
      ).rejects.toMatchObject({
        status: 403,
        code: "FORBIDDEN",
      });
    });

    it("NON-HAPPY-5: rejects missing, empty, or short (< 5 chars) reason with 422 VALIDATION_ERROR", async () => {
      const { service } = setup();
      await expect(
        service.syncCustomerPackage(superOwner, packageId, { reason: "" }),
      ).rejects.toMatchObject({
        status: 422,
        code: "VALIDATION_ERROR",
      });
      await expect(
        service.syncCustomerPackage(superOwner, packageId, { reason: "abc" }),
      ).rejects.toMatchObject({
        status: 422,
        code: "VALIDATION_ERROR",
      });
      await expect(
        service.syncCustomerPackage(superOwner, packageId, {} as never),
      ).rejects.toMatchObject({
        status: 422,
        code: "VALIDATION_ERROR",
      });
    });

    it("NON-HAPPY-6: rejects reason exceeding 500 characters with 422 VALIDATION_ERROR", async () => {
      const { service } = setup();
      const longReason = "A".repeat(501);
      await expect(
        service.syncCustomerPackage(superOwner, packageId, { reason: longReason }),
      ).rejects.toMatchObject({
        status: 422,
        code: "VALIDATION_ERROR",
      });
    });

    it("NON-HAPPY-7: sets status to DEPLETED when remaining sessions reach 0", async () => {
      const { service, tx } = setup();
      tx.paketPelanggan.findUnique = jest.fn().mockResolvedValue(
        pkgRow({
          totalSessions: 2,
          remainingSessions: 1,
          usedSessions: 1,
          status: "ACTIVE",
        }),
      );
      tx.pemesananKelas.groupBy = jest.fn().mockResolvedValue([
        { status: "ATTENDED", _count: { _all: 2 } },
      ]);
      tx.sessionAdjustRequest.aggregate = jest.fn().mockResolvedValue({
        _sum: { sessionCount: 0 },
      });
      tx.paketPelanggan.findUniqueOrThrow = jest.fn().mockResolvedValue(
        pkgRow({
          totalSessions: 2,
          remainingSessions: 0,
          usedSessions: 2,
          status: "DEPLETED",
        }),
      );

      await service.syncCustomerPackage(superOwner, packageId, {
        reason: "Sinkronisasi sesi habis",
      });

      expect(tx.paketPelanggan.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            remainingSessions: 0,
            usedSessions: 2,
            status: "DEPLETED",
          }),
        }),
      );
    });

    it("NON-HAPPY-8: preserves FROZEN status when package is frozen", async () => {
      const { service, tx } = setup();
      tx.paketPelanggan.findUnique = jest.fn().mockResolvedValue(
        pkgRow({
          totalSessions: 5,
          remainingSessions: 5,
          usedSessions: 0,
          status: "FROZEN",
        }),
      );
      tx.pemesananKelas.groupBy = jest.fn().mockResolvedValue([]);
      tx.sessionAdjustRequest.aggregate = jest.fn().mockResolvedValue({
        _sum: { sessionCount: 0 },
      });
      tx.paketPelanggan.findUniqueOrThrow = jest.fn().mockResolvedValue(
        pkgRow({
          totalSessions: 5,
          remainingSessions: 5,
          usedSessions: 0,
          status: "FROZEN",
        }),
      );

      const res = await service.syncCustomerPackage(superOwner, packageId, {
        reason: "Sinkronisasi paket beku",
      });

      expect(tx.paketPelanggan.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "FROZEN",
          }),
        }),
      );
      expect(res.calculated.status).toBe("FROZEN");
    });
  });
});
