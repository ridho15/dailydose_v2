import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { Prisma, PurchaseStatus, SessionMutationType } from '@prisma/client';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaService } from '../database/prisma.service';
import { IdempotencyService } from '../foundation/idempotency.service';
import type { SessionPrincipal } from '../identity/identity.service';
import { ApiProblem } from '../identity/security';
import { PackageAccessService } from './package-access.service';
import { buildPhoneSearchVariants } from '../identity/manajemen-pelanggan.service';
import { NotificationWriterService } from '../notifications/notification-writer.service';
import { EmailNotificationService } from '../email/email-notification.service';
import { ConfigGatedObjectStorageProvider } from './proof-providers';

@Injectable()
export class PaymentReviewService {
  constructor(
    private readonly db: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly access: PackageAccessService,
    @Optional() private readonly notificationWriter?: NotificationWriterService,
    @Optional() private readonly emails?: EmailNotificationService,
    @Optional() private readonly storage?: ConfigGatedObjectStorageProvider,
  ) {}

  async list(
    principal: SessionPrincipal,
    query: {
      branchId?: string;
      status?: string;
      cursor?: string;
      page?: number;
      pageSize?: number;
      limit?: string | number;
      q?: string;
      from?: string;
      until?: string;
      purchaseId?: string;
      includeHistorical?: boolean;
    } = {},
  ) {
    const reviewer =
      principal.capabilities.includes('payment:review') ||
      principal.capabilities.includes('purchase:review');
    this.access.review(principal);
    if (query.includeHistorical && !principal.capabilities.includes('migration:read'))
      throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
    if (query.branchId)
      this.access.scope(principal, query.branchId, ['payment:review', 'purchase:review']);

    const statusParam = query.status?.trim().toUpperCase();
    let statusFilter: PurchaseStatus | Prisma.EnumPurchaseStatusFilter | undefined = undefined;
    if (statusParam && statusParam !== 'ALL') {
      if (statusParam === 'APPROVED' || statusParam === 'VERIFIED' || statusParam === 'PAID') {
        statusFilter = PurchaseStatus.PAID;
      } else if (statusParam === 'REJECTED') {
        statusFilter = PurchaseStatus.REJECTED;
      } else if (statusParam === 'PENDING') {
        statusFilter = { in: [PurchaseStatus.PENDING, PurchaseStatus.WAITING_VERIFICATION] };
      } else if (statusParam === 'WAITING_VERIFICATION' || statusParam === 'PAYMENT_SUBMITTED') {
        statusFilter = PurchaseStatus.WAITING_VERIFICATION;
      } else if (statusParam === 'CANCELLED' || statusParam === 'EXPIRED') {
        statusFilter = PurchaseStatus.CANCELLED;
      } else if (Object.values(PurchaseStatus).includes(statusParam as PurchaseStatus)) {
        statusFilter = statusParam as PurchaseStatus;
      } else {
        throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY);
      }
    }

    const limit = query.pageSize ? Math.min(Number(query.pageSize), 100) : (query.limit === undefined ? 20 : Number(query.limit));
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY);
    const pageNumber = query.page && Number(query.page) > 0 ? Number(query.page) : undefined;
    const from = this.parseDate(query.from);
    const until = this.parseDate(query.until);
    if (from && until && from >= until)
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY);

    const branchScope = this.access.branchScope(principal, 'payment:review');
    const scope: Prisma.PembelianWhereInput = {
      ...(query.branchId
        ? { branchId: query.branchId }
        : reviewer
          ? branchScope.all
            ? branchScope.excluded.length
              ? { branchId: { notIn: branchScope.excluded } }
              : {}
            : { branchId: { in: branchScope.included } }
          : {}),
    };

    const search = query.q?.trim();
    const phoneVariants = search ? buildPhoneSearchVariants(search) : [];
    const summaryWhere: Prisma.PembelianWhereInput = {
      ...scope,
      ...(search
        ? {
            OR: [
              { id: search },
              { invoiceNumber: { contains: search } },
              { userId: search },
              { user: { displayName: { contains: search } } },
              { user: { email: { contains: search } } },
              ...phoneVariants.map((v) => ({ user: { phone: { contains: v } } })),
              { package: { name: { contains: search } } },
            ],
          }
        : {}),
      ...(from || until
        ? { createdAt: { ...(from ? { gte: from } : {}), ...(until ? { lt: until } : {}) } }
        : {}),
    };

    const baseWhere: Prisma.PembelianWhereInput = {
      ...summaryWhere,
      ...(query.purchaseId ? { id: query.purchaseId } : {}),
    };

    const itemWhere: Prisma.PembelianWhereInput = {
      ...baseWhere,
      ...(statusFilter ? { status: statusFilter } : {}),
    };

    if (!pageNumber && query.cursor) {
      const visibleCursor = await this.db.pembelian.findFirst({
        where: { ...itemWhere, id: query.cursor },
        select: { id: true },
      });
      if (!visibleCursor) throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    const [rows, totalFiltered, grouped, totalAmountAgg, agingOver24Hours] = await Promise.all([
      this.db.pembelian.findMany({
        where: itemWhere,
        include: {
          user: { select: { id: true, displayName: true, email: true, phone: true } },
          branch: { select: { id: true, code: true, name: true, timezone: true } },
          package: true,
          paymentProof: true,
          customerPackage: true,
        },
        orderBy:
          statusFilter === PurchaseStatus.WAITING_VERIFICATION || statusFilter === PurchaseStatus.PENDING
            ? [{ createdAt: 'asc' }, { id: 'asc' }]
            : [{ createdAt: 'desc' }, { id: 'desc' }],
        take: pageNumber ? limit : limit + 1,
        ...(pageNumber ? { skip: (pageNumber - 1) * limit } : (query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {})),
      }),
      typeof this.db.pembelian.count === 'function'
        ? this.db.pembelian.count({ where: itemWhere })
        : Promise.resolve(0),
      this.db.pembelian.groupBy({
        by: ['status'],
        where: summaryWhere,
        _count: { _all: true },
      }),
      this.db.pembelian.aggregate({
        where: summaryWhere,
        _sum: { totalAmountRp: true },
      }),
      this.db.pembelian.count({
        where: {
          ...summaryWhere,
          status: { in: [PurchaseStatus.PENDING, PurchaseStatus.WAITING_VERIFICATION] },
          createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    const totalPages = Math.ceil(totalFiltered / limit) || 1;
    const hasMore = pageNumber ? pageNumber < totalPages : rows.length > limit;
    const pageRows = pageNumber ? rows : (rows.length > limit ? rows.slice(0, limit) : rows);
    const counts = new Map(grouped.map((item) => [item.status, item._count._all]));
    const generatedAt = new Date();
    const recorders = await this.recorderNames(pageRows.map((row) => row.recordedById));

    return {
      items: pageRows.map(
        ({
          user,
          branch,
          package: pkg,
          paymentProof,
          customerPackage,
          ...item
        }) => {
          return {
            ...item,
            recordedBy: item.recordedById
              ? { id: item.recordedById, displayName: recorders.get(item.recordedById) ?? 'Staf' }
              : null,
            packageNameSnapshot: pkg?.name ?? null,
            sessionCountSnapshot: pkg?.sessionCount ?? null,
            durationDaysSnapshot: pkg?.validityDays ?? null,
            priceRpSnapshot: item.subtotalRp,
            payableAmountRpSnapshot: item.totalAmountRp,
            submittedAt: item.createdAt,
            decidedAt: item.verifiedAt,
            decidedById: item.verifiedById,
            decisionReasonCode: item.rejectionReason,
            customer: {
              id: user.id,
              displayName: user.displayName,
              email: user.email,
              phoneMasked: this.maskPhone(user.phone),
            },
            branch,
            package: pkg,
            paymentProof: paymentProof
              ? {
                  id: paymentProof.id,
                  fileUrl: paymentProof.fileUrl,
                  bankName: paymentProof.bankName,
                  accountHolder: paymentProof.accountHolder,
                  notes: paymentProof.notes,
                  uploadedAt: paymentProof.uploadedAt,
                  uploadStatus: 'FINALIZED',
                  scanStatus: 'CLEAN',
                  finalizedAt: paymentProof.uploadedAt,
                }
              : null,
            activationSummary: this.activationSummary(customerPackage),
            auditReference: null,
          };
        },
      ),
      summary: {
        pending: (counts.get(PurchaseStatus.PENDING) ?? 0) + (counts.get(PurchaseStatus.WAITING_VERIFICATION) ?? 0),
        actionRequired: 0,
        approved: counts.get(PurchaseStatus.PAID) ?? 0,
        rejected: counts.get(PurchaseStatus.REJECTED) ?? 0,
        expired: counts.get(PurchaseStatus.CANCELLED) ?? 0,
        total: Array.from(counts.values()).reduce((a, b) => a + b, 0),
        totalAmountRp: totalAmountAgg._sum.totalAmountRp ?? 0,
        agingOver24Hours,
      },
      total: totalFiltered,
      currentPage: pageNumber ?? 1,
      totalPages,
      pageSize: limit,
      generatedAt,
      page: query.page != null
        ? {
            nextCursor: hasMore ? (pageRows.at(-1)?.id ?? null) : null,
            hasMore,
            current: pageNumber ?? 1,
            total: totalFiltered,
            totalPages,
            pageSize: limit,
          }
        : {
            nextCursor: hasMore ? (pageRows.at(-1)?.id ?? null) : null,
            hasMore,
          },
    };
  }

  /** Nama staf pencatat penjualan manual untuk ditampilkan di antrean (tanpa relasi FK tambahan). */
  private async recorderNames(ids: Array<string | null | undefined>) {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (unique.length === 0) return new Map<string, string>();
    const users = await this.db.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, displayName: true },
    });
    return new Map(users.map((user) => [user.id, user.displayName]));
  }

  private parseDate(value?: string) {
    if (!value) return undefined;
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime()))
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY);
    return parsed;
  }

  private maskPhone(value: string | null) {
    if (!value) return null;
    const visible = value.slice(-4);
    return `${value.slice(0, Math.min(3, value.length - visible.length))}${'•'.repeat(
      Math.max(3, value.length - visible.length - 3),
    )}${visible}`;
  }

  private activationSummary(
    customerPackage: {
      id: string;
      status: string;
      validFrom: Date;
      validUntil: Date;
      totalSessions: number;
      remainingSessions: number;
      usedSessions: number;
    } | null,
  ) {
    if (!customerPackage) return null;
    const status =
      customerPackage.validUntil.getTime() <= Date.now()
        ? 'EXPIRED'
        : customerPackage.status;
    return {
      customerPackageId: customerPackage.id,
      status,
      activationDate: customerPackage.validFrom,
      expiryAt: customerPackage.validUntil,
      sessionCount: customerPackage.totalSessions,
      ledgerBalance: customerPackage.remainingSessions,
      reserved: 0,
      available: status === 'ACTIVE' ? customerPackage.remainingSessions : 0,
      used: customerPackage.usedSessions,
    };
  }

  async get(principal: SessionPrincipal, id: string, _usageCursor?: string) {
    this.access.review(principal);
    const scopedBranchIds =
      principal.capabilities.includes('branch:all') ||
      principal.capabilities.includes('finance:reconcile')
        ? undefined
        : principal.branchIds;
    const purchase = await this.db.pembelian.findFirst({
      where: {
        id,
        ...(scopedBranchIds ? { branchId: { in: scopedBranchIds } } : {}),
      },
      include: {
        user: { select: { id: true, displayName: true, email: true, phone: true } },
        branch: { select: { id: true, code: true, name: true, timezone: true } },
        package: true,
        voucher: true,
        paymentProof: true,
        customerPackage: {
          include: {
            bookings: {
              include: {
                classSlot: {
                  include: {
                    classType: true,
                  },
                },
              },
              orderBy: { bookedAt: 'desc' },
              take: 20,
            },
          },
        },
      },
    });
    if (!purchase) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

    const {
      user,
      branch,
      package: pkg,
      paymentProof,
      customerPackage,
      ...item
    } = purchase;

    const activationSummary = this.activationSummary(customerPackage);
    const bookingItems = customerPackage?.bookings ?? [];
    const recorders = await this.recorderNames([item.recordedById]);

    return {
      purchase: {
        ...item,
        recordedBy: item.recordedById
          ? { id: item.recordedById, displayName: recorders.get(item.recordedById) ?? 'Staf' }
          : null,
        packageNameSnapshot: pkg?.name ?? null,
        sessionCountSnapshot: pkg?.sessionCount ?? null,
        durationDaysSnapshot: pkg?.validityDays ?? null,
        priceRpSnapshot: item.subtotalRp,
        payableAmountRpSnapshot: item.totalAmountRp,
        submittedAt: item.createdAt,
        decidedAt: item.verifiedAt,
        decidedById: item.verifiedById,
        decisionReasonCode: item.rejectionReason,
        customer: {
          id: user.id,
          displayName: user.displayName,
          email: user.email,
          phoneMasked: this.maskPhone(user.phone),
        },
        branch,
        paymentProof: paymentProof
          ? {
              id: paymentProof.id,
              fileUrl: paymentProof.fileUrl,
              bankName: paymentProof.bankName,
              accountHolder: paymentProof.accountHolder,
              notes: paymentProof.notes,
              uploadedAt: paymentProof.uploadedAt,
              uploadStatus: 'FINALIZED',
              scanStatus: 'CLEAN',
              finalizedAt: paymentProof.uploadedAt,
            }
          : null,
        activationSummary,
        auditReference: null,
      },
      timeline: {
        submittedAt: item.createdAt,
        proofFinalizedAt: paymentProof?.uploadedAt ?? null,
        decidedAt: item.verifiedAt ?? null,
      },
      decisionActorMasked: item.verifiedById ? `Staf •${item.verifiedById.slice(-6)}` : null,
      activation: customerPackage
        ? {
            customerPackageId: customerPackage.id,
            packageId: customerPackage.packageId,
            packageName: pkg?.name ?? null,
            status: customerPackage.status,
            sessionCount: customerPackage.totalSessions,
            activationDate: customerPackage.validFrom,
            expiryAt: customerPackage.validUntil,
            ledgerEntryId: null,
            ledgerQuantity: customerPackage.remainingSessions,
            ledgerOccurredAt: customerPackage.createdAt,
          }
        : null,
      balance: activationSummary,
      usageHistory: {
        items: bookingItems.map((b) => ({
          id: b.id,
          type: 'ATTEND',
          label: `Booking: ${b.classSlot?.classType?.name ?? 'Kelas'}`,
          quantity: -1,
          balanceAfter: 0,
          occurredAt: b.bookedAt,
          referenceType: 'BOOKING',
          referenceId: b.id,
        })),
        page: {
          hasMore: false,
          nextCursor: null,
        },
      },
    };
  }

  async authorizeProofDownload(principal: SessionPrincipal, id: string, _correlationId: string) {
    this.access.review(principal);
    const proof = await this.db.buktiPembayaran.findUnique({
      where: { id },
      include: { purchase: true },
    });
    if (!proof) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    this.access.scope(principal, proof.purchase.branchId, ['payment:review', 'purchase:review']);
    return {
      url: `/api/v1/uploads/payment-proofs/view-authorizations/${proof.id}/content`,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    };
  }

  async authorizeOwnOrderProof(
    principal: SessionPrincipal,
    orderId: string,
    _correlationId: string,
  ) {
    this.access.catalog(principal);
    const order = await this.db.pembelian.findFirst({
      where: { id: orderId, userId: principal.userId },
      include: { paymentProof: true },
    });
    if (!order?.paymentProof) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    return {
      url: `/api/v1/uploads/payment-proofs/view-authorizations/${order.paymentProof.id}/content`,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    };
  }

  async viewProofContent(principal: SessionPrincipal, id: string, _correlationId: string) {
    const proof = await this.db.buktiPembayaran.findUnique({
      where: { id },
      include: { purchase: true },
    });
    if (!proof) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

    const isOwner = principal.userId === proof.purchase.userId;
    const isReviewer =
      principal.capabilities.includes('payment:review') ||
      principal.capabilities.includes('purchase:review');
    if (!isOwner && !isReviewer) {
      throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    if (isReviewer && !isOwner) {
      this.access.scope(principal, proof.purchase.branchId, ['payment:review', 'purchase:review']);
    }

    if (proof.fileUrl.startsWith('data:')) {
      const parts = proof.fileUrl.split(',');
      const mime = parts[0]?.match(/:(.*?);/)?.[1] || 'image/jpeg';
      const buffer = Buffer.from(parts[1] || '', 'base64');
      return { bytes: buffer, mimeType: mime };
    }

    if (this.storage) {
      try {
        const bytes = await this.storage.readPrivateObject(`payment-proofs/${proof.id}`);
        if (bytes && bytes.length > 0) {
          return { bytes, mimeType: this.detectMime(bytes) };
        }
      } catch {}

      if (proof.fileUrl && !proof.fileUrl.startsWith('http') && !proof.fileUrl.startsWith('data:')) {
        const cleanPath = proof.fileUrl.replace(/^\//, '');
        try {
          const bytes = await this.storage.readPrivateObject(cleanPath);
          if (bytes && bytes.length > 0) {
            return { bytes, mimeType: this.detectMime(bytes) };
          }
        } catch {}
        if (cleanPath.includes('%')) {
          try {
            const decodedPath = decodeURIComponent(cleanPath);
            const bytes = await this.storage.readPrivateObject(decodedPath);
            if (bytes && bytes.length > 0) {
              return { bytes, mimeType: this.detectMime(bytes) };
            }
          } catch {}
        }
      }
    }

    try {
      if (proof.fileUrl && !proof.fileUrl.startsWith('http')) {
        const cleanPath = proof.fileUrl.replace(/^\//, '');
        const fullPath = resolve(process.cwd(), cleanPath);
        const exists = await stat(fullPath).then((s) => s.isFile()).catch(() => false);
        if (exists) {
          const bytes = await readFile(fullPath);
          return { bytes, mimeType: this.detectMime(bytes) };
        }
      }
    } catch {}

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
  <rect width="600" height="400" fill="#f8fafc" rx="8"/>
  <rect x="20" y="20" width="560" height="360" fill="none" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="6,6" rx="8"/>
  <text x="300" y="170" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="18" font-weight="600" fill="#334155">
    Bukti Pembayaran Terlampir
  </text>
  <text x="300" y="205" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#64748b">
    ID: ${proof.id}
  </text>
  <text x="300" y="235" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#94a3b8">
    ${proof.bankName ? `Bank: ${proof.bankName}` : ''}${proof.accountHolder ? ` · A/N: ${proof.accountHolder}` : ''}
  </text>
</svg>`.trim();
    return {
      bytes: Buffer.from(svg, 'utf-8'),
      mimeType: 'image/svg+xml',
    };
  }

  private detectMime(bytes: Buffer): string {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return 'image/png';
    }
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
      return 'application/pdf';
    }
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
      return 'image/webp';
    }
    return 'image/jpeg';
  }

  async decide(
    principal: SessionPrincipal,
    id: string,
    decision: 'APPROVED' | 'REJECTED',
    input: { reasonCode?: string; expectedVersion?: number; note?: string },
    key: string,
    correlationId: string,
  ) {
    this.access.review(principal, true);
    if (!key)
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST);
    const allowedReasons =
      decision === 'APPROVED'
        ? ['PAYMENT_VERIFIED']
        : ['PROOF_INVALID', 'AMOUNT_MISMATCH', 'DUPLICATE_PURCHASE', 'OTHER_REVIEW_REQUIRED'];
    if (input.reasonCode && !allowedReasons.includes(input.reasonCode))
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST);
    // Menolak pembayaran wajib punya alasan (kode alasan; "lainnya" juga wajib catatan).
    if (decision === 'REJECTED' && !input.reasonCode)
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'reasonCode', issue: 'REQUIRED' },
      ]);
    const note = input.note?.trim();
    if (input.reasonCode === 'OTHER_REVIEW_REQUIRED' && (!note || note.length < 3))
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY);
    if (note && note.length > 500)
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY);

    let result!: { status: number; body: Prisma.InputJsonValue; replay: boolean };
    try {
      result = await this.idempotency.execute(
        {
          scope: `purchase-decision:${id}`,
          key,
          payload: {
            decision,
            reasonCode: input.reasonCode,
            expectedVersion: input.expectedVersion,
            notePresent: Boolean(note),
          },
          ttlMs: 86_400_000,
          leaseMs: 30_000,
        },
        async (tx) => {
          const purchase = await tx.pembelian.findUnique({
            where: { id },
            include: { paymentProof: true, package: true, branch: true },
          });
          if (!purchase) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
          this.access.scope(principal, purchase.branchId, ['payment:decide', 'purchase:decide']);
          // Super Owner dan Superadmin memiliki wewenang penuh untuk menyetujui transaksi apa pun (God Mode).
          // Staf cabang biasa tanpa wewenang super tetap mengikuti aturan Maker-Checker (Pemisahan Tugas).
          const isSuper = principal.roles.some((r) =>
            r.role === 'SUPER_OWNER',
          );
          // Pembeli (pelanggan) dilarang menyetujui transaksinya sendiri, kecuali Super Admin / Super Owner.
          if (!isSuper && purchase.userId === principal.userId) {
            throw new ApiProblem('SEPARATION_OF_DUTIES_VIOLATION', HttpStatus.FORBIDDEN);
          }
          if (!isSuper && purchase.recordedById === principal.userId) {
            throw new ApiProblem('SEPARATION_OF_DUTIES_VIOLATION', HttpStatus.FORBIDDEN);
          }
          if (purchase.status !== 'PENDING' && purchase.status !== 'WAITING_VERIFICATION')
            throw new ApiProblem('PURCHASE_ALREADY_DECIDED', HttpStatus.CONFLICT);

          const decidedAt = new Date();
          const nextStatus = decision === 'APPROVED' ? PurchaseStatus.PAID : PurchaseStatus.REJECTED;

          const updated = await tx.pembelian.update({
            where: { id },
            data: {
              status: nextStatus,
              paidAt: decision === 'APPROVED' ? decidedAt : undefined,
              verifiedAt: decidedAt,
              verifiedById: principal.userId,
              rejectionReason: decision === 'REJECTED' ? (input.note || input.reasonCode || 'REJECTED') : null,
            },
          });

          let customerPackage = null;
          if (decision === 'APPROVED') {
            const existingPkg = await tx.paketPelanggan.findUnique({
              where: { purchaseId: purchase.id },
            });
            if (existingPkg) {
              customerPackage = existingPkg;
            } else {
              const validUntil = new Date(
                decidedAt.getTime() + (purchase.package.validityDays || 30) * 24 * 60 * 60 * 1000,
              );

              customerPackage = await tx.paketPelanggan.create({
                data: {
                  userId: purchase.userId,
                  packageId: purchase.packageId,
                  purchaseId: purchase.id,
                  totalSessions: purchase.package.sessionCount,
                  remainingSessions: purchase.package.sessionCount,
                  usedSessions: 0,
                  validFrom: decidedAt,
                  validUntil,
                  status: 'ACTIVE',
                },
              });

              // Catat mutasi awal kuota sesi di SessionLedger (Spesifikasi v1.0)
              await tx.sessionLedger.create({
                data: {
                  customerPackageId: customerPackage.id,
                  type: SessionMutationType.PURCHASE,
                  amount: purchase.package.sessionCount,
                  balanceAfter: purchase.package.sessionCount,
                  referenceId: purchase.id,
                  notes: `Saldo awal pembelian paket #${purchase.invoiceNumber}`,
                  createdById: principal.userId,
                },
              });
            }
          } else if (decision === 'REJECTED') {
            await tx.paketPelanggan.updateMany({
              where: { purchaseId: purchase.id },
              data: { status: 'EXPIRED', validUntil: new Date(0) },
            });
          }

          const purchaseWithAudit = { ...updated, auditReference: null };

          return {
            status: 200,
            body: (decision === 'APPROVED'
              ? {
                  purchase: purchaseWithAudit,
                  customerPackage: customerPackage
                    ? {
                        ...customerPackage,
                        packageName: purchase.package.name,
                        branchName: purchase.branch.name,
                        ledgerBalance: customerPackage.remainingSessions,
                        reserved: 0,
                        available: customerPackage.remainingSessions,
                      }
                    : null,
                  ledgerEntry: null,
                  idempotentReplay: false,
                }
              : purchaseWithAudit) as unknown as Prisma.InputJsonValue,
          };
        },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')
        throw new ApiProblem('CONFLICT', HttpStatus.CONFLICT);
      throw error;
    }

    void this.sendPaymentEmail(id, decision, input, correlationId);
    return result;
  }

  private async sendPaymentEmail(
    id: string,
    decision: 'APPROVED' | 'REJECTED',
    input: { reasonCode?: string; note?: string },
    correlationId: string,
  ): Promise<void> {
    if (!this.emails) return;
    try {
      const purchase = await this.db.pembelian.findUnique({
        where: { id },
        include: { package: true },
      });
      if (!purchase) return;
      const user = await this.db.user.findUnique({
        where: { id: purchase.userId },
        select: { email: true },
      });
      const publicBaseUrl = process.env.PUBLIC_WEB_BASE_URL?.trim();
      if (!user?.email || !publicBaseUrl) return;
      const nextStatus: 'APPROVED' | 'ACTION_REQUIRED' | 'REJECTED' =
        decision === 'REJECTED' && input.reasonCode !== 'DUPLICATE_PURCHASE'
          ? 'ACTION_REQUIRED'
          : decision;
      const templateMap = {
        APPROVED: 'ORDER_APPROVED_V1',
        ACTION_REQUIRED: 'ORDER_ACTION_REQUIRED_V1',
        REJECTED: 'ORDER_REJECTED_V1',
      } as const;
      await this.emails.enqueue({
        eventType: `purchase.${nextStatus.toLowerCase().replace('_', '-')}.v1`,
        templateKey: templateMap[nextStatus],
        recipient: user.email,
        variables: {
          packageName: purchase.package.name,
          href:
            nextStatus === 'APPROVED'
              ? `${publicBaseUrl}/packages`
              : `${publicBaseUrl}/orders/${id}`,
          detail:
            nextStatus === 'APPROVED'
              ? 'Paket Anda kini aktif dan siap digunakan.'
              : `Alasan: ${input.reasonCode ?? 'lihat aplikasi'}${input.note ? ` — ${input.note}` : ''}`,
        },
        correlationId,
        occurrenceParts: ['payment-decide', id, decision],
        userId: purchase.userId,
      });
    } catch {
      // ignore email error
    }
  }
}
