import { EffectiveSettingsService } from './konfigurasi-efektif.service';

const superOwner = {
  sessionId: 's',
  userId: 'so',
  roles: [{ role: 'SUPER_OWNER', branchId: null }],
  capabilities: ['master:read', 'master:manage', 'branch:all'],
  branchIds: [],
} as never;

function setup() {
  const db = {
    minQuotaSetting: {
      upsert: jest.fn(async ({ create }: { create: Record<string, unknown> }) => ({
        id: 'q1',
        ...create,
        branch: { id: 'untar', code: 'UNTAR', name: 'Untar' },
        classType: { id: 'grp', name: 'Group Class' },
        createdAt: new Date('2026-10-30T00:00:00Z'),
      })),
      findMany: jest.fn(async () => [
        {
          id: 'q1',
          branchId: 'untar',
          classTypeId: 'grp',
          minQuota: 2,
          cutoffHours: 24,
          createdAt: new Date(),
        },
      ]),
    },
    kapasitasKelasCabang: {
      upsert: jest.fn(),
      findMany: jest.fn(async () => [{ branchId: 'untar', classTypeId: 'grp', capacity: 10 }]),
    },
    slotKelas: {
      findMany: jest.fn(async () => [
        { id: 's1', capacity: 5, bookedCount: 0, _count: { bookings: 5 } },
        { id: 's2', capacity: 5, bookedCount: 0, _count: { bookings: 0 } },
      ]),
      update: jest.fn(),
    },
  };
  const access = { authorize: jest.fn(), audit: jest.fn(), ensureBranchScope: jest.fn() };
  return { db, access, service: new EffectiveSettingsService(access as never, db as never) };
}

describe('Kapasitas kelas per cabang (Kuota & Kapasitas)', () => {
  it('menyimpan kapasitas dan menerapkannya ke kelas yang belum berjalan', async () => {
    const { service, db } = setup();
    const hasil = await service.create(
      superOwner,
      {
        kind: 'QUOTA_CAPACITY',
        branchId: 'untar',
        classTypeId: 'grp',
        minimumQuota: 2,
        defaultCapacity: 10,
        effectiveFrom: '2026-10-30',
        reason: 'Kapasitas Untar 10',
      },
      'c',
    );
    expect(db.kapasitasKelasCabang.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ capacity: 10 }) }),
    );
    expect(
      (db.slotKelas.findMany.mock.calls[0] as unknown as [{ where: unknown }])[0].where,
    ).toMatchObject({
      branchId: 'untar',
      classTypeId: 'grp',
      status: { in: ['DRAFT', 'PUBLISHED', 'CONFIRMED'] },
    });
    expect(db.slotKelas.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { capacity: 10 },
    });
    expect(db.slotKelas.update).toHaveBeenCalledWith({
      where: { id: 's2' },
      data: { capacity: 10 },
    });
    expect(hasil).toMatchObject({ defaultCapacity: 10, kelasDiperbarui: 2 });
  });

  it('tidak menurunkan kapasitas di bawah peserta yang sudah terdaftar', async () => {
    const { service, db } = setup();
    db.slotKelas.findMany.mockResolvedValueOnce([
      { id: 's1', capacity: 8, bookedCount: 0, _count: { bookings: 6 } },
    ]);
    await service.create(
      superOwner,
      {
        kind: 'QUOTA_CAPACITY',
        branchId: 'untar',
        classTypeId: 'grp',
        defaultCapacity: 4,
        effectiveFrom: '2026-10-30',
        reason: 'Turun',
      },
      'c',
    );
    expect(db.slotKelas.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { capacity: 6 },
    });
  });

  it('daftar menampilkan kapasitas yang tersimpan', async () => {
    const { service } = setup();
    const r = (await service.list(superOwner, 'QUOTA_CAPACITY')) as {
      items: { defaultCapacity: number | null }[];
    };
    expect(r.items[0]!.defaultCapacity).toBe(10);
  });
});
