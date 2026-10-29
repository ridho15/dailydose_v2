import { apiFetch, ApiError } from '../lib/api-client';

export interface AngkaCabang {
  branchId: string;
  branchName: string;
  omsetRp: number;
  payrollRp: number;
  koreksiPayrollRp: number;
  pengeluaranRp: number;
  profitRp: number;
  targetRp: number | null;
  transaksi: number;
  kelasSelesai: number;
  pengeluaranPerKategori: { category: string; amountRp: number }[];
}

export interface RingkasanBulanan {
  period: string;
  from: string;
  until: string;
  total: Omit<AngkaCabang, 'branchId' | 'branchName'>;
  cabang: AngkaCabang[];
  tarifBelumDipasang: number;
}

export interface BarisJurnal {
  id: string;
  tanggal: string;
  arah: 'MASUK' | 'KELUAR';
  keterangan: string;
  kategori: string;
  amountRp: number;
  dicatatOleh: string | null;
  branchId: string;
}

export interface JurnalKas {
  period: string;
  branchId: string | null;
  masukRp: number;
  keluarRp: number;
  selisihRp: number;
  rows: BarisJurnal[];
}

export interface KoreksiJam {
  id: string;
  branchId: string;
  instructorId: string;
  instructorName: string | null;
  classSlotId: string;
  className: string | null;
  classStartAt: string;
  hours: number;
  feePerJamRp: number;
  amountRp: number;
  reason: string;
  decidedByName: string | null;
  createdAt: string;
  evidenceUrl: string;
}

export interface KeuanganClient {
  ringkasanBulanan(period: string): Promise<RingkasanBulanan>;
  jurnalKas(input: { branchId?: string; period: string }): Promise<JurnalKas>;
  catatPengeluaran(input: {
    branchId: string;
    incurredOn: string;
    categoryCode: string;
    description: string;
    amountRp: number;
  }): Promise<unknown>;
  daftarKoreksiJam(branchId?: string): Promise<{ items: KoreksiJam[] }>;
  kirimKoreksiJam(input: {
    classSlotId: string;
    instructorId?: string;
    hours: number;
    reason: string;
    evidence: File;
  }): Promise<KoreksiJam>;
}

export const browserKeuanganClient: KeuanganClient = {
  async ringkasanBulanan(period) {
    const hasil = await apiFetch<RingkasanBulanan>(
      `/finance/owner-month?${new URLSearchParams({ period })}`,
      { label: 'Memuat angka keuangan…' },
    );
    if (!hasil?.total || !Array.isArray(hasil.cabang)) throw new Error('RINGKASAN_TIDAK_DIKENAL');
    return hasil;
  },
  async jurnalKas({ branchId, period }) {
    const qs = new URLSearchParams({ period, ...(branchId ? { branchId } : {}) });
    const hasil = await apiFetch<JurnalKas>(`/cash-journal?${qs}`, { label: 'Memuat jurnal kas…' });
    if (!Array.isArray(hasil?.rows)) throw new Error('JURNAL_TIDAK_DIKENAL');
    return hasil;
  },
  catatPengeluaran(input) {
    return apiFetch('/other-costs', {
      method: 'POST',
      body: JSON.stringify(input),
      idempotent: true,
      label: 'Mencatat pengeluaran…',
    });
  },
  daftarKoreksiJam(branchId) {
    const qs = branchId ? `?${new URLSearchParams({ branchId })}` : '';
    return apiFetch(`/instructor-hour-adjustments${qs}`, { label: 'Memuat koreksi jam…' });
  },
  kirimKoreksiJam(input) {
    const form = new FormData();
    form.set('classSlotId', input.classSlotId);
    if (input.instructorId) form.set('instructorId', input.instructorId);
    form.set('hours', String(input.hours));
    form.set('reason', input.reason);
    form.set('evidence', input.evidence);
    return apiFetch('/instructor-hour-adjustments', {
      method: 'POST',
      body: form,
      label: 'Menyimpan koreksi jam…',
    });
  },
};

/** Pesan galat yang bisa dipahami staf. */
export function keuanganFailure(error: unknown, fallback: string): string {
  const data = (error instanceof ApiError ? error.data : null) as {
    code?: string;
    error?: { code?: string };
    issues?: Array<{ field?: string; issue?: string }>;
  } | null;
  const code = data?.error?.code ?? data?.code;
  const issue = data?.issues?.[0];
  if (issue?.field === 'reason') return 'Alasan minimal 20 karakter dan paling banyak 500.';
  if (issue?.field === 'evidence' && issue.issue === 'TOO_LARGE')
    return 'Berkas bukti maksimal 8 MB.';
  if (issue?.field === 'evidence') return 'Bukti harus berupa foto (JPG, PNG, WEBP) atau PDF.';
  if (issue?.field === 'hours')
    return 'Jam koreksi harus kelipatan setengah jam, paling banyak 8 jam.';
  if (issue?.field === 'amountRp' || code === 'INVALID_AMOUNT')
    return 'Nominal harus angka bulat lebih dari 0.';
  if (issue?.field === 'incurredOn') return 'Tanggal pengeluaran tidak valid.';
  if (code === 'FORBIDDEN') return 'Akun Anda tidak berwenang untuk cabang ini.';
  return fallback;
}
