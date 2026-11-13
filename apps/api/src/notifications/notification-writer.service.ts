import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { randomUUID } from 'crypto';

type Tx = Prisma.TransactionClient | PrismaService;

export type NotificationCategory = 'PAYMENT' | 'BOOKING' | 'SCHEDULE' | 'SYSTEM' | 'PROMO' | string;
export type NotificationTone = 'INFO' | 'SUCCESS' | 'WARNING' | 'DANGER' | string;
export type ApplicationRole = 'SUPER_OWNER' | 'ADMIN' | 'INSTRUCTOR' | 'CUSTOMER' | string;

export interface NotificationItem {
  id: string;
  userId: string;
  eventKey: string;
  category: string;
  tone: string;
  title: string;
  message: string;
  href: string | null;
  branchId: string | null;
  metadataMasked?: unknown;
  readAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface WriteNotificationInput {
  userId: string;
  eventKey: string;
  category: NotificationCategory;
  tone: NotificationTone;
  title: string;
  message: string;
  href?: string;
  branchId?: string;
  metadataMasked?: unknown;
  expiresInDays?: number;
}

export interface WriteForBranchInput {
  branchId: string;
  roles: ApplicationRole[];
  eventKey: string;
  category: NotificationCategory;
  tone: NotificationTone;
  title: string;
  message: string;
  href?: string;
  expiresInDays?: number;
}

@Injectable()
export class NotificationWriterService {
  constructor(private readonly db: PrismaService) {}

  /**
   * Menulis notifikasi in-app untuk satu user secara persisten di MySQL.
   * Bersifat idempoten via @@unique([userId, eventKey]).
   */
  async writeForUser(tx: Tx, input: WriteNotificationInput): Promise<void> {
    const client = tx ?? this.db;
    const expiresAt = input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * 86_400_000)
      : null;

    try {
      await client.notification.create({
        data: {
          id: randomUUID(),
          userId: input.userId,
          eventKey: input.eventKey,
          category: input.category,
          tone: input.tone,
          title: input.title,
          message: input.message,
          href: input.href ?? null,
          branchId: input.branchId ?? null,
          metadataMasked:
            input.metadataMasked !== undefined
              ? (input.metadataMasked as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          readAt: null,
          expiresAt,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Event sudah pernah dicatat untuk pengguna ini, lewati tanpa galat
        return;
      }
      throw error;
    }
  }

  /**
   * Menulis notifikasi in-app ke staf cabang tertentu secara persisten di MySQL.
   * Memfilter peran secara ketat sesuai input.roles agar akun pelanggan tidak terpapar.
   */
  async writeForUsersInBranch(tx: Tx, input: WriteForBranchInput): Promise<void> {
    const client = tx ?? this.db;
    const expiresAt = input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * 86_400_000)
      : null;

    const users = await client.user.findMany({
      where: {
        preferredBranchId: input.branchId,
        status: 'ACTIVE',
        ...(input.roles && input.roles.length > 0
          ? { role: { in: input.roles as any } }
          : {}),
      },
      select: { id: true },
    });

    for (const user of users) {
      const eventKey = `${input.eventKey}:${user.id}`;
      try {
        await client.notification.create({
          data: {
            id: randomUUID(),
            userId: user.id,
            eventKey,
            category: input.category,
            tone: input.tone,
            title: input.title,
            message: input.message,
            href: input.href ?? null,
            branchId: input.branchId,
            readAt: null,
            expiresAt,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          continue;
        }
        throw error;
      }
    }
  }
}
