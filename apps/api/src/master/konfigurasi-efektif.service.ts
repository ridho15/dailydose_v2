import { HttpStatus, Injectable } from '@nestjs/common';
import type { SessionPrincipal } from '../identity/identity.service';
import { ApiProblem, ENTITY_ID_REGEX } from '../identity/security';
import { MasterAccessService } from './master-access.service';
import { PrismaService } from '../database/prisma.service';
import {
  calculateSlotFee,
  sortFeesNewestFirst,
  type InstructorFeeRow,
} from '../packages/instructor-fee-calculator';

/** Hanya Super Owner: menghapus versi tarif yang sudah berlaku karena salah input. */
export const CAP_KOREKSI_TARIF = 'instructor-fee:correct';

export interface DampakHapusTarif {
  id: string;
  sudahBerlaku: boolean;
  /** Versi ini sama nilainya dengan versi sebelumnya; menghapusnya tidak mengubah honor apa pun. */
  duplikat: boolean;
  kelasTerdampak: number;
  honorSekarangRp: number;
  honorSetelahHapusRp: number;
}

export type SettingKind = 'INSTRUCTOR_FEE' | 'QUOTA_CAPACITY';
export type SettingInput = {
  kind: SettingKind;
  branchId: string;
  classTypeId: string;
  instructorUserId?: string;
  feeRp?: number;
  rateRp?: number;
  minimumQuota?: number;
  cutoffHours?: number;
  defaultCapacity?: number;
  effectiveFrom: string;
  effectiveUntil?: string | null;
  reason: string;
};

const MAX_RATE_RP = 10_000_000;

/** Tanggal hari ini (YYYY-MM-DD) menurut waktu bisnis; tarif efektif dicatat per tanggal. */
const todayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
const dateKey = (value: Date) => value.toISOString().slice(0, 10);

function requireAmount(value: unknown, field: string) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_RATE_RP)
    throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
      { field, issue: 'REQUIRED_POSITIVE_INTEGER' },
    ]);
  return value;
}

function requireEffectiveDate(value: unknown) {
  const date = typeof value === 'string' && value.trim() ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime()))
    throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
      { field: 'effectiveFrom', issue: 'INVALID_DATE' },
    ]);
  return date;
}

@Injectable()
export class EffectiveSettingsService {
  constructor(
    private readonly access: MasterAccessService,
    private readonly db: PrismaService,
  ) {}

  async list(principal: SessionPrincipal, _kind: SettingKind, branchId?: string) {
    this.access.authorize(principal);
    if (branchId) this.access.ensureBranchScope(principal, branchId);

    if (_kind === 'QUOTA_CAPACITY') {
      const scopeWhere: any = {};
      if (branchId) {
        scopeWhere.branchId = branchId;
      } else if (!principal.capabilities.includes('branch:all')) {
        scopeWhere.branchId = { in: principal.branchIds };
      }
      const rows = await this.db.minQuotaSetting.findMany({
        where: scopeWhere,
        include: {
          branch: { select: { id: true, code: true, name: true } },
          classType: { select: { id: true, name: true } },
        },
      });
      return {
        items: rows.map((r) => ({
          id: r.id,
          branchId: r.branchId,
          classTypeId: r.classTypeId,
          minimumQuota: r.minQuota,
          cutoffHours: r.cutoffHours,
          branch: r.branch,
          classType: r.classType,
          createdAt: r.createdAt.toISOString(),
        })),
        page: { nextCursor: null, hasMore: false },
      };
    }

    if (_kind === 'INSTRUCTOR_FEE') {
      const scopeWhere: any = {};
      if (branchId) {
        scopeWhere.branchId = branchId;
      } else if (!principal.capabilities.includes('branch:all')) {
        scopeWhere.branchId = { in: principal.branchIds };
      }
      const rows = await this.db.instructorFee.findMany({
        where: scopeWhere,
        include: {
          instructor: { select: { id: true, displayName: true, email: true } },
          branch: { select: { id: true, code: true, name: true } },
          classType: { select: { id: true, name: true } },
        },
        orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
      });
      // Versi yang nilainya sama dengan versi sebelumnya (instruktur, cabang, tipe kelas sama) tidak
      // mengubah honor apa pun; ditandai supaya mudah dirapikan.
      const duplikat = new Set<string>();
      const terakhir = new Map<string, number>();
      for (const r of [...rows].reverse()) {
        const kunci = `${r.instructorId}|${r.branchId}|${r.classTypeId}`;
        if (terakhir.get(kunci) === r.feePerJamRp) duplikat.add(r.id);
        terakhir.set(kunci, r.feePerJamRp);
      }
      return {
        items: rows.map((r) => ({
          id: r.id,
          instructorId: r.instructorId,
          instructorName: r.instructor?.displayName ?? '-',
          branchId: r.branchId,
          branch: r.branch,
          classTypeId: r.classTypeId,
          classType: r.classType,
          feePerJamRp: r.feePerJamRp,
          effectiveDate: dateKey(r.effectiveDate),
          deletable: dateKey(r.effectiveDate) > todayKey(),
          duplikat: duplikat.has(r.id),
          createdAt: r.createdAt.toISOString(),
        })),
        page: { nextCursor: null, hasMore: false },
      };
    }

    return { items: [], page: { nextCursor: null, hasMore: false } };
  }

  async create(principal: SessionPrincipal, input: SettingInput, _correlationId: string) {
    this.access.authorize(principal, true);

    if (input.kind === 'QUOTA_CAPACITY') {
      const minQuota = input.minimumQuota ?? 3;
      const cutoffHours = input.cutoffHours ?? 24;
      const row = await this.db.minQuotaSetting.upsert({
        where: {
          branchId_classTypeId: {
            branchId: input.branchId,
            classTypeId: input.classTypeId,
          },
        },
        create: {
          branchId: input.branchId,
          classTypeId: input.classTypeId,
          minQuota,
          cutoffHours,
        },
        update: {
          minQuota,
          cutoffHours,
        },
        include: {
          branch: { select: { id: true, code: true, name: true } },
          classType: { select: { id: true, name: true } },
        },
      });
      await this.access.audit(
        this.db,
        principal,
        _correlationId,
        'master.min_quota_saved',
        'MinQuotaSetting',
        row.id,
        row.branchId,
        undefined,
        { classTypeId: row.classTypeId, minQuota: row.minQuota, cutoffHours: row.cutoffHours },
      );
      return {
        id: row.id,
        branchId: row.branchId,
        classTypeId: row.classTypeId,
        minimumQuota: row.minQuota,
        cutoffHours: row.cutoffHours,
        branch: row.branch,
        classType: row.classType,
        createdAt: row.createdAt.toISOString(),
      };
    }

    if (input.kind === 'INSTRUCTOR_FEE') {
      const feePerJamRp = requireAmount(input.feeRp, 'feeRp');
      const effectiveDate = requireEffectiveDate(input.effectiveFrom);
      if (!input.instructorUserId || !ENTITY_ID_REGEX.test(input.instructorUserId))
        throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
          { field: 'instructorUserId', issue: 'REQUIRED' },
        ]);
      const instructorId = input.instructorUserId;
      const row = await this.db.instructorFee.create({
        data: {
          instructorId,
          branchId: input.branchId,
          classTypeId: input.classTypeId,
          feePerJamRp,
          effectiveDate,
        },
        include: {
          instructor: { select: { id: true, displayName: true } },
          branch: { select: { id: true, code: true, name: true } },
          classType: { select: { id: true, name: true } },
        },
      });
      await this.access.audit(
        this.db,
        principal,
        _correlationId,
        'master.instructor_fee_created',
        'InstructorFee',
        row.id,
        row.branchId,
        undefined,
        {
          instructorId: row.instructorId,
          classTypeId: row.classTypeId,
          feePerJamRp: row.feePerJamRp,
          effectiveDate: dateKey(row.effectiveDate),
        },
      );
      return {
        id: row.id,
        instructorId: row.instructorId,
        instructorName: row.instructor?.displayName ?? '-',
        branchId: row.branchId,
        branch: row.branch,
        classTypeId: row.classTypeId,
        classType: row.classType,
        feePerJamRp: row.feePerJamRp,
        effectiveDate: row.effectiveDate.toISOString().slice(0, 10),
        createdAt: row.createdAt.toISOString(),
      };
    }

    return {
      id: `setting-${Date.now()}`,
      ...input,
      effectiveUntil: input.effectiveUntil ?? null,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Akibat menghapus satu versi tarif: kelas selesai yang honornya berubah, dan honornya sebelum
   * dan sesudah. Dipakai dialog konfirmasi sebelum versi keliru dihapus.
   */
  async dampakHapus(principal: SessionPrincipal, id: string): Promise<DampakHapusTarif> {
    // Nominal honor hanya untuk pemegang keuangan, sama seperti yang boleh menghapus tarif.
    this.access.authorize(principal, true);
    if (!principal.capabilities.includes('finance:manage'))
      throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
    if (!ENTITY_ID_REGEX.test(id)) throw new ApiProblem('NOT_FOUND', HttpStatus.NOT_FOUND);
    const row = await this.db.instructorFee.findUnique({ where: { id } });
    if (!row) throw new ApiProblem('NOT_FOUND', HttpStatus.NOT_FOUND);
    this.access.ensureBranchScope(principal, row.branchId, true);
    return this.hitungDampak(this.db, row);
  }

  private async hitungDampak(
    db: Pick<PrismaService, 'instructorFee' | 'slotKelas'>,
    row: InstructorFeeRow & { id: string },
  ): Promise<DampakHapusTarif> {
    const [tarif, slots] = await Promise.all([
      db.instructorFee.findMany({
        where: { instructorId: row.instructorId, classTypeId: row.classTypeId },
      }),
      db.slotKelas.findMany({
        where: {
          instructorId: row.instructorId,
          classTypeId: row.classTypeId,
          status: 'COMPLETED',
          startAt: { gte: row.effectiveDate },
        },
        select: {
          startAt: true,
          endAt: true,
          branchId: true,
          classTypeId: true,
          instructorFeeRp: true,
          isManualFee: true,
        },
      }),
    ]);
    const sekarang = sortFeesNewestFirst(tarif);
    const tanpa = sortFeesNewestFirst(tarif.filter((t) => t.id !== row.id));
    let kelasTerdampak = 0;
    let honorSekarangRp = 0;
    let honorSetelahHapusRp = 0;
    for (const slot of slots) {
      const s = { ...slot, instructorId: row.instructorId };
      const a = calculateSlotFee(sekarang, s).feeRp;
      const b = calculateSlotFee(tanpa, s).feeRp;
      if (a === b) continue;
      kelasTerdampak += 1;
      honorSekarangRp += a;
      honorSetelahHapusRp += b;
    }
    const sebelumnya = sortFeesNewestFirst(
      tarif.filter(
        (t) =>
          t.id !== row.id &&
          t.branchId === row.branchId &&
          t.effectiveDate.getTime() <= row.effectiveDate.getTime(),
      ),
    )[0];
    return {
      id: row.id,
      sudahBerlaku: dateKey(row.effectiveDate) <= todayKey(),
      duplikat: sebelumnya?.feePerJamRp === row.feePerJamRp,
      kelasTerdampak,
      honorSekarangRp,
      honorSetelahHapusRp,
    };
  }

  /**
   * Hapus tarif yang BELUM berlaku (tanggal efektif di masa depan). Tarif yang sudah berlaku dipakai
   * perhitungan honor; hanya Super Owner yang boleh menghapusnya sebagai salah input, dengan alasan
   * minimal 10 karakter, dan dampaknya ikut dicatat di audit.
   */
  async remove(
    principal: SessionPrincipal,
    kind: 'INSTRUCTOR_FEE',
    id: string,
    correlationId: string,
    reasonInput?: string,
    salahInput = false,
  ) {
    this.access.authorize(principal, true);
    if (!principal.capabilities.includes('finance:manage'))
      throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
    if (!ENTITY_ID_REGEX.test(id)) throw new ApiProblem('NOT_FOUND', HttpStatus.NOT_FOUND);
    // Menghapus tarif wajib beralasan (K4).
    const reason = typeof reasonInput === 'string' ? reasonInput.trim() : '';
    if (reason.length < 3 || reason.length > 500)
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'reason', issue: reason.length === 0 ? 'REQUIRED' : reason.length < 3 ? 'TOO_SHORT' : 'TOO_LONG' },
      ]);

    return this.db.$transaction(async (tx) => {
      const row = await tx.instructorFee.findUnique({ where: { id } });
      if (!row) throw new ApiProblem('NOT_FOUND', HttpStatus.NOT_FOUND);
      this.access.ensureBranchScope(principal, row.branchId, true);
      const sudahBerlaku = dateKey(row.effectiveDate) <= todayKey();
      let dampak: DampakHapusTarif | undefined;
      if (sudahBerlaku) {
        if (!salahInput) throw new ApiProblem('RATE_IN_EFFECT', HttpStatus.CONFLICT);
        if (!principal.capabilities.includes(CAP_KOREKSI_TARIF))
          throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
        if (reason.length < 10)
          throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
            { field: 'reason', issue: 'TOO_SHORT' },
          ]);
        dampak = await this.hitungDampak(tx as never, row);
      }

      await tx.instructorFee.delete({ where: { id } });

      await this.access.audit(
        tx,
        principal,
        correlationId,
        sudahBerlaku ? 'master.instructor_fee_deleted_effective' : 'master.instructor_fee_deleted',
        'InstructorFee',
        id,
        row.branchId,
        {
          instructorId: row.instructorId,
          classTypeId: row.classTypeId,
          effectiveDate: dateKey(row.effectiveDate),
          feePerJamRp: row.feePerJamRp,
          ...(dampak ? { dampak: { ...dampak } } : {}),
        },
        undefined,
        reason,
      );
      return { id, deleted: true };
    });
  }

  async deactivate(principal: SessionPrincipal, id: string, _correlationId: string) {
    this.access.authorize(principal, true);
    return { id, deactivated: true };
  }
}
