import { Injectable, Logger, Optional } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { PrismaService } from '../database/prisma.service';
import { bacaOpsional, tabelOpsionalAda } from '../foundation/tabel-opsional';
import type { SessionPrincipal } from '../identity/identity.service';
import { idBuktiBerlaku, jenisBukti } from './bukti-aman';
import {
  AKSI_AUTO_LEWAT,
  AKSI_AUTO_SETUJU,
  bacaNominal,
  bacaWaktu,
  cocokkanBukti,
  type HasilCekBukti,
} from './ocr-bukti';
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

export { AKSI_AUTO_LEWAT, AKSI_AUTO_SETUJU };

/**
 * Pembacaan teks gambar; dipisah supaya tes tidak menjalankan OCR sungguhan. `cukup` dipanggil dengan
 * teks gabungan sesudah tiap putaran baca; putaran berikutnya dilewati begitu hasilnya cukup.
 */
export type PembacaTeks = (gambar: Buffer, cukup?: (teks: string) => boolean) => Promise<string>;

/**
 * Gambar untuk putaran baca kedua: diperbesar (teks kecil di layar HP), abu-abu, kontras diratakan,
 * dan dibalik bila latarnya gelap (mode gelap aplikasi bank). Null bila gambar tidak bisa diolah.
 */
export async function siapkanGambar(gambar: Buffer): Promise<Buffer | null> {
  try {
    const sharp = (await import('sharp')).default;
    const { width = 0 } = await sharp(gambar).metadata();
    const terang = (await sharp(gambar).greyscale().stats()).channels[0]?.mean ?? 255;
    let olah = sharp(gambar)
      .rotate()
      .greyscale()
      .resize({ width: Math.min(Math.max(width * 2, 1200), 2400), kernel: 'lanczos3' });
    if (terang < 110) olah = olah.negate({ alpha: false });
    return await olah.normalise().png().toBuffer();
  } catch {
    return null;
  }
}

/**
 * OCR lokal (tesseract.js, data bahasa dari paket npm, tanpa unduhan saat jalan). Hingga empat
 * putaran: gambar asli dan gambar olahan, masing-masing dengan susunan halaman otomatis (PSM 3) dan
 * teks terpencar (PSM 11). Tiap aplikasi bank gagal di putaran berbeda; teks semua putaran digabung.
 */
export const bacaTeksTesseract: PembacaTeks = async (gambar, cukup) => {
  const { createWorker } = await import('tesseract.js');
  const langPath = join(dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');
  const worker = await createWorker('eng', 1, { langPath, cacheMethod: 'none', gzip: true });
  const teks: string[] = [];
  let olahan: Buffer | null | undefined;
  const putaran: Array<{ olah: boolean; psm: string }> = [
    { olah: false, psm: '3' },
    { olah: true, psm: '3' },
    { olah: true, psm: '11' },
    { olah: false, psm: '11' },
  ];
  try {
    for (const p of putaran) {
      if (p.olah && olahan === undefined) olahan = await siapkanGambar(gambar);
      const sumber = p.olah ? olahan : gambar;
      if (!sumber) continue;
      await worker.setParameters({ tessedit_pageseg_mode: p.psm as never });
      teks.push((await worker.recognize(sumber)).data.text);
      if (cukup?.(teks.join('\n'))) break;
    }
    return teks.join('\n');
  } finally {
    await worker.terminate();
  }
};

/**
 * Persetujuan otomatis transfer dari foto bukti (keputusan pemilik 23 November 2026). Dijalankan di
 * latar setelah bukti diunggah. Disetujui hanya bila SEMUA terpenuhi:
 * - pembayaran transfer bank yang masih menunggu, dengan nominal unik (harga + kode unik);
 * - foto (bukan PDF) belum pernah dipakai pesanan lain (sidik SHA-256 di `bukti_sidik`);
 * - teks foto memuat nominal unik persis, dan waktu transfernya antara pesanan dibuat dan bukti
 *   diunggah (lihat `cocokkanBukti` untuk bukti tanpa jam terbaca).
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
    if (!purchase || !purchase.paymentProof) return 'TIDAK_BERLAKU';
    // Alasan dilewati dicatat di audit supaya staf (dan pengembang) tahu kenapa tidak disetujui otomatis.
    const lewat = async (alasan: string) => {
      await this.audit(AKSI_AUTO_LEWAT, purchase, { proofId, hasil: alasan });
      return 'TIDAK_BERLAKU';
    };
    // Bukti lama yang sudah diganti: tidak dicatat, hasil bukti terbaru yang berlaku.
    if (idBuktiBerlaku(purchase.paymentProof) !== proofId) return 'TIDAK_BERLAKU';
    if (!['PENDING', 'WAITING_VERIFICATION'].includes(purchase.status)) return 'TIDAK_BERLAKU';
    if (purchase.paymentMethod !== 'BANK_TRANSFER') return lewat('BUKAN_TRANSFER_BANK');
    if (purchase.uniqueCode == null) return lewat('TANPA_KODE_UNIK');
    if (!this.storage) return lewat('PENYIMPANAN_TIDAK_SIAP');
    // Tanpa tabel sidik, foto dipakai ulang dicek dari sidik yang tercatat di audit persetujuan otomatis.
    const adaTabelSidik = await tabelOpsionalAda(this.db, 'bukti_sidik');

    try {
      return await this.periksaFoto(purchase, proofId, sekarang, adaTabelSidik);
    } catch (error) {
      await this.audit(AKSI_AUTO_LEWAT, purchase, {
        proofId,
        hasil: 'GALAT_SISTEM',
        pesan: (error as Error).message?.slice(0, 300) ?? 'tidak diketahui',
      });
      throw error;
    }
  }

  private async periksaFoto(
    purchase: {
      id: string;
      branchId: string;
      totalAmountRp: number;
      createdAt: Date;
      paymentProof: { uploadedAt: Date | null } | null;
    },
    proofId: string,
    sekarang: Date,
    adaTabelSidik: boolean,
  ): Promise<string> {
    const purchaseId = purchase.id;
    const bytes = await this.storage!
      .readPrivateObject(`payment-proofs/${proofId}`)
      .catch(() => null);
    if (!bytes?.length) {
      await this.audit(AKSI_AUTO_LEWAT, purchase, { proofId, hasil: 'FOTO_TIDAK_ADA_DI_PENYIMPANAN' });
      return 'FOTO_TIDAK_ADA_DI_PENYIMPANAN';
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const catat = (hasil: string, waktuBukti: Date | null = null) =>
      adaTabelSidik
        ? bacaOpsional(
            'bukti_sidik',
            () =>
              this.db.buktiSidik.upsert({
                where: { proofId },
                create: { proofId, purchaseId, sha256, hasil, waktuBukti },
                update: { sha256, hasil, waktuBukti },
              }),
            null,
          )
        : Promise.resolve(null);

    const dipakaiLain = adaTabelSidik
      ? await this.db.buktiSidik.findFirst({
          where: { sha256, purchaseId: { not: purchaseId } },
          select: { purchaseId: true },
        })
      : await this.db.auditLog.findFirst({
          where: {
            action: AKSI_AUTO_SETUJU,
            objectId: { not: purchaseId },
            detail: { path: '$.sha256', equals: sha256 },
          },
          select: { objectId: true },
        });
    let hasil: string;
    let waktuBukti: Date | null = null;
    let dasarWaktu: string | null = null;
    // Angka dan waktu yang terbaca OCR, untuk menjelaskan kenapa tidak cocok.
    let terbaca: { nominal: number[]; waktu: string[] } | null = null;
    if (dipakaiLain) hasil = 'FOTO_DIPAKAI_ULANG';
    else if (!(jenisBukti(bytes) ?? '').startsWith('image/')) hasil = 'BUKAN_GAMBAR';
    else {
      const cek = (teks: string): HasilCekBukti =>
        cocokkanBukti({
          teks,
          totalRp: purchase.totalAmountRp,
          dibuatPada: purchase.createdAt,
          diunggahPada: purchase.paymentProof?.uploadedAt ?? sekarang,
        });
      // Berhenti lebih awal hanya bila jam transfer sudah cocok; selain itu semua putaran dibaca supaya
      // jam di luar rentang (bukti lama) tidak terlewat.
      const cukup = (t: string) => {
        const c = cek(t);
        return c.cocok && c.dasarWaktu === 'JAM';
      };
      const teks = await this.bacaTeks(bytes, cukup).catch(() => null);
      if (teks === null) hasil = 'GAGAL_BACA';
      else {
        const acuan = purchase.paymentProof?.uploadedAt ?? sekarang;
        terbaca = {
          nominal: bacaNominal(teks).slice(0, 10),
          waktu: bacaWaktu(teks, acuan).slice(0, 5).map((w) => w.toISOString()),
        };
        const putusan = cek(teks);
        hasil = putusan.cocok ? 'COCOK' : putusan.alasan;
        if (putusan.cocok) {
          waktuBukti = putusan.waktu;
          dasarWaktu = putusan.dasarWaktu;
        }
      }
    }
    await catat(hasil, waktuBukti);

    if (hasil !== 'COCOK') {
      await this.audit(AKSI_AUTO_LEWAT, purchase, {
        proofId,
        hasil,
        nominalDicari: purchase.totalAmountRp,
        ...(terbaca ? { terbaca } : {}),
      });
      return hasil;
    }
    await this.review.decide(
      PELAKU_SISTEM,
      purchaseId,
      'APPROVED',
      {
        reasonCode: 'PAYMENT_VERIFIED',
        note: 'Disetujui otomatis: nominal unik di foto bukti cocok dengan pesanan.',
      },
      `auto-bukti:${proofId}`,
      `auto-bukti:${proofId}`,
    );
    await this.audit(AKSI_AUTO_SETUJU, purchase, {
      proofId,
      nominalRp: purchase.totalAmountRp,
      waktuBukti: waktuBukti?.toISOString() ?? null,
      dasarWaktu,
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
          reason: action === AKSI_AUTO_SETUJU ? 'Nominal unik di foto bukti cocok' : null,
          detail: detail as never,
        },
      })
      .catch(() => undefined);
  }
}
