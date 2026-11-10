import { createHash } from 'node:crypto';
import { AttendanceService } from './kehadiran.service';
import { PolicyService } from '../identity/policy.service';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const branchId = '00000000-0000-4000-8000-000000000002';
const slotId = '00000000-0000-4000-8000-000000000010';
const instructorId = '00000000-0000-4000-8000-000000000050';
const otherInstructorId = '00000000-0000-4000-8000-000000000051';
const rawToken = 'a'.repeat(43);

const NOW = new Date('2026-10-07T04:00:00.000Z');
const inWindowSlot = {
  id: slotId,
  branchId,
  instructorId,
  status: 'CONFIRMED',
  startAt: new Date('2026-10-07T04:30:00.000Z'),
  endAt: new Date('2026-10-07T05:30:00.000Z'),
};

const instructor = {
  sessionId: 's',
  userId: instructorId,
  roles: [{ role: 'INSTRUCTOR' as const, branchId }],
  capabilities: ['attendance:self', 'class-slot:read'],
  branchIds: [branchId],
};
const admin = {
  sessionId: 's2',
  userId: '00000000-0000-4000-8000-000000000001',
  roles: [{ role: 'ADMIN' as const, branchId }],
  capabilities: ['attendance:manage', 'class-slot:read'],
  branchIds: [branchId],
};

function build() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    slotKelas: { findUnique: jest.fn() },
    instructorCheckInToken: {
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'token-new', ...data })),
    },
    kehadiranInstruktur: { upsert: jest.fn().mockResolvedValue({}) },
  };
  const db = {
    instructorCheckInToken: { findUnique: jest.fn() },
    slotKelas: { findUnique: jest.fn() },
    kehadiranInstruktur: { upsert: jest.fn() },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const service = new AttendanceService(db as never, new PolicyService(), {} as never);
  return { db, tx, service };
}

const tokenFor = (slot: Partial<typeof inWindowSlot>, over: Record<string, unknown> = {}) => ({
  id: 'token-1',
  token: sha256(rawToken),
  usedAt: null,
  expiresAt: new Date('2026-10-07T05:30:00.000Z'),
  classSlot: { ...inWindowSlot, ...slot },
  ...over,
});

describe('AttendanceService.consumeInstructor persistence', () => {
  it('records QR attendance for the owning instructor inside the check-in window', async () => {
    const { db, tx, service } = build();
    db.instructorCheckInToken.findUnique.mockResolvedValue(tokenFor({}));
    const result = await service.consumeInstructor(
      instructor,
      { token: `dd-checkin:v1:${rawToken}` },
      'k',
      'c',
      NOW,
    );
    expect(result.body).toMatchObject({ success: true, classSlotId: slotId });
    expect(tx.instructorCheckInToken.update).toHaveBeenCalledWith({
      where: { id: 'token-1' },
      data: { usedAt: NOW },
    });
    expect(tx.kehadiranInstruktur.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { classSlotId: slotId },
        create: expect.objectContaining({ instructorId, method: 'QR_SCAN' }),
      }),
    );
  });

  it('refuses an instructor who is not assigned to the slot without consuming the token', async () => {
    const { db, tx, service } = build();
    db.instructorCheckInToken.findUnique.mockResolvedValue(tokenFor({ instructorId: otherInstructorId }));
    await expect(
      service.consumeInstructor(instructor, { token: rawToken }, 'k', 'c', NOW),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(tx.kehadiranInstruktur.upsert).not.toHaveBeenCalled();
    expect(tx.instructorCheckInToken.update).not.toHaveBeenCalled();
  });

  it('refuses a scan before the check-in window opens', async () => {
    const { db, service } = build();
    db.instructorCheckInToken.findUnique.mockResolvedValue(
      tokenFor({ startAt: new Date('2026-10-07T09:00:00.000Z'), endAt: new Date('2026-10-07T10:00:00.000Z') }),
    );
    await expect(
      service.consumeInstructor(instructor, { token: rawToken }, 'k', 'c', NOW),
    ).rejects.toMatchObject({ code: 'CHECK_IN_TOO_EARLY' });
  });

  it('refuses a scan after the class has ended', async () => {
    const { db, service } = build();
    db.instructorCheckInToken.findUnique.mockResolvedValue(
      tokenFor({ startAt: new Date('2026-10-07T01:00:00.000Z'), endAt: new Date('2026-10-07T02:00:00.000Z') }),
    );
    await expect(
      service.consumeInstructor(instructor, { token: rawToken }, 'k', 'c', NOW),
    ).rejects.toMatchObject({ code: 'CHECK_IN_WINDOW_CLOSED' });
  });

  it('refuses a scan for a slot that is not running (DRAFT)', async () => {
    const { db, service } = build();
    db.instructorCheckInToken.findUnique.mockResolvedValue(tokenFor({ status: 'DRAFT' }));
    await expect(
      service.consumeInstructor(instructor, { token: rawToken }, 'k', 'c', NOW),
    ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
  });

  it('keeps rejecting a token that was already used', async () => {
    const { db, service } = build();
    db.instructorCheckInToken.findUnique.mockResolvedValue(tokenFor({}, { usedAt: NOW }));
    await expect(
      service.consumeInstructor(instructor, { token: rawToken }, 'k', 'c', NOW),
    ).rejects.toMatchObject({ code: 'TOKEN_ALREADY_USED' });
  });
});

describe('AttendanceService.verifyInstructorAttendance (manual)', () => {
  const slotRow = (over: Record<string, unknown> = {}) => ({
    ...inWindowSlot,
    instructorAttendance: null,
    ...over,
  });

  it('lets staff with attendance:manage record attendance and stores who recorded it', async () => {
    const { db, service } = build();
    db.slotKelas.findUnique.mockResolvedValue(slotRow());
    db.kehadiranInstruktur.upsert.mockResolvedValue({
      checkedInAt: NOW,
      method: 'MANUAL_FRONTDESK',
    });
    const result = await service.verifyInstructorAttendance(admin, slotId, { notes: ' lupa scan ' }, NOW);
    expect(result).toMatchObject({ classSlotId: slotId, method: 'MANUAL_FRONTDESK', alreadyRecorded: false });
    expect(db.kehadiranInstruktur.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          instructorId,
          recordedById: admin.userId,
          method: 'MANUAL_FRONTDESK',
          notes: 'lupa scan',
        }),
      }),
    );
  });

  it('is idempotent and never overwrites an existing record', async () => {
    const { db, service } = build();
    db.slotKelas.findUnique.mockResolvedValue(
      slotRow({ instructorAttendance: { checkedInAt: NOW, method: 'QR_SCAN' } }),
    );
    const result = await service.verifyInstructorAttendance(admin, slotId, {}, NOW);
    expect(result).toMatchObject({ alreadyRecorded: true, method: 'QR_SCAN' });
    expect(db.kehadiranInstruktur.upsert).not.toHaveBeenCalled();
  });

  it('masih bisa dicatat manual sampai 2 jam setelah kelas selesai, lewat dari itu ditolak (SOP)', async () => {
    const { db, service } = build();
    const slot = slotRow({ status: 'COMPLETED' });
    db.slotKelas.findUnique.mockResolvedValue(slot);
    db.kehadiranInstruktur.upsert.mockResolvedValue({ checkedInAt: NOW, method: 'MANUAL_FRONTDESK' });
    const selesai = new Date(slot.endAt).getTime();
    await expect(
      service.verifyInstructorAttendance(admin, slotId, {}, new Date(selesai + 90 * 60_000)),
    ).resolves.toMatchObject({ alreadyRecorded: false });
    await expect(
      service.verifyInstructorAttendance(admin, slotId, {}, new Date(selesai + 3 * 86_400_000)),
    ).rejects.toMatchObject({ code: 'ADMIN_BACKFILL_WINDOW_CLOSED' });
  });

  it('denies principals without attendance:manage (instructors cannot verify themselves this way)', async () => {
    const { db, service } = build();
    await expect(
      service.verifyInstructorAttendance(instructor, slotId, {}, NOW),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(db.slotKelas.findUnique).not.toHaveBeenCalled();
  });

  it('hides slots from a foreign branch', async () => {
    const { db, service } = build();
    db.slotKelas.findUnique.mockResolvedValue(
      slotRow({ branchId: '00000000-0000-4000-8000-000000000099' }),
    );
    await expect(
      service.verifyInstructorAttendance(admin, slotId, {}, NOW),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('rejects a slot with no instructor or in a non-verifiable status', async () => {
    const { db, service } = build();
    db.slotKelas.findUnique.mockResolvedValue(slotRow({ instructorId: null }));
    await expect(
      service.verifyInstructorAttendance(admin, slotId, {}, NOW),
    ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
    db.slotKelas.findUnique.mockResolvedValue(slotRow({ status: 'DRAFT' }));
    await expect(
      service.verifyInstructorAttendance(admin, slotId, {}, NOW),
    ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
  });

  it('rejects recording attendance before the check-in window opens', async () => {
    const { db, service } = build();
    db.slotKelas.findUnique.mockResolvedValue(
      slotRow({ startAt: new Date('2026-10-07T09:00:00.000Z'), endAt: new Date('2026-10-07T10:00:00.000Z') }),
    );
    await expect(
      service.verifyInstructorAttendance(admin, slotId, {}, NOW),
    ).rejects.toMatchObject({ code: 'CHECK_IN_TOO_EARLY' });
  });
});

describe('AttendanceService.issueInstructor (studio-issued, slot-bound token)', () => {
  const slotWithNames = (over: Record<string, unknown> = {}) => ({
    ...inWindowSlot,
    classType: { name: 'Group Class' },
    branch: { id: branchId, code: 'GG', name: 'Green Garden', timezone: 'Asia/Jakarta' },
    ...over,
  });

  it('issues a persisted token without needing any booking on the class', async () => {
    const { tx, service } = build();
    tx.slotKelas.findUnique.mockResolvedValue(slotWithNames());
    const result = await service.issueInstructor(admin, slotId, 'k', 'c', NOW);
    expect(tx.instructorCheckInToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        classSlotId: slotId,
        issuedById: admin.userId,
        token: sha256(result.token),
      }),
    });
    expect(result).toMatchObject({
      purpose: 'INSTRUCTOR_CHECK_IN',
      resourceId: slotId,
      qrPayload: `dd-checkin:v1:${result.token}`,
    });
  });

  it('revokes earlier unused tokens for the slot when issuing a new one', async () => {
    const { tx, service } = build();
    tx.slotKelas.findUnique.mockResolvedValue(slotWithNames());
    await service.issueInstructor(admin, slotId, 'k', 'c', NOW);
    expect(tx.instructorCheckInToken.updateMany).toHaveBeenCalledWith({
      where: { classSlotId: slotId, usedAt: null },
      data: { usedAt: NOW },
    });
  });

  it('does not let an instructor issue their own proof of presence', async () => {
    const { db, service } = build();
    await expect(service.issueInstructor(instructor, slotId, 'k', 'c', NOW)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('hides slots of a foreign branch and refuses slots with no instructor or wrong state', async () => {
    const { tx, service } = build();
    tx.slotKelas.findUnique.mockResolvedValue(
      slotWithNames({ branchId: '00000000-0000-4000-8000-000000000099' }),
    );
    await expect(service.issueInstructor(admin, slotId, 'k', 'c', NOW)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    tx.slotKelas.findUnique.mockResolvedValue(slotWithNames({ instructorId: null }));
    await expect(service.issueInstructor(admin, slotId, 'k', 'c', NOW)).rejects.toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
    });
    tx.slotKelas.findUnique.mockResolvedValue(slotWithNames({ status: 'DRAFT' }));
    await expect(service.issueInstructor(admin, slotId, 'k', 'c', NOW)).rejects.toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
    });
  });

  it('respects the check-in window on issuance', async () => {
    const { tx, service } = build();
    tx.slotKelas.findUnique.mockResolvedValue(
      slotWithNames({ startAt: new Date('2026-10-07T09:00:00.000Z'), endAt: new Date('2026-10-07T10:00:00.000Z') }),
    );
    await expect(service.issueInstructor(admin, slotId, 'k', 'c', NOW)).rejects.toMatchObject({
      code: 'CHECK_IN_TOO_EARLY',
    });
    tx.slotKelas.findUnique.mockResolvedValue(
      slotWithNames({ startAt: new Date('2026-10-07T01:00:00.000Z'), endAt: new Date('2026-10-07T02:00:00.000Z') }),
    );
    await expect(service.issueInstructor(admin, slotId, 'k', 'c', NOW)).rejects.toMatchObject({
      code: 'CHECK_IN_WINDOW_CLOSED',
    });
  });
});
