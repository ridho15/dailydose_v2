import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type { SessionPrincipal } from '../identity/identity.service';
import { ApiProblem } from '../identity/security';
import type { NotificationItem } from './notification-writer.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly db: PrismaService) {}

  private safeHref(value: string | null) {
    if (!value || !value.startsWith('/') || value.startsWith('//')) return null;
    try {
      const url = new URL(value, 'https://dailydose.invalid');
      if (url.origin !== 'https://dailydose.invalid') return null;
      return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return null;
    }
  }

  private toIsoString(val: unknown): string {
    if (val instanceof Date) return val.toISOString();
    if (typeof val === 'string' && val) {
      const d = new Date(val);
      return Number.isNaN(d.getTime()) ? val : d.toISOString();
    }
    return new Date().toISOString();
  }

  private toNullableIsoString(val: unknown): string | null {
    if (!val) return null;
    if (val instanceof Date) return val.toISOString();
    if (typeof val === 'string') {
      const d = new Date(val);
      return Number.isNaN(d.getTime()) ? val : d.toISOString();
    }
    return null;
  }

  private view(item: NotificationItem | {
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
  }) {
    return {
      id: item.id,
      userId: item.userId,
      eventKey: item.eventKey,
      category: item.category,
      tone: (typeof item.tone === 'string' && item.tone ? item.tone : 'INFO').toLowerCase(),
      title: item.title,
      message: item.message,
      href: this.safeHref(item.href),
      branchId: item.branchId,
      metadataMasked: item.metadataMasked ?? null,
      readAt: this.toNullableIsoString(item.readAt),
      expiresAt: this.toNullableIsoString(item.expiresAt),
      createdAt: this.toIsoString(item.createdAt),
    };
  }

  async list(
    principal: SessionPrincipal,
    input: { cursor?: string; limit?: number; unreadOnly?: boolean },
  ) {
    const limit = input.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY);

    const now = new Date();
    const where: Prisma.NotificationWhereInput = {
      userId: principal.userId,
      ...(input.unreadOnly ? { readAt: null } : {}),
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    };

    if (input.cursor) {
      const cursorRecord = await this.db.notification.findFirst({
        where: { id: input.cursor, userId: principal.userId },
        select: { id: true },
      });
      if (!cursorRecord) {
        throw new ApiProblem('NOT_FOUND', HttpStatus.NOT_FOUND);
      }
    }

    const records = await this.db.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(input.cursor
        ? {
            cursor: { id: input.cursor },
            skip: 1,
          }
        : {}),
    });

    const hasMore = records.length > limit;
    const items = hasMore ? records.slice(0, limit) : records;

    return {
      items: items.map((item) => this.view(item)),
      page: { hasMore, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null },
    };
  }

  async unreadCount(principal: SessionPrincipal) {
    const now = new Date();
    const count = await this.db.notification.count({
      where: {
        userId: principal.userId,
        readAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    });

    return { count };
  }

  async markRead(principal: SessionPrincipal, id: string) {
    const existing = await this.db.notification.findFirst({
      where: { id, userId: principal.userId },
    });
    if (!existing) throw new ApiProblem('NOT_FOUND', HttpStatus.NOT_FOUND);

    const now = new Date();
    const updated = await this.db.notification.update({
      where: { id },
      data: { readAt: now },
    });

    return this.view(updated);
  }

  async markAllRead(principal: SessionPrincipal) {
    const readAt = new Date();
    const result = await this.db.notification.updateMany({
      where: {
        userId: principal.userId,
        readAt: null,
      },
      data: { readAt },
    });

    return { updatedCount: result.count, readAt: readAt.toISOString() };
  }
}
