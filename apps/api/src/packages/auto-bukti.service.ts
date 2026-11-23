import { Injectable, Logger, Optional } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { PrismaService } from '../database/prisma.service';
import { bacaOpsional, tabelOpsionalAda } from '../foundation/tabel-opsional';
import type { SessionPrincipal } from '../identity/identity.service';
import { idBuktiBerlaku, jenisBukti } from './bukti-aman';
import { cocokkanBukti, type HasilCekBukti } from './ocr-bukti';
import { ConfigGatedObjectStorageProvider } from './proof-providers';
import { PaymentReviewService } from './verifikasi-pembayaran.service';

/** Pelaku sistem untuk persetujuan otomatis: lolos cek izin yang sama, tanpa akun pengguna. */
export const PELAKU_SISTEM: SessionPrincipal = {
  sessionId: 'sistem:auto-bukti',
  userId: '',
  roles: [{ role: 'SUPER_OWNER', branchId: null }],
  capabilities: ['payment:review', 'payment:decide', 'branch:all'],
  branchIds: [],
};

export const AKSI_AUTO_SETUJU = 'payment.auto_approved_from_proof';
export const AKSI_AUTO_LEWAT = 'payment.auto_check_skipped';

/** Pembacaan teks gambar; dipisah supaya tes tidak menjalankan OCR sungguhan. */
export type PembacaTeks = (gambar: Buffer) => Promise<string>;

/** OCR lokal (tesseract.js, data bahasa dari paket npm, tanpa unduhan saat jalan). */
export const bacaTeksTesseract: PembacaTeks = async (gambar) => {
  const { createWorker } = await import('tesseract.js');
  const langPath = join(dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');
  const worker = await createWorker('eng', 1, { langPath, cacheMethod: 'none', gzip: true });
  try {
    return (await worker.recognize(gambar)).data.text;
  } finally {
    await worker.terminate();
  }
};

/**
 * Persetujuan otomatis transfer dari foto bukti (keputusan pemilik 23 November 2026). Dijalankan di
 * latar setelah bukti diunggah. Disetujui hanya bila SEMUA terpenuhi:
 * - pembayaran transfer bank yang masih menunggu, dengan nominal unik (harga + kode unik);
 * - foto (bukan PDF) belum pernah dipakai pesanan lain (sidik SHA-256 di `bukti_sidik`);
 * - teks foto memuat nominal unik persis dan waktu transfer paling lama 1 jam sebelum diunggah.
 * Selain itu tidak ada yang berubah: bukti tetap menunggu diperiksa staf. Persetujuan memakai jalur
 * keputusan yang sama dengan staf (`PaymentReviewService.decide`) dan tercatat di audit log.
 * Matikan dengan AUTO_APPROVE_BUKTI=false.
 */
@Injectable()
export class AutoBuktiService {
  private readonly logger = new Logger('AutoBukti');
  private antrean: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly db: PrismaService,
    private readonly review: PaymentReviewService,
    @Optional() private readonly storage?: ConfigGatedObjectStorageProvider,
  ) {}

  /** Bisa diganti di tes supaya OCR sungguhan tidak dijalankan. */
  bacaTeks: PembacaTeks = bacaTeksTesseract;

  aktif() {
    return process.env.AUTO_APPROVE_BUKTI !== 'false';
  }

  /** Dipanggil setelah bukti tersimpan; tidak pernah melempar ke pemanggil. Satu per satu (OCR berat). */
  jadwalkan(purchaseId: string, proofId: string): void {
    if (!this.aktif()) return;
    this.antrean = this.antrean
      .then(() => this.periksa(purchaseId, proofId))
      .catch((error) => this.logger.warn(`Cek otomatis ${purchaseId} gagal: ${(error as Error).message}`));
  }

  /** Mengembalikan hasilnya (untuk tes dan log): 'COCOK' berarti sudah disetujui. */
  async periksa(purchaseId: string, proofId: string, sekarang = new Date()): Promise<string> {
    const purchase = await this.db.pembelian.findUnique({
      where: { id: purchaseId },
      select: {
        id: true,
        status: true,
        paymentMethod: true,
        uniqueCode: true,
        totalAmountRp: true,
        createdAt: true,
        branchId: true,
        paymentProof: { select: { id: true, fileUrl: true, uploadedAt: true } },
      },
    });
    if (
      !purchase ||
      purchase.paymentMethod !== 'BANK_TRANSFER' ||
      purchase.uniqueCode == null ||
      !['PENDING', 'WAITING_VERIFICATION'].includes(purchase.status) ||
      !purchase.paymentProof ||
      idBuktiBerlaku(purchase.paymentProof) !== proofId
    )
      return 'TIDAK_BERLAKU';
    // Tanpa tabel sidik, foto dipakai ulang tidak bisa dideteksi: jangan setujui otomatis.
    if (!this.storage || !(await tabelOpsionalAda(this.db, 'bukti_sidik'))) return 'TIDAK_BERLAKU';

    const bytes = await this.storage.readPrivateObject(`payment-proofs/${proofId}`);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const catat = (hasil: string, waktuBukti: Date | null = null) =>
      bacaOpsional(
        'bukti_sidik',
        () =>
          this.db.buktiSidik.upsert({
            where: { proofId },
            create: { proofId, purchaseId, sha256, hasil, waktuBukti },
            update: { sha256, hasil, waktuBukti },
          }),
        null,
      );

    const dipakaiLain = await this.db.buktiSidik.findFirst({
      where: { sha256, purchaseId: { not: purchaseId } },
      select: { purchaseId: true },
    });
    let hasil: string;
    let waktuBukti: Date | null = null;
    if (dipakaiLain) hasil = 'FOTO_DIPAKAI_ULANG';
    else if (!(jenisBukti(bytes) ?? '').startsWith('image/')) hasil = 'BUKAN_GAMBAR';
    else {
      const teks = await this.bacaTeks(bytes).catch(() => null);
      if (teks === null) hasil = 'GAGAL_BACA';
      else {
        const cek: HasilCekBukti = cocokkanBukti({
          teks,
          totalRp: purchase.totalAmountRp,
          dibuatPada: purchase.createdAt,
          diunggahPada: purchase.paymentProof.uploadedAt ?? sekarang,
        });
        hasil = cek.cocok ? 'COCOK' : cek.alasan;
        if (cek.cocok) waktuBukti = cek.waktu;
      }
    }
    await catat(hasil, waktuBukti);

    if (hasil !== 'COCOK') {
      await this.audit(AKSI_AUTO_LEWAT, purchase, { proofId, hasil });
      return hasil;
    }
    await this.review.decide(
      PELAKU_SISTEM,
      purchaseId,
      'APPROVED',
      {
        reasonCode: 'PAYMENT_VERIFIED',
        note: 'Disetujui otomatis: nominal unik dan waktu transfer di foto bukti cocok.',
      },
      `auto-bukti:${proofId}`,
      `auto-bukti:${proofId}`,
    );
    await this.audit(AKSI_AUTO_SETUJU, purchase, {
      proofId,
      nominalRp: purchase.totalAmountRp,
      waktuBukti: waktuBukti?.toISOString() ?? null,
      sha256,
    });
    return hasil;
  }

  private async audit(action: string, purchase: { id: string; branchId: string }, detail: Record<string, unknown>) {
    await this.db.auditLog
      .create({
        data: {
          id: randomUUID(),
          action,
          actorId: null,
          branchId: purchase.branchId,
          objectType: 'Purchase',
          objectId: purchase.id,
          reason: action === AKSI_AUTO_SETUJU ? 'Nominal unik dan waktu di foto bukti cocok' : null,
          detail: detail as never,
        },
      })
      .catch(() => undefined);
  }
}
