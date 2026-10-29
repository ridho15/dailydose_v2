import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type { SessionPrincipal } from '../identity/identity.service';
import { PolicyService } from '../identity/policy.service';
import { financeRange } from './finance-range';
import { calculateSlotFee, sortFeesNewestFirst } from './instructor-fee-calculator';
import { AKSI_KOREKSI_JAM } from './koreksi-jam.service';

/**
 * Payroll milik instruktur sendiri untuk satu bulan.
 *
 * Yang dihitung hanya kelas yang selesai DAN presensinya terverifikasi (QR instruktur dipindai di
 * meja check-in, atau diverifikasi admin), ditambah koreksi jam dari Manager/Super Owner. Kelas
 * selesai tanpa presensi ditampilkan terpisah sebagai "belum terverifikasi" dan tidak masuk total,
 * supaya instruktur tahu apa yang perlu dikoreksi.
 *
 * Tarifnya memakai kalkulator yang sama dengan laporan keuangan.
 */

export interface BarisPayroll {
  classSlotId: string;
  mulai: string;
  selesai: string;
  namaKelas: string;
  namaCabang: string;
  jam: number;
  tarifPerJamRp: number;
  honorRp: number;
  terverifikasi: boolean;
  /** Jam presensi tercatat, bila ada. */
  hadirPada: string | null;
}

export interface KoreksiPayroll {
  id: string;
  kelasMulai: string;
  jam: number;
  nilaiRp: number;
  alasan: string | null;
  dicatatPada: string;
}

export interface PayrollInstruktur {
  period: string;
  from: string;
  until: string;
  /** Honor kelas terverifikasi + koreksi; inilah angka yang dibayarkan. */
  totalRp: number;
  terverifikasiRp: number;
  koreksiRp: number;
  /** Selalu 0: kelas belum terverifikasi tidak diberi nominal sampai check-in tercatat. */
  belumTerverifikasiRp: number;
  kelasTerverifikasi: number;
  kelasBelumTerverifikasi: number;
  jamTerverifikasi: number;
  kelas: BarisPayroll[];
  koreksi: KoreksiPayroll[];
}

type SlotPayroll = {
  id: string;
  branchId: string;
  classTypeId: string;
  startAt: Date;
  endAt: Date;
  instructorFeeRp: number | null;
  isManualFee: boolean;
  classType: { name: string } | null;
  branch: { name: string } | null;
  instructorAttendance: { checkedInAt: Date } | null;
};

@Injectable()
export class PayrollInstrukturService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  async milikSaya(
    principal: SessionPrincipal,
    input: { period?: string } = {},
    now = new Date(),
  ): Promise<PayrollInstruktur> {
    this.policy.requireAnyCapability(principal.capabilities, [
      'attendance:self',
      'class:assigned:read',
    ]);
    const period = input.period ?? now.toISOString().slice(0, 7);
    const range = financeRange({ period });
    const instructorId = principal.userId;

    const [slots, fees, koreksiAudit]: [
      SlotPayroll[],
      Awaited<ReturnType<PrismaService['instructorFee']['findMany']>>,
      { objectId: string | null; reason: string | null; detail: unknown; createdAt: Date }[],
    ] = await Promise.all([
      this.db.slotKelas.findMany({
        where: {
          instructorId,
          status: 'COMPLETED',
          startAt: { gte: range.fromDate, lt: range.untilExclusive },
        },
        select: {
          id: true,
          branchId: true,
          classTypeId: true,
          startAt: true,
          endAt: true,
          instructorFeeRp: true,
          isManualFee: true,
          classType: { select: { name: true } },
          branch: { select: { name: true } },
          instructorAttendance: { select: { checkedInAt: true } },
        },
        orderBy: { startAt: 'desc' },
      }),
      this.db.instructorFee.findMany({ where: { instructorId } }),
      this.db.auditLog.findMany({
        where: {
          action: AKSI_KOREKSI_JAM,
          targetUserId: instructorId,
          createdAt: { gte: range.fromDate },
        },
        select: { objectId: true, reason: true, detail: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const tarif = sortFeesNewestFirst(fees);
    const kelas: BarisPayroll[] = slots.map((s) => {
      const hitung = calculateSlotFee(tarif, { ...s, instructorId });
      return {
        classSlotId: s.id,
        mulai: s.startAt.toISOString(),
        selesai: s.endAt.toISOString(),
        namaKelas: s.classType?.name ?? 'Kelas',
        namaCabang: s.branch?.name ?? '',
        jam: hitung.hours,
        // Nominal hanya untuk kelas yang check-in QR-nya tercatat; kelas lain tampil tanpa rupiah.
        tarifPerJamRp: s.instructorAttendance ? hitung.feePerJamRp : 0,
        honorRp: s.instructorAttendance ? hitung.feeRp : 0,
        terverifikasi: Boolean(s.instructorAttendance),
        hadirPada: s.instructorAttendance?.checkedInAt.toISOString() ?? null,
      };
    });

    const koreksi: KoreksiPayroll[] = koreksiAudit
      .map((k) => {
        const d = (k.detail as { after?: Record<string, unknown> } | null)?.after ?? {};
        return {
          id: k.objectId ?? '',
          kelasMulai: typeof d.classStartAt === 'string' ? d.classStartAt : '',
          jam: typeof d.hours === 'number' ? d.hours : 0,
          nilaiRp: typeof d.amountRp === 'number' ? d.amountRp : 0,
          alasan: k.reason,
          dicatatPada: k.createdAt.toISOString(),
        };
      })
      // Koreksi masuk ke bulan kelasnya, sama seperti laporan keuangan.
      .filter((k) => {
        const t = new Date(k.kelasMulai).getTime();
        return t >= range.fromDate.getTime() && t < range.untilExclusive.getTime();
      });

    const terverifikasi = kelas.filter((k) => k.terverifikasi);
    const belum = kelas.filter((k) => !k.terverifikasi);
    const jumlah = (xs: { honorRp: number }[]) => xs.reduce((s, x) => s + x.honorRp, 0);
    const terverifikasiRp = jumlah(terverifikasi);
    const koreksiRp = koreksi.reduce((s, k) => s + k.nilaiRp, 0);

    return {
      period,
      from: range.from,
      until: range.until,
      totalRp: terverifikasiRp + koreksiRp,
      terverifikasiRp,
      koreksiRp,
      // Tidak dihitung dan tidak diberi nominal sampai check-in terverifikasi.
      belumTerverifikasiRp: 0,
      kelasTerverifikasi: terverifikasi.length,
      kelasBelumTerverifikasi: belum.length,
      jamTerverifikasi: terverifikasi.reduce((s, k) => s + k.jam, 0),
      kelas,
      koreksi,
    };
  }
}
