async function get<T>(path: string): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { credentials: 'include' });
  if (!response.ok) throw new Error('REQUEST_FAILED');
  return response.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw errorData;
  }
  return response.json() as Promise<T>;
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw errorData;
  }
  return response.json() as Promise<T>;
}

export interface InstructorSummary {
  id: string;
  displayName: string;
  email: string | null;
  phoneE164: string | null;
  status: string;
  assignments: Array<{ id: string; branch: { id: string; code: string; name: string } }>;
  /** Honor kelas selesai bulan berjalan; null bila peran tidak berhak melihat nominal. */
  compensationRp: number | null;
  unverifiedCompensationRp?: number | null;
  compensationPeriod?: string;
  _count: {
    instructedClassSlots: number;
    instructorAttendances: number;
    instructorHourLogs: number;
  };
}

export interface InstructorDetail {
  id: string;
  displayName: string;
  email: string | null;
  phoneE164: string | null;
  status: string;
  version: number;
  assignments: Array<{
    id: string;
    branch: { id: string; code: string; name: string };
    activeFrom: string;
    activeUntil: string | null;
  }>;
  profile?: {
    address: string | null;
    gender: string | null;
    birthDate: string | null;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
    bankInfo: {
      bankName: string;
      accountNumber: string;
      accountHolder: string;
    };
    notes: string;
  } | null;
  instructedClassSlots: Array<{
    id: string;
    startAt: string;
    endAt: string;
    status: string;
    classType: { code: string; name: string };
    branch: { id: string; name: string };
    instructorHourLog?: { amountRp: number } | null;
  }>;
  instructorAvailabilities: unknown[];
  instructorAttendances: unknown[];
  instructorHourLogs: unknown[];
  compensationRp: number | null;
  unverifiedCompensationRp?: number | null;
  compensationPeriod?: string;
  blockers: { completedWithoutCheckIn: number; completedWithoutFee: number };
}

export const instructorClient = {
  list(input: { q?: string; branchId?: string; cursor?: string }) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(input)) if (value) params.set(key, value);
    return get<{
      items: InstructorSummary[];
      summary: { total: number };
      page: { hasMore: boolean; nextCursor: string | null };
    }>(`/instructors?${params}`);
  },
  detail(id: string) {
    return get<InstructorDetail>(`/instructors/${encodeURIComponent(id)}`);
  },
  async create(input: {
    email: string;
    displayName: string;
    phoneE164?: string;
    password?: string;
    branchIds?: string[];
  }) {
    const createdUser = await post<{ id: string; status: string }>('/users', {
      email: input.email.trim().toLowerCase(),
      displayName: input.displayName.trim(),
      password: input.password?.trim() || undefined,
      roles: ['INSTRUCTOR'],
      branchIds: input.branchIds ?? [],
      roleAssignments: (input.branchIds ?? []).map((branchId) => ({
        role: 'INSTRUCTOR',
        branchId,
      })),
    });

    // If phone number is specified, update user profile
    if (input.phoneE164?.trim()) {
      try {
        await patch(`/users/${encodeURIComponent(createdUser.id)}/profile`, {
          displayName: input.displayName.trim(),
          phoneE164: input.phoneE164.trim(),
          expectedVersion: 1,
          reason: 'Setup profil instruktur awal',
        });
      } catch {
        // profile creation was optional, ignore if fails
      }
    }

    // If branchIds specified, ensure assignments exist
    if (input.branchIds?.length) {
      for (const branchId of input.branchIds) {
        try {
          await post('/assignments', {
            userId: createdUser.id,
            branchId,
            assignmentType: 'INSTRUCTOR',
            activeFrom: new Date().toISOString(),
            reason: 'Penugasan cabang awal instruktur',
          });
        } catch {
          // assignment creation may already be handled or optional
        }
      }
    }

    return createdUser;
  },
  updateProfile(
    id: string,
    input: {
      displayName: string;
      email?: string | null;
      phoneE164?: string | null;
      branchIds?: string[];
      bankInfo?: {
        bankName?: string | null;
        accountNumber?: string | null;
        accountHolder?: string | null;
      };
      notes?: string | null;
      address?: string | null;
      gender?: string | null;
      birthDate?: string | null;
      emergencyContactName?: string | null;
      emergencyContactPhone?: string | null;
      expectedVersion?: number;
      reason?: string;
    },
  ) {
    return patch<Record<string, unknown>>(`/instructors/${encodeURIComponent(id)}/profile`, {
      ...input,
      displayName: input.displayName.trim(),
      email: input.email ? input.email.trim() : null,
      phoneE164: input.phoneE164 ? input.phoneE164.trim() : null,
      expectedVersion: input.expectedVersion ?? 1,
      reason: input.reason ?? 'Pembaruan profil instruktur',
    });
  },
  toggleStatus(
    id: string,
    action: 'deactivate' | 'reactivate',
    expectedVersion?: number,
    reason?: string,
  ) {
    return post<Record<string, unknown>>(`/users/${encodeURIComponent(id)}/${action}`, {
      reason:
        reason ??
        (action === 'deactivate'
          ? 'Menonaktifkan akun instruktur'
          : 'Mengaktifkan kembali akun instruktur'),
      expectedVersion: expectedVersion ?? 1,
    });
  },
};
