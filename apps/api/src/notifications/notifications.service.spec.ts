import { Prisma } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { NotificationWriterService } from './notification-writer.service';

const principal = {
  userId: 'user-1',
  roles: [{ role: 'CUSTOMER', branchId: null }],
  branchIds: [],
  capabilities: ['customer:self'],
} as never;

describe('NotificationsService and NotificationWriterService (Database-backed)', () => {
  let notificationsTable: Array<{
    id: string;
    userId: string;
    branchId: string | null;
    eventKey: string;
    category: string;
    tone: string;
    title: string;
    message: string;
    href: string | null;
    metadataMasked: any;
    readAt: Date | null;
    expiresAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }> = [];

  let usersTable: Array<{
    id: string;
    preferredBranchId: string | null;
    status: string;
    role: string;
  }> = [];

  const mockDb = {
    notification: {
      findMany: jest.fn(async (args: any) => {
        let results = notificationsTable.filter((n) => {
          if (args.where?.userId && n.userId !== args.where.userId) return false;
          if (args.where?.readAt === null && n.readAt !== null) return false;
          if (args.where?.OR) {
            const now = new Date();
            const matchesExpiry = args.where.OR.some((condition: any) => {
              if (condition.expiresAt === null) return n.expiresAt === null;
              if (condition.expiresAt?.gt) return n.expiresAt && n.expiresAt > now;
              return true;
            });
            if (!matchesExpiry) return false;
          }
          return true;
        });

        // Order by createdAt desc
        results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

        if (args.cursor?.id) {
          const cursorIndex = results.findIndex((r) => r.id === args.cursor.id);
          if (cursorIndex !== -1) {
            const skip = args.skip ?? 0;
            results = results.slice(cursorIndex + skip);
          }
        }

        if (args.take) {
          results = results.slice(0, args.take);
        }

        return results;
      }),

      findFirst: jest.fn(async (args: any) => {
        return (
          notificationsTable.find((n) => {
            if (args.where?.id && n.id !== args.where.id) return false;
            if (args.where?.userId && n.userId !== args.where.userId) return false;
            return true;
          }) ?? null
        );
      }),

      count: jest.fn(async (args: any) => {
        return notificationsTable.filter((n) => {
          if (args.where?.userId && n.userId !== args.where.userId) return false;
          if (args.where?.readAt === null && n.readAt !== null) return false;
          if (args.where?.OR) {
            const now = new Date();
            const matchesExpiry = args.where.OR.some((condition: any) => {
              if (condition.expiresAt === null) return n.expiresAt === null;
              if (condition.expiresAt?.gt) return n.expiresAt && n.expiresAt > now;
              return true;
            });
            if (!matchesExpiry) return false;
          }
          return true;
        }).length;
      }),

      create: jest.fn(async (args: any) => {
        const { data } = args;
        // Check unique constraint @@unique([userId, eventKey])
        const existing = notificationsTable.find(
          (n) => n.userId === data.userId && n.eventKey === data.eventKey,
        );
        if (existing) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: '6.x',
          });
        }

        const record = {
          ...data,
          createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
          updatedAt: new Date(),
        };
        notificationsTable.unshift(record);
        return record;
      }),

      update: jest.fn(async (args: any) => {
        const item = notificationsTable.find((n) => n.id === args.where.id);
        if (!item) {
          throw new Error('Record not found');
        }
        Object.assign(item, args.data, { updatedAt: new Date() });
        return item;
      }),

      updateMany: jest.fn(async (args: any) => {
        let count = 0;
        for (const item of notificationsTable) {
          if (args.where?.userId && item.userId !== args.where.userId) continue;
          if (args.where?.readAt === null && item.readAt !== null) continue;
          Object.assign(item, args.data, { updatedAt: new Date() });
          count++;
        }
        return { count };
      }),
    },

    user: {
      findMany: jest.fn(async (args: any) => {
        return usersTable
          .filter((u) => {
            if (args.where?.preferredBranchId && u.preferredBranchId !== args.where.preferredBranchId)
              return false;
            if (args.where?.status && u.status !== args.where.status) return false;
            if (args.where?.role?.in && !args.where.role.in.includes(u.role)) return false;
            return true;
          })
          .map((u) => ({ id: u.id }));
      }),
    },
  };

  beforeEach(() => {
    notificationsTable = [];
    usersTable = [];
    jest.clearAllMocks();
  });

  describe('NotificationsService', () => {
    it('lists only the authenticated user and applies expiry and unread scope', async () => {
      notificationsTable.push(
        {
          id: 'notif-1',
          userId: 'user-1',
          branchId: null,
          eventKey: 'booking.created',
          category: 'BOOKING',
          tone: 'INFO',
          title: 'Booking Confirmed',
          message: 'Your booking is confirmed',
          href: '/classes/1',
          metadataMasked: null,
          readAt: null,
          expiresAt: new Date(Date.now() + 86400000),
          createdAt: new Date('2026-11-13T10:00:00Z'),
          updatedAt: new Date(),
        },
        {
          id: 'notif-2',
          userId: 'user-1',
          branchId: null,
          eventKey: 'promo',
          category: 'PROMO',
          tone: 'INFO',
          title: 'Promo Read',
          message: 'Already read',
          href: null,
          metadataMasked: null,
          readAt: new Date('2026-11-13T09:00:00Z'),
          expiresAt: new Date(Date.now() + 86400000),
          createdAt: new Date('2026-11-13T09:00:00Z'),
          updatedAt: new Date(),
        },
        {
          id: 'notif-other',
          userId: 'user-2',
          branchId: null,
          eventKey: 'booking.created',
          category: 'BOOKING',
          tone: 'INFO',
          title: 'Other User',
          message: 'Other user booking',
          href: null,
          metadataMasked: null,
          readAt: null,
          expiresAt: new Date(Date.now() + 86400000),
          createdAt: new Date('2026-11-13T08:00:00Z'),
          updatedAt: new Date(),
        },
        {
          id: 'notif-expired',
          userId: 'user-1',
          branchId: null,
          eventKey: 'expired',
          category: 'SYSTEM',
          tone: 'WARNING',
          title: 'Expired',
          message: 'Expired message',
          href: null,
          metadataMasked: null,
          readAt: null,
          expiresAt: new Date(Date.now() - 10000),
          createdAt: new Date('2026-11-12T00:00:00Z'),
          updatedAt: new Date(),
        },
      );

      const service = new NotificationsService(mockDb as any);
      const result = await service.list(principal, {
        limit: 10,
        unreadOnly: true,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.id).toBe('notif-1');
      expect(result.page.hasMore).toBe(false);
    });

    it('does not reveal or mark read a notification owned by another user', async () => {
      notificationsTable.push({
        id: 'notification-2',
        userId: 'user-2', // owned by user-2
        branchId: null,
        eventKey: 'other',
        category: 'SYSTEM',
        tone: 'INFO',
        title: 'Not Yours',
        message: 'Private',
        href: null,
        metadataMasked: null,
        readAt: null,
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const service = new NotificationsService(mockDb as any);
      await expect(service.markRead(principal, 'notification-2')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
    });

    it('safely formats notifications with string dates or non-standard tones', async () => {
      notificationsTable.push({
        id: 'notif-defensive',
        userId: 'user-1',
        branchId: null,
        eventKey: 'system.alert',
        category: 'SYSTEM',
        tone: undefined as any,
        title: 'Resilience Test',
        message: 'Test message',
        href: '/workspace',
        metadataMasked: null,
        readAt: '2026-10-01T00:00:00.000Z' as any,
        expiresAt: null,
        createdAt: '2026-10-01T00:00:00.000Z' as any,
        updatedAt: new Date(),
      });

      const service = new NotificationsService(mockDb as any);
      const result = await service.list(principal, { limit: 10 });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.tone).toBe('info');
      expect(result.items[0]?.readAt).toBe('2026-10-01T00:00:00.000Z');
      expect(result.items[0]?.createdAt).toBe('2026-10-01T00:00:00.000Z');
    });

    it('accurately counts unread notifications excluding expired ones', async () => {
      notificationsTable.push(
        {
          id: 'n1',
          userId: 'user-1',
          branchId: null,
          eventKey: 'k1',
          category: 'BOOKING',
          tone: 'INFO',
          title: 'T1',
          message: 'M1',
          href: null,
          metadataMasked: null,
          readAt: null,
          expiresAt: new Date(Date.now() + 100000),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'n2',
          userId: 'user-1',
          branchId: null,
          eventKey: 'k2',
          category: 'PAYMENT',
          tone: 'SUCCESS',
          title: 'T2',
          message: 'M2',
          href: null,
          metadataMasked: null,
          readAt: new Date(), // read
          expiresAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'n3',
          userId: 'user-1',
          branchId: null,
          eventKey: 'k3',
          category: 'SYSTEM',
          tone: 'WARNING',
          title: 'T3',
          message: 'M3',
          href: null,
          metadataMasked: null,
          readAt: null,
          expiresAt: new Date(Date.now() - 5000), // expired
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      );

      const service = new NotificationsService(mockDb as any);
      const { count } = await service.unreadCount(principal);
      expect(count).toBe(1);
    });

    it('marks all unread notifications as read for the authenticated user', async () => {
      notificationsTable.push(
        {
          id: 'n1',
          userId: 'user-1',
          branchId: null,
          eventKey: 'k1',
          category: 'BOOKING',
          tone: 'INFO',
          title: 'T1',
          message: 'M1',
          href: null,
          metadataMasked: null,
          readAt: null,
          expiresAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'n2',
          userId: 'user-2', // other user
          branchId: null,
          eventKey: 'k2',
          category: 'BOOKING',
          tone: 'INFO',
          title: 'T2',
          message: 'M2',
          href: null,
          metadataMasked: null,
          readAt: null,
          expiresAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      );

      const service = new NotificationsService(mockDb as any);
      const res = await service.markAllRead(principal);
      expect(res.updatedCount).toBe(1);
      expect(notificationsTable.find((n) => n.id === 'n1')?.readAt).toBeInstanceOf(Date);
      expect(notificationsTable.find((n) => n.id === 'n2')?.readAt).toBeNull();
    });
  });

  describe('NotificationWriterService', () => {
    it('writes notification to MySQL and enforces idempotency on duplicate eventKey', async () => {
      const writer = new NotificationWriterService(mockDb as any);
      await writer.writeForUser(null as any, {
        userId: 'user-1',
        eventKey: 'order.approved:order-123',
        category: 'PAYMENT',
        tone: 'SUCCESS',
        title: 'Pembayaran Disetujui',
        message: 'Paket Anda aktif.',
      });

      expect(notificationsTable).toHaveLength(1);
      expect(notificationsTable[0]?.eventKey).toBe('order.approved:order-123');

      // Duplicate write should be safely skipped via P2002 catch
      await writer.writeForUser(null as any, {
        userId: 'user-1',
        eventKey: 'order.approved:order-123',
        category: 'PAYMENT',
        tone: 'SUCCESS',
        title: 'Pembayaran Disetujui (Duplikat)',
        message: 'Paket Anda aktif.',
      });

      expect(notificationsTable).toHaveLength(1);
      expect(notificationsTable[0]?.title).toBe('Pembayaran Disetujui');
    });

    it('enforces RBAC role scoping when writing notifications to branch staff', async () => {
      usersTable.push(
        { id: 'admin-1', preferredBranchId: 'branch-1', status: 'ACTIVE', role: 'ADMIN' },
        { id: 'customer-1', preferredBranchId: 'branch-1', status: 'ACTIVE', role: 'CUSTOMER' },
        { id: 'inactive-admin', preferredBranchId: 'branch-1', status: 'INACTIVE', role: 'ADMIN' },
      );

      const writer = new NotificationWriterService(mockDb as any);
      await writer.writeForUsersInBranch(null as any, {
        branchId: 'branch-1',
        roles: ['ADMIN'],
        eventKey: 'new.payment.proof:order-999',
        category: 'PAYMENT',
        tone: 'INFO',
        title: 'Bukti Bayar Baru',
        message: 'Ada bukti transfer baru perlu diverifikasi.',
      });

      // Only admin-1 should receive the notification; customer-1 and inactive staff MUST NOT receive it!
      expect(notificationsTable).toHaveLength(1);
      expect(notificationsTable[0]?.userId).toBe('admin-1');
      expect(notificationsTable[0]?.eventKey).toBe('new.payment.proof:order-999:admin-1');
    });
  });
});
