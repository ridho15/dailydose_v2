import { HttpStatus, Injectable } from '@nestjs/common';
import { PurchaseStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type { SessionPrincipal } from '../identity/identity.service';
import { verificationStatusWhere } from '../identity/manajemen-pelanggan.service';
import { ApiProblem } from '../identity/security';
import { antreanBukti } from './antrean-bukti';
import { RetentionService } from './retention.service';
import { tutupUbahJadwalUsang } from '../bookings/tutup-ubah-jadwal-usang';

/**
 * Satu daftar pekerjaan yang tertinggal, diurutkan dari yang paling merugikan bila dibiarkan.
 *
 * Tiap antrean dibaca dari tabel yang sudah ada dan hanya muncul untuk peran yang boleh
 * menanganinya. Antrean yang gagal dimuat dilaporkan apa adanya, bukan dihitung nol, supaya
 * "tidak ada antrean" selalu berarti memang bersih.
 */

const JAM = 3_600_000;
const HARI = 24 * JAM;

/** Batas wajar sebelum antrean dianggap telat, dalam jam sejak item tertua masuk. */
const BATAS_JAM = {
  renewal: 7 * 24,
  verifikasi: 2 * 24,
  ubahJadwal: 24,
} as const;

/** Rentang paket habis yang masih layak dihubungi: sama dengan jendela renewal. */
const JENDELA_RENEWAL_HARI = 60;
/** Kelas di bawah kuota yang ditampilkan: yang mulai dalam dua hari ke depan. */
const JENDELA_KUOTA_JAM = 48;

export type KunciAntrean = 'renewal' | 'verifikasi' | 'bukti' | 'kuota' | 'ubahJadwal';
export type NadaAntrean = 'TELAT' | 'TENGGAT' | 'MENUNGGU';

export interface ItemAntrean {
  key: KunciAntrean;
  jumlah: number;
  nada: NadaAntrean;
  /** Item tertua masuk antrean (atau, untuk kuota, kelas yang paling dekat mulai). */
  acuanPada: string | null;
  /** Lama item tertua menunggu, dalam jam penuh; null untuk antrean bertenggat. */
  umurJam: number | null;
  nilaiRp?: number;
  /** Jumlah member segmen HOT di antrean renewal. */
  hot?: number;
  /** Kelas di bawah kuota: nama dan jam mulai, paling dekat lebih dulu. */
  kelas?: { id: string; nama: string; mulai: string; terisi: number; minimum: number }[];
  /** Alasan permohonan ubah jadwal yang paling lama menunggu. */
  alasan?: string | null;
  href: string;
}

export interface AntreanTertinggal {
  dibuatPada: string;
  items: ItemAntrean[];
  /** Antrean yang tidak bisa dimuat; ditampilkan sebagai peringatan, bukan disembunyikan. */
  gagal: KunciAntrean[];
}

const jamAntara = (dari: Date, sampai: Date) =>
  Math.max(0, Math.floor((sampai.getTime() - dari.getTime()) / JAM));

const nadaUmur = (umurJam: number, batasJam: number): NadaAntrean =>
  umurJam > batasJam ? 'TELAT' : 'MENUNGGU';

const SEMUA_IZIN = [
  'package:read',
  'identity-verification:read',
  'payment:review',
  'purchase:review',
  'class-slot:read',
  'reschedule:read',
];

const BOBOT_NADA: Record<NadaAntrean, number> = { TELAT: 0, TENGGAT: 1, MENUNGGU: 2 };

/** Telat lebih dulu, lalu yang bertenggat, lalu yang paling lama menunggu. */
export function urutAntrean(items: ItemAntrean[]): ItemAntrean[] {
  return [...items].sort(
    (a, b) => BOBOT_NADA[a.nada] - BOBOT_NADA[b.nada] || (b.umurJam ?? 0) - (a.umurJam ?? 0),
  );
}

@Injectable()
export class AntreanTertinggalService {
  constructor(
    private readonly db: PrismaService,
    private readonly retention: RetentionService,
  ) {}

  async antrean(
    principal: SessionPrincipal,
    input: { branchId?: string } = {},
    now = new Date(),
  ): Promise<AntreanTertinggal> {
    const boleh = (...caps: string[]) => caps.some((c) => principal.capabilities.includes(c));
    const global = principal.capabilities.includes('branch:all');
    const cabang = input.branchId
      ? input.branchId
      : global
        ? undefined
        : { in: principal.branchIds };
    if (input.branchId && !global && !principal.branchIds.includes(input.branchId)) {
      throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
    }
    if (!boleh(...SEMUA_IZIN)) throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);

    const tugas: [KunciAntrean, () => Promise<ItemAntrean | null>][] = [];
    if (boleh('package:read')) tugas.push(['renewal', () => this.renewal(principal, input, now)]);
    if (boleh('identity-verification:read')) tugas.push(['verifikasi', () => this.verifikasi(now)]);
    if (boleh('payment:review', 'purchase:review'))
      tugas.push(['bukti', () => this.bukti(cabang, now)]);
    if (boleh('class-slot:read')) tugas.push(['kuota', () => this.kuota(cabang, now)]);
    if (boleh('reschedule:read')) tugas.push(['ubahJadwal', () => this.ubahJadwal(cabang, now)]);

    const hasil = await Promise.allSettled(tugas.map(([, jalan]) => jalan()));
    const items: ItemAntrean[] = [];
    const gagal: KunciAntrean[] = [];
    hasil.forEach((h, i) => {
      if (h.status === 'rejected') gagal.push(tugas[i]![0]);
      else if (h.value && h.value.jumlah > 0) items.push(h.value);
    });

    return { dibuatPada: now.toISOString(), items: urutAntrean(items), gagal };
  }

  private async renewal(
    principal: SessionPrincipal,
    input: { branchId?: string },
    now: Date,
  ): Promise<ItemAntrean | null> {
    // Laporan renewal untuk staf cabang selalu per cabang; tanpa cabang terpilih antrean ini dilewati.
    const global = principal.capabilities.includes('branch:all');
    if (!global && !input.branchId) return null;
    const until = now.toISOString().slice(0, 10);
    const from = new Date(now.getTime() - JENDELA_RENEWAL_HARI * HARI).toISOString().slice(0, 10);
    const kohort = await this.retention.expiryCohort(
      principal,
      { branchId: input.branchId, from, until },
      now,
    );
    const terbuka = kohort.rows.filter((r) => !r.renewed);
    if (!terbuka.length) return null;
    const tertua = terbuka.reduce((a, b) => (a.validUntil < b.validUntil ? a : b));
    const umurJam = jamAntara(new Date(tertua.validUntil), now);
    return {
      key: 'renewal',
      jumlah: new Set(terbuka.map((r) => r.userId)).size,
      nada: nadaUmur(umurJam, BATAS_JAM.renewal),
      acuanPada: tertua.validUntil,
      umurJam,
      nilaiRp: kohort.potentialLoss.paidRp,
      hot: new Set(terbuka.filter((r) => r.endReason === 'HOT').map((r) => r.userId)).size,
      href: '/workspace/renewal',
    };
  }

  private async verifikasi(now: Date): Promise<ItemAntrean | null> {
    const menunggu: { profile: { updatedAt: Date } | null }[] = await this.db.user.findMany({
      where: { role: 'CUSTOMER', ...verificationStatusWhere('PENDING') },
      select: { profile: { select: { updatedAt: true } } },
      take: 500,
    });
    if (!menunggu.length) return null;
    const waktu = menunggu
      .map((u) => u.profile?.updatedAt)
      .filter((d): d is Date => Boolean(d))
      .sort((a, b) => a.getTime() - b.getTime());
    const tertua = waktu[0] ?? null;
    const umurJam = tertua ? jamAntara(tertua, now) : 0;
    return {
      key: 'verifikasi',
      jumlah: menunggu.length,
      nada: nadaUmur(umurJam, BATAS_JAM.verifikasi),
      acuanPada: tertua ? tertua.toISOString() : null,
      umurJam,
      href: '/identity-verifications?status=PENDING',
    };
  }

  private async bukti(cabang: unknown, now: Date): Promise<ItemAntrean | null> {
    const pembelian: { totalAmountRp: number; paymentProof: { uploadedAt: Date } | null }[] =
      await this.db.pembelian.findMany({
        where: {
          ...(cabang ? { branchId: cabang as string } : {}),
          status: { in: [PurchaseStatus.PENDING, PurchaseStatus.WAITING_VERIFICATION] },
          paymentProof: { isNot: null },
        },
        select: { totalAmountRp: true, paymentProof: { select: { uploadedAt: true } } },
        take: 500,
      });
    const antre = pembelian
      .filter((p) => p.paymentProof)
      .map((p) => ({
        p,
        umur: antreanBukti({ uploadedAt: p.paymentProof!.uploadedAt, now }),
      }));
    if (!antre.length) return null;
    const tertua = antre.reduce((a, b) => (a.umur.umurJam >= b.umur.umurJam ? a : b));
    return {
      key: 'bukti',
      jumlah: antre.length,
      nada: antre.some((a) => a.umur.status === 'TELAT') ? 'TELAT' : 'MENUNGGU',
      acuanPada: tertua.p.paymentProof!.uploadedAt.toISOString(),
      umurJam: tertua.umur.umurJam,
      nilaiRp: antre.reduce((s, a) => s + a.p.totalAmountRp, 0),
      href: '/workspace/payments?status=PENDING',
    };
  }

  private async kuota(cabang: unknown, now: Date): Promise<ItemAntrean | null> {
    const slots: {
      id: string;
      startAt: Date;
      bookedCount: number;
      minQuota: number | null;
      classType: { name: string } | null;
    }[] = await this.db.slotKelas.findMany({
      where: {
        ...(cabang ? { branchId: cabang as string } : {}),
        status: 'PUBLISHED',
        minQuota: { not: null },
        startAt: { gte: now, lt: new Date(now.getTime() + JENDELA_KUOTA_JAM * JAM) },
      },
      select: {
        id: true,
        startAt: true,
        bookedCount: true,
        minQuota: true,
        classType: { select: { name: true } },
      },
      orderBy: { startAt: 'asc' },
      take: 200,
    });
    const kurang = slots.filter((s) => s.minQuota !== null && s.bookedCount < s.minQuota);
    if (!kurang.length) return null;
    return {
      key: 'kuota',
      jumlah: kurang.length,
      nada: 'TENGGAT',
      acuanPada: kurang[0]!.startAt.toISOString(),
      umurJam: null,
      kelas: kurang.slice(0, 3).map((s) => ({
        id: s.id,
        nama: s.classType?.name ?? 'Kelas',
        mulai: s.startAt.toISOString(),
        terisi: s.bookedCount,
        minimum: s.minQuota ?? 0,
      })),
      href: '/workspace/classes',
    };
  }

  private async ubahJadwal(cabang: unknown, now: Date): Promise<ItemAntrean | null> {
    await tutupUbahJadwalUsang(this.db, now);
    const permohonan: { requestedAt: Date; reason: string | null }[] =
      await this.db.ubahJadwal.findMany({
        where: {
          status: 'PENDING',
          ...(cabang ? { sourceSlot: { branchId: cabang as string } } : {}),
        },
        select: { requestedAt: true, reason: true },
        orderBy: { requestedAt: 'asc' },
        take: 200,
      });
    if (!permohonan.length) return null;
    const tertua = permohonan[0]!;
    const umurJam = jamAntara(tertua.requestedAt, now);
    return {
      key: 'ubahJadwal',
      jumlah: permohonan.length,
      nada: nadaUmur(umurJam, BATAS_JAM.ubahJadwal),
      acuanPada: tertua.requestedAt.toISOString(),
      umurJam,
      alasan: tertua.reason,
      href: '/workspace/bookings?tab=reschedules&status=PENDING',
    };
  }
}
