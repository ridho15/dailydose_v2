import { PolicyService } from '../identity/policy.service';
import { LedgerService } from './ledger.service';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const branchA = id(1);
const branchB = id(2);
const packageId = id(10);
const DAY = 86_400_000;

const principalFor = (capabilities: string[], branchIds = [branchA]) => ({
  sessionId: 's',
  userId: id(101),
  roles: [] as never,
  capabilities,
  branchIds,
});
const manager = principalFor(['customer-package:manage']);

const pkgRow = (overrides: Record<string, unknown> = {}) => ({
  id: packageId,
  userId: id(200),
  remainingSessions: 3,
  usedSessions: 1,
  totalSessions: 4,
  status: 'ACTIVE',
  frozenAt: null,
  validFrom: new Date('2026-01-01'),
  validUntil: new Date(Date.now() + 30 * DAY),
  purchaseId: id(30),
  user: { id: id(200), displayName: 'Maya', phone: '081234567890' },
  package: { id: id(40), name: 'Paket 4', classType: { id: id(41), name: 'Reformer' } },
  purchase: { branchId: branchA, branch: { id: branchA, name: 'Green Garden' } },
  ...overrides,
});

function setup(row = pkgRow(), upcomingBookings = 0) {
  const applied: Array<Record<string, any>> = [];
  const tx = {
    paketPelanggan: {
      findUnique: jest.fn().mockResolvedValue(row),
      updateMany: jest.fn().mockImplementation(async (args) => {
        applied.push(args);
        return { count: 1 };
      }),
      findUniqueOrThrow: jest.fn().mockImplementation(async () => ({
        ...row,
        ...(applied.at(-1)?.data ?? {}),
      })),
    },
    pemesananKelas: { count: jest.fn().mockResolvedValue(upcomingBookings) },
    sessionLedger: {
      create: jest.fn().mockImplementation(async ({ data }) => ({
        id: id(50),
        createdAt: new Date(),
        ...data,
      })),
    },
  };
  const db = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    pemesananKelas: { groupBy: jest.fn().mockResolvedValue([]) },
  };
  const audit = { catat: jest.fn().mockResolvedValue(undefined) };
  const service = new LedgerService(db as never, new PolicyService(), audit as never);
  return { service, tx, applied, audit };
}

const reason = { reason: 'Pelanggan sakit dua minggu' };

describe('customer package actions: access and validation', () => {
  it('requires customer-package:manage and hides packages of another branch', async () => {
    const { service, tx } = setup();
    await expect(
      service.manageCustomerPackage(principalFor([]), packageId, 'freeze', reason),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      service.manageCustomerPackage(principalFor(['customer-package:manage'], [branchB]), packageId, 'freeze', reason),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(tx.paketPelanggan.updateMany).not.toHaveBeenCalled();
  });

  it('validates the action, the reason length and the number of days', async () => {
    const { service, tx } = setup();
    await expect(
      service.manageCustomerPackage(manager, packageId, 'delete', reason),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    for (const value of [undefined, '  ', 'ab', 'x'.repeat(501)])
      await expect(
        service.manageCustomerPackage(manager, packageId, 'freeze', { reason: value }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    for (const days of [undefined, 0, 181, 1.5])
      await expect(
        service.manageCustomerPackage(manager, packageId, 'extend', { ...reason, days }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(tx.paketPelanggan.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a stale screen (validUntil changed since it was loaded)', async () => {
    const { service } = setup();
    await expect(
      service.manageCustomerPackage(manager, packageId, 'extend', {
        ...reason,
        days: 7,
        expectedValidUntil: new Date(Date.now() + DAY).toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'PACKAGE_CHANGED' });
  });
});

describe('extend', () => {
  it('adds days after the current expiry, keeps the balance and leaves a zero-amount ledger entry', async () => {
    const row = pkgRow();
    const { service, applied, tx, audit } = setup(row);
    const result = await service.manageCustomerPackage(manager, packageId, 'extend', {
      ...reason,
      days: 14,
      expectedValidUntil: row.validUntil.toISOString(),
    });
    expect(applied[0]!.data.validUntil.getTime()).toBe(row.validUntil.getTime() + 14 * DAY);
    expect(applied[0]!.data.status).toBe('ACTIVE');
    expect(applied[0]!.where).toMatchObject({ id: packageId, status: 'ACTIVE', remainingSessions: 3 });
    expect(tx.sessionLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'ADJUST_MANUAL',
        amount: 0,
        balanceAfter: 3,
        createdById: manager.userId,
        notes: expect.stringContaining('Perpanjang masa berlaku 14 hari'),
      }),
    });
    expect(result.balance).toMatchObject({ ledgerBalance: 3 });
    expect(audit.catat).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ action: 'CUSTOMER_PACKAGE_EXTEND', actorId: manager.userId }),
    );
  });

  it('extends package by explicit newValidUntil date', async () => {
    const row = pkgRow();
    const { service, applied } = setup(row);
    const targetDate = new Date(row.validUntil.getTime() + 45 * DAY);
    await service.manageCustomerPackage(manager, packageId, 'extend', {
      ...reason,
      newValidUntil: targetDate.toISOString(),
      expectedValidUntil: row.validUntil.toISOString(),
    });
    expect(applied[0]!.data.validUntil.getTime()).toBe(targetDate.getTime());
    expect(applied[0]!.data.status).toBe('ACTIVE');
  });

  it('allows staff/admin to set any date freely without restriction', async () => {
    const row = pkgRow();
    const { service, applied } = setup(row);
    const customDate = new Date(row.validUntil.getTime() - 5 * DAY);
    await service.manageCustomerPackage(manager, packageId, 'extend', {
      ...reason,
      newValidUntil: customDate.toISOString(),
    });
    expect(applied[0]!.data.validUntil.getTime()).toBe(customDate.getTime());
  });

  it('counts from today for an already expired package and reactivates it', async () => {
    const { service, applied } = setup(
      pkgRow({ status: 'EXPIRED', validUntil: new Date(Date.now() - 10 * DAY) }),
    );
    await service.manageCustomerPackage(manager, packageId, 'extend', { ...reason, days: 30 });
    const until = applied[0]!.data.validUntil.getTime();
    expect(until).toBeGreaterThan(Date.now() + 29 * DAY);
    expect(until).toBeLessThan(Date.now() + 31 * DAY);
    expect(applied[0]!.data.status).toBe('ACTIVE');
  });

  it('refuses a frozen package and one without remaining sessions', async () => {
    await expect(
      setup(pkgRow({ status: 'FROZEN' })).service.manageCustomerPackage(manager, packageId, 'extend', {
        ...reason,
        days: 7,
      }),
    ).rejects.toMatchObject({ code: 'PACKAGE_FROZEN' });
    await expect(
      setup(pkgRow({ remainingSessions: 0, status: 'DEPLETED' })).service.manageCustomerPackage(
        manager,
        packageId,
        'extend',
        { ...reason, days: 7 },
      ),
    ).rejects.toMatchObject({ code: 'NO_REMAINING_SESSIONS' });
  });
});

describe('freeze and unfreeze', () => {
  it('freezes an active package and records when', async () => {
    const { service, applied } = setup();
    const result = await service.manageCustomerPackage(manager, packageId, 'freeze', reason);
    expect(applied[0]!.data).toMatchObject({ status: 'FROZEN' });
    expect(applied[0]!.data.frozenAt).toBeInstanceOf(Date);
    expect(result.balance).toMatchObject({ status: 'FROZEN', available: 0 });
  });

  it('refuses to freeze with upcoming bookings, or a package that is not active', async () => {
    await expect(
      setup(pkgRow(), 2).service.manageCustomerPackage(manager, packageId, 'freeze', reason),
    ).rejects.toMatchObject({ code: 'HAS_UPCOMING_BOOKINGS' });
    await expect(
      setup(pkgRow({ status: 'EXPIRED' })).service.manageCustomerPackage(manager, packageId, 'freeze', reason),
    ).rejects.toMatchObject({ code: 'PACKAGE_NOT_ACTIVE' });
    await expect(
      setup(pkgRow({ validUntil: new Date(Date.now() - DAY) })).service.manageCustomerPackage(
        manager,
        packageId,
        'freeze',
        reason,
      ),
    ).rejects.toMatchObject({ code: 'PACKAGE_NOT_ACTIVE' });
  });

  it('unfreezing pushes the expiry out by the frozen duration and reactivates', async () => {
    const validUntil = new Date(Date.now() + 10 * DAY);
    const { service, applied, tx } = setup(
      pkgRow({ status: 'FROZEN', validUntil, frozenAt: new Date(Date.now() - 5 * DAY) }),
    );
    await service.manageCustomerPackage(manager, packageId, 'unfreeze', reason);
    const added = applied[0]!.data.validUntil.getTime() - validUntil.getTime();
    expect(added).toBeGreaterThanOrEqual(5 * DAY - 1000);
    expect(added).toBeLessThanOrEqual(5 * DAY + 5000);
    expect(applied[0]!.data).toMatchObject({ status: 'ACTIVE', frozenAt: null });
    expect(tx.sessionLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ amount: 0, notes: expect.stringContaining('dibuka kembali') }),
    });
  });

  it('refuses to unfreeze a package that is not frozen and fails when a concurrent change wins', async () => {
    await expect(
      setup().service.manageCustomerPackage(manager, packageId, 'unfreeze', reason),
    ).rejects.toMatchObject({ code: 'PACKAGE_NOT_FROZEN' });
    const raced = setup();
    raced.tx.paketPelanggan.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      raced.service.manageCustomerPackage(manager, packageId, 'freeze', reason),
    ).rejects.toMatchObject({ code: 'PACKAGE_CHANGED' });
    expect(raced.tx.sessionLedger.create).not.toHaveBeenCalled();
  });
});
