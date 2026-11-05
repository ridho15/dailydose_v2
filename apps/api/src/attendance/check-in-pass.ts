import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Pass check-in tetap milik satu orang, dipakai berulang kali, dipindai oleh perangkat studio.
 *
 * Berbeda dari `deriveCheckInToken` yang terikat pada satu booking dan hangus saat kelas selesai,
 * pass ini tidak pernah berubah selama akunnya hidup. Member cukup menyimpan gambarnya sekali.
 *
 * Nilainya diturunkan dari HMAC(userId), bukan dari userId mentah, supaya tidak ada yang bisa
 * menebak pass orang lain dengan mencoba id berurutan. Mengetahui pass hanya memberi satu
 * kemampuan: menyatakan kehadiran pada kelas yang memang sudah dipesan orang itu, di cabang
 * tempat perangkat pemindai berada. Pass tidak memberi akses ke akun, pembelian, atau data apa pun.
 */
const PREFIX = 'dd-pass:v1:';
const BODY = /^[A-Za-z0-9_-]{43}$/u;

function secret(): string {
  return (
    process.env.CHECK_IN_PASS_SECRET ||
    process.env.CHECK_IN_TOKEN_SECRET ||
    process.env.SESSION_SECRET ||
    'dailydose-pass-secret'
  );
}

/** Bagian rahasia pass, 43 karakter base64url. */
export function derivePassBody(userId: string): string {
  return createHmac('sha256', secret()).update(`check-in-pass:v1:${userId}`).digest('base64url');
}

/** Isi QR yang dicetak atau disimpan member: `dd-pass:v1:<43 karakter>`. */
export function buildPass(userId: string): string {
  return `${PREFIX}${derivePassBody(userId)}`;
}

/**
 * Membaca isi QR hasil pindai. Menerima bentuk lengkap maupun badannya saja, karena sebagian
 * pemindai memotong awalan. Mengembalikan `null` untuk apa pun yang bukan pass.
 */
export function parsePass(scanned: string): string | null {
  const trimmed = scanned.trim();
  if (BODY.test(trimmed)) return trimmed;
  if (trimmed.startsWith(PREFIX)) {
    const body = trimmed.slice(PREFIX.length);
    if (BODY.test(body)) return body;
  }
  return null;
}

/**
 * Membandingkan pass yang dipindai dengan pass milik satu pengguna, dalam waktu tetap supaya
 * lamanya perbandingan tidak membocorkan seberapa banyak karakter yang sudah benar.
 */
export function passBelongsTo(userId: string, scannedBody: string): boolean {
  const expected = Buffer.from(derivePassBody(userId), 'utf8');
  const actual = Buffer.from(scannedBody, 'utf8');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/** Jendela pemindaian: terbuka 45 menit sebelum kelas mulai sampai kelas berakhir. */
export const SCAN_OPENS_MINUTES_BEFORE = 45;

export type ScanWindow = 'TOO_EARLY' | 'OPEN' | 'CLOSED';

/**
 * Batas terlambat instruktur (keputusan pemilik, 5 November 2026): scan QR instruktur masih diterima
 * sampai 10 menit setelah kelas MULAI (kelas 10.00 masih bisa scan 10.10), dan setiap scan setelah
 * jam mulai dicatat sebagai anomali di laporan Super Owner. Lewat dari itu presensinya dicatat
 * manual oleh admin/manager.
 */
export const TOLERANSI_INSTRUKTUR_MENIT = 10;

export function scanWindowFor(startAt: Date, endAt: Date, now: Date): ScanWindow {
  if (now < new Date(startAt.getTime() - SCAN_OPENS_MINUTES_BEFORE * 60_000)) return 'TOO_EARLY';
  return now <= endAt ? 'OPEN' : 'CLOSED';
}

/** Jendela scan instruktur: dibuka 45 menit sebelum mulai, ditutup 10 menit setelah mulai. */
export function scanWindowInstruktur(startAt: Date, _endAt: Date, now: Date): ScanWindow {
  if (now < new Date(startAt.getTime() - SCAN_OPENS_MINUTES_BEFORE * 60_000)) return 'TOO_EARLY';
  return now.getTime() <= startAt.getTime() + TOLERANSI_INSTRUKTUR_MENIT * 60_000 ? 'OPEN' : 'CLOSED';
}

/** Menit keterlambatan instruktur terhadap jam mulai (0 bila tepat waktu). */
export const menitTerlambat = (startAt: Date, checkedInAt: Date) =>
  Math.max(0, Math.floor((checkedInAt.getTime() - startAt.getTime()) / 60_000));
