/**
 * Masa berlaku paket (keputusan pemilik, November 2026): paket N hari yang aktif tanggal D berlaku
 * sampai akhir hari (23.59.59 WIB) tanggal D + N. Contoh: aktif 1 November, 120 hari (sekitar 4
 * bulan), berakhir 1 Maret pukul 23.59 WIB. Sebelumnya berakhir di jam yang sama dengan jam
 * aktivasi, sehingga kelas sore di hari terakhir ikut tertolak.
 */
const WIB_MS = 7 * 3_600_000;
const HARI_MS = 86_400_000;

export function berlakuSampai(aktifPada: Date, hari: number): Date {
  const tanggalWib = Math.floor((aktifPada.getTime() + WIB_MS) / HARI_MS); // hari ke-n sejak epoch, WIB
  const akhir = (tanggalWib + Math.max(0, Math.floor(hari)) + 1) * HARI_MS - WIB_MS - 1000;
  return new Date(akhir);
}
