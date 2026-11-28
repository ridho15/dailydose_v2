import { HttpStatus, Injectable } from '@nestjs/common';
import { idDenganNota } from './nota-pengeluaran';
import { penjualanMinuman } from './stok-minuman.service';
import { PrismaService } from '../database/prisma.service';
import { bacaOpsional } from '../foundation/tabel-opsional';
import type { SessionPrincipal } from '../identity/identity.service';
import { PolicyService } from '../identity/policy.service';
import { ApiProblem } from '../identity/security';
import { financeRange, otherCostDay, otherCostInRange } from './finance-range';
import { summarizeInstructorFees } from './instructor-fee-calculator';
import { koreksiHonorDalamRentang } from './koreksi-jam.service';
import { hitungModalSesi, MULAI_MODAL_PAKET, type MetodeModal } from './modal-sesi.service';

/**
 * Angka keuangan satu bulan untuk Owner, dan jurnal kas sederhana untuk cabang.
 *
 * Omzet adalah pembelian PAID menurut `paidAt`; modal mulai November 2026 adalah modal paket
 * terjual (sesi paket yang lunas x modal per sesi, dibekukan saat lunas; lihat `hitungModalSesi`),
 * Oktober 2026 dan sebelumnya tetap sesi terpakai x modal per sesi; pengeluaran adalah biaya lain
 * menurut tanggal pengeluarannya; laba = omzet − modal − pengeluaran. Payroll (honor kelas yang
 * di-scan QR ditambah koreksi jam) dibayar dari kas payroll simpanan dan tidak mengurangi laba.
 * Kas payroll simpanan per cabang: masuk = modal paket terjual, keluar = payroll + pembalikan modal
 * (VOID/refund), mulai November 2026.
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
  /** Penjualan minuman (stok minuman keluar karena dijual); menambah laba, bukan omset paket. */
  penjualanMinumanRp: number;
  /** Modal bersih yang mengurangi laba: modal paket terjual − pembalikan (atau sesi terpakai untuk bulan lama). */
  modalSesiRp: number;
  /** Sesi paket yang terjual (lunas) bulan ini; aturan mulai November 2026. */
  sesiTerjual: number;
  /** Modal paket terjual sebelum pembalikan. */
  modalTerjualRp: number;
  /** Pembalikan modal karena VOID atau refund bulan ini. */
  modalBalikRp: number;
  /** Sesi terpakai di kelas selesai; hanya dasar modal untuk bulan sebelum November 2026. */
  sesiTerpakai: number;
  /** Sesi tanpa tarif modal yang cocok (dihitung Rp0 sampai diatur). */
  sesiTanpaModal: number;
  profitRp: number;
  /**
   * Dana aktual (28 November 2026): uang yang tersisa bulan ini = omzet + penjualan minuman −
   * semua pengeluaran. Untuk dicocokkan dengan mutasi rekening dan kas tunai cabang.
   */
  danaAktualRp: number;
  /** Bagian omzet yang dibayar tunai: tidak muncul di mutasi rekening. */
  omsetTunaiRp: number;
  /** Null berarti target bulanan belum dipasang, bukan nol. */
  targetRp: number | null;
  transaksi: number;
  kelasSelesai: number;
  pengeluaranPerKategori: { category: string; amountRp: number }[];
}

export interface KasPayrollCabang {
  branchId: string;
  branchName: string;
  saldoAwalRp: number;
  /** Modal paket terjual bulan ini. */
  masukRp: number;
  /** Payroll instruktur bulan ini. */
  keluarPayrollRp: number;
  /** Pembalikan modal karena VOID atau refund bulan ini. */
  keluarBalikRp: number;
  saldoAkhirRp: number;
}

export interface KasPayrollSimpanan {
  /** False untuk bulan sebelum November 2026: kas simpanan belum ada. */
  berlaku: boolean;
  cabang: KasPayrollCabang[];
  total: Omit<KasPayrollCabang, 'branchId' | 'branchName'>;
}

export interface RingkasanBulanan {
  period: string;
  from: string;
  until: string;
  /** PEMAKAIAN untuk bulan sebelum November 2026, PAKET_TERJUAL sesudahnya. */
  metodeModal: MetodeModal;
  kasPayroll: KasPayrollSimpanan;
  total: Omit<AngkaCabang, 'branchId' | 'branchName' | 'targetRp'> & { targetRp: number | null };
  cabang: AngkaCabang[];
  /** Kelas selesai yang tarif honornya belum dipasang dan memakai tarif bawaan. */
  tarifBelumDipasang: number;
}

export interface BarisJurnal {
  id: string;
  costId?: string | null;
  tanggal: string;
  arah: 'MASUK' | 'KELUAR';
  keterangan: string;
  kategori: string;
  amountRp: number;
  dicatatOleh: string | null;
  createdById?: string | null;
  createdAt?: string | null;
  branchId: string;
  /** Pengeluaran yang dibayar uang pribadi Super Owner (diganti saat settlement). */
  dibayarOleh?: string | null;
  /** Pengeluaran punya foto/PDF nota (dibuka lewat GET /other-costs/:id/nota). */
  adaNota?: boolean;
}

export interface JurnalKas {
  period: string;
  branchId: string | null;
  masukRp: number;
  /** Null bagi peran tanpa `finance:read` (Admin/Manager hanya boleh melihat omzet cabangnya). */
  keluarRp: number | null;
  selisihRp: number | null;
  /** True bila baris melebihi batas tampilan; total tetap dari agregat seluruh data. */
  terpotong: boolean;
  rows: BarisJurnal[];
}

const MAKS_BARIS_JURNAL = 500;

function bulanBerikut(bulan: string): string {
  const d = new Date(`${bulan}-01T00:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 7);
}

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

    const [pembelian, biaya, gaji, modal, minuman] = await Promise.all([
      this.db.pembelian.findMany({
        where: {
          ...lingkup,
          status: 'PAID',
          paidAt: { gte: range.fromDate, lt: range.untilExclusive },
        },
        select: { branchId: true, totalAmountRp: true, paymentMethod: true },
      }),
      this.db.otherCost.findMany({
        where: { ...lingkup, ...otherCostInRange(range) },
        select: { branchId: true, category: true, amountRp: true },
      }),
      this.payrollPerCabang(ids, range),
      hitungModalSesi(this.db, {
        branchIds: ids,
        fromDate: range.fromDate,
        untilExclusive: range.untilExclusive,
      }),
      penjualanMinuman(this.db, { branchIds: ids, fromDate: range.fromDate, untilExclusive: range.untilExclusive }),
    ]);
    const kasPayroll = await this.kasPayroll(cabangList, period, { gaji, modal });

    const tarifBelumDipasang = gaji.tarifBelumDipasang;
    const cabang: AngkaCabang[] = cabangList.map((c) => {
      const beli = (pembelian as { branchId: string; totalAmountRp: number; paymentMethod?: string }[]).filter(
        (p) => p.branchId === c.id,
      );
      const omsetRp = beli.reduce((s, p) => s + p.totalAmountRp, 0);
      const omsetTunaiRp = beli.filter((p) => p.paymentMethod === 'CASH').reduce((s, p) => s + p.totalAmountRp, 0);

      const kategori = new Map<string, number>();
      let pengeluaranRp = 0;
      for (const b of biaya as { branchId: string; category: string; amountRp: number }[]) {
        if (b.branchId !== c.id) continue;
        pengeluaranRp += b.amountRp;
        tambahKategori(kategori, b.category, b.amountRp);
      }

      const koreksiPayrollRp = gaji.koreksiPerCabang.get(c.id) ?? 0;
      const payrollRp = gaji.perCabang.get(c.id) ?? 0;
      const modalRp = modal.perCabang.get(c.id) ?? 0;
      const penjualanMinumanRp = minuman.perCabang.get(c.id) ?? 0;

      return {
        branchId: c.id,
        branchName: c.name,
        omsetRp,
        payrollRp,
        koreksiPayrollRp,
        pengeluaranRp,
        penjualanMinumanRp,
        modalSesiRp: modalRp,
        sesiTerjual: modal.sesiTerjualPerCabang.get(c.id) ?? 0,
        modalTerjualRp: modal.modalTerjualPerCabang.get(c.id) ?? 0,
        modalBalikRp: modal.modalBalikPerCabang.get(c.id) ?? 0,
        sesiTerpakai: modal.sesiTerpakaiPerCabang.get(c.id) ?? 0,
        sesiTanpaModal: modal.sesiTanpaModalPerCabang.get(c.id) ?? 0,
        profitRp: omsetRp + penjualanMinumanRp - modalRp - pengeluaranRp,
        danaAktualRp: omsetRp + penjualanMinumanRp - pengeluaranRp,
        omsetTunaiRp,
        targetRp: c.monthlyTargetRp,
        transaksi: beli.length,
        kelasSelesai: gaji.kelasPerCabang.get(c.id) ?? 0,
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
      metodeModal: modal.metode,
      kasPayroll,
      total: {
        omsetRp: jumlah((c) => c.omsetRp),
        payrollRp: jumlah((c) => c.payrollRp),
        koreksiPayrollRp: jumlah((c) => c.koreksiPayrollRp),
        pengeluaranRp: jumlah((c) => c.pengeluaranRp),
        penjualanMinumanRp: jumlah((c) => c.penjualanMinumanRp),
        modalSesiRp: jumlah((c) => c.modalSesiRp),
        sesiTerjual: jumlah((c) => c.sesiTerjual),
        modalTerjualRp: jumlah((c) => c.modalTerjualRp),
        modalBalikRp: jumlah((c) => c.modalBalikRp),
        sesiTerpakai: jumlah((c) => c.sesiTerpakai),
        sesiTanpaModal: jumlah((c) => c.sesiTanpaModal),
        profitRp: jumlah((c) => c.profitRp),
        danaAktualRp: jumlah((c) => c.danaAktualRp),
        omsetTunaiRp: jumlah((c) => c.omsetTunaiRp),
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

  /** Payroll instruktur per cabang dalam rentang: honor kelas selesai (tarif cabang itu) + koreksi jam. */
  private async payrollPerCabang(ids: string[], range: { fromDate: Date; untilExclusive: Date }) {
    const lingkup = { branchId: { in: ids } };
    const [kelas, tarif, koreksi] = await Promise.all([
      this.db.slotKelas.findMany({
        where: {
          ...lingkup,
          startAt: { gte: range.fromDate, lt: range.untilExclusive },
          status: 'COMPLETED',
        },
        include: {
          instructor: true,
          classType: true,
          instructorAttendance: { select: { id: true, instructorId: true } },
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
    const perCabang = new Map<string, number>();
    const kelasPerCabang = new Map<string, number>();
    let tarifBelumDipasang = 0;
    for (const id of ids) {
      const kelasCabang = (kelas as { branchId: string }[]).filter((k) => k.branchId === id);
      const ringkasHonor = summarizeInstructorFees(
        kelasCabang as never,
        (tarif as { branchId: string }[]).filter((t) => t.branchId === id) as never,
      );
      tarifBelumDipasang += ringkasHonor.reduce((s, r) => s + r.unconfiguredFeeClassCount, 0);
      perCabang.set(id, ringkasHonor.reduce((s, r) => s + r.totalFeeRp, 0) + (koreksi.perCabang.get(id) ?? 0));
      kelasPerCabang.set(id, kelasCabang.length);
    }
    return { perCabang, kelasPerCabang, koreksiPerCabang: koreksi.perCabang, tarifBelumDipasang };
  }

  /**
   * Kas payroll simpanan per cabang untuk bulan `period`: saldo awal adalah akumulasi bulan-bulan
   * sejak November 2026; masuk = modal paket terjual, keluar = payroll instruktur + pembalikan modal.
   * Bulan sebelum November 2026 tidak punya kas simpanan.
   */
  private async kasPayroll(
    cabangList: { id: string; name: string }[],
    period: string,
    bulanIni: {
      gaji: { perCabang: Map<string, number> };
      modal: { modalTerjualPerCabang: Map<string, number>; modalBalikPerCabang: Map<string, number> };
    },
  ): Promise<KasPayrollSimpanan> {
    const nol = { saldoAwalRp: 0, masukRp: 0, keluarPayrollRp: 0, keluarBalikRp: 0, saldoAkhirRp: 0 };
    const mulai = MULAI_MODAL_PAKET.toISOString().slice(0, 7);
    if (period < mulai) return { berlaku: false, cabang: [], total: nol };
    const ids = cabangList.map((c) => c.id);
    const saldoAwal = new Map<string, number>();
    for (let bulan = mulai; bulan < period; bulan = bulanBerikut(bulan)) {
      const r = financeRange({ period: bulan });
      const [gaji, modal] = await Promise.all([
        this.payrollPerCabang(ids, r),
        hitungModalSesi(this.db, { branchIds: ids, fromDate: r.fromDate, untilExclusive: r.untilExclusive }),
      ]);
      for (const id of ids)
        saldoAwal.set(
          id,
          (saldoAwal.get(id) ?? 0) +
            (modal.modalTerjualPerCabang.get(id) ?? 0) -
            (gaji.perCabang.get(id) ?? 0) -
            (modal.modalBalikPerCabang.get(id) ?? 0),
        );
    }
    const cabang = cabangList.map((c) => {
      const saldoAwalRp = saldoAwal.get(c.id) ?? 0;
      const masukRp = bulanIni.modal.modalTerjualPerCabang.get(c.id) ?? 0;
      const keluarPayrollRp = bulanIni.gaji.perCabang.get(c.id) ?? 0;
      const keluarBalikRp = bulanIni.modal.modalBalikPerCabang.get(c.id) ?? 0;
      return {
        branchId: c.id,
        branchName: c.name,
        saldoAwalRp,
        masukRp,
        keluarPayrollRp,
        keluarBalikRp,
        saldoAkhirRp: saldoAwalRp + masukRp - keluarPayrollRp - keluarBalikRp,
      };
    });
    const jumlah = (f: (c: KasPayrollCabang) => number) => cabang.reduce((s, c) => s + f(c), 0);
    return {
      berlaku: true,
      cabang,
      total: {
        saldoAwalRp: jumlah((c) => c.saldoAwalRp),
        masukRp: jumlah((c) => c.masukRp),
        keluarPayrollRp: jumlah((c) => c.keluarPayrollRp),
        keluarBalikRp: jumlah((c) => c.keluarBalikRp),
        saldoAkhirRp: jumlah((c) => c.saldoAkhirRp),
      },
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
    // Total pengeluaran dan laba hanya untuk pemegang finance:read; staf cabang hanya melihat
    // pengeluaran yang ia catat sendiri.
    const lihatKeuangan = principal.capabilities.includes('finance:read');
    const whereBeli = {
      ...cabang,
      status: 'PAID' as const,
      paidAt: { gte: range.fromDate, lt: range.untilExclusive },
    };
    const whereBiaya = {
      ...cabang,
      ...otherCostInRange(range),
      ...(lihatKeuangan ? {} : { createdById: principal.userId }),
    };

    const [totalBeli, totalBiaya, pembelian, biaya] = await Promise.all([
      this.db.pembelian.aggregate({
        where: whereBeli,
        _sum: { totalAmountRp: true },
        _count: { _all: true },
      }),
      lihatKeuangan
        ? this.db.otherCost.aggregate({
            where: whereBiaya,
            _sum: { amountRp: true },
            _count: { _all: true },
          })
        : this.db.otherCost.count({ where: whereBiaya }),
      this.db.pembelian.findMany({
        where: whereBeli,
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
        where: whereBiaya,
        select: {
          id: true,
          branchId: true,
          incurredOn: true,
          period: true,
          category: true,
          description: true,
          amountRp: true,
          createdAt: true,
          createdById: true,
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
      createdById: string | null;
      createdBy: { displayName: string } | null;
    };

    const pembayar = (biaya as { id: string }[]).length
      ? await bacaOpsional(
          'pembayar_pengeluaran',
          () =>
            this.db.pembayarPengeluaran.findMany({
              where: { otherCostId: { in: (biaya as { id: string }[]).map((b) => b.id) } },
            }),
          [],
        )
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
    const adaNota = await idDenganNota(this.db as never, (biaya as { id: string }[]).map((b) => b.id));

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
        costId: b.id,
        tanggal: otherCostDay(b),
        arah: 'KELUAR' as const,
        keterangan: b.description,
        kategori: b.category,
        amountRp: b.amountRp,
        dicatatOleh: b.createdBy?.displayName ?? null,
        createdById: b.createdById ?? null,
        createdAt: b.createdAt ? b.createdAt.toISOString() : null,
        branchId: b.branchId,
        dibayarOleh: dibayarOleh.get(b.id) ?? null,
        adaNota: adaNota.has(b.id),
      })),
    ].sort((a, b) => (a.tanggal === b.tanggal ? 0 : a.tanggal < b.tanggal ? 1 : -1));

    // Total dari agregat seluruh data, bukan dari baris yang dipotong `take`.
    const masukRp = totalBeli._sum.totalAmountRp ?? 0;
    const jumlahBeli = totalBeli._count._all;
    const jumlahBiaya =
      typeof totalBiaya === 'number' ? totalBiaya : (totalBiaya._count._all as number);
    const keluarRp =
      typeof totalBiaya === 'number' ? null : (totalBiaya._sum.amountRp ?? 0);
    return {
      period,
      branchId: input.branchId ?? null,
      masukRp,
      keluarRp,
      selisihRp: keluarRp === null ? null : masukRp - keluarRp,
      terpotong: jumlahBeli > (pembelian as unknown[]).length || jumlahBiaya > (biaya as unknown[]).length,
      rows,
    };
  }
}
