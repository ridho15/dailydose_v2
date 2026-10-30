import { HttpStatus, Injectable } from '@nestjs/common';
import { PackageStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { IdempotencyService } from '../foundation/idempotency.service';
import { AuditService } from '../foundation/audit.service';
import { optionalReason } from '../foundation/reason';
import type { SessionPrincipal } from '../identity/identity.service';
import { ApiProblem, newId } from '../identity/security';
import { PackageAccessService } from './package-access.service';

const PAGE_SIZE = 20;

function packageView(pkg: any) {
  const classTypeScopes = pkg.classType
    ? [{ classTypeId: pkg.classType.id, active: true, classType: pkg.classType }]
    : [];

  const branchScopes = pkg.isMultiBranch
    ? []
    : pkg.branch
    ? [{ branchId: pkg.branch.id, active: true, branch: pkg.branch }]
    : [];

  return {
    id: pkg.id,
    businessKey: pkg.code,
    code: pkg.code,
    name: pkg.name,
    description: pkg.description ?? '',
    priceRp: pkg.priceRp,
    sessionCount: pkg.sessionCount,
    durationDays: pkg.validityDays,
    validityDays: pkg.validityDays,
    status: pkg.status,
    branchId: pkg.branchId ?? null,
    branch: pkg.branch ?? null,
    isMultiBranch: Boolean(pkg.isMultiBranch),
    isShareable: Boolean(pkg.isShareable),
    effectiveState: pkg.status === 'ACTIVE' ? 'LIVE' : pkg.status,
    effectiveFrom: pkg.createdAt,
    effectiveUntil: null,
    branchScopes,
    classTypeScopes,
    classType: pkg.classType ?? null,
    classTypeId: pkg.classTypeId ?? null,
    version: 1,
    historical: false,
    createdAt: pkg.createdAt,
    updatedAt: pkg.updatedAt,
    revisions: [
      {
        revisionNumber: 1,
        name: pkg.name,
        priceRp: pkg.priceRp,
        sessionCount: pkg.sessionCount,
        durationDays: pkg.validityDays,
        validityDays: pkg.validityDays,
        effectiveFrom: pkg.createdAt,
      },
    ],
  };
}

@Injectable()
export class PackageCatalogService {
  constructor(
    private readonly db: PrismaService,
    private readonly access: PackageAccessService,
    private readonly idempotency: IdempotencyService,
    private readonly auditService: AuditService,
  ) {}

  async list(
    principal: SessionPrincipal,
    query: {
      status?: string;
      effectiveState?: string;
      branchId?: string;
      classTypeId?: string;
      q?: string;
      from?: string;
      until?: string;
      includeHistorical?: boolean;
      cursor?: string;
      limit?: string;
    } = {},
  ) {
    this.access.catalog(principal);
    const limit = query.limit ? Math.min(Number(query.limit), 100) : PAGE_SIZE;

    // Filter di luar status dipakai bersama untuk daftar dan ringkasan, sehingga angka ringkasan
    // mencerminkan seluruh katalog yang cocok, bukan hanya satu halaman.
    const baseWhere: Prisma.PaketWhereInput = {
      ...(query.classTypeId ? { classTypeId: query.classTypeId } : {}),
      // Paket multi-cabang berlaku untuk semua cabang, jadi ikut tampil pada filter cabang mana pun.
      ...(query.branchId
        ? {
            OR: [
              { branchId: query.branchId },
              { isMultiBranch: true },
              { branchId: null },
            ],
          }
        : {}),
      ...(query.q?.trim()
        ? {
            AND: [
              {
                OR: [
                  { name: { contains: query.q.trim() } },
                  { code: { contains: query.q.trim() } },
                ],
              },
            ],
          }
        : {}),
    };
    const where: Prisma.PaketWhereInput = {
      ...baseWhere,
      ...(query.status ? { status: query.status as PackageStatus } : {}),
    };

    const [items, activeCount, inactiveCount, archivedCount] = await Promise.all([
      this.db.paket.findMany({
        where,
        include: {
          classType: { select: { id: true, code: true, name: true } },
          branch: { select: { id: true, code: true, name: true } },
        },
        take: limit + 1,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
      this.db.paket.count({ where: { ...baseWhere, status: 'ACTIVE' } }),
      this.db.paket.count({ where: { ...baseWhere, status: 'INACTIVE' } }),
      this.db.paket.count({ where: { ...baseWhere, status: 'ARCHIVED' } }),
    ]);

    const hasNext = items.length > limit;
    const pageItems = hasNext ? items.slice(0, limit) : items;

    const now = new Date();
    const live = await this.db.packagePromotion.findMany({
      where: {
        packageId: { in: pageItems.map((item) => item.id) },
        status: 'ACTIVE',
        activeFrom: { lte: now },
        activeUntil: { gt: now },
      },
      select: { packageId: true },
    });
    const livePackageIds = new Set(live.map((item) => item.packageId));

    return {
      items: pageItems.map((item) => ({
        ...packageView(item),
        livePromotion: livePackageIds.has(item.id),
      })),
      summary: {
        ACTIVE: activeCount,
        SCHEDULED: 0,
        EXPIRED: 0,
        INACTIVE: inactiveCount + archivedCount,
      },
      nextCursor: hasNext ? pageItems[pageItems.length - 1]?.id ?? null : null,
      page: {
        hasMore: hasNext,
        nextCursor: hasNext ? pageItems[pageItems.length - 1]?.id ?? null : null,
      },
    };
  }

  async create(
    principal: SessionPrincipal,
    input: any,
    key: string,
    correlationId: string,
  ) {
    this.access.catalog(principal, true);
    const code = (input.code ?? input.businessKey ?? '').trim().toUpperCase();
    const name = (input.name ?? '').trim();
    const priceRp = Number(input.priceRp);
    const sessionCount = Number(input.sessionCount);
    const validityDays = Number(input.validityDays ?? input.durationDays ?? 30);

    if (!code || !name || priceRp < 0 || sessionCount < 1)
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST);

    const isMultiBranch = Boolean(
      input.isMultiBranch === true ||
      input.isMultiBranch === 'true' ||
      input.branchScope === 'MULTI' ||
      (Array.isArray(input.branchIds) && input.branchIds.length > 1),
    );
    const branchId = isMultiBranch
      ? null
      : (input.branchId ?? (Array.isArray(input.branchIds) ? input.branchIds[0] : null) ?? null);

    return this.idempotency.execute(
      {
        scope: `package-create:${code}`,
        key,
        payload: input,
        ttlMs: 86_400_000,
        leaseMs: 30_000,
      },
      async (tx) => {
        const existing = await tx.paket.findUnique({ where: { code } });
        if (existing) throw new ApiProblem('RESOURCE_EXISTS', HttpStatus.CONFLICT);

        const created = await tx.paket.create({
          data: {
            id: newId(),
            code,
            name,
            description: input.description?.trim() ?? null,
            classTypeId: input.classTypeId ?? input.classTypeIds?.[0] ?? null,
            branchId,
            isMultiBranch,
            isShareable: Boolean(input.isShareable === true || input.isShareable === 'true'),
            priceRp,
            sessionCount,
            validityDays,
            status: 'ACTIVE',
          },
          include: {
            classType: true,
            branch: true,
          },
        });

        this.auditService.record({
          action: 'PACKAGE_CREATED',
          resourceType: 'Package',
          resourceId: created.id,
          actorUserId: principal.userId,
          correlationId,
        });

        return {
          status: HttpStatus.CREATED,
          body: packageView(created) as unknown as Prisma.InputJsonValue,
        };
      },
    );
  }

  async update(
    principal: SessionPrincipal,
    id: string,
    body: any,
    key: string,
    correlationId: string,
  ) {
    this.access.catalog(principal, true);
    return this.idempotency.execute(
      {
        scope: `package-update:${id}`,
        key,
        payload: body,
        ttlMs: 86_400_000,
        leaseMs: 30_000,
      },
      async (tx) => {
        const pkg = await tx.paket.findUnique({ where: { id } });
        if (!pkg) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

        const isMultiBranch =
          body.isMultiBranch !== undefined
            ? Boolean(body.isMultiBranch === true || body.isMultiBranch === 'true')
            : undefined;
        const branchId =
          isMultiBranch === true
            ? null
            : body.branchId !== undefined
            ? body.branchId
            : undefined;

        const updated = await tx.paket.update({
          where: { id },
          data: {
            name: body.name !== undefined ? body.name.trim() : undefined,
            description: body.description !== undefined ? body.description?.trim() : undefined,
            priceRp: body.priceRp !== undefined ? Number(body.priceRp) : undefined,
            sessionCount: body.sessionCount !== undefined ? Number(body.sessionCount) : undefined,
            validityDays:
              body.validityDays !== undefined
                ? Number(body.validityDays)
                : body.durationDays !== undefined
                  ? Number(body.durationDays)
                  : undefined,
            classTypeId: body.classTypeId !== undefined ? body.classTypeId : undefined,
            ...(body.isShareable !== undefined
              ? { isShareable: Boolean(body.isShareable === true || body.isShareable === 'true') }
              : {}),
            ...(isMultiBranch !== undefined ? { isMultiBranch } : {}),
            ...(branchId !== undefined ? { branchId } : {}),
          },
          include: { classType: true, branch: true },
        });

        this.auditService.record({
          action: 'PACKAGE_UPDATED',
          resourceType: 'Package',
          resourceId: id,
          actorUserId: principal.userId,
          correlationId,
        });

        return {
          status: HttpStatus.OK,
          body: packageView(updated) as unknown as Prisma.InputJsonValue,
        };
      },
    );
  }

  async revise(
    principal: SessionPrincipal,
    id: string,
    body: any,
    key: string,
    correlationId: string,
  ) {
    return this.update(principal, id, body, key, correlationId);
  }

  async replaceScopes(
    principal: SessionPrincipal,
    id: string,
    body: any,
    key: string,
    correlationId: string,
  ) {
    this.access.catalog(principal, true);
    return this.idempotency.execute(
      {
        scope: `package-scopes:${id}`,
        key,
        payload: body,
        ttlMs: 86_400_000,
        leaseMs: 30_000,
      },
      async (tx) => {
        const pkg = await tx.paket.findUnique({ where: { id }, include: { classType: true } });
        if (!pkg) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

        const branchIds = Array.isArray(body.branchIds) ? body.branchIds : [];
        const isMultiBranch =
          body.isMultiBranch !== undefined
            ? Boolean(body.isMultiBranch)
            : branchIds.length > 1;
        const branchId = isMultiBranch ? null : (branchIds[0] ?? null);
        const classTypeId =
          body.classTypeId ??
          (Array.isArray(body.classTypeIds) && body.classTypeIds.length > 0
            ? body.classTypeIds[0]
            : undefined);

        const updated = await tx.paket.update({
          where: { id },
          data: {
            isMultiBranch,
            branchId,
            ...(classTypeId !== undefined ? { classTypeId } : {}),
          },
          include: { classType: true, branch: true },
        });

        this.auditService.record({
          action: 'PACKAGE_SCOPES_REPLACED',
          resourceType: 'Package',
          resourceId: id,
          actorUserId: principal.userId,
          correlationId,
        });

        return {
          status: HttpStatus.OK,
          body: packageView(updated) as unknown as Prisma.InputJsonValue,
        };
      },
    );
  }

  async transition(
    principal: SessionPrincipal,
    id: string,
    action: 'activate' | 'pause' | 'archive' | string,
    body: any,
    key: string,
    correlationId: string,
  ) {
    this.access.catalog(principal, true);
    // Controller mengirim status tujuan ('ACTIVE'/'INACTIVE'); nama aksi lama ('activate'/'archive') tetap dikenali.
    const targetStatus: PackageStatus =
      action === 'ACTIVE' || action === 'activate'
        ? 'ACTIVE'
        : action === 'ARCHIVED' || action === 'archive'
          ? 'ARCHIVED'
          : 'INACTIVE';

    return this.idempotency.execute(
      {
        scope: `package-transition:${id}`,
        key,
        payload: { action, ...body },
        ttlMs: 86_400_000,
        leaseMs: 30_000,
      },
      async (tx) => {
        const pkg = await tx.paket.findUnique({ where: { id } });
        if (!pkg) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

        // Alasan opsional; bila diisi harus 3–500 karakter.
        const trimmed = optionalReason(body?.reason) ?? '';

        const updated = await tx.paket.update({
          where: { id },
          data: { status: targetStatus },
          include: { classType: true },
        });

        await this.auditService.catat(tx, {
          action: `PACKAGE_${targetStatus}`,
          objectType: 'Package',
          objectId: id,
          actorId: principal.userId,
          branchId: pkg.branchId ?? null,
          correlationId,
          reason: trimmed || null,
          beforeMasked: { status: pkg.status },
          afterMasked: { status: targetStatus },
        });

        return {
          status: HttpStatus.OK,
          body: packageView(updated) as unknown as Prisma.InputJsonValue,
        };
      },
    );
  }

  // --- Indonesian Domain Aliases ---
  async revisiPaket(
    principal: SessionPrincipal,
    id: string,
    body: Parameters<PackageCatalogService['revise']>[2],
    key: string,
    correlationId: string,
  ) {
    return this.revise(principal, id, body, key, correlationId);
  }

}
