import { apiFetch, ApiError } from '../lib/api-client';
import { normalizePackageBalance, type CustomerPackageBalance } from './booking-client';
import { browserLedgerClient, type Adjustment } from './ledger-client';

export interface MemberPilihan {
  id: string;
  displayName: string;
  phoneMasked?: string;
}

export interface AdjustmentEvidenceClient {
  cariMember(q: string): Promise<MemberPilihan[]>;
  paketMember(customerUserId: string): Promise<CustomerPackageBalance[]>;
  kirim(input: {
    customerPackageId: string;
    quantity: number;
    reason: string;
    bookingId?: string;
    evidence: File;
  }): Promise<{ resultingBalance: number; evidenceUrl: string }>;
  terakhir(): Promise<Adjustment[]>;
}

export const browserAdjustmentEvidenceClient: AdjustmentEvidenceClient = {
  async cariMember(q) {
    const data = await apiFetch<{
      items: Array<{ id: string; label?: string; description?: string }>;
    }>(`/lookups/customers?${new URLSearchParams({ q, limit: '8' }).toString()}`, {
      label: 'Mencari member…',
    });
    return (data.items ?? []).map((item) => ({
      id: item.id,
      displayName: item.label || 'Member',
      phoneMasked: item.description,
    }));
  },
  async paketMember(customerUserId) {
    const data = await apiFetch<{ items: unknown[] }>(
      `/customer-packages?${new URLSearchParams({ customerUserId, pageSize: '50' }).toString()}`,
    );
    return (data.items ?? []).map(normalizePackageBalance);
  },
  kirim(input) {
    const form = new FormData();
    form.set('customerPackageId', input.customerPackageId);
    form.set('quantity', String(input.quantity));
    form.set('reason', input.reason);
    if (input.bookingId) form.set('bookingId', input.bookingId);
    form.set('evidence', input.evidence);
    return apiFetch('/session-adjustments/with-evidence', {
      method: 'POST',
      body: form,
      label: 'Mengirim penyesuaian…',
    });
  },
  async terakhir() {
    const page = await browserLedgerClient.listAdjustments(
      undefined,
      'HISTORY',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      5,
    );
    return page.items;
  },
};

/** Pesan galat yang bisa dipahami Super Owner atau manajer. */
export function adjustmentEvidenceFailure(error: unknown): string {
  const data = (error instanceof ApiError ? error.data : null) as {
    code?: string;
    error?: { code?: string };
    issues?: Array<{ field?: string; issue?: string }>;
  } | null;
  const code = data?.error?.code ?? data?.code;
  const issue = data?.issues?.[0];
  if (issue?.field === 'reason') return 'Alasan minimal 20 karakter dan paling banyak 500.';
  if (issue?.field === 'evidence' && issue.issue === 'TOO_LARGE')
    return 'Berkas bukti paling besar 8 MB.';
  if (issue?.field === 'evidence') return 'Bukti harus berupa foto (JPG, PNG, WEBP) atau PDF.';
  if (issue?.field === 'quantity')
    return 'Jumlah sesi tidak valid. Pilih antara -50 dan 50, bukan 0.';
  if (code === 'ADJUSTMENT_ALREADY_PENDING')
    return 'Paket ini masih punya permintaan penyesuaian yang menunggu. Putuskan dulu di daftar di bawah.';
  if (code === 'INSUFFICIENT_SESSION_BALANCE')
    return 'Sisa sesi tidak cukup untuk dikurangi sebanyak itu.';
  if (error instanceof ApiError && error.status === 403)
    return 'Hanya Super Owner dan Studio Manager yang dapat membuat penyesuaian.';
  return 'Penyesuaian belum tersimpan. Periksa koneksi lalu coba lagi.';
}
