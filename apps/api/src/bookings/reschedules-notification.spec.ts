import { PolicyService } from '../identity/policy.service';
import { ReschedulesService } from './ubah-jadwal.service';
import type { NotificationWriterService } from '../notifications/notification-writer.service';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const branchId = id(1);
const sourceSlotId = id(20);
const targetSlotId = id(21);
const customerUserId = id(300);

const customerPrincipal = {
  sessionId: 'cust-sess',
  userId: customerUserId,
  roles: [{ role: 'CUSTOMER' as const, branchId: null }],
  capabilities: ['reschedule:self:read', 'reschedule:self:request'],
  branchIds: [] as string[],
};

const adminPrincipal = {
  sessionId: 'admin-sess',
  userId: id(100),
  roles: [{ role: 'ADMIN' as const, branchId }],
  capabilities: ['reschedule:read', 'reschedule:decide'],
  branchIds: [branchId],
};

const config = {
  value: {
    booking: { enabled: true, cutoffHours: 2 },
    reschedule: { enabled: true, cutoffHours: 24 },
  },
} as never;

describe('ReschedulesService Notification Integration', () => {
  it('dispatches in-app notification to branch admin & manager when member requests reschedule', async () => {
    const writtenNotifications: any[] = [];
    const notificationWriter: Partial<NotificationWriterService> = {
      writeForUsersInBranch: jest.fn(async (_tx, input) => {
        writtenNotifications.push(input);
      }),
      writeForUser: jest.fn(async () => {}),
    };

    const futureStartAt = new Date(Date.now() + 48 * 3_600_000);
    const futureTargetAt = new Date(Date.now() + 72 * 3_600_000);

    const tx = {
      pemesananKelas: {
        findUnique: jest.fn(async () => ({
          id: id(10),
          userId: customerUserId,
          status: 'BOOKED',
          classSlotId: sourceSlotId,
          classSlot: {
            id: sourceSlotId,
            branchId,
            startAt: futureStartAt,
            endAt: new Date(futureStartAt.getTime() + 3_600_000),
            classType: { id: 'ct-1', name: 'Reformer Pilates' },
            branch: { id: branchId, name: 'Studio Senopati', timezone: 'Asia/Jakarta' },
          },
          customerPackage: {
            validUntil: new Date(Date.now() + 30 * 86_400_000),
            package: { id: 'pkg-1', classTypeId: 'ct-1', isMultiBranch: true },
          },
          user: { id: customerUserId, displayName: 'Cindy Cindy' },
        })),
        findFirst: jest.fn(async () => null),
      },
      slotKelas: {
        findUnique: jest.fn(async () => ({
          id: targetSlotId,
          branchId,
          classTypeId: 'ct-1',
          status: 'PUBLISHED',
          startAt: futureTargetAt,
          endAt: new Date(futureTargetAt.getTime() + 3_600_000),
          capacity: 10,
          bookedCount: 2,
          classType: { id: 'ct-1', name: 'Reformer Pilates' },
          branch: { id: branchId, name: 'Studio Senopati', timezone: 'Asia/Jakarta' },
        })),
      },
      ubahJadwal: {
        create: jest.fn(async ({ data }: any) => ({
          ...data,
          requestedAt: new Date(),
          sourceSlot: {
            classType: { name: 'Reformer Pilates' },
            branch: { name: 'Studio Senopati' },
          },
          targetSlot: {
            classType: { name: 'Reformer Pilates' },
            branch: { name: 'Studio Senopati', timezone: 'Asia/Jakarta' },
          },
          booking: {
            user: { displayName: 'Cindy Cindy' },
          },
        })),
      },
    };

    const idempotency = {
      execute: jest.fn(async (_c: unknown, action: (t: typeof tx) => Promise<unknown>) => action(tx)),
    };

    const service = new ReschedulesService(
      {} as never,
      idempotency as never,
      new PolicyService(),
      config,
      undefined,
      notificationWriter as NotificationWriterService,
    );

    const result = await service.request(
      customerPrincipal,
      {
        bookingId: id(10),
        targetClassSlotId: targetSlotId,
        reasonCode: 'CUSTOMER_SCHEDULE_CONFLICT',
      },
      'idemp-key-1',
      'corr-1',
    );

    expect(result.status).toBe(201);
    expect(notificationWriter.writeForUsersInBranch).toHaveBeenCalledTimes(1);
    expect(writtenNotifications[0]).toMatchObject({
      branchId,
      roles: ['ADMIN', 'MANAGER'],
      category: 'APPROVAL',
      tone: 'WARNING',
      title: 'Permohonan Reschedule Baru',
      href: '/workspace/bookings?tab=reschedules',
    });
    expect(writtenNotifications[0].message).toContain('Cindy Cindy');
    expect(writtenNotifications[0].message).toContain('Reformer Pilates');
  });

  it('dispatches in-app notification to member when reschedule is approved', async () => {
    const writtenForUser: any[] = [];
    const notificationWriter: Partial<NotificationWriterService> = {
      writeForUser: jest.fn(async (_tx, input) => {
        writtenForUser.push(input);
      }),
    };

    const futureTargetAt = new Date(Date.now() + 72 * 3_600_000);

    const tx = {
      $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
        const sql = strings.join('?');
        return sql.includes('FROM ubah_jadwal') ? [{ sourceSlotId, targetSlotId }] : [];
      }),
      ubahJadwal: {
        findUnique: jest.fn(async () => ({
          id: id(50),
          status: 'PENDING',
          reason: 'CUSTOMER_SCHEDULE_CONFLICT',
          bookingId: id(10),
          sourceSlotId,
          targetSlotId,
          sourceSlot: { id: sourceSlotId, branchId, classType: { name: 'Reformer Pilates' } },
          targetSlot: {
            id: targetSlotId,
            branchId,
            bookedCount: 3,
            capacity: 5,
            status: 'PUBLISHED',
            startAt: futureTargetAt,
            classType: { name: 'Reformer Pilates' },
            branch: { name: 'Studio Senopati', timezone: 'Asia/Jakarta' },
          },
          booking: {
            id: id(10),
            userId: customerUserId,
            status: 'BOOKED',
            classSlotId: sourceSlotId,
            user: { id: customerUserId, displayName: 'Cindy Cindy' },
            customerPackage: {
              validUntil: new Date(Date.now() + 30 * 86_400_000),
              package: { classTypeId: 'ct-1' },
            },
          },
        })),
        update: jest.fn(async ({ data }: any) => ({ id: id(50), ...data })),
      },
      slotKelas: {
        findUnique: jest.fn(async () => ({
          id: targetSlotId,
          bookedCount: 3,
          capacity: 5,
          status: 'PUBLISHED',
          startAt: futureTargetAt,
          endAt: new Date(futureTargetAt.getTime() + 3_600_000),
          branchId,
          classTypeId: 'ct-1',
        })),
        update: jest.fn(async () => ({})),
      },
      pemesananKelas: {
        count: jest.fn(async () => 3),
        findFirst: jest.fn(async () => null),
        update: jest.fn(async () => ({})),
      },
    };

    const idempotency = {
      execute: jest.fn(async (_c: unknown, action: (t: typeof tx) => Promise<unknown>) => action(tx)),
    };

    const service = new ReschedulesService(
      {} as never,
      idempotency as never,
      new PolicyService(),
      config,
      undefined,
      notificationWriter as NotificationWriterService,
    );

    const result = await service.decide(
      adminPrincipal,
      id(50),
      'approve',
      { reasonCode: 'ELIGIBILITY_VERIFIED' },
      'idemp-key-2',
      'corr-2',
    );

    expect(result.status).toBe(200);
    expect(notificationWriter.writeForUser).toHaveBeenCalledTimes(1);
    expect(writtenForUser[0]).toMatchObject({
      userId: customerUserId,
      category: 'SCHEDULE',
      tone: 'SUCCESS',
      title: 'Reschedule Disetujui',
      href: '/bookings',
    });
    expect(writtenForUser[0].message).toContain('Reformer Pilates');
    expect(writtenForUser[0].message).toContain('telah disetujui');
  });

  it('dispatches in-app notification to member when reschedule is rejected', async () => {
    const writtenForUser: any[] = [];
    const notificationWriter: Partial<NotificationWriterService> = {
      writeForUser: jest.fn(async (_tx, input) => {
        writtenForUser.push(input);
      }),
    };

    const tx = {
      $queryRaw: jest.fn(async () => [{ sourceSlotId, targetSlotId }]),
      ubahJadwal: {
        findUnique: jest.fn(async () => ({
          id: id(51),
          status: 'PENDING',
          reason: 'CUSTOMER_SCHEDULE_CONFLICT',
          bookingId: id(10),
          sourceSlotId,
          targetSlotId,
          sourceSlot: { id: sourceSlotId, branchId, classType: { name: 'Reformer Pilates' } },
          targetSlot: {
            id: targetSlotId,
            branchId,
            bookedCount: 5,
            capacity: 5,
            status: 'PUBLISHED',
            classType: { name: 'Reformer Pilates' },
          },
          booking: {
            id: id(10),
            userId: customerUserId,
            status: 'BOOKED',
            classSlotId: sourceSlotId,
            user: { id: customerUserId, displayName: 'Cindy Cindy' },
          },
        })),
        update: jest.fn(async ({ data }: any) => ({ id: id(51), ...data })),
      },
    };

    const idempotency = {
      execute: jest.fn(async (_c: unknown, action: (t: typeof tx) => Promise<unknown>) => action(tx)),
    };

    const service = new ReschedulesService(
      {} as never,
      idempotency as never,
      new PolicyService(),
      config,
      undefined,
      notificationWriter as NotificationWriterService,
    );

    const result = await service.decide(
      adminPrincipal,
      id(51),
      'reject',
      { reasonCode: 'TARGET_UNAVAILABLE' },
      'idemp-key-3',
      'corr-3',
    );

    expect(result.status).toBe(200);
    expect(notificationWriter.writeForUser).toHaveBeenCalledTimes(1);
    expect(writtenForUser[0]).toMatchObject({
      userId: customerUserId,
      category: 'SCHEDULE',
      tone: 'WARNING',
      title: 'Reschedule Belum Disetujui',
      href: '/bookings',
    });
    expect(writtenForUser[0].message).toContain('target kelas tidak tersedia atau penuh');
    expect(writtenForUser[0].message).toContain('Booking tetap berada pada kelas semula');
  });
});

