import { PolicyService } from '../identity/policy.service';
import { PackageAccessService } from './package-access.service';
import { PackagePricingService } from './kalkulasi-harga-paket.service';
import { PackagePromotionService } from './package-promotion.service';
import { CustomerOrderService } from './pembelian-paket.service';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const packageId = id(40);
const promoId = id(80);
const DAY = 86_400_000;
const NOW = Date.now();

const manager = {
  sessionId: 's',
  userId: id(100),
  roles: [] as never,
  capabilities: ['package-promotion:read', 'package-promotion:manage'],
  branchIds: [] as string[],
};
const reader = { ...manager, capabilities: ['package-promotion:read'] };

const promoRow = (overrides: Record<string, unknown> = {}) => ({
  id: promoId,
  packageId,
  name: 'Promo Akhir Tahun',
  label: 'Hemat 10%',
  discountType: 'PERCENTAGE',
  discountValue: 10,
  activeFrom: new Date(NOW - DAY),
  activeUntil: new Date(NOW + 5 * DAY),
  status: 'ACTIVE',
  version: 1,
  createdAt: new Date(NOW),
  updatedAt: new Date(NOW),
  package: { priceRp: 1_000_000 },
  ...overrides,
});

const command = (overrides: Record<string, unknown> = {}) => ({
  name: 'Promo Baru',
  discountType: 'PERCENTAGE' as const,
  discountValue: 15,
  activeFrom: new Date(NOW + DAY).toISOString(),
  activeUntil: new Date(NOW + 10 * DAY).toISOString(),
  ...overrides,
});

function setup(current = promoRow(), clash: unknown = null) {
  const tx = {
    packagePromotion: {
      findFirst: jest.fn().mockResolvedValue(clash),
      create: jest.fn().mockImplementation(async ({ data }) => ({
        ...promoRow(),
        ...data,
        id: id(81),
        version: 1,
        createdAt: new Date(NOW),
        updatedAt: new Date(NOW),
      })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockImplementation(async () => ({ ...current, version: current.version + 1 })),
    },
  };
  const db = {
    paket: {
      findUnique: jest.fn().mockResolvedValue({
        id: packageId,
        code: 'P8',
        name: 'Paket 8',
        priceRp: 1_000_000,
        sessionCount: 8,
        validityDays: 60,
        status: 'ACTIVE',
        createdAt: new Date(NOW),
        classType: null,
        classTypeId: null,
        _count: { purchases: 0, customerPackages: 0 },
      }),
    },
    packagePromotion: {
      findUnique: jest.fn().mockResolvedValue(current),
      findMany: jest.fn().mockResolvedValue([current]),
    },
    pembelian: {
      groupBy: jest.fn().mockResolvedValue([{ promotionId: promoId, _count: { _all: 4 } }]),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const idempotency = {
    execute: jest.fn(async (_c: unknown, action: (t: typeof tx) => Promise<unknown>) => action(tx)),
  };
  const audit = { record: jest.fn(), catat: jest.fn().mockResolvedValue(undefined) };
  const service = new PackagePromotionService(
    db as never,
    new PackageAccessService({} as never, new PolicyService(), audit as never),
    idempotency as never,
    audit as never,
  );
  return { service, tx, db, audit };
}

describe('package promotions: access and reading', () => {
  it('needs read or manage capability, and only manage can change anything', async () => {
    const { service } = setup();
    const nobody = { ...manager, capabilities: [] as string[] };
    await expect(service.list(nobody, packageId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.create(reader, packageId, command(), 'k-12345678', 'c')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      service.update(reader, promoId, { discountValue: 5, expectedVersion: 1 }, 'k-12345678', 'c'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      service.transition(reader, promoId, 'PAUSED', { expectedVersion: 1 }, 'k-12345678', 'c'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('lists real promotions with computed price, state and usage', async () => {
    const { service } = setup();
    const result = await service.list(reader, packageId);
    expect(result.items[0]).toMatchObject({
      id: promoId,
      status: 'ACTIVE',
      effectiveState: 'LIVE',
      discountRp: 100_000,
      promotionalPriceRp: 900_000,
      usageCount: 4,
      version: 1,
    });
    const detail = await service.packageDetail(reader, packageId);
    expect(detail.promotions).toHaveLength(1);
  });

  it('reports scheduled and expired windows instead of LIVE', async () => {
    const future = setup(promoRow({ activeFrom: new Date(NOW + DAY), activeUntil: new Date(NOW + 3 * DAY) }));
    expect((await future.service.list(reader, packageId)).items[0]).toMatchObject({ effectiveState: 'SCHEDULED' });
    const past = setup(promoRow({ activeFrom: new Date(NOW - 5 * DAY), activeUntil: new Date(NOW - DAY) }));
    expect((await past.service.list(reader, packageId)).items[0]).toMatchObject({ effectiveState: 'EXPIRED' });
    const paused = setup(promoRow({ status: 'PAUSED' }));
    expect((await paused.service.list(reader, packageId)).items[0]).toMatchObject({ effectiveState: 'PAUSED' });
  });
});

describe('package promotions: create', () => {
  it('validates name, discount, dates and stays inside the package price', async () => {
    const { service, tx } = setup();
    const bad = [
      command({ name: 'x' }),
      command({ discountType: 'BOGUS' }),
      command({ discountValue: 0 }),
      command({ discountValue: 1.5 }),
      command({ discountValue: 91 }),
      command({ discountType: 'FIXED_AMOUNT', discountValue: 1_000_000 }),
      command({ activeFrom: 'bukan-tanggal' }),
      command({ activeFrom: new Date(NOW + 10 * DAY).toISOString(), activeUntil: new Date(NOW + DAY).toISOString() }),
      command({ activeFrom: new Date(NOW - 5 * DAY).toISOString(), activeUntil: new Date(NOW - DAY).toISOString() }),
    ];
    for (const body of bad)
      await expect(service.create(manager, packageId, body as never, 'k-12345678', 'c')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    expect(tx.packagePromotion.create).not.toHaveBeenCalled();
  });

  it('refuses a window that overlaps another active promotion', async () => {
    const { service, tx } = setup(promoRow(), { id: id(99) });
    await expect(service.create(manager, packageId, command(), 'k-12345678', 'c')).rejects.toMatchObject({
      code: 'PROMOTION_OVERLAP',
    });
    expect(tx.packagePromotion.create).not.toHaveBeenCalled();
    const where = tx.packagePromotion.findFirst.mock.calls[0]![0].where;
    expect(where).toMatchObject({ packageId, status: 'ACTIVE', activeFrom: { lt: expect.any(Date) }, activeUntil: { gt: expect.any(Date) } });
  });

  it('stores an ACTIVE promotion with a normalized fixed-amount type and the creator', async () => {
    const { service, tx } = setup();
    const result = await service.create(
      manager,
      packageId,
      command({ discountType: 'FIXED', discountValue: 150_000, label: 'Potongan 150rb' }),
      'k-12345678',
      'c',
    );
    expect(tx.packagePromotion.create.mock.calls[0]![0].data).toMatchObject({
      packageId,
      name: 'Promo Baru',
      label: 'Potongan 150rb',
      discountType: 'FIXED_AMOUNT',
      discountValue: 150_000,
      status: 'ACTIVE',
      createdById: manager.userId,
    });
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ discountRp: 150_000, promotionalPriceRp: 850_000 });
  });
});

describe('package promotions: update and transitions', () => {
  it('claims atomically: the version is optional, but checked when sent', async () => {
    const free = setup();
    await free.service.update(manager, promoId, { discountValue: 5 }, 'k-12345678', 'c');
    expect(free.tx.packagePromotion.updateMany.mock.calls[0]![0].where).not.toHaveProperty('version');
    const { service, tx } = setup();
    await service.update(manager, promoId, { discountValue: 25, expectedVersion: 1 }, 'k-12345678', 'c');
    expect(tx.packagePromotion.updateMany.mock.calls[0]![0]).toMatchObject({
      where: { id: promoId, version: 1, status: { not: 'ARCHIVED' } },
      data: { discountValue: 25, version: { increment: 1 } },
    });
    tx.packagePromotion.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.update(manager, promoId, { discountValue: 26, expectedVersion: 1 }, 'k-12345678', 'c'),
    ).rejects.toMatchObject({ code: 'STALE_VERSION' });
  });

  it('does not change an archived promotion and re-checks overlap when an active one is edited', async () => {
    await expect(
      setup(promoRow({ status: 'ARCHIVED' })).service.update(manager, promoId, { discountValue: 5, expectedVersion: 1 }, 'k-12345678', 'c'),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(
      setup(promoRow(), { id: id(99) }).service.update(manager, promoId, { discountValue: 5, expectedVersion: 1 }, 'k-12345678', 'c'),
    ).rejects.toMatchObject({ code: 'PROMOTION_OVERLAP' });
  });

  it('pauses, reactivates (checking overlap) and archives, but never reactivates archived or expired ones', async () => {
    const active = setup();
    await active.service.transition(manager, promoId, 'PAUSED', { expectedVersion: 1, reason: 'Uji' }, 'k-12345678', 'c');
    expect(active.tx.packagePromotion.updateMany.mock.calls[0]![0]).toMatchObject({
      where: { id: promoId, version: 1, status: 'ACTIVE' },
      data: { status: 'PAUSED', version: { increment: 1 } },
    });
    await setup(promoRow({ status: 'PAUSED' })).service.transition(manager, promoId, 'ACTIVE', { expectedVersion: 1 }, 'k-12345678', 'c');
    await expect(
      setup(promoRow({ status: 'PAUSED' }), { id: id(99) }).service.transition(manager, promoId, 'ACTIVE', { expectedVersion: 1 }, 'k-12345678', 'c'),
    ).rejects.toMatchObject({ code: 'PROMOTION_OVERLAP' });
    await expect(
      setup(promoRow({ status: 'PAUSED', activeUntil: new Date(NOW - 1000) })).service.transition(manager, promoId, 'ACTIVE', { expectedVersion: 1 }, 'k-12345678', 'c'),
    ).rejects.toMatchObject({ code: 'PROMOTION_EXPIRED' });
    await setup(promoRow({ status: 'PAUSED' })).service.transition(manager, promoId, 'ARCHIVED', { expectedVersion: 1, reason: 'Promo selesai' }, 'k-12345678', 'c');
    for (const target of ['ACTIVE', 'PAUSED', 'ARCHIVED'] as const)
      await expect(
        setup(promoRow({ status: 'ARCHIVED' })).service.transition(manager, promoId, target, { expectedVersion: 1, reason: 'Ulang' }, 'k-12345678', 'c'),
      ).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
});

describe('package promotions: pausing and archiving take an optional reason', () => {
  it('rejects a reason that is too short, accepts none, and stores the reason in the audit when given', async () => {
    const blocked = setup();
    for (const target of ['PAUSED', 'ARCHIVED'] as const)
      await expect(
        blocked.service.transition(manager, promoId, target, { expectedVersion: 1, reason: 'ab' }, 'k-12345678', 'c'),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(blocked.tx.packagePromotion.updateMany).not.toHaveBeenCalled();
    const none = setup();
    await none.service.transition(manager, promoId, 'PAUSED', { expectedVersion: 1 }, 'k-12345678', 'c');
    expect(none.tx.packagePromotion.updateMany).toHaveBeenCalledTimes(1);

    const ok = setup();
    await ok.service.transition(manager, promoId, 'PAUSED', { expectedVersion: 1, reason: ' Jeda sementara ' }, 'k-12345678', 'c');
    expect(ok.audit.catat).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'package-promotion.paused', reason: 'Jeda sementara', beforeMasked: { status: 'ACTIVE' }, afterMasked: { status: 'PAUSED' } }),
    );
  });
});

describe('package promotions: orders', () => {
  it('lists the purchases that used a promotion with their discount snapshots', async () => {
    const { service, db } = setup();
    db.pembelian.findMany.mockResolvedValue([
      {
        id: id(90),
        status: 'PAID',
        subtotalRp: 1_000_000,
        discountRp: 190_000,
        promotionDiscountRp: 100_000,
        totalAmountRp: 810_000,
        createdAt: new Date(NOW),
        user: { displayName: 'Maya' },
        branch: { id: id(1), name: 'Green Garden' },
      },
    ]);
    const result = await service.orders(reader, promoId);
    expect(result.items[0]).toMatchObject({
      packagePromotionDiscountRpSnapshot: 100_000,
      promotionalPriceRpSnapshot: 900_000,
      voucherDiscountRpSnapshot: 90_000,
      priceAfterDiscountRpSnapshot: 810_000,
      user: { displayName: 'Maya' },
    });
    expect(db.pembelian.findMany.mock.calls[0]![0].where).toEqual({ promotionId: promoId });
  });
});

describe('customer checkout with a package promotion', () => {
  function checkoutSetup(promotion: Record<string, unknown> | null) {
    const pkg = { id: packageId, name: 'Paket 8', priceRp: 1_000_000, status: 'ACTIVE', sessionCount: 8, validityDays: 60, branchId: null, classType: null };
    const created: Array<Record<string, any>> = [];
    const tx = {
      paket: { findUnique: jest.fn().mockResolvedValue(pkg) },
      cabang: { findUnique: jest.fn().mockResolvedValue({ id: id(1), active: true }) },
      packagePromotion: { findFirst: jest.fn().mockResolvedValue(promotion) },
      voucher: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
      buktiPembayaran: { upsert: jest.fn() },
      pembelian: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(async ({ data }) => {
          created.push(data);
          return { ...data, createdAt: new Date(), package: pkg, branch: { paymentAccounts: [] }, voucher: null };
        }),
      },
    };
    const db = {
      paket: tx.paket,
      packagePromotion: tx.packagePromotion,
      cabang: { ...tx.cabang, findMany: jest.fn().mockResolvedValue([{ id: id(1), name: 'GG', paymentAccounts: [] }]) },
    };
    const idempotency = {
      execute: jest.fn(async (_c: unknown, action: (t: typeof tx) => Promise<unknown>) => ({
        ...((await action(tx)) as object),
        replay: false,
      })),
    };
    const audit = { record: jest.fn() };
    const access = { requireVerifiedCustomer: jest.fn() };
    const service = new CustomerOrderService(
      db as never,
      access as never,
      new PackagePricingService(),
      {} as never,
      idempotency as never,
      {} as never,
      audit as never,
    );
    return { service, created, tx };
  }
  const customer = { ...manager, capabilities: ['customer:self'] };
  const live = {
    id: promoId,
    name: 'Promo Akhir Tahun',
    label: 'Hemat 10%',
    discountType: 'PERCENTAGE',
    discountValue: 10,
    activeFrom: new Date(NOW - DAY),
    activeUntil: new Date(NOW + DAY),
    version: 2,
  };

  it('shows the promotional price in checkout options', async () => {
    const { service } = checkoutSetup(live);
    const options = await service.checkoutOptions(customer, packageId, id(1));
    expect(options.package).toMatchObject({
      priceRp: 1_000_000,
      effectivePriceRp: 900_000,
      promotion: { id: promoId, discountRp: 100_000, promotionalPriceRp: 900_000, version: 2, discountType: 'PERCENTAGE' },
    });
    const none = await checkoutSetup(null).service.checkoutOptions(customer, packageId, id(1));
    expect(none.package).toMatchObject({ effectivePriceRp: 1_000_000, promotion: null });
  });

  it('bills the promotional total and snapshots the promotion when the displayed promotion still applies', async () => {
    const { service, created } = checkoutSetup(live);
    const result = await service.createOrder(
      customer,
      { packageId, branchId: id(1), expectedPromotionId: promoId, expectedPromotionVersion: 2 },
      'k-12345678',
      'c',
    );
    const firstCreated = created[0]!;
    expect(firstCreated).toMatchObject({
      subtotalRp: 1_000_000,
      discountRp: 100_000,
      uniqueCode: expect.any(Number),
      promotionId: promoId,
      promotionName: 'Promo Akhir Tahun',
      promotionDiscountRp: 100_000,
    });
    expect(firstCreated.totalAmountRp).toBe(900_000 + firstCreated.uniqueCode);
    expect((result as any).body).toMatchObject({
      promotion: { id: promoId, discountRp: 100_000 },
      promotionalPriceRp: 900_000,
      priceAfterDiscountRp: 900_000,
      paymentUniqueCode: firstCreated.uniqueCode,
      payableAmountRp: 900_000 + firstCreated.uniqueCode,
    });
  });

  it('refuses to bill a different price than the customer saw', async () => {
    const changed = checkoutSetup(live);
    await expect(
      changed.service.createOrder(customer, { packageId, branchId: id(1), expectedPromotionId: null }, 'k-12345678', 'c'),
    ).rejects.toMatchObject({ code: 'PROMOTION_CHANGED' });
    await expect(
      changed.service.createOrder(customer, { packageId, branchId: id(1), expectedPromotionId: promoId, expectedPromotionVersion: 1 }, 'k-12345678', 'c'),
    ).rejects.toMatchObject({ code: 'PROMOTION_CHANGED' });
    const ended = checkoutSetup(null);
    await expect(
      ended.service.createOrder(customer, { packageId, branchId: id(1), expectedPromotionId: promoId, expectedPromotionVersion: 2 }, 'k-12345678', 'c'),
    ).rejects.toMatchObject({ code: 'PROMOTION_CHANGED' });
    expect(changed.created).toHaveLength(0);
    // Klien lama yang tidak mengirim ekspektasi tetap dilayani dengan harga berlaku.
    await checkoutSetup(live).service.createOrder(customer, { packageId, branchId: id(1) }, 'k-12345678', 'c');
  });
});
