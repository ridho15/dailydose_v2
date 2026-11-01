import {
  BookingsService,
  ENTITY_ID_REGEX,
  isCancellationEntitled,
  isInstructorRosterPrincipal,
} from './pemesanan-kelas.service';

describe('ENTITY_ID_REGEX validation', () => {
  it('accepts standard RFC4122 UUIDs', () => {
    expect(ENTITY_ID_REGEX.test('f1000000-0000-4000-8000-000000000001')).toBe(true);
    expect(ENTITY_ID_REGEX.test('a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d')).toBe(true);
  });

  it('accepts seed entity IDs containing alphanumeric codes (ddsby0, ddgg00, ddmk00)', () => {
    expect(ENTITY_ID_REGEX.test('f1000000-ddsby0-4000-8000-0000060001')).toBe(true);
    expect(ENTITY_ID_REGEX.test('f1000000-ddgg00-4000-8000-0000060001')).toBe(true);
    expect(ENTITY_ID_REGEX.test('f1000000-ddmk00-4000-8000-0000060001')).toBe(true);
  });

  it('rejects invalid or unsafe strings', () => {
    expect(ENTITY_ID_REGEX.test('short')).toBe(false);
    expect(ENTITY_ID_REGEX.test('../path/traversal')).toBe(false);
    expect(ENTITY_ID_REGEX.test('select * from users;')).toBe(false);
    expect(ENTITY_ID_REGEX.test('')).toBe(false);
  });
});

describe('customer booking cancellation boundary', () => {
  const startAt = new Date('2026-08-10T02:00:00.000Z');

  it('allows cancellation strictly before H-24', () => {
    expect(isCancellationEntitled(startAt, new Date('2026-08-09T01:59:59.999Z'), 24)).toBe(true);
  });

  it('rejects cancellation exactly at and after H-24', () => {
    expect(isCancellationEntitled(startAt, new Date('2026-08-09T02:00:00.000Z'), 24)).toBe(false);
    expect(isCancellationEntitled(startAt, new Date('2026-08-09T02:00:00.001Z'), 24)).toBe(false);
  });
});

describe('instructor roster capability boundary', () => {
  it('uses the assignment-scoped path only for Instructor capabilities', () => {
    expect(isInstructorRosterPrincipal({ capabilities: ['class:assigned:read'] })).toBe(true);
    expect(
      isInstructorRosterPrincipal({ capabilities: ['class:assigned:read', 'booking:read'] }),
    ).toBe(false);
    expect(isInstructorRosterPrincipal({ capabilities: ['booking:self:read'] })).toBe(false);
  });
});

describe('BookingsService.customerOptions', () => {
  const mockPrincipal = {
    userId: 'user-customer-12345678',
    roles: ['CUSTOMER'],
    capabilities: ['booking:self:create'],
  };

  const slotFutureDate = new Date(Date.now() + 24 * 3_600_000);
  const slotPastCutoffDate = new Date(Date.now() + 1 * 3_600_000); // within 2 hours cutoff

  const baseSlot = {
    id: 'f1000000-0000-4000-8000-000000060001',
    branchId: 'ddsby0-surabaya-barat',
    classTypeId: 'ct-reformer-pilates-1',
    startAt: slotFutureDate,
    endAt: new Date(slotFutureDate.getTime() + 3_600_000),
    status: 'PUBLISHED',
    capacity: 10,
    bookedCount: 2,
    branch: { id: 'ddsby0-surabaya-barat', name: 'Surabaya Barat', timezone: 'Asia/Jakarta' },
    classType: { id: 'ct-reformer-pilates-1', name: 'Reformer Pilates' },
    instructor: { id: 'inst-1', displayName: 'Coach Sarah' },
    studio: { id: 'std-1', name: 'Studio A' },
    room: { id: 'rm-1', name: 'Room 101' },
  };

  const matchingPackage = {
    id: 'cust-pkg-00000001',
    userId: mockPrincipal.userId,
    packageId: 'pkg-global-1',
    remainingSessions: 5,
    totalSessions: 10,
    status: 'ACTIVE',
    validUntil: new Date(Date.now() + 30 * 24 * 3_600_000),
    package: {
      id: 'pkg-global-1',
      name: 'All Studio 10 Sessions',
      branchId: 'ddsby0-surabaya-barat',
      classTypeId: 'ct-reformer-pilates-1',
    },
  };

  it('returns canonical slot, packages, and eligibility when matching package exists', async () => {
    const mockDb = {
      slotKelas: {
        findUnique: jest.fn().mockResolvedValue(baseSlot),
      },
      paketPelanggan: {
        findMany: jest.fn().mockResolvedValue([matchingPackage]),
      },
      pemesananKelas: {
        count: jest.fn().mockResolvedValue(0),
      },
    };

    const mockConfig = {
      value: {
        booking: { enabled: true, cutoffHours: 2 },
      },
    };

    const service = new BookingsService(
      mockDb as any,
      {} as any,
      {} as any,
      mockConfig as any,
    );

    const result = await service.customerOptions(
      mockPrincipal as any,
      'f1000000-0000-4000-8000-000000060001',
    );

    expect(result.slot).toBeDefined();
    expect(result.slot.id).toBe(baseSlot.id);
    expect(result.slot.branch?.name).toBe('Surabaya Barat');
    expect(result.slot.classType?.name).toBe('Reformer Pilates');
    expect(result.slot.instructor?.displayName).toBe('Coach Sarah');
    expect(result.slot.available).toBe(8);

    expect(result.packages).toHaveLength(1);
    expect(result.packages[0]?.name).toBe('All Studio 10 Sessions');
    expect(result.packages[0]?.available).toBe(5);

    expect(result.eligibility).toBeDefined();
    expect(result.eligibility.canBook).toBe(true);
    expect(result.eligibility.reasonCode).toBeNull();
  });

  it('filters out packages from other branches and sets canBook=false when no matching package found', async () => {
    const mockDb = {
      slotKelas: {
        findUnique: jest.fn().mockResolvedValue(baseSlot),
      },
      paketPelanggan: {
        // Database filter will return empty if package is for another branch
        findMany: jest.fn().mockResolvedValue([]),
      },
      pemesananKelas: {
        count: jest.fn().mockResolvedValue(0),
      },
    };

    const mockConfig = {
      value: {
        booking: { enabled: true, cutoffHours: 2 },
      },
    };

    const service = new BookingsService(
      mockDb as any,
      {} as any,
      {} as any,
      mockConfig as any,
    );

    const result = await service.customerOptions(
      mockPrincipal as any,
      'f1000000-0000-4000-8000-000000060001',
    );

    expect(result.packages).toHaveLength(0);
    expect(result.eligibility.canBook).toBe(false);
    expect(result.eligibility.reasonCode).toBe('MATCHING_PACKAGE_REQUIRED');
    expect(result.eligibility.requiredAction).toBe('BUY_MATCHING_PACKAGE');
  });

  it('sets BOOKING_CUTOFF_PASSED when slot is within cutoffHours', async () => {
    const mockDb = {
      slotKelas: {
        findUnique: jest.fn().mockResolvedValue({
          ...baseSlot,
          startAt: slotPastCutoffDate,
        }),
      },
      paketPelanggan: {
        findMany: jest.fn().mockResolvedValue([matchingPackage]),
      },
      pemesananKelas: {
        count: jest.fn().mockResolvedValue(0),
      },
    };

    const mockConfig = {
      value: {
        booking: { enabled: true, cutoffHours: 2 },
      },
    };

    const service = new BookingsService(
      mockDb as any,
      {} as any,
      {} as any,
      mockConfig as any,
    );

    const result = await service.customerOptions(
      mockPrincipal as any,
      'f1000000-0000-4000-8000-000000060001',
    );

    expect(result.eligibility.canBook).toBe(false);
    expect(result.eligibility.reasonCode).toBe('BOOKING_CUTOFF_PASSED');
    expect(result.eligibility.requiredAction).toBe('CONTACT_STUDIO');
  });

  it('allows staff/admin to book even when slot is within cutoffHours (walk-in booking)', async () => {
    const mockDb = {
      slotKelas: {
        findUnique: jest.fn().mockResolvedValue({
          ...baseSlot,
          startAt: slotPastCutoffDate,
          endAt: new Date(Date.now() + 60 * 60 * 1000), // endAt 1 hour in future
        }),
      },
      paketPelanggan: {
        findMany: jest.fn().mockResolvedValue([matchingPackage]),
      },
      pemesananKelas: {
        count: jest.fn().mockResolvedValue(0),
      },
    };

    const mockConfig = {
      value: {
        booking: { enabled: true, cutoffHours: 2 },
      },
    };

    const service = new BookingsService(
      mockDb as any,
      {} as any,
      {} as any,
      mockConfig as any,
    );

    const staffPrincipal = {
      userId: "u-staff-1",
      roles: [{ role: "ADMIN", branchId: "b1" }],
      capabilities: ["booking:create:assisted"],
    };

    const result = await service.customerOptions(
      staffPrincipal as any,
      "f1000000-0000-4000-8000-000000060001",
    );

    expect(result.eligibility.canBook).toBe(true);
    expect(result.eligibility.reasonCode).toBeNull();
  });

  it('rejects staff/admin when slot endAt has already ended (no-happy path)', async () => {
    const mockDb = {
      slotKelas: {
        findUnique: jest.fn().mockResolvedValue({
          ...baseSlot,
          startAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
          endAt: new Date(Date.now() - 60 * 60 * 1000), // endAt in the past
        }),
      },
      paketPelanggan: {
        findMany: jest.fn().mockResolvedValue([matchingPackage]),
      },
      pemesananKelas: {
        count: jest.fn().mockResolvedValue(0),
      },
    };

    const mockConfig = {
      value: {
        booking: { enabled: true, cutoffHours: 2 },
      },
    };

    const service = new BookingsService(
      mockDb as any,
      {} as any,
      {} as any,
      mockConfig as any,
    );

    const staffPrincipal = {
      userId: "u-staff-1",
      roles: [{ role: "ADMIN", branchId: "b1" }],
      capabilities: ["booking:create:assisted"],
    };

    const result = await service.customerOptions(
      staffPrincipal as any,
      "f1000000-0000-4000-8000-000000060001",
    );

    expect(result.eligibility.canBook).toBe(false);
    expect(result.eligibility.reasonCode).toBe("SLOT_UNAVAILABLE");
  });

  it('sets SLOT_FULL when bookedCount reaches capacity', async () => {
    const mockDb = {
      slotKelas: {
        findUnique: jest.fn().mockResolvedValue({
          ...baseSlot,
          bookedCount: 10,
          capacity: 10,
        }),
      },
      paketPelanggan: {
        findMany: jest.fn().mockResolvedValue([matchingPackage]),
      },
      pemesananKelas: {
        count: jest.fn().mockResolvedValue(0),
      },
    };

    const mockConfig = {
      value: {
        booking: { enabled: true, cutoffHours: 2 },
      },
    };

    const service = new BookingsService(
      mockDb as any,
      {} as any,
      {} as any,
      mockConfig as any,
    );

    const result = await service.customerOptions(
      mockPrincipal as any,
      'f1000000-0000-4000-8000-000000060001',
    );

    expect(result.eligibility.canBook).toBe(false);
    expect(result.eligibility.reasonCode).toBe('SLOT_FULL');
  });
});

