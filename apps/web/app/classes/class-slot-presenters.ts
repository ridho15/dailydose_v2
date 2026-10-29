export type CancellationReason =
  'STUDIO_UNAVAILABLE' | 'INSTRUCTOR_UNAVAILABLE' | 'SAFETY_ISSUE' | 'OTHER_REVIEW_REQUIRED';

export const statusLabels: Record<string, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Dipublikasikan',
  CONFIRMED: 'Dikonfirmasi',
  AUTO_CANCELLED: 'Batal otomatis',
  CANCELLED: 'Dibatalkan',
  COMPLETED: 'Selesai',
};

export const cancellationLabels: Record<CancellationReason, string> = {
  STUDIO_UNAVAILABLE: 'Studio tidak tersedia',
  INSTRUCTOR_UNAVAILABLE: 'Instruktur tidak tersedia',
  SAFETY_ISSUE: 'Masalah keselamatan',
  OTHER_REVIEW_REQUIRED: 'Perlu tinjauan lain',
};

export function classStatusTone(
  status: string,
): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
  if (status === 'CONFIRMED' || status === 'COMPLETED') return 'success';
  if (status === 'PUBLISHED') return 'info';
  if (status.includes('CANCELLED')) return 'danger';
  return status === 'DRAFT' ? 'warning' : 'neutral';
}

const timezoneLabels: Record<string, string> = {
  'Asia/Jakarta': 'WIB',
  'Asia/Makassar': 'WITA',
  'Asia/Jayapura': 'WIT',
};

export const timezoneLabel = (timezone: string) => timezoneLabels[timezone] ?? timezone;

export const statusSummaries: Record<string, string> = {
  DRAFT: 'Belum dipublikasikan. Pelanggan belum dapat memesan kelas ini.',
  PUBLISHED: 'Terbuka untuk dipesan pelanggan.',
  CONFIRMED: 'Kuota minimum terpenuhi; kelas berjalan sesuai jadwal.',
  COMPLETED: 'Kelas sudah selesai.',
  CANCELLED: 'Kelas dibatalkan.',
  AUTO_CANCELLED: 'Kelas dibatalkan otomatis karena kuota minimum tidak terpenuhi.',
};

export function cancellationReasonLabel(code?: string | null) {
  if (!code) return undefined;
  if (code === 'AUTO_CANCEL_MIN_QUOTA') return 'Kuota minimum tidak terpenuhi (otomatis)';
  return cancellationLabels[code as CancellationReason] ?? 'Alasan lain';
}

/**
 * Jadwal baru sebuah kelas yang diseret ke hari dan jam lain di kalender.
 *
 * Waktunya dihitung dengan menambahkan selisih hari dan jam pada waktu mulai yang lama, bukan
 * dengan menyusun tanggal baru dari teks, sehingga menit mulai dan lama kelas tetap utuh: kelas
 * 09.15 yang diseret ke baris 11.00 menjadi 11.15, bukan 11.00. Zona waktu Indonesia tidak
 * mengenal pergeseran musim, jadi penjumlahan milidetik di sini tepat.
 *
 * `null` berarti kelas dilepas di tempatnya sendiri dan tidak ada yang perlu disimpan.
 */
export function geserJadwal(params: {
  startAt: Date;
  endAt: Date;
  /** Hari asal, `YYYY-MM-DD` menurut zona waktu cabang. */
  hariAsal: string;
  /** Jam mulai asal menurut zona waktu cabang. */
  jamAsal: number;
  hariTujuan: string;
  jamTujuan: number;
}): { startAt: Date; endAt: Date } | null {
  const selisihHari = Math.round(
    (Date.parse(`${params.hariTujuan}T00:00:00Z`) - Date.parse(`${params.hariAsal}T00:00:00Z`)) /
      86_400_000,
  );
  const selisihJam = params.jamTujuan - params.jamAsal;
  if (selisihHari === 0 && selisihJam === 0) return null;

  const geser = selisihHari * 86_400_000 + selisihJam * 3_600_000;
  return {
    startAt: new Date(params.startAt.getTime() + geser),
    endAt: new Date(params.endAt.getTime() + geser),
  };
}

/** Posisi kelas di kalender: tanggal lokal cabang (`YYYY-MM-DD`) dan jam mulai. */
export interface PosisiKalender {
  hari: string;
  jam: number;
}

/**
 * Menggeser posisi dengan tombol panah, untuk memindahkan kelas tanpa tetikus.
 * Kiri dan kanan berpindah hari, atas dan bawah berpindah jam; berhenti di tepi kalender alih-alih
 * melompat ke minggu lain, karena berpindah minggu tanpa terlihat mudah membuat salah taruh.
 * `null` berarti tombol itu bukan tombol panah.
 */
export function geserDenganPanah(
  posisi: PosisiKalender,
  tombol: string,
  hariTersedia: readonly string[],
  jamTersedia: readonly number[],
): PosisiKalender | null {
  const iHari = hariTersedia.indexOf(posisi.hari);
  const iJam = jamTersedia.indexOf(posisi.jam);
  const batas = (n: number, panjang: number) => Math.min(Math.max(n, 0), panjang - 1);
  switch (tombol) {
    case 'ArrowLeft':
      return { ...posisi, hari: hariTersedia[batas(iHari - 1, hariTersedia.length)]! };
    case 'ArrowRight':
      return { ...posisi, hari: hariTersedia[batas(iHari + 1, hariTersedia.length)]! };
    case 'ArrowUp':
      return { ...posisi, jam: jamTersedia[batas(iJam - 1, jamTersedia.length)]! };
    case 'ArrowDown':
      return { ...posisi, jam: jamTersedia[batas(iJam + 1, jamTersedia.length)]! };
    default:
      return null;
  }
}

/**
 * Rentang jam kalender: jam operasional studio, diperluas bila ada kelas di luar jam itu supaya
 * tidak ada kelas yang hilang dari tampilan.
 */
export function isDibatalkan(slot: { status: string }): boolean {
  return slot.status === 'CANCELLED' || slot.status === 'AUTO_CANCELLED';
}

export const kunciTipeKelas = (nama: string) => nama.trim().replace(/\s+/g, ' ').toLowerCase();

/** Satu chip per nama tipe kelas, urut abjad; nama kosong diabaikan. */
export function kelompokTipeKelas(nama: readonly (string | null | undefined)[]) {
  const unik = new Map<string, string>();
  for (const n of nama) {
    const label = n?.trim().replace(/\s+/g, ' ');
    if (label && !unik.has(kunciTipeKelas(label))) unik.set(kunciTipeKelas(label), label);
  }
  return [...unik.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'id'));
}

export function rentangJam(jamKelas: readonly number[], buka = 9, tutup = 22): number[] {
  const sah = jamKelas.filter((n) => Number.isFinite(n));
  const mulai = Math.min(buka, ...sah);
  const selesai = Math.max(tutup, ...sah);
  return Array.from({ length: selesai - mulai + 1 }, (_, i) => mulai + i);
}

/**
 * Warna angka keterisian. Mengikuti mockup: hijau bila kuota minimum sudah terpenuhi atau kelas
 * masih kosong (masih bisa dipindah), cokelat bila sudah ada peserta tetapi kurang dari minimum.
 */
export function nadaKeterisian(slot: {
  bookedCount: number;
  capacity: number;
  minimumQuota: number;
}): 'kosong' | 'kurang' | 'cukup' | 'penuh' {
  if (slot.bookedCount === 0) return 'kosong';
  if (slot.bookedCount >= slot.capacity) return 'penuh';
  if (slot.bookedCount < slot.minimumQuota) return 'kurang';
  return 'cukup';
}
