import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, PurchaseStatus } from '@prisma/client';
import { KODE_PEMBATALAN_TERLAMBAT } from '../bookings/pembatalan-terlambat';
import { PrismaService } from '../database/prisma.service';
import type { SessionPrincipal } from '../identity/identity.service';
import { PolicyService } from '../identity/policy.service';
import { ApiProblem } from '../identity/security';
import { AntreanTertinggalService } from './antrean-tertinggal.service';

/**
 * Kotak masuk "Perlu tindakan": satu daftar keputusan yang menunggu, per peran.
 *
 * Berbeda dari antrean lama (`work-queue/overdue` dan `dashboard.queues`) yang dibaca dari izin
 * BACA, setiap jenis di sini hanya muncul bila pengguna boleh MEMUTUSnya di cabang item itu, dan
 * item yang tidak boleh ia putus sendiri (pemisahan tugas) tidak dihitung. Keputusannya tetap
 * lewat endpoint yang sudah ada, yang memeriksa ulang semua aturan di server.
 */

export type JenisTindakan =
  | 'TRANSFER'
  | 'PENJUALAN_LANGSUNG'
  | 'RESCHEDULE'
  | 'PEMBATALAN'
  | 'PENYESUAIAN';

export const SEMUA_JENIS: readonly JenisTindakan[] = [
  'TRANSFER',
  'PENJUALAN_LANGSUNG',
  'PEMBATALAN',
  'RESCHEDULE',
  'PENYESUAIAN',
];

/** Kapabilitas yang boleh memutus tiap jenis (cukup salah satu). */
export const IZIN_PUTUS: Record<JenisTindakan, readonly string[]> = {
  TRANSFER: ['payment:decide', 'purchase:decide'],
  PENJUALAN_LANGSUNG: ['payment:decide', 'purchase:decide'],
  RESCHEDULE: ['reschedule:decide'],
  PEMBATALAN: ['booking:late-cancel:decide', 'ledger:adjust:decide'],
  PENYESUAIAN: ['ledger:adjust:decide'],
};

/** Metode yang uangnya diterima langsung di meja; disetujui Manager/Super Owner (PRD 5.12). */
export const METODE_LANGSUNG = ['CASH', 'CARD', 'MANUAL_STAFF'] as const;
const METODE_TRANSFER = ['BANK_TRANSFER', 'QRIS'] as const;
const STATUS_MENUNGGU = [PurchaseStatus.PENDING, PurchaseStatus.WAITING_VERIFICATION];

const BAWAAN_PER_JENIS = 5;
const MAKS_HALAMAN = 50;

export interface ItemTindakan {
  id: string;
  jenis: JenisTindakan;
  version: number;
  /** Saat item masuk antrean (bukti diunggah, penjualan dicatat, pengajuan dibuat). */
  masukPada: string;
  branchId: string | null;
  branchName: string | null;
  /** Nama member yang bersangkutan. */
  nama: string;
  /** Satu baris rincian: paket, kelas, atau alasan. */
  rincian: string;
  nilaiRp?: number;
  metode?: string;
  pencatat?: string | null;
  alasan?: string | null;
  sesi?: number;
  kelas?: { nama: string; mulai: string } | null;
  kelasTujuan?: { nama: string; mulai: string } | null;
  /** Transfer: ada bukti yang bisa dibuka. */
  buktiAda?: boolean;
}

export interface KotakTindakan {
  dibuatPada: string;
  ringkasan: { jenis: JenisTindakan; jumlah: number }[];
  items: ItemTindakan[];
  nextCursor: string | null;
  /** Hal yang perlu diperhatikan tetapi bukan keputusan (dari antrean tertinggal). */
  pengingat: { key: 'renewal' | 'kuota'; jumlah: number; href: string }[];
  gagal: JenisTindakan[];
}

type Cakupan = { all: boolean; included: string[]; excluded: string[] };

export function kodekanKursor(masukPada: Date, id: string) {
  return Buffer.from(`${masukPada.toISOString()}|${id}`, 'utf8').toString('base64url');
}

export function bacaKursor(cursor?: string): { masukPada: Date; id: string } | null {
  if (!cursor) return null;
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const masukPada = new Date(iso ?? '');
  if (!id || Number.isNaN(masukPada.getTime()))
    throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
      { field: 'cursor', issue: 'INVALID' },
    ]);
  return { masukPada, id };
}

/** Kondisi "setelah kursor" untuk urutan (kolom waktu naik, id naik). */
function setelah<T extends string>(kolom: T, kursor: { masukPada: Date; id: string } | null) {
  if (!kursor) return {};
  return {
    OR: [
      { [kolom]: { gt: kursor.masukPada } },
      { [kolom]: kursor.masukPada, id: { gt: kursor.id } },
    ],
  };
}

@Injectable()
export class KotakTindakanService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly antrean: AntreanTertinggalService,
  ) {}

  private superOwner(principal: SessionPrincipal) {
    return principal.roles.some((r) => r.role === 'SUPER_OWNER');
  }

  /** Gabungan cakupan cabang dari beberapa kapabilitas, dipersempit ke cabang yang diminta. */
  cakupan(principal: SessionPrincipal, jenis: JenisTindakan, branchId?: string): Cakupan | null {
    const caps = IZIN_PUTUS[jenis].filter((c) => principal.capabilities.includes(c));
    if (!caps.length) return null;
    // Penjualan tunai/kartu hanya boleh disetujui Manager atau Super Owner, bukan Finance.
    if (
      jenis === 'PENJUALAN_LANGSUNG' &&
      !principal.roles.some((r) => r.role === 'MANAGER' || r.role === 'SUPER_OWNER')
    )
      return null;
    const gabung: Cakupan = { all: false, included: [], excluded: [] };
    for (const cap of caps) {
      const s = this.policy.capabilityBranchScope(principal, cap);
      if (s.all) {
        gabung.excluded = gabung.all
          ? gabung.excluded.filter((b) => s.excluded.includes(b))
          : s.excluded;
        gabung.all = true;
      } else gabung.included.push(...s.included);
    }
    if (gabung.all) gabung.excluded = gabung.excluded.filter((b) => !gabung.included.includes(b));
    gabung.included = [...new Set(gabung.included)];
    if (branchId) {
      const boleh = gabung.all ? !gabung.excluded.includes(branchId) : gabung.included.includes(branchId);
      return boleh ? { all: false, included: [branchId], excluded: [] } : null;
    }
    if (!gabung.all && !gabung.included.length) return null;
    return gabung;
  }

  private filterCabang(c: Cakupan): { in: string[] } | { notIn: string[] } | undefined {
    if (!c.all) return { in: c.included };
    return c.excluded.length ? { notIn: c.excluded } : undefined;
  }

  async daftar(
    principal: SessionPrincipal,
    input: { branchId?: string; jenis?: string; cursor?: string; limit?: string | number },
    now = new Date(),
  ): Promise<KotakTindakan> {
    const bolehApaSaja = SEMUA_JENIS.some((j) =>
      IZIN_PUTUS[j].some((c) => principal.capabilities.includes(c)),
    );
    if (!bolehApaSaja && !principal.capabilities.some((c) => ['package:read', 'class-slot:read'].includes(c)))
      throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
    if (
      input.branchId &&
      !principal.capabilities.includes('branch:all') &&
      !principal.branchIds.includes(input.branchId)
    )
      throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
    const jenisDiminta = input.jenis as JenisTindakan | undefined;
    if (jenisDiminta && !SEMUA_JENIS.includes(jenisDiminta))
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'jenis', issue: 'INVALID' },
      ]);
    const kursor = jenisDiminta ? bacaKursor(input.cursor) : null;
    const limit = jenisDiminta
      ? Math.min(MAKS_HALAMAN, Math.max(1, Number(input.limit) || 20))
      : BAWAAN_PER_JENIS;

    const jenisDipakai = SEMUA_JENIS.filter(
      (j) => (!jenisDiminta || j === jenisDiminta) && this.cakupan(principal, j, input.branchId),
    );
    const ringkasan: KotakTindakan['ringkasan'] = [];
    const items: ItemTindakan[] = [];
    const gagal: JenisTindakan[] = [];
    let nextCursor: string | null = null;

    const hasil = await Promise.allSettled(
      jenisDipakai.map((j) =>
        this.muat(principal, j, this.cakupan(principal, j, input.branchId)!, kursor, limit),
      ),
    );
    hasil.forEach((h, i) => {
      const jenis = jenisDipakai[i]!;
      if (h.status === 'rejected') {
        gagal.push(jenis);
        return;
      }
      if (h.value.jumlah > 0) ringkasan.push({ jenis, jumlah: h.value.jumlah });
      items.push(...h.value.items);
      if (jenisDiminta) nextCursor = h.value.nextCursor;
    });
    items.sort((a, b) => a.masukPada.localeCompare(b.masukPada) || a.id.localeCompare(b.id));

    let pengingat: KotakTindakan['pengingat'] = [];
    if (!jenisDiminta) {
      try {
        const lama = await this.antrean.antrean(principal, { branchId: input.branchId }, now);
        pengingat = lama.items
          .filter((i) => i.key === 'renewal' || i.key === 'kuota')
          .map((i) => ({ key: i.key as 'renewal' | 'kuota', jumlah: i.jumlah, href: i.href }));
      } catch {
        pengingat = [];
      }
    }

    return { dibuatPada: now.toISOString(), ringkasan, items, nextCursor, pengingat, gagal };
  }

  private async muat(
    principal: SessionPrincipal,
    jenis: JenisTindakan,
    cakupan: Cakupan,
    kursor: { masukPada: Date; id: string } | null,
    limit: number,
  ): Promise<{ jumlah: number; items: ItemTindakan[]; nextCursor: string | null }> {
    const cabang = this.filterCabang(cakupan);
    const saya = principal.userId;
    const bebasPisah = this.superOwner(principal);
    const halaman = <T extends { id: string }>(rows: T[], waktu: (r: T) => Date) => {
      const lebih = rows.length > limit;
      const dipakai = lebih ? rows.slice(0, limit) : rows;
      const akhir = dipakai.at(-1);
      return { dipakai, nextCursor: lebih && akhir ? kodekanKursor(waktu(akhir), akhir.id) : null };
    };

    if (jenis === 'TRANSFER' || jenis === 'PENJUALAN_LANGSUNG') {
      const transfer = jenis === 'TRANSFER';
      const where: Prisma.PembelianWhereInput = {
        status: { in: STATUS_MENUNGGU },
        paymentMethod: { in: [...(transfer ? METODE_TRANSFER : METODE_LANGSUNG)] },
        ...(cabang ? { branchId: cabang } : {}),
        // Transfer baru bisa diputus setelah bukti diunggah; yang belum ada bukti masih menunggu member.
        ...(transfer ? { paymentProof: { isNot: null } } : {}),
        // Pemisahan tugas: pembeli dan pencatat tidak memutus transaksinya sendiri.
        ...(bebasPisah
          ? {}
          : { userId: { not: saya }, OR: [{ recordedById: null }, { recordedById: { not: saya } }] }),
      };
      const [jumlah, rows] = await Promise.all([
        this.db.pembelian.count({ where }),
        this.db.pembelian.findMany({
          where: { AND: [where, setelah('createdAt', kursor)] },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: limit + 1,
          select: {
            id: true,
            createdAt: true,
            totalAmountRp: true,
            paymentMethod: true,
            recordedById: true,
            branchId: true,
            user: { select: { displayName: true } },
            branch: { select: { name: true } },
            package: { select: { name: true } },
            paymentProof: { select: { uploadedAt: true } },
          },
        }),
      ]);
      const { dipakai, nextCursor } = halaman(rows, (r) => r.createdAt);
      const pencatat = await this.namaPengguna(dipakai.map((r) => r.recordedById));
      return {
        jumlah,
        nextCursor,
        items: dipakai.map((r) => ({
          id: r.id,
          jenis,
          // Versi pembelian tidak disimpan di tabel; endpoint keputusan membaca versi terbaru dari detail.
          version: 0,
          masukPada: (r.paymentProof?.uploadedAt ?? r.createdAt).toISOString(),
          branchId: r.branchId,
          branchName: r.branch?.name ?? null,
          nama: r.user?.displayName ?? 'Member',
          rincian: r.package?.name ?? 'Paket',
          nilaiRp: r.totalAmountRp,
          metode: r.paymentMethod,
          pencatat: r.recordedById ? (pencatat.get(r.recordedById) ?? null) : null,
          buktiAda: Boolean(r.paymentProof),
        })),
      };
    }

    if (jenis === 'RESCHEDULE') {
      const where: Prisma.UbahJadwalWhereInput = {
        status: 'PENDING',
        ...(cabang ? { sourceSlot: { branchId: cabang } } : {}),
      };
      const [jumlah, rows] = await Promise.all([
        this.db.ubahJadwal.count({ where }),
        this.db.ubahJadwal.findMany({
          where: { AND: [where, setelah('requestedAt', kursor)] },
          orderBy: [{ requestedAt: 'asc' }, { id: 'asc' }],
          take: limit + 1,
          select: {
            id: true,
            requestedAt: true,
            reason: true,
            booking: { select: { user: { select: { displayName: true } } } },
            sourceSlot: {
              select: {
                branchId: true,
                startAt: true,
                branch: { select: { name: true } },
                classType: { select: { name: true } },
              },
            },
            targetSlot: { select: { startAt: true, classType: { select: { name: true } } } },
          },
        }),
      ]);
      const { dipakai, nextCursor } = halaman(rows, (r) => r.requestedAt);
      return {
        jumlah,
        nextCursor,
        items: dipakai.map((r) => ({
          id: r.id,
          jenis,
          version: 0,
          masukPada: r.requestedAt.toISOString(),
          branchId: r.sourceSlot.branchId,
          branchName: r.sourceSlot.branch?.name ?? null,
          nama: r.booking?.user?.displayName ?? 'Member',
          rincian: `${r.sourceSlot.classType?.name ?? 'Kelas'} pindah ke ${r.targetSlot.classType?.name ?? 'kelas lain'}`,
          alasan: r.reason,
          kelas: { nama: r.sourceSlot.classType?.name ?? 'Kelas', mulai: r.sourceSlot.startAt.toISOString() },
          kelasTujuan: {
            nama: r.targetSlot.classType?.name ?? 'Kelas',
            mulai: r.targetSlot.startAt.toISOString(),
          },
        })),
      };
    }

    // PEMBATALAN dan PENYESUAIAN memakai tabel session_adjust_request yang sama.
    const pembatalan = jenis === 'PEMBATALAN';
    const where: Prisma.SessionAdjustRequestWhereInput = {
      status: 'PENDING',
      ...(pembatalan
        ? {
            reasonCode: KODE_PEMBATALAN_TERLAMBAT,
            ...(cabang ? { booking: { is: { classSlot: { branchId: cabang } } } } : {}),
          }
        : {
            OR: [{ reasonCode: null }, { reasonCode: { not: KODE_PEMBATALAN_TERLAMBAT } }],
            ...(cabang
              ? { customerPackage: { is: { purchase: { is: { branchId: cabang } } } } }
              : {}),
          }),
      ...(bebasPisah ? {} : { requestedById: { not: saya } }),
    };
    const [jumlah, rows] = await Promise.all([
      this.db.sessionAdjustRequest.count({ where }),
      this.db.sessionAdjustRequest.findMany({
        where: { AND: [where, setelah('createdAt', kursor)] },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit + 1,
        select: {
          id: true,
          version: true,
          createdAt: true,
          reason: true,
          sessionCount: true,
          requestedBy: { select: { displayName: true } },
          customerPackage: {
            select: {
              user: { select: { displayName: true } },
              package: { select: { name: true } },
              purchase: { select: { branchId: true, branch: { select: { name: true } } } },
            },
          },
          booking: {
            select: {
              classSlot: {
                select: {
                  branchId: true,
                  startAt: true,
                  branch: { select: { name: true } },
                  classType: { select: { name: true } },
                },
              },
            },
          },
        },
      }),
    ]);
    const { dipakai, nextCursor } = halaman(rows, (r) => r.createdAt);
    return {
      jumlah,
      nextCursor,
      items: dipakai.map((r) => {
        const slot = r.booking?.classSlot;
        const pembelian = r.customerPackage?.purchase;
        return {
          id: r.id,
          jenis,
          version: r.version,
          masukPada: r.createdAt.toISOString(),
          branchId: slot?.branchId ?? pembelian?.branchId ?? null,
          branchName: slot?.branch?.name ?? pembelian?.branch?.name ?? null,
          nama: r.customerPackage?.user?.displayName ?? 'Member',
          rincian: pembatalan
            ? `${slot?.classType?.name ?? 'Kelas'}`
            : (r.customerPackage?.package?.name ?? 'Paket'),
          alasan: r.reason,
          sesi: r.sessionCount,
          pencatat: r.requestedBy?.displayName ?? null,
          kelas: slot ? { nama: slot.classType?.name ?? 'Kelas', mulai: slot.startAt.toISOString() } : null,
        };
      }),
    };
  }

  private async namaPengguna(ids: Array<string | null>) {
    const unik = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (!unik.length) return new Map<string, string>();
    const rows = await this.db.user.findMany({
      where: { id: { in: unik } },
      select: { id: true, displayName: true },
    });
    return new Map(rows.map((r) => [r.id, r.displayName]));
  }
}
