import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { Prisma, type PublicContent } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../foundation/audit.service';
import { optionalReason } from '../foundation/reason';
import type { SessionPrincipal } from '../identity/identity.service';
import { PolicyService } from '../identity/policy.service';
import { ApiProblem } from '../identity/security';
import { FAQ_CONTENT_KEY, FAQ_KIND, FAQ_LOCALE, validateFaq } from './faq.validation';
import {
  HERO_CONTENT_KEY,
  HERO_KIND,
  HERO_LOCALE,
  validateHeroCarousel,
} from './hero-carousel.validation';

const GLOBAL_SCOPE = 'GLOBAL';

/**
 * Jenis konten yang benar-benar dibaca situs publik. Konten tanpa pembaca tidak boleh disimpan.
 * Slider hero hanya tampil di beranda yang berbahasa Inggris, jadi isinya disimpan sebagai en-US;
 * isi id-ID lama tetap di database dan dipakai editor sebagai titik awal terjemahan.
 */
const SUPPORTED_KINDS: Record<
  string,
  { contentKey: string; locale: string; validate(payload: unknown): unknown }
> = {
  [HERO_KIND]: { contentKey: HERO_CONTENT_KEY, locale: HERO_LOCALE, validate: validateHeroCarousel },
  [FAQ_KIND]: { contentKey: FAQ_CONTENT_KEY, locale: FAQ_LOCALE, validate: validateFaq },
};

const invalid = (field: string, issue = 'INVALID') =>
  new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [{ field, issue }]);

@Injectable()
export class PublicContentManagementService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  /** Jejak audit permanen; isi konten tidak disalin (bisa besar), cukup identitas dan versinya. */
  private async record(
    principal: SessionPrincipal,
    correlationId: string,
    action: string,
    row: { id: string; contentKey: string; kind: string; version: number; status: string },
    before?: { status: string },
    reason?: string | null,
  ) {
    await this.audit?.catat(null, {
      actorId: principal.userId,
      correlationId,
      action,
      objectType: 'PublicContent',
      objectId: row.id,
      reason: reason ?? null,
      beforeMasked: before,
      afterMasked: {
        contentKey: row.contentKey,
        kind: row.kind,
        version: row.version,
        status: row.status,
      },
    });
  }

  private view(row: PublicContent) {
    return {
      id: row.id,
      contentKey: row.contentKey,
      branchId: row.branchId,
      scopeKey: row.scopeKey,
      kind: row.kind,
      locale: row.locale,
      version: row.version,
      status: row.status,
      payload: row.payload,
      createdById: row.createdById,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      publishedAt: row.publishedAt?.toISOString() ?? null,
      archivedAt: row.archivedAt?.toISOString() ?? null,
    };
  }

  /** Konten global memengaruhi seluruh situs, jadi hanya pemegang `branch:all` yang boleh mengubahnya. */
  private assertManage(principal: SessionPrincipal, branchId: string | null) {
    this.policy.requireCapability(principal.capabilities, 'public-content:manage');
    const allowed = branchId
      ? this.policy.hasCapability(principal, 'public-content:manage', branchId)
      : this.policy.capabilityBranchScope(principal, 'public-content:manage').all;
    if (!allowed) throw new ApiProblem('NOT_FOUND', HttpStatus.NOT_FOUND);
  }

  /** Isi yang sedang tampil di situs (satu per jenis konten). Baris draf/arsip lama tidak ditampilkan lagi. */
  async list(principal: SessionPrincipal, input: { branchId?: string; kind?: string }) {
    this.policy.requireCapability(principal.capabilities, 'public-content:read');
    const scope = this.policy.capabilityBranchScope(principal, 'public-content:read');
    const rows = await this.db.publicContent.findMany({
      where: {
        AND: [
          { status: 'PUBLISHED' },
          input.kind ? { kind: input.kind.toUpperCase() } : {},
          input.branchId ? { branchId: input.branchId } : {},
          // Konten global hanya terlihat pemegang cakupan semua cabang; konten cabang mengikuti cakupan.
          scope.all ? {} : { branchId: { in: scope.included } },
        ],
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    return rows.map((row) => this.view(row));
  }

  private supportedKind(kindParam: string) {
    const kind = kindParam?.trim().toUpperCase();
    const supported = SUPPORTED_KINDS[kind];
    if (!supported) throw invalid('kind', 'UNSUPPORTED');
    return { kind, ...supported };
  }

  /**
   * Simpan isi konten dan langsung tampilkan di situs. Satu isi aktif per jenis konten: bila sudah ada, isinya
   * diganti; bila belum, dibuat. Tidak ada draf, versi, atau arsip.
   */
  async save(principal: SessionPrincipal, kindParam: string, input: { payload: unknown }, correlationId: string) {
    const { kind, contentKey, locale, validate } = this.supportedKind(kindParam);
    this.assertManage(principal, null);
    const payload = validate(input?.payload) as Prisma.InputJsonValue;
    const where = { contentKey, scopeKey: GLOBAL_SCOPE, locale };

    const active = await this.db.publicContent.findFirst({
      where: { ...where, status: 'PUBLISHED' },
      orderBy: { version: 'desc' },
    });
    if (active) {
      const updated = await this.db.publicContent.update({ where: { id: active.id }, data: { payload } });
      const result = this.view(updated);
      await this.record(principal, correlationId, 'public_content.updated', result, { status: active.status });
      return result;
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const latest = await this.db.publicContent.aggregate({ where, _max: { version: true } });
      try {
        const created = await this.db.publicContent.create({
          data: {
            ...where,
            kind,
            payload,
            branchId: null,
            version: (latest._max.version ?? 0) + 1,
            status: 'PUBLISHED',
            publishedAt: new Date(),
            createdById: principal.userId,
          },
        });
        const result = this.view(created);
        await this.record(principal, correlationId, 'public_content.published', result);
        return result;
      } catch (error) {
        // Dua penyimpanan pertama bersamaan mendapat nomor versi yang sama; ulangi dengan nomor berikutnya.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      }
    }
    throw new ApiProblem('CONFLICT', HttpStatus.CONFLICT);
  }

  /** Kembalikan situs ke tampilan bawaan: isi aktif diarsipkan. Alasan opsional (3–500 karakter bila diisi). */
  async reset(principal: SessionPrincipal, kindParam: string, correlationId: string, reasonInput?: string) {
    const { contentKey, locale } = this.supportedKind(kindParam);
    const reason = optionalReason(reasonInput) ?? '';
    this.assertManage(principal, null);
    const where = { contentKey, scopeKey: GLOBAL_SCOPE, locale, status: 'PUBLISHED' as const };
    const active = await this.db.publicContent.findMany({ where });
    if (active.length === 0) return { reset: false };
    await this.db.publicContent.updateMany({ where, data: { status: 'ARCHIVED', archivedAt: new Date() } });
    for (const row of active)
      await this.record(
        principal,
        correlationId,
        'public_content.archived',
        { ...row, status: 'ARCHIVED' },
        { status: row.status },
        reason || null,
      );
    return { reset: true };
  }
}
