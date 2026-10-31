export type CustomerStatus = 'PENDING_ACTIVATION' | 'ACTIVE' | 'INACTIVE';

export interface CustomerSummary {
  id: string;
  displayName: string;
  email: string | null;
  phoneE164: string | null;
  /** True bila pelanggan tidak berkaitan dengan cabang staf: kontak dan data pribadi disamarkan, perubahan ditolak. */
  contactMasked?: boolean;
  status: CustomerStatus;
  stoppedAt?: string | null;
  isStopped?: boolean;
  version: number;
  verificationStatus: 'PENDING' | 'ACTION_REQUIRED' | 'APPROVED';
  emailVerified: boolean;
  mustChangePassword: boolean;
  activePackageCount: number;
  activePackages?: Array<{
    id: string;
    name: string;
    remainingSessions: number;
    totalSessions: number;
  }>;
  purchasedSessions: number;
  updatedAt: string;
  preferredBranch: { id: string; code: string; name: string } | null;
  profile: {
    barcode?: string | null;
    address?: string | null;
    genderCode?: string | null;
    gender?: string | null;
    countryCode?: string | null;
    birthDate?: string | null;
    nik?: string | null;
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
    notes?: string | null;
    ktpUrl?: string | null;
    selfieUrl?: string | null;
  } | null;
  _count: { purchases: number; customerBookings: number };
}

export interface CustomerDetailPurchase {
  id: string;
  invoiceNumber?: string;
  status: string;
  packageNameSnapshot?: string;
  priceRpSnapshot?: number;
  payableAmountRpSnapshot?: number;
  submittedAt: string;
  decidedAt?: string | null;
  paymentMethod?: string;
  branchName?: string | null;
  paymentProofUrl?: string | null;
}

export interface CustomerDetailPackage {
  id: string;
  status: string;
  sessionCountSnapshot?: number;
  remainingSessions: number;
  usedSessions: number;
  activationDate?: string | null;
  expiryAt?: string | null;
  package?: { name: string; sessionCount?: number };
}

export interface CustomerDetailBooking {
  id: string;
  bookingNumber?: string;
  status: string;
  classSlotId: string;
  createdAt: string;
  cancelledAt?: string | null;
  classTypeName?: string;
  instructorName?: string;
  startAt?: string;
  endAt?: string;
  branchName?: string | null;
  attendanceStatus?: string;
}

export interface CustomerDetailDocument {
  id?: string;
  kind: string;
  status: string;
  fileName?: string;
  reviewedAt: string | null;
  uploadedAt?: string | null;
  url?: string;
}

export interface CustomerList {
  items: CustomerSummary[];
  summary: { total: number };
  total?: number;
  totalPages?: number;
  currentPage?: number;
  pageSize?: number;
  page: {
    hasMore: boolean;
    nextCursor: string | null;
    total?: number;
    totalPages?: number;
    current?: number;
    pageSize?: number;
  };
}

export interface CustomerDetail extends CustomerSummary {
  createdAt: string;
  identities: Array<{ provider: string; verifiedAt: string | null; createdAt: string }>;
  identityDocuments: CustomerDetailDocument[];
  passwordCredential: {
    verifiedAt: string | null;
    passwordChangedAt: string;
    mustChangePassword: boolean;
  } | null;
  purchases: CustomerDetailPurchase[];
  customerPackages: CustomerDetailPackage[];
  customerBookings: CustomerDetailBooking[];
  voucherRedemptions: Array<Record<string, unknown>>;
  notifications: Array<Record<string, unknown>>;
  _count: {
    purchases: number;
    customerBookings: number;
    customerPackages: number;
    voucherRedemptions: number;
    notifications: number;
  };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${url}`, {
    credentials: 'include',
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      code?: string;
      error?: { code?: string };
    };
    // API membungkus kode galat di `error.code`; tanpa ini alasannya hilang di layar.
    const code = body.error?.code ?? body.code;
    throw Object.assign(new Error(code || 'REQUEST_FAILED'), {
      status: response.status,
      code,
    });
  }
  return response.json() as Promise<T>;
}

export const customerClient = {
  list(input: Record<string, string | undefined>) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(input)) if (value) query.set(key, value);
    return request<CustomerList>(`/customers?${query}`);
  },
  detail(id: string) {
    return request<CustomerDetail>(`/customers/${encodeURIComponent(id)}`);
  },
  create(input: Record<string, unknown>, options: { stepUpToken?: string; idempotencyKey: string }) {
    return request<CustomerSummary>('/customers', {
      method: 'POST',
      headers: {
        // Backend belum memvalidasi step-up untuk pembuatan customer; kirim hanya bila ada.
        ...(options.stepUpToken ? { 'x-customer-step-up': options.stepUpToken } : {}),
        'idempotency-key': options.idempotencyKey,
      },
      body: JSON.stringify(input),
    });
  },
  updateProfile(
    id: string,
    input: Record<string, unknown>,
    options?: { stepUpToken?: string; idempotencyKey?: string },
  ) {
    const headers: Record<string, string> = {
      'idempotency-key': options?.idempotencyKey ?? crypto.randomUUID(),
    };
    if (options?.stepUpToken) {
      headers['x-customer-step-up'] = options.stepUpToken;
    }
    return request<{ id: string; version: number }>(
      `/customers/${encodeURIComponent(id)}/profile`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify(input),
      },
    );
  },
  setStatus(
    id: string,
    action: 'deactivate' | 'reactivate',
    input: { expectedVersion: number; reason?: string },
    options?: { stepUpToken?: string; idempotencyKey?: string },
  ) {
    const headers: Record<string, string> = {
      'idempotency-key': options?.idempotencyKey ?? crypto.randomUUID(),
    };
    if (options?.stepUpToken) {
      headers['x-customer-step-up'] = options.stepUpToken;
    }
    return request<{ id: string; status: CustomerStatus; version: number }>(
      `/customers/${encodeURIComponent(id)}/${action}`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(input),
      },
    );
  },
  markStopped(id: string, reason?: string) {
    return request<{ id: string; stoppedAt: string | null; isStopped: boolean; status: CustomerStatus }>(
      `/customers/${encodeURIComponent(id)}/mark-stopped`,
      {
        method: 'POST',
        body: JSON.stringify({ reason }),
      },
    );
  },
  unmarkStopped(id: string) {
    return request<{ id: string; stoppedAt: null; isStopped: boolean; status: CustomerStatus }>(
      `/customers/${encodeURIComponent(id)}/unmark-stopped`,
      {
        method: 'POST',
      },
    );
  },
  /** Pesan untuk staf bila reset kata sandi member gagal, menurut kode galat dari server. */
  pesanResetSandi(cause: unknown) {
    const code = (cause as { code?: string; status?: number } | null)?.code;
    const status = (cause as { status?: number } | null)?.status;
    if (code === 'CUSTOMER_NOT_ACTIVE')
      return 'Akun member ini nonaktif atau berhenti. Aktifkan kembali akunnya dulu.';
    if (code === 'VALIDATION_ERROR') return 'Kata sandi minimal 8 karakter.';
    if (code === 'FORBIDDEN' || status === 403)
      return 'Akun Anda tidak berwenang mengganti kata sandi member. Minta bantuan Manager atau Super Owner.';
    if (code === 'NOT_FOUND' || status === 404)
      return 'Akun ini tidak ditemukan atau bukan akun member.';
    return 'Kata sandi belum tersimpan. Periksa koneksi lalu coba lagi.';
  },
  resetPassword(id: string, newPassword: string) {
    return request<{ id: string; status: string }>(
      `/users/${encodeURIComponent(id)}/direct-password-reset`,
      {
        method: 'POST',
        body: JSON.stringify({ newPassword }),
      },
    );
  },
  uploadDocument(
    id: string,
    kind: 'KTP_FRONT' | 'SELFIE',
    file: { base64: string; fileName?: string; mimeType?: string },
  ) {
    return request<{ id: string; kind: string; status: string; url?: string }>(
      `/customers/${encodeURIComponent(id)}/documents`,
      {
        method: 'POST',
        body: JSON.stringify({ kind, ...file }),
      },
    );
  },
  impersonate(id: string) {
    return request<{ channel: string; user: any }>(
      `/customers/${encodeURIComponent(id)}/impersonate`,
      {
        method: 'POST',
      },
    );
  },
};


