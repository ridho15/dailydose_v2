import { apiFetch } from '../lib/api-client';
import { notifySessionFailure } from './session-client';

export interface Studio {
  id: string;
  branchId: string;
  code: string;
  name: string;
  description?: string | null;
  equipmentText?: string | null;
  contactPhoneE164?: string | null;
  imageKey?: string | null;
  active: boolean;
  rooms?: Room[];
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export interface Room {
  id: string;
  studioId: string;
  code: string;
  name: string;
  capacity?: number | null;
  active: boolean;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export type MasterKind = 'INSTRUCTOR_FEE' | 'QUOTA_CAPACITY';

export interface MasterSetting {
  id: string;
  kind: MasterKind;
  businessKey: string;
  branchId: string;
  classTypeId: string;
  value: object;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  version: number;
  /** Nama instruktur pada honor. */
  instructorName?: string;
  /** ID instruktur pada honor. */
  instructorId?: string;
  /** Tarif belum berlaku sehingga masih boleh dihapus. */
  deletable?: boolean;
  /** Nilainya sama dengan versi sebelumnya; menghapusnya tidak mengubah honor. */
  duplikat?: boolean;
}

export interface DampakHapusTarif {
  id: string;
  sudahBerlaku: boolean;
  duplikat: boolean;
  kelasTerdampak: number;
  honorSekarangRp: number;
  honorSetelahHapusRp: number;
}

export interface MasterSettingInput {
  kind: MasterKind;
  branchId: string;
  classTypeId: string;
  instructorUserId?: string;
  value: number;
  capacity?: number;
  effectiveFrom: string;
  reason?: string;
}

export type MasterBranch = {
  id: string;
  code: string;
  name: string;
  timezone: string;
  active: boolean;
  version: number;
};

export type MasterBranchPage = {
  items: MasterBranch[];
  summary: { total: number; active: number; inactive: number };
  page: { hasMore: boolean; nextCursor: string | null };
};

export interface MasterClient {
  listBranches(input?: {
    q?: string;
    status?: 'ACTIVE' | 'INACTIVE';
    cursor?: string;
    limit?: number;
  }): Promise<MasterBranchPage>;
  /** `status` kosong = hanya yang aktif (untuk pilihan di form); `ALL` = aktif + nonaktif; `ARCHIVED` = arsip. */
  listClassTypes(
    branchId?: string,
    status?: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED' | 'ALL',
  ): Promise<
    Array<{
      id: string;
      code: string;
      name: string;
      active: boolean;
      archivedAt?: string | null;
      version: number;
      branchScopes: Array<{ branchId: string; active: boolean; branch?: { name: string } }>;
    }>
  >;
  createBranch(input: {
    code: string;
    name: string;
    timezone: string;
    reason?: string;
  }): Promise<void>;
  createClassType(input: {
    code: string;
    name: string;
    description?: string;
    branchIds?: string[];
  }): Promise<void>;
  listStudios(branchId: string, options?: { includeInactive?: boolean }): Promise<Studio[]>;
  createStudio(
    branchId: string,
    input: {
      code: string;
      name: string;
      equipmentText?: string;
      contactPhoneE164?: string;
      imageKey?: string | null;
    },
  ): Promise<Studio>;
  updateStudio(
    id: string,
    input: {
      name: string;
      equipmentText?: string;
      contactPhoneE164?: string;
      imageKey?: string | null;
      active?: boolean;
      /** Wajib saat menonaktifkan. */
      reason?: string;
    },
  ): Promise<Studio>;
  createRoom(
    studioId: string,
    input: { code: string; name: string; capacity?: number },
  ): Promise<Room>;
  updateRoom(
    id: string,
    input: { name: string; capacity?: number; active?: boolean; reason?: string },
  ): Promise<Room>;
  replaceClassTypeScopes(
    id: string,
    input: { branchIds: string[]; expectedVersion: number; reason: string },
  ): Promise<void>;
  updateClassType(
    id: string,
    input: { name: string; expectedVersion: number; reason?: string },
  ): Promise<void>;
  deactivateBranch(id: string, expectedVersion: number): Promise<void>;
  deactivateClassType(id: string, expectedVersion: number, reason: string): Promise<void>;
  reactivateClassType(
    id: string,
    input: { expectedVersion: number; reason?: string },
  ): Promise<void>;
  listSettings(kind: MasterKind, branchId?: string): Promise<MasterSetting[]>;
  createSetting(input: MasterSettingInput): Promise<void>;
  deleteSetting(
    kind: 'INSTRUCTOR_FEE',
    id: string,
    reason: string,
    salahInput?: boolean,
  ): Promise<void>;
  /** Kelas dan honor yang berubah bila versi tarif dihapus. */
  dampakHapusTarif?(id: string): Promise<DampakHapusTarif>;
}

const date = (value?: string) => (value ? new Date(`${value}T00:00:00Z`) : undefined);

export const browserMasterClient: MasterClient = {
  async listBranches(input = {}) {
    const params = new URLSearchParams();
    if (input.q) params.set('q', input.q);
    if (input.status) params.set('status', input.status);
    if (input.cursor) params.set('cursor', input.cursor);
    if (input.limit) params.set('limit', String(input.limit));
    const qs = params.toString();

    const result = await apiFetch<MasterBranchPage>(`/branches${qs ? `?${qs}` : ''}`, {
      label: 'Memuat cabang…',
    });
    return {
      items: result.items ?? [],
      summary: result.summary ?? { total: 0, active: 0, inactive: 0 },
      page: {
        hasMore: result.page?.hasMore ?? false,
        nextCursor: result.page?.nextCursor ?? null,
      },
    };
  },

  async listClassTypes(branchId, status) {
    const query = new URLSearchParams();
    if (branchId) query.set('branchId', branchId);
    if (status) query.set('status', status);
    const qs = query.size ? `?${query}` : '';
    const res = await apiFetch<{ items: Array<{
      id: string;
      code: string;
      name: string;
      active: boolean;
      archivedAt?: string | null;
      version: number;
      branchScopes: Array<{ branchId: string; active: boolean; branch?: { name: string } }>;
    }> }>(`/class-types${qs}`, {
      label: 'Memuat tipe kelas…',
    });
    return res.items ?? [];
  },

  async createBranch(input) {
    await apiFetch('/branches', {
      method: 'POST',
      idempotent: true,
      label: 'Membuat cabang…',
      body: JSON.stringify({
        ...input,
        reason: input.reason ?? 'Membuat cabang melalui Master Data.',
      }),
    });
  },

  async createClassType(input) {
    await apiFetch('/class-types', {
      method: 'POST',
      label: 'Membuat tipe kelas…',
      body: JSON.stringify({
        code: input.code,
        name: input.name,
        description: input.description,
        branchIds: input.branchIds,
      }),
    });
  },

  async listStudios(branchId, options) {
    const query = options?.includeInactive ? '?includeInactive=true' : '';
    const res = await apiFetch<{ items: Array<Record<string, any>> }>(
      `/branches/${encodeURIComponent(branchId)}/studios${query}`,
      { label: 'Memuat area studio…' },
    );
    // API memakai `description`/`capacityBed`; tampilan memakai `equipmentText`/`capacity`.
    return (res.items ?? []).map(
      (studio) =>
        ({
          ...studio,
          equipmentText: studio.equipmentText ?? studio.description ?? null,
          rooms: (studio.rooms ?? []).map((room: Record<string, any>) => ({
            ...room,
            capacity: room.capacity ?? room.capacityBed ?? null,
          })),
        }) as Studio,
    );
  },

  createStudio(branchId, input) {
    return apiFetch<Studio>(`/branches/${encodeURIComponent(branchId)}/studios`, {
      method: 'POST',
      label: 'Menyimpan area studio…',
      body: JSON.stringify(input),
    });
  },

  updateStudio(id, input) {
    return apiFetch<Studio>(`/studios/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      label: 'Memperbarui area studio…',
      body: JSON.stringify(input),
    });
  },

  createRoom(studioId, input) {
    return apiFetch<Room>(`/studios/${encodeURIComponent(studioId)}/rooms`, {
      method: 'POST',
      label: 'Menyimpan ruangan…',
      body: JSON.stringify(input),
    });
  },

  updateRoom(id, input) {
    return apiFetch<Room>(`/rooms/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      label: 'Memperbarui ruangan…',
      body: JSON.stringify(input),
    });
  },

  async replaceClassTypeScopes(id, input) {
    await apiFetch(`/class-types/${encodeURIComponent(id)}/scopes`, {
      method: 'PUT',
      label: 'Memperbarui cakupan tipe kelas…',
      body: JSON.stringify(input),
    });
  },

  async updateClassType(id, input) {
    await apiFetch(`/class-types/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      idempotent: true,
      label: 'Memperbarui tipe kelas…',
      body: JSON.stringify(input),
    });
  },

  async deactivateBranch(id, expectedVersion) {
    await apiFetch(`/branches/${encodeURIComponent(id)}/deactivate`, {
      method: 'POST',
      idempotent: true,
      label: 'Menonaktifkan cabang…',
      body: JSON.stringify({
        expectedVersion,
        reason: 'Menonaktifkan cabang melalui Master Data.',
      }),
    });
  },

  async deactivateClassType(id, expectedVersion, reason) {
    await apiFetch(`/class-types/${encodeURIComponent(id)}/deactivate`, {
      method: 'POST',
      idempotent: true,
      label: 'Menonaktifkan tipe kelas…',
      body: JSON.stringify({
        expectedVersion,
        reason,
      }),
    });
  },

  async reactivateClassType(id, input) {
    await apiFetch(`/class-types/${encodeURIComponent(id)}/reactivate`, {
      method: 'POST',
      idempotent: true,
      label: 'Mengaktifkan tipe kelas…',
      body: JSON.stringify(input),
    });
  },

  async listSettings(kind, branchId) {
    const qs = branchId ? `?branchId=${encodeURIComponent(branchId)}` : '';
    // API mengirim bentuk per jenis; tampilan memakai bentuk seragam `MasterSetting`.
    const asDate = (value: unknown) => (value ? new Date(`${String(value).slice(0, 10)}T00:00:00Z`) : new Date(0));
    if (kind === 'INSTRUCTOR_FEE') {
      const res = await apiFetch<{ items: Array<Record<string, any>> }>(`/instructor-fees${qs}`, {
        label: 'Memuat honor instruktur…',
      });
      return (res.items ?? []).map((row) => ({
        id: row.id,
        kind,
        businessKey: row.id,
        branchId: row.branchId,
        classTypeId: row.classTypeId,
        value: { feeRp: row.feePerJamRp },
        effectiveFrom: asDate(row.effectiveDate),
        effectiveUntil: null,
        version: 1,
        instructorName: row.instructorName,
        instructorId: row.instructorId,
        deletable: Boolean(row.deletable),
        duplikat: Boolean(row.duplikat),
      }));
    }
    const res = await apiFetch<{ items: Array<Record<string, any>> }>(`/quota-capacity-settings${qs}`, {
      label: 'Memuat kuota dan kapasitas…',
    });
    return (res.items ?? []).map((row) => ({
      id: row.id,
      kind,
      businessKey: row.id,
      branchId: row.branchId,
      classTypeId: row.classTypeId,
      value: {
        minimumQuota: row.minimumQuota,
        cutoffHours: row.cutoffHours,
        defaultCapacity: row.defaultCapacity ?? undefined,
      },
      effectiveFrom: asDate(row.createdAt),
      effectiveUntil: null,
      version: 1,
    }));
  },

  async deleteSetting(kind, id, reason, salahInput) {
    await apiFetch(`/instructor-fees/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      label: 'Menghapus tarif…',
      body: JSON.stringify(salahInput ? { reason, salahInput: true } : { reason }),
    });
  },

  dampakHapusTarif(id) {
    return apiFetch<DampakHapusTarif>(`/instructor-fees/${encodeURIComponent(id)}/impact`, {
      label: 'Menghitung dampak…',
    });
  },

  async createSetting(input) {
    const period = { effectiveFrom: date(input.effectiveFrom)!.toISOString() };

    if (input.kind === 'INSTRUCTOR_FEE') {
      await apiFetch('/instructor-fees', {
        method: 'POST',
        label: 'Menyimpan honor instruktur…',
        body: JSON.stringify({
          ...period,
          kind: 'INSTRUCTOR_FEE',
          branchId: input.branchId,
          classTypeId: input.classTypeId,
          instructorUserId: input.instructorUserId!,
          feeRp: input.value,
          reason: input.reason,
        }),
      });
    } else {
      await apiFetch('/quota-capacity-settings', {
        method: 'POST',
        label: 'Menyimpan kuota dan kapasitas…',
        body: JSON.stringify({
          ...period,
          kind: 'QUOTA_CAPACITY',
          branchId: input.branchId,
          classTypeId: input.classTypeId,
          minimumQuota: input.value,
          defaultCapacity: input.capacity!,
          reason: input.reason,
        }),
      });
    }
  },
};

export function masterFailure(error: unknown): string {
  notifySessionFailure(error);
  const status = (error as { status?: number; response?: { status?: number } })?.status ??
    (error as { response?: { status?: number } })?.response?.status;
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'RESOURCE_NOT_FOUND';
  if (status === 409) return 'EFFECTIVE_PERIOD_OVERLAP_OR_STALE_VERSION';
  if (status === 422 || status === 400) return 'VALIDATION_ERROR';
  if (status === 503) return 'CONFIGURATION_REQUIRED';
  return 'REQUEST_FAILED';
}

const masterMessages: Record<string, string> = {
  HAS_UPCOMING_SLOTS:
    'Masih ada kelas terjadwal yang memakai area atau ruangan ini. Batalkan atau pindahkan kelasnya terlebih dahulu.',
  RATE_IN_EFFECT:
    'Tarif yang sedang berlaku tidak dapat dihapus. Koreksi dengan menambahkan tarif baru.',
  FORBIDDEN: 'Anda tidak memiliki izin untuk tindakan ini.',
  RESOURCE_NOT_FOUND: 'Data tidak ditemukan atau berada di luar cakupan Anda.',
  EFFECTIVE_PERIOD_OVERLAP_OR_STALE_VERSION:
    'Data berubah atau periode berlaku bertabrakan. Muat ulang lalu coba lagi.',
  VALIDATION_ERROR: 'Data belum valid. Periksa isian lalu coba lagi.',
  CONFIGURATION_REQUIRED: 'Fitur ini belum dikonfigurasi di server.',
  CANNOT_DELETE_BRANCH_WITH_DEPENDENCIES:
    'Cabang tidak dapat dihapus karena masih memiliki data terkait. Gunakan fitur Nonaktifkan untuk mengarsipkan cabang.',
  CANNOT_DELETE_STUDIO_WITH_DEPENDENCIES:
    'Studio tidak dapat dihapus karena masih memiliki data terkait. Gunakan fitur Nonaktifkan untuk mengarsipkan studio.',
  CANNOT_DELETE_ROOM_WITH_DEPENDENCIES:
    'Ruangan tidak dapat dihapus karena masih memiliki data terkait. Gunakan fitur Nonaktifkan untuk mengarsipkan ruangan.',
  CANNOT_DELETE_CLASS_TYPE_WITH_DEPENDENCIES:
    'Tipe kelas tidak dapat dihapus karena masih memiliki data terkait. Gunakan fitur Nonaktifkan untuk mengarsipkan tipe kelas.',
  REQUEST_FAILED: 'Permintaan gagal. Periksa koneksi lalu coba lagi.',
};

/** Pesan Indonesia untuk pengguna; pesan rinci dari server (mis. rincian dependensi) diprioritaskan. */
export function masterFailureMessage(error: unknown): string {
  const data = (error as {
    data?: {
      code?: string;
      details?: Array<{ issue?: string }>;
      error?: { code?: string; details?: Array<{ issue?: string }> };
    };
  })?.data;
  const issue = data?.details?.[0]?.issue ?? data?.error?.details?.[0]?.issue;
  if (issue) return issue;

  const code = data?.code ?? data?.error?.code;
  if (code && masterMessages[code]) return masterMessages[code]!;
  const generic = masterFailure(error);
  return masterMessages[generic] ?? masterMessages.REQUEST_FAILED!;
}
