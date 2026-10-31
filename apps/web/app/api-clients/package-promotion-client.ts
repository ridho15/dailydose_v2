import { foregroundFetch } from '../components/app-loading';

export type PackagePromotionRecord = {
  id: string;
  packageId: string;
  name: string;
  label: string;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
  effectiveState: 'SCHEDULED' | 'LIVE' | 'EXPIRED' | 'DRAFT' | 'PAUSED' | 'ARCHIVED';
  discountType: 'PERCENTAGE' | 'FIXED_AMOUNT';
  discountValue: number;
  discountRp: number;
  promotionalPriceRp: number;
  activeFrom: string;
  activeUntil: string;
  version: number;
  usageCount?: number;
};

export type InternalPackageRecord = {
  id: string;
  branchId: string;
  classTypeId: string;
  businessKey: string;
  name: string;
  sessionCount: number;
  durationDays: number;
  priceRp: number;
  status: 'ACTIVE' | 'INACTIVE';
  effectiveFrom: string;
  effectiveUntil: string | null;
  version: number;
  effectiveState?: 'ACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'INACTIVE';
  isMultiBranch?: boolean;
  isShareable?: boolean;
  livePromotion?: boolean;
  _count?: { purchases: number; customerPackages: number };
  branch?: { id: string; code: string; name: string };
  classType?: { id: string; code: string; name: string };
  branchScopes?: Array<{
    id: string;
    branchId: string;
    active: boolean;
    branch?: { id: string; code: string; name: string };
  }>;
  classTypeScopes?: Array<{
    id: string;
    classTypeId: string;
    active: boolean;
    classType?: { id: string; code: string; name: string };
  }>;
  promotions?: PackagePromotionRecord[];
  revisions?: Array<{
    id: string;
    revisionNumber: number;
    sessionCount: number;
    durationDays: number;
    priceRp: number;
    effectiveFrom: string;
    effectiveUntil: string | null;
  }>;
  auditActivity?: Array<{ id: string; action: string; occurredAt: string }>;
  publicProfile?: Record<string, unknown> | null;
};

export type PackageManagementPage = {
  items: InternalPackageRecord[];
  summary: Partial<Record<'ACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'INACTIVE', number>>;
  page: { hasMore: boolean; nextCursor: string | null };
};

export type PackageManagementFilters = {
  branchId?: string;
  classTypeId?: string;
  status?: string;
  effectiveState?: string;
  q?: string;
  from?: string;
  until?: string;
  cursor?: string;
};

export type PromotionOrderPage = {
  items: Array<{
    id: string;
    status: string;
    packagePromotionDiscountRpSnapshot: number | null;
    promotionalPriceRpSnapshot: number | null;
    voucherDiscountRpSnapshot: number | null;
    priceAfterDiscountRpSnapshot: number | null;
    submittedAt: string;
    user: { displayName: string };
    branch: { id: string; name: string };
  }>;
  page: { hasMore: boolean; nextCursor: string | null };
};
export type PackagePromotionPage = {
  items: PackagePromotionRecord[];
  page: { hasMore: boolean; nextCursor: string | null };
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await foregroundFetch(
    `/api/v1${path}`,
    { credentials: 'include', ...init },
    'Memuat promo paket…',
  );
  if (!response.ok) throw { response };
  return response.json() as Promise<T>;
}

const headers = () => ({
  'content-type': 'application/json',
  'idempotency-key': crypto.randomUUID(),
});

export const browserPackagePromotionClient = {
  async packages(filters: PackageManagementFilters = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
    return request<PackageManagementPage>(`/packages${query.size ? `?${query.toString()}` : ''}`);
  },
  async detail(id: string) {
    const res = await request<any>(`/packages/${encodeURIComponent(id)}`);
    return (res?.package ? { ...res.package, ...res } : (res?.body ?? res)) as InternalPackageRecord;
  },
  promotions(packageId: string, cursor?: string) {
    const query = new URLSearchParams();
    if (cursor) query.set('cursor', cursor);
    return request<PackagePromotionPage>(
      `/packages/${encodeURIComponent(packageId)}/promotions${query.size ? `?${query}` : ''}`,
    );
  },
  create(packageId: string, input: Record<string, unknown>) {
    return request<PackagePromotionRecord>(
      `/packages/${encodeURIComponent(packageId)}/promotions`,
      { method: 'POST', headers: headers(), body: JSON.stringify(input) },
    );
  },
  update(id: string, input: Record<string, unknown>) {
    return request<PackagePromotionRecord>(`/package-promotions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify(input),
    });
  },
  /** Jeda dan arsip wajib beralasan; aktifkan tidak. Tidak ada alasan bawaan buatan klien. */
  transition(
    id: string,
    action: 'activate' | 'pause' | 'archive',
    expectedVersion: number,
    reason?: string,
  ) {
    return request<PackagePromotionRecord>(
      `/package-promotions/${encodeURIComponent(id)}/${action}`,
      {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ expectedVersion, ...(reason ? { reason } : {}) }),
      },
    );
  },
  orders(id: string, cursor?: string) {
    const query = new URLSearchParams();
    if (cursor) query.set('cursor', cursor);
    return request<PromotionOrderPage>(
      `/package-promotions/${encodeURIComponent(id)}/orders${query.size ? `?${query}` : ''}`,
    );
  },
  async createPackage(input: Record<string, unknown>) {
    const res = await request<any>('/packages', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(input),
    });
    return (res?.package ? { ...res.package, ...res } : (res?.body ?? res)) as InternalPackageRecord;
  },
  async updatePackage(id: string, input: Record<string, unknown>) {
    const res = await request<any>(`/packages/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify(input),
    });
    return (res?.package ? { ...res.package, ...res } : (res?.body ?? res)) as InternalPackageRecord;
  },
  async revisePackage(id: string, input: Record<string, unknown>) {
    const res = await request<any>(`/packages/${encodeURIComponent(id)}/revisions`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(input),
    });
    return (res?.package ? { ...res.package, ...res } : (res?.body ?? res)) as InternalPackageRecord;
  },
  async replacePackageScopes(id: string, input: Record<string, unknown>) {
    const res = await request<any>(`/packages/${encodeURIComponent(id)}/scopes`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify(input),
    });
    return (res?.package ? { ...res.package, ...res } : (res?.body ?? res)) as InternalPackageRecord;
  },
  async transitionPackage(
    id: string,
    action: 'deactivate' | 'reactivate',
    expectedVersion: number,
    /** Wajib saat menonaktifkan; aktifkan kembali tanpa alasan. */
    reason?: string,
  ) {
    const res = await request<any>(`/packages/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ expectedVersion, ...(reason ? { reason } : {}) }),
    });
    return (res?.package ? { ...res.package, ...res } : (res?.body ?? res)) as InternalPackageRecord;
  },
};

const promotionMessages: Record<string, string> = {
  PROMOTION_OVERLAP:
    'Sudah ada promo aktif pada paket ini di periode yang sama. Ubah periode atau jeda promo yang lain terlebih dahulu.',
  PROMOTION_EXPIRED: 'Periode promo ini sudah berakhir dan tidak dapat diaktifkan lagi.',
  STALE_VERSION: 'Promo ini diubah orang lain. Muat ulang halaman lalu ulangi perubahan Anda.',
  INVALID_STATE: 'Status promo tidak mengizinkan perubahan ini (mis. sudah diarsipkan).',
  FORBIDDEN: 'Anda tidak memiliki izin mengelola promo paket.',
  RESOURCE_NOT_FOUND: 'Promo atau paket tidak ditemukan.',
  RESOURCE_EXISTS:
    'Business Key (kode paket) sudah digunakan oleh paket lain. Silakan gunakan Business Key yang berbeda.',
  CANNOT_DELETE_PACKAGE_WITH_DEPENDENCIES:
    'Paket tidak dapat dihapus karena sudah memiliki riwayat data. Gunakan fitur Nonaktifkan untuk mengarsipkan paket ini.',
};

/** Pesan Indonesia untuk kegagalan promo; membaca kode dari respons problem-details. */
export async function promotionFailure(error: unknown, fallback: string): Promise<string> {
  const response = (error as { response?: Response })?.response;
  if (!response) return fallback;
  const body = (await response
    .clone()
    .json()
    .catch(() => ({}))) as {
    error?: { code?: string; details?: Array<{ field?: string; issue?: string }> };
    code?: string;
    details?: Array<{ field?: string; issue?: string }>;
  };
  const code = body.error?.code ?? body.code;
  const issue = body.error?.details?.[0]?.issue ?? body.details?.[0]?.issue;

  if (code === 'VALIDATION_ERROR') {
    if (issue === 'TOO_LARGE') return 'Nilai diskon terlalu besar (persen maks. 90; nominal harus di bawah harga paket).';
    if (issue === 'BEFORE_START') return 'Tanggal berakhir harus setelah tanggal mulai.';
    if (issue === 'IN_THE_PAST') return 'Tanggal berakhir promo sudah lewat.';
    return 'Data yang dimasukkan belum valid. Pastikan Business Key, nama paket, jumlah sesi (min. 1), dan harga telah terisi dengan benar.';
  }
  if (issue) return issue;
  if (code && promotionMessages[code]) return promotionMessages[code]!;
  if (response.status === 403) return promotionMessages.FORBIDDEN!;
  if (response.status === 404) return promotionMessages.RESOURCE_NOT_FOUND!;
  return fallback;
}
