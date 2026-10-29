import { HttpStatus } from '@nestjs/common';
import { PolicyService } from '../identity/policy.service';
import { ClassSlotService } from './slot-kelas.service';

const branchId = '00000000-0000-4000-8000-000000000002';
const studioId = '00000000-0000-4000-8000-000000000070';
const roomId = '00000000-0000-4000-8000-000000000080';
const classTypeId = '00000000-0000-4000-8000-000000000060';
const key = '1234567890123456';
const principal = {
  sessionId: 'session',
  userId: '00000000-0000-4000-8000-000000000001',
  roles: [{ role: 'ADMIN' as const, branchId }],
  capabilities: ['class-slot:read', 'class-slot:manage'],
  branchIds: [branchId],
};

describe('ClassSlotService - Room Capacity Bed Constraint (Poin 2)', () => {
  function createService(roomCapacityBed = 4) {
    const tx = {
      cabang: { findUnique: jest.fn(async () => ({ id: branchId, active: true })) },
      jenisKelas: { findUnique: jest.fn(async () => ({ id: classTypeId, active: true, defaultCapacity: 8 })) },
      studio: { findUnique: jest.fn(async () => ({ id: studioId, branchId, active: true })) },
      ruangan: { findUnique: jest.fn(async () => ({ id: roomId, studioId, active: true, capacityBed: roomCapacityBed })) },
      slotKelas: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({
          ...data,
          branch: { id: branchId, name: 'Branch' },
          studio: { id: studioId, name: 'Studio' },
          room: { id: roomId, name: 'Room 1', capacityBed: roomCapacityBed },
          classType: { id: classTypeId, name: 'Reformer' },
          instructor: null,
        })),
        findMany: jest.fn(async () => []),
      },
    };

    const idempotency = {
      execute: jest.fn(async (_opts: any, action: (t: any) => Promise<any>) => ({
        status: HttpStatus.CREATED,
        body: await action(tx),
        replay: false,
      })),
    };

    const service = new ClassSlotService(
      { slotKelas: { findMany: jest.fn(async () => []) } } as any,
      new PolicyService(),
      idempotency as any,
      { value: { quotaEvaluation: { maxAttempts: 5 } } } as any,
    );

    return { service, tx };
  }

  it('menolak pembuatan slot jika kapasitas melebihi kapasitas ranjang reformer ruangan', async () => {
    const { service } = createService(4); // Room capacity is 4 beds (seperti Muara Karang)

    await expect(
      service.create(
        principal,
        {
          branchId,
          classTypeId,
          studioId,
          roomId,
          startAt: '2026-10-15T09:00:00Z',
          endAt: '2026-10-15T09:50:00Z',
          capacity: 5, // Explicitly requesting 5 on a 4-bed room
        } as any,
        key,
        'test-corr',
      ),
    ).rejects.toMatchObject({
      code: 'CAPACITY_EXCEEDS_ROOM_LIMIT',
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('menolak studio milik cabang lain agar kelas tidak tersimpan di timetable cabang lain', async () => {
    const { service, tx } = createService(4);
    tx.studio.findUnique.mockResolvedValueOnce({
      id: studioId,
      branchId: '00000000-0000-4000-8000-0000000000ff',
      active: true,
    } as never);
    await expect(
      service.create(
        principal,
        {
          branchId,
          classTypeId,
          studioId,
          roomId,
          startAt: '2026-10-15T09:00:00Z',
          endAt: '2026-10-15T09:50:00Z',
        } as any,
        key,
        'test-corr',
      ),
    ).rejects.toMatchObject({ code: 'STUDIO_BRANCH_MISMATCH' });
    expect(tx.slotKelas.create).not.toHaveBeenCalled();
  });

  it('otomatis membatasi kapasitas ke kapasitas ranjang ruangan bila kapasitas tidak ditentukan', async () => {
    const { service, tx } = createService(4); // Room capacity is 4 beds, default classType is 8

    const result = await service.create(
      principal,
      {
        branchId,
        classTypeId,
        studioId,
        roomId,
        startAt: '2026-10-15T09:00:00Z',
        endAt: '2026-10-15T09:50:00Z',
      } as any,
      key,
      'test-corr',
    );

    expect(result.status).toBe(HttpStatus.CREATED);
    expect(tx.slotKelas.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          capacity: 4, // Clamped to 4
        }),
      }),
    );
  });
});
