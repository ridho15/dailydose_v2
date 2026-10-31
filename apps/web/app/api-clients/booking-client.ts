import { apiFetch } from '../lib/api-client';
import { foregroundFetch } from '../components/app-loading';
import { notifySessionFailure } from './session-client';
import type { ClassSlot } from './class-slot-client';

export type { ClassSlot };

export interface WalkInCommand {
  branchId: string;
  classSlotId: string;
  customerUserId: string;
  packageId: string;
  paymentMethod: 'CASH' | 'CARD' | 'QRIS' | 'BANK_TRANSFER' | 'MANUAL_STAFF';
  paymentNote?: string;
}

export interface WalkInResult {
  booking: Booking;
  purchase: {
    id: string;
    invoiceNumber: string;
    status: string;
    totalAmountRp: number;
    paymentMethod: string;
  };
  customerPackage: {
    id: string;
    totalSessions: number;
    remainingSessions: number;
    validUntil: string;
  };
}

export interface BookingCommand {
  classSlotId: string;
  customerPackageId: string;
  customerUserId?: string;
  source: 'SELF' | 'ADMIN_ASSISTED';
}

export interface BookingSlotSummary {
  id: string;
  startAt: Date;
  endAt: Date;
  timezone: string;
  status?: string;
  classType: { id: string; name: string };
  capacity?: number;
  bookedCount?: number;
  available?: number;
  instructor?: { id?: string; displayName: string } | null;
  studio?: { id?: string; name: string } | null;
}

export interface BookingPackageSummary {
  id: string;
  name: string;
  totalSessions?: number;
  remainingSessions?: number;
}

export interface BookingAttendanceSummary {
  id?: string;
  checkedInAt: Date;
  source?: 'QR' | 'BACKFILL' | string;
  status?: string;
}

export interface Booking {
  id: string;
  bookingNumber?: string;
  branchId: string;
  classSlotId: string;
  customerUserId: string;
  customerPackageId: string;
  status: 'BOOKED' | 'ATTENDED' | 'CANCELLED' | 'NO_SHOW' | string;
  reservedQuantity: number;
  source: 'SELF' | 'ADMIN_ASSISTED' | string;
  cancellationReasonCode?: string | null;
  cancelledAt?: Date | null;
  cancelledById?: string | null;
  createdAt: Date;
  version: number;
  idempotentReplay?: boolean;
  branch?: { id: string; name: string; timezone: string } | null;
  classSlot?: BookingSlotSummary | null;
  package?: BookingPackageSummary | null;
  attendance?: BookingAttendanceSummary | null;
  customer?: { id: string; displayName: string; phoneMasked: string | null } | null;
}

export interface CustomerPackageBalance {
  id: string;
  packageId?: string;
  customerUserId?: string;
  customer?: { id: string; displayName: string; phoneMasked?: string | null } | null;
  branchId?: string | null;
  branchName?: string | null;
  classTypeId?: string | null;
  classTypeName?: string | null;
  /** Cabang tempat paket boleh dipakai (cabang paket dan cabang pembelian), atau 'SEMUA'. */
  allowedBranchIds?: string[] | 'SEMUA';
  status: string;
  totalSessions?: number;
  remainingSessions?: number;
  available: number;
  reserved?: number;
  expiryAt: Date;
  packageName?: string;
  name?: string;
  isShareable?: boolean;
  sharedWithUserIds?: string[];
  sharedMembers?: Array<{
    id: string;
    userId: string;
    relationship?: string;
    displayName?: string;
    phoneMasked?: string | null;
    email?: string;
    addedById?: string | null;
    addedByRole?: string;
    createdAt?: string;
  }>;
}

/** Pengajuan pembatalan booking setelah batas H-24, menunggu Manager/Owner. */
export interface PengajuanPembatalan {
  id: string;
  version: number;
  bookingId: string;
  /** Sesi yang kembali ke paket bila disetujui; 0 bila sesinya belum terpotong. */
  sessionCount: number;
  reason: string;
  requestedById: string;
  requestedByName: string | null;
  createdAt: string;
}

export interface Reschedule {
  id: string;
  bookingId: string;
  sourceClassSlotId: string;
  targetClassSlotId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | string;
  requestReasonCode: string;
  decisionReasonCode?: string | null;
  decisionNote?: string | null;
  requestedAt: Date;
  decidedAt?: Date | null;
  decidedById?: string | null;
  version: number;
  sourceClassSlot?: any;
  targetClassSlot?: any;
}

export interface RescheduleRequestCommand {
  bookingId: string;
  targetClassSlotId: string;
  reasonCode: 'MEDICAL_EMERGENCY' | 'FAMILY_EMERGENCY' | 'SCHEDULE_CONFLICT' | 'CUSTOMER_REQUEST' | string;
  expectedBookingVersion: number;
}

export interface RescheduleDecisionCommand {
  reasonCode: 'ELIGIBILITY_VERIFIED' | 'TARGET_UNAVAILABLE' | 'OUTSIDE_POLICY' | 'OUT_OF_SCOPE' | string;
  expectedVersion: number;
  note?: string;
}

export type BookingCustomer = {
  id: string;
  displayName: string;
  phoneMasked?: string;
  eligiblePackageCount?: number;
};

export type BookingDiscovery = {
  customers: BookingCustomer[];
  packages: CustomerPackageBalance[];
  slots: ClassSlot[];
};

export type BookingPage = {
  items: CustomerBookingRecord[];
  summary?: {
    total: number;
    booked: number;
    reschedulePending: number;
    attended: number;
    cancelled: number;
    noShow: number;
  };
  total?: number;
  totalPages?: number;
  currentPage?: number;
  pageSize?: number;
  nextCursor?: string | null;
};

export type BookingListFilters = {
  tab?: 'bookings' | 'reschedules' | 'attendance';
  q?: string;
  status?: string;
  from?: string;
  until?: string;
  branch?: string;
  cursor?: string;
  page?: number;
  pageSize?: number;
};

export type BookingRosterItem = CustomerBookingRecord;
export type BookingRosterPage = BookingPage;
export type BookingRosterSummary = NonNullable<BookingPage['summary']>;
export type ClassSlotRoster = BookingPage;
export type ClassSlotRosterSummary = BookingRosterSummary & {
  active: number;
  capacity: number;
  availableCapacity: number;
};
export type BulkCheckInIssueResult = Awaited<
  ReturnType<NonNullable<BookingClient['issueBulkCheckIns']>>
>;

export type CustomerBookingRecord = Omit<
  Booking,
  'branch' | 'classSlot' | 'package' | 'attendance'
> & {
  branch?: { id: string; name: string; timezone: string };
  classSlot?: {
    id: string;
    startAt: Date;
    endAt: Date;
    timezone: string;
    status: string;
    classType: { id: string; name: string };
    capacity?: number;
    bookedCount?: number;
    available?: number;
    instructor?: { id?: string; displayName: string } | null;
    studio?: { id?: string; name: string } | null;
  };
  package?: { id: string; name: string };
  attendance?: { checkedInAt: Date; source: 'QR' | 'BACKFILL' };
  customer?: { id: string; displayName: string; phoneMasked: string | null };
  createdBy?: { id: string; displayName: string };
  sessionBalance?: { ledgerBalance: number; reserved: number; available: number };
  reschedules?: Array<{
    id: string;
    status: string;
    requestReasonCode: string;
    decisionReasonCode: string | null;
    requestedAt: Date;
    decidedAt: Date | null;
    version: number;
    sourceClassSlot: {
      id: string;
      startAt: Date;
      endAt: Date;
      timezone: string;
    };
    targetClassSlot: {
      id: string;
      startAt: Date;
      endAt: Date;
      timezone: string;
    };
  }>;
  checkInToken?: {
    id: string;
    status: 'ACTIVE' | 'USED' | 'REVOKED';
    notBeforeAt: Date;
    expiresAt: Date;
    usedAt: Date | null;
    revokedAt: Date | null;
    version: number;
  } | null;
};

export type CustomerBookingOptions = {
  slot: {
    id: string;
    branchId: string;
    classTypeId: string;
    startAt: Date;
    endAt: Date;
    timezone: string;
    status: 'DRAFT' | 'PUBLISHED' | 'CONFIRMED' | 'AUTO_CANCELLED' | 'CANCELLED' | 'COMPLETED';
    capacity: number;
    bookedCount: number;
    available: number;
    branch: {
      id: string;
      code: string;
      name: string;
      timezone: string;
      address?: string | null;
      supportWhatsappE164?: string | null;
    };
    classType: {
      id: string;
      code: string;
      name: string;
      modality?: string | null;
      description?: string | null;
      durationMinutes?: number | null;
    };
    instructor?: { displayName: string } | null;
    studio?: { name: string } | null;
    room?: { name: string } | null;
  };
  packages: Array<{
    id: string;
    packageId: string;
    name: string;
    available: number;
    projectedAvailable: number;
    expiryAt: Date;
  }>;
  eligibility: {
    canBook: boolean;
    reasonCode:
      | 'IDENTITY_VERIFICATION_REQUIRED'
      | 'MATCHING_PACKAGE_REQUIRED'
      | 'INSUFFICIENT_AVAILABLE_SESSION'
      | 'SLOT_FULL'
      | 'SLOT_UNAVAILABLE'
      | 'BOOKING_CUTOFF_PASSED'
      | null;
    requiredAction:
      'COMPLETE_IDENTITY_VERIFICATION' | 'BUY_MATCHING_PACKAGE' | 'CONTACT_STUDIO' | null;
    cutoffAt: Date;
  };
};

export type ReschedulePage = {
  items: ManagementReschedule[];
  nextCursor?: string | null;
};

export type ManagementReschedule = Reschedule & {
  branch?: { id: string; name: string; timezone: string };
  customer?: { id: string; displayName: string; phoneMasked: string | null };
  package?: { id: string; name: string };
  sourceClassSlot?: {
    id: string;
    startAt: Date;
    endAt: Date;
    timezone: string;
    capacity: number;
    bookedCount: number;
    classType: { id: string; name: string };
  };
  targetClassSlot?: {
    id: string;
    startAt: Date;
    endAt: Date;
    timezone: string;
    capacity: number;
    bookedCount: number;
    classType: { id: string; name: string };
  };
};

export type CustomerRescheduleOptions = {
  bookingId: string;
  bookingVersion: number;
  sourceClassSlotId: string;
  cutoffAt: Date;
  canRequest: boolean;
  unavailableReason:
    | 'NO_ELIGIBLE_TARGET'
    | 'RESCHEDULE_PENDING'
    | 'BOOKING_NOT_ACTIVE'
    | 'RESCHEDULE_CUTOFF_PASSED'
    | 'PACKAGE_INELIGIBLE'
    | null;
  supportAction: 'CONTACT_STUDIO' | null;
  latestRequest: Reschedule | null;
  targets: Array<{
    id: string;
    startAt: Date;
    endAt: Date;
    timezone: string;
    status: string;
    availableCapacity: number;
    branch: { id: string; name: string; timezone: string };
    classType: { id: string; name: string };
  }>;
};

export type CheckInIssue = {
  id: string;
  bookingId: string;
  notBeforeAt: string;
  expiresAt: string;
  status: 'ACTIVE' | 'USED' | 'REVOKED';
  version: number;
  token: string | null;
  qrPayload: string | null;
  passUrl: string | null;
  maskedCustomerPhone: string | null;
  whatsappUrl: string | null;
  message: string | null;
  idempotentReplay: boolean;
};

export type CheckInResult = {
  id: string;
  resourceId: string;
  status: 'CHECKED_IN';
  checkedInAt: string;
  auditReference: string;
  idempotentReplay: boolean;
  customerName: string;
  /** Selfie yang diunggah member saat mendaftar; null bila belum ada. */
  customerPhotoUrl?: string | null;
  className: string;
  branch: { code: string; name: string };
  startAt: string;
  endAt: string;
};

/** QR presensi instruktur yang diterbitkan staf studio untuk satu kelas. */
export type InstructorCheckInIssue = {
  id: string;
  resourceId: string;
  expiresAt: string;
  qrPayload: string;
  className: string;
  branch: { code: string; name: string };
  startAt: string;
  endAt: string;
};

export type InstructorCheckInResult = {
  success: boolean;
  classSlotId: string;
  checkedInAt: string;
  distanceMeters?: number | null;
  branchName?: string | null;
};

/** Satu bentuk saldo paket untuk semua pemanggil, apa pun versi respons API-nya. */
export function normalizePackageBalance(item: any): CustomerPackageBalance {
  const expiryAt = item.expiryAt ? new Date(item.expiryAt) : new Date(0);
  return {
    ...item,
    customerUserId: item.customer?.id ?? item.customerUserId,
    customer: item.customer,
    packageName: item.packageName ?? item.name ?? 'Paket',
    classTypeId: item.classTypeId ?? null,
    classTypeName: item.classTypeName,
    branchName: item.branchName,
    available: item.available ?? item.remainingSessions ?? 0,
    reserved: item.reserved ?? 0,
    expiryAt: Number.isFinite(expiryAt.getTime()) ? expiryAt : new Date(0),
    isShareable: Boolean(item.isShareable),
    sharedWithUserIds: item.sharedWithUserIds ?? [],
    sharedMembers: item.sharedMembers ?? [],
  };
}

export interface BookingClient {
  discover(branchId: string): Promise<BookingDiscovery>;
  /**
   * Cari member di cabang ini lewat server (nama, email, atau nomor WhatsApp) beserta semua paket
   * mereka, termasuk yang sudah habis, supaya layar bisa menyebut alasannya tidak bisa ditambahkan.
   */
  searchRosterCandidates?(
    branchId: string,
    q: string,
  ): Promise<{ customers: BookingCustomer[]; packages: CustomerPackageBalance[] }>;
  options(classSlotId: string): Promise<CustomerBookingOptions>;
  list(input: {
    branchId?: string;
    status?: string;
    cursor?: string;
    page?: number;
    timeline?: 'UPCOMING' | 'HISTORY';
    q?: string;
    from?: string;
    until?: string;
    classSlotId?: string;
    customerId?: string;
    limit?: number;
  }): Promise<BookingPage>;
  detail(id: string): Promise<CustomerBookingRecord>;
  rescheduleOptions(id: string): Promise<CustomerRescheduleOptions>;
  create(input: BookingCommand, idempotencyKey: string): Promise<Booking>;
  listReschedules(input: {
    branchId?: string;
    status?: string;
    cursor?: string;
  }): Promise<ReschedulePage>;
  requestReschedule(input: RescheduleRequestCommand, idempotencyKey: string): Promise<Reschedule>;
  decideReschedule(
    id: string,
    decision: 'approve' | 'reject',
    input: RescheduleDecisionCommand,
    idempotencyKey: string,
  ): Promise<{ reschedule: Reschedule; booking: Booking; idempotentReplay: boolean }>;
  issueCheckIn?(
    bookingId: string,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<CheckInIssue>;
  /** Catat kehadiran pelanggan secara manual (batas H+2 setelah kelas selesai; alasan wajib 3-500 karakter). */
  backfillAttendance?(
    bookingId: string,
    reason: string,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<unknown>;
  revokeCheckIn?(
    tokenId: string,
    expectedVersion: number,
    reason: string,
    idempotencyKey: string,
  ): Promise<CheckInIssue>;
  issueBulkCheckIns?(
    classSlotId: string,
    bookingIds: string[] | undefined,
    idempotencyKey: string,
  ): Promise<{
    classSlotId: string;
    items: Array<{ bookingId: string; ok: boolean; result?: CheckInIssue; errorCode?: string }>;
  }>;
  consumeCheckIn?(token: string, idempotencyKey: string): Promise<CheckInResult>;
  issueInstructorCheckIn?(classSlotId: string, idempotencyKey: string): Promise<InstructorCheckInIssue>;
  consumeInstructorCheckIn?(
    token: string,
    idempotencyKey: string,
    location?: { latitude: number; longitude: number },
  ): Promise<InstructorCheckInResult>;
  /** Pembatalan mandiri oleh pelanggan (Aturan Bisnis #6: batas H-24). */
  cancel?(bookingId: string, reason?: string, idempotencyKey?: string): Promise<void>;
  /** Pembatalan atas nama pelanggan oleh staf (Aturan Bisnis #6: batas H-24, alasan wajib). */
  cancelAsStaff?(bookingId: string, reason: string, idempotencyKey: string): Promise<void>;
  cancellationOptions?(bookingId: string): Promise<{
    canCancel: boolean;
    unavailableReason: string | null;
    supportAction: string | null;
    cutoffAt: string;
  }>;
  /** Pengajuan pembatalan setelah batas H-24 (disetujui Manager/Owner, mendukung izin medis & pelepasan kursi langsung). */
  ajukanPembatalanTerlambat?(
    bookingId: string,
    reason: string,
    options?: { isMedical?: boolean; releaseSeat?: boolean },
  ): Promise<PengajuanPembatalan>;
  pembatalanTertunda?(classSlotId: string): Promise<PengajuanPembatalan[]>;
  putuskanPembatalan?(
    requestId: string,
    keputusan: 'approve' | 'reject',
    expectedVersion: number,
  ): Promise<{ status: string; sessionsReturned: number }>;
  /** Mengambil seluruh paket aktif milik pelanggan tertentu secara instan (real-time tanpa batas limit cabang). */
  getCustomerPackages?(
    customerId: string,
    branchId?: string,
  ): Promise<CustomerPackageBalance[]>;
  walkIn?(input: WalkInCommand, idempotencyKey: string): Promise<WalkInResult>;
}

export const browserBookingClient: BookingClient = {
  async getCustomerPackages(customerId, branchId) {
    const query = new URLSearchParams();
    query.set('customerUserId', customerId);
    if (branchId) query.set('branchId', branchId);
    query.set('pageSize', '50');
    query.set('status', 'ACTIVE');
    const response = await apiFetch<{ items: Array<any> }>(
      `/customer-packages?${query.toString()}`,
      { label: 'Memuat paket pelanggan…' },
    );
    const now = Date.now();
    return (response.items ?? [])
      .map((item: any) => {
        const expiryAt = item.expiryAt ? new Date(item.expiryAt) : new Date(0);
        return {
          ...item,
          customerUserId: item.customer?.id ?? item.customerUserId ?? customerId,
          customer: item.customer,
          packageName: item.packageName ?? item.name ?? 'Paket',
          classTypeId: item.classTypeId ?? null,
          classTypeName: item.classTypeName,
          branchName: item.branchName,
          available: item.available ?? item.remainingSessions ?? 0,
          reserved: item.reserved ?? 0,
          expiryAt: Number.isFinite(expiryAt.getTime()) ? expiryAt : new Date(0),
        };
      })
      .filter(
        (item) =>
          item.status === 'ACTIVE' &&
          item.available >= 1 &&
          new Date(item.expiryAt).getTime() > now,
      );
  },
  async options(classSlotId) {
    const response = await foregroundFetch(
      `/api/v1/bookings/options/${encodeURIComponent(classSlotId)}`,
      { credentials: 'include' },
      'Memuat pilihan booking…',
    );
    if (!response.ok) throw { response };
    const value = (await response.json()) as Omit<CustomerBookingOptions, 'slot' | 'packages'> & {
      slot: Omit<CustomerBookingOptions['slot'], 'startAt' | 'endAt'> & {
        startAt: string;
        endAt: string;
      };
      packages: Array<
        Omit<CustomerBookingOptions['packages'][number], 'expiryAt'> & {
          expiryAt: string;
        }
      >;
    };
    return {
      slot: {
        ...value.slot,
        startAt: new Date(value.slot.startAt),
        endAt: new Date(value.slot.endAt),
      },
      packages: (value.packages ?? []).map((item) => ({
        ...item,
        name: item.name ?? (item as any).packageName,
        available: item.available ?? (item as any).remainingSessions ?? 0,
        projectedAvailable:
          item.projectedAvailable ??
          Math.max(0, (item.available ?? (item as any).remainingSessions ?? 1) - 1),
        expiryAt: new Date(item.expiryAt ?? (item as any).expiresAt),
      })),
      eligibility: {
        ...value.eligibility,
        cutoffAt: new Date(value.eligibility?.cutoffAt ?? Date.now()),
      },
    };
  },
  async discover(branchId) {
    const [customerLookup, packages, published, confirmed] = await Promise.all([
      apiFetch<{ items: Array<{ id: string; label?: string; description?: string; metadata?: { eligiblePackageCount?: number } }> }>(
        `/lookups/customers?branchId=${encodeURIComponent(branchId)}&limit=50`,
        { label: 'Memuat data pelanggan…' },
      ),
      apiFetch<{ items: Array<any> }>(
        `/customer-packages?branchId=${encodeURIComponent(branchId)}&pageSize=50`,
        { label: 'Memuat saldo paket…' },
      ),
      apiFetch<{ items: Array<any> }>(
        `/class-slots?branchId=${encodeURIComponent(branchId)}&status=PUBLISHED`,
        { label: 'Memuat jadwal kelas…' },
      ),
      apiFetch<{ items: Array<any> }>(
        `/class-slots?branchId=${encodeURIComponent(branchId)}&status=CONFIRMED`,
        { label: 'Memuat jadwal kelas…' },
      ),
    ]);
    const now = Date.now();
    return {
      customers: (customerLookup.items ?? []).map((user) => ({
        id: user.id,
        displayName: user.label || 'Pelanggan',
        phoneMasked: user.description,
        eligiblePackageCount: user.metadata?.eligiblePackageCount,
      })),
      packages: (packages.items ?? [])
        .map(normalizePackageBalance)
        .filter(
          (item) =>
            (item.branchId === branchId || item.branchId === 'global' || !item.branchId) &&
            item.status === 'ACTIVE' &&
            item.available >= 1 &&
            new Date(item.expiryAt).getTime() > now,
        ),
      slots: [...(published.items ?? []), ...(confirmed.items ?? [])]
        .map((slot: any) => {
          const startAt = slot.startAt ? new Date(slot.startAt) : new Date(0);
          const endAt = slot.endAt ? new Date(slot.endAt) : new Date(0);
          return {
            ...slot,
            startAt: Number.isFinite(startAt.getTime()) ? startAt : new Date(0),
            endAt: Number.isFinite(endAt.getTime()) ? endAt : new Date(0),
          };
        })
        .filter(
          (slot) =>
            slot.branchId === branchId &&
            slot.startAt.getTime() > now &&
            slot.bookedCount < slot.capacity,
        )
        .sort((left, right) => left.startAt.getTime() - right.startAt.getTime()),
    };
  },
  async searchRosterCandidates(branchId, q) {
    // Member tanpa paket aktif ikut dicari, supaya layar menyebut alasannya alih-alih "tidak ada".
    const params = new URLSearchParams({ branchId, q, limit: '8', includeWithoutPackage: 'true' });
    const lookup = await apiFetch<{
      items: Array<{ id: string; label?: string; description?: string }>;
    }>(`/lookups/customers?${params.toString()}`, { label: 'Mencari member…' });
    const customers = (lookup.items ?? []).map((user) => ({
      id: user.id,
      displayName: user.label || 'Pelanggan',
      phoneMasked: user.description,
    }));
    const halaman = await Promise.all(
      customers.map((customer) =>
        apiFetch<{ items: Array<any> }>(
          `/customer-packages?${new URLSearchParams({
            branchId,
            customerUserId: customer.id,
            pageSize: '20',
          }).toString()}`,
        ).catch(() => ({ items: [] })),
      ),
    );
    return {
      customers,
      packages: halaman.flatMap((page) => (page.items ?? []).map(normalizePackageBalance)),
    };
  },
  async list(input) {
    const query = new URLSearchParams();
    if (input.branchId) query.set('branchId', input.branchId);
    if (input.status) query.set('status', input.status);
    if (input.cursor) query.set('cursor', input.cursor);
    if (input.page) query.set('page', String(input.page));
    if (input.timeline) query.set('timeline', input.timeline);
    if (input.q) query.set('q', input.q);
    if (input.from) query.set('from', input.from);
    if (input.until) query.set('until', input.until);
    if (input.classSlotId) query.set('classSlotId', input.classSlotId);
    if (input.customerId) query.set('customerId', input.customerId);
    if (input.limit) query.set('limit', String(input.limit));
    const response = await foregroundFetch(
      `/api/v1/bookings?${query.toString()}`,
      { credentials: 'include' },
      'Memuat booking…',
    );
    if (!response.ok) throw { response };
    const result = (await response.json()) as {
      items: Array<
        Omit<CustomerBookingRecord, 'createdAt' | 'classSlot' | 'attendance'> & {
          createdAt: string;
          classSlot?: Omit<NonNullable<CustomerBookingRecord['classSlot']>, 'startAt' | 'endAt'> & {
            startAt: string;
            endAt: string;
          };
          attendance?: { checkedInAt: string; source: 'QR' | 'BACKFILL' } | null;
        }
      >;
      total?: number;
      totalPages?: number;
      currentPage?: number;
      pageSize?: number;
      page?: { nextCursor?: string | null; current?: number; total?: number; totalPages?: number; pageSize?: number };
      summary?: BookingPage['summary'];
    };
    return {
      items: result.items.map((item) => ({
        ...item,
        createdAt: new Date(item.createdAt),
        classSlot: item.classSlot
          ? {
              ...item.classSlot,
              startAt: new Date(item.classSlot.startAt),
              endAt: new Date(item.classSlot.endAt),
            }
          : undefined,
        attendance: item.attendance
          ? { ...item.attendance, checkedInAt: new Date(item.attendance.checkedInAt) }
          : undefined,
      })),
      summary: result.summary,
      total: result.total ?? result.page?.total,
      totalPages: result.totalPages ?? result.page?.totalPages,
      currentPage: result.currentPage ?? result.page?.current,
      pageSize: result.pageSize ?? result.page?.pageSize,
      nextCursor: result.page?.nextCursor ?? (result as any).nextCursor ?? null,
    };
  },
  async detail(id) {
    const response = await foregroundFetch(
      `/api/v1/bookings/${encodeURIComponent(id)}`,
      { credentials: 'include' },
      'Memuat detail booking…',
    );
    if (!response.ok) throw { response };
    const item = (await response.json()) as any;
    return {
      ...item,
      createdAt: new Date(item.createdAt),
      classSlot: item.classSlot
        ? {
            ...item.classSlot,
            startAt: new Date(item.classSlot.startAt),
            endAt: new Date(item.classSlot.endAt),
          }
        : undefined,
      attendance: item.attendance
        ? { ...item.attendance, checkedInAt: new Date(item.attendance.checkedInAt) }
        : undefined,
      reschedules: item.reschedules?.map((reschedule: any) => ({
        ...reschedule,
        requestedAt: new Date(reschedule.requestedAt),
        decidedAt: reschedule.decidedAt ? new Date(reschedule.decidedAt) : null,
        sourceClassSlot: {
          ...reschedule.sourceClassSlot,
          startAt: new Date(reschedule.sourceClassSlot.startAt),
          endAt: new Date(reschedule.sourceClassSlot.endAt),
        },
        targetClassSlot: {
          ...reschedule.targetClassSlot,
          startAt: new Date(reschedule.targetClassSlot.startAt),
          endAt: new Date(reschedule.targetClassSlot.endAt),
        },
      })),
      checkInToken: item.checkInToken
        ? {
            ...item.checkInToken,
            notBeforeAt: new Date(item.checkInToken.notBeforeAt),
            expiresAt: new Date(item.checkInToken.expiresAt),
            usedAt: item.checkInToken.usedAt ? new Date(item.checkInToken.usedAt) : null,
            revokedAt: item.checkInToken.revokedAt ? new Date(item.checkInToken.revokedAt) : null,
          }
        : null,
    };
  },
  async rescheduleOptions(id) {
    const response = await foregroundFetch(
      `/api/v1/bookings/${encodeURIComponent(id)}/reschedule-options`,
      { credentials: 'include' },
      'Memuat pilihan jadwal…',
    );
    if (!response.ok) throw { response };
    const value = (await response.json()) as any;
    return {
      ...value,
      canRequest: Boolean(value.canRequest ?? value.canReschedule),
      supportAction:
        value.supportAction ??
        (value.unavailableReason === 'RESCHEDULE_CUTOFF_PASSED' ? 'CONTACT_STUDIO' : null),
      cutoffAt: new Date(value.cutoffAt),
      latestRequest: value.latestRequest
        ? {
            ...value.latestRequest,
            entitlementCutoffAt: new Date(value.latestRequest.entitlementCutoffAt),
            requestedAt: new Date(value.latestRequest.requestedAt),
            decidedAt: value.latestRequest.decidedAt
              ? new Date(value.latestRequest.decidedAt)
              : null,
          }
        : null,
      targets: (value.targets ?? []).map((target: any) => ({
        ...target,
        availableCapacity: target.availableCapacity ?? target.available ?? 0,
        startAt: new Date(target.startAt),
        endAt: new Date(target.endAt),
      })),
    };
  },
  async create(input, idempotencyKey) {
    const result = await apiFetch<any>('/bookings', {
      method: 'POST',
      idempotent: true,
      headers: idempotencyKey ? { 'idempotency-key': idempotencyKey } : undefined,
      body: JSON.stringify(input),
      label: 'Membuat booking…',
    });
    return {
      ...result,
      createdAt: new Date(result.createdAt),
      cancelledAt: result.cancelledAt ? new Date(result.cancelledAt) : null,
    };
  },
  async cancel(bookingId, reason, idempotencyKey) {
    const key =
      idempotencyKey ??
      (typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `cancel-${Date.now()}`);
    const response = await foregroundFetch(
      `/api/v1/bookings/${encodeURIComponent(bookingId)}/cancel`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'idempotency-key': key },
        body: JSON.stringify({
          reasonCode: 'CUSTOMER_SCHEDULE_CONFLICT',
          reason: reason ?? 'Dibatalkan mandiri oleh pelanggan',
        }),
      },
      'Membatalkan booking…',
    );
    if (!response.ok) throw { response };
  },
  async cancelAsStaff(bookingId, reason, idempotencyKey) {
    const response = await foregroundFetch(
      `/api/v1/bookings/${encodeURIComponent(bookingId)}/cancel`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
        body: JSON.stringify({ reasonCode: 'OTHER', reason }),
      },
      'Membatalkan booking…',
    );
    if (!response.ok) throw { response };
  },
  ajukanPembatalanTerlambat(bookingId, reason, options) {
    return apiFetch<PengajuanPembatalan>(
      `/bookings/${encodeURIComponent(bookingId)}/late-cancellation`,
      {
        method: 'POST',
        body: JSON.stringify({
          reason,
          isMedical: options?.isMedical,
          releaseSeat: options?.releaseSeat,
        }),
        label: options?.isMedical ? 'Mengirim izin medis…' : 'Mengirim pengajuan pembatalan…',
      },
    );
  },
  async pembatalanTertunda(classSlotId) {
    const hasil = await apiFetch<PengajuanPembatalan[]>(
      `/bookings/late-cancellations?${new URLSearchParams({ classSlotId })}`,
      { label: 'Memuat pengajuan pembatalan…' },
    );
    return Array.isArray(hasil) ? hasil : [];
  },
  putuskanPembatalan(requestId, keputusan, expectedVersion) {
    return apiFetch(
      `/bookings/late-cancellations/${encodeURIComponent(requestId)}/${keputusan}`,
      {
        method: 'POST',
        body: JSON.stringify({ expectedVersion }),
        label: keputusan === 'approve' ? 'Menyetujui pembatalan…' : 'Menolak pembatalan…',
      },
    );
  },
  async cancellationOptions(bookingId) {
    const response = await foregroundFetch(
      `/api/v1/bookings/${encodeURIComponent(bookingId)}/cancellation-options`,
      { credentials: 'include' },
      'Memeriksa batas pembatalan…',
    );
    if (!response.ok) throw { response };
    return response.json();
  },
  async listReschedules(input) {
    const query = new URLSearchParams();
    if (input.branchId) query.set('branchId', input.branchId);
    if (input.status) query.set('status', input.status);
    if (input.cursor) query.set('cursor', input.cursor);
    const result = await apiFetch<{
      items: any[];
      page?: { nextCursor?: string | null };
    }>(`/reschedules?${query.toString()}`, { label: 'Memuat permohonan reschedule…' });
    return {
      items: (result.items ?? []).map((item: any) => ({
        ...item,
        requestedAt: new Date(item.requestedAt),
        entitlementCutoffAt: new Date(item.entitlementCutoffAt ?? item.cutoffAt ?? item.requestedAt),
        decidedAt: item.decidedAt ? new Date(item.decidedAt) : null,
        sourceClassSlot: item.sourceClassSlot
          ? {
              ...item.sourceClassSlot,
              startAt: new Date(item.sourceClassSlot.startAt),
              endAt: new Date(item.sourceClassSlot.endAt),
            }
          : undefined,
        targetClassSlot: item.targetClassSlot
          ? {
              ...item.targetClassSlot,
              startAt: new Date(item.targetClassSlot.startAt),
              endAt: new Date(item.targetClassSlot.endAt),
            }
          : undefined,
      })),
      nextCursor: result.page?.nextCursor ?? (result as any).nextCursor ?? null,
    };
  },
  async requestReschedule(input, idempotencyKey) {
    const result = await apiFetch<any>('/reschedules', {
      method: 'POST',
      idempotent: true,
      headers: idempotencyKey ? { 'idempotency-key': idempotencyKey } : undefined,
      body: JSON.stringify(input),
      label: 'Mengajukan reschedule…',
    });
    return {
      ...result,
      requestedAt: new Date(result.requestedAt),
      decidedAt: result.decidedAt ? new Date(result.decidedAt) : null,
    };
  },
  async decideReschedule(id, decision, input, idempotencyKey) {
    const result = await apiFetch<any>(`/reschedules/${encodeURIComponent(id)}/${encodeURIComponent(decision)}`, {
      method: 'POST',
      idempotent: true,
      headers: idempotencyKey ? { 'idempotency-key': idempotencyKey } : undefined,
      body: JSON.stringify(input),
      label: 'Memproses keputusan reschedule…',
    });
    return {
      ...result,
      requestedAt: new Date(result.requestedAt),
      decidedAt: result.decidedAt ? new Date(result.decidedAt) : null,
    };
  },
  async issueCheckIn(bookingId, expectedVersion, idempotencyKey) {
    const response = await foregroundFetch(
      `/api/v1/bookings/${encodeURIComponent(bookingId)}/customer-check-in-links`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
        body: JSON.stringify({ expectedVersion }),
      },
      'Menerbitkan QR check-in…',
    );
    if (!response.ok) throw { response };
    return response.json() as Promise<CheckInIssue>;
  },
  async backfillAttendance(bookingId, reason, expectedVersion, idempotencyKey) {
    const response = await foregroundFetch(
      '/api/v1/check-ins/customers/backfill',
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
        body: JSON.stringify({ bookingId, reason, expectedVersion }),
      },
      'Mencatat kehadiran…',
    );
    if (!response.ok) throw { response };
    return response.json();
  },
  async issueBulkCheckIns(classSlotId, bookingIds, idempotencyKey) {
    const response = await foregroundFetch(
      `/api/v1/class-slots/${encodeURIComponent(classSlotId)}/customer-check-in-links/bulk`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
        body: JSON.stringify({ bookingIds }),
      },
      'Menerbitkan QR check-in…',
    );
    if (!response.ok) throw { response };
    return response.json();
  },
  async revokeCheckIn(tokenId, expectedVersion, reason, idempotencyKey) {
    const response = await foregroundFetch(
      `/api/v1/check-in-tokens/${encodeURIComponent(tokenId)}/revoke`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
        body: JSON.stringify({ expectedVersion, reason }),
      },
      'Mencabut QR check-in…',
    );
    if (!response.ok) throw { response };
    return response.json() as Promise<CheckInIssue>;
  },
  async consumeCheckIn(token, idempotencyKey) {
    const response = await foregroundFetch(
      '/api/v1/check-ins/customers',
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
        body: JSON.stringify({ token }),
      },
      'Memproses check-in…',
    );
    if (!response.ok) throw { response };
    return response.json() as Promise<CheckInResult>;
  },
  async issueInstructorCheckIn(classSlotId, idempotencyKey) {
    const response = await foregroundFetch(
      `/api/v1/class-slots/${encodeURIComponent(classSlotId)}/instructor-check-in-tokens`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'idempotency-key': idempotencyKey },
      },
      'Menerbitkan QR presensi instruktur…',
    );
    if (!response.ok) throw { response };
    return response.json() as Promise<InstructorCheckInIssue>;
  },
  async walkIn(input, idempotencyKey) {
    const result = await apiFetch<any>('/bookings/walk-in', {
      method: 'POST',
      idempotent: true,
      headers: idempotencyKey ? { 'idempotency-key': idempotencyKey } : undefined,
      body: JSON.stringify(input),
      label: 'Mendaftarkan walk-in…',
    });
    return {
      ...result,
      booking: {
        ...result.booking,
        createdAt: new Date(result.booking.createdAt),
      },
    };
  },
  async consumeInstructorCheckIn(token, idempotencyKey, location) {
    const response = await foregroundFetch(
      '/api/v1/check-ins/instructors',
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
        body: JSON.stringify({
          token,
          latitude: location?.latitude,
          longitude: location?.longitude,
        }),
      },
      'Memproses presensi instruktur…',
    );
    if (!response.ok) throw { response };
    // API membungkus hasil sebagai { status, body }.
    const wrapped = (await response.json()) as { body?: InstructorCheckInResult } & InstructorCheckInResult;
    return wrapped.body ?? wrapped;
  },
};

const messages: Record<string, string> = {
  PURCHASE_NOT_PAID: 'Pembelian paket ini belum disetujui atau belum lunas. Sesi baru dapat digunakan setelah pembayaran disahkan.',
  PACKAGE_PAYMENT_PENDING: 'Pembelian paket ini belum disetujui atau belum lunas. Sesi baru dapat digunakan setelah pembayaran disahkan.',
  BOOKING_CUTOFF_PASSED: 'Waktu pemesanan kelas ini sudah ditutup.',
  CLASS_CAPACITY_FULL: 'Kapasitas kelas sudah penuh.',
  CLASS_ALREADY_ENDED: 'Kelas ini sudah selesai dan tidak dapat menerima walk-in baru.',
  INSUFFICIENT_AVAILABLE_SESSIONS: 'Saldo sesi pelanggan tidak mencukupi.',
  DUPLICATE_ACTIVE_BOOKING: 'Pelanggan sudah memiliki booking aktif untuk kelas ini.',
  RESOURCE_NOT_FOUND: 'Data tidak tersedia dalam cabang yang dipilih.',
  CONFIGURATION_REQUIRED: 'Fitur booking yang diminta belum tersedia.',
  IDEMPOTENCY_KEY_REUSED: 'Permintaan booking berubah. Silakan mulai konfirmasi baru.',
  IDEMPOTENCY_IN_PROGRESS: 'Permintaan yang sama masih diproses. Silakan coba lagi.',
  SESSION_EXPIRED: 'Sesi berakhir. Silakan masuk kembali.',
  FORBIDDEN: 'Anda tidak memiliki izin untuk tindakan ini.',
  VALIDATION_ERROR: 'Data booking belum valid.',
  OFFLINE_OR_REQUEST_FAILED: 'Layanan tidak dapat dijangkau. Periksa koneksi lalu coba lagi.',
  RESCHEDULE_CUTOFF_PASSED: 'Batas pengajuan reschedule H-24 sudah terlewati.',
  PENDING_RESCHEDULE_EXISTS: 'Booking ini sudah memiliki reschedule yang sedang ditinjau.',
  TARGET_CLASS_FULL: 'Kelas tujuan sudah penuh.',
  TARGET_CLASS_INELIGIBLE: 'Kelas tujuan tidak lagi memenuhi syarat.',
  RESCHEDULE_ALREADY_DECIDED: 'Reschedule ini sudah diputuskan.',
  SELF_APPROVAL_FORBIDDEN: 'Permintaan reschedule tidak boleh disetujui oleh pemohon yang sama.',
  STALE_VERSION: 'Data berubah sejak terakhir dimuat. Muat ulang sebelum melanjutkan.',
  CHECK_IN_TOO_EARLY: 'QR belum aktif. Check-in dibuka 30 menit sebelum kelas.',
  CHECK_IN_WINDOW_CLOSED: 'QR sudah kedaluwarsa karena jadwal kelas telah selesai.',
  INVALID_STATE_TRANSITION:
    'Status kelas atau booking saat ini tidak mengizinkan tindakan tersebut. Pastikan kelas sudah dipublikasikan.',
  PACKAGE_CLASS_TYPE_MISMATCH: 'Paket yang Anda pilih tidak sesuai dengan jenis kelas ini. Silakan pilih kelas dengan tipe yang cocok.',
  PACKAGE_BRANCH_MISMATCH: 'Paket ini hanya berlaku untuk cabang studio tertentu. Silakan pilih jadwal di cabang yang sesuai.',
  PACKAGE_EXHAUSTED: 'Sisa sesi paket Anda sudah habis. Silakan beli paket baru untuk melanjutkan booking.',
  DUPLICATE_BOOKING: 'Anda sudah memiliki booking aktif untuk kelas ini.',
  CANCELLATION_CUTOFF_PASSED:
    'Batas pembatalan H-24 sudah terlewati. Untuk kondisi darurat medis, ajukan Penyesuaian Sesi.',
  ATTENDANCE_RECORDED: 'Kehadiran sudah tercatat, booking tidak dapat dibatalkan.',
  INVALID_TOKEN: 'QR tidak dikenali. Minta staf studio menampilkan QR presensi terbaru.',
  TOKEN_ALREADY_USED: 'QR ini sudah dipakai atau sudah diganti. Minta staf studio menampilkan QR terbaru.',
  TOKEN_EXPIRED: 'QR sudah kedaluwarsa. Minta staf studio menampilkan QR terbaru.',
  GEOLOCATION_REQUIRED:
    'Akses lokasi (GPS) diperlukan untuk memvalidasi bahwa Anda berada di cabang tempat kelas berlangsung. Izinkan akses lokasi pada browser Anda.',
  OUT_OF_GEOFENCE:
    'Presensi ditolak karena Anda berada di luar radius area cabang studio yang telah ditentukan. Anda harus berada di lokasi cabang untuk melakukan presensi.',
};

export type BookingProblem = {
  code: string;
  message: string;
};

export async function bookingProblem(error: unknown): Promise<BookingProblem> {
  notifySessionFailure(error);
  const typed = error as {
    code?: string;
    status?: number;
    data?: { code?: string; error?: { code?: string } } | null;
    response?: Response & { status?: number };
  };
  let code = typed.code;
  // `apiFetch` melempar ApiError { status, data } dengan data = badan problem dari server.
  code ??= typed.data?.code ?? typed.data?.error?.code;
  if (!code && typed.response?.clone) {
    try {
      const problem = (await typed.response.clone().json()) as {
        code?: string;
        error?: { code?: string };
      };
      code = problem.code ?? problem.error?.code;
    } catch {
      // A response without problem-details is mapped by status below.
    }
  }
  const status = typed.status ?? typed.response?.status;
  code ??=
    status === 401
      ? 'SESSION_EXPIRED'
      : status === 403
        ? 'FORBIDDEN'
        : status === 404
          ? 'RESOURCE_NOT_FOUND'
          : status === 503
            ? 'CONFIGURATION_REQUIRED'
            : status === 400 || status === 422
              ? 'VALIDATION_ERROR'
              : 'OFFLINE_OR_REQUEST_FAILED';
  return {
    code,
    message: messages[code] ?? messages.OFFLINE_OR_REQUEST_FAILED!,
  };
}

export async function bookingFailure(error: unknown): Promise<string> {
  return (await bookingProblem(error)).message;
}

// ============================================================================
// SPESIFIKASI V1.0 (FASE 1): CUSTOMER LINK CHECK-IN & SESSION ADJUST REQUESTS
// ============================================================================

export type CustomerLinkInfo = {
  bookingId: string;
  customerName: string;
  className: string;
  branchName: string;
  studioName: string | null;
  instructorName: string | null;
  startAt: string;
  endAt: string;
  timezone: string;
  status: 'ATTENDED' | 'EXPIRED' | 'TOO_EARLY' | 'OPEN';
  canConfirm: boolean;
};

export type CustomerLinkConfirmResult = {
  ok: boolean;
  status: string;
  bookingId: string;
  customerName: string;
  className: string;
  branchName: string;
  studioName?: string | null;
  instructorName?: string | null;
  checkedInAt: string;
  message: string;
};

export async function getCustomerLinkInfo(token: string): Promise<CustomerLinkInfo> {
  return apiFetch<CustomerLinkInfo>(`/api/v1/check-ins/customer-link-info?token=${encodeURIComponent(token)}`);
}

export async function confirmCustomerLink(token: string): Promise<CustomerLinkConfirmResult> {
  return apiFetch<CustomerLinkConfirmResult>('/api/v1/check-ins/customers/confirm-link', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}
