import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type { SessionPrincipal } from '../identity/identity.service';
import { PolicyService } from '../identity/policy.service';
import { ApiProblem } from '../identity/security';
import { hitungPace, kalimatPace, type Pace } from './target-pace';

const PERIODE = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface PaceQuery {
  /** Null atau tidak diisi berarti gabungan cabang yang boleh dilihat pemanggil. */
  branchId?: string | null;
  /** `YYYY-MM`. Tanpa isi memakai bulan berjalan. */
  period?: string;
  /** Menimpa target yang tersimpan, untuk simulasi "bagaimana kalau targetnya sekian". */
  targetRpOverride?: number;
}

export interface PaceResult {
  branchId: string | null;
  branchName: string | null;
  period: string;
  /** Null berarti targetnya belum dipasang, bukan nol. */
  pace: Pace | null;
  /** Satu kalimat siap tempel; berisi ajakan memasang target bila belum ada. */
  ringkasan: string;
}

/**
 * Laju pencapaian target omzet.
 *
 * Target bulanan disimpan pada `Cabang.monthlyTargetRp`, dipasang Super Owner di menu cabang dan
 * berlaku terus sampai diubah. Omzet dihitung dari pembelian berstatus PAID dengan `paidAt` di
 * dalam periode, sumber yang sama dengan laporan omzet keuangan, supaya dasbor target dan laporan
 * keuangan tidak pernah menampilkan dua angka berbeda untuk hal yang sama.
 *
 * Target gabungan beberapa cabang adalah jumlah target cabangnya, bukan angka tersendiri, sehingga
 * tidak mungkin ada total perusahaan yang diam-diam berbeda dari jumlah bagiannya.
 */
@Injectable()
export class TargetService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  /**
   * Permintaan satu cabang harus cabang miliknya. Permintaan gabungan dibiarkan lewat karena
   * `cabangTerlihat` sudah membatasi penjumlahan pada cabang milik pemanggil, sehingga Owner
   * dua cabang memperoleh angka gabungan miliknya sendiri tanpa pernah menyentuh cabang lain.
   */
  private wajibAksesCabang(principal: SessionPrincipal, branchId: string | null) {
    if (branchId === null) return;
    if (principal.capabilities.includes('branch:all')) return;
    if (!principal.branchIds.includes(branchId)) {
      throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
    }
  }

  private wajibPeriode(period: string) {
    if (!PERIODE.test(period)) {
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'period', issue: 'INVALID_PERIOD' },
      ]);
    }
  }

  async pace(
    principal: SessionPrincipal,
    input: PaceQuery = {},
    now = new Date(),
  ): Promise<PaceResult> {
    // Meja depan (Admin) boleh melihat target dari pusat untuk satu cabangnya sendiri, tanpa
    // simulasi dan tanpa angka gabungan; laporan keuangan lengkap tetap butuh `finance:read`.
    if (!principal.capabilities.includes('finance:read')) {
      this.policy.requireCapability(principal.capabilities, 'attendance:manage');
      if (!input.branchId || input.targetRpOverride !== undefined)
        throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
    }

    const period = input.period ?? now.toISOString().slice(0, 7);
    this.wajibPeriode(period);

    if (input.targetRpOverride !== undefined) {
      if (!Number.isInteger(input.targetRpOverride) || input.targetRpOverride < 0) {
        throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
          { field: 'targetRpOverride', issue: 'MUST_BE_NON_NEGATIVE_INTEGER' },
        ]);
      }
    }

    const branchId = input.branchId ?? null;
    this.wajibAksesCabang(principal, branchId);

    const cabang = await this.cabangTerlihat(principal, branchId);
    if (cabang.length === 0) {
      return {
        branchId,
        branchName: null,
        period,
        pace: null,
        ringkasan: 'Cabang tidak ditemukan.',
      };
    }

    const targetTersimpan = cabang.reduce(
      (jumlah: number, c: CabangTarget) => jumlah + (c.monthlyTargetRp ?? 0),
      0,
    );
    const adaTarget = cabang.some((c: CabangTarget) => c.monthlyTargetRp !== null);
    const targetRp = input.targetRpOverride ?? targetTersimpan;

    const branchName = branchId ? (cabang[0]?.name ?? null) : null;

    if (input.targetRpOverride === undefined && !adaTarget) {
      return {
        branchId,
        branchName,
        period,
        pace: null,
        ringkasan: branchId
          ? 'Target bulanan cabang ini belum dipasang. Pasang di menu cabang.'
          : 'Belum ada cabang yang memasang target bulanan.',
      };
    }

    const tercapaiRp = await this.omzetPeriode(
      cabang.map((c: CabangTarget) => c.id),
      period,
    );
    const pace = hitungPace({ period, targetRp, tercapaiRp, now });

    return { branchId, branchName, period, pace, ringkasan: kalimatPace(pace, rupiah) };
  }

  /** Cabang yang masuk hitungan: satu cabang bila diminta, selain itu semua yang boleh dilihat. */
  private async cabangTerlihat(
    principal: SessionPrincipal,
    branchId: string | null,
  ): Promise<CabangTarget[]> {
    if (branchId) {
      const satu = await this.db.cabang.findUnique({
        where: { id: branchId },
        select: { id: true, name: true, monthlyTargetRp: true },
      });
      return satu ? [satu] : [];
    }

    return this.db.cabang.findMany({
      where: {
        active: true,
        ...(principal.capabilities.includes('branch:all')
          ? {}
          : { id: { in: principal.branchIds } }),
      },
      select: { id: true, name: true, monthlyTargetRp: true },
      orderBy: { code: 'asc' },
    });
  }

  /**
   * Memakai `paidAt`, bukan `createdAt`, agar pesanan yang dibuat akhir bulan lalu tetapi dibayar
   * bulan ini dihitung pada bulan uangnya benar-benar masuk.
   */
  private async omzetPeriode(branchIds: string[], period: string): Promise<number> {
    const awal = new Date(`${period}-01T00:00:00.000Z`);
    const akhir = new Date(awal);
    akhir.setUTCMonth(akhir.getUTCMonth() + 1);

    const hasil = await this.db.pembelian.aggregate({
      _sum: { totalAmountRp: true },
      where: {
        status: 'PAID',
        paidAt: { gte: awal, lt: akhir },
        branchId: { in: branchIds },
      },
    });
    return hasil._sum.totalAmountRp ?? 0;
  }
}

interface CabangTarget {
  id: string;
  name: string;
  monthlyTargetRp: number | null;
}

function rupiah(n: number): string {
  return `Rp ${n.toLocaleString('id-ID')}`;
}
