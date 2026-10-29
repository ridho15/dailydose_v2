import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type { SessionPrincipal } from '../identity/identity.service';
import { PolicyService } from '../identity/policy.service';
import { ApiProblem } from '../identity/security';
import { financeRange, otherCostDay, otherCostInRange } from './finance-range';
import { summarizeInstructorFees } from './instructor-fee-calculator';
import { koreksiHonorDalamRentang } from './koreksi-jam.service';
import { hitungModalSesi } from './modal-sesi.service';

/**
 * Angka keuangan satu bulan untuk Owner, dan jurnal kas sederhana untuk cabang.
 *
 * Omzet adalah pembelian PAID menurut `paidAt`; modal sesi adalah sesi paket yang dibeli dikali
 * modal per sesi tipe kelasnya di cabang itu (`ModalSesi`); pengeluaran adalah biaya lain menurut
 * tanggal pengeluarannya; laba = omzet − modal sesi − pengeluaran. Payroll (honor kelas yang
 * di-scan QR ditambah koreksi jam) adalah yang dibayar ke instruktur dan ditampilkan terpisah;
 * payroll tidak mengurangi laba karena biaya mengajar sudah diwakili modal sesi.
 * Satu-satunya perbedaan: di sini semua cabang dihitung sekaligus, bukan satu per satu, dan tarif
 * honor tiap cabang tetap dicari dari tarif cabang itu saja seperti laporan per cabang.
 */

export interface AngkaCabang {
  branchId: string;
  branchName: string;
  omsetRp: number;
  /** Honor instruktur termasuk koreksi jam. */
  payrollRp: number;
  /** Bagian payroll dari koreksi jam; bisa negatif. */
  koreksiPayrollRp: number;
  pengeluaranRp: number;
  /** Sesi paket yang dibeli x modal per sesi; dasar laba. */
  modalSesiRp: number;
  /** Sesi paket yang terjual dalam bulan ini. */
  sesiTerjual: number;
  /** Sesi tanpa tarif modal yang cocok (dihitung Rp0 sampai diatur). */
  sesiTanpaModal: number;
  profitRp: number;
  /** Null berarti target bulanan belum dipasang, bukan nol. */
  targetRp: number | null;
  transaksi: number;
  kelasSelesai: number;
  pengeluaranPerKategori: { category: string; amountRp: number }[];
}

export interface RingkasanBulanan {
  period: string;
  from: string;
  until: string;
  total: Omit<AngkaCabang, 'branchId' | 'branchName' | 'targetRp'> & { targetRp: number | null };
  cabang: AngkaCabang[];
  /** Kelas selesai yang tarif honornya belum dipasang dan memakai tarif bawaan. */
  tarifBelumDipasang: number;
}

export interface BarisJurnal {
  id: string;
  tanggal: string;
  arah: 'MASUK' | 'KELUAR';
  keterangan: string;
  kategori: string;
  amountRp: number;
  dicatatOleh: string | null;
  branchId: string;
  /** Pengeluaran yang dibayar uang pribadi Super Owner (diganti saat settlement). */
  dibayarOleh?: string | null;
}

export interface JurnalKas {
  period: string;
  branchId: string | null;
  masukRp: number;
  keluarRp: number;
  selisihRp: number;
  rows: BarisJurnal[];
}

const MAKS_BARIS_JURNAL = 500;

function tambahKategori(peta: Map<string, number>, kategori: string, nilai: number) {
  peta.set(kategori, (peta.get(kategori) ?? 0) + nilai);
}

@Injectable()
export class RingkasanKeuanganService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  private global(principal: SessionPrincipal) {
    return (
      principal.capabilities.includes('branch:all') ||
      principal.roles.some((r) => ['SUPER_OWNER', 'FINANCE'].includes(r.role as string))
    );
  }

  async ringkasanBulanan(
    principal: SessionPrincipal,
    input: { period?: string } = {},
    now = new Date(),
  ): Promise<RingkasanBulanan> {
    this.policy.requireCapability(principal.capabilities, 'finance:read');
    const period = input.period ?? now.toISOString().slice(0, 7);
    const range = financeRange({ period });

    const cabangList: { id: string; name: string; monthlyTargetRp: number | null }[] =
      await this.db.cabang.findMany({
        where: {
          active: true,
          ...(this.global(principal) ? {} : { id: { in: principal.branchIds } }),
        },
        select: { id: true, name: true, monthlyTargetRp: true },
        orderBy: { name: 'asc' },
      });
    const ids = cabangList.map((c) => c.id);
    const lingkup = { branchId: { in: ids } };

    const [pembelian, biaya, kelas, tarif, koreksi] = await Promise.all([
      this.db.pembelian.findMany({
        where: {
          ...lingkup,
          status: 'PAID',
          paidAt: { gte: range.fromDate, lt: range.untilExclusive },
        },
        select: {
          branchId: true,
          totalAmountRp: true,
          paidAt: true,
          package: { select: { sessionCount: true, classTypeId: true } },
        },
      }),
      this.db.otherCost.findMany({
        where: { ...lingkup, ...otherCostInRange(range) },
        select: { branchId: true, category: true, amountRp: true },
      }),
      this.db.slotKelas.findMany({
        where: {
          ...lingkup,
          startAt: { gte: range.fromDate, lt: range.untilExclusive },
          status: 'COMPLETED',
        },
        include: {
          instructor: true,
          classType: true,
          instructorAttendance: { select: { id: true } },
        },
      }),
      this.db.instructorFee.findMany({
        where: lingkup,
        orderBy: { effectiveDate: 'desc' },
      }),
      koreksiHonorDalamRentang(this.db, {
        branchFilter: lingkup,
        fromDate: range.fromDate,
        untilExclusive: range.untilExclusive,
      }),
    ]);

    const modal = await hitungModalSesi(
      this.db,
      pembelian as Parameters<typeof hitungModalSesi>[1],
    );
    const sesiPerCabang = new Map<string, number>();
    for (const p of pembelian as { branchId: string; package?: { sessionCount: number } | null }[])
      sesiPerCabang.set(p.branchId, (sesiPerCabang.get(p.branchId) ?? 0) + (p.package?.sessionCount ?? 0));

    let tarifBelumDipasang = 0;
    const cabang: AngkaCabang[] = cabangList.map((c) => {
      const beli = (pembelian as { branchId: string; totalAmountRp: number }[]).filter(
        (p) => p.branchId === c.id,
      );
      const omsetRp = beli.reduce((s, p) => s + p.totalAmountRp, 0);

      const kategori = new Map<string, number>();
      let pengeluaranRp = 0;
      for (const b of biaya as { branchId: string; category: string; amountRp: number }[]) {
        if (b.branchId !== c.id) continue;
        pengeluaranRp += b.amountRp;
        tambahKategori(kategori, b.category, b.amountRp);
      }

      const kelasCabang = (kelas as { branchId: string }[]).filter((k) => k.branchId === c.id);
      const ringkasHonor = summarizeInstructorFees(
        kelasCabang as never,
        (tarif as { branchId: string }[]).filter((t) => t.branchId === c.id) as never,
      );
      tarifBelumDipasang += ringkasHonor.reduce((s, r) => s + r.unconfiguredFeeClassCount, 0);
      const koreksiPayrollRp = koreksi.perCabang.get(c.id) ?? 0;
      const payrollRp = ringkasHonor.reduce((s, r) => s + r.totalFeeRp, 0) + koreksiPayrollRp;

      return {
        branchId: c.id,
        branchName: c.name,
        omsetRp,
        payrollRp,
        koreksiPayrollRp,
        pengeluaranRp,
        modalSesiRp: modal.perCabang.get(c.id) ?? 0,
        sesiTerjual: sesiPerCabang.get(c.id) ?? 0,
        sesiTanpaModal: modal.sesiTanpaModalPerCabang.get(c.id) ?? 0,
        profitRp: omsetRp - (modal.perCabang.get(c.id) ?? 0) - pengeluaranRp,
        targetRp: c.monthlyTargetRp,
        transaksi: beli.length,
        kelasSelesai: kelasCabang.length,
        pengeluaranPerKategori: [...kategori]
          .map(([category, amountRp]) => ({ category, amountRp }))
          .sort((a, b) => b.amountRp - a.amountRp),
      };
    });

    const jumlah = (f: (c: AngkaCabang) => number) => cabang.reduce((s, c) => s + f(c), 0);
    const kategoriTotal = new Map<string, number>();
    for (const c of cabang)
      for (const k of c.pengeluaranPerKategori)
        tambahKategori(kategoriTotal, k.category, k.amountRp);
    const adaTarget = cabang.some((c) => c.targetRp !== null);

    return {
      period,
      from: range.from,
      until: range.until,
      total: {
        omsetRp: jumlah((c) => c.omsetRp),
        payrollRp: jumlah((c) => c.payrollRp),
        koreksiPayrollRp: jumlah((c) => c.koreksiPayrollRp),
        pengeluaranRp: jumlah((c) => c.pengeluaranRp),
        modalSesiRp: jumlah((c) => c.modalSesiRp),
        sesiTerjual: jumlah((c) => c.sesiTerjual),
        sesiTanpaModal: jumlah((c) => c.sesiTanpaModal),
        profitRp: jumlah((c) => c.profitRp),
        targetRp: adaTarget ? jumlah((c) => c.targetRp ?? 0) : null,
        transaksi: jumlah((c) => c.transaksi),
        kelasSelesai: jumlah((c) => c.kelasSelesai),
        pengeluaranPerKategori: [...kategoriTotal]
          .map(([category, amountRp]) => ({ category, amountRp }))
          .sort((a, b) => b.amountRp - a.amountRp),
      },
      cabang,
      tarifBelumDipasang,
    };
  }

  /**
   * Jurnal kas sederhana satu bulan: uang masuk dari pembayaran paket yang lunas, uang keluar dari
   * pengeluaran yang dicatat staf. Honor instruktur tidak masuk di sini karena belum tentu sudah
   * dibayarkan pada bulan yang sama; honor tampil di ringkasan Owner sebagai payroll.
   */
  async jurnalKas(
    principal: SessionPrincipal,
    input: { branchId?: string; period?: string } = {},
    now = new Date(),
  ): Promise<JurnalKas> {
    this.policy.requireAnyCapability(principal.capabilities, ['finance:read', 'expense:create']);
    const global = this.global(principal);
    if (input.branchId && !global && !principal.branchIds.includes(input.branchId)) {
      throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
    }
    // Staf cabang selalu melihat satu cabang; tanpa pilihan, jurnal tidak bisa dibuka.
    if (!input.branchId && !global) {
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'branchId', issue: 'REQUIRED' },
      ]);
    }
    const period = input.period ?? now.toISOString().slice(0, 7);
    const range = financeRange({ period });
    const cabang = input.branchId ? { branchId: input.branchId } : {};

    const [pembelian, biaya] = await Promise.all([
      this.db.pembelian.findMany({
        where: {
          ...cabang,
          status: 'PAID',
          paidAt: { gte: range.fromDate, lt: range.untilExclusive },
        },
        select: {
          id: true,
          branchId: true,
          invoiceNumber: true,
          totalAmountRp: true,
          paymentMethod: true,
          paidAt: true,
          user: { select: { displayName: true } },
          package: { select: { name: true } },
          verifiedBy: { select: { displayName: true } },
        },
        orderBy: { paidAt: 'desc' },
        take: MAKS_BARIS_JURNAL,
      }),
      this.db.otherCost.findMany({
        where: { ...cabang, ...otherCostInRange(range) },
        select: {
          id: true,
          branchId: true,
          incurredOn: true,
          period: true,
          category: true,
          description: true,
          amountRp: true,
          createdAt: true,
          createdBy: { select: { displayName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: MAKS_BARIS_JURNAL,
      }),
    ]);

    type Beli = {
      id: string;
      branchId: string;
      invoiceNumber: string;
      totalAmountRp: number;
      paymentMethod: string;
      paidAt: Date | null;
      user: { displayName: string } | null;
      package: { name: string } | null;
      verifiedBy: { displayName: string } | null;
    };
    type Biaya = {
      id: string;
      branchId: string;
      incurredOn: Date | null;
      period: string;
      category: string;
      description: string;
      amountRp: number;
      createdAt: Date;
      createdBy: { displayName: string } | null;
    };

    const pembayar = (biaya as { id: string }[]).length
      ? await this.db.pembayarPengeluaran.findMany({
          where: { otherCostId: { in: (biaya as { id: string }[]).map((b) => b.id) } },
        })
      : [];
    const namaPembayar = pembayar.length
      ? new Map(
          (
            await this.db.user.findMany({
              where: { id: { in: [...new Set(pembayar.map((p) => p.dibayarOlehId))] } },
              select: { id: true, displayName: true },
            })
          ).map((u) => [u.id, u.displayName]),
        )
      : new Map<string, string>();
    const dibayarOleh = new Map(
      pembayar.map((p) => [p.otherCostId, namaPembayar.get(p.dibayarOlehId) ?? 'Super Owner']),
    );

    const rows: BarisJurnal[] = [
      ...(pembelian as Beli[]).map((p) => ({
        id: `in-${p.id}`,
        tanggal: (p.paidAt ?? new Date(0)).toISOString().slice(0, 10),
        arah: 'MASUK' as const,
        keterangan: `${p.package?.name ?? 'Paket'} · ${p.user?.displayName ?? 'Member'} (${p.invoiceNumber})`,
        kategori: p.paymentMethod,
        amountRp: p.totalAmountRp,
        dicatatOleh: p.verifiedBy?.displayName ?? null,
        branchId: p.branchId,
      })),
      ...(biaya as Biaya[]).map((b) => ({
        id: `out-${b.id}`,
        tanggal: otherCostDay(b),
        arah: 'KELUAR' as const,
        keterangan: b.description,
        kategori: b.category,
        amountRp: b.amountRp,
        dicatatOleh: b.createdBy?.displayName ?? null,
        branchId: b.branchId,
        dibayarOleh: dibayarOleh.get(b.id) ?? null,
      })),
    ].sort((a, b) => (a.tanggal === b.tanggal ? 0 : a.tanggal < b.tanggal ? 1 : -1));

    const masukRp = rows.filter((r) => r.arah === 'MASUK').reduce((s, r) => s + r.amountRp, 0);
    const keluarRp = rows.filter((r) => r.arah === 'KELUAR').reduce((s, r) => s + r.amountRp, 0);
    return {
      period,
      branchId: input.branchId ?? null,
      masukRp,
      keluarRp,
      selisihRp: masukRp - keluarRp,
      rows,
    };
  }
}
