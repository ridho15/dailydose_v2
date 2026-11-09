import { HttpStatus } from '@nestjs/common';
import { extname, resolve, sep } from 'node:path';
import { ApiProblem, ENTITY_ID_REGEX } from '../identity/security';
import { kenaliBukti } from './penyesuaian-bukti.service';
import type { ObjectStorageProvider } from './proof-providers';

/**
 * Aturan keamanan bukti transfer.
 *
 * Alamat berkas bukti selalu dibentuk server dari id unggahan (`/uploads/payment-proofs/<id>`),
 * tidak pernah dari isian peminta: dulu `fileUrl` dari body ikut disimpan lalu dibaca apa adanya,
 * sehingga `../../.env` bisa diunduh. Siapa pemilik sebuah unggahan dicatat di berkas penanda
 * di penyimpanan privat (tanpa tabel baru), jadi hanya orang yang memulai unggahan yang boleh
 * mengisi dan melampirkannya.
 */

export const alamatBukti = (id: string) => `/uploads/payment-proofs/${id}`;
const kunciPenanda = (id: string) => `payment-proofs/${id}.pemilik`;

/** Status pesanan yang masih boleh menerima atau mengganti bukti. */
export const STATUS_TERIMA_BUKTI = ['PENDING', 'WAITING_VERIFICATION'] as const;

export function idUnggahan(id: unknown): string {
  if (typeof id !== 'string' || !ENTITY_ID_REGEX.test(id))
    throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
  return id;
}

export function bolehTerimaBukti(
  order: { status: string; paymentExpiresAt?: Date | null },
  olehStaf = false,
  now = new Date(),
) {
  if (!(STATUS_TERIMA_BUKTI as readonly string[]).includes(order.status)) return false;
  // Staf cabang boleh mengunggah bukti manual walau batas bayar lewat (member sudah transfer tetapi
  // gagal/lupa mengunggah); persetujuan tetap lewat pemeriksaan mutasi oleh Manager/Finance.
  if (olehStaf) return true;
  // Pelanggan: setelah batas bayar lewat, bukti tidak lagi diterima dari aplikasi.
  return !order.paymentExpiresAt || order.paymentExpiresAt.getTime() > now.getTime();
}

/** Kode penolakan yang bisa dijelaskan ke pengguna: pesanan sudah diputus, atau batas bayar lewat. */
export function buktiDitolak(order: { status: string }) {
  return (STATUS_TERIMA_BUKTI as readonly string[]).includes(order.status)
    ? 'PAYMENT_PROOF_DEADLINE_PASSED'
    : 'PAYMENT_PROOF_ORDER_CLOSED';
}

/** Teks bebas dari pelanggan (nama bank, pemilik rekening): dipangkas dan dibatasi panjangnya. */
export function teksPendek(value: unknown, maks = 100): string | null {
  if (typeof value !== 'string') return null;
  const bersih = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return bersih ? bersih.slice(0, maks) : null;
}

export async function catatPemilik(storage: ObjectStorageProvider | undefined, id: string, userId: string) {
  if (!storage) return;
  await storage.storePrivateObject(kunciPenanda(id), Buffer.from(userId, 'utf8'));
}

/**
 * Pastikan unggahan `id` dimulai oleh `userId`. Tanpa penyimpanan berkas tidak ada isi yang bisa
 * disalahgunakan, jadi pemeriksaan dilewati.
 */
export async function pastikanPemilik(storage: ObjectStorageProvider | undefined, id: string, userId: string) {
  if (!storage) return;
  const pemilik = await storage
    .readPrivateObject(kunciPenanda(id))
    .then((b) => b.toString('utf8'))
    .catch(() => null);
  if (pemilik !== userId) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
}

export const jenisBukti = (bytes: Buffer) => kenaliBukti(bytes)?.mime ?? null;

const EKSTENSI_LOKAL = new Set(['.jpg', '.jpeg', '.png', '.webp', '.pdf']);

/**
 * Berkas bukti lama (hasil migrasi V1) yang tersimpan di disk relatif terhadap folder kerja.
 * Hanya gambar/PDF di dalam folder kerja; `..`, jalur absolut, dan berkas lain ditolak.
 */
export function jalurBuktiLokal(fileUrl: string, root = process.cwd()): string | null {
  const bersih = fileUrl.replace(/^\/+/, '');
  if (!bersih || bersih.split(/[\\/]/).some((bagian) => bagian === '..' || bagian.startsWith('.')))
    return null;
  if (!EKSTENSI_LOKAL.has(extname(bersih).toLowerCase())) return null;
  const dasar = resolve(root);
  const penuh = resolve(dasar, bersih);
  return penuh.startsWith(dasar + sep) ? penuh : null;
}

export const escapeXml = (value: string) =>
  value.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
