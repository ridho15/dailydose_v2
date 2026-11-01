import { PolicyService } from '../identity/policy.service';
import { FinanceService } from './finance.service';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const branchA = id(1);
const costId = id(10);

const principalFor = (capabilities: string[], branchIds = [branchA]) => ({
  sessionId: 's',
  userId: id(100),
  roles: [{ role: 'MANAGER', branchId: branchA }] as never,
  capabilities,
  branchIds,
});
const manager = principalFor(['finance:manage']);

function setup() {
  const row = {
    id: costId,
    branchId: branchA,
    period: '2026-09',
    incurredOn: new Date('2026-09-10T00:00:00.000Z'),
    category: 'SEWA',
    description: 'Sewa studio',
    amountRp: 5_000_000,
  };
  const db = {
    pembayarPengeluaran: { deleteMany: jest.fn(), create: jest.fn(), findMany: jest.fn(async () => []) },
    otherCost: {
      findUnique: jest.fn().mockResolvedValue(row),
      update: jest.fn().mockImplementation(async ({ data }) => ({ ...row, ...data })),
      create: jest.fn().mockImplementation(async ({ data }) => ({ id: costId, ...data })),
      delete: jest.fn().mockResolvedValue({}),
    },
    cabang: { findUnique: jest.fn().mockResolvedValue({ id: branchA }) },
  };
  const audit = { catat: jest.fn().mockResolvedValue(undefined) };
  const service = new FinanceService(db as never, new PolicyService(), audit as never);
  return { service, db, audit };
}

describe('FinanceService.updateOtherCost', () => {
  it('requires finance:manage and the cost branch', async () => {
    const { service, db } = setup();
    await expect(
      service.updateOtherCost(principalFor([]), costId, { amountRp: 1 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      service.updateOtherCost(
        { ...principalFor(['finance:manage'], [id(9)]), roles: [{ role: 'MANAGER', branchId: id(9) }] as never },
        costId,
        { amountRp: 1 },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(db.otherCost.update).not.toHaveBeenCalled();
  });

  it('updates only the fields given and normalizes the category', async () => {
    const { service, db } = setup();
    await service.updateOtherCost(manager, costId, {
      categoryCode: ' listrik ',
      description: '  Listrik September ',
      amountRp: 750_000,
    });
    expect(db.otherCost.update).toHaveBeenCalledWith({
      where: { id: costId },
      data: { category: 'LISTRIK', description: 'Listrik September', amountRp: 750_000 },
    });
    await service.updateOtherCost(manager, costId, { amountRp: 900_000 });
    expect(db.otherCost.update).toHaveBeenLastCalledWith({
      where: { id: costId },
      data: { amountRp: 900_000 },
    });
  });

  it('validates category, description and amount, and refuses an empty change', async () => {
    const { service, db } = setup();
    await expect(
      service.updateOtherCost(manager, costId, { category: '1 salah' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      service.updateOtherCost(manager, costId, { description: '   ' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    for (const amountRp of [0, -1, 1.5, Number.NaN])
      await expect(
        service.updateOtherCost(manager, costId, { amountRp }),
      ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
    await expect(service.updateOtherCost(manager, costId, {})).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(db.otherCost.update).not.toHaveBeenCalled();
  });

  it('moves a cost to another date and keeps the month in step', async () => {
    const { service, db } = setup();
    await service.updateOtherCost(manager, costId, { incurredOn: '2026-10-03' });
    expect(db.otherCost.update).toHaveBeenCalledWith({
      where: { id: costId },
      data: { incurredOn: new Date('2026-10-03T00:00:00.000Z'), period: '2026-10' },
    });
    await expect(
      service.updateOtherCost(manager, costId, { incurredOn: '2026-02-30' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('is never blocked by a month close: there are no closed periods any more', async () => {
    const { service, db } = setup();
    await service.updateOtherCost(manager, costId, { amountRp: 1_000 });
    expect(db.otherCost.update).toHaveBeenCalled();
  });

  it('returns not found for a missing cost', async () => {
    const { service, db } = setup();
    db.otherCost.findUnique.mockResolvedValue(null);
    await expect(
      service.updateOtherCost(manager, costId, { amountRp: 1_000 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('FinanceService.createOtherCost', () => {
  const base = { branchId: branchA, incurredOn: '2026-09-12', description: 'Sewa', amountRp: 100_000 };

  it('uses the category code sent by the finance panel instead of dropping it', async () => {
    const { service, db } = setup();
    await service.createOtherCost(manager, { ...base, categoryCode: 'sewa_studio' });
    expect(db.otherCost.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ category: 'SEWA_STUDIO' }),
    });
    await service.createOtherCost(manager, base);
    expect(db.otherCost.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ category: 'OTHER' }),
    });
  });

  it('stores the spending date and derives the month from it', async () => {
    const { service, db } = setup();
    await service.createOtherCost(manager, base);
    expect(db.otherCost.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ incurredOn: new Date('2026-09-12T00:00:00.000Z'), period: '2026-09' }),
    });
  });

  it('still accepts the old month-only input (dated on the 1st) and refuses a missing or invalid date', async () => {
    const { service, db } = setup();
    await service.createOtherCost(manager, { branchId: branchA, period: '2026-09', description: 'Sewa', amountRp: 100 });
    expect(db.otherCost.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ incurredOn: new Date('2026-09-01T00:00:00.000Z'), period: '2026-09' }),
    });
    await expect(
      service.createOtherCost(manager, { branchId: branchA, description: 'x', amountRp: 100 }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      service.createOtherCost(manager, { ...base, incurredOn: '12/09/2026' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects fractional amounts that the integer column cannot hold', async () => {
    const { service, db } = setup();
    await expect(
      service.createOtherCost(manager, { ...base, amountRp: 99.5 }),
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
    expect(db.otherCost.create).not.toHaveBeenCalled();
  });
});

describe('other costs are audited permanently', () => {
  it('records creation and updates (amounts and category, never the free-text description)', async () => {
    const { service, audit } = setup();
    await service.createOtherCost(manager, { branchId: branchA, incurredOn: '2026-09-12', category: 'sewa', description: 'Sewa', amountRp: 100 });
    expect(audit.catat).toHaveBeenLastCalledWith(
      null,
      expect.objectContaining({ action: 'finance.other_cost_created', objectType: 'OtherCost', branchId: branchA }),
    );
    await service.updateOtherCost(manager, costId, { amountRp: 7_000_000 });
    expect(audit.catat).toHaveBeenLastCalledWith(
      null,
      expect.objectContaining({
        action: 'finance.other_cost_updated',
        beforeMasked: { incurredOn: '2026-09-10', category: 'SEWA', amountRp: 5_000_000 },
        afterMasked: expect.objectContaining({ amountRp: 7_000_000 }),
      }),
    );
  });

  it('deleting needs a typed reason, changes nothing without it, and keeps a snapshot', async () => {
    const { service, db, audit } = setup();
    for (const reason of [undefined, '', '  ', 'ab'])
      await expect(service.deleteOtherCost(manager, costId, reason)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(db.otherCost.delete).not.toHaveBeenCalled();
    await service.deleteOtherCost(manager, costId, ' Salah input ');
    expect(db.otherCost.delete).toHaveBeenCalledWith({ where: { id: costId } });
    expect(audit.catat).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        action: 'finance.other_cost_deleted',
        reason: 'Salah input',
        beforeMasked: expect.objectContaining({ category: 'SEWA', amountRp: 5_000_000, incurredOn: '2026-09-10' }),
      }),
    );
  });
});

describe('Grace Period 15 Menit Pengeluaran Kas', () => {
  const staffId = id(200);
  const staffKasir = {
    sessionId: 's',
    userId: staffId,
    roles: [{ role: 'ADMIN', branchId: branchA }] as never,
    capabilities: ['expense:create'],
    branchIds: [branchA],
  };

  it('staf kasir (expense:create) dapat mengoreksi pengeluarannya sendiri dalam jendela toleransi 15 menit', async () => {
    const { service, db, audit } = setup();
    const rowBaru = {
      id: costId,
      branchId: branchA,
      category: 'SUPPLIES',
      description: 'Beli galon air',
      amountRp: 500_000,
      createdById: staffId,
      createdAt: new Date(),
    };
    db.otherCost.findUnique.mockResolvedValue(rowBaru);

    await service.updateOtherCost(staffKasir, costId, { amountRp: 50_000 });
    expect(db.otherCost.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: costId },
        data: expect.objectContaining({ amountRp: 50_000 }),
      }),
    );
    expect(audit.catat).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ action: 'finance.other_cost_corrected_grace_period' }),
    );
  });

  it('staf kasir dapat membatalkan pengeluarannya sendiri dalam jendela toleransi 15 menit', async () => {
    const { service, db, audit } = setup();
    const rowBaru = {
      id: costId,
      branchId: branchA,
      category: 'SUPPLIES',
      description: 'Beli galon air',
      amountRp: 50_000,
      createdById: staffId,
      createdAt: new Date(),
    };
    db.otherCost.findUnique.mockResolvedValue(rowBaru);

    await service.deleteOtherCost(staffKasir, costId);
    expect(db.otherCost.delete).toHaveBeenCalledWith({ where: { id: costId } });
    expect(audit.catat).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ action: 'finance.other_cost_deleted_grace_period' }),
    );
  });

  it('menolak koreksi staf kasir jika sudah lewat dari 15 menit (harus lewat finance:manage)', async () => {
    const { service, db } = setup();
    const rowKedaluwarsa = {
      id: costId,
      branchId: branchA,
      category: 'SUPPLIES',
      description: 'Beli galon air',
      amountRp: 50_000,
      createdById: staffId,
      createdAt: new Date(Date.now() - 20 * 60 * 1000),
    };
    db.otherCost.findUnique.mockResolvedValue(rowKedaluwarsa);

    await expect(
      service.updateOtherCost(staffKasir, costId, { amountRp: 60_000 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      service.deleteOtherCost(staffKasir, costId),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
