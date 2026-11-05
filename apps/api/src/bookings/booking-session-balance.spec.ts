import { PolicyService } from '../identity/policy.service';
import { BookingsService } from './pemesanan-kelas.service';

const branchA = '11111111-1111-4111-8111-111111111111';
const bookingId = '00000000-0000-4000-8000-000000000001';

const principal = { sessionId: 's', userId: 'staff', roles: [], capabilities: ['booking:read'], branchIds: [branchA] } as never;

const row = (overrides: Record<string, unknown> = {}) => ({
  id: bookingId,
  bookingNumber: 'B-1',
  branchId: branchA,
  classSlotId: 'slot-1',
  userId: 'user-1',
  customerPackageId: 'pkg-1',
  status: 'BOOKED',
  createdAt: new Date('2026-10-27T00:00:00Z'),
  classSlot: { id: 'slot-1', branchId: branchA, startAt: new Date(), endAt: new Date(), capacity: 5, bookedCount: 1 },
  customerPackage: { id: 'pkg-1', remainingSessions: 10, status: 'ACTIVE', package: { id: 'p', name: 'Paket 10 Sesi' } },
  ...overrides,
});

function createService(rows: ReturnType<typeof row>[]) {
  // Pencarian booking yang menahan sesi (where.AND) menemukan 3 booking untuk pkg-1; pemanggilan lain memberi baris daftar.
  const tertahan = Array.from({ length: 3 }, (_, i) => ({
    id: `held-${i}`,
    status: 'BOOKED',
    customerPackageId: 'pkg-1',
  }));
  const findMany = jest
    .fn()
    .mockImplementation(async (args: { where?: { AND?: unknown } }) => (args?.where?.AND ? tertahan : rows));
  const groupBy = jest.fn().mockResolvedValue([{ status: 'BOOKED', _count: { _all: rows.length } }]);
  const db = {
    pemesananKelas: {
      findMany,
      findUnique: jest.fn().mockResolvedValue(rows[0]),
      count: jest.fn().mockResolvedValue(rows.length),
      groupBy,
    },
    sessionLedger: { findMany: jest.fn().mockResolvedValue([]) },
    ubahJadwal: { count: jest.fn().mockResolvedValue(0) },
  };
  return { service: new BookingsService(db as never, {} as never, new PolicyService(), {} as never), findMany };
}

describe('booking session balance', () => {
  it('shows each booking the package balance and how many sessions are already reserved', async () => {
    const { service } = createService([row()]);
    const result = await service.list(principal, {});
    expect(result.items[0]?.sessionBalance).toEqual({ ledgerBalance: 10, reserved: 3, available: 7 });
  });

  it('asks for the reservations of all packages in the page with one query', async () => {
    const other = row({ id: '00000000-0000-4000-8000-000000000002', customerPackageId: 'pkg-2' });
    const { service, findMany } = createService([row(), other]);
    await service.list(principal, {});
    const perPackage = findMany.mock.calls.filter(([args]) => args?.where?.AND);
    expect(perPackage).toHaveLength(1);
    expect(perPackage[0]![0].where.AND[1].customerPackageId.in.sort()).toEqual(['pkg-1', 'pkg-2']);
  });

  it('never shows more available sessions than the package has, and none for a frozen package', async () => {
    const { service } = createService([
      row({ customerPackage: { id: 'pkg-1', remainingSessions: 2, status: 'ACTIVE', package: { id: 'p', name: 'x' } } }),
    ]);
    expect((await service.list(principal, {})).items[0]?.sessionBalance).toEqual({ ledgerBalance: 2, reserved: 3, available: 0 });
    const frozen = createService([
      row({ customerPackage: { id: 'pkg-1', remainingSessions: 8, status: 'FROZEN', package: { id: 'p', name: 'x' } } }),
    ]);
    expect((await frozen.service.list(principal, {})).items[0]?.sessionBalance?.available).toBe(0);
  });

  it('includes the balance in the booking detail too', async () => {
    const { service } = createService([row()]);
    expect((await service.detail(principal, bookingId)).sessionBalance).toEqual({ ledgerBalance: 10, reserved: 3, available: 7 });
  });
});
