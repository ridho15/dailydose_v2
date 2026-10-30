import { apiFetch } from '../lib/api-client';
import { appLoading } from '../components/app-loading';
import { notifySessionFailure } from './session-client';

export type ClassSlotStatus =
  | 'DRAFT'
  | 'PUBLISHED'
  | 'CONFIRMED'
  | 'AUTO_CANCELLED'
  | 'CANCELLED'
  | 'COMPLETED'
  | string;

export type ClassSlotCancellationReason =
  | 'STUDIO_UNAVAILABLE'
  | 'INSTRUCTOR_UNAVAILABLE'
  | 'SAFETY_ISSUE'
  | 'OTHER_REVIEW_REQUIRED'
  | string;

export interface ClassSlot {
  id: string;
  branchId: string;
  classTypeId: string;
  studioId: string;
  roomId?: string | null;
  instructorUserId?: string | null;
  startAt: Date;
  endAt: Date;
  timezone: string;
  status: ClassSlotStatus;
  minimumQuota: number;
  capacity: number;
  bookedCount: number;
  bookingCutoffHours?: number | null;
  cancellationReasonCode?: ClassSlotCancellationReason | null;
  version: number;
  idempotentReplay?: boolean;
  /** Presensi instruktur yang sudah tercatat (QR atau verifikasi manual); null bila belum. */
  instructorAttendance?: { checkedInAt: Date | string; method: string } | null;
}

export interface InstructorAttendanceResult {
  classSlotId: string;
  checkedInAt: string;
  method: string;
  alreadyRecorded: boolean;
}

export interface CompletionResult {
  classSlotId: string;
  status: 'COMPLETED' | 'CONFIRMED' | string;
  attendanceCount: number;
  noShowCount?: number;
  releasedReservationIds?: Array<string>;
  ledgerEntryIds?: Array<string>;
  idempotentReplay?: boolean;
}

export interface ClassTypeOption {
  id: string;
  code: string;
  name: string;
  branchId?: string;
}

export interface InstructorOption {
  id: string;
  displayName: string;
  branchId?: string;
}

export interface RoomOption {
  id: string;
  studioId: string;
  code: string;
  name: string;
  capacity?: number | null;
}

export interface StudioOption {
  id: string;
  branchId: string;
  code: string;
  name: string;
  rooms: RoomOption[];
}

export interface ClassWorkspace {
  slots: ClassSlot[];
  classTypes: ClassTypeOption[];
  instructors: InstructorOption[];
  studios: StudioOption[];
  nextCursor?: string | null;
}

export interface ClassSlotClient {
  discover(input: {
    branchId?: string;
    branches?: { id: string; timezone: string }[];
    timezone: string;
    from: Date;
    until: Date;
    status?: string;
    /** Hanya jadwalnya: lewati daftar tipe kelas, instruktur, dan studio (peran baca-saja tidak berhak atasnya). */
    slotsOnly?: boolean;
  }): Promise<ClassWorkspace>;
  getBranchStudios?(branchId: string): Promise<StudioOption[]>;
  create(input: {
    branchId: string;
    classTypeId: string;
    studioId: string;
    roomId?: string;
    instructorUserId?: string;
    startAt: Date;
    endAt: Date;
    capacity?: number;
    bookingCutoffHours?: number | null;
  }): Promise<ClassSlot>;
  update(
    id: string,
    input: {
      classTypeId: string;
      studioId?: string;
      roomId?: string | null;
      instructorUserId?: string | null;
      startAt: Date;
      endAt: Date;
      capacity?: number;
      bookingCutoffHours?: number | null;
      /** Opsional: perubahan draf dan penetapan instruktur cukup dijaga status kelas. */
      expectedVersion?: number;
      reason?: string;
    },
  ): Promise<ClassSlot>;
  assign(id: string, instructorUserId: string, expectedVersion?: number): Promise<ClassSlot>;
  publish(id: string, expectedVersion: number): Promise<ClassSlot>;
  cancel(
    id: string,
    reasonCode:
      | 'STUDIO_UNAVAILABLE'
      | 'INSTRUCTOR_UNAVAILABLE'
      | 'SAFETY_ISSUE'
      | 'OTHER_REVIEW_REQUIRED',
    expectedVersion: number,
    /** Wajib bila alasannya "lainnya" (OTHER_REVIEW_REQUIRED). */
    note?: string,
  ): Promise<ClassSlot>;
  completionControl(id: string): Promise<{
    classSlotId: string;
    expectedVersion: number;
    controlHash: string;
    attendanceCount: number;
    noShowCount: number;
    activeReservationCount: number;
  }>;
  complete(
    id: string,
    expectedVersion: number,
    controlHash: string,
    reason: string,
  ): Promise<CompletionResult>;
  verifyInstructorAttendance?(id: string, notes?: string): Promise<InstructorAttendanceResult>;
}

const key = () => crypto.randomUUID();

/**
 * Beberapa akun (mis. INSTRUCTOR) hanya punya `class-slot:read` dan tidak punya
 * `master:read`/`user:read`/`assignment:read`. Panggilan pelengkap ini hanya untuk opsi filter dan
 * form buat kelas, jadi 403 di sini tidak boleh menggagalkan jadwal utama yang sudah berhasil dimuat.
 */
const safeItems = async <T>(promise: Promise<{ items: T[] }>): Promise<{ items: T[] }> => {
  try {
    return await promise;
  } catch {
    return { items: [] };
  }
};

interface InstructorAssignment {
  id: string;
  userId: string;
  branchId: string;
  assignmentType: string;
  status?: string;
  activeFrom: string | Date;
  activeUntil?: string | Date | null;
  user?: { displayName?: string | null } | null;
}

const ASSIGNMENT_PAGE_LIMIT = 100;
const ASSIGNMENT_MAX_PAGES = 5;

/** Penugasan instruktur yang masih berlaku di satu cabang, semua halaman; gagal (mis. tanpa izin) menjadi daftar kosong. */
async function fetchInstructorAssignments(branchId: string): Promise<{ items: InstructorAssignment[] }> {
  const items: InstructorAssignment[] = [];
  let cursor: string | null = null;
  try {
    for (let page = 0; page < ASSIGNMENT_MAX_PAGES; page += 1) {
      const params = new URLSearchParams({
        branchId,
        type: 'INSTRUCTOR',
        status: 'ACTIVE',
        limit: String(ASSIGNMENT_PAGE_LIMIT),
      });
      if (cursor) params.set('cursor', cursor);
      const result: { items: InstructorAssignment[]; page?: { hasMore?: boolean; nextCursor?: string | null } } =
        await apiFetch(`/assignments?${params.toString()}`);
      items.push(...(result.items ?? []));
      cursor = result.page?.hasMore ? (result.page.nextCursor ?? null) : null;
      if (!cursor) break;
    }
  } catch {
    return { items };
  }
  return { items };
}

export const browserClassSlotClient: ClassSlotClient = {
  async discover(input) {
    const scopedBranches = input.branchId
      ? [{ id: input.branchId, timezone: input.timezone }]
      : (input.branches ?? []);

    const params = new URLSearchParams();
    if (input.branchId) params.set('branchId', input.branchId);
    if (input.from) params.set('from', input.from.toISOString());
    if (input.until) params.set('until', input.until.toISOString());
    if (input.status) params.set('status', input.status);
    params.set('limit', '500');

    const [slots, branchWorkspaces] = await appLoading.track(
      Promise.all([
        apiFetch<{ items: ClassSlot[]; page: { nextCursor?: string | null } }>(
          `/class-slots?${params.toString()}`,
          { label: 'Memuat jadwal kelas…' },
        ),
        Promise.all(
          (input.slotsOnly ? [] : scopedBranches).map(async (branch) => {
            const [classTypes, assignments, studios] = await Promise.all([
              safeItems(
                apiFetch<{ items: Array<{ id: string; code: string; name: string; active?: boolean }> }>(
                  `/class-types?branchId=${encodeURIComponent(branch.id)}`,
                ),
              ),
              fetchInstructorAssignments(branch.id),
              safeItems(
                apiFetch<{
                  items: Array<{
                    id: string;
                    branchId: string;
                    code: string;
                    name: string;
                    active?: boolean;
                    rooms?: Array<{
                      id: string;
                      studioId: string;
                      code: string;
                      name: string;
                      capacity?: number | null;
                      capacityBed?: number | null;
                      active?: boolean;
                    }>;
                  }>;
                }>(`/branches/${encodeURIComponent(branch.id)}/studios`),
              ),
            ]);
            return { branch, classTypes, assignments, studios };
          }),
        ),
      ]),
      { label: 'Memuat jadwal kelas…' },
    );

    const branchDate = (value: Date) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: input.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(value);

    const weekStart = branchDate(input.from);
    const weekEnd = branchDate(input.until);

    const classTypeOptions = branchWorkspaces.flatMap(({ branch, classTypes }) =>
      (classTypes.items ?? [])
        .filter((item) => item.active !== false)
        .map(({ id, code, name }) => ({ id, code, name, branchId: branch.id })),
    );

    // Hanya instruktur yang penugasannya berlaku hari ini di cabang itu; bukan seluruh pengguna cabang.
    const today = branchDate(new Date());
    const dayOf = (value: string | Date) => (typeof value === 'string' ? value.slice(0, 10) : branchDate(value));
    const instructorOptions = branchWorkspaces.flatMap(({ branch, assignments }) => {
      const options = (assignments.items ?? [])
        .filter(
          (a) =>
            a.assignmentType === 'INSTRUCTOR' &&
            a.branchId === branch.id &&
            a.status !== 'ENDED' &&
            dayOf(a.activeFrom) <= today &&
            (!a.activeUntil || dayOf(a.activeUntil) >= today),
        )
        .map((a) => ({
          id: a.userId,
          branchId: branch.id,
          displayName: a.user?.displayName?.trim() || `Instruktur ${a.userId.slice(0, 8)}`,
        }));
      return [...new Map(options.map((item) => [item.id, item])).values()].sort((x, y) =>
        x.displayName.localeCompare(y.displayName, 'id'),
      );
    });

    const parsedSlots = (slots.items ?? []).map((slot) => ({
      ...slot,
      startAt: new Date(slot.startAt),
      endAt: new Date(slot.endAt),
    }));

    return {
      slots: parsedSlots,
      nextCursor: slots.page?.nextCursor ?? null,
      classTypes: classTypeOptions,
      instructors: [...new Map(instructorOptions.map((item) => [item.id, item])).values()],
      studios: branchWorkspaces.flatMap(({ branch, studios }) =>
        (studios.items ?? [])
          .filter((studio) => studio.active !== false)
          .map((studio) => ({
            id: studio.id,
            branchId: branch.id,
            code: studio.code,
            name: studio.name,
            rooms: (studio.rooms ?? [])
              .filter((room) => room.active !== false)
              .map((room) => ({
                id: room.id,
                studioId: room.studioId,
                code: room.code,
                name: room.name,
                capacity: room.capacityBed ?? room.capacity ?? null,
              })),
          })),
      ),
    };
  },

  async getBranchStudios(branchId: string) {
    try {
      const res = await apiFetch<{
        items: Array<{
          id: string;
          branchId: string;
          code: string;
          name: string;
          active?: boolean;
          rooms?: Array<{
            id: string;
            studioId: string;
            code: string;
            name: string;
            capacity?: number | null;
            capacityBed?: number | null;
            active?: boolean;
          }>;
        }>;
      }>(`/branches/${encodeURIComponent(branchId)}/studios`, {
        label: 'Memuat area studio…',
      });

      return (res.items ?? [])
        .filter((studio) => studio.active !== false)
        .map((studio) => ({
          id: studio.id,
          branchId: studio.branchId ?? branchId,
          code: studio.code,
          name: studio.name,
          rooms: (studio.rooms ?? [])
            .filter((room) => room.active !== false)
            .map((room) => ({
              id: room.id,
              studioId: room.studioId,
              code: room.code,
              name: room.name,
              capacity: room.capacityBed ?? room.capacity ?? null,
            })),
        }));
    } catch (err) {
      console.error('Gagal memuat studio cabang:', err);
      return [];
    }
  },

  create(input) {
    return apiFetch<ClassSlot>('/class-slots', {
      method: 'POST',
      idempotent: true,
      headers: { 'idempotency-key': key() },
      body: JSON.stringify({
        branchId: input.branchId,
        classTypeId: input.classTypeId,
        studioId: input.studioId,
        roomId: input.roomId,
        instructorUserId: input.instructorUserId,
        startAt: input.startAt.toISOString(),
        endAt: input.endAt.toISOString(),
        capacity: input.capacity,
        bookingCutoffHours: input.bookingCutoffHours,
      }),
      label: 'Membuat kelas…',
    }).then((slot) => ({
      ...slot,
      startAt: new Date(slot.startAt),
      endAt: new Date(slot.endAt),
    }));
  },

  update(id, input) {
    return apiFetch<ClassSlot>(`/class-slots/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      idempotent: true,
      headers: { 'idempotency-key': key() },
      body: JSON.stringify({
        classTypeId: input.classTypeId,
        studioId: input.studioId,
        roomId: input.roomId,
        instructorUserId: input.instructorUserId,
        startAt: input.startAt.toISOString(),
        endAt: input.endAt.toISOString(),
        capacity: input.capacity,
        bookingCutoffHours: input.bookingCutoffHours,
        expectedVersion: input.expectedVersion,
        reason: input.reason,
      }),
      label: 'Menyimpan perubahan kelas…',
    }).then((slot) => ({
      ...slot,
      startAt: new Date(slot.startAt),
      endAt: new Date(slot.endAt),
    }));
  },

  assign(id, instructorUserId, expectedVersion) {
    return apiFetch<ClassSlot>(`/class-slots/${encodeURIComponent(id)}/assign-instructor`, {
      method: 'POST',
      idempotent: true,
      headers: { 'idempotency-key': key() },
      body: JSON.stringify({ instructorUserId, expectedVersion }),
      label: 'Menetapkan instruktur…',
    }).then((slot) => ({
      ...slot,
      startAt: new Date(slot.startAt),
      endAt: new Date(slot.endAt),
    }));
  },

  publish(id, expectedVersion) {
    return apiFetch<ClassSlot>(`/class-slots/${encodeURIComponent(id)}/publish`, {
      method: 'POST',
      idempotent: true,
      headers: { 'idempotency-key': key() },
      body: JSON.stringify({ expectedVersion }),
      label: 'Menerbitkan kelas…',
    }).then((slot) => ({
      ...slot,
      startAt: new Date(slot.startAt),
      endAt: new Date(slot.endAt),
    }));
  },

  cancel(id, reasonCode, expectedVersion, note) {
    return apiFetch<ClassSlot>(`/class-slots/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      idempotent: true,
      headers: { 'idempotency-key': key() },
      body: JSON.stringify({ reasonCode, expectedVersion, ...(note?.trim() ? { note: note.trim() } : {}) }),
      label: 'Membatalkan kelas…',
    }).then((slot) => ({
      ...slot,
      startAt: new Date(slot.startAt),
      endAt: new Date(slot.endAt),
    }));
  },

  completionControl(id) {
    return apiFetch<{
      classSlotId: string;
      expectedVersion: number;
      controlHash: string;
      attendanceCount: number;
      noShowCount: number;
      activeReservationCount: number;
    }>(`/class-slots/${encodeURIComponent(id)}/completion-control`, {
      label: 'Memverifikasi roster kelas…',
    });
  },

  complete(id, expectedVersion, controlHash, reason) {
    return apiFetch<CompletionResult>(`/class-slots/${encodeURIComponent(id)}/complete`, {
      method: 'POST',
      idempotent: true,
      headers: { 'idempotency-key': key() },
      body: JSON.stringify({ expectedVersion, controlHash, reason }),
      label: 'Menyelesaikan kelas…',
    });
  },

  verifyInstructorAttendance(id, notes) {
    return apiFetch<InstructorAttendanceResult>(
      `/class-slots/${encodeURIComponent(id)}/instructor-attendance`,
      {
        method: 'POST',
        body: JSON.stringify({ notes: notes?.trim() || undefined }),
        label: 'Mencatat presensi instruktur…',
      },
    );
  },
};

export function classSlotFailure(error: unknown) {
  notifySessionFailure(error);
  const typed = error as {
    response?: {
      status?: number;
      data?: { code?: string; error?: { code?: string; details?: { issue?: string }[] } };
    };
    status?: number;
    data?: { code?: string; error?: { code?: string; details?: { issue?: string }[] } };
    error?: { code?: string };
    code?: string;
  };
  const status = typed?.response?.status ?? typed?.status;
  const code =
    typed?.response?.data?.error?.code ??
    typed?.response?.data?.code ??
    typed?.data?.error?.code ??
    typed?.data?.code ??
    typed?.error?.code ??
    typed?.code;
  const messages: Record<string, string> = {
    CONFIGURATION_REQUIRED: 'Konfigurasi quota atau capacity belum tersedia untuk waktu tersebut.',
    AVAILABILITY_REQUIRED: 'Availability instructor belum mencakup seluruh waktu kelas.',
    SCHEDULE_CONFLICT: 'Jadwal kelas atau ketersediaan instruktur bertabrakan dengan kelas lain.',
    SLOT_SCHEDULE_COLLISION:
      'Ruangan ini sudah memiliki jadwal kelas lain pada jam yang sama. Silakan pilih ruangan lain atau ubah jam mulai.',
    STUDIO_BRANCH_MISMATCH:
      'Area studio atau ruangan yang dipilih bukan milik cabang ini. Pilih ulang cabang, lalu area studionya.',
    CAPACITY_EXCEEDS_ROOM_LIMIT:
      'Kapasitas peserta melebihi batas maksimal daya tampung ruangan studio.',
    INSTRUCTOR_SCHEDULE_COLLISION:
      'Instruktur yang dipilih sudah memiliki jadwal mengajar di kelas lain pada jam yang sama.',
    STALE_VERSION: 'Data kelas telah diperbarui oleh pengguna lain. Muat ulang sebelum melanjutkan.',
    RESOURCE_NOT_FOUND: 'Data kelas atau ruangan tidak ditemukan pada cabang yang dipilih.',
    INVALID_STATE_TRANSITION: 'Status kelas saat ini tidak mengizinkan tindakan tersebut.',
    INSTRUCTOR_REQUIRED: 'Tetapkan instruktur terlebih dahulu sebelum mempublikasikan kelas.',
    VALIDATION_ERROR: 'Tanggal, waktu, atau pilihan kelas belum valid. Periksa kembali form isian.',
    CHECK_IN_TOO_EARLY: 'Presensi baru dapat dicatat mulai 30 menit sebelum kelas dimulai.',
  };
  // Bentrok jadwal: sebutkan kelas yang menghalangi (bisa di cabang lain) agar staf tahu harus mengubah apa.
  const bentrok =
    typed?.response?.data?.error?.details?.[0]?.issue ?? typed?.data?.error?.details?.[0]?.issue;
  if (bentrok && code === 'INSTRUCTOR_SCHEDULE_COLLISION')
    return `Instruktur ini sudah mengajar kelas lain pada jam yang sama: ${bentrok}. Pilih instruktur lain atau ubah jamnya.`;
  if (bentrok && code === 'SLOT_SCHEDULE_COLLISION')
    return `Ruangan ini sudah dipakai kelas lain pada jam yang sama: ${bentrok}. Pilih ruangan lain atau ubah jamnya.`;
  if (code && messages[code]) return messages[code];
  if (status === 403) return 'Permission yang sesuai diperlukan.';
  if (status === 404) return messages.RESOURCE_NOT_FOUND;
  if (status === 409)
    return 'Jadwal atau versi kelas mengalami konflik. Muat ulang lalu coba lagi.';
  if (status === 503) return messages.CONFIGURATION_REQUIRED;
  if (status === 400 || status === 422) return messages.VALIDATION_ERROR;
  return 'Layanan kelas tidak dapat dijangkau. Periksa koneksi lalu coba lagi.';
}
