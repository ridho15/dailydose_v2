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
  /** Pengeluaran yang dibayar uang pribadi Super Owner. */
  dibayarOleh?: string | null;
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

export interface OwnerSingkat {
  id: string;
  nama: string;
}

export interface PorsiCabang {
  branchId: string;
  branchName: string;
  porsi: { ownerId: string; nama: string; persen: number }[];
  lengkap: boolean;
}

export interface BarisSettlement {
  ownerId: string;
  nama: string;
  persen: number;
  hakRp: number;
  reimburseRp: number;
  totalRp: number;
}

export interface SettlementOwner {
  period: string;
  owners: (OwnerSingkat & { hakRp: number; reimburseRp: number; totalRp: number })[];
  cabang: {
    branchId: string;
    branchName: string;
    labaRp: number;
    porsiLengkap: boolean;
    baris: BarisSettlement[];
  }[];
  labaBelumDibagiRp: number;
}

export interface RekeningInstruktur {
  bankName: string;
  swiftCode: string;
  accountNumber: string;
  accountName: string;
  email: string | null;
}

export interface BarisTransfer {
  instructorId: string;
  nama: string;
  totalRp: number;
  terverifikasiRp: number;
  koreksiRp: number;
  kelasTerverifikasi: number;
  belumTerverifikasiRp: number;
  kelasBelumTerverifikasi: number;
  rekening: RekeningInstruktur | null;
}

export interface RingkasanTransfer {
  from: string;
  until: string;
  baris: BarisTransfer[];
  siapRp: number;
  jumlahSiap: number;
  tanpaRekening: number;
  kelasBelumTerverifikasi: number;
}

export interface BerkasTransfer {
  fileName: string;
  base64: string;
  jumlahBaris: number;
  totalRp: number;
}

export interface KeuanganClient {
  /** Honor instruktur tanggal 1 s/d hari ini (tanggal 1: bulan lalu) untuk transfer KlikBCA. */
  transferHonor?(): Promise<RingkasanTransfer>;
  unduhTransferHonor?(): Promise<BerkasTransfer>;
  simpanRekeningInstruktur?(
    instructorId: string,
    rekening: Omit<RekeningInstruktur, 'email'> & { email?: string },
  ): Promise<RekeningInstruktur>;
  /** Super Owner aktif, untuk pilihan "Dibayar oleh". */
  daftarOwner?(): Promise<OwnerSingkat[]>;
  porsiOwner?(): Promise<PorsiCabang[]>;
  simpanPorsi?(
    branchId: string,
    porsi: { ownerId: string; persen: number }[],
  ): Promise<PorsiCabang>;
  settlementOwner?(period: string): Promise<SettlementOwner>;
  ringkasanBulanan(period: string): Promise<RingkasanBulanan>;
  jurnalKas(input: { branchId?: string; period: string }): Promise<JurnalKas>;
  catatPengeluaran(input: {
    branchId: string;
    incurredOn: string;
    categoryCode: string;
    description: string;
    amountRp: number;
    /** Super Owner yang membayar dengan uang pribadi; kosong berarti kas cabang. */
    dibayarOlehId?: string;
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
  async transferHonor() {
    const hasil = await apiFetch<RingkasanTransfer>('/instructor-transfers', {
      label: 'Menghitung honor instruktur…',
    });
    if (!Array.isArray(hasil?.baris)) throw new Error('TRANSFER_TIDAK_DIKENAL');
    return hasil;
  },
  unduhTransferHonor() {
    return apiFetch<BerkasTransfer>('/instructor-transfers/export', {
      method: 'POST',
      body: JSON.stringify({}),
      label: 'Menyiapkan berkas KlikBCA…',
    });
  },
  simpanRekeningInstruktur(instructorId, rekening) {
    return apiFetch<RekeningInstruktur>(
      `/instructor-transfers/accounts/${encodeURIComponent(instructorId)}`,
      { method: 'PUT', body: JSON.stringify(rekening), label: 'Menyimpan rekening…' },
    );
  },
  daftarOwner() {
    return apiFetch<OwnerSingkat[]>('/owner-settlement/owners', { label: 'Memuat Super Owner…' });
  },
  porsiOwner() {
    return apiFetch<PorsiCabang[]>('/owner-settlement/shares', { label: 'Memuat porsi…' });
  },
  simpanPorsi(branchId, porsi) {
    return apiFetch<PorsiCabang>(`/owner-settlement/shares/${encodeURIComponent(branchId)}`, {
      method: 'PUT',
      body: JSON.stringify({ porsi }),
      label: 'Menyimpan porsi…',
    });
  },
  async settlementOwner(period) {
    const hasil = await apiFetch<SettlementOwner>(
      `/owner-settlement?${new URLSearchParams({ period })}`,
      { label: 'Menghitung settlement…' },
    );
    if (!Array.isArray(hasil?.owners) || !Array.isArray(hasil.cabang))
      throw new Error('SETTLEMENT_TIDAK_DIKENAL');
    return hasil;
  },
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
  if (issue?.field === 'accountNumber' && issue.issue === 'BCA_10_DIGIT')
    return 'Nomor rekening BCA harus 10 digit.';
  if (issue?.field === 'accountNumber') return 'Nomor rekening hanya angka, 5 sampai 34 digit.';
  if (issue?.field === 'swiftCode') return 'Kode SWIFT harus 8 atau 11 huruf/angka.';
  if (issue?.field === 'accountName') return 'Isi nama pemilik rekening (paling banyak 70 huruf).';
  if (issue?.field === 'bankName') return 'Pilih bank tujuan.';
  if (issue?.field === 'email') return 'Alamat email tidak valid.';
  if (code === 'NOTHING_TO_TRANSFER')
    return 'Belum ada honor yang bisa ditransfer: isi rekening instruktur dulu.';
  if (code === 'FORBIDDEN') return 'Akun Anda tidak berwenang untuk cabang ini.';
  return fallback;
}
