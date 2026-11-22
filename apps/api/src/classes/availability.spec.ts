import { AvailabilityService } from './ketersediaan-instruktur.service';
import { PolicyService } from '../identity/policy.service';

const principal = {
  sessionId: 'session',
  userId: '00000000-0000-4000-8000-000000000001',
  roles: [{ role: 'INSTRUCTOR' as const, branchId: '00000000-0000-4000-8000-000000000002' }],
  capabilities: ['availability:self:read', 'availability:self:create'],
  branchIds: ['00000000-0000-4000-8000-000000000002'],
};

// Data uji memakai tanggal 20-21 November 2026; jam dibekukan sebelum itu supaya ketersediaan
// tersebut tetap "akan datang" kapan pun tes dijalankan.
beforeAll(() => {
  jest.useFakeTimers({
    now: new Date('2026-11-15T00:00:00.000Z'),
    doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'queueMicrotask'],
  });
});
afterAll(() => jest.useRealTimers());

describe('AvailabilityService boundary', () => {
  const db = {
    slotKelas: { findMany: jest.fn().mockResolvedValue([]) },
    instructorAvailability: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = new AvailabilityService(db as never, new PolicyService(), {} as never);

  beforeEach(() => {
    db.slotKelas.findMany.mockClear();
    db.instructorAvailability.findMany.mockClear().mockResolvedValue([]);
  });

  it('rejects offset-less and non-positive intervals before persistence', async () => {
    await expect(
      service.create(
        principal,
        {
          branchId: principal.branchIds[0]!,
          startAt: '2026-08-01T09:00:00',
          endAt: '2026-08-01T10:00:00Z',
        },
        '1234567890123456',
        'test',
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      service.create(
        principal,
        {
          branchId: principal.branchIds[0]!,
          startAt: '2026-08-01T10:00:00Z',
          endAt: '2026-08-01T10:00:00Z',
        },
        '1234567890123456',
        'test',
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('returns a stable empty page and hides foreign branches', async () => {
    await expect(
      service.list(principal, '00000000-0000-4000-8000-000000000099'),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(service.list(principal, principal.branchIds[0])).resolves.toEqual({
      items: [],
      page: { hasMore: false, nextCursor: null },
    });
  });

  it('reads submitted availability from instructor_availability, not the instructor\'s assigned class slots', async () => {
    db.instructorAvailability.findMany.mockResolvedValueOnce([
      {
        id: 'avail-1',
        instructorId: principal.userId,
        branchId: principal.branchIds[0],
        date: new Date('2026-11-21T00:00:00.000Z'),
        startTime: '08:00:00',
        endTime: '09:00:00',
        branch: { timezone: 'Asia/Jakarta' },
      },
    ]);

    const result = await service.list(principal, principal.branchIds[0]);

    expect(result).toEqual({
      items: [
        {
          id: 'avail-1',
          instructorUserId: principal.userId,
          branchId: principal.branchIds[0],
          startAt: new Date('2026-11-21T08:00:00.000Z'),
          endAt: new Date('2026-11-21T09:00:00.000Z'),
          timezone: 'Asia/Jakarta',
          version: 1,
          status: 'ACTIVE',
        },
      ],
      page: { hasMore: false, nextCursor: null },
    });
    expect(db.slotKelas.findMany).not.toHaveBeenCalled();
  });

  it('parses legacy "HH:MM" (no seconds) rows instead of producing an Invalid Date', async () => {
    db.instructorAvailability.findMany.mockResolvedValueOnce([
      {
        id: 'avail-legacy',
        instructorId: principal.userId,
        branchId: principal.branchIds[0],
        date: new Date('2026-11-20T00:00:00.000Z'),
        startTime: '08:00',
        endTime: '12:00',
        branch: { timezone: 'Asia/Jakarta' },
      },
    ]);

    const result = await service.list(principal, principal.branchIds[0]);

    expect(result.items[0]!.startAt.toISOString()).toBe('2026-11-20T08:00:00.000Z');
    expect(result.items[0]!.endAt.toISOString()).toBe('2026-11-20T12:00:00.000Z');
    expect(Number.isNaN(result.items[0]!.startAt.getTime())).toBe(false);
  });
});

describe('AvailabilityService update / remove (own, not yet ended)', () => {
  const branchId = principal.branchIds[0]!;
  const id = '00000000-0000-4000-8000-0000000000aa';
  const future = new Date(Date.now() + 7 * 86_400_000);
  const dayIso = future.toISOString().slice(0, 10);
  const stored = (over: Record<string, unknown> = {}) => ({
    id,
    instructorId: principal.userId,
    branchId,
    date: new Date(`${dayIso}T00:00:00.000Z`),
    startTime: '08:00:00',
    endTime: '09:00:00',
    branch: { timezone: 'Asia/Jakarta' },
    ...over,
  });
  const db: Record<string, any> = {
    instructorAvailability: {
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    slotKelas: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(),
  };
  db.$transaction.mockImplementation(async (work: (tx: unknown) => unknown) => work(db));
  const service = new AvailabilityService(db as never, new PolicyService(), {} as never);
  const range = { startAt: `${dayIso}T10:00:00Z`, endAt: `${dayIso}T11:30:00Z` };

  beforeEach(() => {
    db.instructorAvailability.findFirst.mockReset().mockResolvedValue(stored());
    db.instructorAvailability.update.mockClear();
    db.instructorAvailability.delete.mockClear();
    db.slotKelas.findFirst.mockReset().mockResolvedValue(null);
  });

  it('changes the hours of an own window and keeps the branch', async () => {
    const result = await service.update(principal, id, range);
    expect(db.instructorAvailability.update).toHaveBeenCalledWith({
      where: { id },
      data: { date: new Date(`${dayIso}T00:00:00.000Z`), startTime: '10:00:00', endTime: '11:30:00' },
    });
    expect(result).toMatchObject({ id, branchId, status: 'ACTIVE' });
    expect(result.endAt.toISOString()).toBe(`${dayIso}T11:30:00.000Z`);
  });

  it('only looks up windows owned by the caller in the caller branches', async () => {
    await service.update(principal, id, range);
    expect(db.instructorAvailability.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id, instructorId: principal.userId, branchId: { in: principal.branchIds } },
      }),
    );
  });

  it('answers 404 for a window that is not the caller\'s', async () => {
    db.instructorAvailability.findFirst.mockResolvedValue(null);
    await expect(service.update(principal, id, range)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(service.remove(principal, id)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(service.remove(principal, 'bukan-uuid')).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(db.instructorAvailability.delete).not.toHaveBeenCalled();
  });

  it('refuses to change or withdraw a window that has already ended', async () => {
    db.instructorAvailability.findFirst.mockResolvedValue(
      stored({ date: new Date('2026-01-05T00:00:00.000Z') }),
    );
    await expect(service.update(principal, id, range)).rejects.toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
    });
    await expect(service.remove(principal, id)).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
    expect(db.instructorAvailability.update).not.toHaveBeenCalled();
    expect(db.instructorAvailability.delete).not.toHaveBeenCalled();
  });

  it('rejects hours that collide with a published/confirmed class and invalid ranges', async () => {
    db.slotKelas.findFirst.mockResolvedValue({ id: 'slot' });
    await expect(service.update(principal, id, range)).rejects.toMatchObject({
      code: 'EFFECTIVE_PERIOD_OVERLAP',
    });
    await expect(
      service.update(principal, id, { startAt: range.endAt, endAt: range.startAt }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(db.instructorAvailability.update).not.toHaveBeenCalled();
  });

  it('withdraws an own, upcoming window permanently', async () => {
    await expect(service.remove(principal, id)).resolves.toEqual({ id, deleted: true });
    expect(db.instructorAvailability.delete).toHaveBeenCalledWith({ where: { id } });
  });

  it('requires the availability capability', async () => {
    const without = { ...principal, capabilities: ['availability:self:read'] };
    await expect(service.update(without, id, range)).rejects.toMatchObject({ status: 403 });
    await expect(service.remove(without, id)).rejects.toMatchObject({ status: 403 });
  });
});
