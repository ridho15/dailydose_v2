import { PolicyService } from '../identity/policy.service';
import { ReschedulesService } from './ubah-jadwal.service';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const branchA = id(1);
const branchB = id(2);

const staff = (over: Record<string, unknown> = {}) => ({
  sessionId: 's',
  userId: id(100),
  roles: [] as never,
  capabilities: ['reschedule:read'],
  branchIds: [branchA],
  ...over,
});

const item = (n: number, sourceBranch: string, targetBranch: string, userId: string) => ({
  id: id(40 + n),
  bookingId: id(50 + n),
  sourceSlotId: id(60 + n),
  targetSlotId: id(70 + n),
  requestedById: userId,
  status: 'PENDING',
  reason: 'CUSTOMER_SCHEDULE_CONFLICT',
  requestedAt: new Date('2026-10-01T00:00:00Z'),
  booking: { user: { id: userId, displayName: `Pelanggan ${n}`, email: `rina${n}@example.test`, phone: `+62812345678${n}` }, customerPackage: null },
  sourceSlot: { id: id(60 + n), branchId: sourceBranch, branch: { id: sourceBranch, name: 'A', timezone: 'Asia/Jakarta' } },
  targetSlot: { id: id(70 + n), branchId: targetBranch, branch: { id: targetBranch, name: 'B', timezone: 'Asia/Jakarta' } },
});

function setup(rows: ReturnType<typeof item>[], related: string[] = []) {
  const db = {
    ubahJadwal: { findMany: jest.fn().mockResolvedValue(rows) },
    user: {
      findMany: jest.fn().mockResolvedValue(
        rows.map((row) => ({ id: row.booking.user.id, preferredBranchId: branchB, _count: { bookings: 2, purchases: 0 } })),
      ),
    },
    pemesananKelas: { findMany: jest.fn().mockResolvedValue(related.map((userId) => ({ userId }))) },
    pembelian: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return { db, service: new ReschedulesService(db as never, {} as never, new PolicyService(), {} as never) };
}

describe('reschedule list: branch scope and contact visibility', () => {
  it('only asks for requests touching the staff branches', async () => {
    const { db, service } = setup([]);
    await service.list(staff() as never, {});
    expect(db.ubahJadwal.findMany.mock.lastCall![0].where.AND).toEqual([
      { OR: [{ sourceSlot: { branchId: { in: [branchA] } } }, { targetSlot: { branchId: { in: [branchA] } } }] },
    ]);
  });

  it('does not restrict cross-branch staff', async () => {
    const { db, service } = setup([]);
    await service.list(staff({ capabilities: ['reschedule:read', 'branch:all'], branchIds: [] }) as never, {});
    expect(db.ubahJadwal.findMany.mock.lastCall![0].where.AND).toEqual([]);
  });

  it('shows contact for a customer booked in the staff branch, masks one who only targets it', async () => {
    const fromHere = item(1, branchA, branchA, id(201));
    const fromElsewhere = item(2, branchB, branchA, id(202));
    const { service } = setup([fromHere, fromElsewhere], [id(201)]);
    const result = await service.list(staff() as never, {});
    const byId = Object.fromEntries(result.items.map((row) => [row.id, row.customer as Record<string, unknown>]));
    expect(byId[fromHere.id]).toMatchObject({ email: 'rina1@example.test', contactMasked: false });
    expect(byId[fromElsewhere.id]).toMatchObject({ contactMasked: true, email: 'ri***@example.test' });
    expect(byId[fromElsewhere.id]!.phone).not.toBe('+628123456782');
  });
});
