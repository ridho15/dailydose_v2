import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type { SessionPrincipal } from '../identity/identity.service';
import { PolicyService } from '../identity/policy.service';
import { ApiProblem } from '../identity/security';

/**
 * Modal per sesi untuk profit.
 *
 * Profit bulanan = omzet paket yang lunas − modal sesi − pengeluaran. Modal sesi = jumlah sesi
 * paket yang dibeli × modal per sesi tipe kelas paket itu di cabang pembelian, memakai tarif yang
 * berlaku pada tanggal lunas. Contoh: paket Group 20 sesi Rp4.000.000 di Untar, modal Group Untar
 * Rp50.000 → modal Rp1.000.000, profit Rp3.000.000.
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

export type PembelianModal = {
  branchId: string;
  paidAt: Date | null;
  createdAt?: Date;
  package: { sessionCount: number; classTypeId: string | null } | null;
};

export interface HasilModal {
  totalRp: number;
  perCabang: Map<string, number>;
  /** Sesi yang terjual dalam rentang. */
  sesi: number;
  /** Sesi tanpa tarif modal yang cocok; dihitung Rp0 sampai tarifnya diatur. */
  sesiTanpaModal: number;
  sesiTanpaModalPerCabang: Map<string, number>;
  /** Modal per pembelian, urut sama dengan masukan (untuk tren harian). */
  perPembelian: number[];
}

/**
 * Tarif yang berlaku untuk satu pembelian: tipe kelas paket di cabang itu lebih dulu, lalu tarif
 * "semua tipe kelas" cabang itu. Versi terbaru yang sudah berlaku pada tanggal lunas.
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

/** Modal sesi dari daftar pembelian lunas. Dipakai Beranda Owner dan laporan profit. */
export async function hitungModalSesi(
  db: PrismaService,
  pembelian: readonly PembelianModal[],
): Promise<HasilModal> {
  const hasil: HasilModal = {
    totalRp: 0,
    perCabang: new Map(),
    sesi: 0,
    sesiTanpaModal: 0,
    sesiTanpaModalPerCabang: new Map(),
    perPembelian: pembelian.map(() => 0),
  };
  if (!pembelian.length || typeof db.modalSesi?.findMany !== 'function') {
    for (const p of pembelian) {
      const n = p.package?.sessionCount ?? 0;
      hasil.sesi += n;
      hasil.sesiTanpaModal += n;
      hasil.sesiTanpaModalPerCabang.set(
        p.branchId,
        (hasil.sesiTanpaModalPerCabang.get(p.branchId) ?? 0) + n,
      );
    }
    return hasil;
  }
  const tarif: BarisTarif[] = await db.modalSesi.findMany({
    where: { branchId: { in: [...new Set(pembelian.map((p) => p.branchId))] } },
  });
  for (const [i, p] of pembelian.entries()) {
    const n = p.package?.sessionCount ?? 0;
    if (n <= 0) continue;
    hasil.sesi += n;
    const t = tarifUntuk(tarif, {
      branchId: p.branchId,
      classTypeId: p.package?.classTypeId ?? null,
      pada: p.paidAt ?? p.createdAt ?? new Date(),
    });
    if (!t) {
      hasil.sesiTanpaModal += n;
      hasil.sesiTanpaModalPerCabang.set(
        p.branchId,
        (hasil.sesiTanpaModalPerCabang.get(p.branchId) ?? 0) + n,
      );
      continue;
    }
    const rp = n * t.modalPerSesiRp;
    hasil.perPembelian[i] = rp;
    hasil.totalRp += rp;
    hasil.perCabang.set(p.branchId, (hasil.perCabang.get(p.branchId) ?? 0) + rp);
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
