import { appLoading } from '../components/app-loading';

export interface Money {
  amountMinor: number;
  currency: string;
}

export interface FinanceAnomaly {
  purchaseId: string;
  branchId: string;
  branchCode: string;
  amountRp: number;
  submittedAt: Date;
  code: string;
  message?: string;
}

export interface FinanceReconciliationOverview {
  generatedAt: Date;
  period: { from: string; until: string };
  financial: {
    collectedRp: number;
    recognizedRp: number;
    unearnedRp: number;
    discrepancyRp: number;
  };
  metrics?: any;
  branches?: any[];
}

export interface LegacyFinancialEntryPage {
  items: any[];
  total: number;
  page: { hasMore: boolean; nextCursor: string | null };
}

export interface FinanceExportResult {
  fileName: string;
  mimeType: any;
  content: string;
  controlHash: string;
  sourceCutoffAt: Date;
  completeness: string;
  exportId?: string;
  downloadUrl?: string;
  expiresAt?: Date;
}

/** Rentang tanggal laporan, inklusif, `YYYY-MM-DD`. */
export interface FinanceRange {
  from: string;
  until: string;
}

export interface OtherCost {
  id: string;
  branchId: string;
  period: string;
  incurredOn: string;
  category: string;
  amountRp: number;
  description: string;
}

export interface OtherCostUpdate {
  /** Tanggal pengeluaran `YYYY-MM-DD`. */
  incurredOn?: string;
  category?: string;
  description?: string;
  amountRp?: number;
}

export interface OtherCostCommand {
  branchId: string;
  /** Tanggal pengeluaran `YYYY-MM-DD`. */
  incurredOn: string;
  amountRp: number;
  description: string;
  categoryCode?: string;
}

export interface OtherCostPage {
  items: OtherCost[];
  total: number;
  page: { hasMore: boolean; nextCursor: string | null };
}

export type FinanceAnomalyPage = {
  items: FinanceAnomaly[];
  total: number;
  page: { hasMore: boolean; nextCursor: string | null };
};

export type FinanceData = {
  overview: FinanceReconciliationOverview;
  anomalies: FinanceAnomalyPage;
  legacyCashflow: LegacyFinancialEntryPage;
};

// ============================================================================
// LAPORAN KEUANGAN
// ============================================================================

export interface OmsetTransaction {
  id: string;
  orderNumber: string;
  invoiceNumber: string;
  packageName: string;
  customerName: string;
  totalAmountRp: number;
  paymentMethod: string;
  paidAt: string;
  branchName: string;
}

export interface OmsetReportData {
  period: string;
  from?: string;
  until?: string;
  branchId: string;
  totalOmsetRp: number;
  totalTransactionCount: number;
  byPaymentMethod: Record<string, { count: number; amountRp: number }>;
  transactions: OmsetTransaction[];
}

export interface InstructorCostBreakdown {
  instructorId: string;
  instructorName: string;
  groupHours: number;
  groupFeeRp: number;
  semiPrivateHours: number;
  semiPrivateFeeRp: number;
  privateHours: number;
  privateFeeRp: number;
  totalHours: number;
  totalFeeRp: number;
  verifiedFeeRp: number;
  unverifiedFeeRp: number;
  unverifiedClassCount: number;
}

export interface InstructorSessionItem {
  slotId: string;
  startAt: string;
  endAt: string;
  branchId: string;
  branchName: string;
  classTypeId: string;
  classTypeName: string;
  instructorId: string;
  instructorName: string;
  teachingHours: number;
  feePerJamRp: number;
  feeRp: number;
  isManualFee: boolean;
  attendanceVerified: boolean;
  attendanceTime: string | null;
  latitude: number | null;
  longitude: number | null;
  distanceMeters: number | null;
  isWithinGeofence: boolean | null;
}

export interface InstructorCostRealtimeData {
  period: string;
  from?: string;
  until?: string;
  branchId: string;
  totalInstructorCostRp: number;
  /** Honor kelas yang presensi instrukturnya sudah tercatat (QR atau verifikasi manual). */
  totalVerifiedFeeRp: number;
  /** Honor kelas selesai yang presensi instrukturnya belum tercatat; tetap ada di total. */
  totalUnverifiedFeeRp: number;
  unverifiedClassCount: number;
  totalTeachingHours: number;
  instructorCount: number;
  instructors: InstructorCostBreakdown[];
  sessions?: InstructorSessionItem[];
}

export interface OtherCostItem {
  id: string;
  branchId: string;
  branchName: string;
  period: string;
  /** Tanggal pengeluaran `YYYY-MM-DD`. */
  incurredOn: string;
  category: string;
  description: string;
  amountRp: number;
  createdByName: string;
  createdAt: string;
}

export interface OtherCostReportData {
  period: string;
  from?: string;
  until?: string;
  branchId: string;
  totalOtherCostRp: number;
  byCategory: Record<string, { count: number; amountRp: number }>;
  items: OtherCostItem[];
}

export interface ProfitData {
  period: string;
  from: string;
  until: string;
  branchId: string;
  omsetRp: number;
  costRealtimeRp: number;
  /** Sesi paket yang dibeli x modal per sesi; dasar laba. */
  modalSesiRp?: number;
  sesiTerjual?: number;
  sesiTanpaModal?: number;
  grossProfitRp: number;
  grossMarginPercent: number;
  otherCostRp: number;
  netProfitRealtimeRp: number;
  netMarginPercent: number;
}

export interface FinanceClient {
  overview(input: {
    branchId?: string;
    from: string;
    until: string;
  }): Promise<FinanceReconciliationOverview>;
  anomalies(
    input: { branchId?: string; from: string; until: string },
    cursor?: string,
  ): Promise<FinanceAnomalyPage>;
  legacyCashflow(
    input: { branchId?: string; from: string; until: string },
    cursor?: string,
  ): Promise<LegacyFinancialEntryPage>;
  exportReport?(input: {
    branchId?: string;
    from: string;
    until: string;
  }): Promise<FinanceExportResult>;
  createOtherCost?(command: OtherCostCommand): Promise<OtherCost>;

  // Laporan keuangan menurut rentang tanggal pilihan pengguna
  getOmsetReport?(branchId: string | undefined, range: FinanceRange): Promise<OmsetReportData>;
  getInstructorCostRealtime?(
    branchId: string | undefined,
    range: FinanceRange,
  ): Promise<InstructorCostRealtimeData>;
  getOtherCostReport?(branchId: string | undefined, range: FinanceRange): Promise<OtherCostReportData>;
  getProfit?(branchId: string | undefined, range: FinanceRange): Promise<ProfitData>;

  /** Alasan wajib (K4): biaya yang dihapus tidak dapat dipulihkan. */
  deleteOtherCost?(id: string, reason: string): Promise<{ id: string; deleted: boolean }>;
  updateOtherCost?(id: string, input: OtherCostUpdate): Promise<unknown>;
}

async function financeFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { headers, ...restInit } = init ?? {};
  const response = await fetch(`/api/v1${path}`, {
    credentials: 'include',
    ...restInit,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
  });
  if (!response.ok) {
    let data: any;
    try {
      data = await response.json();
    } catch {
      data = undefined;
    }
    const error = new Error(`Finance request failed: ${response.status}`);
    (error as any).response = { status: response.status, data };
    throw error;
  }
  if (response.status === 204) {
    return undefined as unknown as T;
  }
  return response.json() as Promise<T>;
}

function rangeParams(branchId: string | undefined, range: FinanceRange): string {
  const params = new URLSearchParams({ from: range.from, until: range.until });
  if (branchId) params.set('branchId', branchId);
  return params.toString();
}

export const browserFinanceClient: FinanceClient = {
  async overview(input) {
    const params = new URLSearchParams({
      from: `${input.from}T00:00:00.000Z`,
      until: `${input.until}T00:00:00.000Z`,
    });
    if (input.branchId) params.set('branchId', input.branchId);

    return appLoading.track(
      financeFetch<FinanceReconciliationOverview>(
        `/finance/reconciliation/overview?${params.toString()}`,
      ),
      { label: 'Memuat rekonsiliasi…' },
    );
  },
  async anomalies(input, cursor) {
    const params = new URLSearchParams({
      from: `${input.from}T00:00:00.000Z`,
      until: `${input.until}T00:00:00.000Z`,
      limit: '20',
    });
    if (input.branchId) params.set('branchId', input.branchId);
    if (cursor) params.set('cursor', cursor);

    const result = await appLoading.track(
      financeFetch<any>(`/finance/reconciliation/anomalies?${params.toString()}`),
      { label: 'Memuat anomali rekonsiliasi…' },
    );
    return {
      items: result.items || [],
      total: result.total || 0,
      page: {
        hasMore: result.page?.hasMore || false,
        nextCursor: result.page?.nextCursor ?? null,
      },
    };
  },
  legacyCashflow(input, cursor) {
    const params = new URLSearchParams({
      from: `${input.from}T00:00:00.000Z`,
      until: `${input.until}T00:00:00.000Z`,
      limit: '20',
    });
    if (input.branchId) params.set('branchId', input.branchId);
    if (cursor) params.set('cursor', cursor);

    return appLoading.track(
      financeFetch<LegacyFinancialEntryPage>(
        `/finance/reconciliation/legacy-cashflow?${params.toString()}`,
      ),
      { label: 'Memuat legacy cashflow…' },
    );
  },
  exportReport(input) {
    return appLoading.track(
      financeFetch<FinanceExportResult>('/finance-exports', {
        method: 'POST',
        body: JSON.stringify({
          branchId: input.branchId,
          from: `${input.from}T00:00:00.000Z`,
          until: `${input.until}T00:00:00.000Z`,
        }),
      }),
      { label: 'Membuat export Finance…' },
    );
  },
  createOtherCost(command) {
    return appLoading.track(
      financeFetch<OtherCost>('/other-costs', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(command),
      }),
      { label: 'Mencatat biaya lain…' },
    );
  },
  // Laporan keuangan menurut rentang tanggal

  async getOmsetReport(branchId, range) {
    return financeFetch<OmsetReportData>(`/finance/reports/omset?${rangeParams(branchId, range)}`);
  },

  async getInstructorCostRealtime(branchId, range) {
    return financeFetch<InstructorCostRealtimeData>(
      `/finance/reports/instructor-cost-realtime?${rangeParams(branchId, range)}`,
    );
  },

  async getOtherCostReport(branchId, range) {
    return financeFetch<OtherCostReportData>(`/finance/reports/other-costs?${rangeParams(branchId, range)}`);
  },

  async getProfit(branchId, range) {
    return financeFetch<ProfitData>(`/finance/reports/profit-summary?${rangeParams(branchId, range)}`);
  },

  async deleteOtherCost(id: string, reason: string) {
    return financeFetch<{ id: string; deleted: boolean }>(`/finance/other-costs/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ reason }),
    });
  },

  async updateOtherCost(id: string, input: OtherCostUpdate) {
    return financeFetch<unknown>(`/finance/other-costs/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },
};

const financeMessages: Record<string, string> = {
  INVALID_AMOUNT: 'Nominal harus berupa rupiah bulat lebih dari nol.',
  VALIDATION_ERROR: 'Data belum valid. Periksa tanggal, kategori, keterangan, dan nominal.',
  RANGE_TOO_LARGE: 'Rentang tanggal terlalu lebar. Pilih paling lama 366 hari.',
  FORBIDDEN: 'Anda tidak memiliki izin mengelola biaya lain.',
  NOT_FOUND: 'Biaya tidak ditemukan. Muat ulang daftar.',
};

/** Pesan Indonesia untuk kegagalan permintaan Finance. */
export function financeFailureMessage(error: unknown): string {
  const response = (error as { response?: { status?: number; data?: { code?: string; error?: { code?: string } } } })
    ?.response;
  const code = response?.data?.code ?? response?.data?.error?.code;
  if (code && financeMessages[code]) return financeMessages[code]!;
  if (response?.status === 403) return financeMessages.FORBIDDEN!;
  if (response?.status === 404) return financeMessages.NOT_FOUND!;
  if (response?.status === 400 || response?.status === 422) return financeMessages.VALIDATION_ERROR!;
  return 'Permintaan belum berhasil. Periksa koneksi lalu coba lagi.';
}
