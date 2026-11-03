import { PolicyService } from '../identity/policy.service';
import { BookingsService } from './pemesanan-kelas.service';

const branchA = '11111111-1111-4111-8111-111111111111';
const branchB = '22222222-2222-4222-8222-222222222222';
const bookingId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function principal(capabilities: string[], branchIds: string[]) {
  return {
    sessionId: 's',
    userId: 'staff-user',
    roles: [],
    capabilities,
    branchIds,
  } as never;
}

function createService(rows: Array<{ id: string }> = [], totalCount = 6) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const count = jest.fn().mockResolvedValue(totalCount);
  const groupBy = jest.fn().mockImplementation(() => {
    if (totalCount === 15) {
      return Promise.resolve([
        { status: 'BOOKED', _count: { _all: 8 } },
        { status: 'ATTENDED', _count: { _all: 7 } },
      ]);
    }
    return Promise.resolve([
      { status: 'BOOKED', _count: { _all: 3 } },
      { status: 'ATTENDED', _count: { _all: 2 } },
      { status: 'CANCELLED', _count: { _all: 1 } },
    ]);
  });
  const ubahJadwalCount = jest.fn().mockResolvedValue(4);
  const db = {
    pemesananKelas: { findMany, groupBy, count },
    ubahJadwal: { count: ubahJadwalCount },
  };
  const service = new BookingsService(db as never, {} as never, new PolicyService(), {} as never);
  return { service, findMany, groupBy, ubahJadwalCount, count };
}

describe('staff booking list authorization and scope', () => {
  it('rejects staff without booking:read', async () => {
    const { service } = createService();
    await expect(service.list(principal(['payment:review'], [branchA]), {})).rejects.toMatchObject({
      status: 403,
    });
  });

  it('does not let branch:all substitute for booking:read', async () => {
    const { service } = createService();
    await expect(
      service.list(principal(['branch:all', 'finance:read'], []), {}),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('limits branch-scoped staff to their branches', async () => {
    const { service, findMany } = createService();
    await service.list(principal(['booking:read'], [branchA]), {});
    expect(findMany.mock.calls[0]![0].where.classSlot.branchId).toEqual({ in: [branchA] });
  });

  it('hides other branches from branch-scoped staff', async () => {
    const { service } = createService();
    await expect(
      service.list(principal(['booking:read'], [branchA]), { branchId: branchB }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('allows global staff to read any branch without a branch filter', async () => {
    const { service, findMany } = createService();
    await service.list(principal(['booking:read', 'branch:all'], []), {});
    expect(findMany.mock.calls[0]![0].where.classSlot).toBeUndefined();
    await service.list(principal(['booking:read', 'branch:all'], []), { branchId: branchB });
    expect(findMany.mock.calls[1]![0].where.classSlot.branchId).toEqual(branchB);
  });

  it('rejects malformed cursors', async () => {
    const { service } = createService();
    await expect(
      service.list(principal(['booking:read', 'branch:all'], []), { cursor: 'not-a-uuid' }),
    ).rejects.toMatchObject({ status: 422 });
  });
});

describe('booking list pagination and summary', () => {
  const staff = principal(['booking:read', 'branch:all'], []);
  const row = (n: number) => ({ id: bookingId(n) });

  it('applies the cursor and reports the next page', async () => {
    const { service, findMany } = createService([row(1), row(2), row(3)]);
    const result = await service.list(staff, { cursor: bookingId(9), limit: 2 });
    const args = findMany.mock.calls[0]![0];
    expect(args.cursor).toEqual({ id: bookingId(9) });
    expect(args.skip).toBe(1);
    expect(args.take).toBe(3);
    expect(result.page).toEqual({ hasMore: true, nextCursor: bookingId(2) });
    expect(result.nextCursor).toBe(bookingId(2));
    expect(result.items).toHaveLength(2);
  });

  it('reports the last page without a cursor', async () => {
    const { service } = createService([row(1)]);
    const result = await service.list(staff, { limit: 2 });
    expect(result.page).toEqual({ hasMore: false, nextCursor: null });
  });

  it('supports numbered page pagination with total and totalPages', async () => {
    const { service, findMany } = createService([row(1), row(2)], 15);
    const result = await service.list(staff, { page: 2, limit: 2 });
    const args = findMany.mock.calls[0]![0];
    expect(args.skip).toBe(2);
    expect(args.take).toBe(2);
    expect(result.total).toBe(15);
    expect(result.totalPages).toBe(8);
    expect(result.currentPage).toBe(2);
    expect(result.page).toEqual({
      hasMore: true,
      nextCursor: bookingId(2),
      current: 2,
      total: 15,
      totalPages: 8,
      pageSize: 2,
    });
  });

  it('returns a status summary computed without the status filter', async () => {
    const { service, groupBy, ubahJadwalCount } = createService([]);
    const result = await service.list(staff, { status: 'BOOKED' });
    expect(result.summary).toEqual({
      total: 6,
      booked: 3,
      attended: 2,
      cancelled: 1,
      noShow: 0,
      reschedulePending: 4,
    });
    expect(groupBy.mock.calls[0]![0].where.status).toBeUndefined();
    expect(ubahJadwalCount.mock.calls[0]![0].where.status).toBe('PENDING');
  });

  it('orders upcoming bookings by class start ascending', async () => {
    const { service, findMany } = createService([]);
    await service.list(staff, { timeline: 'UPCOMING' });
    expect(findMany.mock.calls[0]![0].orderBy).toEqual([
      { classSlot: { startAt: 'asc' } },
      { id: 'asc' },
    ]);
    expect(findMany.mock.calls[0]![0].where.status).toEqual({ in: ['BOOKED', 'ATTENDED'] });
  });

  it('keeps timeline and search filters from overwriting each other', async () => {
    const { service, findMany } = createService([]);
    await service.list(staff, { timeline: 'HISTORY', q: 'demo' });
    const and = findMany.mock.calls[0]![0].where.AND as unknown[];
    expect(and).toHaveLength(2);
  });
});
