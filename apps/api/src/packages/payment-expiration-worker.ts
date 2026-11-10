import { Injectable, Logger } from '@nestjs/common';
import { PurchaseStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { lepasKuotaVoucher } from './voucher.service';

/**
 * Batalkan pesanan mandiri pelanggan yang lewat batas bayar tanpa bukti. Hanya recordedById null:
 * penjualan yang dicatat staf menunggu persetujuan dan tidak boleh hangus otomatis. Syarat dipasang
 * ulang di UPDATE tiap pesanan supaya yang baru disetujui atau baru diberi bukti tidak tertimpa;
 * kuota voucher dikembalikan hanya untuk pesanan yang benar-benar dibatalkan.
 */
export async function batalkanPesananKedaluwarsa(
  db: PrismaService,
  olderThanHours: number,
  now: Date,
  alasan?: string,
): Promise<string[]> {
  const cutoff = new Date(now.getTime() - olderThanHours * 3600 * 1000);
  const kedaluwarsa = {
    status: PurchaseStatus.PENDING,
    paymentProof: null,
    recordedById: null,
    OR: [
      { paymentExpiresAt: { lt: now } },
      { AND: [{ paymentExpiresAt: null }, { createdAt: { lt: cutoff } }] },
    ],
  };
  const kandidat = await db.pembelian.findMany({
    where: kedaluwarsa,
    select: { id: true, voucherId: true },
  });
  if (kandidat.length === 0) return [];

  return db.$transaction(async (tx) => {
    const dibatalkan: string[] = [];
    for (const k of kandidat) {
      const hasil = await tx.pembelian.updateMany({
        where: { id: k.id, ...kedaluwarsa },
        data: { status: PurchaseStatus.CANCELLED, ...(alasan ? { rejectionReason: alasan } : {}) },
      });
      if (hasil.count === 0) continue;
      dibatalkan.push(k.id);
      await lepasKuotaVoucher(tx, k.voucherId);
    }
    return dibatalkan;
  });
}

@Injectable()
export class PaymentExpirationWorkerService {
  private readonly logger = new Logger(PaymentExpirationWorkerService.name);

  constructor(private readonly db: PrismaService) {}

  /**
   * Scans and expires unpaid PENDING self-service orders that have exceeded their payment window
   */
  async expirePendingOrders(olderThanHours = 24): Promise<{
    expiredCount: number;
    executedAt: string;
    cancelledIds: string[];
  }> {
    const now = new Date();
    const cancelledIds = await batalkanPesananKedaluwarsa(
      this.db,
      olderThanHours,
      now,
      `EXPIRED_AUTOMATIC: Tidak melakukan pembayaran dalam ${olderThanHours} jam.`,
    );

    this.logger.log(
      `PaymentExpirationWorker: Cancelled ${cancelledIds.length} stale pending purchases older than ${olderThanHours}h.`,
    );

    return {
      expiredCount: cancelledIds.length,
      executedAt: now.toISOString(),
      cancelledIds,
    };
  }
}

let terakhirDirapikan = 0;

/**
 * Jaring pengaman bila penjadwal tidak berjalan (SCHEDULER_ENABLED mati atau proses API baru
 * restart): saat daftar pesanan dibuka, pesanan mandiri yang lewat batas bayar tanpa bukti
 * dibatalkan dulu dengan aturan yang sama. Paling sering sekali per menit per proses; kegagalan
 * tidak menggagalkan daftar.
 */
export async function rapikanPesananKedaluwarsa(db: PrismaService, now = new Date()) {
  if (now.getTime() - terakhirDirapikan < 60_000) return;
  terakhirDirapikan = now.getTime();
  try {
    if (typeof (db as any)?.pembelian?.findMany !== 'function' || typeof (db as any)?.$transaction !== 'function') return;
    await batalkanPesananKedaluwarsa(db, 24, now);
  } catch (error) {
    new Logger('PesananKedaluwarsa').warn(`Gagal merapikan pesanan kedaluwarsa: ${(error as Error)?.message ?? error}`);
  }
}
