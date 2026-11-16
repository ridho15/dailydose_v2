import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { bacaOpsional, tabelOpsionalAda } from '../foundation/tabel-opsional';
import type { SessionPrincipal } from '../identity/identity.service';
import { PolicyService } from '../identity/policy.service';
import { ApiProblem } from '../identity/security';
import { berlakuPadaKelas } from './instructor-fee-calculator';

/**
 * Modal per sesi untuk laba.
 *
 * Laba bulanan = omzet paket yang lunas − modal − pengeluaran. Cara menghitung modal berganti mulai
 * pembelian yang lunas 1 November 2026 (keputusan pemilik, 16 November 2026):
 *
 * - **Paket terjual** (`paidAt` mulai `MULAI_MODAL_PAKET`): modal diakui di bulan paket lunas,
 *   sesi paket x modal per sesi cabang pembelian dan tipe kelas paket, tarif yang berlaku pada tanggal
 *   lunas. Nilainya dibekukan di `modal_paket_terjual` supaya perubahan tarif tidak mengubah bulan
 *   yang sudah lewat. Pembelian yang dibatalkan penuh (VOID) membalik seluruh modalnya, dan refund
 *   membalik modal sisa sesinya, di bulan pembatalan/refund. Sesi yang hangus tidak menghasilkan
 *   jurnal apa pun. Contoh pemilik: paket 20 sesi Rp4.000.000, modal Rp80.000/sesi → modal
 *   Rp1.600.000, laba Rp2.400.000.
 * - **Pemakaian** (kelas sebelum `MULAI_MODAL_PAKET`): aturan lama tetap untuk Oktober 2026 dan
 *   sebelumnya, supaya angka bulan itu tidak berubah: sesi member yang terpakai di kelas selesai x
 *   modal per sesi pada tanggal kelas.
 *
 * Modal terpisah dari fee instruktur: fee (payroll) dibayar dari kas payroll simpanan dan tidak
 * mengurangi laba.
 */
const CAP_BACA = ['master:read', 'finance:read'];
const CAP_UBAH = 'master:manage';

/**
 * Batas aturan paket terjual. Sama dengan batas bulan laporan keuangan lain (hari dipotong pada
 * tanggal UTC, lihat `financeRange`), supaya omzet dan modal satu pembayaran selalu jatuh di bulan
 * yang sama.
 */
export const MULAI_MODAL_PAKET = new Date('2026-11-01T00:00:00.000Z');

export interface TarifModal {
  id: string;
  branchId: string;
  classTypeId: string | null;
  modalPerSesiRp: number;
  effectiveDate: string;
  createdAt: string;
}

type BarisTarif = {
  id: string;
  branchId: string;
  classTypeId: string | null;
  modalPerSesiRp: number;
  effectiveDate: Date;
  createdAt: Date;
};

/** Status booking yang memakai sesi paket: hadir, atau tidak hadir (sesi tetap terpotong). */
export const STATUS_SESI_TERPAKAI = ['ATTENDED', 'NO_SHOW'] as const;

export type MetodeModal = 'PEMAKAIAN' | 'PAKET_TERJUAL' | 'CAMPURAN';

export interface HasilModal {
  /** Modal bersih: modal paket terjual − pembalikan + modal pemakaian (bulan lama). */
  totalRp: number;
  perCabang: Map<string, number>;
  /** PAKET_TERJUAL untuk rentang mulai November 2026, PEMAKAIAN untuk rentang lama. */
  metode: MetodeModal;
  /** Sesi paket yang terjual (lunas) dalam rentang, aturan baru. */
  sesiTerjual: number;
  sesiTerjualPerCabang: Map<string, number>;
  /** Modal paket terjual sebelum pembalikan; ini juga uang masuk kas payroll simpanan. */
  modalTerjualRp: number;
  modalTerjualPerCabang: Map<string, number>;
  /** Pembalikan modal karena VOID atau refund dalam rentang (angka positif). */
  modalBalikRp: number;
  modalBalikPerCabang: Map<string, number>;
  /** Sesi member yang terpakai dalam rentang, aturan lama (sebelum November 2026). */
  sesiTerpakai: number;
  sesiTerpakaiPerCabang: Map<string, number>;
  /** Sesi tanpa tarif modal yang cocok; dihitung Rp0 sampai tarifnya diatur. */
  sesiTanpaModal: number;
  sesiTanpaModalPerCabang: Map<string, number>;
  /** Modal bersih per tanggal (`YYYY-MM-DD`, UTC), untuk tren harian. */
  perHari: Map<string, number>;
}

function hasilKosong(metode: MetodeModal): HasilModal {
  return {
    totalRp: 0,
    perCabang: new Map(),
    metode,
    sesiTerjual: 0,
    sesiTerjualPerCabang: new Map(),
    modalTerjualRp: 0,
    modalTerjualPerCabang: new Map(),
    modalBalikRp: 0,
    modalBalikPerCabang: new Map(),
    sesiTerpakai: 0,
    sesiTerpakaiPerCabang: new Map(),
    sesiTanpaModal: 0,
    sesiTanpaModalPerCabang: new Map(),
    perHari: new Map(),
  };
}

const tambah = (peta: Map<string, number>, kunci: string, n: number) =>
  peta.set(kunci, (peta.get(kunci) ?? 0) + n);
const hari = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Tarif yang berlaku: tipe kelas di cabang itu lebih dulu, lalu tarif "semua tipe kelas" cabang
 * itu. Versi terbaru yang sudah berlaku pada tanggal `pada` (tanggal WIB).
 */
export function tarifUntuk(
  tarif: readonly BarisTarif[],
  p: { branchId: string; classTypeId: string | null; pada: Date },
): BarisTarif | null {
  const berlaku = (t: BarisTarif) => t.branchId === p.branchId && berlakuPadaKelas(t.effectiveDate, p.pada);
  const urut = [...tarif].sort(
    (a, b) =>
      b.effectiveDate.getTime() - a.effectiveDate.getTime() ||
      b.createdAt.getTime() - a.createdAt.getTime() ||
      b.id.localeCompare(a.id),
  );
  return (
    (p.classTypeId ? urut.find((t) => berlaku(t) && t.classTypeId === p.classTypeId) : undefined) ??
    urut.find((t) => berlaku(t) && t.classTypeId === null) ??
    null
  );
}

async function bacaTarif(db: PrismaService, branchIds: string[]): Promise<BarisTarif[]> {
  if (!branchIds.length || typeof db.modalSesi?.findMany !== 'function') return [];
  return bacaOpsional(
    'modal_sesi',
    () => db.modalSesi.findMany({ where: { branchId: { in: branchIds } } }),
    [],
  );
}

type Rentang = { branchIds: string[] | null; fromDate: Date; untilExclusive: Date };
type SesiTerpakai = { classSlot: { branchId: string; classTypeId: string; startAt: Date } };

/** Aturan lama: sesi terpakai di kelas selesai dalam rentang x modal per sesi pada tanggal kelas. */
async function hitungModalPemakaian(db: PrismaService, params: Rentang): Promise<HasilModal> {
  const hasil = hasilKosong('PEMAKAIAN');
  if (typeof db.pemesananKelas?.findMany !== 'function') return hasil;
  const sesi: SesiTerpakai[] = await db.pemesananKelas.findMany({
    where: {
      status: { in: [...STATUS_SESI_TERPAKAI] },
      classSlot: {
        status: 'COMPLETED',
        startAt: { gte: params.fromDate, lt: params.untilExclusive },
        ...(params.branchIds ? { branchId: { in: params.branchIds } } : {}),
      },
    },
    select: { classSlot: { select: { branchId: true, classTypeId: true, startAt: true } } },
  });
  if (!sesi.length) return hasil;
  const tarif = await bacaTarif(db, [...new Set(sesi.map((x) => x.classSlot.branchId))]);
  for (const { classSlot: k } of sesi) {
    hasil.sesiTerpakai += 1;
    tambah(hasil.sesiTerpakaiPerCabang, k.branchId, 1);
    const t = tarifUntuk(tarif, { branchId: k.branchId, classTypeId: k.classTypeId, pada: k.startAt });
    if (!t) {
      hasil.sesiTanpaModal += 1;
      tambah(hasil.sesiTanpaModalPerCabang, k.branchId, 1);
      continue;
    }
    hasil.totalRp += t.modalPerSesiRp;
    tambah(hasil.perCabang, k.branchId, t.modalPerSesiRp);
    tambah(hasil.perHari, hari(k.startAt), t.modalPerSesiRp);
  }
  return hasil;
}

/** Snapshot modal satu pembelian (baris `modal_paket_terjual`). */
export interface SnapshotModal {
  purchaseId: string;
  branchId: string;
  classTypeId: string | null;
  sesi: number;
  modalPerSesiRp: number;
  modalTotalRp: number;
  modalSesiId: string | null;
  paidAt: Date;
}

type PembelianSumber = {
  id: string;
  branchId: string;
  paidAt: Date | null;
  package: { sessionCount: number; classTypeId: string | null } | null;
  customerPackage?: { totalSessions: number } | null;
};

const PILIH_SUMBER = {
  id: true,
  branchId: true,
  paidAt: true,
  package: { select: { sessionCount: true, classTypeId: true } },
  customerPackage: { select: { totalSessions: true } },
} as const;

/** Modal satu pembelian dari tarif yang berlaku pada tanggal lunas. Sesi = sesi paket saat dibeli. */
export function snapshotDariTarif(p: PembelianSumber, tarif: readonly BarisTarif[]): SnapshotModal {
  const paidAt = p.paidAt as Date;
  const sesi = Math.max(0, p.customerPackage?.totalSessions ?? p.package?.sessionCount ?? 0);
  const classTypeId = p.package?.classTypeId ?? null;
  const t = tarifUntuk(tarif, { branchId: p.branchId, classTypeId, pada: paidAt });
  const modalPerSesiRp = t?.modalPerSesiRp ?? 0;
  return {
    purchaseId: p.id,
    branchId: p.branchId,
    classTypeId,
    sesi,
    modalPerSesiRp,
    modalTotalRp: sesi * modalPerSesiRp,
    modalSesiId: t?.id ?? null,
    paidAt,
  };
}

/**
 * Snapshot modal untuk pembelian-pembelian ini: yang sudah tersimpan dipakai apa adanya; yang belum
 * dihitung dari tarif pada tanggal lunas lalu disimpan (sekali, `skipDuplicates`). Bila tabel
 * `modal_paket_terjual` belum dibuat, snapshot dihitung tanpa disimpan. Hanya pembelian yang lunas
 * mulai `MULAI_MODAL_PAKET`.
 */
export async function pastikanSnapshotModal(
  db: PrismaService,
  pembelian: readonly PembelianSumber[],
): Promise<Map<string, SnapshotModal>> {
  const hasil = new Map<string, SnapshotModal>();
  const layak = pembelian.filter((p) => p.paidAt && p.paidAt >= MULAI_MODAL_PAKET);
  if (!layak.length) return hasil;
  const ids = layak.map((p) => p.id);
  const tersimpan: SnapshotModal[] =
    typeof db.modalPaketTerjual?.findMany === 'function'
      ? await bacaOpsional(
          'modal_paket_terjual',
          () => db.modalPaketTerjual.findMany({ where: { purchaseId: { in: ids } } }),
          [],
        )
      : [];
  for (const s of tersimpan) hasil.set(s.purchaseId, s);
  const belum = layak.filter((p) => !hasil.has(p.id));
  if (!belum.length) return hasil;
  const tarif = await bacaTarif(db, [...new Set(belum.map((p) => p.branchId))]);
  const baru = belum.map((p) => snapshotDariTarif(p, tarif));
  for (const s of baru) hasil.set(s.purchaseId, s);
  if (typeof db.modalPaketTerjual?.createMany === 'function' && (await tabelOpsionalAda(db, 'modal_paket_terjual')))
    await db.modalPaketTerjual.createMany({ data: baru, skipDuplicates: true });
  return hasil;
}

/**
 * Dipanggil di transaksi yang membuat pembelian lunas: membekukan modalnya saat itu juga, dengan
 * tarif yang berlaku pada tanggal lunas. Bila tabelnya belum ada, dilewati (snapshot dibuat saat
 * laporan pertama dibuka).
 */
export async function catatModalPaket(tx: PrismaService, purchaseId: string): Promise<void> {
  if (typeof tx.pembelian?.findUnique !== 'function') return;
  if (!(await tabelOpsionalAda(tx, 'modal_paket_terjual'))) return;
  const p = await tx.pembelian.findUnique({ where: { id: purchaseId }, select: PILIH_SUMBER });
  if (!p?.paidAt) return;
  await pastikanSnapshotModal(tx, [p as PembelianSumber]);
}

/**
 * Aturan paket terjual dalam rentang: modal pembelian yang lunas dalam rentang (termasuk yang
 * kemudian dibatalkan penuh, karena pembalikannya dicatat di bulan pembatalan), dikurangi
 * pembalikan karena VOID atau refund yang terjadi dalam rentang.
 */
async function hitungModalPaketTerjual(db: PrismaService, params: Rentang): Promise<HasilModal> {
  const hasil = hasilKosong('PAKET_TERJUAL');
  if (typeof db.pembelian?.findMany !== 'function') return hasil;
  const lingkup = params.branchIds ? { branchId: { in: params.branchIds } } : {};
  const dalamRentang = { gte: params.fromDate, lt: params.untilExclusive };

  const [lunas, batal, refund] = await Promise.all([
    db.pembelian.findMany({
      where: { ...lingkup, status: { in: ['PAID', 'CANCELLED'] }, paidAt: dalamRentang },
      select: { ...PILIH_SUMBER, status: true },
    }) as Promise<(PembelianSumber & { status: string })[]>,
    typeof db.pembelianKoreksi?.findMany === 'function'
      ? bacaOpsional(
          'pembelian_koreksi',
          () =>
            db.pembelianKoreksi.findMany({
              where: { ...lingkup, jenis: 'VOID', createdAt: dalamRentang },
              select: { purchaseId: true, branchId: true, createdAt: true },
            }),
          [] as { purchaseId: string; branchId: string; createdAt: Date }[],
        )
      : [],
    typeof db.refundPaket?.findMany === 'function'
      ? bacaOpsional(
          'refund_paket',
          () =>
            db.refundPaket.findMany({
              where: { ...lingkup, createdAt: dalamRentang, purchaseId: { not: null } },
              select: { purchaseId: true, branchId: true, sisaSesi: true, createdAt: true },
            }),
          [] as { purchaseId: string | null; branchId: string; sisaSesi: number; createdAt: Date }[],
        )
      : [],
  ]);

  // Pembelian CANCELLED hanya dihitung bila pernah lunas lalu di-VOID (punya catatan koreksi VOID).
  const idBatal = lunas.filter((p) => p.status === 'CANCELLED').map((p) => p.id);
  const pernahVoid = new Set<string>(
    idBatal.length && typeof db.pembelianKoreksi?.findMany === 'function'
      ? (
          await bacaOpsional(
            'pembelian_koreksi',
            () =>
              db.pembelianKoreksi.findMany({
                where: { purchaseId: { in: idBatal }, jenis: 'VOID' },
                select: { purchaseId: true },
              }),
            [] as { purchaseId: string }[],
          )
        ).map((k) => k.purchaseId)
      : [],
  );
  const terjual = lunas.filter((p) => p.status === 'PAID' || pernahVoid.has(p.id));

  // Pembelian yang dibalik dalam rentang bisa lunas di bulan lain: ambil sumbernya juga.
  const idDibalik = [
    ...new Set([...batal.map((b) => b.purchaseId), ...refund.map((r) => r.purchaseId as string)]),
  ].filter((id) => !terjual.some((p) => p.id === id));
  const sumberLain: PembelianSumber[] = idDibalik.length
    ? await db.pembelian.findMany({ where: { id: { in: idDibalik } }, select: PILIH_SUMBER })
    : [];
  const snapshot = await pastikanSnapshotModal(db, [...terjual, ...sumberLain]);

  for (const p of terjual) {
    const s = snapshot.get(p.id);
    if (!s) continue;
    hasil.sesiTerjual += s.sesi;
    tambah(hasil.sesiTerjualPerCabang, s.branchId, s.sesi);
    if (s.sesi > 0 && !s.modalSesiId) {
      hasil.sesiTanpaModal += s.sesi;
      tambah(hasil.sesiTanpaModalPerCabang, s.branchId, s.sesi);
    }
    hasil.modalTerjualRp += s.modalTotalRp;
    tambah(hasil.modalTerjualPerCabang, s.branchId, s.modalTotalRp);
    tambah(hasil.perHari, hari(s.paidAt), s.modalTotalRp);
  }

  // VOID membalik sisa modal setelah refund yang terjadi sebelumnya (tidak pernah lebih dari modalnya).
  const idVoid = batal.map((b) => b.purchaseId).filter((id) => snapshot.has(id));
  const refundSebelumVoid: { purchaseId: string | null; sisaSesi: number; createdAt: Date }[] =
    idVoid.length && typeof db.refundPaket?.findMany === 'function'
      ? await bacaOpsional(
          'refund_paket',
          () =>
            db.refundPaket.findMany({
              where: { purchaseId: { in: idVoid } },
              select: { purchaseId: true, sisaSesi: true, createdAt: true },
            }),
          [],
        )
      : [];
  const balik = (branchId: string, tanggal: Date, rp: number) => {
    if (rp <= 0) return;
    hasil.modalBalikRp += rp;
    tambah(hasil.modalBalikPerCabang, branchId, rp);
    tambah(hasil.perHari, hari(tanggal), -rp);
  };
  for (const b of batal) {
    const s = snapshot.get(b.purchaseId);
    if (!s) continue;
    const sudahDirefund = refundSebelumVoid
      .filter((r) => r.purchaseId === b.purchaseId && r.createdAt < b.createdAt)
      .reduce((n, r) => n + r.sisaSesi * s.modalPerSesiRp, 0);
    balik(s.branchId, b.createdAt, Math.max(0, s.modalTotalRp - sudahDirefund));
  }
  for (const r of refund) {
    const s = r.purchaseId ? snapshot.get(r.purchaseId) : undefined;
    if (!s) continue;
    balik(s.branchId, r.createdAt, Math.min(s.modalTotalRp, r.sisaSesi * s.modalPerSesiRp));
  }

  for (const [cabang, rp] of hasil.modalTerjualPerCabang) tambah(hasil.perCabang, cabang, rp);
  for (const [cabang, rp] of hasil.modalBalikPerCabang) tambah(hasil.perCabang, cabang, -rp);
  hasil.totalRp = hasil.modalTerjualRp - hasil.modalBalikRp;
  return hasil;
}

function gabung(a: HasilModal, b: HasilModal): HasilModal {
  const peta = (x: Map<string, number>, y: Map<string, number>) => {
    const m = new Map(x);
    for (const [k, v] of y) tambah(m, k, v);
    return m;
  };
  return {
    totalRp: a.totalRp + b.totalRp,
    perCabang: peta(a.perCabang, b.perCabang),
    metode: 'CAMPURAN',
    sesiTerjual: a.sesiTerjual + b.sesiTerjual,
    sesiTerjualPerCabang: peta(a.sesiTerjualPerCabang, b.sesiTerjualPerCabang),
    modalTerjualRp: a.modalTerjualRp + b.modalTerjualRp,
    modalTerjualPerCabang: peta(a.modalTerjualPerCabang, b.modalTerjualPerCabang),
    modalBalikRp: a.modalBalikRp + b.modalBalikRp,
    modalBalikPerCabang: peta(a.modalBalikPerCabang, b.modalBalikPerCabang),
    sesiTerpakai: a.sesiTerpakai + b.sesiTerpakai,
    sesiTerpakaiPerCabang: peta(a.sesiTerpakaiPerCabang, b.sesiTerpakaiPerCabang),
    sesiTanpaModal: a.sesiTanpaModal + b.sesiTanpaModal,
    sesiTanpaModalPerCabang: peta(a.sesiTanpaModalPerCabang, b.sesiTanpaModalPerCabang),
    perHari: peta(a.perHari, b.perHari),
  };
}

/**
 * Modal dalam rentang. `branchIds` null berarti semua cabang. Bagian rentang sebelum
 * `MULAI_MODAL_PAKET` memakai aturan pemakaian (angka lama), bagian sesudahnya aturan paket
 * terjual. Dipakai Beranda Owner, settlement, laporan laba, performa cabang, dan dashboard.
 */
export async function hitungModalSesi(db: PrismaService, params: Rentang): Promise<HasilModal> {
  const batas = MULAI_MODAL_PAKET;
  if (params.untilExclusive <= batas) return hitungModalPemakaian(db, params);
  if (params.fromDate >= batas) return hitungModalPaketTerjual(db, params);
  const [lama, baru] = await Promise.all([
    hitungModalPemakaian(db, { ...params, untilExclusive: batas }),
    hitungModalPaketTerjual(db, { ...params, fromDate: batas }),
  ]);
  return gabung(lama, baru);
}

const tidakValid = (field: string, issue: string) =>
  new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [{ field, issue }]);
const tglKunci = (d: Date) => d.toISOString().slice(0, 10);
const hariIniJakarta = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());

@Injectable()
export class ModalSesiService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  private bolehCabang(principal: SessionPrincipal, branchId: string) {
    if (principal.capabilities.includes('branch:all')) return;
    if (!principal.branchIds.includes(branchId))
      throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
  }

  async daftar(principal: SessionPrincipal): Promise<TarifModal[]> {
    this.policy.requireAnyCapability(principal.capabilities, CAP_BACA);
    const rows: BarisTarif[] = await this.db.modalSesi.findMany({
      where: principal.capabilities.includes('branch:all')
        ? {}
        : { branchId: { in: principal.branchIds } },
      orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      branchId: r.branchId,
      classTypeId: r.classTypeId,
      modalPerSesiRp: r.modalPerSesiRp,
      effectiveDate: tglKunci(r.effectiveDate),
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Tarif baru berlaku mulai tanggalnya; tarif lama tetap dipakai untuk pembelian sebelumnya. */
  async simpan(
    principal: SessionPrincipal,
    input: {
      branchId?: unknown;
      classTypeId?: unknown;
      modalPerSesiRp?: unknown;
      effectiveDate?: unknown;
    },
  ): Promise<TarifModal> {
    this.policy.requireCapability(principal.capabilities, CAP_UBAH);
    const branchId = typeof input.branchId === 'string' ? input.branchId : '';
    const classTypeId =
      typeof input.classTypeId === 'string' && input.classTypeId ? input.classTypeId : null;
    const modal = Number(input.modalPerSesiRp);
    const tanggal =
      typeof input.effectiveDate === 'string' ? input.effectiveDate : hariIniJakarta();
    if (!branchId) throw tidakValid('branchId', 'REQUIRED');
    if (!Number.isSafeInteger(modal) || modal < 0)
      throw tidakValid('modalPerSesiRp', 'INVALID_AMOUNT');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) throw tidakValid('effectiveDate', 'INVALID_DATE');
    this.bolehCabang(principal, branchId);
    const [cabang, tipe] = await Promise.all([
      this.db.cabang.findUnique({ where: { id: branchId }, select: { id: true } }),
      classTypeId
        ? this.db.jenisKelas.findUnique({ where: { id: classTypeId }, select: { id: true } })
        : Promise.resolve({ id: null }),
    ]);
    if (!cabang) throw tidakValid('branchId', 'NOT_FOUND');
    if (!tipe) throw tidakValid('classTypeId', 'NOT_FOUND');

    const row: BarisTarif = await this.db.$transaction(async (tx) => {
      const baru = await tx.modalSesi.create({
        data: {
          branchId,
          classTypeId,
          modalPerSesiRp: modal,
          effectiveDate: new Date(`${tanggal}T00:00:00.000Z`),
          createdById: principal.userId,
        },
      });
      await tx.auditLog.create({
        data: {
          action: 'finance.session_cost_created',
          actorId: principal.userId,
          branchId,
          objectType: 'ModalSesi',
          objectId: baru.id,
          detail: { classTypeId, modalPerSesiRp: modal, effectiveDate: tanggal },
        },
      });
      return baru;
    });
    return {
      id: row.id,
      branchId: row.branchId,
      classTypeId: row.classTypeId,
      modalPerSesiRp: row.modalPerSesiRp,
      effectiveDate: tglKunci(row.effectiveDate),
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Menghapus versi tarif yang salah input. */
  async hapus(principal: SessionPrincipal, id: string): Promise<{ id: string }> {
    this.policy.requireCapability(principal.capabilities, CAP_UBAH);
    const row = await this.db.modalSesi.findUnique({ where: { id } });
    if (!row) throw new ApiProblem('NOT_FOUND', HttpStatus.NOT_FOUND);
    this.bolehCabang(principal, row.branchId);
    await this.db.$transaction(async (tx) => {
      await tx.modalSesi.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          action: 'finance.session_cost_deleted',
          actorId: principal.userId,
          branchId: row.branchId,
          objectType: 'ModalSesi',
          objectId: id,
          detail: {
            classTypeId: row.classTypeId,
            modalPerSesiRp: row.modalPerSesiRp,
            effectiveDate: tglKunci(row.effectiveDate),
          },
        },
      });
    });
    return { id };
  }
}
