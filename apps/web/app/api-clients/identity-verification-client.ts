'use client';

import { foregroundFetch } from '../components/app-loading';

export type VerificationStatus = 'PENDING' | 'ACTION_REQUIRED' | 'APPROVED';
export type DocumentKind = 'SELFIE' | 'KTP_FRONT';
export type DocumentReviewStatus =
  'PENDING' | 'APPROVED' | 'REJECTED' | 'PENDING_DELETION' | 'DELETE_FAILED' | 'DELETED';
export type DocumentScanStatus = 'PENDING' | 'CLEAN' | 'REJECTED' | 'INFECTED' | 'ERROR';

export interface VerificationDocument {
  id: string;
  kind: DocumentKind;
  status: DocumentReviewStatus;
  uploadStatus: string;
  scanStatus: DocumentScanStatus;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  rejectionReasonCode: string | null;
  rejectionNote: string | null;
  reviewedAt: string | null;
  deletedAt: string | null;
  issuedAt?: string;
  uploadedAt?: string | null;
  finalizedAt?: string | null;
  createdAt?: string;
  version: number;
}

export interface IdentityVerificationReviewCase {
  id: string;
  user: {
    id: string;
    displayName: string;
    /** Nama yang diisi pelanggan pada form verifikasi (bisa kosong). */
    profileName?: string | null;
    birthDate?: string | null;
    dateOfBirth?: string | null;
    phoneMasked: string | null;
    status: 'PENDING_ACTIVATION' | 'ACTIVE' | 'INACTIVE';
  };
  verificationStatus: VerificationStatus;
  oldestAt: string | null;
  documents: VerificationDocument[];
}

export interface IdentityVerificationReviewSummary {
  totalCustomers: number;
  totalDocuments: number;
  pendingDocuments: number;
  approvedDocuments: number;
  /** Pelanggan menunggu/disetujui, dengan definisi yang sama dengan dashboard dan daftar pelanggan. */
  pendingCustomers?: number;
  approvedCustomers?: number;
  rejectedDocuments: number;
  deletionIssues: number;
}

export interface IdentityVerificationReviewPage {
  items: IdentityVerificationReviewCase[];
  summary: IdentityVerificationReviewSummary;
  page: {
    hasMore: boolean;
    currentPage?: number;
    totalPages?: number;
    totalCount?: number;
    nextCursor: string | null;
  };
  generatedAt: string;
}

export interface IdentityVerificationReviewFilters {
  q?: string;
  status?: DocumentReviewStatus;
  kind?: DocumentKind;
  scanStatus?: DocumentScanStatus;
  from?: string;
  until?: string;
  cursor?: string;
  page?: number;
  limit?: number;
  customerUserId?: string;
}

export interface VerificationSummary {
  status: VerificationStatus;
  documents: VerificationDocument[];
}

async function request(path: string, init?: RequestInit) {
  const isMultipart = init?.body instanceof FormData;
  const response = await foregroundFetch(
    `/api/v1${path}`,
    {
      credentials: 'include',
      ...init,
      headers: {
        ...(isMultipart ? {} : { 'Content-Type': 'application/json' }),
        ...(init?.headers ?? {}),
      },
    },
    init?.method && init.method !== 'GET' ? 'Memproses verifikasi…' : 'Memuat verifikasi…',
  );
  if (!response.ok) {
    const body = await response.json().catch(() => undefined);
    throw {
      response: {
        status: response.status,
        data: body?.error,
        correlationId: body?.error?.correlationId,
      },
    };
  }
  return response.status === 204 ? undefined : response.json();
}

export const verificationClient = {
  register(input: {
    displayName: string;
    phone: string;
    email: string;
    password: string;
    consent: boolean;
    selfie?: File | null;
    ktp?: File | null;
  }) {
    const form = new FormData();
    form.set('displayName', input.displayName);
    form.set('phone', input.phone);
    form.set('email', input.email);
    form.set('password', input.password);
    form.set('consent', String(input.consent));
    if (input.selfie) form.set('selfie', input.selfie);
    if (input.ktp) form.set('ktp', input.ktp);
    return request('/auth/customer-registrations', { method: 'POST', body: form });
  },
  mine(): Promise<VerificationSummary> {
    return request('/identity-verification/me');
  },
  submit(input: {
    nik?: string;
    address?: string;
    ktp?: File | null;
    selfie?: File | null;
  }): Promise<{ status: string; message: string }> {
    const form = new FormData();
    if (input.nik) form.set('nik', input.nik);
    if (input.address) form.set('address', input.address);
    if (input.ktp) form.set('ktp', input.ktp);
    if (input.selfie) form.set('selfie', input.selfie);
    return request('/identity-verification/me/submission', {
      method: 'POST',
      body: form,
    });
  },
  authorizeMine(kind: DocumentKind): Promise<{ url: string; expiresAt: string }> {
    return request(`/identity-verification/me/documents/${kind}/view-authorizations`, {
      method: 'POST',
    });
  },
  async readPrivateFile(url: string): Promise<Blob> {
    const response = await foregroundFetch(
      url,
      {
        credentials: 'include',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      },
      'Memuat dokumen…',
    );
    if (!response.ok) throw { response: { status: response.status } };
    return response.blob();
  },
  replace(kind: DocumentKind, input: { file: File; expectedVersion: number }) {
    const form = new FormData();
    form.set('replacement', input.file);
    form.set('expectedVersion', String(input.expectedVersion));
    return request(`/identity-verification/me/documents/${kind}/replacements`, {
      method: 'POST',
      body: form,
    });
  },
  reviewQueue(
    filters: IdentityVerificationReviewFilters = {},
  ): Promise<IdentityVerificationReviewPage> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters))
      if (value !== undefined && value !== '') query.set(key, String(value));
    return request(`/identity-verifications${query.size ? `?${query}` : ''}`);
  },
  decide(
    id: string,
    decision: 'approve' | 'reject',
    input: { expectedVersion: number; reasonCode?: string; note?: string },
  ): Promise<VerificationDocument & { auditReference?: string }> {
    return request(`/identity-verifications/${id}/decisions/${decision}`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  authorizeView(id: string): Promise<{ url: string; expiresAt: string }> {
    return request(`/identity-verifications/${id}/view-authorizations`, { method: 'POST' });
  },
  delete(
    id: string,
    input: { expectedVersion: number; reason: string },
  ): Promise<{
    id: string;
    status: 'DELETED' | 'DELETE_FAILED';
    version: number;
    nextAttemptAt?: string;
    auditReference?: string;
  }> {
    return request(`/identity-verifications/${id}/delete`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
};
