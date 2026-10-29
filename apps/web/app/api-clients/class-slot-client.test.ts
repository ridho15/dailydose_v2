import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserClassSlotClient, classSlotFailure } from './class-slot-client';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const forbidden = () =>
  jsonResponse({ error: { code: 'FORBIDDEN', message: 'Forbidden' } }, 403);

describe('browserClassSlotClient.discover', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps fetched class slots visible even when auxiliary lookups (class-types/users/assignments/studios) 403 for a capability-limited session', async () => {
    const slot = {
      id: 'slot-1',
      branchId: 'branch-1',
      classTypeId: 'type-1',
      studioId: 'studio-1',
      instructorUserId: 'instructor-1',
      startAt: '2026-10-07T04:57:31.073Z',
      endAt: '2026-10-07T05:57:31.073Z',
      timezone: 'Asia/Jakarta',
      capacity: 10,
      bookedCount: 3,
      minimumQuota: 2,
      status: 'CONFIRMED',
      version: 1,
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      // Only /class-slots succeeds; the auxiliary lookups 403 for an INSTRUCTOR/COACH session
      // that lacks master:read / user:read / assignment:read.
      if (url.includes('/class-slots?')) {
        return jsonResponse({ items: [slot], page: { nextCursor: null } });
      }
      return forbidden();
    });

    const workspace = await browserClassSlotClient.discover({
      branchId: 'branch-1',
      timezone: 'Asia/Jakarta',
      from: new Date('2026-10-05T00:00:00.000Z'),
      until: new Date('2026-10-11T23:59:59.000Z'),
    });

    expect(workspace.slots).toHaveLength(1);
    expect(workspace.slots[0]!.id).toBe('slot-1');
    expect(workspace.slots[0]!.startAt).toBeInstanceOf(Date);
    expect(workspace.classTypes).toEqual([]);
    expect(workspace.instructors).toEqual([]);
    expect(workspace.studios).toEqual([]);
  });

  describe('instructor options', () => {
    const assignment = (userId: string, displayName: string | null, overrides: Record<string, unknown> = {}) => ({
      id: `a-${userId}`,
      userId,
      branchId: 'branch-1',
      assignmentType: 'INSTRUCTOR',
      status: 'ACTIVE',
      activeFrom: '2020-01-01',
      activeUntil: null,
      user: displayName === null ? null : { displayName },
      ...overrides,
    });

    const run = async (pages: Array<{ items: unknown[]; hasMore?: boolean }>) => {
      const urls: string[] = [];
      let served = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        urls.push(url);
        if (url.includes('/class-slots?')) return jsonResponse({ items: [], page: { nextCursor: null } });
        if (url.includes('/assignments?')) {
          const page = pages[Math.min(served, pages.length - 1)]!;
          served += 1;
          return jsonResponse({ items: page.items, page: { hasMore: Boolean(page.hasMore), nextCursor: page.hasMore ? `c${served}` : null } });
        }
        return jsonResponse({ items: [] });
      });
      const workspace = await browserClassSlotClient.discover({
        branchId: 'branch-1',
        timezone: 'Asia/Jakarta',
        from: new Date('2026-10-05T00:00:00.000Z'),
        until: new Date('2026-10-11T23:59:59.000Z'),
      });
      return { workspace, urls };
    };

    it('lists only people with an active instructor assignment, not every user of the branch', async () => {
      const { workspace, urls } = await run([
        {
          items: [
            assignment('u-sarah', 'Sarah Jenkins'),
            assignment('u-ended', 'Mantan Instruktur', { status: 'ENDED' }),
            assignment('u-expired', 'Sudah Berakhir', { activeUntil: '2020-02-01' }),
            assignment('u-future', 'Belum Mulai', { activeFrom: '2999-01-01' }),
            assignment('u-other', 'Bukan Instruktur', { assignmentType: 'FRONT_DESK' }),
            assignment('u-elsewhere', 'Cabang Lain', { branchId: 'branch-2' }),
          ],
        },
      ]);
      expect(workspace.instructors).toEqual([{ id: 'u-sarah', branchId: 'branch-1', displayName: 'Sarah Jenkins' }]);
      expect(urls.some((url) => url.includes('/users?'))).toBe(false);
      expect(urls.find((url) => url.includes('/assignments?'))).toMatch(/type=INSTRUCTOR.*status=ACTIVE|status=ACTIVE.*type=INSTRUCTOR/);
    });

    it('follows every page of assignments, trims names, sorts them and drops duplicates', async () => {
      const { workspace } = await run([
        { items: [assignment('u-b', 'Stephen '), assignment('u-a', 'Asri')], hasMore: true },
        { items: [assignment('u-b', 'Stephen '), assignment('u-c', null)] },
      ]);
      expect(workspace.instructors.map((item) => item.displayName)).toEqual(['Asri', 'Instruktur u-c', 'Stephen']);
    });
  });

  it('asks only for class slots when the caller needs nothing else (slotsOnly)', async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      calls.push(String(input));
      return jsonResponse({ items: [], page: { nextCursor: null } });
    });

    const workspace = await browserClassSlotClient.discover({
      branchId: 'branch-1',
      branches: [{ id: 'branch-1', timezone: 'Asia/Jakarta' }],
      timezone: 'Asia/Jakarta',
      from: new Date('2026-10-26T00:00:00Z'),
      until: new Date('2026-11-01T00:00:00Z'),
      slotsOnly: true,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/class-slots?');
    expect(calls.some((url) => /class-types|assignments|studios/.test(url))).toBe(false);
    expect(workspace.slots).toEqual([]);
    expect(workspace.classTypes).toEqual([]);
    expect(workspace.instructors).toEqual([]);
  });

  it('still surfaces a failure when the primary /class-slots request itself fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => forbidden());

    await expect(
      browserClassSlotClient.discover({
        branchId: 'branch-1',
        timezone: 'Asia/Jakarta',
        from: new Date('2026-10-05T00:00:00.000Z'),
        until: new Date('2026-10-11T23:59:59.000Z'),
      }),
    ).rejects.toThrow();
  });
});

describe('classSlotFailure untuk jadwal bentrok', () => {
  const galat = (code: string) => ({
    status: 409,
    data: { error: { code, details: [{ issue: 'Reformer Group, Jum 30 Okt 17.00 sampai 18.00, Daily Dose Green Garden' }] } },
  });

  it('menyebut instruktur dan kelas yang menghalangi, bukan ruangan', () => {
    const pesan = classSlotFailure(galat('INSTRUCTOR_SCHEDULE_COLLISION'));
    expect(pesan).toMatch(/^Instruktur ini sudah mengajar kelas lain/);
    expect(pesan).toContain('Daily Dose Green Garden');
    expect(pesan).not.toMatch(/Ruangan/);
  });

  it('menyebut ruangan dan kelas yang memakainya', () => {
    expect(classSlotFailure(galat('SLOT_SCHEDULE_COLLISION'))).toMatch(
      /^Ruangan ini sudah dipakai kelas lain pada jam yang sama: Reformer Group/,
    );
  });
});
