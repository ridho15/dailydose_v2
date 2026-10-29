import { ROLE_CAPABILITIES } from './role-capabilities';
import { InstructorManagementService } from './manajemen-instruktur.service';
import { PolicyService } from './policy.service';

const branch = 'branch-1';
const coach = { id: 'coach-1', displayName: 'Coach Sarah' };

const viewer = (role: keyof typeof ROLE_CAPABILITIES, branchIds = [branch]) => ({
  sessionId: 's',
  userId: 'viewer-1',
  roles: [{ role, branchId: branch }] as never,
  capabilities: [...ROLE_CAPABILITIES[role]],
  branchIds,
});
// ADMIN/MANAGER dapat membuka halaman (assignment:read) tetapi bukan data honor.
const admin = viewer('ADMIN');
const superOwner = viewer('SUPER_OWNER');

const recentSlot = (id: string, instructorAttendance: unknown, over: Record<string, unknown> = {}) => ({
  id,
  startAt: new Date('2026-09-10T02:00:00Z'),
  endAt: new Date('2026-09-10T03:00:00Z'),
  status: 'COMPLETED',
  branchId: branch,
  classTypeId: 'group',
  classType: { code: 'GRP', name: 'Group Class' },
  branch: { id: branch, name: 'Jakarta' },
  instructorAttendance,
  ...over,
});

const monthSlot = (instructorAttendance: unknown, over: Record<string, unknown> = {}) => ({
  startAt: new Date('2026-09-10T02:00:00Z'),
  endAt: new Date('2026-09-10T03:00:00Z'),
  branchId: branch,
  classTypeId: 'group',
  instructor: coach,
  classType: { name: 'Group Class' },
  instructorAttendance,
  ...over,
});

const fee = {
  instructorId: coach.id,
  branchId: branch,
  classTypeId: 'group',
  effectiveDate: new Date('2026-01-01T00:00:00Z'),
  feePerJamRp: 200_000,
};

function build(opts: { recent?: unknown[]; month?: unknown[]; fees?: unknown[]; rows?: unknown[] } = {}) {
  const userFindFirst = jest.fn().mockResolvedValue({
    id: coach.id,
    displayName: coach.displayName,
    email: null,
    phone: null,
    status: 'ACTIVE',
    instructorAssignments: [],
    instructedClassSlots: opts.recent ?? [],
  });
  const userFindMany = jest.fn().mockResolvedValue(
    opts.rows ?? [
      {
        id: coach.id,
        displayName: coach.displayName,
        email: null,
        phone: null,
        status: 'ACTIVE',
        instructorAssignments: [],
        _count: { instructedClassSlots: 3, instructorAttendances: 1 },
      },
    ],
  );
  const slotFindMany = jest.fn().mockResolvedValue(opts.month ?? []);
  const feeFindMany = jest.fn().mockResolvedValue(opts.fees ?? [fee]);
  const db = {
    user: { findFirst: userFindFirst, findMany: userFindMany, count: jest.fn().mockResolvedValue(1) },
    slotKelas: { findMany: slotFindMany },
    instructorFee: { findMany: feeFindMany },
  };
  return {
    service: new InstructorManagementService(db as never, new PolicyService()),
    userFindMany,
    slotFindMany,
    feeFindMany,
  };
}

describe('InstructorManagementService attendance data', () => {
  it('reports real attendance per class instead of assuming everyone checked in at start time', async () => {
    const checkedInAt = new Date('2026-09-10T01:50:00Z');
    const { service } = build({
      recent: [recentSlot('a', { checkedInAt, method: 'QR_SCAN' }), recentSlot('b', null)],
    });
    const detail = await service.detail(admin, coach.id);
    const [withCheckIn, without] = detail.instructedClassSlots;
    expect(withCheckIn?.instructorAttendances).toEqual([{ checkedInAt, method: 'QR_SCAN' }]);
    expect(without?.instructorAttendances).toEqual([]);
    expect(detail.instructorAttendances).toHaveLength(1);
  });

  it('counts this month\'s completed classes without attendance as a blocker', async () => {
    const { service } = build({ month: [monthSlot({ id: 'att' }), monthSlot(null), monthSlot(null)] });
    const detail = await service.detail(admin, coach.id);
    expect(detail.blockers.completedWithoutCheckIn).toBe(2);
  });

  it('lists only accounts with the instructor role', async () => {
    const { service, userFindMany } = build();
    await service.list(superOwner, {});
    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ role: 'INSTRUCTOR' }),
      }),
    );
  });

  it('lists only instructors who are still teaching: active, not stopped, assigned somewhere', async () => {
    const { service, userFindMany } = build();
    await service.list(superOwner, {});
    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'ACTIVE',
          stoppedAt: null,
          instructorAssignments: { some: { active: true } },
        }),
      }),
    );
  });

  it('keeps branch staff to instructors actively assigned at their branch', async () => {
    const { service, userFindMany } = build();
    await service.list(admin, {});
    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          stoppedAt: null,
          instructorAssignments: { some: { branchId: { in: [branch] }, active: true } },
        }),
      }),
    );
  });

  it('refuses viewers without assignment:read', async () => {
    const { service } = build();
    await expect(
      service.detail({ ...admin, capabilities: ['user:read'] }, coach.id),
    ).rejects.toBeDefined();
  });
});

describe('InstructorManagementService honor', () => {
  const month = [monthSlot({ id: 'att' }), monthSlot(null)];

  it('shows a fee-permitted viewer this month\'s honor with the unverified part split out', async () => {
    const { service } = build({ month });
    const [item] = (await service.list(superOwner, {})).items;
    // Hanya kelas dengan presensi instruktur yang dihitung honor; sisanya dilaporkan terpisah.
    expect(item).toMatchObject({
      compensationRp: 200_000,
      unverifiedCompensationRp: 200_000,
      compensationPeriod: new Date().toISOString().slice(0, 7),
    });
    const detail = await service.detail(superOwner, coach.id);
    expect(detail.compensationRp).toBe(200_000);
    expect(detail.unverifiedCompensationRp).toBe(200_000);
  });

  it('gives each completed class its own amount and none to classes that did not run', async () => {
    const { service } = build({
      recent: [recentSlot('done', null), recentSlot('planned', null, { status: 'CONFIRMED' })],
    });
    const detail = await service.detail(superOwner, coach.id);
    expect(detail.instructedClassSlots[0]?.instructorHourLog).toEqual({ amountRp: 200_000 });
    expect(detail.instructedClassSlots[1]?.instructorHourLog).toBeNull();
  });

  it('flags classes billed at the default fee because no fee is configured', async () => {
    const { service } = build({
      month: [monthSlot({ id: 'att' }, { classTypeId: 'private' })],
      fees: [fee],
    });
    const detail = await service.detail(superOwner, coach.id);
    expect(detail.blockers.completedWithoutFee).toBe(1);
  });

  it('never exposes amounts to ADMIN/MANAGER, and does not even load fee data for the list', async () => {
    expect(ROLE_CAPABILITIES.ADMIN).not.toContain('instructor:fee:read');
    expect(ROLE_CAPABILITIES.MANAGER).not.toContain('instructor:fee:read');
    const { service, slotFindMany, feeFindMany } = build({
      month,
      recent: [recentSlot('done', null)],
    });
    const [item] = (await service.list(admin, {})).items;
    expect(item?.compensationRp).toBeNull();
    expect(item?.unverifiedCompensationRp).toBeNull();
    expect(slotFindMany).not.toHaveBeenCalled();
    expect(feeFindMany).not.toHaveBeenCalled();

    const detail = await service.detail(admin, coach.id);
    expect(detail.compensationRp).toBeNull();
    expect(detail.unverifiedCompensationRp).toBeNull();
    expect(detail.instructedClassSlots[0]?.instructorHourLog).toBeNull();
    // Peringatan operasional tetap terlihat tanpa membuka nominal.
    expect(detail.blockers.completedWithoutCheckIn).toBe(1);
  });

  it('limits a branch-scoped viewer\'s honor to the branches they can see', async () => {
    const { service, slotFindMany } = build({ month });
    const owner = { ...viewer('OWNER'), capabilities: ['assignment:read', 'instructor:fee:read'] };
    await service.detail(owner, coach.id);
    expect(slotFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ branchId: { in: [branch] }, status: 'COMPLETED' }),
      }),
    );
  });
});
