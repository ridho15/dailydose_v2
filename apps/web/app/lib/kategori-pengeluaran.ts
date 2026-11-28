/**
 * Kategori pengeluaran cabang. Kode disimpan di `OtherCost.category` (huruf besar, garis bawah);
 * label dipakai di formulir dan laporan. Kode lama yang tidak ada di daftar tetap ditampilkan
 * dengan kodenya, bukan disembunyikan.
 */
export const KATEGORI_PENGELUARAN = [
  { code: 'PEMBELIAN_BARANG', label: 'Pembelian barang' },
  { code: 'PERLENGKAPAN_STUDIO', label: 'Perlengkapan studio' },
  { code: 'KEBERSIHAN', label: 'Kebersihan' },
  { code: 'LISTRIK_AIR_INTERNET', label: 'Listrik, air, internet' },
  { code: 'SEWA', label: 'Sewa tempat' },
  { code: 'PERBAIKAN', label: 'Perbaikan alat' },
  { code: 'TRANSPORT', label: 'Transport' },
  { code: 'KONSUMSI', label: 'Konsumsi' },
  { code: 'OPERATING_EXPENSE', label: 'Operasional lain' },
] as const;

/**
 * Gaji karyawan (28 November 2026): hanya bisa dipilih pemegang `finance:read` (Super Owner, Owner,
 * Finance). Admin dan Manager tidak melihat pengeluaran yang dicatat orang lain, jadi nominal gaji
 * tidak terlihat oleh mereka. Server menolak kategori ini dari akun tanpa akses keuangan.
 */
export const KATEGORI_GAJI = { code: 'GAJI_KARYAWAN', label: 'Gaji karyawan' } as const;

/** Pilihan kategori di formulir sesuai akses pencatat. */
export function kategoriPengeluaranUntuk(lihatKeuangan: boolean) {
  return lihatKeuangan ? [...KATEGORI_PENGELUARAN, KATEGORI_GAJI] : [...KATEGORI_PENGELUARAN];
}

const LABEL: Record<string, string> = Object.fromEntries(
  [...KATEGORI_PENGELUARAN, KATEGORI_GAJI].map((k) => [k.code, k.label]),
);

/** Label kategori; metode pembayaran untuk uang masuk juga dibuat terbaca. */
export function labelKategori(code: string): string {
  if (LABEL[code]) return LABEL[code];
  if (code === 'BANK_TRANSFER') return 'Transfer bank';
  if (code === 'CASH') return 'Tunai';
  if (code === 'QRIS') return 'QRIS';
  if (code === 'OTHER') return 'Lain-lain';
  // Dibuat otomatis dari Stok Minuman saat barang masuk (tidak dipilih manual di formulir).
  if (code === 'MINUMAN') return 'Beli stok minuman';
  return code.charAt(0) + code.slice(1).toLowerCase().replaceAll('_', ' ');
}
