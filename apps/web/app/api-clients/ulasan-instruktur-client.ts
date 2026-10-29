import { apiFetch } from '../lib/api-client';

export interface UlasanTertunda {
  bookingId: string;
  classSlotId: string;
  namaKelas: string;
  namaInstruktur: string;
  namaCabang: string;
  mulai: string;
  timezone: string;
}

export interface RingkasanInstruktur {
  instructorId: string;
  namaInstruktur: string;
  jumlahUlasan: number;
  rataRata: number;
  /** Jumlah ulasan per bintang, indeks 0 = bintang 1. */
  sebaran: [number, number, number, number, number];
}

export interface BarisUlasan {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  namaMember: string;
  instructorId: string;
  namaInstruktur: string;
  namaKelas: string;
  namaCabang: string;
  kelasMulai: string;
}

export interface LaporanUlasan {
  from: string;
  until: string;
  instruktur: RingkasanInstruktur[];
  ulasan: BarisUlasan[];
}

export interface UlasanInstrukturClient {
  tertunda(): Promise<UlasanTertunda[]>;
  kirim(
    input:
      { bookingId: string; rating: number; comment?: string } | { bookingId: string; skip: true },
  ): Promise<{ id: string; skipped: boolean }>;
  laporan(input: { branchId?: string; from?: string; until?: string }): Promise<LaporanUlasan>;
}

export const browserUlasanInstrukturClient: UlasanInstrukturClient = {
  async tertunda() {
    const hasil = await apiFetch<UlasanTertunda[]>('/me/instructor-reviews/pending', {
      label: 'Memuat ulasan…',
    });
    return Array.isArray(hasil) ? hasil : [];
  },
  kirim(input) {
    return apiFetch('/me/instructor-reviews', {
      method: 'POST',
      body: JSON.stringify(input),
      label: 'Mengirim ulasan…',
    });
  },
  async laporan(input) {
    const q = new URLSearchParams();
    if (input.branchId) q.set('branchId', input.branchId);
    if (input.from) q.set('from', input.from);
    if (input.until) q.set('until', input.until);
    const hasil = await apiFetch<LaporanUlasan>(`/instructor-reviews?${q}`, {
      label: 'Memuat ulasan instruktur…',
    });
    if (!Array.isArray(hasil?.instruktur) || !Array.isArray(hasil.ulasan)) {
      throw new Error('ULASAN_TIDAK_DIKENAL');
    }
    return hasil;
  },
};
