import { PolicyService } from '../identity/policy.service';
import { ClassSlotService } from './slot-kelas.service';

const branchId = '00000000-0000-4000-8000-000000000002';
const slotId = '00000000-0000-4000-8000-000000000010';
const instructorId = '00000000-0000-4000-8000-000000000050';
const classTypeId = '00000000-0000-4000-8000-000000000060';
const key = '1234567890123456';
const principal = {
  sessionId: 'session',
  userId: '00000000-0000-4000-8000-000000000001',
  roles: [{ role: 'ADMIN' as const, branchId }],
  capabilities: ['class-slot:read', 'class-slot:manage'],
  branchIds: [branchId],
};

type Row = Record<string, unknown>;

/** Slot yang dikembalikan `findUnique`; `version` dan `status` diatur per tes. */
const slotRow = (overrides: Row = {}): Row => ({
  id: slotId,
  branchId,
  studioId: '00000000-0000-4000-8000-000000000070',
  roomId: null,
  classTypeId,
  instructorId,
  startAt: new Date('2026-10-12T14:00:00Z'),
  endAt: new Date('2026-10-12T14:50:00Z'),
  capacity: 8,
  bookedCount: 3,
  status: 'DRAFT',
  version: 4,
  notes: null,
  bookings: [],
  ...overrides,
});

function build(initial: Row, opts: { claimCount?: number; afterClaim?: Row } = {}) {
  const current = initial;
  const tx = {
    slotKelas: {
      findUnique: jest.fn(async () => current),
      findFirst: jest.fn(async () => null),
      updateMany: jest.fn(async () => ({ count: opts.claimCount ?? 1 })),
      findUniqueOrThrow: jest.fn(async () => ({
        ...current,
        ...(opts.afterClaim ?? {}),
        version: Number(current.version) + 1,
      })),
    },
    pemesananKelas: { update: jest.fn(async () => ({})) },
    sessionLedger: { create: jest.fn(async () => ({})), findFirst: jest.fn(async () => null) },
    paketPelanggan: { findUnique: jest.fn(async () => null), update: jest.fn(async () => ({})) },
    checkInToken: { updateMany: jest.fn(async () => ({ count: 0 })) },
  };
  const execute = jest.fn(async (_options: unknown, action: (t: unknown) => Promise<object>) => ({
    ...(await action(tx)),
    replay: false,
  }));
  const service = new ClassSlotService(
    { slotKelas: { findUnique: jest.fn(async () => current) }, pemesananKelas: { findMany: jest.fn(async () => []) } } as never,
    new PolicyService(),
    { execute } as never,
    { value: {} } as never,
  );
  return { service, tx };
}

describe('class slot status changes require a version', () => {
  it.each([
    ['publish', (s: ClassSlotService) => s.publish(principal, slotId, {}, key, 'c')],
    ['cancel', (s: ClassSlotService) => s.cancel(principal, slotId, { reasonCode: 'SAFETY_ISSUE' } as never, key, 'c')],
  ])('rejects %s without expectedVersion before touching the database', async (_name, call) => {
    const { service, tx } = build(slotRow());
    await expect(call(service)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 422,
    });
    expect(tx.slotKelas.updateMany).not.toHaveBeenCalled();
  });
});

describe('assigning an instructor and editing a draft: the version is optional', () => {
  const editInput = { classTypeId, startAt: '2026-10-12T21:00:00+07:00', endAt: '2026-10-12T21:50:00+07:00', reason: 'Ubah jam' };

  it('assign works without a version and then relies on the status guard only', async () => {
    const { service, tx } = build(slotRow({ instructorId: null }));
    await service.assign(principal, slotId, { instructorUserId: instructorId }, key, 'c');
    const [call] = tx.slotKelas.updateMany.mock.calls as unknown as Array<[{ where: Record<string, unknown> }]>;
    expect(call![0].where).not.toHaveProperty('version');
    expect(call![0].where).toMatchObject({ id: slotId, status: { in: expect.any(Array) } });
  });

  it('update works without a version and keeps the instructor when none is sent', async () => {
    const { service, tx } = build(slotRow());
    await service.update(principal, slotId, editInput as never, key, 'c');
    const [call] = tx.slotKelas.updateMany.mock.calls as unknown as Array<[{ where: Record<string, unknown> }]>;
    expect(call![0].where).not.toHaveProperty('version');
  });

  it('a version that is sent is still checked (stale form is refused)', async () => {
    const { service, tx } = build(slotRow({ version: 5 }));
    await expect(
      service.assign(principal, slotId, { instructorUserId: instructorId, expectedVersion: 4 }, key, 'c'),
    ).rejects.toMatchObject({ code: 'STALE_VERSION', status: 409 });
    await expect(
      service.update(principal, slotId, { ...editInput, expectedVersion: 4 } as never, key, 'c'),
    ).rejects.toMatchObject({ code: 'STALE_VERSION', status: 409 });
    expect(tx.slotKelas.updateMany).not.toHaveBeenCalled();
  });

  it('the status guard still applies without a version', async () => {
    const { service } = build(slotRow({ status: 'COMPLETED' }));
    await expect(
      service.assign(principal, slotId, { instructorUserId: instructorId }, key, 'c'),
    ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
  });
});

describe('class slot status guards', () => {
  it.each(['CANCELLED', 'COMPLETED', 'PUBLISHED', 'CONFIRMED'])('refuses to publish a %s class', async (status) => {
    const { service, tx } = build(slotRow({ status }));
    await expect(
      service.publish(principal, slotId, { expectedVersion: 4 }, key, 'c'),
    ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
    expect(tx.slotKelas.updateMany).not.toHaveBeenCalled();
  });

  it.each(['CANCELLED', 'COMPLETED'])('refuses to assign an instructor to a %s class', async (status) => {
    const { service } = build(slotRow({ status }));
    await expect(
      service.assign(principal, slotId, { instructorUserId: instructorId, expectedVersion: 4 }, key, 'c'),
    ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
  });

  it.each(['PUBLISHED', 'CONFIRMED'])('allows assigning an instructor to a %s class', async (status) => {
    const { service, tx } = build(slotRow({ status, instructorId: null }));
    await service.assign(principal, slotId, { instructorUserId: instructorId, expectedVersion: 4 }, key, 'c');
    expect(tx.slotKelas.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ instructorId }) }),
    );
  });

  it.each(['CONFIRMED', 'COMPLETED', 'CANCELLED'])(
    'confirmed, completed, or cancelled classes cannot be edited (%s refused)',
    async (status) => {
      const { service } = build(slotRow({ status }));
      await expect(
        service.update(
          principal,
          slotId,
          {
            classTypeId,
            startAt: '2026-10-12T21:00:00+07:00',
            endAt: '2026-10-12T21:50:00+07:00',
            expectedVersion: 4,
          },
          key,
          'c',
        ),
      ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
    },
  );

  it('refuses to edit a published class if it already has bookings', async () => {
    const { service } = build(slotRow({ status: 'PUBLISHED', bookedCount: 1 }));
    await expect(
      service.update(
        principal,
        slotId,
        {
          classTypeId,
          startAt: '2026-10-12T21:00:00+07:00',
          endAt: '2026-10-12T21:50:00+07:00',
          expectedVersion: 4,
        },
        key,
        'c',
      ),
    ).rejects.toMatchObject({ code: 'CLASS_SLOT_HAS_BOOKINGS' });
  });

  it('allows editing a published class if it has 0 bookings', async () => {
    const { service, tx } = build(slotRow({ status: 'PUBLISHED', bookedCount: 0 }));
    await service.update(
      principal,
      slotId,
      {
        classTypeId,
        startAt: '2026-10-12T21:00:00+07:00',
        endAt: '2026-10-12T21:50:00+07:00',
        expectedVersion: 4,
      },
      key,
      'c',
    );
    expect(tx.slotKelas.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ classTypeId }) }),
    );
  });

  it.each(['COMPLETED', 'CANCELLED'])('never cancels a %s class or touches its bookings', async (status) => {
    const { service, tx } = build(slotRow({ status, bookings: [{ id: 'b1', customerPackageId: 'p1' }] }));
    await expect(
      service.cancel(principal, slotId, { reasonCode: 'SAFETY_ISSUE', expectedVersion: 4 }, key, 'c'),
    ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
    expect(tx.pemesananKelas.update).not.toHaveBeenCalled();
    expect(tx.sessionLedger.create).not.toHaveBeenCalled();
  });

  it.each(['DRAFT', 'PUBLISHED', 'CANCELLED'])('completes only CONFIRMED classes (%s refused)', async (status) => {
    const { service, tx } = build(slotRow({ status, bookings: [] }));
    await expect(service.complete(principal, slotId, {}, key, 'c')).rejects.toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
    });
    expect(tx.slotKelas.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to publish a draft that has no instructor', async () => {
    const { service, tx } = build(slotRow({ instructorId: null }));
    await expect(
      service.publish(principal, slotId, { expectedVersion: 4 }, key, 'c'),
    ).rejects.toMatchObject({ code: 'INSTRUCTOR_REQUIRED', status: 422 });
    expect(tx.slotKelas.updateMany).not.toHaveBeenCalled();
  });
});

describe('class slot optimistic locking', () => {
  it('reports a stale version without writing', async () => {
    const { service, tx } = build(slotRow({ version: 5 }));
    await expect(
      service.publish(principal, slotId, { expectedVersion: 4 }, key, 'c'),
    ).rejects.toMatchObject({ code: 'STALE_VERSION', status: 409 });
    expect(tx.slotKelas.updateMany).not.toHaveBeenCalled();
  });

  it('claims with the version and allowed statuses, bumps the version by one and returns the new one', async () => {
    const { service, tx } = build(slotRow());
    const result = await service.publish(principal, slotId, { expectedVersion: 4 }, key, 'c');
    expect(tx.slotKelas.updateMany).toHaveBeenCalledWith({
      where: { id: slotId, version: 4, status: { in: ['DRAFT'] } },
      data: { status: 'PUBLISHED', version: { increment: 1 } },
    });
    expect((result as { body: { version: number } }).body.version).toBe(5);
  });

  it('turns a lost race into STALE_VERSION when the status is still allowed', async () => {
    const { service } = build(slotRow(), { claimCount: 0 });
    await expect(
      service.publish(principal, slotId, { expectedVersion: 4 }, key, 'c'),
    ).rejects.toMatchObject({ code: 'STALE_VERSION' });
  });

  it('turns a lost race into INVALID_STATE_TRANSITION when the status moved on', async () => {
    // Pembacaan awal masih DRAFT (lolos pemeriksaan awal); saat klaim gagal, kelas sudah dibatalkan.
    const draft = slotRow();
    const cancelled = slotRow({ status: 'CANCELLED' });
    const { service, tx } = build(draft, { claimCount: 0 });
    let reads = 0;
    tx.slotKelas.findUnique.mockImplementation(async () => (reads++ === 0 ? draft : cancelled));
    await expect(
      service.publish(principal, slotId, { expectedVersion: 4 }, key, 'c'),
    ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
  });

  it('keeps the instructor when an edit does not send one, and clears it only on an explicit null', async () => {
    const edit = {
      classTypeId,
      startAt: '2026-10-12T21:00:00+07:00',
      endAt: '2026-10-12T21:50:00+07:00',
      expectedVersion: 4,
    };
    const kept = build(slotRow());
    await kept.service.update(principal, slotId, edit, key, 'c');
    expect(kept.tx.slotKelas.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ instructorId }) }),
    );

    const cleared = build(slotRow());
    await cleared.service.update(principal, slotId, { ...edit, instructorUserId: null }, key, 'c');
    expect(cleared.tx.slotKelas.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ instructorId: null }) }),
    );
  });

  it('cancels a published class, releases its bookings and bumps the version once', async () => {
    const { service, tx } = build(
      slotRow({ status: 'PUBLISHED', bookings: [{ id: 'b1', customerPackageId: null }] }),
    );
    await service.cancel(principal, slotId, { reasonCode: 'SAFETY_ISSUE', expectedVersion: 4 }, key, 'c');
    expect(tx.slotKelas.updateMany).toHaveBeenCalledWith({
      where: { id: slotId, version: 4, status: { in: ['DRAFT', 'PUBLISHED', 'CONFIRMED'] } },
      data: {
        status: 'CANCELLED',
        cancellationReason: 'SAFETY_ISSUE',
        bookedCount: 0,
        version: { increment: 1 },
      },
    });
    expect(tx.pemesananKelas.update).toHaveBeenCalledTimes(1);
  });

  it('completion needs the version to match when one is sent, and moves CONFIRMED to COMPLETED', async () => {
    const stale = build(slotRow({ status: 'CONFIRMED', version: 6 }));
    await expect(
      stale.service.complete(principal, slotId, { expectedVersion: 4 }, key, 'c'),
    ).rejects.toMatchObject({ code: 'STALE_VERSION' });

    const ok = build(slotRow({ status: 'CONFIRMED', version: 4, bookings: [] }));
    await ok.service.complete(principal, slotId, { expectedVersion: 4 }, key, 'c');
    expect(ok.tx.slotKelas.updateMany).toHaveBeenCalledWith({
      where: { id: slotId, status: 'CONFIRMED', version: 4 },
      data: { status: 'COMPLETED', version: { increment: 1 } },
    });
  });

  it('exposes the real version through completion-control and the slot view', async () => {
    const { service } = build(slotRow({ status: 'CONFIRMED', version: 7 }));
    await expect(service.completionControl(principal, slotId)).resolves.toMatchObject({
      expectedVersion: 7,
    });
  });
});
