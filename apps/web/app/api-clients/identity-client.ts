
import { notifySessionFailure } from './session-client';
import { appLoading, foregroundFetch } from '../components/app-loading';
import type { IdentityVerificationReviewCase } from './identity-verification-client';

export type UiFailure =
  | 'AUTHENTICATION_REQUIRED'
  | 'CONFIGURATION_REQUIRED'
  | 'INTERNAL_ERROR'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'FORBIDDEN'
  | 'IDENTITY_CONFLICT'
  | 'STALE_VERSION'
  | 'SESSION_REVOKED'
  | 'NOT_IMPLEMENTED';

export type ApplicationRole =
  'CUSTOMER' | 'INSTRUCTOR' | 'ADMIN' | 'MANAGER' | 'OWNER' | 'SUPER_OWNER' | 'FINANCE';

export interface UserRoleSummary {
  role: ApplicationRole;
  branchId: string | null;
  branch: { id: string; code: string; name: string } | null;
  source: 'DIRECT' | 'ASSIGNMENT';
}

export interface UserSummary {
  id: string;
  email?: string | null;
  username?: string | null;
  displayName: string;
  phoneE164: string | null;
  status: 'PENDING_ACTIVATION' | 'ACTIVE' | 'INACTIVE';
  version: number;
  createdAt: string;
  updatedAt: string;
  roles: UserRoleSummary[];
  directRoles: UserRoleSummary[];
  assignmentRoles: UserRoleSummary[];
  effectiveCapabilities: string[];
  audience: 'STAFF' | 'CUSTOMER';
  identityVerification?: {
    status: 'PENDING' | 'ACTION_REQUIRED' | 'APPROVED';
    documents: Array<{
      kind: 'SELFIE' | 'KTP_FRONT';
      status: string;
      uploadStatus: string;
      scanStatus: string;
      rejectionReasonCode: string | null;
      uploadedAt: string | null;
      reviewedAt: string | null;
      updatedAt: string;
    }>;
  };
}

export interface RoleCatalogItem {
  role: ApplicationRole;
  capabilities: string[];
  assignable: boolean;
  readOnly: boolean;
  scope: 'GLOBAL' | 'BRANCH';
}

export interface AuditSummary {
  id: string;
  occurredAt: string;
  action: string;
  actorId: string | null;
  correlationId: string;
  branchId?: string | null;
  targetUserId?: string | null;
  objectType?: string;
  objectId?: string;
  beforeMasked?: unknown;
  afterMasked?: unknown;
  actor?: { id: string; displayName: string } | null;
  target?: { id: string; displayName: string } | null;
  branch?: { id: string; code: string; name: string } | null;
}

export interface UserFilters {
  branchId?: string;
  cursor?: string;
  search?: string;
  status?: 'PENDING_ACTIVATION' | 'ACTIVE' | 'INACTIVE';
  role?: ApplicationRole;
  audience?: 'STAFF' | 'CUSTOMER';
  verificationStatus?: 'PENDING' | 'ACTION_REQUIRED' | 'APPROVED';
}

export interface UserListSummary {
  total: number;
  active: number;
  pendingActivation: number;
  inactive: number;
}

export interface LookupOption {
  id: string;
  label: string;
  description: string;
  metadata: { roles: ApplicationRole[]; branchIds: string[] };
}
export interface AuditExportSummary {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED' | 'EXPIRED';
  requestedAt: string;
  completedAt: string | null;
  expiresAt: string;
  rowCount: number;
  failureCode: string | null;
}

export interface IdentityClient {
  signIn(syntheticEmail?: string): Promise<void>;
  signInWithPassword(email: string, password: string): Promise<void>;
  signInWithGoogleToken(idToken: string, nonce: string): Promise<void>;
  activatePassword(token: string, password: string): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  resetPassword(token: string, password: string): Promise<void>;
  securityStatus(): Promise<{
    passwordEnabled: boolean;
    hasPassword?: boolean;
    passwordChangedAt: string | null;
  }>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  listUsers(filters: UserFilters): Promise<{
    items: UserSummary[];
    page: { nextCursor: string | null; hasMore: boolean };
    summary: UserListSummary;
  }>;
  lookupUsers(filters: {
    q?: string;
    branchId?: string;
    cursor?: string;
    limit?: number;
    instructorsOnly?: boolean;
  }): Promise<{ items: LookupOption[]; page: { nextCursor: string | null; hasMore: boolean } }>;
  createAuditExport(
    command: {
      branchIds: string[];
      from: string;
      to: string;
      actorId?: string;
      objectType?: string;
      format: 'CSV' | 'JSONL';
      reason: string;
    },
    idempotencyKey: string,
  ): Promise<AuditExportSummary>;
  getAuditExport(id: string): Promise<AuditExportSummary>;
  authorizeAuditExport(id: string): Promise<{ url: string; expiresAt: string }>;
  getUser(id: string): Promise<UserSummary>;
  getUserIdentityVerification(id: string): Promise<IdentityVerificationReviewCase>;
  updateProfile(
    id: string,
    input: {
      displayName: string;
      email?: string | null;
      username?: string | null;
      phoneE164: string | null;
      expectedVersion?: number;
      reason?: string;
    },
  ): Promise<UserSummary>;
  roleCatalog(): Promise<RoleCatalogItem[]>;
  listAudit(id: string): Promise<AuditSummary[]>;
  listAuditLogs(filters: {
    actorId?: string;
    targetUserId?: string;
    action?: string;
    branchId?: string;
    correlationId?: string;
    from?: string;
    until?: string;
    cursor?: string;
  }): Promise<{ items: AuditSummary[]; page: { nextCursor: string | null; hasMore: boolean } }>;
  invite(
    email: string,
    displayName: string,
    roles: { role: ApplicationRole; branchId?: string | null }[],
    options?: { phone?: string; password?: string },
  ): Promise<'CREATED' | 'EXISTS'>;
  resetPasswordDirect(id: string, newPassword: string): Promise<void>;
  requestPasswordSetup(id: string, email: string, reason?: string): Promise<void>;
  updateRoles(
    id: string,
    roles: { role: ApplicationRole; branchId?: string | null }[],
    expectedVersion: number | undefined,
    /** Wajib: alasan perubahan role tercatat di audit. */
    reason: string,
  ): Promise<UserSummary>;
  /** Alasan wajib saat menonaktifkan; aktifkan kembali tanpa alasan. */
  deactivate(id: string, expectedVersion: number | undefined, reason: string): Promise<void>;
  reactivate(id: string, expectedVersion?: number, reason?: string): Promise<void>;
}



async function request(path: string, init: RequestInit = {}) {
  const response = await foregroundFetch(
    `/api/v1${path}`,
    {
      ...init,
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        ...init.headers,
      },
    },
    init.method && init.method !== 'GET' ? 'Menyimpan perubahan…' : 'Memuat data…',
  );
  if (!response.ok) {
    const correlationHeader = response.headers.get('x-correlation-id')?.trim();
    let problem:
      | {
          code?: string;
          correlationId?: string;
          retryable?: boolean;
        }
      | undefined;
    try {
      const payload = (await response.json()) as {
        code?: string;
        correlationId?: string;
        retryable?: boolean;
        error?: { code?: string; correlationId?: string; retryable?: boolean };
      };
      problem = payload.error ?? payload;
    } catch {
      problem = undefined;
    }
    throw {
      response,
      code: problem?.code,
      correlationId: problem?.correlationId ?? correlationHeader,
      retryable: problem?.retryable,
    };
  }
  if (response.status === 204) return undefined;
  return response.json();
}

function toIsoString(date: Date | string | null | undefined): string {
  if (!date) return '';
  if (typeof date === 'string') return date;
  return date.toISOString();
}

function mapUser(user: any): UserSummary {
  const mapped = user as any & Partial<UserSummary>;
  const roles = (user.roles ?? []) as UserRoleSummary[];
  return {
    ...user,
    phoneE164: mapped.phoneE164 ?? null,
    createdAt: toIsoString(user.createdAt),
    updatedAt: toIsoString(user.updatedAt),
    roles,
    directRoles: mapped.directRoles ?? roles.filter(({ source }) => source === 'DIRECT'),
    assignmentRoles:
      mapped.assignmentRoles ?? roles.filter(({ source }) => source === 'ASSIGNMENT'),
    effectiveCapabilities: mapped.effectiveCapabilities ?? [],
    audience:
      mapped.audience ??
      (roles.some(({ role }) => role === 'CUSTOMER')
        ? 'CUSTOMER'
        : 'STAFF'),
    identityVerification: user.identityVerification
      ? {
          status: user.identityVerification.status,
          documents: (user.identityVerification.documents ?? []).map((document: any) => ({
            ...document,
            uploadedAt: document.uploadedAt ? toIsoString(document.uploadedAt) : null,
            reviewedAt: document.reviewedAt ? toIsoString(document.reviewedAt) : null,
            updatedAt: toIsoString(document.updatedAt),
          })),
        }
      : undefined,
  };
}

export const browserIdentityClient: IdentityClient = {
  async signIn(syntheticEmail) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.NEXT_PUBLIC_AUTH_SYNTHETIC_ENABLED !== 'true'
    )
      throw { response: { status: 503 } };
    const identity = syntheticEmail?.trim().toLowerCase();
    if (!identity) throw { response: { status: 503 } };
    await request('/auth/google', {
      method: 'POST',
      body: JSON.stringify({
        idToken: identity,
        nonce: crypto.randomUUID(),
        channel: 'WEB',
      }),
    });
  },
  async signInWithPassword(email, password) {
    await request('/auth/password/sessions', {
      method: 'POST',
      body: JSON.stringify({ email, password, channel: 'WEB' }),
    });
  },
  async signInWithGoogleToken(idToken, nonce) {
    await request('/auth/google', {
      method: 'POST',
      body: JSON.stringify({ idToken, nonce, channel: 'WEB' }),
    });
  },
  async lookupUsers(filters) {
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.branchId) params.set('branchId', filters.branchId);
    if (filters.cursor) params.set('cursor', filters.cursor);
    if (filters.limit) params.set('limit', String(filters.limit));
    return request(`/lookups/${filters.instructorsOnly ? 'instructors' : 'users'}?${params}`);
  },
  async createAuditExport(command, idempotencyKey) {
    return request('/audit-exports', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify(command),
    });
  },
  async getAuditExport(id) {
    return request(`/audit-exports/${id}`);
  },
  async authorizeAuditExport(id) {
    return request(`/audit-exports/${id}/download-authorizations`, { method: 'POST' });
  },
  async activatePassword(token, password) {
    await request('/auth/password/activations', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    });
  },
  async requestPasswordReset(email) {
    await request('/auth/password/reset-requests', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },
  async resetPassword(token, password) {
    await request('/auth/password/resets', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    });
  },
  async securityStatus() {
    const res = (await request('/auth/security')) as {
      passwordEnabled?: boolean;
      hasPassword?: boolean;
      passwordChangedAt?: string | null;
    };
    const passwordEnabled = Boolean(res.passwordEnabled ?? res.hasPassword);
    return {
      passwordEnabled,
      hasPassword: passwordEnabled,
      passwordChangedAt: res.passwordChangedAt ?? null,
    };
  },
  async changePassword(currentPassword, newPassword) {
    await request('/auth/password/change', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  },
  async listUsers(filters) {
    const params = new URLSearchParams();
    if (filters.branchId) params.set('branchId', filters.branchId);
    if (filters.cursor) params.set('cursor', filters.cursor);
    if (filters.search) params.set('search', filters.search);
    if (filters.status) params.set('status', filters.status);
    if (filters.role) params.set('role', filters.role);
    if (filters.audience) params.set('audience', filters.audience);
    if (filters.verificationStatus) params.set('verificationStatus', filters.verificationStatus);

    const result = (await request(`/users?${params.toString()}`)) as {
      items: any[];
      page: { nextCursor: string | null; hasMore: boolean };
      summary?: UserListSummary;
    };
    return {
      items: (result.items ?? []).map(mapUser),
      page: {
        nextCursor: result.page?.nextCursor ?? null,
        hasMore: Boolean(result.page?.hasMore),
      },
      summary: result.summary ?? {
        total: (result.items ?? []).length,
        active: (result.items ?? []).filter((item: any) => item.status === 'ACTIVE').length,
        pendingActivation: (result.items ?? []).filter(
          (item: any) => item.status === 'PENDING_ACTIVATION',
        ).length,
        inactive: (result.items ?? []).filter((item: any) => item.status === 'INACTIVE').length,
      },
    };
  },
  async getUser(id) {
    const user = await request(`/users/${encodeURIComponent(id)}`);
    return mapUser(user);
  },
  async getUserIdentityVerification(id) {
    return request(`/users/${id}/identity-verification`);
  },
  async updateProfile(id, input) {
    return mapUser(
      await request(`/users/${encodeURIComponent(id)}/profile`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...input,
          reason: input.reason ?? 'Pembaruan profil via Web Admin',
          expectedVersion: input.expectedVersion ?? 1,
        }),
      }),
    );
  },
  async roleCatalog() {
    const result = (await request('/users/role-catalog')) as { items: RoleCatalogItem[] };
    return result.items ?? [];
  },
  async listAudit(id) {
    const result = (await request(`/users/${encodeURIComponent(id)}/audit`)) as { items: any[] };
    return (result.items ?? []).map((item: any) => ({
      id: item.id,
      occurredAt: item.occurredAt ? new Date(item.occurredAt).toISOString() : '',
      action: item.action,
      actorId: item.actorId ?? null,
      correlationId: item.correlationId,
      branchId: item.branchId ?? null,
      objectType: item.objectType,
      objectId: item.objectId,
      beforeMasked: item.beforeMasked,
      afterMasked: item.afterMasked,
    }));
  },
  async listAuditLogs(filters) {
    const params = new URLSearchParams(
      Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])),
    );
    const result = (await request(`/audit-logs?${params.toString()}`)) as {
      items: Array<AuditSummary & { occurredAt: string }>;
      page: { nextCursor: string | null; hasMore: boolean };
    };
    return result;
  },
  async invite(email, displayName, roles, options = {}) {
    const result = await request('/users', {
      method: 'POST',
      body: JSON.stringify({
        email,
        displayName,
        roleAssignments: roles,
        phone: options.phone,
        password: options.password,
      }),
    });
    return (result as { status: string }).status === 'EXISTS' ? 'EXISTS' : 'CREATED';
  },
  async resetPasswordDirect(id, newPassword) {
    await request(`/users/${encodeURIComponent(id)}/direct-password-reset`, {
      method: 'POST',
      body: JSON.stringify({ newPassword }),
    });
  },
  async requestPasswordSetup(id, email, reason = 'Setup kata sandi') {
    await request(`/users/${encodeURIComponent(id)}/password-setup-requests`, {
      method: 'POST',
      body: JSON.stringify({ email, reason }),
    });
  },
  async updateRoles(id, roles, expectedVersion = 1, reason) {
    try {
      const user = await request(`/users/${encodeURIComponent(id)}/roles`, {
        method: 'POST',
        headers: { 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({
          roles: roles.map((item) => ({ ...item, role: item.role })),
          expectedVersion,
          reason,
        }),
      });
      return mapUser(user);
    } catch (error) {
      const response = (error as { response?: Response }).response;
      if (response?.status === 409) {
        const problem = (await response
          .clone()
          .json()
          .catch(() => ({}))) as { code?: string; error?: { code?: string } };
        throw {
          response,
          code: problem.code ?? problem.error?.code,
        };
      }
      throw error;
    }
  },
  async deactivate(id, expectedVersion = 1, reason) {
    await request(`/users/${encodeURIComponent(id)}/deactivate`, {
      method: 'POST',
      body: JSON.stringify({ reason, expectedVersion }),
    });
  },
  async reactivate(id, expectedVersion = 1, reason) {
    await request(`/users/${encodeURIComponent(id)}/reactivate`, {
      method: 'POST',
      body: JSON.stringify({ ...(reason ? { reason } : {}), expectedVersion }),
    });
  },
};

export const failureCode = (error: unknown): UiFailure => {
  notifySessionFailure(error);
  const status = (error as { response?: { status?: number } })?.response?.status;
  const code = (error as { code?: string })?.code;
  if (code === 'STALE_VERSION') return 'STALE_VERSION';
  if (code === 'AUTHENTICATION_REQUIRED') return 'AUTHENTICATION_REQUIRED';
  if (code === 'CONFIGURATION_REQUIRED') return 'CONFIGURATION_REQUIRED';
  if (code === 'INTERNAL_ERROR') return 'INTERNAL_ERROR';
  if (code === 'NOT_IMPLEMENTED' || status === 501) return 'NOT_IMPLEMENTED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 409) return 'IDENTITY_CONFLICT';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 401) return 'AUTHENTICATION_REQUIRED';
  if (status === 500) return 'INTERNAL_ERROR';
  if (status === 502 || status === 504 || status === undefined) return 'SERVICE_UNAVAILABLE';
  if (status === 503) return 'SERVICE_UNAVAILABLE';
  return 'INTERNAL_ERROR';
};

export const failureReference = (error: unknown): string | null => {
  const reference = (error as { correlationId?: unknown })?.correlationId;
  return typeof reference === 'string' && reference.trim() ? reference.trim().slice(0, 128) : null;
};
