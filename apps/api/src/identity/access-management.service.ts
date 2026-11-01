import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { Prisma, type Role } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { IdempotencyService } from '../foundation/idempotency.service';
import { AuditService } from '../foundation/audit.service';
import { mapUserToEffectiveRoles, type SessionPrincipal } from './identity.service';
import { PolicyService } from './policy.service';
import { ApiProblem, newId } from './security';
import { ROLE_CAPABILITIES, type ApplicationRole } from './role-capabilities';
import { canonicalRole } from './role-aliases';

/**
 * Peran & Hak Akses (versi jujur, hanya-baca).
 *
 * Izin setiap peran ditetapkan sistem di `role-capabilities.ts` dan `PolicyService.resolveAccess`
 * tidak membaca database. Karena itu membuat peran khusus, mengubah izin peran, dan pengecualian
 * izin per pengguna BELUM ADA dan mengembalikan 501 — bukan "sukses" yang tidak tersimpan.
 * Yang nyata: melihat katalog peran/izin, melihat akses efektif pengguna, dan mengganti peran
 * langsung pengguna (dengan validasi). RBAC dinamis dikerjakan sebagai tahap terpisah.
 */

/** Kosakata kanonik (nama lama SUPERADMIN/COACH/MEMBER diterjemahkan oleh `canonicalRole`). */
const CANONICAL_ROLES: readonly ApplicationRole[] = [
  'SUPER_OWNER',
  'OWNER',
  'MANAGER',
  'ADMIN',
  'FINANCE',
  'INSTRUCTOR',
  'CUSTOMER',
];
const ROLE_LABELS: Record<string, string> = {
  SUPER_OWNER: 'Super Admin',
  OWNER: 'Owner cabang',
  MANAGER: 'Manager cabang',
  ADMIN: 'Admin cabang',
  FINANCE: 'Finance',
  INSTRUCTOR: 'Instruktur',
  CUSTOMER: 'Pelanggan',
};
const SENSITIVE = /:(manage|admin|decide|recover|export|delete|resolve|run|reconcile|credential|revoke)/;
const GLOBAL_ONLY = new Set(['branch:all', 'role-permission:manage']);
const PROTECTED_ROLES: ReadonlySet<string> = new Set(['SUPER_OWNER']);
const EPOCH = new Date(0).toISOString();

const humanize = (key: string) =>
  key
    .split(/[:-]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

@Injectable()
export class AccessManagementService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly idempotency: IdempotencyService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private authorize(principal: SessionPrincipal) {
    this.policy.requireScopedCapability(principal, 'role-permission:manage');
  }

  private capabilityView(key: string) {
    return {
      key,
      label: humanize(key),
      description: key,
      category: key.split(':')[0] || 'GENERAL',
      sensitive: SENSITIVE.test(key),
      active: true,
      systemOnly: false,
      globalOnly: GLOBAL_ONLY.has(key),
    };
  }

  private roleView(role: ApplicationRole, affectedUsers = 0) {
    const scope = this.policy.roleCatalog().find((item) => item.role === role)?.scope ?? 'BRANCH';
    return {
      id: role,
      code: role,
      displayName: ROLE_LABELS[role] ?? role,
      description: `Peran bawaan sistem. Izin ditetapkan di kode dan hanya dapat dilihat di sini.`,
      scope,
      systemRole: role,
      system: true,
      protected: true,
      active: true,
      version: 1,
      affectedUsers,
      capabilities: [...new Set(ROLE_CAPABILITIES[role] ?? [])]
        .sort()
        .map((key) => {
          const { label, category, sensitive, systemOnly, globalOnly } = this.capabilityView(key);
          return { key, label, category, sensitive, systemOnly, globalOnly };
        }),
      createdAt: EPOCH,
      updatedAt: EPOCH,
    };
  }

  async listCapabilities(
    principal: SessionPrincipal,
    _query: { q?: string; category?: string; sensitive?: boolean; active?: boolean } = {},
  ) {
    this.authorize(principal);
    const keys = new Set<string>();
    for (const role of CANONICAL_ROLES) for (const cap of ROLE_CAPABILITIES[role] ?? []) keys.add(cap);
    const items = [...keys].sort().map((key) => this.capabilityView(key));
    return { items, summary: { total: items.length, active: items.length, inactive: 0 } };
  }

  async listRoles(
    principal: SessionPrincipal,
    _query: { q?: string; scope?: 'GLOBAL' | 'BRANCH'; active?: boolean } = {},
  ) {
    this.authorize(principal);
    const counts = await this.db.user.groupBy({ by: ['role'], _count: { _all: true } });
    const countOf = (role: ApplicationRole) =>
      counts
        .filter(({ role: stored }) => canonicalRole(stored) === role)
        .reduce((sum, item) => sum + item._count._all, 0);
    const items = CANONICAL_ROLES.map((role) => this.roleView(role, countOf(role)));
    return { items, summary: { total: items.length, active: items.length, inactive: 0 } };
  }

  async getRole(principal: SessionPrincipal, id: string) {
    this.authorize(principal);
    const code = canonicalRole(id.toUpperCase()) as ApplicationRole;
    if (!CANONICAL_ROLES.includes(code)) throw new ApiProblem('NOT_FOUND', HttpStatus.NOT_FOUND);
    return this.roleView(code);
  }

  // --- Nyata ------------------------------------------------------------------------------------

  async getUserAccess(principal: SessionPrincipal, userId: string) {
    this.authorize(principal);
    const user = await this.db.user.findUnique({
      where: { id: userId },
      include: { ownedBranches: true },
    });
    if (!user) throw new ApiProblem('NOT_FOUND', HttpStatus.NOT_FOUND);

    const effectiveRoles = mapUserToEffectiveRoles(user);
    const access = this.policy.resolveAccess(user.id, effectiveRoles);
    const branchIds = [...new Set(effectiveRoles.flatMap(({ branchId }) => (branchId ? [branchId] : [])))];
    const branches = branchIds.length
      ? await this.db.cabang.findMany({
          where: { id: { in: branchIds } },
          select: { id: true, code: true, name: true },
        })
      : [];
    const role = canonicalRole(user.role) as ApplicationRole;
    const catalogEntry = this.policy.roleCatalog().find((item) => item.role === role);

    return {
      user: {
        id: user.id,
        displayName: user.displayName,
        status: user.status,
        version: 1,
      },
      roleAssignments: (effectiveRoles.length ? effectiveRoles : [{ role, branchId: null }])
        .filter(({ role: item }) => canonicalRole(item) === item)
        .map(({ role: item, branchId }) => ({
          id: `${user.id}:${item}:${branchId ?? 'all'}`,
          roleId: item,
          roleCode: item,
          displayName: ROLE_LABELS[item] ?? item,
          scope: catalogEntry?.scope ?? 'BRANCH',
          branchId,
          branch: branches.find((branch) => branch.id === branchId) ?? null,
          source: 'DIRECT' as const,
        })),
      overrides: [],
      effective: {
        capabilities: access.capabilities,
        branches: access.branchIds,
        grants: access.grants,
        denials: access.denials,
      },
    };
  }

  async replaceUserRoles(
    principal: SessionPrincipal,
    userId: string,
    body: {
      roles: Array<{ roleId: string; branchId?: string | null }>;
      expectedVersion?: number;
      reasonCode: string;
      note?: string;
    },
    key: string,
    _correlationId: string,
  ) {
    this.authorize(principal);
    // Mencegah terkunci: akun sendiri dan akun Super Owner tidak boleh diubah lewat jalur ini.
    if (userId === principal.userId)
      throw new ApiProblem('CANNOT_MODIFY_OWN_ACCESS', HttpStatus.FORBIDDEN);

    const roles = Array.isArray(body?.roles) ? body.roles : [];
    // Saat ini satu peran langsung per pengguna (kolom `user.role`); jangan diam-diam membuang sisanya.
    if (roles.length !== 1)
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'roles', issue: 'EXACTLY_ONE_ROLE_SUPPORTED' },
      ]);
    const requested = String(roles[0]?.roleId ?? '').toUpperCase();
    const assignable = new Set<string>(
      this.policy
        .roleCatalog()
        .filter(({ assignable: allowed }) => allowed)
        .map(({ role }) => role),
    );
    if (!assignable.has(requested))
      throw new ApiProblem('ROLE_NOT_ASSIGNABLE', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'roles.0.roleId', issue: 'ROLE_NOT_ASSIGNABLE' },
      ]);

    const scope = this.policy.roleCatalog().find(({ role }) => role === requested)?.scope;
    const requestedBranchId = roles[0]?.branchId ?? null;
    if (scope === 'BRANCH' && !requestedBranchId) {
      const existing = await this.db.user.findUnique({
        where: { id: userId },
        select: { preferredBranchId: true },
      });
      if (!existing?.preferredBranchId)
        throw new ApiProblem('BRANCH_REQUIRED', HttpStatus.UNPROCESSABLE_ENTITY, false, [
          { field: 'roles.0.branchId', issue: 'BRANCH_REQUIRED' },
        ]);
    }
    if (requestedBranchId) {
      const branch = await this.db.cabang.findUnique({ where: { id: requestedBranchId } });
      if (!branch) throw new ApiProblem('BRANCH_NOT_FOUND', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    return this.idempotency.execute(
      {
        scope: `access:replace-user-roles:${userId}`,
        key,
        payload: body,
        ttlMs: 86400000,
        leaseMs: 30000,
      },
      async (tx) => {
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (!user) throw new ApiProblem('NOT_FOUND', HttpStatus.NOT_FOUND);
        if (PROTECTED_ROLES.has(user.role))
          throw new ApiProblem('PROTECTED_ACCOUNT', HttpStatus.FORBIDDEN);

        const effectiveBranchId = scope === 'BRANCH' ? (requestedBranchId ?? user.preferredBranchId) : user.preferredBranchId;
        const updated = await tx.user.update({
          where: { id: userId },
          data: {
            role: requested as Role,
            preferredBranchId: effectiveBranchId,
          },
        });

        if (requested === 'INSTRUCTOR' && effectiveBranchId && tx.penugasanInstruktur?.upsert) {
          await tx.penugasanInstruktur.upsert({
            where: {
              coachId_branchId: { coachId: userId, branchId: effectiveBranchId },
            },
            create: {
              id: newId(),
              coachId: userId,
              branchId: effectiveBranchId,
              active: true,
            },
            update: { active: true },
          });
        } else if (requested !== 'INSTRUCTOR' && tx.penugasanInstruktur?.updateMany) {
          await tx.penugasanInstruktur.updateMany({
            where: { coachId: userId },
            data: { active: false },
          });
        }
        // Sesi lama membawa izin lama; cabut agar pengguna wajib login ulang (sesuai keterangan di UI).
        await tx.userSession.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date(), revocationReason: 'ROLE_CHANGED' },
        });

        await this.audit?.catat(tx, {
          actorId: principal.userId,
          branchId: updated.preferredBranchId,
          correlationId: _correlationId,
          action: 'access.user_role_replaced',
          targetUserId: userId,
          objectType: 'User',
          objectId: userId,
          reason: [body.reasonCode, body.note].filter(Boolean).join(': ') || null,
          beforeMasked: { role: user.role, preferredBranchId: user.preferredBranchId },
          afterMasked: {
            role: updated.role,
            preferredBranchId: updated.preferredBranchId,
            sessionsRevoked: true,
          },
        });

        return {
          status: HttpStatus.OK,
          body: {
            userId: updated.id,
            role: updated.role,
            status: 'UPDATED',
          } as unknown as Prisma.InputJsonValue,
        };
      },
    );
  }
}
