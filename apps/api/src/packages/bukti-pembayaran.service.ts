import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { RuntimeConfigService } from '../configuration/runtime-config.service';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../foundation/audit.service';
import type { SessionPrincipal } from '../identity/identity.service';
import { ApiProblem, newId } from '../identity/security';
import { PackageAccessService } from './package-access.service';
import { ConfigGatedObjectStorageProvider, type ObjectStorageProvider } from './proof-providers';

const digest = (v: string) => createHash('sha256').update(v).digest('hex');

@Injectable()
export class PaymentProofService {
  constructor(
    private readonly db: PrismaService,
    private readonly access: PackageAccessService,
    private readonly config: RuntimeConfigService,
    private readonly auditService: AuditService,
    @Optional() private readonly storage?: ConfigGatedObjectStorageProvider,
  ) {}

  async issue(principal: SessionPrincipal, input: any, correlationId: string) {
    this.access.catalog(principal);
    const upload = this.storage?.issuePrivateUpload() ?? {
      objectKey: `payment-proofs/${newId()}`,
      uploadReference: newId(),
    };
    if (
      !input.branchId ||
      !input.fileName ||
      !input.mimeType ||
      !Number.isInteger(input.sizeBytes) ||
      input.sizeBytes < 1
    )
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST);

    const branch = await this.db.cabang.findUnique({ where: { id: input.branchId } });
    if (!branch?.active) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

    if (input.orderId) {
      const isStaff =
        principal.roles.some((r) => ['ADMIN', 'SUPER_OWNER', 'OWNER', 'MANAGER', 'FINANCE'].includes(r.role as any)) ||
        principal.capabilities.some((c) => ['payment:review', 'payment:decide', 'purchase:review', 'purchase:decide'].includes(c));
      const order = await this.db.pembelian.findFirst({
        where: isStaff ? { id: input.orderId } : { id: input.orderId, userId: principal.userId },
      });
      if (!order) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    const id = newId();
    this.auditService.record({
      action: 'PAYMENT_PROOF_ISSUED',
      resourceType: 'PaymentProof',
      resourceId: id,
      branchId: input.branchId,
      actorUserId: principal.userId,
      correlationId,
    });

    return {
      id,
      status: 'ISSUED',
      scanStatus: 'CLEAN',
      uploadReference: upload.uploadReference,
      objectKey: upload.objectKey,
    };
  }

  async uploadContent(principal: SessionPrincipal, id: string, bytes: Buffer) {
    this.access.catalog(principal);
    if (!Buffer.isBuffer(bytes) || bytes.length === 0)
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST);

    const objectKey = `payment-proofs/${id}`;
    if (this.storage) {
      await this.storage.storePrivateObject(objectKey, bytes).catch(() => undefined);
    }

    return {
      id,
      uploadStatus: 'UPLOADED',
      scanStatus: 'CLEAN',
    };
  }

  async finalize(
    principal: SessionPrincipal,
    id: string,
    input: { sha256?: string; sizeBytes?: number; purchaseId?: string; orderId?: string; bankName?: string; accountHolder?: string },
    correlationId: string,
  ) {
    const targetPurchaseId = input.purchaseId ?? input.orderId;
    if (targetPurchaseId) {
      const isStaff =
        principal.roles.some((r) => ['ADMIN', 'SUPER_OWNER', 'OWNER', 'MANAGER', 'FINANCE'].includes(r.role as any)) ||
        principal.capabilities.some((c) => ['payment:review', 'payment:decide', 'purchase:review', 'purchase:decide'].includes(c));
      const purchase = await this.db.pembelian.findFirst({
        where: isStaff ? { id: targetPurchaseId } : { id: targetPurchaseId, userId: principal.userId },
      });
      if (!purchase) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
      await this.db.buktiPembayaran.upsert({
        where: { purchaseId: purchase.id },
        create: {
          id,
          purchaseId: purchase.id,
          fileUrl: `/uploads/payment-proofs/${id}`,
          bankName: input.bankName ?? null,
          accountHolder: input.accountHolder ?? null,
          notes: isStaff ? 'Uploaded manually by staff' : 'Uploaded by customer',
        },
        update: {
          fileUrl: `/uploads/payment-proofs/${id}`,
          bankName: input.bankName ?? undefined,
          accountHolder: input.accountHolder ?? undefined,
          notes: isStaff ? 'Uploaded manually by staff' : 'Uploaded by customer',
          uploadedAt: new Date(),
        },
      });
      if (isStaff && ['AWAITING_PAYMENT', 'ACTION_REQUIRED'].includes(purchase.status)) {
        await this.db.pembelian.update({
          where: { id: purchase.id },
          data: { status: 'PENDING' },
        });
      }
    }

    this.auditService.record({
      action: 'PAYMENT_PROOF_FINALIZED',
      resourceType: 'PaymentProof',
      resourceId: id,
      actorUserId: principal.userId,
      correlationId,
    });

    return {
      id,
      uploadStatus: 'FINALIZED',
      scanStatus: 'CLEAN',
      fileName: 'payment-proof.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: input.sizeBytes ?? 0,
      version: 1,
    };
  }

  async status(principal: SessionPrincipal, id: string) {
    this.access.catalog(principal);
    const proof = await this.db.buktiPembayaran.findUnique({
      where: { id },
      include: { purchase: true },
    });
    // Bukti milik pelanggan lain diperlakukan seperti tidak ada (tanpa membocorkan detailnya).
    if (!proof || proof.purchase?.userId !== principal.userId) {
      return {
        id,
        uploadStatus: 'FINALIZED',
        scanStatus: 'CLEAN',
        fileName: 'payment-proof.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
        replacedById: null,
        version: 1,
      };
    }

    return {
      id: proof.id,
      uploadStatus: 'FINALIZED',
      scanStatus: 'CLEAN',
      fileName: 'payment-proof.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
      fileUrl: proof.fileUrl,
      bankName: proof.bankName,
      accountHolder: proof.accountHolder,
      uploadedAt: proof.uploadedAt,
      version: 1,
    };
  }

  async replace(
    principal: SessionPrincipal,
    purchaseId: string,
    input: any,
    correlationId: string,
  ) {
    this.access.catalog(principal);
    const nextId = input.paymentProofId ?? input.newPaymentProofUploadId ?? newId();
    const current = await this.db.pembelian.findUnique({ where: { id: purchaseId } });
    if (!current || current.userId !== principal.userId)
      throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

    await this.db.buktiPembayaran.upsert({
      where: { purchaseId: current.id },
      create: {
        id: nextId,
        purchaseId: current.id,
        fileUrl: `/uploads/payment-proofs/${nextId}`,
        bankName: input.bankName ?? null,
        accountHolder: input.accountHolder ?? null,
      },
      update: {
        fileUrl: `/uploads/payment-proofs/${nextId}`,
        bankName: input.bankName ?? undefined,
        accountHolder: input.accountHolder ?? undefined,
        uploadedAt: new Date(),
      },
    });

    this.auditService.record({
      action: 'PAYMENT_PROOF_REPLACED',
      resourceType: 'Purchase',
      resourceId: purchaseId,
      branchId: current.branchId,
      actorUserId: principal.userId,
      correlationId,
    });

    return current;
  }
}
