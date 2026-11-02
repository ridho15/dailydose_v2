import { foregroundFetch } from '../components/app-loading';

export type OrderStatus =
  'AWAITING_PAYMENT' | 'PENDING' | 'ACTION_REQUIRED' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

export interface CheckoutOptions {
  package: {
    id: string;
    name: string;
    priceRp: number;
    effectivePriceRp: number;
    version: number;
    promotion: null | {
      id: string;
      name: string;
      label: string;
      discountType: 'PERCENTAGE' | 'FIXED_AMOUNT';
      discountValue: number;
      discountRp: number;
      promotionalPriceRp: number;
      activeFrom: string;
      activeUntil: string;
      version: number;
    };
    sessionCount: number;
    durationDays: number;
    isMultiBranch?: boolean;
    branchId: string;
    branchName: string;

    classTypes: Array<{
      id: string;
      name: string;
    }>;
  };
  paymentAccount: {
    id: string;
    bankName: string;
    accountNumber: string;
    accountHolderName: string;
    paymentWindowHours: number;
  };
}

export interface CustomerOrder {
  id: string;
  branchId: string;
  branchName?: string;
  branchTimezone?: string;
  packageId: string;
  packageName: string;
  priceRp: number;
  baseAmountRp: number;
  voucher?: null | {
    id: string;
    code: string;
    discountType: 'PERCENTAGE' | 'FIXED_AMOUNT';
    discountValue: number;
    discountRp: number;
  };
  promotion?: null | {
    id: string;
    name: string;
    discountType: 'PERCENTAGE' | 'FIXED_AMOUNT';
    discountValue: number;
    discountRp: number;
  };
  promotionalPriceRp?: number;
  priceAfterDiscountRp?: number;
  paymentUniqueCode: number | null;
  payableAmountRp: number;
  sessionCount: number;
  durationDays: number;
  status: OrderStatus;
  submittedAt: Date;
  decidedAt: Date | null;
  expiresAt: Date | null;
  continuationSlotId: string | null;
  paymentProofId: string | null;
  paymentProofStatus: null | {
    uploadStatus: string;
    scanStatus: string;
  };
  decisionReasonCode: string | null;
  timelineComplete: boolean;
  version: number;
  activation: CustomerOrderActivation | null;
  timeline?: CustomerOrderTimelinePage;
  paymentAccount: null | {
    bankName: string;
    accountNumber: string;
    accountHolderName: string;
  };
  correlationReference?: string;
}

export interface CustomerOrderSummary {
  total: number;
  awaitingPayment: number;
  pending: number;
  actionRequired: number;
  approved: number;
  rejected: number;
  expired: number;
}

export interface CustomerOrderActivation {
  customerPackageId: string;
  status: 'ACTIVE' | 'EXPIRED' | 'INACTIVE';
  activationDate: Date;
  expiryAt: Date;
  sessionCount: number;
}

export type CustomerOrderTimelineType =
  | 'ORDER_CREATED'
  | 'PAYMENT_DEADLINE_SET'
  | 'PROOF_SUBMITTED'
  | 'PROOF_SCAN_COMPLETED'
  | 'ACTION_REQUIRED'
  | 'PAYMENT_APPROVED'
  | 'PAYMENT_REJECTED'
  | 'ORDER_EXPIRED'
  | 'PACKAGE_ACTIVATED';

export interface CustomerOrderTimelineItem {
  id: string;
  type: CustomerOrderTimelineType;
  reasonCode: string | null;
  occurredAt: Date;
  derived: boolean;
}

export interface CustomerOrderTimelinePage {
  items: CustomerOrderTimelineItem[];
  page: { hasMore: boolean; nextCursor: string | null };
}

export interface CustomerOrderPage {
  items: CustomerOrder[];
  summary: CustomerOrderSummary;
  page: { hasMore: boolean; nextCursor: string | null };
}

export interface CustomerOrderFilters {
  status?: string;
  q?: string;
  from?: string;
  until?: string;
  cursor?: string;
  limit?: number;
}

export type PaymentProofUploadStage =
  'IDLE' | 'ISSUING' | 'UPLOADING' | 'SCANNING' | 'ATTACHING' | 'COMPLETED';

export interface PaymentProofUploadSession {
  stage: PaymentProofUploadStage;
  uploadId?: string;
  sha256: string;
  sizeBytes: number;
}

export class OrderClientError extends Error {
  constructor(
    readonly code: string,
    readonly correlationReference?: string,
    readonly retryable = false,
    readonly stage?: PaymentProofUploadStage,
  ) {
    super(code);
    this.name = 'OrderClientError';
  }
}

async function requestResult<T>(
  path: string,
  init?: RequestInit,
  stage?: PaymentProofUploadStage,
): Promise<{ body: T; correlationReference?: string }> {
  let response: Response;
  try {
    response = await foregroundFetch(
      `/api/v1${path}`,
      { credentials: 'include', ...init },
      stage ? 'Memproses bukti pembayaran…' : 'Memuat pesanan…',
    );
  } catch {
    throw new OrderClientError('API_UNAVAILABLE', undefined, true, stage);
  }
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as {
      code?: string;
      error?: { code?: string; correlationId?: string; retryable?: boolean };
    };
    throw new OrderClientError(
      problem.error?.code || problem.code || `HTTP_${response.status}`,
      problem.error?.correlationId ?? response.headers.get('x-correlation-id') ?? undefined,
      problem.error?.retryable ?? response.status >= 500,
      stage,
    );
  }
  return {
    body: (await response.json()) as T,
    correlationReference: response.headers.get('x-correlation-id') ?? undefined,
  };
}

async function request<T>(
  path: string,
  init?: RequestInit,
  stage?: PaymentProofUploadStage,
): Promise<T> {
  return (await requestResult<T>(path, init, stage)).body;
}

const orderDates = (
  order: Omit<
    CustomerOrder,
    'submittedAt' | 'decidedAt' | 'expiresAt' | 'activation' | 'timeline'
  > & {
    submittedAt: string;
    decidedAt: string | null;
    expiresAt: string | null;
    activation:
      | (Omit<CustomerOrderActivation, 'activationDate' | 'expiryAt'> & {
          activationDate: string;
          expiryAt: string;
        })
      | null;
    timeline?: {
      items: Array<Omit<CustomerOrderTimelineItem, 'occurredAt'> & { occurredAt: string }>;
      page: { hasMore: boolean; nextCursor: string | null };
    };
  },
): CustomerOrder => ({
  ...order,
  voucher: order.voucher ?? null,
  priceAfterDiscountRp: order.priceAfterDiscountRp ?? order.baseAmountRp,
  submittedAt: new Date(order.submittedAt),
  decidedAt: order.decidedAt ? new Date(order.decidedAt) : null,
  expiresAt: order.expiresAt ? new Date(order.expiresAt) : null,
  activation: order.activation
    ? {
        ...order.activation,
        activationDate: new Date(order.activation.activationDate),
        expiryAt: new Date(order.activation.expiryAt),
      }
    : null,
  timeline: order.timeline
    ? {
        ...order.timeline,
        items: order.timeline.items.map((item) => ({
          ...item,
          occurredAt: new Date(item.occurredAt),
        })),
      }
    : undefined,
});

export const browserOrderClient = {
  checkout(packageId: string, branchId?: string | null) {
    const query = new URLSearchParams({ packageId });
    if (branchId) query.set('branchId', branchId);
    return request<CheckoutOptions>(`/checkout/options?${query.toString()}`);
  },
  async create(
    packageId: string,
    slotId?: string | null,
    branchId?: string | null,
    classTypeId?: string | null,
    voucherCode?: string,
    pricing?: CheckoutOptions['package'],
  ) {
    const value = await request<any>('/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        packageId,
        ...(slotId ? { slotId } : {}),
        ...(branchId ? { branchId } : {}),
        ...(classTypeId ? { classTypeId } : {}),
        ...(voucherCode ? { voucherCode } : {}),
        ...(pricing
          ? {
              expectedPackageVersion: pricing.version,
              expectedPromotionId: pricing.promotion?.id ?? null,
              ...(pricing.promotion ? { expectedPromotionVersion: pricing.promotion.version } : {}),
            }
          : {}),
      }),
    });
    return orderDates(value);
  },
  async previewVoucher(packageId: string, branchId: string, classTypeId: string, code: string) {
    return request<{
      valid: boolean;
      voucherId: string;
      code: string;
      baseAmountRp: number;
      packagePriceRp: number;
      packagePromotionDiscountRp: number;
      promotionalPriceRp: number;
      discountRp: number;
      priceAfterDiscountRp: number;
      discountType?: 'PERCENTAGE' | 'FIXED_AMOUNT';
      discountValue?: number;
    }>('/checkout/voucher-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId, branchId, classTypeId, code }),
    });
  },
  async list(filters: CustomerOrderFilters = {}): Promise<CustomerOrderPage> {
    const query = new URLSearchParams();
    if (filters.status) query.set('status', filters.status);
    if (filters.q) query.set('q', filters.q);
    if (filters.from) query.set('from', filters.from);
    if (filters.until) query.set('until', filters.until);
    if (filters.cursor) query.set('cursor', filters.cursor);
    if (filters.limit) query.set('limit', String(filters.limit));
    const value = await request<{
      items: any[];
      summary: CustomerOrderSummary;
      page: { hasMore: boolean; nextCursor: string | null };
    }>(`/orders${query.size ? `?${query.toString()}` : ''}`);
    return { ...value, items: value.items.map(orderDates) };
  },
  async detail(id: string) {
    return orderDates(await request<any>(`/orders/${encodeURIComponent(id)}`));
  },
  async loadProof(orderId: string) {
    let authorization: { url: string; expiresAt: string };
    try {
      authorization = await request<{ url: string; expiresAt: string }>(
        `/orders/${encodeURIComponent(orderId)}/payment-proof/view-authorizations`,
        { method: 'POST' },
      );
    } catch (cause) {
      if (cause instanceof OrderClientError && cause.code === 'RESOURCE_NOT_FOUND')
        throw new OrderClientError(
          'PAYMENT_PROOF_PREVIEW_NOT_FOUND',
          cause.correlationReference,
          false,
        );
      throw cause;
    }
    let response: Response;
    try {
      response = await foregroundFetch(
        authorization.url,
        {
          credentials: 'include',
          headers: { Accept: 'image/jpeg,image/png,application/pdf' },
        },
        'Memuat bukti pembayaran…',
      );
    } catch {
      throw new OrderClientError('API_UNAVAILABLE', undefined, true);
    }
    if (!response.ok) {
      const problem = (await response.json().catch(() => ({}))) as {
        code?: string;
        error?: { code?: string; correlationId?: string; retryable?: boolean };
      };
      const code = problem.error?.code || problem.code || `HTTP_${response.status}`;
      throw new OrderClientError(
        code === 'RESOURCE_NOT_FOUND' || code === 'HTTP_404'
          ? 'PAYMENT_PROOF_PREVIEW_NOT_FOUND'
          : code,
        problem.error?.correlationId ?? response.headers.get('x-correlation-id') ?? undefined,
        problem.error?.retryable ?? response.status >= 500,
      );
    }
    return response.blob();
  },
  async uploadProof(
    order: CustomerOrder,
    file: File,
    sha256: string,
    previous: PaymentProofUploadSession | undefined,
    onProgress?: (session: PaymentProofUploadSession) => void,
  ) {
    let session =
      previous && previous.sha256 === sha256 && previous.sizeBytes === file.size
        ? previous
        : { stage: 'ISSUING' as const, sha256, sizeBytes: file.size };
    const progress = (next: PaymentProofUploadSession) => {
      session = next;
      onProgress?.(next);
    };
    if (!session.uploadId) {
      progress({ ...session, stage: 'ISSUING' });
      const issued = await request<{ id: string }>(
        '/uploads/payment-proofs',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: order.id,
            branchId: order.branchId,
            packageId: order.packageId,
            fileName: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
            sha256,
          }),
        },
        'ISSUING',
      );
      progress({ ...session, uploadId: issued.id, stage: 'UPLOADING' });
    }
    const uploadId = session.uploadId!;
    if (session.stage === 'UPLOADING' || session.stage === 'ISSUING') {
      await request(
        `/uploads/payment-proofs/${uploadId}/content`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: file,
        },
        'UPLOADING',
      );
      progress({ ...session, stage: 'SCANNING' });
    }
    if (session.stage === 'SCANNING') {
      let status = await request<{ uploadStatus: string; scanStatus: string }>(
        `/uploads/payment-proofs/${uploadId}/finalize`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sha256, sizeBytes: file.size }),
        },
        'SCANNING',
      );
      for (let attempt = 0; status.scanStatus === 'PENDING' && attempt < 20; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
        status = await request<{ uploadStatus: string; scanStatus: string }>(
          `/uploads/payment-proofs/${uploadId}`,
          undefined,
          'SCANNING',
        );
      }
      // Pemeriksaan yang belum selesai bukan berarti berkasnya ditolak: minta coba lagi, jangan
      // suruh member membuang bukti yang sah.
      if (status.scanStatus === 'PENDING')
        throw new OrderClientError('PAYMENT_PROOF_SCAN_PENDING', undefined, true, 'SCANNING');
      if (status.scanStatus !== 'CLEAN')
        throw new OrderClientError('PAYMENT_PROOF_NOT_CLEAN', undefined, false, 'SCANNING');
      progress({ ...session, stage: 'ATTACHING' });
    }
    const attached = await requestResult<any>(
      `/orders/${encodeURIComponent(order.id)}/payment-proof`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentProofId: uploadId, expectedVersion: order.version }),
      },
      'ATTACHING',
    );
    progress({ ...session, stage: 'COMPLETED' });
    return {
      ...orderDates(attached.body),
      correlationReference: attached.correlationReference,
    };
  },
};

export async function sha256Upload(file: File) {
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function orderError(error: unknown) {
  return orderErrorDetails(error).message;
}

export function orderErrorDetails(error: unknown) {
  const code =
    error instanceof OrderClientError
      ? error.code
      : error instanceof Error
        ? ((error as any).code as string | undefined) || error.message
        : typeof (error as any)?.code === 'string'
          ? (error as any).code
          : '';
  const labels: Record<string, string> = {
    CUSTOMER_VERIFICATION_REQUIRED:
      'Identitas kamu belum diverifikasi. Isi data verifikasi dulu, sekitar 2 menit.',
    IDENTITY_VERIFICATION_REQUIRED:
      'Identitas kamu belum diverifikasi. Isi data verifikasi dulu, sekitar 2 menit.',
    PAYMENT_ACCOUNT_UNAVAILABLE: 'Rekening pembayaran cabang belum tersedia.',
    PAYMENT_UNIQUE_CODE_UNAVAILABLE:
      'Kode pembayaran sedang penuh. Tunggu beberapa saat lalu buat pesanan kembali.',
    ORDER_EXPIRED: 'Batas pembayaran sudah berakhir. Buat pesanan baru.',
    PAYMENT_PROOF_MIME_MISMATCH: 'Isi file tidak sesuai dengan tipe file yang dipilih.',
    PAYMENT_PROOF_SCAN_PENDING: 'Pemeriksaan file masih berjalan. Tunggu sebentar lalu coba lagi.',
    PAYMENT_PROOF_TOO_LARGE: 'Ukuran file melebihi batas 10 MB.',
    PAYMENT_PROOF_CHECKSUM_MISMATCH: 'File berubah saat diunggah. Silakan pilih ulang.',
    PAYMENT_PROOF_NOT_CLEAN:
      'File ditolak oleh pemeriksaan keamanan. Pilih file bukti yang berbeda.',
    UPLOAD_NOT_COMPLETE: 'Upload belum lengkap. Silakan coba kembali.',
    API_UNAVAILABLE: 'Layanan pesanan sementara tidak tersedia. Silakan coba kembali nanti.',
    CONFIGURATION_REQUIRED: 'Bukti pembayaran belum dapat diproses. Silakan coba kembali nanti.',
    PAYMENT_PROOF_SCAN_UNAVAILABLE:
      'Pemeriksaan keamanan file sedang tidak tersedia. Bukti Anda tetap dapat dicoba kembali.',
    PAYMENT_PROOF_STORAGE_UNAVAILABLE:
      'Penyimpanan bukti pembayaran sedang tidak tersedia. File tetap tersimpan pada halaman ini.',
    PAYMENT_PROOF_PREVIEW_NOT_FOUND:
      'Bukti pembayaran tidak ditemukan atau akses preview sudah kedaluwarsa. Coba buka kembali.',
    UNAUTHORIZED: 'Sesi telah berakhir. Silakan masuk kembali untuk melihat bukti pembayaran.',
    FORBIDDEN: 'Akun ini tidak memiliki akses untuk melihat bukti pembayaran.',
    HTTP_401: 'Sesi telah berakhir. Silakan masuk kembali untuk melihat bukti pembayaran.',
    HTTP_403: 'Akun ini tidak memiliki akses untuk melihat bukti pembayaran.',
    INTERNAL_ERROR:
      'Permintaan belum dapat diselesaikan. Gunakan kode bantuan saat menghubungi dukungan.',
    HTTP_502: 'Layanan upload sedang tidak tersedia. Silakan coba kembali.',
    HTTP_503: 'Layanan upload sedang tidak tersedia. Silakan coba kembali.',
    RESOURCE_NOT_FOUND: 'Data pesanan atau paket tidak ditemukan.',
    CONFLICT: 'Data berubah. Muat ulang halaman lalu coba kembali.',
    VERSION_CONFLICT: 'Pesanan telah berubah. Muat ulang halaman lalu coba kembali.',
    PROMOTION_CHANGED:
      'Harga promo paket berubah sejak halaman ini dimuat. Muat ulang halaman untuk melihat harga terbaru.',
    VOUCHER_INVALID: 'Kode voucher tidak valid.',
    VOUCHER_EXPIRED: 'Kode voucher telah kedaluwarsa.',
    VOUCHER_INACTIVE: 'Kode voucher sudah tidak aktif.',
    VOUCHER_MINIMUM_NOT_MET: 'Total belanja belum memenuhi syarat minimum voucher.',
    VOUCHER_EXHAUSTED: 'Kuota penggunaan voucher telah habis.',
  };
  return {
    code,
    message:
      labels[code] ?? 'Layanan pesanan belum dapat memproses permintaan. Silakan coba kembali.',
    correlationReference:
      error instanceof OrderClientError ? error.correlationReference : undefined,
    retryable: error instanceof OrderClientError ? error.retryable : true,
    stage: error instanceof OrderClientError ? error.stage : undefined,
  };
}
