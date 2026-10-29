import { requireReason } from '../foundation/reason';
import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma, type Role, type UserStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { IdempotencyService } from '../foundation/idempotency.service';
import type { SessionPrincipal } from './identity.service';
import { PolicyService } from './policy.service';
import { RateLimitService } from './rate-limit.service';
import { ApiProblem, newId } from './security';
import { hashPassword } from './credential-security';
import type { ApplicationRole } from './role-capabilities';
import { buildPhoneSearchVariants } from './manajemen-pelanggan.service';
import { canonicalRole } from './role-aliases';

/** Halaman staf yang memakai pemilih user: penugasan, master, hak akses, audit. */
/** Peran staf cabang yang boleh dilihat peran tanpa `user:admin` (tanpa Super Owner dan pelanggan). */
export const BRANCH_STAFF_ROLES: Role[] = ['OWNER', 'MANAGER', 'FINANCE', 'ADMIN', 'INSTRUCTOR'];

const USER_LOOKUP_CAPABILITIES = [
  'assignment:manage',
  'master:manage',
  'user:admin',
  'audit:read',
  'role-permission:manage',
] as const;
const INSTRUCTOR_LOOKUP_CAPABILITIES = [
  'class-slot:manage',
  'assignment:manage',
  'master:manage',
] as const;

function normalizePhone(value: string): string {
  const compact = value.replace(/[\s().-]/g, '');
  const normalized = compact.startsWith('0') ? `+62${compact.slice(1)}` : compact;
  if (!/^\+[1-9]\d{7,14}$/u.test(normalized))
    throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY);
  return normalized;
}

function toDbRole(roleName?: string): Role {
  if (!roleName) return 'ADMIN';
  const canonical = canonicalRole(roleName);
  if (canonical === 'INSTRUCTOR') return 'INSTRUCTOR';
  if (canonical === 'SUPER_OWNER') return 'SUPER_OWNER';
  if (roleName === 'MANAGER') return 'MANAGER';
  if (roleName === 'FINANCE') return 'FINANCE';
  if (roleName === 'OWNER') return 'OWNER';
  if (canonical === 'CUSTOMER') return 'CUSTOMER';
  return 'ADMIN';
}

@Injectable()
export class UserAdministrationService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly rateLimit: RateLimitService,
    @Optional() private readonly idempotency?: IdempotencyService,
  ) {}

  private readonly logger = new Logger(UserAdministrationService.name);

  /**
   * Mencatat perubahan akun ke `audit_log`. `detail` hanya berisi nama kolom/peran, tidak pernah
   * kata sandi. Kegagalan mencatat tidak menggagalkan perubahan yang sudah tersimpan, tetapi dilaporkan di log.
   */
  private async recordAudit(entry: {
    action: string;
    principal: SessionPrincipal;
    targetUserId: string | null;
    correlationId?: string | null;
    reason?: string | null;
    branchId?: string | null;
    detail?: Prisma.InputJsonValue;
  }) {
    try {
      await this.db.auditLog.create({
        data: {
          id: newId(),
          action: entry.action,
          actorId: entry.principal.userId,
          targetUserId: entry.targetUserId,
          branchId: entry.branchId ?? null,
          correlationId: entry.correlationId?.slice(0, 64) ?? null,
          reason: entry.reason?.trim() || null,
          detail: entry.detail,
        },
      });
    } catch (error) {
      this.logger.error(`Audit gagal dicatat (${entry.action}): ${(error as Error).message}`);
    }
  }

  private userView(user: any) {
    const role: ApplicationRole = user.role as ApplicationRole;
    const branch = user.preferredBranchId ? { id: user.preferredBranchId, code: 'BRANCH', name: 'Branch' } : null;
    const roles = [
      {
        role,
        branchId: user.preferredBranchId ?? null,
        branch,
        source: 'DIRECT' as const,
      },
    ];
    const audience = role === 'CUSTOMER' ? 'CUSTOMER' : 'STAFF';

    return {
      id: user.id,
      email: user.email ?? null,
      username: user.username ?? null,
      displayName: user.displayName,
      phoneE164: user.phoneE164 ?? user.phone ?? null,
      phone: user.phone ?? user.phoneE164 ?? null,
      status: user.status,
      version: user.version ?? 1,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      roles,
      directRoles: roles,
      assignmentRoles: [],
      effectiveCapabilities: this.policy.capabilities(roles),
      audience,
      profile: user.profile ?? null,
    };
  }

  async listUsers(
    principal: SessionPrincipal,
    filters: {
      branchId?: string;
      cursor?: string;
      search?: string;
      status?: string;
      role?: string;
      audience?: 'STAFF' | 'CUSTOMER';
      verificationStatus?: string;
      includeHistorical?: boolean;
    },
  ) {
    this.policy.requireCapability(principal.capabilities, 'user:read');

    const hasGlobalBranch = principal.capabilities.includes('branch:all');
    let preferredBranchCondition: string | { in: string[] } | undefined = filters.branchId;

    if (!hasGlobalBranch) {
      const allowedBranches = principal.branchIds ?? [];
      if (filters.branchId) {
        if (!allowedBranches.includes(filters.branchId)) {
          throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
        }
        preferredBranchCondition = filters.branchId;
      } else {
        preferredBranchCondition = { in: allowedBranches };
      }
    }

    // Tanpa `user:admin`, daftar ini hanya berisi staf cabang: tanpa akun Super Owner dan tanpa pelanggan
    // (pelanggan dikelola lewat Data Pelanggan dengan izin tersendiri).
    const roleLimit: Prisma.UserWhereInput | undefined = principal.capabilities.includes('user:admin')
      ? undefined
      : { role: { in: BRANCH_STAFF_ROLES } };

    const q = filters.search?.trim();
    const phoneVariants = q ? buildPhoneSearchVariants(q) : [];

    const where: Prisma.UserWhereInput = {
      ...(roleLimit ? { AND: [roleLimit] } : {}),
      ...(preferredBranchCondition ? { preferredBranchId: preferredBranchCondition } : {}),
      ...(filters.status ? { status: filters.status as UserStatus } : {}),
      ...(filters.role ? { role: filters.role as Role } : {}),
      ...(filters.audience === 'CUSTOMER'
        ? { role: 'CUSTOMER' }
        : filters.audience === 'STAFF'
          ? {
              role: {
                in: [
                  'SUPER_OWNER',
                  'OWNER',
                  'MANAGER',
                  'FINANCE',
                  'ADMIN',
                  'INSTRUCTOR',
                ],
              },
            }
          : {}),
      ...(q
        ? {
            OR: [
              { displayName: { contains: q } },
              { email: { contains: q } },
              ...phoneVariants.map((v) => ({ phone: { contains: v } })),
            ],
          }
        : {}),
      ...(filters.cursor ? { id: { gt: filters.cursor } } : {}),
    };

    const [users, statusCounts] = await Promise.all([
      this.db.user.findMany({
        where,
        include: { profile: true },
        orderBy: { id: 'asc' },
        take: 21,
      }),
      this.db.user.groupBy({
        by: ['status'],
        where: {
          role: filters.role
            ? (filters.role as any)
            : { not: 'CUSTOMER' },
          ...(roleLimit
            ? {
                AND: [roleLimit],
                ...(preferredBranchCondition ? { preferredBranchId: preferredBranchCondition } : {}),
              }
            : {}),
        },
        _count: { _all: true },
      }),
    ]);

    const hasMore = users.length > 20;
    const page = users.slice(0, 20);

    const countsMap = new Map(statusCounts.map((sc) => [sc.status, sc._count._all]));
    const activeCount = countsMap.get('ACTIVE') ?? 0;
    const inactiveCount = (countsMap.get('INACTIVE') ?? 0) + (countsMap.get('SUSPENDED') ?? 0);
    const pendingCount = 0;
    const totalCount = Array.from(countsMap.values()).reduce((a, b) => a + b, 0);

    return {
      items: page.map((u) => this.userView(u)),
      summary: { total: totalCount, active: activeCount, pendingActivation: pendingCount, inactive: inactiveCount },
      page: { nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null, hasMore },
    };
  }

  async lookupUsers(
    principal: SessionPrincipal,
    filters: {
      q?: string;
      branchId?: string;
      cursor?: string;
      limit?: number;
      instructorsOnly?: boolean;
    },
  ) {
    // Pemilih user hanya untuk halaman staf yang benar-benar membutuhkannya (penugasan, master,
    // hak akses, audit); pelanggan dan role tanpa halaman tersebut tidak boleh menyisir direktori.
    this.policy.requireAnyCapability(
      principal.capabilities,
      filters.instructorsOnly ? INSTRUCTOR_LOOKUP_CAPABILITIES : USER_LOOKUP_CAPABILITIES,
    );
    const limit = Math.min(50, Math.max(1, filters.limit ?? 20));

    const andClauses: Prisma.UserWhereInput[] = [];

    if (filters.instructorsOnly) {
      andClauses.push({ role: 'INSTRUCTOR' });
    }

    if (filters.branchId) {
      andClauses.push({
        OR: [
          { preferredBranchId: filters.branchId },
          { role: { in: ['INSTRUCTOR', 'SUPER_OWNER', 'ADMIN', 'OWNER'] } },
        ],
      });
    }

    if (filters.q?.trim()) {
      const q = filters.q.trim();
      const phoneVariants = buildPhoneSearchVariants(q);
      andClauses.push({
        OR: [
          { displayName: { contains: q } },
          { email: { contains: q } },
          ...phoneVariants.map((v) => ({ phone: { contains: v } })),
        ],
      });
    }

    if (filters.cursor) {
      andClauses.push({ id: { gt: filters.cursor } });
    }

    const where: Prisma.UserWhereInput = {
      status: 'ACTIVE',
      ...(andClauses.length > 0 ? { AND: andClauses } : {}),
    };

    const users = await this.db.user.findMany({
      where,
      orderBy: { id: 'asc' },
      take: limit + 1,
    });

    const hasMore = users.length > limit;
    const page = users.slice(0, limit);

    return {
      items: page.map((user) => ({
        id: user.id,
        label: user.displayName,
        description: user.role,
        metadata: {
          roles: [user.role],
          branchIds: user.preferredBranchId ? [user.preferredBranchId] : [],
        },
      })),
      page: { nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null, hasMore },
    };
  }

  async lookupCustomers(
    principal: SessionPrincipal,
    filters: {
      q?: string;
      branchId?: string;
      cursor?: string;
      limit?: number;
      /** Ikutkan member tanpa paket aktif (roster menampilkan alasannya, bukan "tidak ditemukan"). */
      includeWithoutPackage?: boolean;
    },
  ) {
    this.policy.requireCapability(principal.capabilities, 'booking:create:assisted');
    const limit = Math.min(50, Math.max(1, filters.limit ?? 20));

    const q = filters.q?.trim();
    const phoneVariants = q ? buildPhoneSearchVariants(q) : [];

    const where: Prisma.UserWhereInput = {
      role: 'CUSTOMER',
      status: 'ACTIVE',
      ...(q
        ? {
            OR: [
              { displayName: { contains: q } },
              { email: { contains: q } },
              ...phoneVariants.map((v) => ({ phone: { contains: v } })),
            ],
          }
        : {}),
      ...(filters.cursor ? { id: { gt: filters.cursor } } : {}),
      ...(filters.includeWithoutPackage
        ? {}
        : {
            customerPackages: {
              some: {
                status: 'ACTIVE',
                remainingSessions: { gt: 0 },
                validUntil: { gt: new Date() },
              },
            },
          }),
    };
    // Pencarian nama: ambil lebih banyak lalu urutkan dari yang paling mirip, supaya nama yang dicari
    // tidak tersisih oleh nama lain yang kebetulan id-nya lebih kecil.
    const relevan = Boolean(q) && !filters.cursor;

    const users = await this.db.user.findMany({
      where,
      include: {
        customerPackages: {
          where: {
            status: 'ACTIVE',
            remainingSessions: { gt: 0 },
            validUntil: { gt: new Date() },
          },
        },
      },
      orderBy: { id: 'asc' },
      take: relevan ? 200 : limit + 1,
    });
    if (relevan) {
      const kata = q!.toLowerCase();
      const skor = (nama: string) => {
        const n = nama.toLowerCase();
        if (n === kata) return 0;
        if (n.startsWith(kata)) return 1;
        if (n.split(/\s+/u).some((bagian) => bagian.startsWith(kata))) return 2;
        if (n.includes(kata)) return 3;
        return 4;
      };
      users.sort(
        (a, b) =>
          skor(a.displayName) - skor(b.displayName) || a.displayName.localeCompare(b.displayName),
      );
    }

    const hasMore = relevan ? false : users.length > limit;
    const page = users.slice(0, limit);

    return {
      items: page.map((user) => ({
        id: user.id,
        label: user.displayName,
        description: user.phone || 'Nomor belum tersedia',
        metadata: {
          verificationStatus: 'APPROVED' as const,
          eligiblePackageCount: user.customerPackages.length,
          branchId: filters.branchId,
        },
      })),
      page: { nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null, hasMore },
    };
  }

  async getUser(principal: SessionPrincipal, targetId: string) {
    this.policy.requireCapability(principal.capabilities, 'user:read');
    const user = await this.db.user.findUnique({
      where: { id: targetId },
      include: { profile: true },
    });
    if (!user) throw new ApiProblem('NOT_FOUND', HttpStatus.NOT_FOUND);
    // Sama dengan daftar pengguna: tanpa `user:admin`, hanya staf cabang yang bisa dibuka (bukan Super Owner atau pelanggan).
    if (!principal.capabilities.includes('user:admin') && !BRANCH_STAFF_ROLES.includes(user.role))
      throw new ApiProblem('NOT_FOUND', HttpStatus.NOT_FOUND);

    const hasGlobalBranch = principal.capabilities.includes('branch:all');
    if (
      !hasGlobalBranch &&
      user.preferredBranchId &&
      !principal.branchIds?.includes(user.preferredBranchId)
    ) {
      throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
    }

    return this.userView(user);
  }

  async updateUserProfile(
    principal: SessionPrincipal,
    targetId: string,
    input: {
      displayName: string;
      email?: string | null;
      username?: string | null;
      phoneE164?: string | null;
      expectedVersion?: number;
      reason?: string;
    },
    _correlationId: string,
  ) {
    this.policy.requireCapability(principal.capabilities, 'user:admin');
    const displayName = input.displayName?.trim();
    if (!displayName || displayName.length < 2)
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY);

    let cleanEmail: string | null | undefined;
    if (input.email !== undefined) {
      const trimmed = input.email?.trim().toLowerCase();
      if (trimmed) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(trimmed)) {
          throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY);
        }
        const existingWithEmail = await this.db.user.findFirst({
          where: {
            email: trimmed,
            NOT: { id: targetId },
          },
          select: { id: true },
        });
        if (existingWithEmail) {
          throw new ApiProblem('IDENTITY_CONFLICT', HttpStatus.CONFLICT);
        }
        cleanEmail = trimmed;
      } else {
        cleanEmail = null;
      }
    }

    let cleanUsername: string | undefined;
    if (input.username !== undefined) {
      const trimmed = input.username?.trim().toLowerCase();
      if (!trimmed || !/^[a-z0-9_.-]{3,30}$/.test(trimmed)) {
        throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY);
      }
      const existingWithUsername = await this.db.user.findFirst({
        where: {
          username: trimmed,
          NOT: { id: targetId },
        },
        select: { id: true },
      });
      if (existingWithUsername) {
        throw new ApiProblem('IDENTITY_CONFLICT', HttpStatus.CONFLICT);
      }
      cleanUsername = trimmed;
    }

    const phone = input.phoneE164?.trim() ? normalizePhone(input.phoneE164) : undefined;

    const existing = await this.db.user.findUnique({ where: { id: targetId } });
    if (!existing) throw new ApiProblem('NOT_FOUND', HttpStatus.NOT_FOUND);

    const updated = await this.db.user.update({
      where: { id: targetId },
      data: {
        displayName,
        ...(cleanEmail !== undefined ? { email: cleanEmail } : {}),
        ...(cleanUsername !== undefined ? { username: cleanUsername } : {}),
        ...(phone !== undefined ? { phone } : {}),
      },
      include: { profile: true },
    });

    await this.recordAudit({
      action: 'security.user_profile_updated',
      principal,
      targetUserId: targetId,
      correlationId: _correlationId,
      reason: input.reason,
      detail: {
        fields: [
          'displayName',
          ...(cleanEmail !== undefined ? ['email'] : []),
          ...(cleanUsername !== undefined ? ['username'] : []),
          ...(phone !== undefined ? ['phone'] : []),
        ],
      },
    });

    return this.userView(updated ?? existing);
  }

  async inviteUser(
    principal: SessionPrincipal,
    input: {
      email: string;
      displayName?: string;
      phone?: string;
      phoneE164?: string;
      password?: string;
      roles?: ApplicationRole[];
      branchIds?: string[];
      roleAssignments?: { role: ApplicationRole; branchId?: string | null }[];
    },
    _correlationId: string,
  ) {
    this.policy.requireCapability(principal.capabilities, 'user:admin');
    const email = input.email?.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email))
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY);

    const existing = await this.db.user.findUnique({ where: { email } });
    if (existing) throw new ApiProblem('IDENTITY_CONFLICT', HttpStatus.CONFLICT);

    const roleName = input.roles?.[0] || input.roleAssignments?.[0]?.role || 'ADMIN';
    const role: Role = toDbRole(roleName);
    const branchId = input.branchIds?.[0] || input.roleAssignments?.[0]?.branchId || null;

    let phone = input.phoneE164 || input.phone;
    if (phone) {
      try {
        phone = normalizePhone(phone);
      } catch {
        phone = phone.trim();
      }
      const existingPhone = await this.db.user.findFirst({
        where: { phone },
      });
      if (existingPhone) {
        throw new ApiProblem('PHONE_ALREADY_EXISTS', HttpStatus.CONFLICT, false, [
          { field: 'phone', issue: 'Nomor telepon/WhatsApp sudah terdaftar pada pengguna lain.' },
        ]);
      }
    }

    let passwordHash: string | null = null;
    if (input.password && input.password.trim()) {
      passwordHash = await hashPassword(input.password.trim());
    }

    const user = await this.db.user.create({
      data: {
        id: newId(),
        email,
        phone: phone || null,
        displayName: input.displayName?.trim() || email.split('@')[0] || 'User',
        passwordHash,
        role,
        preferredBranchId: branchId,
        status: 'ACTIVE',
      },
      include: { profile: true },
    });

    await this.recordAudit({
      action: 'security.user_created',
      principal,
      targetUserId: user.id,
      correlationId: _correlationId,
      branchId,
      detail: { role },
    });

    return { id: user.id, status: 'CREATED', user: this.userView(user) };
  }

  async resetPasswordDirect(
    principal: SessionPrincipal,
    targetId: string,
    newPassword: string,
    _correlationId: string,
  ) {
    // Super Owner (`user:admin`) boleh mengganti kata sandi akun mana pun. Admin dan Manager hanya
    // akun member (`customer:credential:initialize`), sesuai tombol "Reset kata sandi" di Daftar member.
    const adminPenuh = principal.capabilities.includes('user:admin');
    if (!adminPenuh)
      this.policy.requireCapability(principal.capabilities, 'customer:credential:initialize');
    if (!newPassword || newPassword.trim().length < 8) {
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    const user = await this.db.user.findUnique({ where: { id: targetId } });
    if (!user) throw new ApiProblem('NOT_FOUND', HttpStatus.NOT_FOUND);
    if (!adminPenuh && user.role !== 'CUSTOMER') throw new ApiProblem('NOT_FOUND', HttpStatus.NOT_FOUND);
    if (user.status !== 'ACTIVE') throw new ApiProblem('CUSTOMER_NOT_ACTIVE', HttpStatus.CONFLICT);

    const passwordHash = await hashPassword(newPassword.trim());

    await this.db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: targetId },
        data: { passwordHash },
      });
      await tx.userSession.updateMany({
        where: { userId: targetId, revokedAt: null },
        data: { revokedAt: new Date(), revocationReason: 'ADMIN_PASSWORD_RESET' },
      });
    });

    await this.recordAudit({
      action: 'security.user_password_reset',
      principal,
      targetUserId: targetId,
      correlationId: _correlationId,
    });

    return { id: targetId, status: 'PASSWORD_RESET_SUCCESS' };
  }

  async updateUserRoles(
    principal: SessionPrincipal,
    targetId: string,
    input: {
      roles: { role: ApplicationRole; branchId?: string | null }[];
      expectedVersion?: number;
      reason?: string;
    },
    _correlationId: string,
    _idempotencyKey?: string,
  ) {
    this.policy.requireCapability(principal.capabilities, 'user:admin');
    // Mengubah peran wajib beralasan (K4).
    const reason = requireReason(input.reason);
    const roleName = input.roles[0]?.role || 'ADMIN';
    const role: Role = toDbRole(roleName);
    const branchId = input.roles[0]?.branchId || null;

    const updated = await this.db.user.update({
      where: { id: targetId },
      data: {
        role,
        preferredBranchId: branchId,
      },
      include: { profile: true },
    });

    if (role === 'INSTRUCTOR' && branchId && this.db.penugasanInstruktur?.upsert) {
      await this.db.penugasanInstruktur.upsert({
        where: {
          coachId_branchId: { coachId: targetId, branchId },
        },
        create: {
          id: newId(),
          coachId: targetId,
          branchId,
          active: true,
        },
        update: { active: true },
      });
    } else if (role !== 'INSTRUCTOR' && this.db.penugasanInstruktur?.updateMany) {
      await this.db.penugasanInstruktur.updateMany({
        where: { coachId: targetId },
        data: { active: false },
      });
    }

    await this.recordAudit({
      action: 'security.user_roles_updated',
      principal,
      targetUserId: targetId,
      correlationId: _correlationId,
      reason,
      branchId,
      detail: { from: undefined, role },
    });

    return this.userView(updated);
  }

  async deactivate(
    principal: SessionPrincipal,
    targetId: string,
    reason?: string,
    _expectedVersion?: number,
    correlationId?: string,
  ) {
    this.policy.requireCapability(principal.capabilities, 'user:admin');
    if (targetId === principal.userId)
      throw new ApiProblem('SEPARATION_OF_DUTIES_VIOLATION', HttpStatus.CONFLICT);
    // Menonaktifkan akun wajib beralasan (K4); mengaktifkan kembali tidak.
    const trimmed = typeof reason === 'string' ? reason.trim() : '';
    if (trimmed.length < 3 || trimmed.length > 500)
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'reason', issue: trimmed.length === 0 ? 'REQUIRED' : trimmed.length < 3 ? 'TOO_SHORT' : 'TOO_LONG' },
      ]);

    const user = await this.db.user.update({
      where: { id: targetId },
      data: { status: 'INACTIVE' },
    });

    await this.recordAudit({
      action: 'security.user_deactivated',
      principal,
      targetUserId: targetId,
      correlationId,
      reason: trimmed,
    });

    return { id: user.id, status: user.status };
  }

  async reactivate(
    principal: SessionPrincipal,
    targetId: string,
    reason?: string,
    _expectedVersion?: number,
    correlationId?: string,
  ) {
    this.policy.requireCapability(principal.capabilities, 'user:admin');

    const user = await this.db.user.update({
      where: { id: targetId },
      data: { status: 'ACTIVE' },
    });

    await this.recordAudit({
      action: 'security.user_reactivated',
      principal,
      targetUserId: targetId,
      correlationId,
      reason,
    });

    return { id: user.id, status: user.status, version: 1 };
  }

  async listUserAudit(
    principal: SessionPrincipal,
    targetId: string,
    cursor?: string | { cursor?: string; limit?: number },
    _includeHistorical?: boolean,
  ) {
    const options = typeof cursor === 'object' && cursor !== null ? cursor : { cursor };
    return this.listAuditLogs(principal, {
      targetUserId: targetId,
      cursor: options.cursor,
      limit: options.limit,
    });
  }

  async listAuditLogs(
    principal: SessionPrincipal,
    filters: {
      actorId?: string;
      targetUserId?: string;
      action?: string;
      branchId?: string;
      correlationId?: string;
      objectType?: string;
      objectId?: string;
      from?: string;
      until?: string;
      cursor?: string;
      includeHistorical?: boolean;
      limit?: number;
    } = {},
  ) {
    this.policy.requireCapability(principal.capabilities, 'audit:read');
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100);
    const createdAt: Prisma.DateTimeFilter = {};
    if (filters.from) createdAt.gte = new Date(filters.from);
    if (filters.until) createdAt.lte = new Date(filters.until);
    // Peran bercakupan cabang hanya melihat jejak cabangnya; jejak tanpa cabang (global) khusus lintas cabang.
    const branchScope: Prisma.AuditLogWhereInput = principal.capabilities.includes('branch:all')
      ? {}
      : { branchId: { in: principal.branchIds } };
    const where: Prisma.AuditLogWhereInput = {
      AND: [branchScope],
      ...(filters.objectType ? { objectType: filters.objectType } : {}),
      ...(filters.objectId ? { objectId: filters.objectId } : {}),
      ...(filters.actorId ? { actorId: filters.actorId } : {}),
      ...(filters.targetUserId ? { targetUserId: filters.targetUserId } : {}),
      ...(filters.action ? { action: { contains: filters.action } } : {}),
      ...(filters.branchId ? { branchId: filters.branchId } : {}),
      ...(filters.correlationId ? { correlationId: filters.correlationId } : {}),
      ...(Object.keys(createdAt).length ? { createdAt } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
      }),
      this.db.auditLog.count({ where }),
    ]);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const userIds = [
      ...new Set(page.flatMap((row) => [row.actorId, row.targetUserId]).filter(Boolean) as string[]),
    ];
    const users = userIds.length
      ? await this.db.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, displayName: true },
        })
      : [];
    const names = new Map(users.map((user) => [user.id, user.displayName]));
    const person = (id: string | null) =>
      id ? { id, displayName: names.get(id) ?? 'Pengguna dihapus' } : null;
    return {
      items: page.map((row) => ({
        id: row.id,
        occurredAt: row.createdAt.toISOString(),
        action: row.action,
        actorId: row.actorId,
        targetUserId: row.targetUserId,
        branchId: row.branchId,
        correlationId: row.correlationId ?? '',
        objectType: row.objectType ?? 'USER',
        objectId: row.objectId ?? row.targetUserId ?? undefined,
        reason: row.reason,
        afterMasked: row.detail ?? undefined,
        actor: person(row.actorId),
        target: person(row.targetUserId),
      })),
      summary: { total },
      page: { hasMore, nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null },
    };
  }
}
