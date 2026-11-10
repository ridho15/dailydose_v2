import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { IdempotencyService } from '../foundation/idempotency.service';
import { AuditService } from '../foundation/audit.service';
import { optionalReason } from '../foundation/reason';
import type { SessionPrincipal } from '../identity/identity.service';
import { ApiProblem, ENTITY_ID_REGEX } from '../identity/security';
import { masaJualPaket } from './masa-jual';
import { PackageAccessService } from './package-access.service';
import { calculatePackagePromotion, promotionEffectiveState } from './kalkulasi-harga-paket.service';

export type PackagePromotionStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
export type PromotionDiscountKind = 'PERCENTAGE' | 'FIXED' | 'FIXED_AMOUNT';

type PromotionCommand = {
  name: string;
  label?: string;
  discountType: PromotionDiscountKind;
  discountValue: number;
  activeFrom: string;
  activeUntil: string;
};

type Fields = {
  name: string;
  label: string;
  discountType: 'PERCENTAGE' | 'FIXED_AMOUNT';
  discountValue: number;
  activeFrom: Date;
  activeUntil: Date;
};

const PAGE_SIZE = 20;
const MAX_PERCENT = 90;

const invalid = (field: string, issue = 'INVALID') =>
  new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [{ field, issue }]);

function parseDate(value: unknown, field: string) {
  const date = typeof value === 'string' || value instanceof Date ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) throw invalid(field, 'INVALID_DATE');
  return date;
}

/** Validasi + normalisasi isi promosi terhadap harga paket; `current` melengkapi field yang tidak dikirim. */
function resolveFields(
  input: Partial<PromotionCommand>,
  priceRp: number,
  current?: Fields,
  now = new Date(),
): Fields {
  const name = (input.name ?? current?.name ?? '').toString().trim();
  if (name.length < 2 || name.length > 80) throw invalid('name');
  const label = (input.label ?? current?.label ?? name).toString().trim().slice(0, 40) || name.slice(0, 40);

  const rawType = input.discountType ?? current?.discountType;
  const discountType =
    rawType === 'PERCENTAGE' ? 'PERCENTAGE' : rawType === 'FIXED' || rawType === 'FIXED_AMOUNT' ? 'FIXED_AMOUNT' : null;
  if (!discountType) throw invalid('discountType');
  const discountValue = input.discountValue ?? current?.discountValue;
  if (!Number.isInteger(discountValue) || discountValue! < 1) throw invalid('discountValue');
  if (discountType === 'PERCENTAGE' && discountValue! > MAX_PERCENT) throw invalid('discountValue', 'TOO_LARGE');
  if (discountType === 'FIXED_AMOUNT' && discountValue! >= priceRp) throw invalid('discountValue', 'TOO_LARGE');

  const activeFrom = input.activeFrom !== undefined ? parseDate(input.activeFrom, 'activeFrom') : current?.activeFrom;
  const activeUntil =
    input.activeUntil !== undefined ? parseDate(input.activeUntil, 'activeUntil') : current?.activeUntil;
  if (!activeFrom) throw invalid('activeFrom', 'REQUIRED');
  if (!activeUntil) throw invalid('activeUntil', 'REQUIRED');
  if (activeFrom >= activeUntil) throw invalid('activeUntil', 'BEFORE_START');
  if (activeUntil <= now) throw invalid('activeUntil', 'IN_THE_PAST');

  return { name, label, discountType, discountValue: discountValue!, activeFrom, activeUntil };
}

type PromotionRow = {
  id: string;
  packageId: string;
  name: string;
  label: string;
  status: PackagePromotionStatus;
  discountType: 'PERCENTAGE' | 'FIXED_AMOUNT';
  discountValue: number;
  activeFrom: Date;
  activeUntil: Date;
  version: number;
};

@Injectable()
export class PackagePromotionService {
  constructor(
    private readonly db: PrismaService,
    private readonly access: PackageAccessService,
    private readonly idempotency: IdempotencyService,
    private readonly auditService: AuditService,
  ) {}

  private requireRead(principal: SessionPrincipal) {
    if (
      !principal.capabilities.includes('package-promotion:read') &&
      !principal.capabilities.includes('package-promotion:manage')
    )
      throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
  }

  private requireManage(principal: SessionPrincipal, _branchId?: string) {
    if (!principal.capabilities.includes('package-promotion:manage'))
      throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
  }

  private view(row: PromotionRow, priceRp: number, usageCount = 0) {
    const calculated = calculatePackagePromotion({
      priceRp,
      promotion: { ...row, status: 'ACTIVE' },
      now: row.activeFrom, // hitung nilai diskon terlepas dari status waktu
    });
    const discountRp = calculated.promotion?.discountRp ?? 0;
    return {
      id: row.id,
      packageId: row.packageId,
      name: row.name,
      label: row.label,
      status: row.status,
      effectiveState: promotionEffectiveState(row),
      discountType: row.discountType,
      discountValue: row.discountValue,
      discountRp,
      promotionalPriceRp: priceRp - discountRp,
      activeFrom: row.activeFrom.toISOString(),
      activeUntil: row.activeUntil.toISOString(),
      version: row.version,
      usageCount,
    };
  }

  private async usageCounts(ids: string[]) {
    if (ids.length === 0) return new Map<string, number>();
    const grouped = await this.db.pembelian.groupBy({
      by: ['promotionId'],
      where: { promotionId: { in: ids } },
      _count: { _all: true },
    });
    return new Map(grouped.map((entry) => [entry.promotionId as string, entry._count._all]));
  }

  private async packageOrThrow(principal: SessionPrincipal, packageId: string, manage = false) {
    if (manage) this.requireManage(principal);
    else this.requireRead(principal);
    if (!ENTITY_ID_REGEX.test(packageId))
      throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

    const pkg = await this.db.paket.findUnique({
      where: { id: packageId },
      include: {
        classType: { select: { id: true, code: true, name: true } },
        branch: { select: { id: true, code: true, name: true } },
        _count: { select: { purchases: true, customerPackages: true } },
      },
    });
    if (!pkg) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    return pkg;
  }

  private async promotionOrThrow(id: string) {
    if (!ENTITY_ID_REGEX.test(id)) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const row = await this.db.packagePromotion.findUnique({
      where: { id },
      include: { package: { select: { priceRp: true } } },
    });
    if (!row) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    return row;
  }

  /** Tidak boleh ada dua promosi ACTIVE yang jendela waktunya saling tumpang tindih pada paket yang sama. */
  private async assertNoOverlap(
    client: Pick<Prisma.TransactionClient, 'packagePromotion'>,
    packageId: string,
    from: Date,
    until: Date,
    excludeId?: string,
  ) {
    const clash = await client.packagePromotion.findFirst({
      where: {
        packageId,
        status: 'ACTIVE',
        ...(excludeId ? { id: { not: excludeId } } : {}),
        activeFrom: { lt: until },
        activeUntil: { gt: from },
      },
      select: { id: true },
    });
    if (clash) throw new ApiProblem('PROMOTION_OVERLAP', HttpStatus.CONFLICT);
  }

  async packageDetail(principal: SessionPrincipal, packageId: string) {
    const pkg = await this.packageOrThrow(principal, packageId);
    const masa = (await masaJualPaket(this.db, [packageId])).get(packageId);
    const rows = await this.db.packagePromotion.findMany({
      where: { packageId },
      orderBy: [{ activeFrom: 'desc' }, { id: 'desc' }],
      take: 50,
    });
    const usage = await this.usageCounts(rows.map((row) => row.id));
    const promotions = rows.map((row) => this.view(row, pkg.priceRp, usage.get(row.id) ?? 0));
    const branchScopes = (pkg as any).isMultiBranch
      ? []
      : (pkg as any).branch
      ? [{ branchId: (pkg as any).branch.id, active: true, branch: (pkg as any).branch }]
      : [];
    const detail = {
      id: pkg.id,
      code: pkg.code,
      businessKey: pkg.code,
      name: pkg.name,
      description: pkg.description ?? '',
      priceRp: pkg.priceRp,
      sessionCount: pkg.sessionCount,
      durationDays: pkg.validityDays,
      validityDays: pkg.validityDays,
      status: pkg.status,
      isMultiBranch: Boolean((pkg as any).isMultiBranch),
      // Paket bersama (Duet/Family): tanpa ini halaman detail selalu menulis "Individu".
      isShareable: Boolean((pkg as any).isShareable),
      branchId: pkg.branchId ?? null,
      branch: (pkg as any).branch ?? null,
      effectiveState: pkg.status === 'ACTIVE' ? 'LIVE' : pkg.status,
      effectiveFrom: (masa?.mulai ?? pkg.createdAt).toISOString(),
      effectiveUntil: masa?.berakhir?.toISOString() ?? null,
      branchScopes,
      classTypeScopes: pkg.classType ? [{ classType: pkg.classType }] : [],
      classType: pkg.classType ?? null,
      classTypeId: pkg.classTypeId ?? null,
      version: 1,
      revisions: [
        {
          id: `${pkg.id}-r1`,
          revisionNumber: 1,
          name: pkg.name,
          priceRp: pkg.priceRp,
          sessionCount: pkg.sessionCount,
          durationDays: pkg.validityDays,
          validityDays: pkg.validityDays,
          effectiveFrom: pkg.createdAt.toISOString(),
        },
      ],
      publicProfile: null,
    };
    return {
      ...detail,
      package: detail,
      promotions,
      auditActivity: [],
    };
  }

  async list(principal: SessionPrincipal, packageId: string, _cursor?: string, _limit?: string) {
    const pkg = await this.packageOrThrow(principal, packageId);
    const masa = (await masaJualPaket(this.db, [packageId])).get(packageId);
    const rows = await this.db.packagePromotion.findMany({
      where: { packageId },
      orderBy: [{ activeFrom: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    const usage = await this.usageCounts(rows.map((row) => row.id));
    return {
      items: rows.map((row) => this.view(row, pkg.priceRp, usage.get(row.id) ?? 0)),
      nextCursor: null,
      page: { hasMore: false, nextCursor: null },
    };
  }

  async create(
    principal: SessionPrincipal,
    packageId: string,
    body: PromotionCommand,
    key: string,
    correlationId: string,
  ) {
    const pkg = await this.packageOrThrow(principal, packageId, true);
    const fields = resolveFields(body ?? {}, pkg.priceRp);
    return this.idempotency.execute(
      {
        scope: `package-promotions:create:${packageId}`,
        key,
        payload: body,
        ttlMs: 86400000,
        leaseMs: 30000,
      },
      async (tx) => {
        await this.assertNoOverlap(tx, packageId, fields.activeFrom, fields.activeUntil);
        const created = await tx.packagePromotion.create({
          data: { ...fields, packageId, status: 'ACTIVE', createdById: principal.userId },
        });
        this.auditService.record({
          action: 'package-promotion.create',
          resourceType: 'PackagePromotion',
          resourceId: created.id,
          actorUserId: principal.userId,
          correlationId,
        });
        return {
          status: HttpStatus.CREATED,
          body: this.view(created, pkg.priceRp) as unknown as Prisma.InputJsonValue,
        };
      },
    );
  }

  async update(
    principal: SessionPrincipal,
    id: string,
    body: Partial<PromotionCommand> & { expectedVersion?: number },
    key: string,
    correlationId: string,
  ) {
    this.requireManage(principal);
    const current = await this.promotionOrThrow(id);
    if (current.status === 'ARCHIVED') throw new ApiProblem('INVALID_STATE', HttpStatus.CONFLICT);
    const fields = resolveFields(body, current.package.priceRp, {
      name: current.name,
      label: current.label,
      discountType: current.discountType,
      discountValue: current.discountValue,
      activeFrom: current.activeFrom,
      activeUntil: current.activeUntil,
    });
    return this.idempotency.execute(
      {
        scope: `package-promotions:update:${id}`,
        key,
        payload: body,
        ttlMs: 86400000,
        leaseMs: 30000,
      },
      async (tx) => {
        if (current.status === 'ACTIVE')
          await this.assertNoOverlap(tx, current.packageId, fields.activeFrom, fields.activeUntil, id);
        const claimed = await tx.packagePromotion.updateMany({
          where: {
            id,
            ...(Number.isInteger(body?.expectedVersion) ? { version: body.expectedVersion } : {}),
            status: { not: 'ARCHIVED' },
          },
          data: { ...fields, version: { increment: 1 } },
        });
        if (claimed.count !== 1) throw new ApiProblem('STALE_VERSION', HttpStatus.CONFLICT);
        const updated = await tx.packagePromotion.findUniqueOrThrow({ where: { id } });
        this.auditService.record({
          action: 'package-promotion.update',
          resourceType: 'PackagePromotion',
          resourceId: id,
          actorUserId: principal.userId,
          correlationId,
        });
        return {
          status: HttpStatus.OK,
          body: this.view(updated, current.package.priceRp) as unknown as Prisma.InputJsonValue,
        };
      },
    );
  }

  async transition(
    principal: SessionPrincipal,
    id: string,
    status: PackagePromotionStatus,
    body: { expectedVersion?: number; reason?: string },
    key: string,
    correlationId: string,
  ) {
    this.requireManage(principal);
    // Alasan opsional; bila diisi harus 3–500 karakter.
    const reason = optionalReason(body?.reason) ?? '';
    const current = await this.promotionOrThrow(id);
    const allowed: Record<PackagePromotionStatus, PackagePromotionStatus[]> = {
      ACTIVE: ['PAUSED'],
      PAUSED: ['ACTIVE'],
      ARCHIVED: [],
    };
    const from = current.status as PackagePromotionStatus;
    const canArchive = from !== 'ARCHIVED' && status === 'ARCHIVED';
    if (!canArchive && !allowed[from].includes(status))
      throw new ApiProblem('INVALID_STATE', HttpStatus.CONFLICT);
    if (status === 'ACTIVE' && current.activeUntil <= new Date())
      throw new ApiProblem('PROMOTION_EXPIRED', HttpStatus.CONFLICT);

    return this.idempotency.execute(
      {
        scope: `package-promotions:transition:${id}`,
        key,
        payload: { status, ...body },
        ttlMs: 86400000,
        leaseMs: 30000,
      },
      async (tx) => {
        if (status === 'ACTIVE')
          await this.assertNoOverlap(tx, current.packageId, current.activeFrom, current.activeUntil, id);
        const claimed = await tx.packagePromotion.updateMany({
          where: {
            id,
            ...(Number.isInteger(body?.expectedVersion) ? { version: body.expectedVersion } : {}),
            status: from,
          },
          data: { status, version: { increment: 1 } },
        });
        if (claimed.count !== 1) throw new ApiProblem('STALE_VERSION', HttpStatus.CONFLICT);
        const updated = await tx.packagePromotion.findUniqueOrThrow({ where: { id } });
        await this.auditService.catat(tx, {
          action: `package-promotion.${status.toLowerCase()}`,
          objectType: 'PackagePromotion',
          objectId: id,
          actorId: principal.userId,
          correlationId,
          reason: reason || null,
          beforeMasked: { status: from },
          afterMasked: { status },
        });
        return {
          status: HttpStatus.OK,
          body: this.view(updated, current.package.priceRp) as unknown as Prisma.InputJsonValue,
        };
      },
    );
  }

  async orders(principal: SessionPrincipal, id: string, cursor?: string, limit?: string) {
    this.requireRead(principal);
    await this.promotionOrThrow(id);
    const take = Math.min(Math.max(Number(limit) || PAGE_SIZE, 1), 100);
    const rows = await this.db.pembelian.findMany({
      where: { promotionId: id },
      include: {
        user: { select: { displayName: true } },
        branch: { select: { id: true, name: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const nextCursor = hasMore ? (page.at(-1)?.id ?? null) : null;
    return {
      items: page.map((row) => ({
        id: row.id,
        status: row.status,
        packagePromotionDiscountRpSnapshot: row.promotionDiscountRp,
        promotionalPriceRpSnapshot: row.subtotalRp - row.promotionDiscountRp,
        voucherDiscountRpSnapshot: Math.max(0, row.discountRp - row.promotionDiscountRp),
        priceAfterDiscountRpSnapshot: row.totalAmountRp,
        submittedAt: row.createdAt.toISOString(),
        user: { displayName: row.user.displayName },
        branch: row.branch,
      })),
      nextCursor,
      page: { hasMore, nextCursor },
    };
  }
}
