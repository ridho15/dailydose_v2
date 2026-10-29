import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../foundation/audit.service';
import { requireReason } from '../foundation/reason';
import type { SessionPrincipal } from '../identity/identity.service';
import { PolicyService } from '../identity/policy.service';
import { ApiProblem } from '../identity/security';
import { calculateSlotFee, summarizeInstructorFees } from './instructor-fee-calculator';
import { koreksiHonorDalamRentang } from './koreksi-jam.service';
import {
  financeRange,
  otherCostDay,
  otherCostInRange,
  parseIncurredOn,
} from './finance-range';

/** Rentang laporan: `from`/`until` (inklusif, `YYYY-MM-DD`); `period` (`YYYY-MM`) adalah singkatan satu bulan penuh. */
export interface FinanceQuery {
  branchId?: string;
  from?: string;
  until?: string;
  period?: string;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const EXPORT_MAX_DAYS = 366;
const EXPORT_MAX_ROWS = 50_000;

/** Uang pada kontrak API memakai satuan minor (sen). */
const toMoney = (rupiah: number) => ({ amountMinor: rupiah * 100, currency: 'IDR' });

const problem = (code: string, status: HttpStatus, field?: string) =>
  new ApiProblem(code, status, false, field ? [{ field, issue: code }] : []);

/** Sel teks CSV: dikutip bila perlu dan dinetralkan dari injeksi rumus spreadsheet. */
function csvText(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

@Injectable()
export class FinanceService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  private ensureBranchAccess(principal: SessionPrincipal, targetBranchId?: string) {
    const isGlobal =
      principal.capabilities.includes('branch:all') ||
      principal.roles.some((r) =>
        ['SUPER_OWNER', 'FINANCE'].includes(r.role as string),
      );
    if (isGlobal) return;

    if (!targetBranchId || !principal.branchIds.includes(targetBranchId)) {
      throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
    }
  }

  // ============================================================================
  // 5 LAPORAN INTI KEUANGAN
  // ============================================================================

  /**
   * 1. Laporan Omset Penjualan Paket
   */
  async omsetReport(principal: SessionPrincipal, input: FinanceQuery) {
    this.policy.requireCapability(principal.capabilities, 'finance:read');
    this.ensureBranchAccess(principal, input.branchId);
    const range = financeRange(input);

    const isGlobal =
      principal.capabilities.includes('branch:all') ||
      principal.roles.some((r) =>
        ['SUPER_OWNER', 'FINANCE'].includes(r.role as string),
      );

    const branchFilter = input.branchId
      ? { branchId: input.branchId }
      : isGlobal
      ? {}
      : { branchId: { in: principal.branchIds } };

    const purchases = await this.db.pembelian.findMany({
      where: {
        ...branchFilter,
        status: 'PAID',
        paidAt: { gte: range.fromDate, lt: range.untilExclusive },
      },
      include: {
        branch: { select: { id: true, code: true, name: true } },
        user: { select: { id: true, displayName: true, email: true } },
        package: { select: { id: true, name: true, sessionCount: true } },
      },
      orderBy: { paidAt: 'desc' },
    });

    const totalOmsetRp = purchases.reduce((sum, p) => sum + p.totalAmountRp, 0);

    const byPaymentMethod: Record<string, { count: number; amountRp: number }> = {};
    for (const p of purchases) {
      const method = p.paymentMethod || 'UNKNOWN';
      if (!byPaymentMethod[method]) {
        byPaymentMethod[method] = { count: 0, amountRp: 0 };
      }
      byPaymentMethod[method].count += 1;
      byPaymentMethod[method].amountRp += p.totalAmountRp;
    }

    return {
      period: range.label,
      from: range.from,
      until: range.until,
      branchId: input.branchId ?? 'ALL',
      totalOmsetRp,
      totalTransactionCount: purchases.length,
      byPaymentMethod,
      transactions: purchases.map((p) => ({
        id: p.id,
        orderNumber: p.invoiceNumber,
        invoiceNumber: p.invoiceNumber,
        packageName: p.package.name,
        customerName: p.user.displayName,
        totalAmountRp: p.totalAmountRp,
        paymentMethod: p.paymentMethod,
        paidAt: p.paidAt ? p.paidAt.toISOString() : p.createdAt.toISOString(),
        branchName: p.branch.name,
      })),
    };
  }

  /**
   * 2. Laporan Cost Instruktur Realtime (Jam Mengajar Aktual via QR x Fee/Jam Effective Date)
   * Menyediakan rekapitulasi per instruktur dan rincian per sesi kelas (termasuk status presensi & geofence).
   */
  async realtimeInstructorCostReport(principal: SessionPrincipal, input: FinanceQuery) {
    this.policy.requireCapability(principal.capabilities, 'finance:read');
    this.ensureBranchAccess(principal, input.branchId);
    const range = financeRange(input);

    const isGlobal =
      principal.capabilities.includes('branch:all') ||
      principal.roles.some((r) =>
        ['SUPER_OWNER', 'FINANCE'].includes(r.role as string),
      );

    const branchFilter = input.branchId
      ? { branchId: input.branchId }
      : isGlobal
      ? {}
      : { branchId: { in: principal.branchIds } };

    const slots = await this.db.slotKelas.findMany({
      where: {
        ...branchFilter,
        startAt: { gte: range.fromDate, lt: range.untilExclusive },
        status: 'COMPLETED',
      },
      include: {
        instructor: true,
        classType: true,
        branch: true,
        instructorAttendance: {
          select: {
            id: true,
            checkedInAt: true,
            latitude: true,
            longitude: true,
            distanceMeters: true,
            isWithinGeofence: true,
          },
        },
      },
      orderBy: { startAt: 'asc' },
    });

    const fees = await this.db.instructorFee.findMany({
      where: input.branchId ? { branchId: input.branchId } : {},
      orderBy: { effectiveDate: 'desc' },
    });

    const instructorBreakdown = summarizeInstructorFees(slots as any, fees);
    // Koreksi jam (dengan alasan dan bukti) ikut dihitung pada bulan kelasnya.
    const koreksi = await koreksiHonorDalamRentang(this.db, {
      branchFilter,
      fromDate: range.fromDate,
      untilExclusive: range.untilExclusive,
    });
    const totalInstructorCostRp =
      instructorBreakdown.reduce((sum, item) => sum + item.totalFeeRp, 0) + koreksi.totalRp;
    const totalTeachingHours = instructorBreakdown.reduce((sum, item) => sum + item.totalHours, 0);
    const totalUnverifiedFeeRp = instructorBreakdown.reduce(
      (sum, item) => sum + item.unverifiedFeeRp,
      0,
    );
    const unverifiedClassCount = instructorBreakdown.reduce(
      (sum, item) => sum + item.unverifiedClassCount,
      0,
    );
    const unconfiguredClassCount = instructorBreakdown.reduce(
      (sum, item) => sum + item.unconfiguredFeeClassCount,
      0,
    );
    const instructorFeeMissing = slots.length > 0 && (fees.length === 0 || unconfiguredClassCount > 0);

    const sessions = slots.map((s) => {
      const slotAny = s as any;
      const slotFee = s.instructorId
        ? calculateSlotFee(fees, {
            startAt: s.startAt,
            endAt: s.endAt,
            branchId: s.branchId,
            classTypeId: s.classTypeId,
            instructorId: s.instructorId,
            instructorFeeRp: slotAny.instructorFeeRp,
            isManualFee: slotAny.isManualFee,
          })
        : { hours: 0, feePerJamRp: 0, feeRp: 0, configured: false, isManual: false };

      const att = slotAny.instructorAttendance;
      return {
        slotId: s.id,
        startAt: s.startAt.toISOString(),
        endAt: s.endAt.toISOString(),
        branchId: s.branchId,
        branchName: slotAny.branch?.name ?? '-',
        classTypeId: s.classTypeId,
        classTypeName: slotAny.classType?.name ?? '-',
        instructorId: s.instructorId ?? '-',
        instructorName: slotAny.instructor?.displayName ?? '(Belum Ditugaskan)',
        teachingHours: slotFee.hours,
        feePerJamRp: slotFee.feePerJamRp,
        feeRp: slotFee.feeRp,
        isManualFee: Boolean(slotAny.isManualFee),
        attendanceVerified: Boolean(att),
        attendanceTime: att?.checkedInAt ? new Date(att.checkedInAt).toISOString() : null,
        latitude: att?.latitude ? Number(att.latitude) : null,
        longitude: att?.longitude ? Number(att.longitude) : null,
        distanceMeters: att?.distanceMeters ?? null,
        isWithinGeofence: att?.isWithinGeofence ?? null,
      };
    });

    return {
      period: range.label,
      from: range.from,
      until: range.until,
      branchId: input.branchId ?? 'ALL',
      totalInstructorCostRp,
      /** Bagian dari total yang berasal dari koreksi jam; bisa negatif. */
      adjustmentRp: koreksi.totalRp,
      adjustmentCount: koreksi.jumlah,
      // Beban instruktur hanya dari kelas terverifikasi; yang belum terverifikasi tidak termasuk.
      totalVerifiedFeeRp: totalInstructorCostRp,
      totalUnverifiedFeeRp,
      unverifiedClassCount,
      unconfiguredClassCount,
      instructorFeeMissing,
      totalTeachingHours,
      instructorCount: instructorBreakdown.length,
      instructors: instructorBreakdown,
      sessions,
    };
  }

  /**
   * 3. Laporan Cost Lain-lain (OtherCost)
   */
  async otherCostReport(principal: SessionPrincipal, input: FinanceQuery) {
    this.policy.requireCapability(principal.capabilities, 'finance:read');
    this.ensureBranchAccess(principal, input.branchId);
    const range = financeRange(input);

    const isGlobal =
      principal.capabilities.includes('branch:all') ||
      principal.roles.some((r) =>
        ['SUPER_OWNER', 'FINANCE'].includes(r.role as string),
      );

    const branchFilter = input.branchId
      ? { branchId: input.branchId }
      : isGlobal
      ? {}
      : { branchId: { in: principal.branchIds } };

    const costs = await this.db.otherCost.findMany({
      where: {
        ...branchFilter,
        ...otherCostInRange(range),
      },
      include: {
        branch: { select: { id: true, code: true, name: true } },
        createdBy: { select: { id: true, displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalOtherCostRp = costs.reduce((sum, c) => sum + c.amountRp, 0);

    const byCategory: Record<string, { count: number; amountRp: number }> = {};
    for (const c of costs) {
      const cat = c.category;
      if (!byCategory[cat]) {
        byCategory[cat] = { count: 0, amountRp: 0 };
      }
      byCategory[cat].count += 1;
      byCategory[cat].amountRp += c.amountRp;
    }

    return {
      period: range.label,
      from: range.from,
      until: range.until,
      branchId: input.branchId ?? 'ALL',
      totalOtherCostRp,
      byCategory,
      items: costs
        .map((c) => ({ cost: c, day: otherCostDay(c) }))
        .sort((x, y) => (x.day === y.day ? y.cost.createdAt.getTime() - x.cost.createdAt.getTime() : x.day < y.day ? 1 : -1))
        .map(({ cost: c, day }) => ({
        id: c.id,
        branchId: c.branchId,
        branchName: c.branch.name,
        period: c.period,
        incurredOn: day,
        category: c.category,
        description: c.description,
        amountRp: c.amountRp,
        createdByName: c.createdBy?.displayName ?? '-',
        createdAt: c.createdAt.toISOString(),
      })),
    };
  }

  /**
   * 4. Laporan Laba Bersih untuk rentang tanggal: omzet dikurangi honor instruktur aktual dan biaya lain.
   */
  async profitReport(principal: SessionPrincipal, input: FinanceQuery) {
    this.policy.requireCapability(principal.capabilities, 'finance:read');
    this.ensureBranchAccess(principal, input.branchId);
    const range = financeRange(input);
    const scope = { branchId: input.branchId, from: range.from, until: range.until };

    const [omsetRes, realtimeRes, otherCostRes] = await Promise.all([
      this.omsetReport(principal, scope),
      this.realtimeInstructorCostReport(principal, scope),
      this.otherCostReport(principal, scope),
    ]);

    const omsetRp = omsetRes.totalOmsetRp;
    const costRealtimeRp = realtimeRes.totalInstructorCostRp;
    const otherCostRp = otherCostRes.totalOtherCostRp;
    const grossProfitRp = omsetRp - costRealtimeRp;
    const netProfitRealtimeRp = grossProfitRp - otherCostRp;
    const margin = (value: number) => (omsetRp > 0 ? Math.round((value / omsetRp) * 1000) / 10 : 0);

    return {
      period: range.label,
      from: range.from,
      until: range.until,
      branchId: input.branchId ?? 'ALL',
      omsetRp,
      costRealtimeRp,
      grossProfitRp,
      grossMarginPercent: margin(grossProfitRp),
      otherCostRp,
      netProfitRealtimeRp,
      netMarginPercent: margin(netProfitRealtimeRp),
    };
  }

  // ============================================================================
  // BIAYA OPERASIONAL LAIN (BERTANGGAL)
  // ============================================================================

  async createOtherCost(
    principal: SessionPrincipal,
    input: {
      branchId: string;
      /** Tanggal pengeluaran `YYYY-MM-DD`. */
      incurredOn?: string;
      /** Singkatan lama: bulan `YYYY-MM`, dicatat pada tanggal 1. */
      period?: string;
      category?: string;
      categoryCode?: string;
      description: string;
      amountRp: number;
      /** Super Owner yang membayar dengan uang pribadi; kosong berarti kas cabang. */
      dibayarOlehId?: string | null;
    },
  ) {
    // Admin dan Manager mencatat pembelian barang cabangnya (jurnal kas); mengubah atau menghapus
    // catatan tetap butuh `finance:manage`.
    this.policy.requireAnyCapability(principal.capabilities, ['finance:manage', 'expense:create']);
    this.ensureBranchAccess(principal, input.branchId);

    if (!Number.isInteger(input.amountRp) || input.amountRp <= 0) {
      throw new ApiProblem('INVALID_AMOUNT', HttpStatus.BAD_REQUEST);
    }
    const incurredOn = this.costDay(input);
    // Aturan yang sama dengan updateOtherCost: keterangan 1-2000 karakter, kategori kode huruf besar.
    const description = String(input.description ?? '').trim();
    if (description.length < 1 || description.length > 2000)
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'description', issue: 'INVALID' },
      ]);
    const category = (input.categoryCode ?? input.category)?.trim().toUpperCase() || 'OTHER';
    if (!/^[A-Z][A-Z0-9_]{1,63}$/u.test(category))
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'category', issue: 'INVALID' },
      ]);
    // Cabang yang tidak ada (Super Owner lolos pemeriksaan akses cabang) harus berupa 404, bukan galat basis data.
    const branch = await this.db.cabang.findUnique({ where: { id: input.branchId }, select: { id: true } });
    if (!branch) throw new ApiProblem('NOT_FOUND', HttpStatus.NOT_FOUND);
    const dibayarOlehId = input.dibayarOlehId || null;
    if (dibayarOlehId) {
      const pembayar = await this.db.user.findUnique({
        where: { id: dibayarOlehId },
        select: { role: true, status: true },
      });
      if (pembayar?.role !== 'SUPER_OWNER' || pembayar.status !== 'ACTIVE')
        throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
          { field: 'dibayarOlehId', issue: 'NOT_SUPER_OWNER' },
        ]);
    }

    const created = await this.db.otherCost.create({
      data: {
        branchId: input.branchId,
        period: incurredOn.toISOString().slice(0, 7),
        incurredOn,
        category,
        description,
        amountRp: input.amountRp,
        createdById: principal.userId,
      },
    });
    if (dibayarOlehId)
      await this.db.pembayarPengeluaran.create({
        data: { otherCostId: created.id, dibayarOlehId },
      });
    await this.audit.catat(null, {
      actorId: principal.userId,
      branchId: created.branchId,
      action: 'finance.other_cost_created',
      objectType: 'OtherCost',
      objectId: created.id,
      afterMasked: {
        incurredOn: incurredOn.toISOString().slice(0, 10),
        category: created.category,
        amountRp: created.amountRp,
        dibayarOlehId,
      },
    });
    return created;
  }

  /** Tanggal pengeluaran dari `incurredOn`, atau dari `period` (tanggal 1) untuk pemanggil lama. */
  private costDay(input: { incurredOn?: string; period?: string }): Date {
    if (input.incurredOn !== undefined) return parseIncurredOn(input.incurredOn);
    if (input.period && MONTH.test(input.period)) return parseIncurredOn(`${input.period}-01`, 'period');
    throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
      { field: 'incurredOn', issue: 'REQUIRED' },
    ]);
  }

  async listOtherCosts(
    principal: SessionPrincipal,
    query: FinanceQuery & { cursor?: string },
  ) {
    const report = await this.otherCostReport(principal, query);
    return {
      items: report.items,
      total: report.items.length,
      page: { hasMore: false, nextCursor: null },
    };
  }

  /** Ubah tanggal, kategori, keterangan, atau nominal biaya lain. */
  async updateOtherCost(
    principal: SessionPrincipal,
    id: string,
    input: {
      incurredOn?: string;
      category?: string;
      categoryCode?: string;
      description?: string;
      amountRp?: number;
    },
  ) {
    this.policy.requireCapability(principal.capabilities, 'finance:manage');
    const existing = await this.db.otherCost.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiProblem('NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    this.ensureBranchAccess(principal, existing.branchId);

    const data: {
      incurredOn?: Date;
      period?: string;
      category?: string;
      description?: string;
      amountRp?: number;
    } = {};
    if (input.incurredOn !== undefined) {
      const incurredOn = parseIncurredOn(input.incurredOn);
      data.incurredOn = incurredOn;
      data.period = incurredOn.toISOString().slice(0, 7);
    }
    const rawCategory = input.categoryCode ?? input.category;
    if (rawCategory !== undefined) {
      const category = String(rawCategory).trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9_]{1,63}$/u.test(category))
        throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
          { field: 'category', issue: 'INVALID' },
        ]);
      data.category = category;
    }
    if (input.description !== undefined) {
      const description = String(input.description).trim();
      if (description.length < 1 || description.length > 2000)
        throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
          { field: 'description', issue: 'INVALID' },
        ]);
      data.description = description;
    }
    if (input.amountRp !== undefined) {
      if (!Number.isInteger(input.amountRp) || input.amountRp <= 0)
        throw new ApiProblem('INVALID_AMOUNT', HttpStatus.BAD_REQUEST);
      data.amountRp = input.amountRp;
    }
    if (Object.keys(data).length === 0)
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY);

    const updated = await this.db.otherCost.update({ where: { id }, data });
    await this.audit.catat(null, {
      actorId: principal.userId,
      branchId: existing.branchId,
      action: 'finance.other_cost_updated',
      objectType: 'OtherCost',
      objectId: id,
      beforeMasked: { incurredOn: otherCostDay(existing), category: existing.category, amountRp: existing.amountRp },
      afterMasked: {
        incurredOn: otherCostDay(updated),
        category: updated.category,
        amountRp: updated.amountRp,
      },
    });
    return updated;
  }

  async deleteOtherCost(principal: SessionPrincipal, id: string, reasonInput?: string) {
    this.policy.requireCapability(principal.capabilities, 'finance:manage');
    // Menghapus biaya wajib beralasan (K4).
    const reason = requireReason(reasonInput);
    const existing = await this.db.otherCost.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiProblem('NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    this.ensureBranchAccess(principal, existing.branchId);

    await this.db.otherCost.delete({ where: { id } });
    await this.db.pembayarPengeluaran.deleteMany({ where: { otherCostId: id } });
    await this.audit.catat(null, {
      actorId: principal.userId,
      branchId: existing.branchId,
      action: 'finance.other_cost_deleted',
      objectType: 'OtherCost',
      objectId: id,
      reason,
      beforeMasked: {
        incurredOn: otherCostDay(existing),
        category: existing.category,
        description: existing.description,
        amountRp: existing.amountRp,
      },
    });
    return { id, deleted: true };
  }

  // ============================================================================
  // EKSPOR FINANCE (CSV)
  // ============================================================================

  async exportReport(
    principal: SessionPrincipal,
    input: { branchId?: string; from?: string | Date; until?: string | Date },
  ) {
    this.policy.requireCapability(principal.capabilities, 'finance:export');
    const from = input?.from ? new Date(input.from) : null;
    const until = input?.until ? new Date(input.until) : null;
    if (!from || !until || Number.isNaN(from.getTime()) || Number.isNaN(until.getTime()))
      throw problem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, 'from');
    if (from > until) throw problem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, 'until');
    if ((until.getTime() - from.getTime()) / 86_400_000 > EXPORT_MAX_DAYS)
      throw problem('EXPORT_RANGE_TOO_LARGE', HttpStatus.UNPROCESSABLE_ENTITY, 'until');
    this.ensureBranchAccess(principal, input.branchId);

    const isGlobal =
      principal.capabilities.includes('branch:all') ||
      principal.roles.some((r) =>
        ['SUPER_OWNER', 'FINANCE'].includes(r.role as string),
      );
    const branchFilter = input.branchId
      ? { branchId: input.branchId }
      : isGlobal
        ? {}
        : { branchId: { in: principal.branchIds } };

    // `until` adalah tanggal (inklusif), sehingga batas atas query = hari berikutnya.
    const endExclusive = new Date(until.getTime() + 86_400_000);
    const range = financeRange({ from: from.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10) });

    const [purchases, costs, branch] = await Promise.all([
      this.db.pembelian.findMany({
        where: { ...branchFilter, status: 'PAID', paidAt: { gte: from, lt: endExclusive } },
        include: {
          branch: { select: { code: true } },
          package: { select: { name: true } },
        },
        orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
        take: EXPORT_MAX_ROWS + 1,
      }),
      this.db.otherCost.findMany({
        where: { ...branchFilter, ...otherCostInRange(range) },
        include: { branch: { select: { code: true } } },
        orderBy: [{ incurredOn: 'asc' }, { period: 'asc' }, { id: 'asc' }],
        take: EXPORT_MAX_ROWS + 1,
      }),
      input.branchId
        ? this.db.cabang.findUnique({ where: { id: input.branchId }, select: { code: true } })
        : Promise.resolve(null),
    ]);
    const truncated = purchases.length > EXPORT_MAX_ROWS || costs.length > EXPORT_MAX_ROWS;
    const salesRows = purchases.slice(0, EXPORT_MAX_ROWS);
    const costRows = costs.slice(0, EXPORT_MAX_ROWS);

    const day = (date: Date | null | undefined) => (date ?? new Date(0)).toISOString().slice(0, 10);
    const lines = ['tanggal,cabang,jenis,referensi,keterangan,jumlah_rp'];
    let salesTotal = 0;
    for (const p of salesRows) {
      salesTotal += p.totalAmountRp;
      lines.push(
        [
          day(p.paidAt ?? p.createdAt),
          csvText(p.branch.code),
          'PENJUALAN_PAKET',
          csvText(p.invoiceNumber ?? p.id),
          csvText(p.package.name),
          String(p.totalAmountRp),
        ].join(','),
      );
    }
    let costTotal = 0;
    for (const c of costRows) {
      costTotal += c.amountRp;
      lines.push(
        [
          otherCostDay(c),
          csvText(c.branch.code),
          'BIAYA_LAIN',
          csvText(c.id),
          csvText(`${c.category}: ${c.description}`),
          String(c.amountRp),
        ].join(','),
      );
    }
    lines.push(`,,TOTAL_PENJUALAN,,Penjualan paket lunas,${salesTotal}`);
    lines.push(`,,TOTAL_BIAYA_LAIN,,Biaya lain menurut tanggal pengeluaran,${costTotal}`);
    lines.push(`,,SELISIH,,Penjualan dikurangi biaya lain,${salesTotal - costTotal}`);

    const content = `\uFEFF${lines.join('\r\n')}\r\n`;
    await this.audit.catat(null, {
      actorId: principal.userId,
      branchId: input.branchId ?? null,
      action: 'FINANCE_EXPORT',
      objectType: 'FinanceExport',
      objectId: `${day(from)}..${day(until)}`,
      afterMasked: { rows: salesRows.length + costRows.length, truncated },
    });
    return {
      fileName: `finance-${branch?.code ?? 'semua-cabang'}-${day(from)}-${day(until)}.csv`,
      mimeType: 'text/csv;charset=utf-8',
      content,
      controlHash: createHash('sha256').update(content).digest('hex'),
      sourceCutoffAt: new Date().toISOString(),
      completeness: truncated ? 'INCOMPLETE' : 'COMPLETE',
      auditLogId: null,
    };
  }

  // ============================================================================
  // BACKWARD COMPATIBILITY & LEGACY ENDPOINTS
  // ============================================================================

  async overview(
    principal: SessionPrincipal,
    input: { branchId?: string; from?: string; until?: string },
  ) {
    this.policy.requireCapability(principal.capabilities, 'finance:read');
    const branch = input.branchId
      ? await this.db.cabang.findUnique({ where: { id: input.branchId } })
      : await this.db.cabang.findFirst();

    const purchases = await this.db.pembelian.findMany({
      where: {
        ...(branch ? { branchId: branch.id } : {}),
        status: 'PAID',
      },
    });

    const revenue = purchases.reduce((sum, p) => sum + p.totalAmountRp, 0);

    const fromDate = input.from ? new Date(input.from) : new Date(Date.now() - 30 * 86400000);
    const untilDate = input.until ? new Date(input.until) : new Date();

    const branchItem = {
      id: branch?.id ?? 'branch-1',
      code: branch?.code ?? 'JKT',
      name: branch?.name ?? 'Daily Dose Studio',
      expectedRp: revenue,
      receivedRp: revenue,
      approvedRp: revenue,
      identificationAmountRp: 0,
      reconciliationDifferenceRp: 0,
      anomalousTransactionCount: 0,
    };

    return {
      generatedAt: new Date().toISOString(),
      period: {
        from: fromDate.toISOString(),
        until: untilDate.toISOString(),
      },
      metrics: {
        expectedRp: revenue,
        receivedRp: revenue,
        approvedRp: revenue,
        identificationAmountRp: 0,
        reconciliationDifferenceRp: 0,
        anomalousTransactionCount: 0,
      },
      branches: [branchItem],
    };
  }

  async anomalies(
    principal: SessionPrincipal,
    input: { branchId?: string; from?: string; until?: string; limit?: number; cursor?: string },
  ) {
    this.policy.requireCapability(principal.capabilities, 'finance:read');
    const limit = input.limit ? Math.min(input.limit, 100) : 50;

    // Pembelian menunggu verifikasi lebih dari 24 jam
    const agingCutoff = new Date(Date.now() - 24 * 3600 * 1000);
    const agingPurchases = await this.db.pembelian.findMany({
      where: {
        status: 'WAITING_VERIFICATION',
        createdAt: { lt: agingCutoff },
        ...(input.branchId ? { branchId: input.branchId } : {}),
      },
      include: {
        branch: { select: { code: true } },
      },
      take: limit,
      orderBy: { createdAt: 'asc' },
    });

    const purchaseItems = agingPurchases.map((p) => ({
      purchaseId: p.id,
      branchId: p.branchId,
      branchCode: p.branch?.code || '—',
      amountRp: p.totalAmountRp,
      submittedAt: p.createdAt,
      code: 'VERIFIKASI_TERTAHAN',
      severity: 'WARNING' as const,
      message: `Tagihan #${p.invoiceNumber} menunggu verifikasi > 24 jam`,
      href: `/workspace/payments/${p.id}`,
    }));

    const allItems = purchaseItems.slice(0, limit);

    return {
      items: allItems,
      total: allItems.length,
      page: {
        hasMore: false,
        nextCursor: null,
      },
    };
  }

  async legacyCashflow(
    principal: SessionPrincipal,
    input: { branchId?: string; from?: string; until?: string; limit?: number; cursor?: string },
  ) {
    this.policy.requireCapability(principal.capabilities, 'finance:read');
    return {
      items: [],
      total: 0,
      summary: {
        TOTAL: { amountRp: 0, count: 0 },
      },
      page: {
        hasMore: false,
        nextCursor: null,
      },
    };
  }

  async reports(
    principal: SessionPrincipal,
    reportType: string,
    filters: FinanceQuery & { cursor?: string },
  ) {
    const type = reportType.toLowerCase();
    if (type === 'omset') {
      return this.omsetReport(principal, filters);
    }
    if (type === 'instructor-cost-realtime' || type === 'cost-realtime') {
      return this.realtimeInstructorCostReport(principal, filters);
    }
    if (type === 'other-cost' || type === 'other-costs') {
      return this.otherCostReport(principal, filters);
    }
    if (type === 'profit' || type === 'profit-summary') {
      const summary = await this.profitReport(principal, filters);
      const moneyZero = { amountMinor: 0, currency: 'IDR' };
      const money = (val: number) => ({ amountMinor: val * 100, currency: 'IDR' });
      return {
        report: {
          reportType: 'PROFIT',
          branchId: summary.branchId,
          period: summary.period,
          generatedAt: new Date().toISOString(),
          sourceCutoffAt: new Date().toISOString(),
          completeness: 'COMPLETE',
          anomalyCount: 0,
          controlHash: 'hash-ctrl-baseline-001',
          totals: {
            grossSales: money(summary.omsetRp),
            packagePromotionDiscount: moneyZero,
            voucherDiscount: moneyZero,
            revenue: money(summary.omsetRp),
            instructorRealtime: money(summary.costRealtimeRp),
            otherCost: money(summary.otherCostRp),
              profit: money(summary.netProfitRealtimeRp),
          },
          sourceVersion: 'v2',
        },
        items: [],
        page: { hasMore: false, nextCursor: null },
      };
    }

    const summary = await this.profitReport(principal, filters);
    const moneyZero = { amountMinor: 0, currency: 'IDR' };
    const money = (val: number) => ({ amountMinor: val * 100, currency: 'IDR' });
    return {
      report: {
        reportType: 'REVENUE',
        branchId: summary.branchId,
        period: summary.period,
        from: summary.from,
        until: summary.until,
        generatedAt: new Date().toISOString(),
        sourceCutoffAt: new Date().toISOString(),
        completeness: 'COMPLETE',
        anomalyCount: 0,
        controlHash: 'hash-ctrl-baseline-001',
        totals: {
          grossSales: money(summary.omsetRp),
          packagePromotionDiscount: moneyZero,
          voucherDiscount: moneyZero,
          revenue: money(summary.omsetRp),
          instructorRealtime: money(summary.costRealtimeRp),
          otherCost: money(summary.otherCostRp),
          profit: money(summary.netProfitRealtimeRp),
        },
        sourceVersion: 'v2',
      },
      items: [],
      page: { hasMore: false, nextCursor: null },
    };
  }

  async otherCosts(
    principal: SessionPrincipal,
    filters: FinanceQuery & { cursor?: string },
  ) {
    return this.listOtherCosts(principal, filters);
  }

  // ============================================================================
  // OWNER BRANCH PERFORMANCE (RULE #10)
  // ============================================================================

  async ownerBranchPerformance(
    principal: SessionPrincipal,
    input: FinanceQuery,
  ) {
    this.policy.requireCapability(principal.capabilities, 'finance:read');
    const isOwnerOrSuper = principal.roles.some((r) =>
      ['SUPER_OWNER', 'OWNER', 'FINANCE'].includes(r.role as string),
    );
    if (!isOwnerOrSuper) {
      throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
    }

    const isGlobal = principal.capabilities.includes('branch:all');
    let targetBranchId = input.branchId;

    if (!targetBranchId) {
      if (isGlobal) {
        const firstBranch = await this.db.cabang.findFirst({ where: { active: true } });
        targetBranchId = firstBranch?.id;
      } else if (principal.branchIds.length > 0) {
        targetBranchId = principal.branchIds[0];
      }
    }

    if (!targetBranchId) {
      throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    if (!isGlobal && !principal.branchIds.includes(targetBranchId)) {
      throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
    }

    const branch = await this.db.cabang.findUnique({
      where: { id: targetBranchId },
    });
    if (!branch) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

    const range = financeRange(input);

    const purchases = await this.db.pembelian.findMany({
      where: {
        branchId: targetBranchId,
        status: 'PAID',
        paidAt: { gte: range.fromDate, lt: range.untilExclusive },
      },
    });
    const omsetRp = purchases.reduce((sum, p) => sum + p.totalAmountRp, 0);

    const otherCosts = await this.db.otherCost.findMany({
      where: {
        branchId: targetBranchId,
        ...otherCostInRange(range),
      },
    });
    const otherCostRp = otherCosts.reduce((sum, c) => sum + c.amountRp, 0);

    const slots = await this.db.slotKelas.findMany({
      where: {
        branchId: targetBranchId,
        startAt: { gte: range.fromDate, lt: range.untilExclusive },
        status: 'COMPLETED',
      },
      include: {
        instructor: true,
        classType: true,
        instructorAttendance: { select: { id: true } },
      },
    });

    const fees = await this.db.instructorFee.findMany({
      where: { branchId: targetBranchId },
      orderBy: { effectiveDate: 'desc' },
    });

    const instructorBreakdown = summarizeInstructorFees(slots, fees);
    const koreksi = await koreksiHonorDalamRentang(this.db, {
      branchFilter: { branchId: targetBranchId },
      fromDate: range.fromDate,
      untilExclusive: range.untilExclusive,
    });
    const totalInstructorFeeRp =
      instructorBreakdown.reduce((sum, item) => sum + item.totalFeeRp, 0) + koreksi.totalRp;
    const estimatedProfitRp = omsetRp - totalInstructorFeeRp - otherCostRp;
    const totalUnverifiedFeeRp = instructorBreakdown.reduce(
      (sum, item) => sum + item.unverifiedFeeRp,
      0,
    );

    const totalUnconfiguredClassCount = instructorBreakdown.reduce(
      (sum, item) => sum + item.unconfiguredFeeClassCount,
      0,
    );
    const instructorFeeMissing = slots.length > 0 && (fees.length === 0 || totalUnconfiguredClassCount > 0);

    return {
      branch: {
        id: branch.id,
        code: branch.code,
        name: branch.name,
      },
      period: range.label,
      from: range.from,
      until: range.until,
      omsetRp,
      otherCostRp,
      totalInstructorFeeRp,
      totalUnverifiedFeeRp,
      unverifiedClassCount: instructorBreakdown.reduce(
        (sum, item) => sum + item.unverifiedClassCount,
        0,
      ),
      unconfiguredClassCount: totalUnconfiguredClassCount,
      instructorFeeMissing,
      estimatedProfitRp,
      instructorCount: instructorBreakdown.length,
      totalClassHours: instructorBreakdown.reduce((sum, item) => sum + item.totalHours, 0),
      instructors: instructorBreakdown,
    };
  }
}
