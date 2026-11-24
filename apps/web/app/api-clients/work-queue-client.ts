import { apiFetch } from '../lib/api-client';

export type KunciAntrean = 'renewal' | 'verifikasi' | 'bukti' | 'kuota' | 'ubahJadwal';
export type NadaAntrean = 'TELAT' | 'TENGGAT' | 'MENUNGGU';

export interface ItemAntrean {
  key: KunciAntrean;
  jumlah: number;
  nada: NadaAntrean;
  acuanPada: string | null;
  umurJam: number | null;
  nilaiRp?: number;
  hot?: number;
  kelas?: { id: string; nama: string; mulai: string; terisi: number; minimum: number }[];
  alasan?: string | null;
  href: string;
}

export interface AntreanTertinggal {
  dibuatPada: string;
  items: ItemAntrean[];
  gagal: KunciAntrean[];
}

export type JenisTindakan =
  | 'TRANSFER'
  | 'PENJUALAN_LANGSUNG'
  | 'RESCHEDULE'
  | 'PEMBATALAN'
  | 'PENYESUAIAN';

export interface ItemTindakan {
  id: string;
  jenis: JenisTindakan;
  version: number;
  masukPada: string;
  branchId: string | null;
  branchName: string | null;
  nama: string;
  rincian: string;
  nilaiRp?: number;
  metode?: string;
  pencatat?: string | null;
  alasan?: string | null;
  sesi?: number;
  kelas?: { nama: string; mulai: string } | null;
  kelasTujuan?: { nama: string; mulai: string } | null;
  buktiAda?: boolean;
  /** Pembatalan < 12 jam: bukti pendukung bila dilampirkan. */
  buktiUrl?: string | null;
}

export interface KotakTindakan {
  dibuatPada: string;
  ringkasan: { jenis: JenisTindakan; jumlah: number }[];
  items: ItemTindakan[];
  nextCursor: string | null;
  pengingat: { key: 'renewal' | 'kuota' | 'perpanjangan'; jumlah: number; href: string }[];
  gagal: JenisTindakan[];
}

export interface WorkQueueClient {
  tertinggal(branchId?: string): Promise<AntreanTertinggal>;
  /** Kotak masuk "Perlu tindakan"; dengan `jenis` mengembalikan satu halaman berkursor. */
  tindakan?(input: { branchId?: string; jenis?: JenisTindakan; cursor?: string }): Promise<KotakTindakan>;
}

export const browserWorkQueueClient: WorkQueueClient = {
  async tertinggal(branchId) {
    const qs = branchId ? `?${new URLSearchParams({ branchId })}` : '';
    const hasil = await apiFetch<AntreanTertinggal>(`/work-queue/overdue${qs}`, {
      label: 'Memuat antrean…',
    });
    if (!Array.isArray(hasil?.items)) throw new Error('ANTREAN_TIDAK_DIKENAL');
    return { ...hasil, gagal: Array.isArray(hasil.gagal) ? hasil.gagal : [] };
  },
  async tindakan({ branchId, jenis, cursor }) {
    const qs = new URLSearchParams();
    if (branchId) qs.set('branchId', branchId);
    if (jenis) qs.set('jenis', jenis);
    if (cursor) qs.set('cursor', cursor);
    const hasil = await apiFetch<KotakTindakan>(
      `/work-queue/actions${qs.size ? `?${qs.toString()}` : ''}`,
      { label: 'Memuat yang perlu diputuskan…' },
    );
    if (!Array.isArray(hasil?.items) || !Array.isArray(hasil?.ringkasan))
      throw new Error('KOTAK_TINDAKAN_TIDAK_DIKENAL');
    return {
      ...hasil,
      pengingat: Array.isArray(hasil.pengingat) ? hasil.pengingat : [],
      gagal: Array.isArray(hasil.gagal) ? hasil.gagal : [],
      nextCursor: hasil.nextCursor ?? null,
    };
  },
};
