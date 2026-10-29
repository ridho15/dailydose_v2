import { PolicyService } from '../identity/policy.service';
import { bagiLaba, SettlementOwnerService } from './settlement-owner.service';

const so = {
  sessionId: 's',
  userId: 'so-1',
  roles: [{ role: 'SUPER_OWNER', branchId: null }],
  capabilities: ['owner-settlement:manage', 'finance:read', 'branch:all'],
  branchIds: [],
} as never;

function setup() {
  const db = {
    user: {
      findMany: jest.fn(async () => [
        { id: 'so-1', displayName: 'Rina' },
        { id: 'so-2', displayName: 'Budi' },
      ]),
    },
    cabang: {
      findMany: jest.fn(async () => [
        { id: 'gg', name: 'Green Garden' },
        { id: 'sby', name: 'Surabaya' },
      ]),
      findUnique: jest.fn(async () => ({ id: 'gg' })),
    },
    porsiOwnerCabang: {
      findMany: jest.fn(async () => [
        { branchId: 'gg', ownerId: 'so-1', porsiBp: 6000 },
        { branchId: 'gg', ownerId: 'so-2', porsiBp: 4000 },
      ]),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    otherCost: {
      findMany: jest.fn(async () => [
        { id: 'c1', branchId: 'gg', amountRp: 500_000 },
        { id: 'c2', branchId: 'gg', amountRp: 200_000 },
        { id: 'c3', branchId: 'sby', amountRp: 300_000 },
      ]),
    },
    pembayarPengeluaran: {
      findMany: jest.fn(async () => [
        { otherCostId: 'c1', dibayarOlehId: 'so-2' },
        { otherCostId: 'c3', dibayarOlehId: 'so-1' },
      ]),
    },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(async (fn: (t: unknown) => unknown): Promise<unknown> => fn(db)),
  };
  const ringkasan = {
    ringkasanBulanan: jest.fn(async () => ({
      period: '2026-10',
      cabang: [
        { branchId: 'gg', branchName: 'Green Garden', profitRp: 10_000_000 },
        { branchId: 'sby', branchName: 'Surabaya', profitRp: 4_000_000 },
      ],
    })),
  };
  return {
    db,
    service: new SettlementOwnerService(db as never, new PolicyService(), ringkasan as never),
  };
}

describe('SettlementOwnerService', () => {
  it('membagi laba per porsi cabang dan menambahkan reimburse pengeluaran yang dibayar Super Owner', async () => {
    const { service } = setup();
    const hasil = await service.settlement(so, { period: '2026-10' });

    const gg = hasil.cabang.find((c) => c.branchId === 'gg')!;
    expect(gg.porsiLengkap).toBe(true);
    expect(gg.baris).toEqual([
      expect.objectContaining({
        ownerId: 'so-1',
        persen: 60,
        hakRp: 6_000_000,
        reimburseRp: 0,
        totalRp: 6_000_000,
      }),
      expect.objectContaining({
        ownerId: 'so-2',
        persen: 40,
        hakRp: 4_000_000,
        reimburseRp: 500_000,
        totalRp: 4_500_000,
      }),
    ]);

    // Surabaya belum punya porsi: labanya belum dibagi, tetapi reimburse tetap dibayar.
    const sby = hasil.cabang.find((c) => c.branchId === 'sby')!;
    expect(sby.porsiLengkap).toBe(false);
    expect(sby.baris).toEqual([
      expect.objectContaining({ ownerId: 'so-1', hakRp: 0, reimburseRp: 300_000 }),
    ]);
    expect(hasil.labaBelumDibagiRp).toBe(4_000_000);

    expect(hasil.owners).toEqual([
      expect.objectContaining({
        id: 'so-1',
        hakRp: 6_000_000,
        reimburseRp: 300_000,
        totalRp: 6_300_000,
      }),
      expect.objectContaining({
        id: 'so-2',
        hakRp: 4_000_000,
        reimburseRp: 500_000,
        totalRp: 4_500_000,
      }),
    ]);
  });

  it('porsi satu cabang harus 100%', async () => {
    const { db, service } = setup();
    await expect(
      service.simpanPorsi(so, 'gg', {
        porsi: [
          { ownerId: 'so-1', persen: 60 },
          { ownerId: 'so-2', persen: 30 },
        ],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await service.simpanPorsi(so, 'gg', {
      porsi: [
        { ownerId: 'so-1', persen: 50 },
        { ownerId: 'so-2', persen: 50 },
      ],
    });
    expect(db.porsiOwnerCabang.createMany.mock.calls[0]![0].data).toEqual([
      expect.objectContaining({ ownerId: 'so-1', porsiBp: 5000, branchId: 'gg' }),
      expect.objectContaining({ ownerId: 'so-2', porsiBp: 5000, branchId: 'gg' }),
    ]);
  });

  it('pembulatan tidak membuat rupiah hilang atau bertambah', () => {
    const hasil = bagiLaba(1_000_001, [
      { ownerId: 'a', porsiBp: 3333 },
      { ownerId: 'b', porsiBp: 3333 },
      { ownerId: 'c', porsiBp: 3334 },
    ]);
    expect([...hasil.values()].reduce((x, y) => x + y, 0)).toBe(1_000_001);
  });

  it('hanya Super Owner', async () => {
    const { service } = setup();
    const admin = { ...(so as object), capabilities: ['expense:create'] } as never;
    await expect(service.settlement(admin, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.daftarOwner(admin)).resolves.toHaveLength(2);
  });
});
