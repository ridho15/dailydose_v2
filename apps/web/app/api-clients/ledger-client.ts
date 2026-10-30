import { apiFetch } from '../lib/api-client';
import { appLoading } from '../components/app-loading';
import { notifySessionFailure } from './session-client';

export type LedgerBalance = {
  id: string;
  branchId: string;
  status: 'ACTIVE' | 'EXPIRED' | 'INACTIVE' | 'DEPLETED' | 'FROZEN' | string;
  activationDate: Date;
  expiryAt: Date;
  ledgerBalance: number;
  reserved: number;
  available: number;
  sessionCountSnapshot?: number;
  usage?: {
    initialSessions: number;
    usedSessions: number;
    reversedSessions: number;
    adjustmentDelta: number;
  };
  packageName?: string;
  branchName?: string;
  classTypeName?: string;
  classTypeId?: string | null;
  packageBranchId?: string | null;
  /** Cabang tempat paket boleh dipakai (cabang paket dan cabang pembelian), atau 'SEMUA'. */
  allowedBranchIds?: string[] | 'SEMUA';
  isMultiBranch?: boolean;
  isShareable?: boolean;
  sharedWithUserIds?: string[];
  sharedMembers?: SharedPackageMember[];
  customer?: { id: string; displayName: string; phoneMasked: string | null };
};

export type SharedPackageMember = {
  id: string;
  userId: string;
  relationship: string;
  displayName: string;
  phoneMasked: string | null;
  email?: string;
  addedById?: string | null;
  addedByRole?: string;
  createdAt: string;
};

/** Apakah paket member boleh dipakai di cabang ini. Server tetap memeriksa ulang saat booking. */
export function paketBerlakuDiCabang(
  pkg: Pick<LedgerBalance, 'isMultiBranch' | 'packageBranchId' | 'allowedBranchIds'>,
  branchId: string,
): boolean {
  if (pkg.isMultiBranch === true || pkg.allowedBranchIds === 'SEMUA') return true;
  if (Array.isArray(pkg.allowedBranchIds)) return pkg.allowedBranchIds.includes(branchId);
  return !pkg.packageBranchId || pkg.packageBranchId === 'global' || pkg.packageBranchId === branchId;
}
export type LedgerHistory = {
  balance: LedgerBalance;
  reservations: {
    activeQuantity: number;
    items: Array<{
      id: string;
      quantity: number;
      createdAt: Date;
      bookingId?: string | null;
      bookingStatus?: string | null;
      className?: string | null;
      branchName?: string | null;
      startsAt?: Date | null;
    }>;
  };
  entries: Array<{
    id: string;
    type: string;
    quantity: number;
    occurredAt: Date;
    referenceType?: string | null;
    referenceId?: string | null;
    referenceLabel?: string | null;
    bookingId?: string | null;
    balanceAfter?: number | null;
  }>;
  nextCursor?: string | null;
  previousCursor?: string | null;
};
export type LedgerSummary = {
  packageCount: number;
  activePackageCount?: number;
  ledgerBalance: number;
  reserved: number;
  available: number;
  usedSessions?: number;
  reversedSessions?: number;
  adjustmentDelta?: number;
  expiringSoon?: number;
};
export type AdjustmentSummary = {
  total: number;
  pending: number;
  posted: number;
  rejected: number;
};
export type Adjustment = {
  id: string;
  customerPackageId: string;
  quantity: number;
  reasonCode: string;
  status: 'PENDING' | 'POSTED' | 'REJECTED';
  version: number;
  createdAt?: Date;
  decidedAt?: Date | null;
  ledgerBalanceAtRequest?: number | null;
  reservedAtRequest?: number | null;
  customer?: { id: string; displayName: string; phoneMasked: string | null };
  branch?: { id: string; name: string };
  package?: { id: string; name: string };
  classType?: { id: string; name: string };
  requestedBy?: { id: string; displayName: string };
  decidedBy?: { id: string; displayName: string } | null;
  currentBalance?: number;
  currentReserved?: number;
  currentAvailable?: number;
  projectedLedgerBalance?: number;
  projectedAvailable?: number;
  eligibleForApproval?: boolean;
  eligibilityReason?: string | null;
  ledgerEntryId?: string | null;
  resultingBalance?: number | null;
  decisionCode?: string | null;
  decisionNote?: string | null;
  auditReference?: string | null;
};
export interface LedgerClient {
  list(
    branchId?: string,
    cursor?: string,
    search?: string,
    status?: 'ACTIVE' | 'EXPIRED' | 'INACTIVE' | 'DEPLETED' | 'FROZEN' | string,
    customerUserId?: string,
    page?: number,
    pageSize?: number,
  ): Promise<{
    items: LedgerBalance[];
    summary: LedgerSummary;
    total?: number;
    totalPages?: number;
    currentPage?: number;
    pageSize?: number;
    nextCursor?: string | null;
    previousCursor?: string | null;
  }>;
  detail(id: string, cursor?: string): Promise<LedgerHistory>;
  listAdjustments(
    branchId?: string,
    status?: 'PENDING' | 'POSTED' | 'REJECTED' | 'HISTORY',
    cursor?: string,
    q?: string,
    customerUserId?: string,
    from?: string,
    until?: string,
    limit?: number,
    page?: number,
    pageSize?: number,
  ): Promise<{
    items: Adjustment[];
    summary?: AdjustmentSummary;
    total?: number;
    totalPages?: number;
    currentPage?: number;
    pageSize?: number;
    nextCursor?: string | null;
    previousCursor?: string | null;
  }>;
  getAdjustment(id: string): Promise<Adjustment>;
  requestAdjustment(
    input: {
      customerPackageId: string;
      quantity: number;
      reasonCode: string;
      direct?: boolean;
      note?: string;
    },
    key: string,
  ): Promise<Adjustment>;
  directAdjustment?(
    input: {
      customerPackageId: string;
      quantity: number;
      reasonCode: string;
      note?: string;
    },
    key: string,
  ): Promise<
    Adjustment & {
      ledgerEntryId?: string | null;
      resultingBalance?: number;
      auditReference?: string | null;
    }
  >;
  decideAdjustment(
    id: string,
    decision: 'approve' | 'reject',
    input: { reasonCode: string; note?: string; expectedVersion: number },
    key: string,
  ): Promise<Adjustment>;
}

const mapLedgerBalance = (
  value: Omit<LedgerBalance, 'activationDate' | 'expiryAt'> & {
    activationDate: Date | string;
    expiryAt: Date | string;
  },
): LedgerBalance => ({
  ...value,
  activationDate: new Date(value.activationDate),
  expiryAt: new Date(value.expiryAt),
});
const mapAdjustment = (value: Adjustment): Adjustment => ({
  ...value,
  createdAt: value.createdAt ? new Date(value.createdAt) : undefined,
  decidedAt: value.decidedAt ? new Date(value.decidedAt) : null,
});

export const browserLedgerClient: LedgerClient = {
  async list(branchId, cursor, search, status, customerUserId, page, pageSize) {
    const params = new URLSearchParams();
    if (branchId) params.set('branchId', branchId);
    if (cursor) params.set('cursor', cursor);
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (customerUserId) params.set('customerUserId', customerUserId);
    if (page) params.set('page', String(page));
    if (pageSize) params.set('pageSize', String(pageSize));

    const response = await apiFetch<{
      items: any[];
      summary?: LedgerSummary;
      total?: number;
      totalPages?: number;
      currentPage?: number;
      pageSize?: number;
      page: { nextCursor?: string | null; previousCursor?: string | null; total?: number; totalPages?: number; current?: number; pageSize?: number };
    }>(`/customer-packages?${params.toString()}`, {
      label: 'Memuat ledger…',
    });

    const items = (response.items ?? []).map((item) =>
      mapLedgerBalance(item as unknown as Parameters<typeof mapLedgerBalance>[0]),
    );

    return {
      items,
      summary: response.summary ?? {
        packageCount: items.length,
        ledgerBalance: items.reduce((sum, item) => sum + item.ledgerBalance, 0),
        reserved: items.reduce((sum, item) => sum + item.reserved, 0),
        available: items.reduce((sum, item) => sum + item.available, 0),
      },
      total: response.total ?? response.page?.total,
      totalPages: response.totalPages ?? response.page?.totalPages,
      currentPage: response.currentPage ?? response.page?.current,
      pageSize: response.pageSize ?? response.page?.pageSize,
      nextCursor: response.page?.nextCursor ?? null,
      previousCursor: response.page?.previousCursor ?? null,
    };
  },

  async detail(id, cursor) {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    const query = params.toString() ? `?${params.toString()}` : '';

    const result = await apiFetch<{
      balance: any;
      reservations: {
        activeQuantity: number;
        items: Array<any>;
      };
      entries: Array<any>;
      page: { nextCursor?: string | null; previousCursor?: string | null };
    }>(`/customer-packages/${encodeURIComponent(id)}/ledger${query}`, {
      label: 'Memuat histori sesi…',
    });

    return {
      balance: mapLedgerBalance(result.balance as Parameters<typeof mapLedgerBalance>[0]),
      reservations: {
        activeQuantity: result.reservations?.activeQuantity ?? 0,
        items: (result.reservations?.items ?? []).map((reservation) => ({
          ...reservation,
          createdAt: new Date(reservation.createdAt),
          startsAt: reservation.startsAt ? new Date(reservation.startsAt) : null,
        })),
      },
      entries: (result.entries ?? []).map((entry) => ({
        ...entry,
        occurredAt: new Date(entry.occurredAt),
      })),
      nextCursor: result.page?.nextCursor ?? null,
      previousCursor: result.page?.previousCursor ?? null,
    };
  },

  async listAdjustments(branchId, status, cursor, q, customerUserId, from, until, limit, page, pageSize) {
    const params = new URLSearchParams();
    if (branchId) params.set('branchId', branchId);
    if (status) params.set('status', status);
    if (cursor) params.set('cursor', cursor);
    if (q) params.set('q', q);
    if (customerUserId) params.set('customerUserId', customerUserId);
    if (from) params.set('from', from);
    if (until) params.set('until', until);
    if (limit) params.set('limit', String(limit));
    if (page) params.set('page', String(page));
    if (pageSize) params.set('pageSize', String(pageSize));

    const result = await apiFetch<{
      items: any[];
      summary?: AdjustmentSummary;
      total?: number;
      totalPages?: number;
      currentPage?: number;
      pageSize?: number;
      page: { nextCursor?: string | null; previousCursor?: string | null; total?: number; totalPages?: number; current?: number; pageSize?: number };
    }>(`/session-adjustments?${params.toString()}`, {
      label: 'Memuat adjustment…',
    });

    return {
      items: (result.items ?? []).map((item) => mapAdjustment(item as unknown as Adjustment)),
      summary: result.summary as AdjustmentSummary,
      total: result.total ?? result.page?.total,
      totalPages: result.totalPages ?? result.page?.totalPages,
      currentPage: result.currentPage ?? result.page?.current,
      pageSize: result.pageSize ?? result.page?.pageSize,
      nextCursor: result.page?.nextCursor ?? null,
      previousCursor: result.page?.previousCursor ?? null,
    };
  },

  async getAdjustment(id) {
    const response = await apiFetch<Adjustment>(
      `/session-adjustments/${encodeURIComponent(id)}`,
      { label: 'Memuat detail penyesuaian…' },
    );
    return mapAdjustment(response);
  },

  async requestAdjustment(input, key) {
    const result = await apiFetch<Adjustment>('/session-adjustments', {
      method: 'POST',
      idempotent: true,
      headers: { 'idempotency-key': key },
      body: JSON.stringify(input),
      label: 'Mengajukan adjustment…',
    });
    return mapAdjustment(result);
  },

  async directAdjustment(input, key) {
    const result = await apiFetch<{
      adjustment: Adjustment;
      ledgerEntry?: { id: string };
      resultingBalance?: number;
      auditReference?: string | null;
    }>('/session-adjustments/direct', {
      method: 'POST',
      idempotent: true,
      headers: { 'idempotency-key': key },
      body: JSON.stringify(input),
      label: 'Menerapkan penyesuaian langsung…',
    });

    return {
      ...mapAdjustment(result.adjustment as unknown as Adjustment),
      ledgerEntryId: result.ledgerEntry?.id ?? null,
      resultingBalance: result.resultingBalance,
      auditReference: result.auditReference ?? null,
    };
  },

  async decideAdjustment(id, decision, input, key) {
    const result = await apiFetch<{
      adjustment: Adjustment;
      ledgerEntry?: { id: string };
      resultingBalance?: number;
      auditReference?: string | null;
    }>(`/session-adjustments/${encodeURIComponent(id)}/${encodeURIComponent(decision)}`, {
      method: 'POST',
      idempotent: true,
      headers: { 'idempotency-key': key },
      body: JSON.stringify(input),
      label: 'Memproses keputusan adjustment…',
    });

    return {
      ...(result.adjustment as unknown as Adjustment),
      ledgerEntryId: result.ledgerEntry?.id ?? null,
      resultingBalance: result.resultingBalance,
      auditReference: result.auditReference ?? null,
    };
  },
};

export async function ledgerFailure(error: unknown): Promise<string> {
  notifySessionFailure(error);
  const typed = error as {
    status?: number;
    message?: string;
    data?: {
      code?: string;
      error?: { code?: string };
      message?: string;
      title?: string;
      detail?: string;
    };
    response?: Response & { status?: number };
  };

  const status = typed?.status ?? typed?.response?.status;
  let responseCode =
    typed?.data?.code ??
    typed?.data?.error?.code ??
    (typeof typed?.data?.message === 'string' ? typed.data.message : undefined);

  if (!responseCode && typed?.response?.clone) {
    const body = (await typed.response
      .clone()
      .json()
      .catch(() => undefined)) as { code?: string; error?: { code?: string }; message?: string } | undefined;
    responseCode = body?.error?.code ?? body?.code ?? body?.message;
  }

  const messages: Record<string, string> = {
    ADJUSTMENT_ALREADY_PENDING:
      'Paket ini sudah memiliki penyesuaian yang menunggu keputusan. Buka antrean sebelum membuat permintaan baru.',
    PENDING_ADJUSTMENT_EXISTS:
      'Paket ini sudah memiliki penyesuaian yang menunggu keputusan. Buka antrean sebelum membuat permintaan baru.',
    INSUFFICIENT_SESSION_BALANCE:
      'Pengurangan sesi tidak dapat diproses karena melebihi saldo tersedia atau masih ada sesi yang tertahan (direservasi).',
    LEDGER_INVARIANT_VIOLATION:
      'Perubahan akan membuat kuota tidak cukup untuk booking kelas yang masih aktif.',
    SEPARATION_OF_DUTIES:
      'Permintaan harus diputuskan oleh Manager atau Super Owner yang berbeda dari staf yang mengajukan (Pemeriksaan Silang).',
    SEPARATION_OF_DUTIES_VIOLATION:
      'Permintaan harus diputuskan oleh Manager atau Super Owner yang berbeda dari staf yang mengajukan (Pemeriksaan Silang).',
    ADJUSTMENT_VERSION_CONFLICT:
      'Data penyesuaian telah berubah atau baru saja diputuskan oleh pengguna lain. Perbarui antrean sebelum mencoba lagi.',
    STALE_VERSION:
      'Data penyesuaian telah berubah. Perbarui data sebelum mengambil keputusan.',
    ADJUSTMENT_ALREADY_DECIDED:
      'Permintaan sudah diputuskan. Muat ulang antrean untuk melihat hasil terbaru.',
    IDEMPOTENCY_KEY_REUSED:
      'Isi permintaan berubah setelah konfirmasi. Tinjau ulang sebelum mengirim.',
    CONFIGURATION_REQUIRED:
      'Penyesuaian sesi sementara tidak tersedia. Saldo tetap dapat dilihat.',
    CONFLICT: 'Data berubah. Perbarui saldo dan antrean sebelum mencoba lagi.',
  };

  if (responseCode && messages[responseCode]) {
    return messages[responseCode]!;
  }

  if (typed?.message) {
    const matchedKey = Object.keys(messages).find((code) => typed.message?.includes(code));
    if (matchedKey && messages[matchedKey]) {
      return messages[matchedKey]!;
    }
  }

  if (status === 409) return messages.CONFLICT!;
  if (status === 404) return 'Data tidak ditemukan atau berada di luar cakupan cabang Anda.';
  if (status === 403) return 'Anda tidak memiliki hak akses atau cakupan cabang yang diperlukan.';
  if (status === 401) return 'Sesi Anda telah berakhir. Silakan masuk kembali.';
  if (status === 422 || status === 400) {
    const customMsg =
      typeof typed?.data?.message === 'string' &&
      !Object.keys(messages).includes(typed.data.message)
        ? typed.data.message
        : undefined;
    return customMsg || 'Data belum valid. Periksa pilihan paket, jumlah sesi, dan alasan.';
  }

  return 'Layanan belum dapat dijangkau. Coba kembali dengan permintaan yang sama.';
}

export type CustomerPackageAction = 'extend' | 'freeze' | 'unfreeze';

export async function manageCustomerPackage(
  id: string,
  action: CustomerPackageAction,
  input: { reason: string; days?: number; expectedValidUntil?: string },
) {
  return apiFetch<{ balance: unknown; ledgerEntry: unknown }>(
    `/customer-packages/${encodeURIComponent(id)}/${action}`,
    {
      method: 'POST',
      body: JSON.stringify(input),
      label: 'Memproses paket pelanggan…',
    },
  );
}

export async function listPackageMembers(customerPackageId: string) {
  return apiFetch<{
    customerPackageId: string;
    package: { id: string; name: string; isShareable: boolean };
    owner: { id: string; displayName: string; phoneMasked: string | null };
    remainingSessions: number;
    status: string;
    members: SharedPackageMember[];
  }>(`/customer-packages/${encodeURIComponent(customerPackageId)}/members`, {
    label: 'Memuat anggota paket bersama…',
  });
}

export async function addPackageMember(
  customerPackageId: string,
  input: { userId: string; relationship?: string },
) {
  return apiFetch<SharedPackageMember>(
    `/customer-packages/${encodeURIComponent(customerPackageId)}/members`,
    {
      method: 'POST',
      body: JSON.stringify(input),
      label: 'Menambahkan anggota paket…',
    },
  );
}

export async function removePackageMember(
  customerPackageId: string,
  memberUserId: string,
) {
  return apiFetch<{ success: boolean; customerPackageId: string; removedUserId: string }>(
    `/customer-packages/${encodeURIComponent(customerPackageId)}/members/${encodeURIComponent(memberUserId)}`,
    {
      method: 'DELETE',
      label: 'Menghapus anggota paket…',
    },
  );
}

const packageActionMessages: Record<string, string> = {
  PACKAGE_CHANGED: 'Paket berubah sejak halaman dimuat. Perbarui halaman lalu ulangi.',
  PACKAGE_FROZEN: 'Paket sedang dibekukan. Buka kembali terlebih dahulu.',
  PACKAGE_NOT_ACTIVE: 'Hanya paket aktif yang belum berakhir yang dapat dikelola.',
  PACKAGE_NOT_FROZEN: 'Paket ini tidak sedang dibekukan.',
  HAS_UPCOMING_BOOKINGS:
    'Paket masih punya booking mendatang. Batalkan booking tersebut sebelum membekukan.',
  NO_REMAINING_SESSIONS: 'Paket tidak punya sisa sesi, sehingga tidak perlu diperpanjang.',
  PACKAGE_NOT_SHAREABLE: 'Paket ini bukan tipe paket bersama (isShareable: false).',
  CANNOT_ADD_OWNER_AS_MEMBER: 'Pemilik paket tidak dapat ditambahkan sebagai anggota bersama.',
  MEMBER_ALREADY_ADDED: 'Member tersebut sudah terdaftar di paket ini.',
  USER_NOT_FOUND: 'Member tidak ditemukan atau akun sedang tidak aktif.',
  MEMBER_HAS_ACTIVE_BOOKINGS: 'Member masih memiliki booking aktif dengan paket ini. Batalkan booking terlebih dahulu.',
  MEMBER_NOT_FOUND: 'Member tidak terdaftar di paket ini.',
  VALIDATION_ERROR: 'Data belum valid. Periksa jumlah hari dan alasan.',
  FORBIDDEN: 'Anda tidak memiliki izin mengelola paket pelanggan.',
  RESOURCE_NOT_FOUND: 'Paket tidak ditemukan atau berada di luar cakupan cabang Anda.',
};

export function packageActionFailure(error: unknown): string {
  notifySessionFailure(error);
  const typed = error as { status?: number; data?: { code?: string; error?: { code?: string } } };
  const code = typed?.data?.code ?? typed?.data?.error?.code;
  if (code && packageActionMessages[code]) return packageActionMessages[code]!;
  if (typed?.status === 403) return packageActionMessages.FORBIDDEN!;
  if (typed?.status === 404) return packageActionMessages.RESOURCE_NOT_FOUND!;
  if (typed?.status === 409) return packageActionMessages.PACKAGE_CHANGED!;
  if (typed?.status === 400 || typed?.status === 422) return packageActionMessages.VALIDATION_ERROR!;
  if (typed?.status === 401) return 'Sesi Anda telah berakhir. Silakan masuk kembali.';
  return 'Layanan belum dapat dijangkau. Coba kembali beberapa saat lagi.';
}
