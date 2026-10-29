import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type { SessionPrincipal } from '../identity/identity.service';
import { PolicyService } from '../identity/policy.service';
import { ApiProblem } from '../identity/security';
import { financeRange, otherCostInRange } from './finance-range';
import { RingkasanKeuanganService } from './ringkasan-keuangan.service';

/**
 * Settlement akhir bulan antar Super Owner.
 *
 * Laba tiap cabang (omzet − payroll − pengeluaran, sama dengan Beranda Owner) dibagi menurut porsi
 * Super Owner di cabang itu. Pengeluaran yang dibayar dengan uang pribadi Super Owner sudah
 * mengurangi laba, jadi diganti terpisah (reimburse). Yang dibayar cabang ke tiap Super Owner =
 * hak laba + reimburse. Laba negatif berarti Super Owner menutup kekurangannya.
 */
export const CAP_SETTLEMENT = 'owner-settlement:manage';
const PENUH_BP = 10_000;

export interface OwnerSingkat {
  id: string;
  nama: string;
}

export interface PorsiCabang {
  branchId: string;
  branchName: string;
  porsi: { ownerId: string; nama: string; persen: number }[];
  /** Jumlah porsi 100%; tanpa porsi lengkap, laba cabang belum bisa dibagi. */
  lengkap: boolean;
}

export interface BarisSettlement {
  ownerId: string;
  nama: string;
  persen: number;
  hakRp: number;
  reimburseRp: number;
  totalRp: number;
}

export interface SettlementCabang {
  branchId: string;
  branchName: string;
  labaRp: number;
  porsiLengkap: boolean;
  baris: BarisSettlement[];
}

export interface SettlementOwner {
  period: string;
  owners: (OwnerSingkat & { hakRp: number; reimburseRp: number; totalRp: number })[];
  cabang: SettlementCabang[];
  /** Laba cabang yang belum punya porsi lengkap; belum dibagi ke siapa pun. */
  labaBelumDibagiRp: number;
}

/** Membagi laba menurut porsi; sisa pembulatan masuk ke porsi terbesar agar jumlahnya tepat. */
export function bagiLaba(labaRp: number, porsi: { ownerId: string; porsiBp: number }[]) {
  const hasil = new Map(porsi.map((p) => [p.ownerId, Math.round((labaRp * p.porsiBp) / PENUH_BP)]));
  const terbagi = [...hasil.values()].reduce((a, b) => a + b, 0);
  const terbesar = [...porsi].sort((a, b) => b.porsiBp - a.porsiBp)[0];
  if (terbesar && terbagi !== labaRp)
    hasil.set(terbesar.ownerId, (hasil.get(terbesar.ownerId) ?? 0) + labaRp - terbagi);
  return hasil;
}

@Injectable()
export class SettlementOwnerService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly ringkasan: RingkasanKeuanganService,
  ) {}

  /** Super Owner aktif; dipakai pilihan "Dibayar oleh" saat mencatat pengeluaran. */
  async daftarOwner(principal: SessionPrincipal): Promise<OwnerSingkat[]> {
    this.policy.requireAnyCapability(principal.capabilities, [
      'expense:create',
      'finance:manage',
      CAP_SETTLEMENT,
    ]);
    const rows = await this.db.user.findMany({
      where: { role: 'SUPER_OWNER', status: 'ACTIVE' },
      select: { id: true, displayName: true },
      orderBy: { displayName: 'asc' },
    });
    return rows.map((u) => ({ id: u.id, nama: u.displayName }));
  }

  async porsi(principal: SessionPrincipal): Promise<PorsiCabang[]> {
    this.policy.requireCapability(principal.capabilities, CAP_SETTLEMENT);
    const [cabang, rows, owners] = await Promise.all([
      this.db.cabang.findMany({
        where: { active: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.db.porsiOwnerCabang.findMany(),
      this.daftarOwnerSemua(),
    ]);
    const nama = new Map(owners.map((o) => [o.id, o.nama]));
    return cabang.map((c) => {
      const milik = rows.filter((r) => r.branchId === c.id);
      return {
        branchId: c.id,
        branchName: c.name,
        porsi: milik.map((r) => ({
          ownerId: r.ownerId,
          nama: nama.get(r.ownerId) ?? 'Super Owner',
          persen: r.porsiBp / 100,
        })),
        lengkap: milik.reduce((a, r) => a + r.porsiBp, 0) === PENUH_BP,
      };
    });
  }

  /** Mengganti porsi satu cabang sekaligus. Jumlahnya harus 100%, atau kosong untuk menghapus. */
  async simpanPorsi(
    principal: SessionPrincipal,
    branchId: string,
    input: { porsi?: unknown },
  ): Promise<PorsiCabang> {
    this.policy.requireCapability(principal.capabilities, CAP_SETTLEMENT);
    const daftar = Array.isArray(input?.porsi) ? input.porsi : null;
    if (!daftar) throw tidakValid('porsi', 'REQUIRED');
    const cabang = await this.db.cabang.findUnique({
      where: { id: branchId },
      select: { id: true },
    });
    if (!cabang) throw new ApiProblem('NOT_FOUND', HttpStatus.NOT_FOUND);

    const owners = new Set((await this.daftarOwnerSemua()).map((o) => o.id));
    const bersih: { ownerId: string; porsiBp: number }[] = [];
    for (const item of daftar as { ownerId?: unknown; persen?: unknown }[]) {
      if (typeof item?.ownerId !== 'string' || !owners.has(item.ownerId))
        throw tidakValid('ownerId', 'NOT_SUPER_OWNER');
      const persen = Number(item.persen);
      if (!Number.isFinite(persen) || persen < 0 || persen > 100)
        throw tidakValid('persen', 'OUT_OF_RANGE');
      const porsiBp = Math.round(persen * 100);
      if (porsiBp > 0) bersih.push({ ownerId: item.ownerId, porsiBp });
    }
    if (new Set(bersih.map((p) => p.ownerId)).size !== bersih.length)
      throw tidakValid('ownerId', 'DUPLICATE');
    const total = bersih.reduce((a, p) => a + p.porsiBp, 0);
    if (bersih.length > 0 && total !== PENUH_BP) throw tidakValid('persen', 'MUST_TOTAL_100');

    await this.db.$transaction(async (tx) => {
      await tx.porsiOwnerCabang.deleteMany({ where: { branchId } });
      if (bersih.length)
        await tx.porsiOwnerCabang.createMany({
          data: bersih.map((p) => ({ ...p, branchId, updatedById: principal.userId })),
        });
      await tx.auditLog.create({
        data: {
          action: 'finance.owner_share_updated',
          actorId: principal.userId,
          branchId,
          objectType: 'PorsiOwnerCabang',
          objectId: branchId,
          detail: { porsi: bersih.map((p) => ({ ownerId: p.ownerId, persen: p.porsiBp / 100 })) },
        },
      });
    });
    return (await this.porsi(principal)).find((p) => p.branchId === branchId)!;
  }

  async settlement(
    principal: SessionPrincipal,
    input: { period?: string } = {},
    now = new Date(),
  ): Promise<SettlementOwner> {
    this.policy.requireCapability(principal.capabilities, CAP_SETTLEMENT);
    const bulanan = await this.ringkasan.ringkasanBulanan(principal, input, now);
    const range = financeRange({ period: bulanan.period });
    const ids = bulanan.cabang.map((c) => c.branchId);

    const [porsiRows, owners, biayaOwner] = await Promise.all([
      this.db.porsiOwnerCabang.findMany({ where: { branchId: { in: ids } } }),
      this.daftarOwnerSemua(),
      this.reimburse(ids, range),
    ]);
    const nama = new Map(owners.map((o) => [o.id, o.nama]));
    const total = new Map<string, { hakRp: number; reimburseRp: number }>();
    const tambah = (ownerId: string, hakRp: number, reimburseRp: number) => {
      const ada = total.get(ownerId) ?? { hakRp: 0, reimburseRp: 0 };
      total.set(ownerId, { hakRp: ada.hakRp + hakRp, reimburseRp: ada.reimburseRp + reimburseRp });
    };

    let labaBelumDibagiRp = 0;
    const cabang: SettlementCabang[] = bulanan.cabang.map((c) => {
      const porsi = porsiRows.filter((p) => p.branchId === c.branchId);
      const lengkap = porsi.reduce((a, p) => a + p.porsiBp, 0) === PENUH_BP;
      const hak = lengkap ? bagiLaba(c.profitRp, porsi) : new Map<string, number>();
      if (!lengkap) labaBelumDibagiRp += c.profitRp;
      const reimburseCabang = biayaOwner.get(c.branchId) ?? new Map<string, number>();
      const ownerIds = [...new Set([...porsi.map((p) => p.ownerId), ...reimburseCabang.keys()])];
      const baris = ownerIds.map((ownerId) => {
        const hakRp = hak.get(ownerId) ?? 0;
        const reimburseRp = reimburseCabang.get(ownerId) ?? 0;
        tambah(ownerId, hakRp, reimburseRp);
        return {
          ownerId,
          nama: nama.get(ownerId) ?? 'Super Owner',
          persen: (porsi.find((p) => p.ownerId === ownerId)?.porsiBp ?? 0) / 100,
          hakRp,
          reimburseRp,
          totalRp: hakRp + reimburseRp,
        };
      });
      return {
        branchId: c.branchId,
        branchName: c.branchName,
        labaRp: c.profitRp,
        porsiLengkap: lengkap,
        baris,
      };
    });

    return {
      period: bulanan.period,
      owners: owners
        .filter((o) => total.has(o.id))
        .map((o) => {
          const t = total.get(o.id)!;
          return {
            ...o,
            hakRp: t.hakRp,
            reimburseRp: t.reimburseRp,
            totalRp: t.hakRp + t.reimburseRp,
          };
        }),
      cabang,
      labaBelumDibagiRp,
    };
  }

  /** Pengeluaran bulan ini yang dibayar Super Owner, per cabang lalu per Super Owner. */
  private async reimburse(branchIds: string[], range: ReturnType<typeof financeRange>) {
    const biaya = await this.db.otherCost.findMany({
      where: { branchId: { in: branchIds }, ...otherCostInRange(range) },
      select: { id: true, branchId: true, amountRp: true },
    });
    const pembayar = biaya.length
      ? await this.db.pembayarPengeluaran.findMany({
          where: { otherCostId: { in: biaya.map((b) => b.id) } },
        })
      : [];
    const olehSiapa = new Map(pembayar.map((p) => [p.otherCostId, p.dibayarOlehId]));
    const hasil = new Map<string, Map<string, number>>();
    for (const b of biaya) {
      const owner = olehSiapa.get(b.id);
      if (!owner) continue;
      const perOwner = hasil.get(b.branchId) ?? new Map<string, number>();
      perOwner.set(owner, (perOwner.get(owner) ?? 0) + b.amountRp);
      hasil.set(b.branchId, perOwner);
    }
    return hasil;
  }

  /** Termasuk Super Owner nonaktif, supaya porsi dan reimburse lama tetap bernama. */
  private async daftarOwnerSemua(): Promise<OwnerSingkat[]> {
    const rows = await this.db.user.findMany({
      where: { role: 'SUPER_OWNER' },
      select: { id: true, displayName: true },
      orderBy: { displayName: 'asc' },
    });
    return rows.map((u) => ({ id: u.id, nama: u.displayName }));
  }
}

function tidakValid(field: string, issue: string) {
  return new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
    { field, issue },
  ]);
}
