import { HttpStatus, Injectable } from '@nestjs/common';
import { cabangPaket } from '../bookings/cabang-paket';
import {
  KODE_PEMBATALAN_TERLAMBAT,
  jalankanPembatalanTerlambat,
} from '../bookings/pembatalan-terlambat';
import { AdjustRequestStatus, Prisma, SessionMutationType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../foundation/audit.service';
import type { SessionPrincipal } from '../identity/identity.service';
import { PolicyService } from '../identity/policy.service';
import { ApiProblem, ENTITY_ID_REGEX } from '../identity/security';
import { buildPhoneSearchVariants } from '../identity/manajemen-pelanggan.service';

export const ADJUSTMENT_REASON_CODES = [
  'MIGRATION_CORRECTION',
  'ATTENDANCE_CORRECTION',
  'PACKAGE_COMPENSATION',
  'SUPPORT_RECONCILIATION',
] as const;
export const ADJUSTMENT_APPROVE_CODE = 'CORRECTION_VERIFIED';
export const ADJUSTMENT_REJECT_CODES = [
  'INVALID_EVIDENCE',
  'DUPLICATE_REQUEST',
  'OUT_OF_SCOPE',
] as const;
export const MAX_ADJUSTMENT_SESSIONS = 50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 20;
const SOON_DAYS = 14;

const packageInclude = {
  user: true,
  package: { include: { classType: true } },
  purchase: { include: { branch: true } },
  sharedMembers: {
    include: {
      user: {
        select: {
          id: true,
          displayName: true,
          email: true,
          phone: true,
          status: true,
        },
      },
    },
  },
} satisfies Prisma.PaketPelangganInclude;

const adjustmentInclude = {
  requestedBy: { select: { id: true, displayName: true } },
  approvedBy: { select: { id: true, displayName: true } },
  customerPackage: { include: packageInclude },
} satisfies Prisma.SessionAdjustRequestInclude;

type PackageRow = Prisma.PaketPelangganGetPayload<{ include: typeof packageInclude }>;
type AdjustmentRow = Prisma.SessionAdjustRequestGetPayload<{
  include: typeof adjustmentInclude;
}>;

const maskPhone = (phone?: string | null) => (phone ? `${phone.slice(0, 4)}****` : null);

const problem = (code: string, status: HttpStatus, field?: string) =>
  new ApiProblem(code, status, false, field ? [{ field, issue: code }] : []);

@Injectable()
export class LedgerService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Otorisasi & cakupan cabang. Cabang sebuah paket = cabang pembelian asalnya;
  // paket tanpa pembelian (mis. hasil migrasi) hanya terlihat oleh pemegang `branch:all`.
  // ---------------------------------------------------------------------------

  private packageScopeWhere(
    principal: SessionPrincipal,
    capability: string,
    requestedBranchId?: string,
  ): Prisma.PaketPelangganWhereInput {
    this.policy.requireCapability(principal.capabilities, capability);
    const scope = this.policy.capabilityBranchScope(principal, capability);
    if (!scope.all && scope.included.length === 0)
      throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
    if (requestedBranchId) {
      const allowed = scope.all
        ? !scope.excluded.includes(requestedBranchId)
        : scope.included.includes(requestedBranchId);
      if (!allowed) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
      return { purchase: { is: { branchId: requestedBranchId } } };
    }
    if (scope.all) {
      return scope.excluded.length > 0
        ? {
            OR: [
              { purchaseId: null },
              { purchase: { is: { branchId: { notIn: scope.excluded } } } },
            ],
          }
        : {};
    }
    return { purchase: { is: { branchId: { in: scope.included } } } };
  }

  private canAccessPackage(
    principal: SessionPrincipal,
    capability: string,
    branchId: string | null | undefined,
  ) {
    if (!principal.capabilities.includes(capability)) return false;
    return branchId
      ? this.policy.hasCapability(principal, capability, branchId)
      : this.policy.capabilityBranchScope(principal, capability).all;
  }

  private assertPackageAccess(principal: SessionPrincipal, capability: string, pkg: PackageRow) {
    if (!this.canAccessPackage(principal, capability, pkg.purchase?.branchId))
      throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
  }

  // ---------------------------------------------------------------------------
  // Saldo paket
  // ---------------------------------------------------------------------------

  async listCustomerPackages(
    principal: SessionPrincipal,
    filters: {
      branchId?: string;
      cursor?: string;
      page?: number;
      pageSize?: number;
      search?: string;
      status?: string;
      customerUserId?: string;
    },
  ) {
    const isCustomer = principal.roles.some((r) => r.role === 'CUSTOMER');
    if (isCustomer) {
      this.policy.requireCapability(principal.capabilities, 'ledger:read');
    }
    const scopeWhere: Prisma.PaketPelangganWhereInput = isCustomer
      ? filters.branchId
        ? { purchase: { is: { branchId: filters.branchId } } }
        : {}
      : this.packageScopeWhere(principal, 'ledger:read', filters.branchId);
    const search = filters.search?.trim();
    const targetUserId = isCustomer ? principal.userId : filters.customerUserId;
    const customerFilter: Prisma.PaketPelangganWhereInput = targetUserId
      ? {
          OR: [
            { userId: targetUserId },
            {
              package: { isShareable: true },
              sharedMembers: { some: { userId: targetUserId } },
            },
          ],
        }
      : {};

    const base: Prisma.PaketPelangganWhereInput = {
      AND: [
        scopeWhere,
        customerFilter,
        ...(search
          ? [
              {
                OR: [
                  { user: { displayName: { contains: search } } },
                  { user: { email: { contains: search } } },
                  ...buildPhoneSearchVariants(search).map((v) => ({ user: { phone: { contains: v } } })),
                  { package: { name: { contains: search } } },
                ],
              },
            ]
          : []),
      ],
    };
    const statusTokens = filters.status
      ? filters.status
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    const statusWhere: Prisma.PaketPelangganWhereInput | undefined =
      statusTokens.length > 0 && !statusTokens.includes('ALL')
        ? statusTokens.length === 1
          ? { status: statusTokens[0] as never }
          : { status: { in: statusTokens as never[] } }
        : undefined;

    const where: Prisma.PaketPelangganWhereInput = statusWhere
      ? { AND: [base, statusWhere] }
      : base;

    const limit = filters.pageSize ? Math.min(Number(filters.pageSize), 100) : PAGE_SIZE;
    const pageNumber = filters.page && Number(filters.page) > 0 ? Number(filters.page) : undefined;

    const [rows, totalFiltered] = await Promise.all([
      this.db.paketPelanggan.findMany({
        where,
        include: {
          ...packageInclude,
          bookings: { where: { status: 'BOOKED' }, select: { id: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: pageNumber ? limit : limit + 1,
        ...(pageNumber ? { skip: (pageNumber - 1) * limit } : (filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {})),
      }),
      typeof this.db.paketPelanggan.count === 'function'
        ? this.db.paketPelanggan.count({ where })
        : Promise.resolve(0),
    ]);
    const totalPages = Math.ceil(totalFiltered / limit) || 1;
    const hasMore = pageNumber ? pageNumber < totalPages : rows.length > limit;
    const pageRows = pageNumber ? rows : (rows.length > limit ? rows.slice(0, limit) : rows);

    const movements = pageRows.length
      ? await this.db.sessionLedger.groupBy({
          by: ['customerPackageId', 'type'],
          where: {
            customerPackageId: { in: pageRows.map((row) => row.id) },
            type: { in: ['ADJUST_MANUAL', 'REFUND_AUTOCANCEL'] },
          },
          _sum: { amount: true },
        })
      : [];
    const movementOf = (id: string, type: SessionMutationType) =>
      movements.find((m) => m.customerPackageId === id && m.type === type)?._sum.amount ?? 0;

    const items = pageRows.map((row) => {
      const reserved = row.bookings.length;
      return {
        ...this.balanceView(row, reserved),
        sessionCountSnapshot: row.totalSessions,
        usage: {
          initialSessions: row.totalSessions,
          usedSessions: row.usedSessions,
          reversedSessions: movementOf(row.id, 'REFUND_AUTOCANCEL'),
          adjustmentDelta: movementOf(row.id, 'ADJUST_MANUAL'),
        },
      };
    });

    return {
      items,
      total: totalFiltered,
      currentPage: pageNumber ?? 1,
      totalPages,
      pageSize: limit,
      summary: await this.packageSummary(base),
      page: filters.page != null
        ? {
            hasMore,
            nextCursor: hasMore ? (pageRows[pageRows.length - 1]?.id ?? null) : null,
            previousCursor: null,
            current: pageNumber ?? 1,
            total: totalFiltered,
            totalPages,
            pageSize: limit,
          }
        : {
            hasMore,
            nextCursor: hasMore ? (pageRows[pageRows.length - 1]?.id ?? null) : null,
            previousCursor: null,
          },
    };
  }

  private async packageSummary(base: Prisma.PaketPelangganWhereInput) {
    const soon = new Date(Date.now() + SOON_DAYS * 86_400_000);
    const [packageCount, activePackageCount, totals, reserved, deltas, expiringSoon] =
      await Promise.all([
        this.db.paketPelanggan.count({ where: base }),
        this.db.paketPelanggan.count({ where: { AND: [base, { status: 'ACTIVE' }] } }),
        this.db.paketPelanggan.aggregate({
          where: base,
          _sum: { remainingSessions: true, usedSessions: true },
        }),
        this.db.pemesananKelas.count({
          where: { status: 'BOOKED', customerPackage: { is: base } },
        }),
        this.db.sessionLedger.groupBy({
          by: ['type'],
          where: {
            type: { in: ['ADJUST_MANUAL', 'REFUND_AUTOCANCEL'] },
            customerPackage: { is: base },
          },
          _sum: { amount: true },
        }),
        this.db.paketPelanggan.count({
          where: {
            AND: [base, { status: 'ACTIVE' }, { validUntil: { gte: new Date(), lte: soon } }],
          },
        }),
      ]);
    const ledgerBalance = totals._sum.remainingSessions ?? 0;
    return {
      packageCount,
      activePackageCount,
      ledgerBalance,
      reserved,
      available: Math.max(0, ledgerBalance - reserved),
      usedSessions: totals._sum.usedSessions ?? 0,
      reversedSessions: deltas.find((d) => d.type === 'REFUND_AUTOCANCEL')?._sum.amount ?? 0,
      adjustmentDelta: deltas.find((d) => d.type === 'ADJUST_MANUAL')?._sum.amount ?? 0,
      expiringSoon,
    };
  }

  private balanceView(row: PackageRow, reserved: number) {
    const ledgerBalance = row.remainingSessions;
    const isMulti = Boolean((row.package as any)?.isMultiBranch);
    const packageBranchId = isMulti
      ? null
      : (row.package?.branchId ?? row.purchase?.branchId ?? null);
    return {
      id: row.id,
      branchId: isMulti ? 'global' : (row.purchase?.branchId ?? 'global'),
      status: row.status,
      activationDate: row.validFrom.toISOString(),
      expiryAt: row.validUntil.toISOString(),
      ledgerBalance,
      reserved,
      available: row.status === 'FROZEN' ? 0 : Math.max(0, ledgerBalance - reserved),
      packageName: row.package?.name ?? 'Paket',
      branchName: isMulti ? 'Semua Cabang (Multi-Branch)' : (row.purchase?.branch?.name ?? 'Semua cabang'),
      classTypeName: row.package?.classType?.name ?? 'Pilates',
      classTypeId: row.package?.classTypeId ?? null,
      packageBranchId,
      /** Semua cabang tempat paket ini boleh dipakai: cabang paket dan cabang pembelian. */
      allowedBranchIds: cabangPaket(row as never),
      isMultiBranch: isMulti,
      customer: {
        id: row.user.id,
        displayName: row.user.displayName,
        phoneMasked: maskPhone(row.user.phone),
      },
      customerUserId: row.userId,
      isShareable: Boolean((row.package as any)?.isShareable),
      sharedWithUserIds: ((row as any).sharedMembers ?? []).map((m: any) => m.userId),
      sharedMembers: ((row as any).sharedMembers ?? []).map((m: any) => ({
        id: m.id,
        userId: m.userId,
        relationship: m.relationship,
        displayName: m.user?.displayName,
        phoneMasked: maskPhone(m.user?.phone),
        createdAt: m.createdAt,
      })),
    };
  }

  async getPackageLedger(principal: SessionPrincipal, id: string, cursor?: string) {
    if (!UUID.test(id)) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const pkg = await this.db.paketPelanggan.findUnique({
      where: { id },
      include: {
        ...packageInclude,
        bookings: {
          where: { status: 'BOOKED' },
          include: { classSlot: { include: { classType: true, branch: true } } },
          orderBy: { bookedAt: 'desc' },
        },
      },
    });
    if (!pkg) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    // Pemilik paket boleh melihat saldonya sendiri; selain itu wajib hak staf + cakupan cabang.
    if (pkg.userId !== principal.userId) this.assertPackageAccess(principal, 'ledger:read', pkg);

    const rows = await this.db.sessionLedger.findMany({
      where: { customerPackageId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > PAGE_SIZE;
    const pageRows = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

    return {
      balance: this.balanceView(pkg, pkg.bookings.length),
      reservations: {
        activeQuantity: pkg.bookings.length,
        items: pkg.bookings.map((booking) => ({
          id: booking.id,
          quantity: 1,
          createdAt: booking.bookedAt.toISOString(),
          bookingId: booking.id,
          bookingStatus: booking.status,
          className: booking.classSlot?.classType?.name ?? 'Kelas',
          branchName: booking.classSlot?.branch?.name ?? null,
          startsAt: booking.classSlot?.startAt.toISOString() ?? null,
        })),
      },
      entries: pageRows.map((entry) => this.ledgerEntryView(entry)),
      page: {
        hasMore,
        nextCursor: hasMore ? (pageRows[pageRows.length - 1]?.id ?? null) : null,
        previousCursor: null,
      },
    };
  }

  private ledgerEntryView(entry: {
    id: string;
    customerPackageId: string;
    type: SessionMutationType;
    amount: number;
    balanceAfter: number;
    referenceId: string | null;
    notes: string | null;
    createdAt: Date;
  }) {
    const isBooking = entry.type === 'ATTEND' || entry.type === 'REFUND_AUTOCANCEL';
    return {
      id: entry.id,
      customerPackageId: entry.customerPackageId,
      type: entry.type === 'REFUND_AUTOCANCEL' ? 'REVERSAL' : entry.type,
      quantity: entry.amount,
      occurredAt: entry.createdAt.toISOString(),
      referenceType: isBooking
        ? 'BOOKING'
        : entry.type === 'ADJUST_MANUAL'
          ? 'ADJUSTMENT'
          : 'PURCHASE',
      referenceId: entry.referenceId ?? entry.id,
      referenceLabel: entry.notes,
      bookingId: isBooking ? entry.referenceId : null,
      balanceAfter: entry.balanceAfter,
      reason: entry.notes,
    };
  }

  // ---------------------------------------------------------------------------
  // Penyesuaian sesi (dua langkah: ajukan lalu putuskan oleh orang lain)
  // ---------------------------------------------------------------------------

  private adjustmentScopeWhere(
    principal: SessionPrincipal,
    branchId?: string,
  ): Prisma.SessionAdjustRequestWhereInput {
    const packageWhere = this.packageScopeWhere(principal, 'ledger:adjust:read', branchId);
    return { customerPackage: { is: packageWhere } };
  }

  async listAdjustments(
    principal: SessionPrincipal,
    filters: {
      branchId?: string;
      status?: string;
      cursor?: string;
      page?: number;
      pageSize?: number;
      q?: string;
      customerUserId?: string;
      from?: string;
      until?: string;
      limit?: string | number;
    },
  ) {
    const limit = Math.min(100, Math.max(1, Number(filters.pageSize ?? filters.limit) || PAGE_SIZE));
    const pageNumber = filters.page && Number(filters.page) > 0 ? Number(filters.page) : undefined;
    const q = filters.q?.trim();
    const from = filters.from ? new Date(filters.from) : undefined;
    const until = filters.until ? new Date(filters.until) : undefined;
    if ((from && Number.isNaN(from.getTime())) || (until && Number.isNaN(until.getTime())))
      throw problem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST, 'from');

    const base: Prisma.SessionAdjustRequestWhereInput = {
      AND: [
        this.adjustmentScopeWhere(principal, filters.branchId),
        ...(filters.customerUserId
          ? [{ customerPackage: { is: { userId: filters.customerUserId } } }]
          : []),
        ...(q
          ? [
              {
                OR: [
                  { reasonCode: { contains: q } },
                  { customerPackage: { is: { user: { displayName: { contains: q } } } } },
                  { customerPackage: { is: { user: { email: { contains: q } } } } },
                  { customerPackage: { is: { package: { name: { contains: q } } } } },
                ],
              },
            ]
          : []),
        ...(from || until
          ? [{ createdAt: { ...(from ? { gte: from } : {}), ...(until ? { lte: until } : {}) } }]
          : []),
      ],
    };
    const statusFilter = this.statusFilter(filters.status);
    const where: Prisma.SessionAdjustRequestWhereInput = statusFilter
      ? { AND: [base, { status: statusFilter }] }
      : base;

    const [rows, totalFiltered, counts] = await Promise.all([
      this.db.sessionAdjustRequest.findMany({
        where,
        include: adjustmentInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: pageNumber ? limit : limit + 1,
        ...(pageNumber ? { skip: (pageNumber - 1) * limit } : (filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {})),
      }),
      typeof this.db.sessionAdjustRequest.count === 'function'
        ? this.db.sessionAdjustRequest.count({ where })
        : Promise.resolve(0),
      this.db.sessionAdjustRequest.groupBy({
        by: ['status'],
        where: base,
        _count: { _all: true },
      }),
    ]);
    const totalPages = Math.ceil(totalFiltered / limit) || 1;
    const hasMore = pageNumber ? pageNumber < totalPages : rows.length > limit;
    const pageRows = pageNumber ? rows : (rows.length > limit ? rows.slice(0, limit) : rows);
    const countOf = (status: AdjustRequestStatus) =>
      counts.find((c) => c.status === status)?._count._all ?? 0;

    const reservedByPackage = await this.reservedByPackage(
      pageRows.map((row) => row.customerPackageId),
    );

    return {
      items: pageRows.map((row) =>
        this.adjustmentView(row, reservedByPackage.get(row.customerPackageId) ?? 0),
      ),
      total: totalFiltered,
      currentPage: pageNumber ?? 1,
      totalPages,
      pageSize: limit,
      summary: {
        total: counts.reduce((sum, c) => sum + c._count._all, 0),
        pending: countOf('PENDING'),
        posted: countOf('APPROVED'),
        rejected: countOf('REJECTED'),
      },
      page: filters.page != null
        ? {
            hasMore,
            nextCursor: hasMore ? (pageRows[pageRows.length - 1]?.id ?? null) : null,
            previousCursor: null,
            current: pageNumber ?? 1,
            total: totalFiltered,
            totalPages,
            pageSize: limit,
          }
        : {
            hasMore,
            nextCursor: hasMore ? (pageRows[pageRows.length - 1]?.id ?? null) : null,
            previousCursor: null,
          },
    };
  }

  private statusFilter(status?: string): AdjustRequestStatus | { in: AdjustRequestStatus[] } | undefined {
    switch (status) {
      case 'PENDING':
        return 'PENDING';
      case 'POSTED':
      case 'APPROVED':
        return 'APPROVED';
      case 'REJECTED':
        return 'REJECTED';
      case 'HISTORY':
        return { in: ['APPROVED', 'REJECTED'] };
      default:
        return undefined;
    }
  }

  private async reservedByPackage(packageIds: string[]) {
    const result = new Map<string, number>();
    if (packageIds.length === 0) return result;
    const grouped = await this.db.pemesananKelas.groupBy({
      by: ['customerPackageId'],
      where: { customerPackageId: { in: packageIds }, status: 'BOOKED' },
      _count: { _all: true },
    });
    for (const g of grouped) {
      if (g.customerPackageId) result.set(g.customerPackageId, g._count._all);
    }
    return result;
  }

  async getAdjustment(principal: SessionPrincipal, id: string) {
    this.policy.requireCapability(principal.capabilities, 'ledger:adjust:read');
    if (!UUID.test(id)) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const row = await this.db.sessionAdjustRequest.findUnique({
      where: { id },
      include: adjustmentInclude,
    });
    if (!row) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    this.assertPackageAccess(principal, 'ledger:adjust:read', row.customerPackage);
    const reserved = (await this.reservedByPackage([row.customerPackageId])).get(
      row.customerPackageId,
    );
    return this.adjustmentView(row, reserved ?? 0);
  }

  async requestAdjustment(
    principal: SessionPrincipal,
    body: {
      customerPackageId?: string;
      quantity?: number;
      reasonCode?: string;
      note?: string;
      direct?: boolean;
    },
  ) {
    if (body?.direct === true) {
      return this.directAdjustment(principal, body);
    }
    this.policy.requireCapability(principal.capabilities, 'ledger:adjust:request');
    const quantity = body?.quantity;
    if (!body?.customerPackageId || !UUID.test(body.customerPackageId))
      throw problem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, 'customerPackageId');
    if (
      typeof quantity !== 'number' ||
      !Number.isInteger(quantity) ||
      quantity === 0 ||
      Math.abs(quantity) > MAX_ADJUSTMENT_SESSIONS
    )
      throw problem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, 'quantity');
    const reasonCode = body.reasonCode as (typeof ADJUSTMENT_REASON_CODES)[number];
    if (!ADJUSTMENT_REASON_CODES.includes(reasonCode))
      throw problem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, 'reasonCode');

    const created = await this.db.$transaction(
      async (tx) => {
        const pkg = await tx.paketPelanggan.findUnique({
          where: { id: body.customerPackageId },
          include: packageInclude,
        });
        if (!pkg) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
        this.assertPackageAccess(principal, 'ledger:adjust:request', pkg);

        const reserved = await tx.pemesananKelas.count({
          where: { customerPackageId: pkg.id, status: 'BOOKED' },
        });
        this.assertBalanceAllows(pkg.remainingSessions, reserved, quantity);

        const pending = await tx.sessionAdjustRequest.count({
          where: { customerPackageId: pkg.id, status: 'PENDING' },
        });
        if (pending > 0) throw problem('ADJUSTMENT_ALREADY_PENDING', HttpStatus.CONFLICT);

        return tx.sessionAdjustRequest.create({
          data: {
            customerPackageId: pkg.id,
            requestedById: principal.userId,
            sessionCount: quantity,
            reason: reasonCode,
            reasonCode,
          },
          include: adjustmentInclude,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    await this.audit.catat(null, {
      actorId: principal.userId,
      branchId: created.customerPackage.purchase?.branchId ?? null,
      action: 'SESSION_ADJUSTMENT_REQUESTED',
      objectType: 'SessionAdjustRequest',
      objectId: created.id,
      afterMasked: { quantity, reasonCode, customerPackageId: created.customerPackageId },
    });
    const reserved = (await this.reservedByPackage([created.customerPackageId])).get(
      created.customerPackageId,
    );
    return this.adjustmentView(created, reserved ?? 0);
  }

  /**
   * Eksekusi langsung penyesuaian sesi (Direct Adjustment 1-Klik) khusus bagi
   * peran yang memiliki kapabilitas 'ledger:adjust:decide' (Manager Cabang, Super Owner, Superadmin).
   * Langsung memutasi saldo buku besar (SessionLedger) dan menyimpan riwayat audit trail tanpa status PENDING.
   */
  async directAdjustment(
    principal: SessionPrincipal,
    body: {
      customerPackageId?: string;
      quantity?: number;
      reasonCode?: string;
      note?: string;
      /** Booking yang dikoreksi, mis. sesi hangus karena kesalahan studio. */
      bookingId?: string;
      /** Id penyesuaian yang sudah ditentukan pemanggil, agar bukti bisa disimpan lebih dulu. */
      id?: string;
    },
  ) {
    this.policy.requireCapability(principal.capabilities, 'ledger:adjust:decide');
    const quantity = body?.quantity;
    if (!body?.customerPackageId || !UUID.test(body.customerPackageId))
      throw problem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, 'customerPackageId');
    if (
      typeof quantity !== 'number' ||
      !Number.isInteger(quantity) ||
      quantity === 0 ||
      Math.abs(quantity) > MAX_ADJUSTMENT_SESSIONS
    )
      throw problem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, 'quantity');
    const reasonCode = body.reasonCode as (typeof ADJUSTMENT_REASON_CODES)[number];
    if (!ADJUSTMENT_REASON_CODES.includes(reasonCode))
      throw problem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, 'reasonCode');
    const note = body.note?.trim() ? body.note.trim().slice(0, 500) : null;

    const outcome = await this.db.$transaction(
      async (tx) => {
        const pkg = await tx.paketPelanggan.findUnique({
          where: { id: body.customerPackageId },
          include: packageInclude,
        });
        if (!pkg) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
        this.assertPackageAccess(principal, 'ledger:adjust:decide', pkg);

        const reserved = await tx.pemesananKelas.count({
          where: { customerPackageId: pkg.id, status: 'BOOKED' },
        });
        this.assertBalanceAllows(pkg.remainingSessions, reserved, quantity);

        const pending = await tx.sessionAdjustRequest.count({
          where: { customerPackageId: pkg.id, status: 'PENDING' },
        });
        if (pending > 0) throw problem('ADJUSTMENT_ALREADY_PENDING', HttpStatus.CONFLICT);

        if (body.bookingId) {
          const booking = await tx.pemesananKelas.findUnique({
            where: { id: body.bookingId },
            select: { customerPackageId: true },
          });
          // Booking harus memakai paket yang sama; kalau tidak, koreksinya salah alamat.
          if (!booking || booking.customerPackageId !== pkg.id)
            throw problem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, 'bookingId');
        }

        const now = new Date();
        const balanceAfter = pkg.remainingSessions + quantity;
        const nextStatus =
          balanceAfter <= 0 && pkg.status === 'ACTIVE'
            ? 'DEPLETED'
            : balanceAfter > 0 && pkg.status === 'DEPLETED' && pkg.validUntil > now
              ? 'ACTIVE'
              : pkg.status;

        await tx.paketPelanggan.update({
          where: { id: pkg.id },
          data: { remainingSessions: balanceAfter, status: nextStatus },
        });

        const request = await tx.sessionAdjustRequest.create({
          data: {
            ...(body.id ? { id: body.id } : {}),
            customerPackageId: pkg.id,
            bookingId: body.bookingId ?? null,
            requestedById: principal.userId,
            approvedById: principal.userId,
            sessionCount: quantity,
            reason: reasonCode,
            reasonCode,
            decisionCode: ADJUSTMENT_APPROVE_CODE,
            decisionNote: note,
            decisionReason: note ?? reasonCode,
            decidedAt: now,
            status: 'APPROVED',
            version: 2,
          },
          include: adjustmentInclude,
        });

        const entry = await tx.sessionLedger.create({
          data: {
            customerPackageId: pkg.id,
            type: SessionMutationType.ADJUST_MANUAL,
            amount: quantity,
            balanceAfter,
            referenceId: request.id,
            notes: `Penyesuaian manual langsung (${reasonCode})${note ? `: ${note}` : ''}`,
            createdById: principal.userId,
          },
        });

        return { request, entry, balanceAfter };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    await this.audit.catat(null, {
      actorId: principal.userId,
      branchId: outcome.request.customerPackage.purchase?.branchId ?? null,
      action: 'SESSION_ADJUSTMENT_DIRECT_APPLIED',
      objectType: 'SessionAdjustRequest',
      objectId: outcome.request.id,
      afterMasked: {
        quantity,
        reasonCode,
        balanceAfter: outcome.balanceAfter,
        customerPackageId: outcome.request.customerPackageId,
      },
    });

    const reserved = (await this.reservedByPackage([outcome.request.customerPackageId])).get(
      outcome.request.customerPackageId,
    );
    return {
      adjustment: this.adjustmentView(outcome.request, reserved ?? 0),
      ledgerEntry: this.ledgerEntryView(outcome.entry),
      resultingBalance: outcome.balanceAfter,
      auditReference: outcome.request.id,
    };
  }

  async decideAdjustment(
    principal: SessionPrincipal,
    id: string,
    decision: string | undefined,
    body: { reasonCode?: string; note?: string; expectedVersion?: number },
  ) {
    this.policy.requireCapability(principal.capabilities, 'ledger:adjust:decide');
    if (decision !== 'approve' && decision !== 'reject')
      throw problem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST, 'decision');
    if (!UUID.test(id)) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const code = body?.reasonCode ?? '';
    const validCode =
      decision === 'approve'
        ? code === ADJUSTMENT_APPROVE_CODE
        : (ADJUSTMENT_REJECT_CODES as readonly string[]).includes(code);
    if (!validCode) throw problem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, 'reasonCode');
    if (!Number.isInteger(body?.expectedVersion))
      throw problem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, 'expectedVersion');
    const note = body.note?.trim() ? body.note.trim().slice(0, 500) : null;

    const outcome = await this.db.$transaction(
      async (tx) => {
        const row = await tx.sessionAdjustRequest.findUnique({
          where: { id },
          include: adjustmentInclude,
        });
        if (!row) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
        this.assertPackageAccess(principal, 'ledger:adjust:decide', row.customerPackage);
        // Pemisahan tugas: staf kasir dan manajer cabang dilarang memutus permintaannya sendiri (Maker-Checker).
        // Hanya Super Owner dan Superadmin yang memiliki wewenang persetujuan mandiri.
        const canSelfApprove = principal.roles.some((r) =>
          r.role === 'SUPER_OWNER',
        );
        if (!canSelfApprove && row.requestedById === principal.userId)
          throw problem('SEPARATION_OF_DUTIES', HttpStatus.FORBIDDEN);
        if (row.status !== 'PENDING') throw problem('ADJUSTMENT_ALREADY_DECIDED', HttpStatus.CONFLICT);
        if (row.version !== body.expectedVersion)
          throw problem('ADJUSTMENT_VERSION_CONFLICT', HttpStatus.CONFLICT);

        const now = new Date();
        const claimed = await tx.sessionAdjustRequest.updateMany({
          where: { id, status: 'PENDING', version: row.version },
          data: {
            status: decision === 'approve' ? 'APPROVED' : 'REJECTED',
            approvedById: principal.userId,
            decisionCode: code,
            decisionNote: note,
            decisionReason: note ?? code,
            decidedAt: now,
            version: { increment: 1 },
          },
        });
        if (claimed.count !== 1) throw problem('ADJUSTMENT_VERSION_CONFLICT', HttpStatus.CONFLICT);

        let ledgerEntry: ReturnType<LedgerService['ledgerEntryView']> | null = null;
        let resultingBalance: number | null = null;
        if (decision === 'approve' && row.reasonCode === KODE_PEMBATALAN_TERLAMBAT) {
          // Pembatalan H-24 dari timetable: booking dibatalkan dan sesinya dikembalikan bila terpotong.
          resultingBalance = (await jalankanPembatalanTerlambat(tx, row, principal.userId, now))
            .resultingBalance;
        } else if (decision === 'approve') {
          const pkg = await tx.paketPelanggan.findUniqueOrThrow({
            where: { id: row.customerPackageId },
          });
          const reserved = await tx.pemesananKelas.count({
            where: { customerPackageId: pkg.id, status: 'BOOKED' },
          });
          this.assertBalanceAllows(pkg.remainingSessions, reserved, row.sessionCount);

          const balanceAfter = pkg.remainingSessions + row.sessionCount;
          const nextStatus =
            balanceAfter <= 0 && pkg.status === 'ACTIVE'
              ? 'DEPLETED'
              : balanceAfter > 0 && pkg.status === 'DEPLETED' && pkg.validUntil > now
                ? 'ACTIVE'
                : pkg.status;
          await tx.paketPelanggan.update({
            where: { id: pkg.id },
            data: { remainingSessions: balanceAfter, status: nextStatus },
          });
          const entry = await tx.sessionLedger.create({
            data: {
              customerPackageId: pkg.id,
              type: SessionMutationType.ADJUST_MANUAL,
              amount: row.sessionCount,
              balanceAfter,
              referenceId: row.id,
              notes: `Penyesuaian manual (${row.reasonCode ?? row.reason})${note ? `: ${note}` : ''}`,
              createdById: principal.userId,
            },
          });
          ledgerEntry = this.ledgerEntryView(entry);
          resultingBalance = balanceAfter;
        }

        const updated = await tx.sessionAdjustRequest.findUniqueOrThrow({
          where: { id },
          include: adjustmentInclude,
        });
        return { updated, ledgerEntry, resultingBalance };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    await this.audit.catat(null, {
      actorId: principal.userId,
      branchId: outcome.updated.customerPackage.purchase?.branchId ?? null,
      action: decision === 'approve' ? 'SESSION_ADJUSTMENT_APPROVED' : 'SESSION_ADJUSTMENT_REJECTED',
      objectType: 'SessionAdjustRequest',
      objectId: id,
      afterMasked: { decisionCode: code, resultingBalance: outcome.resultingBalance },
    });
    const reserved = (await this.reservedByPackage([outcome.updated.customerPackageId])).get(
      outcome.updated.customerPackageId,
    );
    return {
      adjustment: this.adjustmentView(outcome.updated, reserved ?? 0),
      ledgerEntry: outcome.ledgerEntry,
      resultingBalance: outcome.resultingBalance,
      auditReference: null,
      idempotentReplay: false,
    };
  }

  // ---------------------------------------------------------------------------
  // Aksi staf pada paket pelanggan: perpanjang masa berlaku, bekukan, buka kembali.
  // Tidak mengubah saldo sesi; tiap aksi meninggalkan entri buku sesi berjumlah 0 sebagai jejak.
  // ---------------------------------------------------------------------------

  async manageCustomerPackage(
    principal: SessionPrincipal,
    id: string,
    action: string | undefined,
    body: { days?: number; reason?: string; expectedValidUntil?: string },
  ) {
    this.policy.requireCapability(principal.capabilities, 'customer-package:manage');
    if (action !== 'extend' && action !== 'freeze' && action !== 'unfreeze')
      throw problem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST, 'action');
    if (!UUID.test(id)) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 3 || reason.length > 500)
      throw problem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, 'reason');
    const days = body?.days;
    if (action === 'extend' && (!Number.isInteger(days) || days! < 1 || days! > 180))
      throw problem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, 'days');
    let expectedValidUntil: number | undefined;
    if (body?.expectedValidUntil !== undefined) {
      expectedValidUntil = new Date(body.expectedValidUntil).getTime();
      if (!Number.isFinite(expectedValidUntil))
        throw problem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, 'expectedValidUntil');
    }

    const outcome = await this.db.$transaction(
      async (tx) => {
        const pkg = await tx.paketPelanggan.findUnique({ where: { id }, include: packageInclude });
        if (!pkg) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
        this.assertPackageAccess(principal, 'customer-package:manage', pkg);
        if (expectedValidUntil !== undefined && pkg.validUntil.getTime() !== expectedValidUntil)
          throw problem('PACKAGE_CHANGED', HttpStatus.CONFLICT);

        const now = new Date();
        const DAY = 86_400_000;
        let data: Prisma.PaketPelangganUpdateManyMutationInput;
        let note: string;

        if (action === 'extend') {
          if (pkg.status === 'FROZEN') throw problem('PACKAGE_FROZEN', HttpStatus.CONFLICT);
          if (pkg.remainingSessions <= 0)
            throw problem('NO_REMAINING_SESSIONS', HttpStatus.CONFLICT);
          const from = Math.max(pkg.validUntil.getTime(), now.getTime());
          data = { validUntil: new Date(from + days! * DAY), status: 'ACTIVE' };
          note = `Perpanjang masa berlaku ${days} hari`;
        } else if (action === 'freeze') {
          if (pkg.status !== 'ACTIVE' || pkg.validUntil <= now)
            throw problem('PACKAGE_NOT_ACTIVE', HttpStatus.CONFLICT);
          const upcoming = await tx.pemesananKelas.count({
            where: {
              customerPackageId: id,
              status: 'BOOKED',
              classSlot: { is: { startAt: { gte: now } } },
            },
          });
          if (upcoming > 0) throw problem('HAS_UPCOMING_BOOKINGS', HttpStatus.CONFLICT);
          data = { status: 'FROZEN', frozenAt: now };
          note = 'Paket dibekukan';
        } else {
          if (pkg.status !== 'FROZEN') throw problem('PACKAGE_NOT_FROZEN', HttpStatus.CONFLICT);
          const frozenMs = pkg.frozenAt ? Math.max(0, now.getTime() - pkg.frozenAt.getTime()) : 0;
          data = {
            status: pkg.remainingSessions > 0 ? 'ACTIVE' : 'DEPLETED',
            validUntil: new Date(pkg.validUntil.getTime() + frozenMs),
            frozenAt: null,
          };
          note = `Paket dibuka kembali; masa berlaku bertambah ${Math.floor(frozenMs / DAY)} hari selama dibekukan`;
        }

        const claimed = await tx.paketPelanggan.updateMany({
          where: {
            id,
            status: pkg.status,
            validUntil: pkg.validUntil,
            remainingSessions: pkg.remainingSessions,
          },
          data,
        });
        if (claimed.count !== 1) throw problem('PACKAGE_CHANGED', HttpStatus.CONFLICT);

        const entry = await tx.sessionLedger.create({
          data: {
            customerPackageId: id,
            type: SessionMutationType.ADJUST_MANUAL,
            amount: 0,
            balanceAfter: pkg.remainingSessions,
            referenceId: id,
            notes: `${note}: ${reason}`.slice(0, 255),
            createdById: principal.userId,
          },
        });
        const updated = await tx.paketPelanggan.findUniqueOrThrow({
          where: { id },
          include: packageInclude,
        });
        return { updated, entry, previousStatus: pkg.status };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    await this.audit.catat(null, {
      actorId: principal.userId,
      branchId: outcome.updated.purchase?.branchId ?? null,
      action: `CUSTOMER_PACKAGE_${action.toUpperCase()}`,
      objectType: 'PaketPelanggan',
      objectId: id,
      afterMasked: {
        previousStatus: outcome.previousStatus,
        status: outcome.updated.status,
        validUntil: outcome.updated.validUntil.toISOString(),
      },
    });
    const reserved = (await this.reservedByPackage([id])).get(id) ?? 0;
    return {
      balance: this.balanceView(outcome.updated, reserved),
      ledgerEntry: this.ledgerEntryView(outcome.entry),
    };
  }

  /** Pengurangan tidak boleh membuat saldo negatif atau lebih kecil dari sesi yang sudah dipesan. */
  private assertBalanceAllows(balance: number, reserved: number, delta: number) {
    if (delta < 0 && (balance + delta < 0 || balance + delta < reserved))
      throw problem('INSUFFICIENT_SESSION_BALANCE', HttpStatus.CONFLICT, 'quantity');
  }

  private adjustmentView(row: AdjustmentRow, reserved: number) {
    const pkg = row.customerPackage;
    const balance = pkg.remainingSessions;
    const projected = balance + row.sessionCount;
    const decided = row.status !== 'PENDING';
    const insufficient = row.sessionCount < 0 && (projected < 0 || projected < reserved);
    return {
      id: row.id,
      customerPackageId: row.customerPackageId,
      quantity: row.sessionCount,
      reasonCode: row.reasonCode ?? 'SUPPORT_RECONCILIATION',
      requestedById: row.requestedById,
      requestedBy: row.requestedBy,
      decidedById: row.approvedById,
      decidedBy: row.approvedBy,
      decisionCode: row.decisionCode,
      decisionNote: row.decisionNote,
      status: row.status === 'APPROVED' ? 'POSTED' : row.status,
      ledgerBalanceAtRequest: null,
      reservedAtRequest: null,
      customer: {
        id: pkg.user.id,
        displayName: pkg.user.displayName,
        phoneMasked: maskPhone(pkg.user.phone),
      },
      branch: pkg.purchase?.branch
        ? { id: pkg.purchase.branch.id, name: pkg.purchase.branch.name }
        : { id: 'global', name: 'Semua cabang' },
      package: { id: pkg.package.id, name: pkg.package.name },
      classType: pkg.package.classType
        ? { id: pkg.package.classType.id, name: pkg.package.classType.name }
        : undefined,
      currentBalance: balance,
      currentReserved: reserved,
      currentAvailable: Math.max(0, balance - reserved),
      projectedLedgerBalance: projected,
      projectedAvailable: projected - reserved,
      eligibleForApproval: !decided && !insufficient,
      eligibilityReason: !decided && insufficient ? 'INSUFFICIENT_SESSION_BALANCE' : null,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() ?? null,
    };
  }

  // ---------------------------------------------------------------------------
  // Manajemen Anggota Paket Bersama (Family / Duet / Shared Package)
  // ---------------------------------------------------------------------------

  private canManagePackageMembers(principal: SessionPrincipal, pkg: PackageRow): boolean {
    if (pkg.userId === principal.userId) return true;
    const staffCapabilities = ['customer-package:manage', 'booking:create:assisted', 'master:manage'];
    const hasCapability = staffCapabilities.some((cap) =>
      principal.capabilities.includes(cap as any),
    );
    if (!hasCapability) return false;
    this.assertPackageAccess(principal, 'customer-package:manage', pkg);
    return true;
  }

  async listPackageMembers(principal: SessionPrincipal, customerPackageId: string) {
    if (!UUID.test(customerPackageId)) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const pkg = await this.db.paketPelanggan.findUnique({
      where: { id: customerPackageId },
      include: packageInclude,
    });
    if (!pkg) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

    const isOwner = pkg.userId === principal.userId;
    const isSharedMember = pkg.sharedMembers.some((sm) => sm.userId === principal.userId);
    const isStaff = this.canManagePackageMembers(principal, pkg);

    if (!isOwner && !isSharedMember && !isStaff) {
      throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    return {
      customerPackageId: pkg.id,
      package: {
        id: pkg.package.id,
        name: pkg.package.name,
        isShareable: Boolean(pkg.package.isShareable),
      },
      owner: {
        id: pkg.user.id,
        displayName: pkg.user.displayName,
        phoneMasked: maskPhone(pkg.user.phone),
      },
      remainingSessions: pkg.remainingSessions,
      status: pkg.status,
      members: pkg.sharedMembers.map((m) => ({
        id: m.id,
        userId: m.userId,
        relationship: m.relationship,
        displayName: m.user?.displayName,
        phoneMasked: maskPhone(m.user?.phone),
        email: m.user?.email,
        addedById: m.addedById,
        addedByRole: m.addedByRole,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  async addPackageMember(
    principal: SessionPrincipal,
    customerPackageId: string,
    body: { userId: string; relationship?: string },
  ) {
    if (!UUID.test(customerPackageId) || !UUID.test(body?.userId)) {
      throw problem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST, 'userId');
    }

    const pkg = await this.db.paketPelanggan.findUnique({
      where: { id: customerPackageId },
      include: packageInclude,
    });
    if (!pkg) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

    if (!this.canManagePackageMembers(principal, pkg)) {
      throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
    }

    if (!pkg.package.isShareable) {
      throw problem('PACKAGE_NOT_SHAREABLE', HttpStatus.BAD_REQUEST, 'package');
    }

    if (pkg.status !== 'ACTIVE') {
      throw problem('PACKAGE_NOT_ACTIVE', HttpStatus.BAD_REQUEST, 'package');
    }

    if (body.userId === pkg.userId) {
      throw problem('CANNOT_ADD_OWNER_AS_MEMBER', HttpStatus.BAD_REQUEST, 'userId');
    }

    const targetUser = await this.db.user.findUnique({
      where: { id: body.userId },
      select: { id: true, displayName: true, email: true, phone: true, status: true },
    });
    if (!targetUser || targetUser.status !== 'ACTIVE') {
      throw problem('USER_NOT_FOUND', HttpStatus.NOT_FOUND, 'userId');
    }

    if (pkg.sharedMembers.some((sm) => sm.userId === body.userId)) {
      throw problem('MEMBER_ALREADY_ADDED', HttpStatus.CONFLICT, 'userId');
    }

    const isAdmin = principal.userId !== pkg.userId;
    const relationship = (body.relationship || 'FAMILY').trim().toUpperCase();

    const created = await this.db.paketPelangganAnggota.create({
      data: {
        customerPackageId,
        userId: body.userId,
        relationship,
        addedById: principal.userId,
        addedByRole: isAdmin ? 'ADMIN' : 'CUSTOMER',
      },
      include: {
        user: { select: { id: true, displayName: true, email: true, phone: true } },
      },
    });

    await this.audit.catat(null, {
      actorId: principal.userId,
      branchId: pkg.purchase?.branchId ?? null,
      action: 'CUSTOMER_PACKAGE_MEMBER_ADDED',
      objectType: 'PaketPelangganAnggota',
      objectId: created.id,
      afterMasked: {
        customerPackageId,
        memberUserId: body.userId,
        relationship,
        addedByRole: isAdmin ? 'ADMIN' : 'CUSTOMER',
      },
    });

    return {
      id: created.id,
      customerPackageId,
      userId: created.userId,
      relationship: created.relationship,
      displayName: created.user.displayName,
      phoneMasked: maskPhone(created.user.phone),
      email: created.user.email,
      addedById: created.addedById,
      addedByRole: created.addedByRole,
      createdAt: created.createdAt.toISOString(),
    };
  }

  async removePackageMember(
    principal: SessionPrincipal,
    customerPackageId: string,
    memberUserId: string,
  ) {
    if (!UUID.test(customerPackageId) || !UUID.test(memberUserId)) {
      throw problem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST, 'userId');
    }

    const pkg = await this.db.paketPelanggan.findUnique({
      where: { id: customerPackageId },
      include: packageInclude,
    });
    if (!pkg) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

    if (!this.canManagePackageMembers(principal, pkg)) {
      throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
    }

    const existing = pkg.sharedMembers.find((sm) => sm.userId === memberUserId);
    if (!existing) {
      throw problem('MEMBER_NOT_FOUND', HttpStatus.NOT_FOUND, 'userId');
    }

    const activeBookings = await this.db.pemesananKelas.count({
      where: {
        customerPackageId,
        userId: memberUserId,
        status: 'BOOKED',
      },
    });
    if (activeBookings > 0) {
      throw problem('MEMBER_HAS_ACTIVE_BOOKINGS', HttpStatus.CONFLICT, 'userId');
    }

    await this.db.paketPelangganAnggota.delete({
      where: {
        customerPackageId_userId: {
          customerPackageId,
          userId: memberUserId,
        },
      },
    });

    await this.audit.catat(null, {
      actorId: principal.userId,
      branchId: pkg.purchase?.branchId ?? null,
      action: 'CUSTOMER_PACKAGE_MEMBER_REMOVED',
      objectType: 'PaketPelangganAnggota',
      objectId: existing.id,
      afterMasked: {
        customerPackageId,
        memberUserId,
      },
    });

    return {
      success: true,
      customerPackageId,
      removedUserId: memberUserId,
    };
  }
}
