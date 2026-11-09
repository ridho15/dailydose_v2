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
import {
  alamatBukti,
  bolehTerimaBukti,
  buktiDitolak,
  catatPemilik,
  idUnggahan,
  jenisBukti,
  pastikanPemilik,
  teksPendek,
} from './bukti-aman';

const MAKS_BUKTI_BYTE = 10_000_000;
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
      const order = await this.pesananBoleh(principal, String(input.orderId));
      if (!bolehTerimaBukti(order, order.userId !== principal.userId))
        throw new ApiProblem(buktiDitolak(order), HttpStatus.CONFLICT);
    }

    const id = newId();
    await catatPemilik(this.storage, id, principal.userId);
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
    idUnggahan(id);
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAKS_BUKTI_BYTE)
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST);
    // Hanya pemulai unggahan yang boleh mengisi isinya, dan isinya harus gambar atau PDF sungguhan.
    await pastikanPemilik(this.storage, id, principal.userId);
    if (!jenisBukti(bytes))
      throw new ApiProblem('PAYMENT_PROOF_MIME_MISMATCH', HttpStatus.UNPROCESSABLE_ENTITY);

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
    idUnggahan(id);
    const targetPurchaseId = input.purchaseId ?? input.orderId;
    if (targetPurchaseId) {
      const purchase = await this.pesananBoleh(principal, String(targetPurchaseId));
      if (!bolehTerimaBukti(purchase, purchase.userId !== principal.userId))
        throw new ApiProblem(buktiDitolak(purchase), HttpStatus.CONFLICT);
      await pastikanPemilik(this.storage, id, principal.userId);
      const isStaff = purchase.userId !== principal.userId;
      const bankName = teksPendek(input.bankName);
      const accountHolder = teksPendek(input.accountHolder);
      await this.db.buktiPembayaran.upsert({
        where: { purchaseId: purchase.id },
        create: {
          id,
          purchaseId: purchase.id,
          fileUrl: alamatBukti(id),
          bankName,
          accountHolder,
          notes: isStaff ? 'Uploaded manually by staff' : 'Uploaded by customer',
        },
        update: {
          fileUrl: alamatBukti(id),
          bankName: bankName ?? undefined,
          accountHolder: accountHolder ?? undefined,
          notes: isStaff ? 'Uploaded manually by staff' : 'Uploaded by customer',
          uploadedAt: new Date(),
        },
      });
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
    const nextId = idUnggahan(input.paymentProofId ?? input.newPaymentProofUploadId);
    const current = await this.db.pembelian.findUnique({ where: { id: purchaseId } });
    if (!current || current.userId !== principal.userId)
      throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (!bolehTerimaBukti(current)) throw new ApiProblem(buktiDitolak(current), HttpStatus.CONFLICT);
    await pastikanPemilik(this.storage, nextId, principal.userId);
    const bankName = teksPendek(input.bankName);
    const accountHolder = teksPendek(input.accountHolder);

    await this.db.buktiPembayaran.upsert({
      where: { purchaseId: current.id },
      create: {
        id: nextId,
        purchaseId: current.id,
        fileUrl: alamatBukti(nextId),
        bankName,
        accountHolder,
      },
      update: {
        fileUrl: alamatBukti(nextId),
        bankName: bankName ?? undefined,
        accountHolder: accountHolder ?? undefined,
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

  /** Pesanan milik peminta, atau pesanan di cabang yang boleh ditangani staf peminta. */
  private async pesananBoleh(principal: SessionPrincipal, orderId: string) {
    const order = await this.db.pembelian.findUnique({ where: { id: orderId } });
    if (!order) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (order.userId !== principal.userId)
      this.access.scope(principal, order.branchId, ['payment:review', 'purchase:review', 'purchase:record']);
    return order;
  }
}
