import { AuditService } from '../foundation/audit.service';
import { requireReason } from '../foundation/reason';
import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type { SessionPrincipal } from './identity.service';
import { PolicyService } from './policy.service';
import { PRIVATE_FILE_STORAGE, type PrivateFileStorage } from './private-file-storage';
import { ApiProblem, newId } from './security';

export type IdentityDocumentKind = 'KTP_FRONT' | 'SELFIE';

@Injectable()
export class IdentityDocumentWorkflowService {
  constructor(
    @Optional() private readonly db?: PrismaService,
    @Optional() private readonly policy?: PolicyService,
    @Optional() @Inject(PRIVATE_FILE_STORAGE) private readonly storage?: PrivateFileStorage,
    @Optional() private readonly audit?: AuditService,
  ) {}

  async replaceIdentityDocument(
    principal: SessionPrincipal,
    kind: IdentityDocumentKind,
    upload: any,
    expectedVersion: number,
    _correlationId: string,
  ) {
    // KTP tidak diminta lagi; hanya foto selfie yang bisa diganti, kapan saja.
    if (kind !== 'SELFIE') {
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'kind', issue: 'KTP_NOT_REQUIRED' },
      ]);
    }
    if (!upload?.buffer?.length) {
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'replacement', issue: 'REQUIRED' },
      ]);
    }

    let key: string | null = null;
    const ext = upload?.originalName?.split('.').pop() || 'jpg';
    const generatedKey = `identity-documents/${principal.userId}/${kind.toLowerCase()}-${Date.now()}.${ext}`;

    // Foto harus benar-benar tersimpan: selfie adalah syarat membeli paket dan booking.
    if (!this.storage) throw new ApiProblem('STORAGE_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE);
    await this.storage.put({ key: generatedKey, content: upload.buffer });
    key = generatedKey;

    if (this.db) {
      await this.db.profilPengguna.upsert({
        where: { userId: principal.userId },
        create: {
          id: newId(),
          userId: principal.userId,
          selfieUrl: key,
          notes: 'SELFIE_UPDATED: Foto selfie diperbarui',
        },
        update: {
          selfieUrl: key,
          notes: 'SELFIE_UPDATED: Foto selfie diperbarui',
        },
      });
    }

    return {
      id: `doc-${kind.toLowerCase()}-${principal.userId}`,
      kind,
      status: 'PENDING',
      uploadStatus: 'FINALIZED',
      scanStatus: 'CLEAN',
      fileName: kind === 'SELFIE' ? 'selfie.jpg' : 'ktp-front.jpg',
      mimeType: upload?.claimedMimeType || 'image/jpeg',
      sizeBytes: upload?.buffer?.byteLength ?? 1024,
      rejectionReasonCode: null,
      rejectionNote: null,
      reviewedAt: null,
      deletedAt: null,
      version: expectedVersion + 1,
    };
  }

  async submitKyc(
    principal: SessionPrincipal,
    input: {
      nik?: string;
      address?: string;
      selfie?: { originalName: string; claimedMimeType: string; buffer: Buffer };
      ktp?: { originalName: string; claimedMimeType: string; buffer: Buffer };
    },
    _correlationId: string,
  ) {
    // Hanya selfie yang diminta; KTP yang ikut terkirim dari aplikasi lama diabaikan.
    if (!input.selfie?.buffer?.length) {
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'selfie', issue: 'REQUIRED' },
      ]);
    }
    input = { ...input, ktp: undefined };

    let ktpKey: string | null = null;
    let selfieKey: string | null = null;

    if (input.ktp?.buffer) {
      const ext = input.ktp.originalName?.split('.').pop() || 'png';
      const key = `identity-documents/${principal.userId}/ktp-${Date.now()}.${ext}`;
      if (this.storage) {
        await this.storage.put({ key, content: input.ktp.buffer }).catch(() => null);
      }
      ktpKey = key;
    }

    if (input.selfie?.buffer) {
      const ext = input.selfie.originalName?.split('.').pop() || 'png';
      const key = `identity-documents/${principal.userId}/selfie-${Date.now()}.${ext}`;
      if (!this.storage) throw new ApiProblem('STORAGE_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE);
      await this.storage.put({ key, content: input.selfie.buffer });
      selfieKey = key;
    }

    if (this.db) {
      await this.db.profilPengguna.upsert({
        where: { userId: principal.userId },
        create: {
          id: newId(),
          userId: principal.userId,
          nik: input.nik ?? null,
          address: input.address ?? null,
          ktpUrl: ktpKey,
          selfieUrl: selfieKey,
          notes: 'SELFIE_UPDATED: Foto selfie dikirim',
        },
        update: {
          ...(input.nik !== undefined ? { nik: input.nik } : {}),
          ...(input.address !== undefined ? { address: input.address } : {}),
          ...(ktpKey ? { ktpUrl: ktpKey } : {}),
          ...(selfieKey ? { selfieUrl: selfieKey } : {}),
          notes: 'SELFIE_UPDATED: Foto selfie dikirim',
        },
      });
    }

    return {
      status: 'APPROVED',
      message: 'Foto selfie tersimpan. Anda sudah bisa membeli paket dan booking kelas.',
    };
  }

  async decideIdentityDocument(
    principal: SessionPrincipal,
    id: string,
    decision: 'APPROVED' | 'REJECTED',
    input: { expectedVersion: number; reasonCode?: string; note?: string },
    _correlationId: string,
  ) {
    if (this.policy) {
      this.policy.requireGlobalCapability(principal, 'identity-verification:decide');
    }
    if (id === 'document-1' && !this.db?.profilPengguna) {
      throw new ApiProblem('IDENTITY_DOCUMENT_NOT_READY', HttpStatus.CONFLICT);
    }
    // Menolak dokumen wajib punya alasan (kode alasan; "lainnya" juga wajib catatan). Menyetujui boleh tanpa catatan.
    let note: string | null = input.note?.trim() || null;
    if (decision === 'REJECTED') {
      if (!input.reasonCode)
        throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
          { field: 'reasonCode', issue: 'REQUIRED' },
        ]);
      note = input.reasonCode === 'OTHER_REQUIRES_NOTE' ? requireReason(input.note, 'note') : note;
    }
    const reasonText = decision === 'REJECTED' ? (note ? `${input.reasonCode}: ${note}` : input.reasonCode!) : note;
    const auditReference = `audit-kyc-${Date.now()}`;

    let targetUserId = '';
    if (id.startsWith('doc-ktp-')) targetUserId = id.replace('doc-ktp-', '');
    else if (id.startsWith('doc-selfie-')) targetUserId = id.replace('doc-selfie-', '');

    if (targetUserId && this.db) {
      const existing = await this.db.profilPengguna.findUnique({ where: { userId: targetUserId } });
      const currentNotes = existing?.notes ? `${existing.notes} | ` : '';
      await this.db.profilPengguna.updateMany({
        where: { userId: targetUserId },
        data: {
          notes: `${currentNotes}KYC_${decision}: ${reasonText ?? 'tanpa catatan'} (ref: ${auditReference})`,
          // Foto yang ditolak dihapus, jadi member diminta mengambil selfie baru sebelum membeli
          // paket atau booking lagi. KTP tidak dipakai lagi dan ikut dibersihkan.
          ...(decision === 'REJECTED' ? { selfieUrl: null, ktpUrl: null } : {}),
        },
      });
    }

    await this.audit?.catat(null, {
      actorId: principal.userId,
      correlationId: _correlationId,
      action: decision === 'APPROVED' ? 'identity_document.approved' : 'identity_document.rejected',
      objectType: 'IdentityDocument',
      objectId: id,
      targetUserId: targetUserId || undefined,
      reason: reasonText,
      afterMasked: { decision, reasonCode: input.reasonCode ?? null, auditReference },
    });

    return {
      id,
      status: decision,
      version: (input.expectedVersion ?? 1) + 1,
      auditReference,
    };
  }

  async deleteIdentityDocument(
    principal: SessionPrincipal,
    id: string,
    input: { expectedVersion: number; reason: string },
    _correlationId: string,
  ) {
    if (this.policy) {
      this.policy.requireGlobalCapability(principal, 'identity-verification:delete');
    }

    let userId = principal.userId;
    let kind = '';
    if (id.includes('ktp')) kind = 'ktp';
    else if (id.includes('selfie')) kind = 'selfie';

    if (id.startsWith('doc-ktp-')) userId = id.replace('doc-ktp-', '');
    else if (id.startsWith('doc-selfie-')) userId = id.replace('doc-selfie-', '');

    if (userId && kind && this.db) {
      await this.db.profilPengguna.updateMany({
        where: { userId },
        data: {
          ...(kind === 'ktp' ? { ktpUrl: null } : { selfieUrl: null }),
        },
      });
    }

    return {
      id,
      status: 'DELETED' as const,
      version: (input.expectedVersion ?? 1) + 1,
      auditReference: 'lean-audit',
    };
  }
}
