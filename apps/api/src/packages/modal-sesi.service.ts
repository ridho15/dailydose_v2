import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { bacaOpsional } from '../foundation/tabel-opsional';
import type { SessionPrincipal } from '../identity/identity.service';
import { PolicyService } from '../identity/policy.service';
import { ApiProblem } from '../identity/security';

/**
 * Modal per sesi untuk profit.
 *
 * Profit bulanan = omzet paket yang lunas − modal sesi − pengeluaran. Modal sesi mengikuti
 * **pemakaian**: setiap sesi member yang terpakai (hadir atau tidak hadir) di kelas yang selesai
 * dalam rentang, dikali modal per sesi tipe kelas itu di cabang kelas, memakai tarif yang berlaku
 * pada tanggal kelas. Sesi yang hangus karena paket kedaluwarsa tidak punya modal.
 *
 * Contoh pemilik: paket Group 20 sesi Rp4.000.000 di Untar, modal Group Untar Rp50.000. Bila ke-20
 * sesi dipakai sebelum paket habis, modal totalnya Rp1.000.000 (tersebar di bulan pemakaiannya).
 *
 * Ini terpisah dari fee instruktur: fee adalah yang dibayar ke instruktur per kelas yang di-scan
 * QR (payroll), sedangkan modal sesi hanya dipakai untuk menghitung profit.
 */
const CAP_BACA = ['master:read', 'finance:read'];
const CAP_UBAH = 'master:manage';

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

export interface HasilModal {
  totalRp: number;
  perCabang: Map<string, number>;
  /** Sesi member yang terpakai dalam rentang. */
  sesi: number;
  sesiPerCabang: Map<string, number>;
  /** Sesi tanpa tarif modal yang cocok; dihitung Rp0 sampai tarifnya diatur. */
  sesiTanpaModal: number;
  sesiTanpaModalPerCabang: Map<string, number>;
  /** Modal per tanggal kelas (`YYYY-MM-DD`, UTC), untuk tren harian. */
  perHari: Map<string, number>;
}

/**
 * Tarif yang berlaku untuk satu sesi: tipe kelas di cabang itu lebih dulu, lalu tarif "semua tipe
 * kelas" cabang itu. Versi terbaru yang sudah berlaku pada tanggal kelas.
 */
export function tarifUntuk(
  tarif: readonly BarisTarif[],
  p: { branchId: string; classTypeId: string | null; pada: Date },
): BarisTarif | null {
  const berlaku = (t: BarisTarif) => t.branchId === p.branchId && t.effectiveDate <= p.pada;
  const urut = [...tarif].sort(
    (a, b) =>
      b.effectiveDate.getTime() - a.effectiveDate.getTime() ||
      b.createdAt.getTime() - a.createdAt.getTime(),
  );
  return (
    (p.classTypeId ? urut.find((t) => berlaku(t) && t.classTypeId === p.classTypeId) : undefined) ??
    urut.find((t) => berlaku(t) && t.classTypeId === null) ??
    null
  );
}

type SesiTerpakai = { classSlot: { branchId: string; classTypeId: string; startAt: Date } };

/**
 * Modal dari sesi yang terpakai di kelas selesai dalam rentang. `branchIds` null berarti semua
 * cabang. Dipakai Beranda Owner, settlement, laporan laba, performa cabang, dan dashboard.
 */
export async function hitungModalSesi(
  db: PrismaService,
  params: { branchIds: string[] | null; fromDate: Date; untilExclusive: Date },
): Promise<HasilModal> {
  const hasil: HasilModal = {
    totalRp: 0,
    perCabang: new Map(),
    sesi: 0,
    sesiPerCabang: new Map(),
    sesiTanpaModal: 0,
    sesiTanpaModalPerCabang: new Map(),
    perHari: new Map(),
  };
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
  const tarif: BarisTarif[] =
    typeof db.modalSesi?.findMany === 'function'
      ? await bacaOpsional(
          'modal_sesi',
          () =>
            db.modalSesi.findMany({
              where: { branchId: { in: [...new Set(sesi.map((x) => x.classSlot.branchId))] } },
            }),
          [],
        )
      : [];
  const tambah = (peta: Map<string, number>, kunci: string, n: number) =>
    peta.set(kunci, (peta.get(kunci) ?? 0) + n);

  for (const { classSlot: k } of sesi) {
    hasil.sesi += 1;
    tambah(hasil.sesiPerCabang, k.branchId, 1);
    const t = tarifUntuk(tarif, { branchId: k.branchId, classTypeId: k.classTypeId, pada: k.startAt });
    if (!t) {
      hasil.sesiTanpaModal += 1;
      tambah(hasil.sesiTanpaModalPerCabang, k.branchId, 1);
      continue;
    }
    hasil.totalRp += t.modalPerSesiRp;
    tambah(hasil.perCabang, k.branchId, t.modalPerSesiRp);
    tambah(hasil.perHari, k.startAt.toISOString().slice(0, 10), t.modalPerSesiRp);
  }
  return hasil;
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
