import { foregroundFetch } from '../components/app-loading';
import { ApiError, parseApiError } from '../lib/api-client';
import { notifySessionFailure } from './session-client';

export type AccessScope = 'GLOBAL' | 'BRANCH';
export type OverrideEffect = 'GRANT' | 'DENY';

export interface CapabilityDefinition {
  key: string;
  label: string;
  description: string;
  category: string;
  sensitive: boolean;
  active: boolean;
  systemOnly: boolean;
  globalOnly: boolean;
}

export interface AccessRole {
  id: string;
  code: string;
  displayName: string;
  description: string;
  scope: AccessScope;
  systemRole: string | null;
  system: boolean;
  protected: boolean;
  active: boolean;
  version: number;
  affectedUsers: number;
  capabilities: Array<
    Pick<
      CapabilityDefinition,
      'key' | 'label' | 'category' | 'sensitive' | 'systemOnly' | 'globalOnly'
    >
  >;
  createdAt: string;
  updatedAt: string;
}

export interface UserAccess {
  user: {
    id: string;
    displayName: string;
    status: 'PENDING_ACTIVATION' | 'ACTIVE' | 'INACTIVE';
    version: number;
  };
  roleAssignments: Array<{
    id: string;
    roleId: string | null;
    roleCode: string;
    displayName: string;
    scope: AccessScope;
    branchId: string | null;
    branch: { id: string; code: string; name: string } | null;
    source: 'DIRECT' | 'ASSIGNMENT';
  }>;
  overrides: Array<{
    id: string;
    capabilityKey: string;
    capabilityLabel: string;
    effect: OverrideEffect;
    branchId: string | null;
    branch: { id: string; code: string; name: string } | null;
    reasonCode: string;
    version: number;
    createdAt: string;
  }>;
  effective: {
    capabilities: string[];
    branches: string[];
    grants: Array<{
      capability: string;
      branchId: string | null;
      source: 'SYSTEM_ROLE' | 'CUSTOM_ROLE' | 'USER_OVERRIDE';
      sourceId: string;
    }>;
    denials: Array<{ capability: string; branchId: string | null; sourceId: string }>;
  };
}

export interface AccessMutationReason {
  reasonCode: string;
  note?: string;
}

export interface AccessClient {
  listCapabilities(filters?: {
    q?: string;
    category?: string;
    sensitive?: boolean;
    active?: boolean;
  }): Promise<CapabilityDefinition[]>;
  listRoles(filters?: { q?: string; scope?: AccessScope; active?: boolean }): Promise<AccessRole[]>;
  getUserAccess(userId: string): Promise<UserAccess>;
  replaceUserRoles(
    userId: string,
    input: {
      roles: Array<{ roleId: string; branchId?: string | null }>;
      expectedVersion: number;
    } & AccessMutationReason,
    idempotencyKey: string,
  ): Promise<void>;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
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
    init.method && init.method !== 'GET' ? 'Menyimpan pengaturan akses…' : 'Memuat akses…',
  );
  if (!response.ok) {
    const problem = (await response.json().catch(() => undefined)) as Record<string, unknown> | undefined;
    const errObj =
      problem?.error && typeof problem.error === 'object'
        ? (problem.error as Record<string, unknown>)
        : null;
    const code =
      (typeof errObj?.code === 'string' ? errObj.code : undefined) ??
      (typeof problem?.code === 'string' ? problem.code : undefined);
    const message =
      (typeof errObj?.message === 'string' ? errObj.message : undefined) ??
      (typeof problem?.message === 'string' ? problem.message : undefined) ??
      `Request failed with status ${response.status}`;

    const error = new ApiError(message, response.status, problem, code);
    (error as any).response = { status: response.status, data: problem };
    notifySessionFailure(error);
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function query(filters: Record<string, string | boolean | undefined>) {
  const values = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== '') values.set(key, String(value));
  });
  const serialized = values.toString();
  return serialized ? `?${serialized}` : '';
}

function mutation<T>(path: string, method: 'POST' | 'PUT' | 'PATCH', body: unknown, key: string) {
  return request<T>(path, {
    method,
    headers: { 'idempotency-key': key },
    body: JSON.stringify(body),
  });
}

export const browserAccessClient: AccessClient = {
  async listCapabilities(filters = {}) {
    return (
      await request<{ items: CapabilityDefinition[] }>(`/access/capabilities${query(filters)}`)
    ).items;
  },
  async listRoles(filters = {}) {
    return (await request<{ items: AccessRole[] }>(`/access/roles${query(filters)}`)).items;
  },
  getUserAccess(userId) {
    return request(`/users/${userId}/access`);
  },
  replaceUserRoles(userId, input, key) {
    return mutation(`/users/${userId}/access/roles`, 'PUT', input, key);
  },
};

export function accessFailureCode(error: unknown): string {
  notifySessionFailure(error);
  const parsed = parseApiError(error);
  if (parsed.code) return parsed.code;
  if (parsed.status === 403) return 'FORBIDDEN';
  if (parsed.status === 409) return 'ROLE_CODE_CONFLICT';
  if (parsed.status === 404) return 'NOT_FOUND';
  return 'REQUEST_FAILED';
}
