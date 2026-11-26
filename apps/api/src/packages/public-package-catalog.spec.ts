import { PublicPackageQueryService } from '../public-content/public-package-query.service';

const branchId = '00000000-0000-4000-8000-000000000002';

describe('PublicPackageQueryService', () => {
  const db = {
    cabang: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: branchId, code: 'GG', name: 'Green Garden', timezone: 'Asia/Jakarta' },
        ]),
    },
    packagePromotion: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
    paket: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: '00000000-0000-4000-8000-000000000004',
          branchId,
          businessKey: 'PRIVATE-4',
          name: 'Pilates Starter',
          sessionCount: 4,
          durationDays: 30,
          priceRp: 1200000,
          effectiveUntil: null,
          updatedAt: new Date('2026-07-27T00:00:00.000Z'),
          classTypeScopes: [
            {
              classType: {
                id: '00000000-0000-4000-8000-000000000003',
                code: 'PRIVATE',
                name: 'Private Class',
              },
            },
          ],
        },
      ]),
    },
  };
  const service = new PublicPackageQueryService(db as never);

  beforeEach(() => jest.clearAllMocks());

  it('returns branch discovery without exposing packages before explicit selection', async () => {
    const result = await service.list();
    expect(result.branches).toHaveLength(1);
    expect(result.items).toEqual([]);
    expect(db.paket.findMany).not.toHaveBeenCalled();
    expect(db.cabang.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          supportWhatsappE164: true,
          address: true,
        }),
      }),
    );
  });

  it('returns only an active effective public commercial projection', async () => {
    const result = await service.list(branchId);
    expect(result.items).toEqual([
      expect.objectContaining({
        branchId,
        name: 'Pilates Starter',
        priceRp: 1200000,
        classTypes: [expect.objectContaining({ name: 'Private Class' })],
      }),
    ]);
    expect(result.items[0]).not.toHaveProperty('businessKey');
    expect(result.items[0]).not.toHaveProperty('version');
    expect(result.items[0]).not.toHaveProperty('createdAt');
    expect(db.paket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'ACTIVE',
          OR: [{ branchId }, { branchId: null }],
        }),
      }),
    );
  });

  it('deduplicates overlapping legacy seed records by commercial business key', async () => {
    db.paket.findMany.mockResolvedValueOnce([
      {
        id: '00000000-0000-4000-8000-000000000004',
        branchId,
        businessKey: 'PRIVATE-4',
        name: 'Pilates Starter',
        sessionCount: 4,
        durationDays: 30,
        priceRp: 1200000,
        effectiveUntil: null,
        updatedAt: new Date('2026-07-27T00:00:00.000Z'),
        classTypeScopes: [
          {
            classType: {
              id: '00000000-0000-4000-8000-000000000003',
              code: 'PRIVATE',
              name: 'Private Class',
            },
          },
        ],
      },
      {
        id: '00000000-0000-4000-8000-000000000005',
        branchId,
        businessKey: 'PRIVATE-4',
        name: 'Legacy duplicate',
        sessionCount: 4,
        durationDays: 30,
        priceRp: 1200000,
        effectiveUntil: null,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        classTypeScopes: [
          {
            classType: {
              id: '00000000-0000-4000-8000-000000000003',
              code: 'PRIVATE',
              name: 'Private Class',
            },
          },
        ],
      },
    ]);

    const result = await service.list(branchId);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.name).toBe('Pilates Starter');
  });

  it('rejects malformed and unavailable branch identifiers', async () => {
    await expect(service.list('invalid')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(service.list('00000000-0000-4000-8000-000000000099')).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it('shows the promotional price when a promotion is live for the package', async () => {
    const now = Date.now();
    db.packagePromotion.findMany.mockResolvedValueOnce([
      {
        id: 'promo-1',
        packageId: '00000000-0000-4000-8000-000000000004',
        name: 'Promo Akhir Tahun',
        label: 'Hemat 20%',
        discountType: 'PERCENTAGE',
        discountValue: 20,
        activeFrom: new Date(now - 3_600_000),
        activeUntil: new Date(now + 3_600_000),
        version: 2,
      },
    ]);
    const result = await service.list(branchId);
    expect(result.items[0]).toMatchObject({
      priceRp: 1200000,
      effectivePriceRp: 960000,
      discountedPriceRp: 960000,
      isDiscounted: true,
      discountPercent: 20,
      promotion: {
        id: 'promo-1',
        label: 'Hemat 20%',
        discountType: 'PERCENTAGE',
        discountRp: 240000,
        promotionalPriceRp: 960000,
        version: 2,
      },
    });
    expect(db.packagePromotion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'ACTIVE', packageId: { in: expect.any(Array) } }),
      }),
    );
  });
});
