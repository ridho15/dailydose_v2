import { apiFetch } from '../lib/api-client';

export type StatusKuota = 'TERPENUHI' | 'KURANG' | 'KURANG_LEWAT_BATAS' | 'TANPA_KUOTA';

export interface KelasMeja {
  id: string;
  startAt: string;
  endAt: string;
  namaKelas: string;
  namaStudio: string | null;
  namaInstruktur: string | null;
  status: string;
  version: number;
  kapasitas: number;
  terdaftar: number;
  hadir: number;
  kuota: {
    status: StatusKuota;
    hadir: number;
    minimum: number | null;
    kurang: number;
    menitTersisa: number | null;
    perluKeputusan: boolean;
  };
  keputusan: { oleh: string | null; pada: string; alasan: string | null } | null;
  berjalan: boolean;
  perluDitutup: boolean;
}

export interface TercatatMeja {
  id: string;
  jenis: 'MEMBER' | 'INSTRUKTUR';
  nama: string;
  fotoUrl: string | null;
  namaKelas: string;
  mulaiKelas: string;
  selesaiKelas: string;
  namaStudio: string | null;
  tercatatPada: string;
  manual: boolean;
  dicatatOleh: string | null;
}

export interface MejaCheckIn {
  branchId: string;
  namaCabang: string;
  timezone: string;
  tanggal: string;
  kelas: KelasMeja[];
  tercatat: TercatatMeja[];
}

export interface BarisTidakHadir {
  bookingId: string;
  userId: string;
  nama: string;
  classSlotId: string;
  namaKelas: string | null;
  mulai: string;
  sisaSesi: number | null;
  sudahDikoreksi: boolean;
}

/** Hasil pindaian QR tetap member atau instruktur di meja check-in. */
export interface HasilPindai {
  diterima: boolean;
  tercatat: boolean;
  alasan?:
    | 'PASS_TIDAK_DIKENALI'
    | 'AKUN_BERHENTI'
    | 'TIDAK_ADA_KELAS'
    | 'BELUM_WAKTUNYA'
    | 'KELAS_SUDAH_LEWAT'
    | 'SUDAH_TERCATAT';
  orang?: { userId: string; nama: string; peran: 'MEMBER' | 'INSTRUKTUR' };
  kelas?: {
    classSlotId: string;
    bookingId: string | null;
    namaKelas: string | null;
    studio: string | null;
    mulai: string;
    selesai: string;
  };
  bukaPadaMenitSebelum?: number;
  tercatatPada?: string;
  namaCabang: string;
  timezone: string;
}

export interface CheckInDeskClient {
  meja(branchId: string): Promise<MejaCheckIn>;
  /** Staf memindai QR tetap member atau instruktur (barcode scanner atau kamera). */
  pindai(branchId: string, pass: string): Promise<HasilPindai>;
  tetapJalan(classSlotId: string, reason: string): Promise<{ selisihBebanRp: number }>;
  /** Peserta yang tidak hadir dan sesinya hangus pada satu tanggal (`YYYY-MM-DD`). */
  tidakHadir(branchId: string, tanggal: string): Promise<BarisTidakHadir[]>;
}

export const browserCheckInDeskClient: CheckInDeskClient = {
  meja(branchId) {
    return apiFetch<MejaCheckIn>(`/attendance/desk?branchId=${encodeURIComponent(branchId)}`);
  },
  pindai(branchId, pass) {
    return apiFetch<HasilPindai>('/attendance/desk/scan', {
      method: 'POST',
      body: JSON.stringify({ branchId, pass }),
      label: 'Mencatat kehadiran…',
    });
  },
  tetapJalan(classSlotId, reason) {
    return apiFetch(`/attendance/desk/${encodeURIComponent(classSlotId)}/continue-below-quota`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
      label: 'Mencatat keputusan…',
    });
  },
  async tidakHadir(branchId, tanggal) {
    const params = new URLSearchParams({ branchId, from: tanggal, until: tanggal });
    const laporan = await apiFetch<{ rows: BarisTidakHadir[] }>(
      `/attendance/no-shows?${params.toString()}`,
    );
    return laporan.rows ?? [];
  },
};

/** Pesan yang bisa dipahami staf untuk galat dari layar check-in. */
export function checkInDeskFailure(error: unknown, cadangan: string): string {
  const typed = error as {
    status?: number;
    data?: { code?: string; error?: { code?: string }; issues?: Array<{ issue?: string }> };
  };
  const code = typed?.data?.error?.code ?? typed?.data?.code;
  const issue = typed?.data?.issues?.[0]?.issue;
  if (typed?.status === 403 || code === 'FORBIDDEN')
    return 'Akun Anda tidak memegang akses check-in untuk cabang ini.';
  if (issue === 'TOO_SHORT') return 'Tulis alasan minimal 10 karakter.';
  if (issue === 'NO_DECISION_NEEDED')
    return 'Kelas ini tidak perlu diputuskan lagi: kuotanya sudah terpenuhi atau batas waktunya lewat.';
  if (code === 'RESOURCE_NOT_FOUND') return 'Kelas tidak ditemukan. Muat ulang halaman.';
  return cadangan;
}
