/**
 * Membaca nominal dan waktu transfer dari teks hasil OCR foto bukti, lalu memutuskan apakah bukti itu
 * cocok untuk disetujui otomatis (keputusan pemilik 23 November 2026):
 * - nominal di bukti sama persis dengan nominal unik pesanan (harga + kode unik);
 * - waktu transfer di bukti paling lama 1 jam sebelum bukti diunggah, dan tidak sebelum pesanan dibuat.
 * Fungsi di sini murni (tanpa I/O) supaya bisa diuji dengan teks dari berbagai aplikasi bank.
 */

const BULAN: Record<string, number> = {
  jan: 0, januari: 0, january: 0,
  feb: 1, februari: 1, february: 1, peb: 1,
  mar: 2, maret: 2, march: 2,
  apr: 3, april: 3,
  mei: 4, may: 4,
  jun: 5, juni: 5, june: 5,
  jul: 6, juli: 6, july: 6,
  agu: 7, agt: 7, ags: 7, agustus: 7, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  okt: 9, oktober: 9, oct: 9, october: 9,
  nov: 10, nopember: 10, november: 10,
  des: 11, desember: 11, dec: 11, december: 11,
};

/** Selisih zona Indonesia terhadap UTC (jam). Tanpa keterangan zona dianggap WIB. */
const ZONA: Record<string, number> = { wib: 7, wita: 8, wit: 9 };

/**
 * Semua nominal rupiah di teks, sebagai bilangan bulat. Mengenali "Rp 1.500.123,00", "Rp4.000.457",
 * "IDR 1,500,123.00", dan angka tanpa pemisah minimal 4 digit. Sen ",00"/".00" dibuang.
 */
export function bacaNominal(teks: string): number[] {
  const hasil = new Set<number>();
  const pola = /(?<![0-9])([0-9]{1,3}(?:[.,][0-9]{3})+|[0-9]{4,})(?:[.,]([0-9]{2}))?(?![0-9])/g;
  for (const m of teks.matchAll(pola)) {
    const sen = m[2];
    if (sen && sen !== '00') continue; // nominal paket selalu rupiah bulat
    const angka = Number(m[1]!.replace(/[.,]/g, ''));
    if (Number.isSafeInteger(angka) && angka > 0) hasil.add(angka);
  }
  return [...hasil];
}

function keUtc(tahun: number, bulan: number, hari: number, jam: number, menit: number, detik: number, zona: string | undefined) {
  if (tahun < 100) tahun += 2000;
  if (bulan < 0 || bulan > 11 || hari < 1 || hari > 31 || jam > 23 || menit > 59 || detik > 59) return null;
  const offset = ZONA[(zona ?? 'wib').toLowerCase()] ?? 7;
  const t = Date.UTC(tahun, bulan, hari, jam - offset, menit, detik);
  const d = new Date(t);
  // Tanggal tidak sah (mis. 31 Februari) bergeser bulan; tolak.
  if (new Date(t + offset * 3_600_000).getUTCDate() !== hari) return null;
  return d;
}

/**
 * Semua waktu transfer (tanggal + jam) di teks. Bentuk yang dikenali:
 * "23/11/2026 10:15:32 WIB", "23-11-26 10.15", "23 Nov 2026, 09:48", "23 November 2026 · 14.02",
 * "2026-11-23 10:15". Tanggal tanpa jam tidak dipakai karena aturan 1 jam butuh jamnya.
 */
export function bacaWaktu(teks: string): Date[] {
  const hasil: Date[] = [];
  const jamPola = String.raw`([01]?[0-9]|2[0-3])[:.]([0-5][0-9])(?:[:.]([0-5][0-9]))?(?:\s*(WIB|WITA|WIT))?`;
  const sela = String.raw`[\s,·\-–|]*(?:pukul|jam|at)?[\s,·\-–|]*`;
  const angka = new RegExp(String.raw`(?<![0-9])([0-3]?[0-9])[/\-.]([01]?[0-9])[/\-.]((?:20)?[0-9]{2})${sela}${jamPola}`, 'gi');
  for (const m of teks.matchAll(angka)) {
    const d = keUtc(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0), m[7]);
    if (d) hasil.push(d);
  }
  const iso = new RegExp(String.raw`(20[0-9]{2})-([01]?[0-9])-([0-3]?[0-9])(?:T|${sela})${jamPola}`, 'gi');
  for (const m of teks.matchAll(iso)) {
    const d = keUtc(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0), m[7]);
    if (d) hasil.push(d);
  }
  const nama = new RegExp(String.raw`(?<![0-9])([0-3]?[0-9])\s+([A-Za-z]{3,9})\.?\s+((?:20)?[0-9]{2})${sela}${jamPola}`, 'gi');
  for (const m of teks.matchAll(nama)) {
    const bulan = BULAN[m[2]!.toLowerCase()];
    if (bulan === undefined) continue;
    const d = keUtc(Number(m[3]), bulan, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0), m[7]);
    if (d) hasil.push(d);
  }
  return hasil;
}

/** Aksi audit log hasil cek otomatis foto bukti. */
export const AKSI_AUTO_SETUJU = 'payment.auto_approved_from_proof';
export const AKSI_AUTO_LEWAT = 'payment.auto_check_skipped';

export const JENDELA_BUKTI_MENIT = 60;
/** Jam di HP pengirim dan server bisa berbeda beberapa menit. */
const TOLERANSI_JAM_MENIT = 5;

export type HasilCekBukti =
  | { cocok: true; nominal: number; waktu: Date }
  | { cocok: false; alasan: 'NOMINAL_TIDAK_DITEMUKAN' | 'WAKTU_TIDAK_TERBACA' | 'WAKTU_DI_LUAR_JENDELA' };

/** Bukti cocok bila nominal unik ada di teks dan ada waktu transfer di dalam jendela 1 jam. */
export function cocokkanBukti(p: {
  teks: string;
  totalRp: number;
  dibuatPada: Date;
  diunggahPada: Date;
}): HasilCekBukti {
  if (!bacaNominal(p.teks).includes(p.totalRp)) return { cocok: false, alasan: 'NOMINAL_TIDAK_DITEMUKAN' };
  const semua = bacaWaktu(p.teks);
  if (!semua.length) return { cocok: false, alasan: 'WAKTU_TIDAK_TERBACA' };
  const menit = 60_000;
  const awal = Math.max(
    p.diunggahPada.getTime() - JENDELA_BUKTI_MENIT * menit,
    p.dibuatPada.getTime() - TOLERANSI_JAM_MENIT * menit,
  );
  const akhir = p.diunggahPada.getTime() + TOLERANSI_JAM_MENIT * menit;
  const waktu = semua.find((w) => w.getTime() >= awal && w.getTime() <= akhir);
  return waktu ? { cocok: true, nominal: p.totalRp, waktu } : { cocok: false, alasan: 'WAKTU_DI_LUAR_JENDELA' };
}
