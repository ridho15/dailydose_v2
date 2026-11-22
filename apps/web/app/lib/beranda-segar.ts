/** Penanda dari halaman lain (booking, batal) agar Beranda melewati cache dan angkanya langsung baru. */
export const PENANDA_BERANDA_SEGAR = 'dd-beranda-segar';

export function tandaiBerandaSegar() {
  try {
    window.sessionStorage.setItem(PENANDA_BERANDA_SEGAR, '1');
  } catch {
    // Penyimpanan sesi bisa diblokir (mode privat); Beranda tetap memuat data, paling lama 20 detik basi.
  }
}

/** Dibaca sekali oleh Beranda, lalu dihapus. */
export function ambilPenandaBerandaSegar() {
  try {
    const ada = window.sessionStorage.getItem(PENANDA_BERANDA_SEGAR) === '1';
    window.sessionStorage.removeItem(PENANDA_BERANDA_SEGAR);
    return ada;
  } catch {
    return false;
  }
}
