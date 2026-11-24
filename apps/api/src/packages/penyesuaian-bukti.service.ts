import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../foundation/audit.service';
import type { SessionPrincipal } from '../identity/identity.service';
import { PolicyService } from '../identity/policy.service';
import { PRIVATE_FILE_STORAGE, type PrivateFileStorage } from '../identity/private-file-storage';
import { ApiProblem } from '../identity/security';
import { LedgerService } from './ledger.service';

/**
 * Penyesuaian sesi member yang wajib disertai alasan dan bukti.
 *
 * Penyesuaian langsung (`LedgerService.directAdjustment`) sudah menulis buku besar sesi dan
 * audit. Yang ditambahkan di sini adalah syarat yang disepakati: alasan yang masih bisa dipahami
 * orang lain kelak, dan berkas bukti (tangkapan layar percakapan, surat dokter, foto catatan studio).
 *
 * Bukti disimpan lebih dulu di penyimpanan privat dengan kunci dari id penyesuaian, baru kemudian
 * sesinya diubah. Urutan ini mencegah penyesuaian yang berlaku tanpa bukti bila penyimpanan gagal;
 * bila justru penyesuaiannya yang gagal, berkasnya dihapus kembali. Tidak ada kolom baru di
 * database: letak bukti diturunkan dari id penyesuaian itu sendiri.
 */

export const MIN_ALASAN_PENYESUAIAN = 20;
/** Awalan catatan penyesuaian yang diputus Owner tanpa bukti dari member. */
export const PENANDA_DISETUJUI_OWNER = '[DISETUJUI OWNER]';
const MAKS_ALASAN = 500;
const MAKS_BUKTI_BYTE = 8_000_000;

type Jenis = { ext: string; mime: string };
export const JENIS_BUKTI: Jenis[] = [
  { ext: 'jpg', mime: 'image/jpeg' },
  { ext: 'png', mime: 'image/png' },
  { ext: 'webp', mime: 'image/webp' },
  { ext: 'pdf', mime: 'application/pdf' },
];

/** Jenis berkas dari byte awalnya, bukan dari nama atau tipe yang diaku peramban. */
export function kenaliBukti(buffer: Buffer): Jenis | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return JENIS_BUKTI[0]!;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return JENIS_BUKTI[1]!;
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return JENIS_BUKTI[2]!;
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') return JENIS_BUKTI[3]!;
  return null;
}

export const kunciBukti = (id: string, ext: string) => `adjustment-evidence/${id}.${ext}`;

@Injectable()
export class PenyesuaianBuktiService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly ledger: LedgerService,
    @Optional() private readonly audit?: AuditService,
    @Optional() @Inject(PRIVATE_FILE_STORAGE) private readonly storage?: PrivateFileStorage,
  ) {}

  async sesuaikan(
    principal: SessionPrincipal,
    body: {
      customerPackageId?: string;
      quantity?: number | string;
      reason?: string;
      bookingId?: string;
      /** "true": keputusan Owner/Super Owner tanpa bukti dari member (audit 24 November 2026). */
      ownerApproved?: string | boolean;
    },
    bukti: { buffer?: Buffer; size?: number } | undefined,
  ) {
    this.policy.requireCapability(principal.capabilities, 'ledger:adjust:decide');
    const tanpaBuktiOwner = body.ownerApproved === true || body.ownerApproved === 'true';
    if (tanpaBuktiOwner && !principal.roles.some((r) => r.role === 'OWNER' || r.role === 'SUPER_OWNER'))
      throw new ApiProblem('OWNER_APPROVAL_REQUIRED', HttpStatus.FORBIDDEN, false, [
        { field: 'ownerApproved', issue: 'OWNER_ONLY' },
      ]);

    const alasan = (body.reason ?? '').trim();
    if (alasan.length < MIN_ALASAN_PENYESUAIAN || alasan.length > MAKS_ALASAN) {
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        {
          field: 'reason',
          issue: alasan.length < MIN_ALASAN_PENYESUAIAN ? 'TOO_SHORT' : 'TOO_LONG',
        },
      ]);
    }
    const adaBerkas = Boolean(bukti?.buffer && bukti.buffer.length > 0);
    if (!adaBerkas && tanpaBuktiOwner) return this.sesuaikanTanpaBukti(principal, body, alasan);
    if (!bukti?.buffer || bukti.buffer.length === 0) {
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'evidence', issue: 'REQUIRED' },
      ]);
    }
    if (bukti.buffer.length > MAKS_BUKTI_BYTE) {
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'evidence', issue: 'TOO_LARGE' },
      ]);
    }
    const jenis = kenaliBukti(bukti.buffer);
    if (!jenis) {
      throw new ApiProblem('UPLOAD_REJECTED', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'evidence', issue: 'UNSUPPORTED_TYPE' },
      ]);
    }
    if (!this.storage) throw new ApiProblem('STORAGE_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE);

    const quantity = typeof body.quantity === 'string' ? Number(body.quantity) : body.quantity;
    const id = randomUUID();
    const kunci = kunciBukti(id, jenis.ext);
    await this.storage.put({ key: kunci, content: bukti.buffer });

    let hasil: Awaited<ReturnType<LedgerService['directAdjustment']>>;
    try {
      hasil = await this.ledger.directAdjustment(principal, {
        id,
        customerPackageId: body.customerPackageId,
        quantity,
        bookingId: body.bookingId || undefined,
        reasonCode: body.bookingId ? 'ATTENDANCE_CORRECTION' : 'PACKAGE_COMPENSATION',
        note: alasan,
      });
    } catch (error) {
      await this.storage.delete(kunci).catch(() => undefined);
      throw error;
    }

    await this.audit?.catat(null, {
      actorId: principal.userId,
      action: 'SESSION_ADJUSTMENT_EVIDENCE_ATTACHED',
      objectType: 'SessionAdjustRequest',
      objectId: id,
      reason: alasan,
      afterMasked: { mime: jenis.mime, sizeBytes: bukti.buffer.length },
    });

    return { ...hasil, evidenceUrl: `/api/v1/session-adjustments/${id}/evidence` };
  }

  /**
   * Penyesuaian atas keputusan Owner/Super Owner tanpa lampiran: catatannya ditandai
   * "[DISETUJUI OWNER]" dan tercatat di audit log dengan nama pemutusnya, sebagai pengganti bukti.
   */
  private async sesuaikanTanpaBukti(
    principal: SessionPrincipal,
    body: { customerPackageId?: string; quantity?: number | string; bookingId?: string },
    alasan: string,
  ) {
    const quantity = typeof body.quantity === 'string' ? Number(body.quantity) : body.quantity;
    const id = randomUUID();
    const catatan = `${PENANDA_DISETUJUI_OWNER} ${alasan}`.slice(0, 500);
    const hasil = await this.ledger.directAdjustment(principal, {
      id,
      customerPackageId: body.customerPackageId,
      quantity,
      bookingId: body.bookingId || undefined,
      reasonCode: body.bookingId ? 'ATTENDANCE_CORRECTION' : 'PACKAGE_COMPENSATION',
      note: catatan,
    });
    await this.audit?.catat(null, {
      actorId: principal.userId,
      action: 'SESSION_ADJUSTMENT_OWNER_APPROVED_WITHOUT_EVIDENCE',
      objectType: 'SessionAdjustRequest',
      objectId: id,
      reason: alasan,
      afterMasked: { ownerApproved: true },
    });
    return { ...hasil, evidenceUrl: null };
  }

  /** Membuka bukti penyesuaian; hanya untuk yang boleh membaca penyesuaian di cabang paket itu. */
  async bukti(
    principal: SessionPrincipal,
    id: string,
  ): Promise<{ mimeType: string; stream: Readable }> {
    // Pemeriksaan hak akses dan cakupan cabang memakai jalur yang sama dengan detail penyesuaian.
    await this.ledger.getAdjustment(principal, id);
    const tidakAda = () => new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (!this.storage) throw tidakAda();
    for (const jenis of JENIS_BUKTI) {
      const kunci = kunciBukti(id, jenis.ext);
      if (await this.storage.exists(kunci).catch(() => false)) {
        return { mimeType: jenis.mime, stream: await this.storage.read(kunci) };
      }
    }
    throw tidakAda();
  }
}
