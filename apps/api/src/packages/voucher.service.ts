import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { IdempotencyService } from '../foundation/idempotency.service';
import { optionalReason } from '../foundation/reason';
import { AuditService } from '../foundation/audit.service';
import type { SessionPrincipal } from '../identity/identity.service';
import { ApiProblem, newId } from '../identity/security';
import { PackageAccessService } from './package-access.service';
import { PackagePricingService } from './kalkulasi-harga-paket.service';

export type VoucherDiscountType = 'PERCENTAGE' | 'FIXED_AMOUNT';
/** Status yang dapat diminta lewat perintah (transition). */
export type VoucherStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
/** Status yang ditampilkan: turunan dari kolom `active`, `validUntil`, `quota`, dan `usedCount`. */
export type VoucherDisplayStatus = 'ACTIVE' | 'PAUSED' | 'EXPIRED' | 'EXHAUSTED' | 'ARCHIVED';

export function deriveVoucherStatus(
  voucher: {
    active: boolean;
    archivedAt?: Date | string | null;
    validUntil?: Date | string | null;
    quota?: number | null;
    usedCount?: number | null;
  },
  now: Date = new Date(),
): VoucherDisplayStatus {
  if (voucher.archivedAt) return 'ARCHIVED';
  if (!voucher.active) return 'PAUSED';
  if (voucher.validUntil && new Date(voucher.validUntil).getTime() < now.getTime())
    return 'EXPIRED';
  if (voucher.quota != null && (voucher.usedCount ?? 0) >= voucher.quota) return 'EXHAUSTED';
  return 'ACTIVE';
}

export type VoucherInput = {
  code: string;
  name: string;
  description?: string;
  discountType: VoucherDiscountType;
  discountValue: number;
  maxDiscountRp?: number | null;
  minimumPurchaseRp?: number;
  activeFrom?: string | Date;
  activeUntil?: string | Date | null;
  totalUsageLimit?: number | null;
  perCustomerUsageLimit?: number | null;
  branchId?: string | null;
  classTypeId?: string | null;
  packageIds?: string[];
};

const PAGE_SIZE = 20;

/**
 * Ringkasan per status (dari seluruh hasil pencarian), filter status, dan halaman berbasis cursor.
 * Voucher berstatus `ARCHIVED` (kolom `archivedAt`) tidak tampil kecuali diminta lewat filter status; jumlah
 * dan `total` di ringkasan hanya menghitung yang belum diarsipkan.
 */
export function paginateVouchers<
  T extends {
    id: string;
    active: boolean;
    archivedAt?: Date | string | null;
    validUntil?: Date | string | null;
    quota?: number | null;
    usedCount?: number | null;
  },
>(
  rows: T[],
  options: { status?: string; cursor?: string; page?: number; limit: number; now?: Date },
): {
  items: T[];
  hasMore: boolean;
  nextCursor: string | null;
  total: number;
  totalPages: number;
  page: number;
  pageSize: number;
  summary: Record<VoucherDisplayStatus | 'total', number>;
} {
  const now = options.now ?? new Date();
  const summary: Record<VoucherDisplayStatus | 'total', number> = {
    ACTIVE: 0,
    PAUSED: 0,
    EXPIRED: 0,
    EXHAUSTED: 0,
    ARCHIVED: 0,
    total: rows.filter((row) => !row.archivedAt).length,
  };
  for (const row of rows) summary[deriveVoucherStatus(row, now)] += 1;

  const wanted = options.status;
  const filtered = wanted
    ? rows.filter((row) => deriveVoucherStatus(row, now) === wanted)
    : rows.filter((row) => !row.archivedAt);
  const total = filtered.length;
  const totalPages = Math.ceil(total / options.limit) || 1;
  const pageNumber = options.page && Number(options.page) > 0 ? Number(options.page) : undefined;

  let items: T[];
  let hasMore: boolean;
  let nextCursor: string | null;

  if (pageNumber) {
    const start = (pageNumber - 1) * options.limit;
    items = filtered.slice(start, start + options.limit);
    hasMore = pageNumber < totalPages;
    nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;
  } else {
    const start = options.cursor ? filtered.findIndex((row) => row.id === options.cursor) + 1 : 0;
    items = filtered.slice(start, start + options.limit);
    hasMore = start + options.limit < filtered.length;
    nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;
  }

  return {
    items,
    hasMore,
    nextCursor,
    total,
    totalPages,
    page: pageNumber ?? 1,
    pageSize: options.limit,
    summary,
  };
}

export type VoucherNumberIssue = { field: string; issue: string };

/**
 * Angka voucher yang masuk akal: potongan bulat > 0 (persen paling banyak 100), minimum belanja >= 0,
 * batas potongan dan kuota bilangan bulat > 0, dan tanggal berakhir yang terbaca. Hanya kolom yang dikirim yang diperiksa.
 */
export function voucherNumberIssues(input: {
  discountType: 'PERCENTAGE' | 'NOMINAL';
  discountValue?: number;
  minSpendRp?: number;
  maxDiscountRp?: number | null;
  quota?: number;
  validUntil?: Date | null;
}): VoucherNumberIssue[] {
  const issues: VoucherNumberIssue[] = [];
  const wholeAbove = (value: number, min: number) => Number.isInteger(value) && value >= min;
  if (input.discountValue !== undefined) {
    if (!wholeAbove(input.discountValue, 1)) issues.push({ field: 'discountValue', issue: 'POSITIVE_INTEGER' });
    else if (input.discountType === 'PERCENTAGE' && input.discountValue > 100)
      issues.push({ field: 'discountValue', issue: 'PERCENT_MAX_100' });
  }
  if (input.minSpendRp !== undefined && !wholeAbove(input.minSpendRp, 0))
    issues.push({ field: 'minimumPurchaseRp', issue: 'NON_NEGATIVE_INTEGER' });
  if (input.maxDiscountRp != null && !wholeAbove(input.maxDiscountRp, 1))
    issues.push({ field: 'maxDiscountRp', issue: 'POSITIVE_INTEGER' });
  if (input.quota !== undefined && !wholeAbove(input.quota, 1))
    issues.push({ field: 'totalUsageLimit', issue: 'POSITIVE_INTEGER' });
  if (input.validUntil instanceof Date && Number.isNaN(input.validUntil.getTime()))
    issues.push({ field: 'activeUntil', issue: 'INVALID_DATE' });
  return issues;
}

export function normalizeVoucherCode(code: string) {
  return (code ?? '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
}

/**
 * `Voucher.discountType` adalah kolom teks bebas (data impor bisa berisi "PERCENT", "percentage", dsb).
 * Satu pengenal untuk perhitungan dan tampilan agar voucher persen tidak pernah dianggap nominal.
 */
export function isPercentageVoucherType(type: string | null | undefined): boolean {
  return ['PERCENTAGE', 'PERCENT', 'PERSEN', '%'].includes((type ?? '').trim().toUpperCase());
}

export function calculateVoucherDiscount(input: {
  priceRp: number;
  discountType: string;
  discountValue: number;
  maxDiscountRp?: number | null;
}) {
  const isPercent = isPercentageVoucherType(input.discountType);
  const raw = isPercent
    ? Math.floor((input.priceRp * input.discountValue) / 100)
    : input.discountValue;
  const capped =
    input.maxDiscountRp && input.maxDiscountRp > 0
      ? Math.min(raw, input.maxDiscountRp)
      : raw;
  return Math.max(0, Math.min(capped, Math.max(0, input.priceRp)));
}

export type VoucherApplicabilityIssue =
  | 'NOT_FOUND'
  | 'INACTIVE'
  | 'EXPIRED'
  | 'MINIMUM_SPEND_NOT_MET'
  | 'EXHAUSTED';

export function checkVoucherApplicability(
  voucher: {
    active: boolean;
    validUntil?: Date | string | null;
    minSpendRp: number;
    quota?: number | null;
    usedCount: number;
  } | null | undefined,
  basisRp: number,
  now: Date = new Date(),
): { valid: true } | { valid: false; issue: VoucherApplicabilityIssue } {
  if (!voucher) {
    return { valid: false, issue: 'NOT_FOUND' };
  }
  if (!voucher.active) {
    return { valid: false, issue: 'INACTIVE' };
  }
  if (voucher.validUntil && new Date(voucher.validUntil).getTime() <= now.getTime()) {
    return { valid: false, issue: 'EXPIRED' };
  }
  if (basisRp < voucher.minSpendRp) {
    return { valid: false, issue: 'MINIMUM_SPEND_NOT_MET' };
  }
  if (voucher.quota !== null && voucher.quota !== undefined && voucher.usedCount >= voucher.quota) {
    return { valid: false, issue: 'EXHAUSTED' };
  }
  return { valid: true };
}

/**
 * Pakai satu kuota voucher secara atomik: kenaikan hanya terjadi bila kuota belum habis pada saat
 * UPDATE, sehingga dua pesanan bersamaan tidak bisa melewati batas. Dipanggil di transaksi pesanan.
 */
export async function pakaiKuotaVoucher(
  tx: Prisma.TransactionClient,
  voucher: { id: string; quota?: number | null },
): Promise<void> {
  const hasil = await tx.voucher.updateMany({
    where:
      voucher.quota === null || voucher.quota === undefined
        ? { id: voucher.id }
        : { id: voucher.id, usedCount: { lt: voucher.quota } },
    data: { usedCount: { increment: 1 } },
  });
  if (hasil.count === 0) throw new ApiProblem('VOUCHER_QUOTA_EXHAUSTED', HttpStatus.CONFLICT);
}

/** Kembalikan kuota saat pesanan bervoucher batal/ditolak; tidak pernah di bawah 0. */
export async function lepasKuotaVoucher(
  tx: Prisma.TransactionClient,
  voucherId: string | null | undefined,
): Promise<void> {
  if (!voucherId) return;
  await tx.voucher.updateMany({
    where: { id: voucherId, usedCount: { gt: 0 } },
    data: { usedCount: { decrement: 1 } },
  });
}

@Injectable()
export class VoucherService {
  constructor(
    private readonly db: PrismaService,
    private readonly access: PackageAccessService,
    private readonly pricing: PackagePricingService,
    private readonly idempotency: IdempotencyService,
    private readonly auditService: AuditService,
  ) {}

  private requireRead(principal: SessionPrincipal) {
    if (
      !principal.capabilities.includes('voucher:read') &&
      !principal.capabilities.includes('voucher:manage')
    )
      throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
  }

  private requireManage(principal: SessionPrincipal) {
    if (!principal.capabilities.includes('voucher:manage'))
      throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
  }

  private view(voucher: any) {
    const isPercent = isPercentageVoucherType(voucher.discountType);
    const status = deriveVoucherStatus(voucher);
    return {
      id: voucher.id,
      code: voucher.code,
      name: voucher.name ?? '',
      description: voucher.description ?? '',
      status,
      discountType: isPercent ? 'PERCENTAGE' : 'FIXED_AMOUNT',
      discountValue: voucher.discountValue ?? 0,
      maxDiscountRp: voucher.maxDiscountRp ?? null,
      minimumPurchaseRp: voucher.minSpendRp ?? 0,
      minSpendRp: voucher.minSpendRp ?? 0,
      activeFrom: voucher.createdAt,
      activeUntil: voucher.validUntil ?? null,
      validUntil: voucher.validUntil ?? null,
      totalUsageLimit: voucher.quota ?? null,
      quota: voucher.quota ?? null,
      perCustomerUsageLimit: null,
      redeemedCount: voucher.usedCount ?? 0,
      usedCount: voucher.usedCount ?? 0,
      branch: null,
      classType: null,
      packageIds: [],
      packages: [],
      auditActivity: [],
      version: 1,
      createdAt: voucher.createdAt,
      updatedAt: voucher.createdAt,
    };
  }

  async list(
    principal: SessionPrincipal,
    query: {
      q?: string;
      status?: string;
      branchId?: string;
      cursor?: string;
      page?: number;
      pageSize?: number;
      limit?: string;
      from?: string;
      until?: string;
      includeHistorical?: boolean;
    } = {},
  ) {
    this.requireRead(principal);
    const limit = query.pageSize ? Math.min(Number(query.pageSize), 100) : (query.limit ? Math.min(Number(query.limit), 100) : PAGE_SIZE);

    // Status tampilan diturunkan dari beberapa kolom (tidak bisa difilter di SQL), dan tabel
    // voucher kecil, jadi filter status + ringkasan + cursor dihitung di memori.
    const rows = await this.db.voucher.findMany({
      where: query.q?.trim()
        ? {
            OR: [
              { code: { contains: query.q.trim() } },
              { name: { contains: query.q.trim() } },
            ],
          }
        : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const page = paginateVouchers(rows, {
      status: query.status,
      cursor: query.cursor,
      page: query.page,
      limit,
    });

    return {
      items: page.items.map((v) => this.view(v)),
      nextCursor: page.nextCursor,
      total: page.total,
      totalPages: page.totalPages,
      currentPage: page.page,
      pageSize: page.pageSize,
      page: query.page != null
        ? {
            hasMore: page.hasMore,
            nextCursor: page.nextCursor,
            current: page.page,
            total: page.total,
            totalPages: page.totalPages,
            pageSize: page.pageSize,
          }
        : { hasMore: page.hasMore, nextCursor: page.nextCursor },
      summary: page.summary,
    };
  }

  async detail(principal: SessionPrincipal, id: string) {
    this.requireRead(principal);
    const voucher = await this.db.voucher.findUnique({
      where: { id },
      include: {
        purchases: {
          select: { id: true, invoiceNumber: true, totalAmountRp: true, createdAt: true },
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!voucher) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    return {
      ...this.view(voucher),
      redemptions: (voucher.purchases ?? []).map((p: any) => ({
        id: p.id,
        orderId: p.id,
        orderNumber: p.invoiceNumber,
        redeemedAt: p.createdAt,
      })),
    };
  }

  async create(
    principal: SessionPrincipal,
    input: VoucherInput,
    key: string,
    correlationId: string,
  ) {
    this.requireManage(principal);
    const code = normalizeVoucherCode(input.code);
    const name = (input.name ?? '').trim();
    if (!code || !name) throw new ApiProblem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST);

    return this.idempotency.execute(
      {
        scope: `voucher-create:${code}`,
        key,
        payload: input,
        ttlMs: 86_400_000,
        leaseMs: 30_000,
      },
      async (tx) => {
        const existing = await tx.voucher.findUnique({ where: { code } });
        if (existing) throw new ApiProblem('RESOURCE_EXISTS', HttpStatus.CONFLICT);

        const discountType = input.discountType === 'PERCENTAGE' ? 'PERCENTAGE' : 'NOMINAL';
        const discountValue = Number(input.discountValue ?? 0);
        const minSpendRp = Number(input.minimumPurchaseRp ?? 0);
        const maxDiscountRp = input.maxDiscountRp ? Number(input.maxDiscountRp) : null;
        const quota = Number(input.totalUsageLimit ?? 100);
        const validUntil = input.activeUntil ? new Date(input.activeUntil) : null;
        const issues = voucherNumberIssues({
          discountType,
          discountValue,
          minSpendRp,
          maxDiscountRp,
          quota,
          validUntil,
        });
        if (issues.length)
          throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, issues);

        const created = await tx.voucher.create({
          data: {
            id: newId(),
            code,
            name,
            discountType,
            discountValue,
            minSpendRp,
            maxDiscountRp,
            quota,
            usedCount: 0,
            validUntil,
            active: true,
          },
        });

        this.auditService.record({
          action: 'VOUCHER_CREATED',
          resourceType: 'Voucher',
          resourceId: created.id,
          actorUserId: principal.userId,
          correlationId,
        });

        return {
          status: HttpStatus.CREATED,
          body: this.view(created) as unknown as Prisma.InputJsonValue,
        };
      },
    );
  }

  async update(
    principal: SessionPrincipal,
    id: string,
    input: Partial<VoucherInput> & { expectedVersion?: number },
    key: string,
    correlationId: string,
  ) {
    this.requireManage(principal);
    return this.idempotency.execute(
      {
        scope: `voucher-update:${id}`,
        key,
        payload: input,
        ttlMs: 86_400_000,
        leaseMs: 30_000,
      },
      async (tx) => {
        const voucher = await tx.voucher.findUnique({ where: { id } });
        if (!voucher) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

        const effectiveType: 'PERCENTAGE' | 'NOMINAL' =
          input.discountType !== undefined
            ? input.discountType === 'PERCENTAGE'
              ? 'PERCENTAGE'
              : 'NOMINAL'
            : isPercentageVoucherType(voucher.discountType)
              ? 'PERCENTAGE'
              : 'NOMINAL';
        const issues = voucherNumberIssues({
          discountType: effectiveType,
          discountValue:
            input.discountValue !== undefined
              ? Number(input.discountValue)
              : input.discountType !== undefined
                ? voucher.discountValue
                : undefined,
          minSpendRp:
            input.minimumPurchaseRp !== undefined ? Number(input.minimumPurchaseRp) : undefined,
          maxDiscountRp: input.maxDiscountRp ? Number(input.maxDiscountRp) : null,
          quota: input.totalUsageLimit !== undefined ? Number(input.totalUsageLimit) : undefined,
          validUntil: input.activeUntil ? new Date(input.activeUntil) : undefined,
        });
        if (issues.length)
          throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, issues);

        const updated = await tx.voucher.update({
          where: { id },
          data: {
            name: input.name !== undefined ? input.name.trim() : undefined,
            discountType:
              input.discountType !== undefined
                ? input.discountType === 'PERCENTAGE'
                  ? 'PERCENTAGE'
                  : 'NOMINAL'
                : undefined,
            discountValue:
              input.discountValue !== undefined ? Number(input.discountValue) : undefined,
            minSpendRp:
              input.minimumPurchaseRp !== undefined
                ? Number(input.minimumPurchaseRp)
                : undefined,
            maxDiscountRp:
              input.maxDiscountRp !== undefined
                ? input.maxDiscountRp
                  ? Number(input.maxDiscountRp)
                  : null
                : undefined,
            quota:
              input.totalUsageLimit !== undefined ? Number(input.totalUsageLimit) : undefined,
            validUntil:
              input.activeUntil !== undefined
                ? input.activeUntil
                  ? new Date(input.activeUntil)
                  : null
                : undefined,
          },
        });

        this.auditService.record({
          action: 'VOUCHER_UPDATED',
          resourceType: 'Voucher',
          resourceId: id,
          actorUserId: principal.userId,
          correlationId,
        });

        return {
          status: HttpStatus.OK,
          body: this.view(updated) as unknown as Prisma.InputJsonValue,
        };
      },
    );
  }

  async transition(
    principal: SessionPrincipal,
    id: string,
    status: VoucherStatus,
    body: { expectedVersion?: number; reason?: string },
    key: string,
    correlationId: string,
  ) {
    this.requireManage(principal);
    // Alasan opsional; bila diisi harus 3–500 karakter.
    const reason = optionalReason(body?.reason) ?? '';
    return this.idempotency.execute(
      {
        scope: `voucher-transition:${id}`,
        key,
        payload: { status, ...body },
        ttlMs: 86_400_000,
        leaseMs: 30_000,
      },
      async (tx) => {
        const voucher = await tx.voucher.findUnique({ where: { id } });
        if (!voucher) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

        // Jeda = sementara (`active=false`); Arsip = permanen dan tersembunyi (`archivedAt`).
        // Mengaktifkan kembali juga membuka arsip.
        const updated = await tx.voucher.update({
          where: { id },
          data:
            status === 'ARCHIVED'
              ? { active: false, archivedAt: voucher.archivedAt ?? new Date() }
              : status === 'ACTIVE'
                ? { active: true, archivedAt: null }
                : { active: false },
        });

        await this.auditService.catat(tx, {
          action: `VOUCHER_${status}`,
          objectType: 'Voucher',
          objectId: id,
          actorId: principal.userId,
          correlationId,
          reason: reason || null,
          beforeMasked: { active: voucher.active, archived: Boolean(voucher.archivedAt) },
          afterMasked: { active: updated.active, archived: Boolean(updated.archivedAt) },
        });

        return {
          status: HttpStatus.OK,
          body: this.view(updated) as unknown as Prisma.InputJsonValue,
        };
      },
    );
  }

  async redemptions(
    principal: SessionPrincipal,
    id: string,
    _cursor?: string,
    _rawLimit?: string,
  ) {
    this.requireRead(principal);
    const voucher = await this.db.voucher.findUnique({
      where: { id },
      include: {
        purchases: {
          include: {
            user: { select: { id: true, displayName: true } },
            package: { select: { id: true, name: true } },
            branch: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: PAGE_SIZE,
        },
      },
    });
    if (!voucher) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

    const items = (voucher.purchases ?? []).map((p: any) => ({
      id: p.id,
      customer: {
        id: p.user?.id ?? '',
        displayName: p.user?.displayName ?? 'Pelanggan',
      },
      purchase: {
        id: p.id,
        status: p.status,
        branch: { id: p.branch?.id ?? '', name: p.branch?.name ?? 'Unknown' },
        package: { name: p.package?.name ?? 'Unknown' },
      },
      discountRp: p.discountRp ?? 0,
      redeemedAt: p.createdAt,
      releasedAt: null,
    }));

    return {
      voucher: { id: voucher.id, code: voucher.code },
      items,
      page: { hasMore: false, nextCursor: null },
    };
  }

  async preview(
    principal: SessionPrincipal,
    input: { packageId: string; branchId: string; classTypeId?: string; code: string },
  ) {
    await this.access.requireVerifiedCustomer(principal);
    const pkg = await this.db.paket.findFirst({
      where: { id: input.packageId, status: 'ACTIVE' },
    });
    if (!pkg) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

    const code = normalizeVoucherCode(input.code);
    const now = new Date();
    const existing = await this.db.voucher.findFirst({
      where: { code },
    });

    const promoted = this.pricing.calculate(pkg.priceRp, await this.pricing.activePromotion(this.db, pkg.id));
    const baseRp = promoted.effectivePriceRp;

    const check = checkVoucherApplicability(existing, baseRp, now);
    if (!check.valid) {
      const codeMap: Record<VoucherApplicabilityIssue, string> = {
        NOT_FOUND: 'VOUCHER_INVALID',
        INACTIVE: 'VOUCHER_INACTIVE',
        EXPIRED: 'VOUCHER_EXPIRED',
        MINIMUM_SPEND_NOT_MET: 'VOUCHER_MINIMUM_NOT_MET',
        EXHAUSTED: 'VOUCHER_EXHAUSTED',
      };
      throw new ApiProblem(codeMap[check.issue], HttpStatus.UNPROCESSABLE_ENTITY);
    }

    const voucher = existing!;

    const discountRp = calculateVoucherDiscount({
      priceRp: baseRp,
      discountType: voucher.discountType,
      discountValue: voucher.discountValue,
      maxDiscountRp: voucher.maxDiscountRp,
    });

    const effectiveDiscountType = isPercentageVoucherType(voucher.discountType)
      ? 'PERCENTAGE'
      : 'FIXED_AMOUNT';

    return {
      valid: true,
      voucherId: voucher.id,
      code: voucher.code,
      name: voucher.name,
      discountType: effectiveDiscountType,
      discountValue: voucher.discountValue,
      discountRp,
      packagePriceRp: pkg.priceRp,
      packagePromotionDiscountRp: Math.max(0, pkg.priceRp - baseRp),
      promotionalPriceRp: baseRp,
      baseAmountRp: baseRp,
      finalPriceRp: baseRp - discountRp,
      priceAfterDiscountRp: baseRp - discountRp,
      packageId: pkg.id,
      voucher: this.view(voucher),
    };
  }
}
