/**
 * Membaca nominal dan waktu transfer dari teks hasil OCR foto bukti, lalu memutuskan apakah bukti itu
 * cocok untuk disetujui otomatis:
 * - nominal di bukti sama persis dengan nominal unik pesanan (harga + kode unik);
 * - waktu transfer di bukti tidak sebelum pesanan dibuat dan tidak sesudah bukti diunggah.
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
 * Rapikan salah baca OCR yang umum di sekitar angka: "Rp 1. 500. 123, 00" (spasi sesudah pemisah),
 * "Rp1.5O0.l23" (huruf O/l/I/S/B terbaca sebagai angka), dan "Rp 1 500 123" (pemisah spasi).
 */
export function rapikanTeksOcr(teks: string): string {
  return teks
    .replace(/([0-9])([.,]) +(?=[0-9]{2,3}(?![0-9]))/g, '$1$2')
    .replace(/\b(rp|idr)[ .:]*([0-9OoIlSB|][0-9OoIlSB|., ]*[0-9OoIlSB|])/gi, (_, mata: string, isi: string) => {
      const angka = isi
        .replace(/[Oo]/g, '0')
        .replace(/[Il|]/g, '1')
        .replace(/S/g, '5')
        .replace(/B/g, '8')
        .replace(/ (?=[0-9]{3}(?![0-9]))/g, '.');
      return `${mata} ${angka}`;
    });
}

/**
 * Semua nominal rupiah di teks, sebagai bilangan bulat. Mengenali "Rp 1.500.123,00", "Rp4.000.457",
 * "IDR 1,500,123.00", dan angka tanpa pemisah minimal 4 digit. Sen ",00"/".00" dibuang.
 */
export function bacaNominal(teks: string): number[] {
  const hasil = new Set<number>();
  const pola = /(?<![0-9])([0-9]{1,3}(?:[.,][0-9]{3})+|[0-9]{4,})(?:[.,]([0-9]{2}))?(?![0-9])/g;
  for (const m of rapikanTeksOcr(teks).matchAll(pola)) {
    const sen = m[2];
    if (sen && sen !== '00') continue; // nominal paket selalu rupiah bulat
    const angka = Number(m[1]!.replace(/[.,]/g, ''));
    if (Number.isSafeInteger(angka) && angka > 0) hasil.add(angka);
  }
  return [...hasil];
}

/**
 * Nominal unik ada di teks. Selain pembacaan biasa, angka sesudah "Rp"/"IDR" juga dibandingkan
 * digitnya saja, untuk pemisah yang terbaca aneh ("Rp1500.123", "Rp 1.500.12300").
 */
export function adaNominal(teks: string, totalRp: number): boolean {
  if (bacaNominal(teks).includes(totalRp)) return true;
  const dicari = String(totalRp);
  for (const m of rapikanTeksOcr(teks).matchAll(/\b(?:rp|idr)\s*([0-9][0-9., ]*[0-9])/gi)) {
    const digit = m[1]!.replace(/[^0-9]/g, '');
    if (digit === dicari || digit === `${dicari}00`) return true;
  }
  return false;
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

const JAM = String.raw`([01]?[0-9]|2[0-3])[:.]?([0-5][0-9])(?:[:.]([0-5][0-9]))?(?![0-9])(?:\s*(WIB|WITA|WIT)\b)?`;
/** Pemisah tanggal dan jam: koma, titik tengah, "»", "-", "|", kata "pukul"/"jam"/"at", dsb. */
const SELA = String.raw`[^A-Za-z0-9\n]{0,4}(?:pukul|jam|at)?[^A-Za-z0-9\n]{0,4}`;

/** Tahun untuk tanggal tanpa tahun: tahun acuan, mundur setahun bila hasilnya jauh sesudah acuan. */
function tahunUntuk(acuan: Date, bulan: number, hari: number) {
  const wib = new Date(acuan.getTime() + 7 * 3_600_000);
  const tahun = wib.getUTCFullYear();
  return Date.UTC(tahun, bulan, hari) > wib.getTime() + 2 * 86_400_000 ? tahun - 1 : tahun;
}

/**
 * Semua waktu transfer (tanggal + jam) di teks. Bentuk yang dikenali:
 * "23/11/2026 10:15:32 WIB", "23-11-26 10.15", "23 Nov 2026, 09:48", "23 November 2026 · 14.02",
 * "23 Nov 2026 » 10:15", "2026-11-23 10:15", dan, bila `acuan` diberikan, tanggal tanpa tahun
 * ("23 Nov, 10:15", "23/11 10:15") dengan tahun dari acuan. Tanggal tanpa jam tidak dipakai di sini.
 */
export function bacaWaktu(teks: string, acuan?: Date): Date[] {
  const hasil: Date[] = [];
  const dorong = (d: Date | null) => {
    if (d && !hasil.some((h) => h.getTime() === d.getTime())) hasil.push(d);
  };
  const jam = (m: RegExpMatchArray, i: number) =>
    [Number(m[i]), Number(m[i + 1]), Number(m[i + 2] ?? 0), m[i + 3]] as const;
  const angka = new RegExp(String.raw`(?<![0-9])([0-3]?[0-9])[/\-.]([01]?[0-9])[/\-.]((?:20)?[0-9]{2})(?![0-9])${SELA}${JAM}`, 'gi');
  for (const m of teks.matchAll(angka)) dorong(keUtc(Number(m[3]), Number(m[2]) - 1, Number(m[1]), ...jam(m, 4)));
  const iso = new RegExp(String.raw`(20[0-9]{2})-([01]?[0-9])-([0-3]?[0-9])(?:T|${SELA})${JAM}`, 'gi');
  for (const m of teks.matchAll(iso)) dorong(keUtc(Number(m[1]), Number(m[2]) - 1, Number(m[3]), ...jam(m, 4)));
  const nama = new RegExp(String.raw`(?<![0-9])([0-3]?[0-9])\s+([A-Za-z]{3,9})\.?\s+((?:20)?[0-9]{2})(?![0-9:.])${SELA}${JAM}`, 'gi');
  for (const m of teks.matchAll(nama)) {
    const bulan = BULAN[m[2]!.toLowerCase()];
    if (bulan !== undefined) dorong(keUtc(Number(m[3]), bulan, Number(m[1]), ...jam(m, 4)));
  }
  if (!acuan) return hasil;
  const namaTanpaTahun = new RegExp(String.raw`(?<![0-9])([0-3]?[0-9])\s+([A-Za-z]{3,9})\.?(?!\s*(?:20)?[0-9]{2}(?![0-9:.]))${SELA}${JAM}`, 'gi');
  for (const m of teks.matchAll(namaTanpaTahun)) {
    const bulan = BULAN[m[2]!.toLowerCase()];
    if (bulan === undefined) continue;
    const hari = Number(m[1]);
    dorong(keUtc(tahunUntuk(acuan, bulan, hari), bulan, hari, ...jam(m, 3)));
  }
  const angkaTanpaTahun = new RegExp(String.raw`(?<![0-9/\-.])([0-3]?[0-9])/([01]?[0-9])(?![0-9/])${SELA}${JAM}`, 'gi');
  for (const m of teks.matchAll(angkaTanpaTahun)) {
    const bulan = Number(m[2]) - 1;
    const hari = Number(m[1]);
    dorong(keUtc(tahunUntuk(acuan, bulan, hari), bulan, hari, ...jam(m, 3)));
  }
  return hasil;
}

/** Tanggal transfer tanpa jam ("23/11/2026", "23 Nov 2026"), sebagai rentang satu hari dalam WIB. */
export function bacaTanggal(teks: string): Array<{ mulai: Date; akhir: Date }> {
  const hasil: Array<{ mulai: Date; akhir: Date }> = [];
  const dorong = (tahun: number, bulan: number, hari: number) => {
    const mulai = keUtc(tahun, bulan, hari, 0, 0, 0, 'wib');
    if (mulai) hasil.push({ mulai, akhir: new Date(mulai.getTime() + 86_400_000 - 1) });
  };
  for (const m of teks.matchAll(/(?<![0-9])([0-3]?[0-9])[/\-.]([01]?[0-9])[/\-.]((?:20)?[0-9]{2})(?![0-9])/g))
    dorong(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  for (const m of teks.matchAll(/(?<![0-9])([0-3]?[0-9])\s+([A-Za-z]{3,9})\.?\s+((?:20)?[0-9]{2})(?![0-9])/g)) {
    const bulan = BULAN[m[2]!.toLowerCase()];
    if (bulan !== undefined) dorong(Number(m[3]), bulan, Number(m[1]));
  }
  for (const m of teks.matchAll(/(20[0-9]{2})-([01]?[0-9])-([0-3]?[0-9])(?![0-9])/g))
    dorong(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return hasil;
}

/** Penanda transfer selesai di layar bukti (bukan layar konfirmasi sebelum kirim). */
const KATA_BERHASIL = /\b(berhasil|sukses|success(?:ful)?|transfer selesai|transaksi selesai|completed)\b/i;

/** Aksi audit log hasil cek otomatis foto bukti. */
export const AKSI_AUTO_SETUJU = 'payment.auto_approved_from_proof';
export const AKSI_AUTO_LEWAT = 'payment.auto_check_skipped';

/** Jam di HP pengirim dan server bisa berbeda beberapa menit. */
const TOLERANSI_JAM_MENIT = 5;

export type HasilCekBukti =
  | { cocok: true; nominal: number; waktu: Date; dasarWaktu: 'JAM' | 'TANGGAL' | 'KATA_BERHASIL' }
  | { cocok: false; alasan: 'NOMINAL_TIDAK_DITEMUKAN' | 'WAKTU_TIDAK_TERBACA' | 'WAKTU_DI_LUAR_JENDELA' };

/**
 * Bukti cocok bila nominal unik ada di teks dan waktunya masuk akal untuk pesanan ini:
 * 1. ada jam transfer antara pesanan dibuat dan bukti diunggah (toleransi 5 menit); atau
 * 2. tanpa jam terbaca, ada tanggal transfer di rentang hari pesanan dibuat s.d. hari diunggah; atau
 * 3. tanpa jam dan tanggal terbaca, layar bukti memuat kata "Berhasil"/"Sukses".
 * Jam atau tanggal yang terbaca tetapi di luar rentang selalu ditolak (bukti lama dipakai ulang).
 */
export function cocokkanBukti(p: {
  teks: string;
  totalRp: number;
  dibuatPada: Date;
  diunggahPada: Date;
}): HasilCekBukti {
  if (!adaNominal(p.teks, p.totalRp)) return { cocok: false, alasan: 'NOMINAL_TIDAK_DITEMUKAN' };
  const menit = 60_000;
  const awal = p.dibuatPada.getTime() - TOLERANSI_JAM_MENIT * menit;
  const akhir = p.diunggahPada.getTime() + TOLERANSI_JAM_MENIT * menit;
  const cocok = (waktu: Date, dasarWaktu: 'JAM' | 'TANGGAL' | 'KATA_BERHASIL'): HasilCekBukti => ({
    cocok: true,
    nominal: p.totalRp,
    waktu,
    dasarWaktu,
  });

  const semua = bacaWaktu(p.teks, p.diunggahPada);
  if (semua.length) {
    const waktu = semua.find((w) => w.getTime() >= awal && w.getTime() <= akhir);
    return waktu ? cocok(waktu, 'JAM') : { cocok: false, alasan: 'WAKTU_DI_LUAR_JENDELA' };
  }
  const tanggal = bacaTanggal(p.teks);
  if (tanggal.length) {
    const hari = tanggal.find((t) => t.akhir.getTime() >= awal && t.mulai.getTime() <= akhir);
    return hari ? cocok(hari.mulai, 'TANGGAL') : { cocok: false, alasan: 'WAKTU_DI_LUAR_JENDELA' };
  }
  if (KATA_BERHASIL.test(p.teks)) return cocok(p.diunggahPada, 'KATA_BERHASIL');
  return { cocok: false, alasan: 'WAKTU_TIDAK_TERBACA' };
}
