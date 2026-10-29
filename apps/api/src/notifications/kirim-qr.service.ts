import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import QRCode from 'qrcode';
import { buildPass } from '../attendance/check-in-pass';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../foundation/audit.service';
import type { SessionPrincipal } from '../identity/identity.service';
import { PolicyService } from '../identity/policy.service';
import { ApiProblem } from '../identity/security';
import { WhatsAppGatewayService } from './whatsapp-gateway.service';

/**
 * Mengirim QR kehadiran tetap (dd-pass) lewat WhatsApp sebagai gambar.
 *
 * - Manual: staf menekan "Kirim QR via WhatsApp" di profil member atau instruktur.
 * - Otomatis: penjadwal mengirim ke akun member/instruktur baru yang belum pernah menerimanya.
 *
 * "Pernah menerima" dibaca dari `reminder_log` (jenis `CHECK_IN_QR`), jadi tidak ada kolom baru,
 * dan pengiriman yang gagal otomatis dicoba lagi pada putaran berikutnya.
 */

export const JENIS_PESAN_QR = 'CHECK_IN_QR';
/** Akun yang dibuat dalam rentang ini dikirimi QR otomatis; akun lama lewat tombol manual. */
const JENDELA_AKUN_BARU_HARI = 7;
const MAKS_PER_PUTARAN = 50;
/** Klik ganda staf dalam waktu singkat tidak mengirim dua kali. */
const JEDA_MANUAL_MS = 2 * 60_000;
/** Otomatis cukup sekali seumur akun. */
const JEDA_OTOMATIS_MS = 3650 * 24 * 3_600_000;

type Penerima = {
  id: string;
  displayName: string;
  phone: string | null;
  role: string;
  status: string;
};

export interface HasilKirimQr {
  status: 'SENT' | 'FAILED' | 'SKIPPED_DUPLICATE';
  /** `MOCK` berarti kunci WhatsApp belum dipasang: pesan hanya dicatat, tidak sampai. */
  provider: string;
  error?: string;
}

export function keteranganQr(nama: string, peran: 'CUSTOMER' | 'INSTRUCTOR'): string {
  const depan = nama.trim().split(/\s+/)[0] || nama;
  return peran === 'INSTRUCTOR'
    ? `Halo ${depan}, ini QR kehadiran mengajar Daily Dose Anda. Simpan gambar ini dan tunjukkan ke staf di meja check-in setiap tiba di studio; presensi dan honor tercatat dari sini. Jangan bagikan ke orang lain.`
    : `Halo ${depan}, ini QR kehadiran Daily Dose Anda. Simpan gambar ini dan tunjukkan ke staf di meja check-in setiap datang ke kelas. QR ini sama untuk semua kelas Anda; jangan bagikan ke orang lain.`;
}

@Injectable()
export class KirimQrService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly whatsapp: WhatsAppGatewayService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private async gambar(userId: string): Promise<Buffer> {
    return QRCode.toBuffer(buildPass(userId), {
      type: 'png',
      width: 720,
      margin: 3,
      errorCorrectionLevel: 'M',
    });
  }

  private async kirimKe(
    orang: Penerima,
    jedaMs: number,
    sumber: 'MANUAL' | 'OTOMATIS',
  ): Promise<HasilKirimQr> {
    const peran = orang.role === 'INSTRUCTOR' ? 'INSTRUCTOR' : 'CUSTOMER';
    const hasil = await this.whatsapp.sendMessage({
      to: orang.phone ?? '',
      text: keteranganQr(orang.displayName, peran),
      imagePng: await this.gambar(orang.id),
      recipientType: peran,
      reminderType: JENIS_PESAN_QR,
      dedupWindowMs: jedaMs,
      payload: { userId: orang.id, sumber },
    });
    return { status: hasil.status, provider: hasil.provider, error: hasil.error };
  }

  /** Staf mengirim QR ke satu member atau instruktur. */
  async kirimManual(principal: SessionPrincipal, userId: string): Promise<HasilKirimQr> {
    this.policy.requireAnyCapability(principal.capabilities, [
      'attendance:manage',
      'customer:manage',
    ]);
    const orang: (Penerima & { instructorAssignments: { branchId: string }[] }) | null =
      await this.db.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          displayName: true,
          phone: true,
          role: true,
          status: true,
          instructorAssignments: { where: { active: true }, select: { branchId: true } },
        },
      });
    if (!orang || (orang.role !== 'CUSTOMER' && orang.role !== 'INSTRUCTOR')) {
      throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    // Instruktur hanya untuk staf cabang tempat ia mengajar; member tidak terikat cabang.
    if (
      orang.role === 'INSTRUCTOR' &&
      !principal.capabilities.includes('branch:all') &&
      !orang.instructorAssignments.some((a) => principal.branchIds.includes(a.branchId))
    ) {
      throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
    }
    if (orang.status !== 'ACTIVE') {
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'userId', issue: 'ACCOUNT_INACTIVE' },
      ]);
    }
    if (!orang.phone) {
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'phone', issue: 'REQUIRED' },
      ]);
    }

    const hasil = await this.kirimKe(orang, JEDA_MANUAL_MS, 'MANUAL');
    await this.audit?.catat(null, {
      actorId: principal.userId,
      action: 'checkin.qr_whatsapp_sent',
      objectType: 'User',
      objectId: orang.id,
      targetUserId: orang.id,
      afterMasked: { status: hasil.status, provider: hasil.provider },
    });
    return hasil;
  }

  /** Dijalankan penjadwal: QR untuk akun baru yang belum pernah menerimanya. */
  async kirimOtomatis(
    now = new Date(),
  ): Promise<{ dikirim: number; gagal: number; dilewati: number }> {
    const sejak = new Date(now.getTime() - JENDELA_AKUN_BARU_HARI * 24 * 3_600_000);
    const calon: Penerima[] = await this.db.user.findMany({
      where: {
        role: { in: ['CUSTOMER', 'INSTRUCTOR'] },
        status: 'ACTIVE',
        stoppedAt: null,
        phone: { not: null },
        createdAt: { gte: sejak },
      },
      select: { id: true, displayName: true, phone: true, role: true, status: true },
      orderBy: { createdAt: 'asc' },
      take: MAKS_PER_PUTARAN,
    });
    let dikirim = 0;
    let gagal = 0;
    let dilewati = 0;
    for (const orang of calon) {
      const hasil = await this.kirimKe(orang, JEDA_OTOMATIS_MS, 'OTOMATIS').catch(() => null);
      if (!hasil || hasil.status === 'FAILED') gagal += 1;
      else if (hasil.status === 'SKIPPED_DUPLICATE') dilewati += 1;
      else dikirim += 1;
    }
    return { dikirim, gagal, dilewati };
  }
}
