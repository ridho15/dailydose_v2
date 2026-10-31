import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, PurchaseStatus } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { RuntimeConfigService } from '../configuration/runtime-config.service';
import { PrismaService } from '../database/prisma.service';
import { IdempotencyService } from '../foundation/idempotency.service';
import { AuditService } from '../foundation/audit.service';
import type { SessionPrincipal } from '../identity/identity.service';
import { ApiProblem, ENTITY_ID_REGEX } from '../identity/security';
import { PackageAccessService } from './package-access.service';
import { PackagePricingService } from './kalkulasi-harga-paket.service';
import {
  VoucherService,
  calculateVoucherDiscount,
  checkVoucherApplicability,
  isPercentageVoucherType,
  normalizeVoucherCode,
} from './voucher.service';

const PAGE_SIZE = 20;
const UUID = ENTITY_ID_REGEX;
const ASSISTED_PAYMENT_METHODS = ['CASH', 'QRIS', 'CARD', 'BANK_TRANSFER', 'MANUAL_STAFF'] as const;
export type AssistedPaymentMethod = (typeof ASSISTED_PAYMENT_METHODS)[number];

const newInvoiceNumber = () =>
  `INV-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;

@Injectable()
export class CustomerOrderService {
  constructor(
    private readonly db: PrismaService,
    private readonly access: PackageAccessService,
    private readonly pricing: PackagePricingService,
    private readonly vouchers: VoucherService,
    private readonly idempotency: IdempotencyService,
    private readonly config: RuntimeConfigService,
    private readonly auditService: AuditService,
  ) {}

  private orderView(order: any, _revealAccount = false) {
    const pkg = order.package;
    const branch = order.branch;
    const voucher = order.voucher;
    const proof = order.paymentProof;
    const customerPkg = order.customerPackage;

    const legacyStatus =
      order.status === 'PENDING'
        ? proof
          ? 'PENDING'
          : 'AWAITING_PAYMENT'
        : order.status === 'WAITING_VERIFICATION'
          ? 'PENDING'
          : order.status === 'PAID'
            ? 'APPROVED'
            : order.status === 'CANCELLED'
              ? 'EXPIRED'
              : 'REJECTED';

    const firstAccount = branch?.paymentAccounts?.[0];
    const paymentAccount = firstAccount
      ? {
          bankName: firstAccount.bankName,
          accountNumber: firstAccount.accountNumber,
          accountHolderName: firstAccount.accountHolder,
        }
      : null;

    return {
      id: order.id,
      invoiceNumber: order.invoiceNumber,
      orderNumber: order.invoiceNumber,
      branchId: order.branchId,
      branchName: branch?.name ?? null,
      branchTimezone: branch?.timezone ?? 'Asia/Jakarta',
      packageId: order.packageId,
      packageName: pkg?.name ?? null,
      priceRp: order.subtotalRp,
      baseAmountRp: order.subtotalRp,
      subtotalRp: order.subtotalRp,
      voucher: voucher
        ? {
            id: voucher.id,
            code: voucher.code,
            discountType: isPercentageVoucherType(voucher.discountType) ? 'PERCENTAGE' : 'FIXED_AMOUNT',
            discountValue: voucher.discountValue,
            discountRp: Math.max(0, order.discountRp - (order.promotionDiscountRp ?? 0)),
          }
        : null,
      promotion: order.promotionId
        ? {
            id: order.promotionId,
            name: order.promotionName ?? 'Promo paket',
            discountRp: order.promotionDiscountRp ?? 0,
          }
        : null,
      promotionalPriceRp: order.subtotalRp - (order.promotionDiscountRp ?? 0),
      priceAfterDiscountRp: Math.max(0, order.subtotalRp - order.discountRp),
      paymentUniqueCode: order.uniqueCode ?? 0,
      payableAmountRp: order.totalAmountRp,
      totalAmountRp: order.totalAmountRp,
      sessionCount: pkg?.sessionCount ?? 1,
      durationDays: pkg?.validityDays ?? 30,
      validityDays: pkg?.validityDays ?? 30,
      status: legacyStatus,
      rawStatus: order.status,
      submittedAt: order.createdAt,
      decidedAt: order.verifiedAt ?? null,
      expiresAt: order.paymentExpiresAt,
      continuationSlotId: null,
      paymentProofId: proof?.id ?? null,
      paymentProofStatus: proof
        ? {
            uploadStatus: 'FINALIZED',
            scanStatus: 'CLEAN',
          }
        : null,
      paymentProof: proof
        ? {
            id: proof.id,
            fileUrl: proof.fileUrl,
            bankName: proof.bankName,
            accountHolder: proof.accountHolder,
            uploadedAt: proof.uploadedAt,
          }
        : null,
      decisionReasonCode: order.rejectionReason ?? null,
      timelineComplete: true,
      version: 1,
      activation: customerPkg
        ? {
            customerPackageId: customerPkg.id,
            status: customerPkg.status,
            activationDate: customerPkg.validFrom,
            expiryAt: customerPkg.validUntil,
            sessionCount: customerPkg.totalSessions,
          }
        : null,
      paymentAccount,
    };
  }

  async checkoutOptions(
    principal: SessionPrincipal,
    packageId: string,
    branchId?: string,
  ) {
    await this.access.requireVerifiedCustomer(principal);
    const pkg = await this.db.paket.findUnique({
      where: { id: packageId },
      include: { classType: true },
    });
    if (!pkg || pkg.status !== 'ACTIVE')
      throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

    const branches = await this.db.cabang.findMany({
      where: { active: true },
      include: {
        paymentAccounts: { where: { active: true } },
      },
    });

    const targetBranch = branchId
      ? branches.find((b) => b.id === branchId)
      : branches[0];

    // Pick the first active payment account for this branch (required by frontend)
    const firstAccount = (targetBranch?.paymentAccounts ?? [])[0];

    // Build classTypes array from the single classType relation so the frontend
    // CheckoutOptions interface (which expects an array) is satisfied.
    const classTypes = pkg.classType
      ? [{ id: pkg.classType.id, name: pkg.classType.name }]
      : [];
    const priced = this.pricing.calculate(
      pkg.priceRp,
      await this.pricing.activePromotion(this.db, pkg.id),
    );

    return {
      package: {
        id: pkg.id,
        name: pkg.name,
        priceRp: pkg.priceRp,
        effectivePriceRp: priced.effectivePriceRp,
        version: 1,
        promotion: priced.promotion
          ? {
              ...priced.promotion,
              discountType: priced.promotion.discountType === 'PERCENTAGE' ? 'PERCENTAGE' : 'FIXED_AMOUNT',
              activeFrom: priced.promotion.activeFrom.toISOString(),
              activeUntil: priced.promotion.activeUntil.toISOString(),
            }
          : null,
        sessionCount: pkg.sessionCount,
        durationDays: pkg.validityDays,
        isMultiBranch: Boolean(pkg.isMultiBranch),
        branchId: targetBranch?.id ?? null,
        branchName: targetBranch?.name ?? null,
        classTypes,
      },
      paymentAccount: firstAccount
        ? {
            id: firstAccount.id,
            bankName: firstAccount.bankName,
            accountNumber: firstAccount.accountNumber,
            accountHolderName: firstAccount.accountHolder,
            paymentWindowHours: 24,
          }
        : null,
    };
  }

  async createOrder(
    principal: SessionPrincipal,
    input: {
      packageId: string;
      branchId: string;
      voucherCode?: string;
      paymentProofId?: string;
      expectedPromotionId?: string | null;
      expectedPromotionVersion?: number;
    },
    key: string,
    correlationId: string,
  ) {
    await this.access.requireVerifiedCustomer(principal);
    if (!input.packageId || !input.branchId)
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST);

    return this.idempotency.execute(
      {
        scope: `order-create:${principal.userId}:${input.packageId}`,
        key,
        payload: input,
        ttlMs: 86_400_000,
        leaseMs: 30_000,
      },
      async (tx) => {
        const pkg = await tx.paket.findUnique({ where: { id: input.packageId } });
        if (!pkg || pkg.status !== 'ACTIVE')
          throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

        const branch = await tx.cabang.findUnique({ where: { id: input.branchId } });
        if (!branch || !branch.active)
          throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

        const { voucher, discountRp, subtotalRp, totalAmountRp: baseAmountRp, promotion } = await this.priceOrder(
          tx,
          pkg,
          input.voucherCode,
        );
        // Harga yang dilihat pelanggan harus sama dengan harga yang ditagih: bila promo berubah sejak
        // halaman checkout dimuat, minta pelanggan memuat ulang alih-alih menagih harga lain.
        if (
          input.expectedPromotionId !== undefined &&
          (input.expectedPromotionId ?? null) !== (promotion?.id ?? null)
        )
          throw new ApiProblem('PROMOTION_CHANGED', HttpStatus.CONFLICT);
        if (
          promotion &&
          input.expectedPromotionVersion !== undefined &&
          input.expectedPromotionVersion !== promotion.version
        )
          throw new ApiProblem('PROMOTION_CHANGED', HttpStatus.CONFLICT);
        const invoiceNumber = newInvoiceNumber();
        const paymentExpiresAt = new Date(Date.now() + 24 * 3_600_000);

        let uniqueCode: number | null = null;
        let totalAmountRp = baseAmountRp;

        if (baseAmountRp > 0) {
          const existingPending = tx.pembelian?.findMany
            ? await tx.pembelian.findMany({
                where: {
                  branchId: input.branchId,
                  status: { in: ['PENDING', 'WAITING_VERIFICATION'] },
                  paymentExpiresAt: { gt: new Date() },
                  uniqueCode: { not: null },
                },
                select: { uniqueCode: true },
              })
            : [];
          const usedCodes = new Set(
            existingPending
              .map((p) => p.uniqueCode)
              .filter((c): c is number => typeof c === 'number'),
          );

          let candidate = Math.floor(Math.random() * 900) + 100;
          for (let i = 0; i < 900; i++) {
            const code = ((candidate - 100 + i) % 900) + 100;
            if (!usedCodes.has(code)) {
              candidate = code;
              break;
            }
          }
          uniqueCode = candidate;
          totalAmountRp = baseAmountRp + uniqueCode;
        }

        const order = await tx.pembelian.create({
          data: {
            id: randomUUID(),
            invoiceNumber,
            userId: principal.userId,
            branchId: input.branchId,
            packageId: pkg.id,
            voucherId: voucher?.id ?? null,
            subtotalRp,
            discountRp,
            uniqueCode,
            totalAmountRp,
            status: 'PENDING',
            paymentExpiresAt,
            promotionId: promotion?.id ?? null,
            promotionName: promotion?.name ?? null,
            promotionDiscountRp: promotion?.discountRp ?? 0,
          },
          include: {
            package: true,
            branch: {
              include: {
                paymentAccounts: { where: { active: true } },
              },
            },
            voucher: true,
            paymentProof: true,
            customerPackage: true,
          },
        });

        if (voucher) {
          await tx.voucher.update({
            where: { id: voucher.id },
            data: { usedCount: { increment: 1 } },
          });
        }

        if (input.paymentProofId) {
          await tx.buktiPembayaran.upsert({
            where: { purchaseId: order.id },
            create: {
              id: input.paymentProofId,
              purchaseId: order.id,
              fileUrl: `/uploads/payment-proofs/${input.paymentProofId}`,
            },
            update: {
              fileUrl: `/uploads/payment-proofs/${input.paymentProofId}`,
            },
          });
        }

        this.auditService.record({
          action: 'ORDER_CREATED',
          resourceType: 'Purchase',
          resourceId: order.id,
          branchId: order.branchId,
          actorUserId: principal.userId,
          correlationId,
        });

        return {
          status: HttpStatus.CREATED,
          body: this.orderView(order) as unknown as Prisma.InputJsonValue,
        };
      },
    );
  }

  async listOrders(
    principal: SessionPrincipal,
    query: {
      status?: string;
      cursor?: string;
      limit?: string;
      from?: string;
      until?: string;
      q?: string;
      includeHistorical?: boolean;
    } = {},
  ) {
    const limit = query.limit ? Math.min(Number(query.limit), 100) : PAGE_SIZE;

    const where: Prisma.PembelianWhereInput = {
      userId: principal.userId,
      ...(query.status
        ? query.status === 'APPROVED' || query.status === 'VERIFIED' || query.status === 'PAID'
          ? { status: PurchaseStatus.PAID }
          : query.status === 'REJECTED'
            ? { status: PurchaseStatus.REJECTED }
            : query.status === 'PAYMENT_SUBMITTED' || query.status === 'WAITING_VERIFICATION'
              ? { status: PurchaseStatus.WAITING_VERIFICATION }
              : query.status === 'CANCELLED' || query.status === 'EXPIRED'
                ? { status: PurchaseStatus.CANCELLED }
                : query.status === 'AWAITING_PAYMENT'
                  ? { status: PurchaseStatus.PENDING, paymentProof: null }
                  : query.status === 'PENDING'
                    ? {
                        OR: [
                          { status: PurchaseStatus.WAITING_VERIFICATION },
                          { status: PurchaseStatus.PENDING, paymentProof: { isNot: null } },
                        ],
                      }
                    : { status: PurchaseStatus.PENDING }
        : {}),
      ...(query.from || query.until
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.until ? { lte: new Date(query.until) } : {}),
            },
          }
        : {}),
    };

    const allUserOrders = await this.db.pembelian.findMany({
      where: { userId: principal.userId },
      select: {
        status: true,
        paymentProof: {
          select: { id: true },
        },
      },
    });

    const summary = {
      total: allUserOrders.length,
      awaitingPayment: 0,
      pending: 0,
      actionRequired: 0,
      approved: 0,
      rejected: 0,
      expired: 0,
    };

    for (const o of allUserOrders) {
      if (o.status === PurchaseStatus.PENDING) {
        if (o.paymentProof) {
          summary.pending += 1;
        } else {
          summary.awaitingPayment += 1;
        }
      } else if (o.status === PurchaseStatus.WAITING_VERIFICATION) {
        summary.pending += 1;
      } else if (o.status === PurchaseStatus.PAID) {
        summary.approved += 1;
      } else if (o.status === PurchaseStatus.CANCELLED) {
        summary.expired += 1;
      } else if (o.status === PurchaseStatus.REJECTED) {
        summary.rejected += 1;
      }
    }

    const items = await this.db.pembelian.findMany({
      where,
      include: {
        package: true,
        branch: {
          include: {
            paymentAccounts: { where: { active: true } },
          },
        },
        voucher: true,
        paymentProof: true,
        customerPackage: true,
      },
      take: limit + 1,
      orderBy: { createdAt: 'desc' },
    });

    const hasNext = items.length > limit;
    const pageItems = hasNext ? items.slice(0, limit) : items;

    return {
      items: pageItems.map((o) => this.orderView(o)),
      summary,
      nextCursor: hasNext ? pageItems[pageItems.length - 1]?.id ?? null : null,
      page: {
        hasMore: hasNext,
        nextCursor: hasNext ? pageItems[pageItems.length - 1]?.id ?? null : null,
      },
    };
  }

  async orderDetail(principal: SessionPrincipal, id: string) {
    const order = await this.db.pembelian.findUnique({
      where: { id },
      include: {
        package: true,
        branch: {
          include: {
            paymentAccounts: { where: { active: true } },
          },
        },
        voucher: true,
        paymentProof: true,
        customerPackage: true,
      },
    });
    if (!order) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (order.userId !== principal.userId)
      throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

    return this.orderView(order, true);
  }

  async attachOrderProof(
    principal: SessionPrincipal,
    orderId: string,
    input: { paymentProofId?: string; fileUrl?: string; bankName?: string; accountHolder?: string },
    correlationId: string,
  ) {
    const order = await this.db.pembelian.findUnique({
      where: { id: orderId },
    });
    const isOwner = order?.userId === principal.userId;
    const isStaff =
      principal.roles.some((r) => ['ADMIN', 'SUPER_OWNER', 'OWNER', 'MANAGER', 'FINANCE'].includes(r.role as any)) ||
      principal.capabilities.some((c) => ['payment:review', 'payment:decide', 'purchase:review', 'purchase:decide'].includes(c));

    if (!order || (!isOwner && !isStaff))
      throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

    const proofId = input.paymentProofId ?? randomUUID();
    const fileUrl = input.fileUrl ?? `/uploads/payment-proofs/${proofId}`;

    const proof = await this.db.buktiPembayaran.upsert({
      where: { purchaseId: order.id },
      create: {
        id: proofId,
        purchaseId: order.id,
        fileUrl,
        bankName: input.bankName ?? null,
        accountHolder: input.accountHolder ?? null,
      },
      update: {
        fileUrl,
        bankName: input.bankName ?? undefined,
        accountHolder: input.accountHolder ?? undefined,
        uploadedAt: new Date(),
      },
    });

    this.auditService.record({
      action: 'PAYMENT_PROOF_ATTACHED',
      resourceType: 'Purchase',
      resourceId: order.id,
      branchId: order.branchId,
      actorUserId: principal.userId,
      correlationId,
    });

    const updated = await this.db.pembelian.findUnique({
      where: { id: orderId },
      include: {
        package: true,
        branch: {
          include: {
            paymentAccounts: { where: { active: true } },
          },
        },
        voucher: true,
        paymentProof: true,
        customerPackage: true,
      },
    });

    return this.orderView(updated);
  }

  /**
   * Harga pesanan: harga daftar dikurangi promosi paket yang sedang berlaku, lalu voucher (bila valid).
   * Voucher dihitung dari harga setelah promosi, termasuk syarat belanja minimumnya.
   * Dipakai pesanan pelanggan dan penjualan manual.
   */
  private async priceOrder(
    tx: Prisma.TransactionClient,
    pkg: { id: string; priceRp: number },
    voucherCode?: string,
  ) {
    const promoted = this.pricing.calculate(pkg.priceRp, await this.pricing.activePromotion(tx, pkg.id));
    const promotion = promoted.promotion;
    const promotionDiscountRp = promotion?.discountRp ?? 0;
    const basisRp = promoted.effectivePriceRp;

    let voucher = null;
    let voucherDiscountRp = 0;
    if (voucherCode?.trim()) {
      const code = normalizeVoucherCode(voucherCode);
      const v = await tx.voucher.findFirst({
        where: { code },
      });
      const check = checkVoucherApplicability(v, basisRp);
      if (!check.valid) {
        throw new ApiProblem('VOUCHER_NOT_APPLICABLE', HttpStatus.UNPROCESSABLE_ENTITY, false, [
          { field: 'voucherCode', issue: check.issue },
        ]);
      }
      voucher = v;
      voucherDiscountRp = calculateVoucherDiscount({
        priceRp: basisRp,
        discountType: v!.discountType,
        discountValue: v!.discountValue,
        maxDiscountRp: v!.maxDiscountRp,
      });
    }
    const subtotalRp = pkg.priceRp;
    const discountRp = promotionDiscountRp + voucherDiscountRp;
    return {
      voucher,
      discountRp,
      subtotalRp,
      totalAmountRp: Math.max(0, subtotalRp - discountRp),
      promotion: promotion
        ? { id: promotion.id, name: promotion.name, version: promotion.version, discountRp: promotionDiscountRp }
        : null,
    };
  }

  /**
   * Penjualan manual di meja (tunai/QRIS/kartu). Dicatat staf dengan status PENDING; paket baru aktif
   * ketika penyetuju LAIN menyetujuinya di antrean Pembayaran (pencatat tidak boleh menyetujui sendiri).
   */
  async recordAssistedSale(
    principal: SessionPrincipal,
    input: {
      customerUserId?: string;
      packageId?: string;
      branchId?: string;
      paymentMethod?: string;
      voucherCode?: string;
      note?: string;
    },
    key: string,
    correlationId: string,
  ) {
    const branchId = input?.branchId ?? '';
    if (!UUID.test(branchId))
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'branchId', issue: 'INVALID' },
      ]);
    this.access.record(principal, branchId);
    if (!key || key.length < 8)
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST);
    if (!input.customerUserId || !UUID.test(input.customerUserId))
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'customerUserId', issue: 'INVALID' },
      ]);
    if (!input.packageId || !UUID.test(input.packageId))
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'packageId', issue: 'INVALID' },
      ]);
    const paymentMethod = input.paymentMethod as AssistedPaymentMethod;
    if (!ASSISTED_PAYMENT_METHODS.includes(paymentMethod))
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'paymentMethod', issue: 'INVALID' },
      ]);
    const note = input.note?.trim() || null;
    if (note && note.length > 200)
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'note', issue: 'TOO_LONG' },
      ]);
    const customerUserId = input.customerUserId;
    const packageId = input.packageId;

    return this.idempotency.execute(
      {
        scope: `purchase-assisted:${principal.userId}:${customerUserId}:${packageId}`,
        key,
        payload: { ...input, note },
        ttlMs: 86_400_000,
        leaseMs: 30_000,
      },
      async (tx) => {
        const customer = await tx.user.findUnique({ where: { id: customerUserId } });
        if (!customer || customer.role !== 'CUSTOMER')
          throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
        if (customer.status !== 'ACTIVE')
          throw new ApiProblem('CUSTOMER_NOT_ACTIVE', HttpStatus.CONFLICT);

        const branch = await tx.cabang.findUnique({ where: { id: branchId } });
        if (!branch || !branch.active)
          throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
        const pkg = await tx.paket.findUnique({ where: { id: packageId } });
        if (!pkg || pkg.status !== 'ACTIVE')
          throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
        if (pkg.branchId && pkg.branchId !== branchId)
          throw new ApiProblem('PACKAGE_BRANCH_MISMATCH', HttpStatus.UNPROCESSABLE_ENTITY);

        const { voucher, discountRp, subtotalRp, totalAmountRp, promotion } = await this.priceOrder(
          tx,
          pkg,
          input.voucherCode,
        );
        if (input.voucherCode?.trim() && !voucher)
          throw new ApiProblem('VOUCHER_NOT_APPLICABLE', HttpStatus.UNPROCESSABLE_ENTITY, false, [
            { field: 'voucherCode', issue: 'NOT_APPLICABLE' },
          ]);

        const order = await tx.pembelian.create({
          data: {
            id: randomUUID(),
            invoiceNumber: newInvoiceNumber(),
            userId: customer.id,
            branchId,
            packageId: pkg.id,
            voucherId: voucher?.id ?? null,
            subtotalRp,
            discountRp,
            totalAmountRp,
            status: 'PENDING',
            paymentMethod,
            paymentExpiresAt: null,
            recordedById: principal.userId,
            recordNote: note,
            promotionId: promotion?.id ?? null,
            promotionName: promotion?.name ?? null,
            promotionDiscountRp: promotion?.discountRp ?? 0,
          },
          include: {
            package: true,
            branch: {
              include: {
                paymentAccounts: { where: { active: true } },
              },
            },
            voucher: true,
            paymentProof: true,
            customerPackage: true,
          },
        });
        if (voucher) {
          await tx.voucher.update({
            where: { id: voucher.id },
            data: { usedCount: { increment: 1 } },
          });
        }

        this.auditService.record({
          action: 'PURCHASE_RECORDED_BY_STAFF',
          resourceType: 'Purchase',
          resourceId: order.id,
          branchId,
          actorUserId: principal.userId,
          correlationId,
          details: { paymentMethod, totalAmountRp, customerUserId },
        });

        return {
          status: HttpStatus.CREATED,
          body: {
            ...this.orderView(order),
            paymentMethod,
            recordedById: principal.userId,
            recordNote: note,
          } as unknown as Prisma.InputJsonValue,
        };
      },
    );
  }

  async submit(
    principal: SessionPrincipal,
    input: any,
    key: string,
    correlationId: string,
  ) {
    return this.createOrder(principal, input, key, correlationId);
  }

  // --- Indonesian Domain Aliases ---
  async expireStaleOrders(principal: SessionPrincipal, olderThanHours = 24) {
    this.access.review(principal, true);
    const cutoff = new Date(Date.now() - olderThanHours * 3600 * 1000);
    const now = new Date();

    const result = await this.db.pembelian.updateMany({
      where: {
        status: { in: ['PENDING', 'WAITING_VERIFICATION'] },
        paymentProof: null,
        OR: [
          { paymentExpiresAt: { lt: now } },
          { AND: [{ paymentExpiresAt: null }, { createdAt: { lt: cutoff } }] },
        ],
      },
      data: {
        status: 'CANCELLED',
      },
    });

    // Pembatalan massal oleh staf: satu catatan ringkas (jumlah dan batas waktu), bukan satu per pesanan.
    if (result.count > 0)
      await this.auditService.catat(null, {
        actorId: principal.userId,
        action: 'order.expired_in_bulk',
        objectType: 'Purchase',
        objectId: 'bulk',
        afterMasked: { expiredCount: result.count, olderThanHours, executedAt: now.toISOString() },
      });

    return {
      expiredCount: result.count,
      executedAt: now.toISOString(),
    };
  }
}
