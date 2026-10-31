import { HITUNG_TERISI, STATUS_MENEMPATI_KURSI, terisi } from '../classes/terisi';
import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { AuditService } from '../foundation/audit.service';
import { Prisma, type BookingStatus, SessionMutationType, PaymentMethod } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { RuntimeConfigService } from '../configuration/runtime-config.service';
import { PrismaService } from '../database/prisma.service';
import { punyaSelfie } from '../identity/verifikasi-selfie';
import { IdempotencyService } from '../foundation/idempotency.service';
import type { SessionPrincipal } from '../identity/identity.service';
import { PolicyService } from '../identity/policy.service';
import { ApiProblem, ENTITY_ID_REGEX } from '../identity/security';
import { paketBerlakuDi } from './cabang-paket';

export type BookingCancellationReasonCode =
  | 'PERSONAL_UNAVAILABLE'
  | 'CUSTOMER_SCHEDULE_CONFLICT'
  | 'WRONG_CLASS_SELECTED'
  | 'OTHER';

export type WalkInCommand = {
  branchId: string;
  classSlotId: string;
  customerUserId: string;
  packageId: string;
  paymentMethod: keyof typeof PaymentMethod;
  paymentNote?: string;
};

export type BookingCommand = {
  classSlotId: string;
  customerPackageId: string;
  customerUserId?: string;
  source: 'SELF' | 'ADMIN_ASSISTED';
};

export type CancelBookingCommand = {
  reasonCode: BookingCancellationReasonCode;
  expectedVersion?: number;
  reason?: string;
};

export { ENTITY_ID_REGEX };
const UUID = /^(?:[0-9a-zA-Z]{8}-[0-9a-zA-Z]{4,6}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{10,12})$/;
const PAGE_SIZE = 20;

export function isCancellationEntitled(
  classStartAt: Date,
  evaluatedAt: Date,
  cutoffHours: number,
): boolean {
  return evaluatedAt.getTime() < classStartAt.getTime() - cutoffHours * 3_600_000;
}

export function isInstructorRosterPrincipal(principal: {
  capabilities?: readonly string[];
}): boolean {
  const caps = principal.capabilities ?? [];
  return caps.includes('class:assigned:read') && !caps.includes('booking:read');
}

@Injectable()
export class BookingsService {
  constructor(
    private readonly db: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly policy: PolicyService,
    private readonly config: RuntimeConfigService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private syntheticPolicy() {
    const { enabled, cutoffHours } = this.config.value.booking;
    if (!enabled || cutoffHours === null)
      throw new ApiProblem('CONFIGURATION_REQUIRED', HttpStatus.SERVICE_UNAVAILABLE);
    return { cutoffHours };
  }

  private cancellationPolicy() {
    const { enabled, cutoffHours } = this.config.value.bookingCancellation;
    if (!enabled || cutoffHours === null)
      throw new ApiProblem('CONFIGURATION_REQUIRED', HttpStatus.SERVICE_UNAVAILABLE);
    return { cutoffHours };
  }

  private isCustomer(principal: SessionPrincipal) {
    return (
      principal.capabilities.includes('booking:self:create') &&
      !principal.capabilities.includes('booking:create:assisted')
    );
  }

  private requireBranch(principal: SessionPrincipal, branchId: string, capability: string) {
    if (
      !this.policy.hasCapability(principal, 'branch:all', branchId) &&
      !this.policy.hasCapability(principal, capability, branchId)
    )
      throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
  }

  /**
   * Batas cabang untuk staf yang membaca daftar booking. Tanpa `booking:read` ditolak (403);
   * `branchId` di luar scope diperlakukan seperti tidak ada (404), sama seperti `requireBranch`.
   * Mengembalikan filter `SlotKelas.branchId`, atau `undefined` bila akses global tanpa pengecualian.
   */
  private staffBranchScope(
    principal: SessionPrincipal,
    requestedBranchId?: string,
  ): string | { in: string[] } | { notIn: string[] } | undefined {
    this.policy.requireCapability(principal.capabilities, 'booking:read');
    const scope = this.policy.capabilityBranchScope(principal, 'booking:read');
    if (!scope.all && scope.included.length === 0)
      throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
    if (requestedBranchId) {
      const allowed = scope.all
        ? !scope.excluded.includes(requestedBranchId)
        : scope.included.includes(requestedBranchId);
      if (!allowed) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
      return requestedBranchId;
    }
    if (scope.all) return scope.excluded.length > 0 ? { notIn: scope.excluded } : undefined;
    return { in: scope.included };
  }

  private async requireVerifiedCustomer(principal: SessionPrincipal) {
    const user = await this.db.user.findUnique({
      where: { id: principal.userId },
      include: { profile: true },
    });
    if (!user || user.status !== 'ACTIVE')
      throw new ApiProblem('IDENTITY_VERIFICATION_REQUIRED', HttpStatus.FORBIDDEN);
    // Syaratnya foto selfie (tanpa KTP): staf mengenali member dari foto ini saat check-in.
    if (!punyaSelfie(user.profile))
      throw new ApiProblem('IDENTITY_VERIFICATION_REQUIRED', HttpStatus.FORBIDDEN);
  }

  /** Booking yang masih memesan satu sesi (BOOKED) per paket pelanggan; dasar "sisa sesi" yang tersedia. */
  private async reservedByPackage(packageIds: Array<string | null | undefined>) {
    const ids = [...new Set(packageIds.filter((id): id is string => Boolean(id)))];
    if (ids.length === 0) return new Map<string, number>();
    const groups = await this.db.pemesananKelas.groupBy({
      by: ['customerPackageId'],
      where: { customerPackageId: { in: ids }, status: 'BOOKED' },
      _count: { _all: true },
    });
    return new Map(groups.map((group) => [group.customerPackageId, group._count._all]));
  }

  bookingView(booking: any, reservedByPackage?: Map<string, number>) {
    const slot = booking.classSlot;
    const pkg = booking.customerPackage?.package;
    const phone = booking.user?.phone;
    const phoneMasked = phone
      ? phone.length > 6
        ? `${phone.slice(0, 4)}****${phone.slice(-2)}`
        : phone
      : null;
    return {
      id: booking.id,
      bookingNumber: booking.bookingNumber,
      branchId: slot?.branchId ?? booking.branchId,
      classSlotId: booking.classSlotId,
      customerUserId: booking.userId,
      customerPackageId: booking.customerPackageId,
      status: booking.status,
      cancellationReasonCode: booking.cancellationReason ?? null,
      cancelledAt: booking.cancelledAt ?? null,
      cancelledById: booking.cancelledById ?? null,
      createdAt: booking.createdAt,
      reservedQuantity: 1,
      source: booking.source ?? 'SELF',
      version: 1,
      idempotentReplay: false,
      branch: slot?.branch ?? null,
      customer: booking.user
        ? {
            id: booking.user.id,
            displayName: booking.user.displayName,
            email: booking.user.email,
            phone: booking.user.phone,
            phoneMasked,
          }
        : undefined,
      classSlot: slot
        ? {
            id: slot.id,
            startAt: slot.startAt,
            endAt: slot.endAt,
            timezone: slot.branch?.timezone ?? 'Asia/Jakarta',
            status: slot.status,
            capacity: slot.capacity,
            bookedCount: terisi(slot),
            available: Math.max(0, slot.capacity - terisi(slot)),
            classType: slot.classType,
            instructor: slot.instructor
              ? {
                  id: slot.instructor.id,
                  displayName: slot.instructor.displayName,
                }
              : null,
            studio: slot.studio ? { id: slot.studio.id, name: slot.studio.name } : null,
          }
        : undefined,
      package: pkg
        ? {
            id: pkg.id,
            name: pkg.name,
            isShareable: Boolean(pkg.isShareable),
            owner: booking.customerPackage?.user
              ? {
                  id: booking.customerPackage.user.id,
                  displayName: booking.customerPackage.user.displayName,
                }
              : undefined,
          }
        : undefined,
      // Saldo paket pelanggan pada saat dibaca; hanya diisi oleh daftar dan detail booking.
      sessionBalance:
        reservedByPackage && booking.customerPackage
          ? (() => {
              const ledgerBalance = booking.customerPackage.remainingSessions as number;
              const reserved = reservedByPackage.get(booking.customerPackageId) ?? 0;
              return {
                ledgerBalance,
                reserved,
                available:
                  booking.customerPackage.status === 'FROZEN' ? 0 : Math.max(0, ledgerBalance - reserved),
              };
            })()
          : undefined,
      attendance: booking.attendance
        ? {
            checkedInAt: booking.attendance.checkedInAt,
            method: booking.attendance.method,
          }
        : null,
      checkInToken: booking.checkInTokens?.[0]
        ? {
            id: booking.checkInTokens[0].id,
            isUsed: booking.checkInTokens[0].isUsed,
            expiresAt: booking.checkInTokens[0].expiresAt,
          }
        : null,
    };
  }

  async cancellationOptions(principal: SessionPrincipal, bookingId: string) {
    const customerFlow = this.isCustomer(principal);
    this.policy.requireCapability(
      principal.capabilities,
      customerFlow ? 'booking:self:cancel' : 'booking:cancel:assisted',
    );
    if (!UUID.test(bookingId)) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const policy = this.cancellationPolicy();
    const booking = await this.db.pemesananKelas.findFirst({
      where: customerFlow ? { id: bookingId, userId: principal.userId } : { id: bookingId },
      include: {
        classSlot: {
          include: { branch: true },
        },
        attendance: true,
      },
    });
    if (!booking) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (!customerFlow)
      this.requireBranch(principal, booking.classSlot.branchId, 'booking:cancel:assisted');

    const now = new Date();
    const cutoffAt = new Date(booking.classSlot.startAt.getTime() - policy.cutoffHours * 3_600_000);
    const unavailableReason =
      booking.status !== 'BOOKED'
        ? 'BOOKING_NOT_ACTIVE'
        : booking.attendance
          ? 'ATTENDANCE_RECORDED'
          : !['PUBLISHED', 'CONFIRMED'].includes(booking.classSlot.status)
            ? 'CLASS_SLOT_UNAVAILABLE'
            : !isCancellationEntitled(booking.classSlot.startAt, now, policy.cutoffHours)
              ? 'CANCELLATION_CUTOFF_PASSED'
              : null;

    return {
      bookingId: booking.id,
      bookingVersion: 1,
      cutoffAt,
      canCancel: unavailableReason === null,
      unavailableReason,
      // Staf yang terhalang batas H-24 diarahkan ke Penyesuaian Sesi (Aturan Bisnis #6).
      supportAction:
        unavailableReason === null
          ? null
          : customerFlow
            ? 'CONTACT_STUDIO'
            : unavailableReason === 'CANCELLATION_CUTOFF_PASSED'
              ? 'USE_SESSION_ADJUSTMENT'
              : 'CONTACT_STUDIO',
    };
  }

  async cancel(
    principal: SessionPrincipal,
    bookingId: string,
    input: CancelBookingCommand,
    key: string,
    _correlationId: string,
  ) {
    if (!UUID.test(bookingId)) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const customerFlow = this.isCustomer(principal);
    this.policy.requireCapability(
      principal.capabilities,
      customerFlow ? 'booking:self:cancel' : 'booking:cancel:assisted',
    );
    // Staf wajib menyebut alasan (jejak pembatalan atas nama pelanggan, min. 10 karakter).
    const staffReason = input.reason?.trim() ?? '';
    if (!customerFlow && (staffReason.length < 10 || staffReason.length > 200))
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'reason', issue: 'REASON_REQUIRED' },
      ]);

    return this.idempotency.execute(
      {
        scope: `booking-cancel:${bookingId}`,
        key,
        payload: input,
        ttlMs: 86_400_000,
        leaseMs: 30_000,
      },
      async (tx) => {
        const booking = await tx.pemesananKelas.findUnique({
          where: { id: bookingId },
          include: {
            classSlot: {
              include: { branch: true, classType: true, instructor: true, studio: true },
            },
            customerPackage: { include: { package: true } },
            user: true,
            attendance: true,
          },
        });
        if (!booking) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
        if (customerFlow && booking.userId !== principal.userId)
          throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
        if (!customerFlow)
          this.requireBranch(principal, booking.classSlot.branchId, 'booking:cancel:assisted');
        if (booking.status !== 'BOOKED')
          throw new ApiProblem('INVALID_STATE_TRANSITION', HttpStatus.CONFLICT);
        if (booking.attendance)
          throw new ApiProblem('ATTENDANCE_RECORDED', HttpStatus.CONFLICT);

        const now = new Date();
        const policy = this.cancellationPolicy();
        // Batas H-24 berlaku sama untuk pelanggan dan staf; di bawah itu jalurnya Penyesuaian Sesi.
        if (!isCancellationEntitled(booking.classSlot.startAt, now, policy.cutoffHours)) {
          throw new ApiProblem(
            'CANCELLATION_CUTOFF_PASSED',
            HttpStatus.CONFLICT,
            false,
            customerFlow ? [] : [{ field: 'booking', issue: 'USE_SESSION_ADJUSTMENT' }],
          );
        }

        const reason = customerFlow
          ? (input.reason ?? input.reasonCode ?? 'CANCELLED_BY_USER')
          : `Dibatalkan staf: ${staffReason}`;
        const updated = await tx.pemesananKelas.update({
          where: { id: booking.id },
          data: {
            status: 'CANCELLED',
            cancelledAt: now,
            cancellationReason: reason,
            cancelledById: principal.userId,
          },
          include: {
            classSlot: {
              include: { branch: true, classType: true, instructor: true, studio: true },
            },
            customerPackage: { include: { package: true } },
            user: true,
            attendance: true,
          },
        });

        // Kurangi bookedCount di slot kelas O(1)
        await tx.slotKelas.update({
          where: { id: booking.classSlotId },
          data: {
            bookedCount: { decrement: 1 },
          },
        });

        // Catat jejak audit permanen ke audit_log
        await tx.auditLog.create({
          data: {
            id: randomUUID(),
            action: customerFlow ? 'booking.cancelled_by_customer' : 'booking.cancelled_by_staff',
            actorId: principal.userId,
            targetUserId: booking.userId,
            branchId: booking.classSlot.branchId,
            correlationId: _correlationId ? String(_correlationId).slice(0, 64) : null,
            reason: reason.trim() || null,
            detail: {
              bookingId: booking.id,
              bookingNumber: booking.bookingNumber,
              classSlotId: booking.classSlotId,
              previousStatus: booking.status,
              newStatus: 'CANCELLED',
              staffReason: customerFlow ? null : staffReason,
            },
          },
        });

        return {
          status: HttpStatus.OK,
          body: this.bookingView(updated) as unknown as Prisma.InputJsonValue,
        };
      },
    );
  }

  async customerOptions(principal: SessionPrincipal, classSlotId: string) {
    if (!UUID.test(classSlotId)) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const slot = await this.db.slotKelas.findUnique({
      where: { id: classSlotId },
      include: {
        classType: true,
        branch: true,
        instructor: true,
        studio: true,
        room: true,
        ...HITUNG_TERISI,
      },
    });
    if (!slot) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

    const now = new Date();
    const cutoffHours = slot.bookingCutoffHours ?? this.config.value?.booking?.cutoffHours ?? 2;
    const cutoffAt = new Date(slot.startAt.getTime() - cutoffHours * 3_600_000);

    // Ambil paket aktif pelanggan (milik sendiri atau paket bersama/duet di mana pelanggan terdaftar)
    // yang sesuai dengan cabang dan jenis kelas
    const packages = await this.db.paketPelanggan.findMany({
      where: {
        status: 'ACTIVE',
        remainingSessions: { gt: 0 },
        validUntil: { gt: now },
        AND: [
          {
            OR: [
              { userId: principal.userId },
              {
                package: { isShareable: true },
                sharedMembers: { some: { userId: principal.userId } },
              },
            ],
          },
          {
            OR: [{ purchaseId: null }, { purchase: { status: 'PAID' } }],
          },
        ],
        // Cabang diperiksa di bawah (cabang paket atau cabang pembelian), tidak di query ini.
        package: { OR: [{ classTypeId: null }, { classTypeId: slot.classTypeId }] },
      },
      include: {
        package: true,
        purchase: true,
      },
    });

    // Filter paket: jika paket bukan multi-branch, pastikan cabang paket/pembelian cocok dengan slot
    const matchingPackages = packages.filter((pkg) => paketBerlakuDi(pkg, slot.branchId));

    const items = await Promise.all(
      matchingPackages.map(async (pkg) => {
        const activeBookingsCount = await this.db.pemesananKelas.count({
          where: {
            customerPackageId: pkg.id,
            status: 'BOOKED',
          },
        });
        const availableSessions = Math.max(0, pkg.remainingSessions - activeBookingsCount);
        return {
          id: pkg.id,
          customerPackageId: pkg.id,
          packageId: pkg.packageId,
          name: pkg.package.name,
          packageName: pkg.package.name,
          available: availableSessions,
          remainingSessions: availableSessions,
          projectedAvailable: Math.max(0, availableSessions - 1),
          totalSessions: pkg.totalSessions,
          expiryAt: pkg.validUntil,
          expiresAt: pkg.validUntil,
          isEligible: availableSessions > 0,
        };
      }),
    );

    const eligiblePackages = items.filter((item) => item.available > 0);

    let canBook = true;
    let reasonCode:
      | 'IDENTITY_VERIFICATION_REQUIRED'
      | 'MATCHING_PACKAGE_REQUIRED'
      | 'INSUFFICIENT_AVAILABLE_SESSION'
      | 'SLOT_FULL'
      | 'SLOT_UNAVAILABLE'
      | 'BOOKING_CUTOFF_PASSED'
      | null = null;
    let requiredAction:
      | 'COMPLETE_IDENTITY_VERIFICATION'
      | 'BUY_MATCHING_PACKAGE'
      | 'CONTACT_STUDIO'
      | null = null;

    const isStaff =
      principal.roles.some((r) => ['ADMIN', 'SUPER_OWNER', 'OWNER', 'MANAGER'].includes(r.role as any)) ||
      principal.capabilities.includes('booking:create:assisted');

    if (!['PUBLISHED', 'CONFIRMED'].includes(slot.status)) {
      canBook = false;
      reasonCode = 'SLOT_UNAVAILABLE';
      requiredAction = 'CONTACT_STUDIO';
    } else if (isStaff ? slot.endAt <= now : (slot.startAt <= now || now >= cutoffAt)) {
      canBook = false;
      reasonCode = isStaff ? 'SLOT_UNAVAILABLE' : 'BOOKING_CUTOFF_PASSED';
      requiredAction = 'CONTACT_STUDIO';
    } else if (terisi(slot) >= slot.capacity) {
      canBook = false;
      reasonCode = 'SLOT_FULL';
      requiredAction = 'CONTACT_STUDIO';
    } else if (eligiblePackages.length === 0) {
      canBook = false;
      if (items.length > 0) {
        reasonCode = 'INSUFFICIENT_AVAILABLE_SESSION';
        requiredAction = 'BUY_MATCHING_PACKAGE';
      } else {
        reasonCode = 'MATCHING_PACKAGE_REQUIRED';
        requiredAction = 'BUY_MATCHING_PACKAGE';
      }
    }

    if (canBook) {
      try {
        const unverifiedDoc = await (this.db as any).dokumenVerifikasiIdentitas?.findFirst?.({
          where: {
            userId: principal.userId,
            kind: { in: ['KTP_FRONT', 'SELFIE'] },
            status: { not: 'APPROVED' },
          },
        });
        if (unverifiedDoc) {
          canBook = false;
          reasonCode = 'IDENTITY_VERIFICATION_REQUIRED';
          requiredAction = 'COMPLETE_IDENTITY_VERIFICATION';
        }
      } catch {
        // Abaikan jika tabel tidak aktif
      }
    }

    return {
      slot: {
        id: slot.id,
        branchId: slot.branchId,
        classTypeId: slot.classTypeId,
        startAt: slot.startAt,
        endAt: slot.endAt,
        timezone: slot.branch?.timezone ?? 'Asia/Jakarta',
        status: slot.status,
        capacity: slot.capacity,
        bookedCount: terisi(slot),
        available: Math.max(0, slot.capacity - terisi(slot)),
        branch: slot.branch,
        classType: slot.classType,
        instructor: slot.instructor ? { displayName: slot.instructor.displayName } : null,
        studio: slot.studio ? { name: slot.studio.name } : null,
        room: slot.room ? { name: slot.room.name } : null,
      },
      packages: eligiblePackages,
      eligibility: {
        canBook,
        reasonCode,
        requiredAction,
        cutoffAt,
      },
      classSlotId: slot.id,
      classType: slot.classType,
      branch: slot.branch,
    };
  }

  async list(
    principal: SessionPrincipal,
    query: {
      branchId?: string;
      status?: string;
      cursor?: string;
      page?: number;
      timeline?: string;
      q?: string;
      from?: string;
      until?: string;
      classSlotId?: string;
      customerId?: string;
      limit?: number;
      includeHistorical?: boolean;
    } = {},
  ) {
    const customerFlow = this.isCustomer(principal);
    const instructorFlow = isInstructorRosterPrincipal(principal);
    const targetUserId = customerFlow ? principal.userId : query.customerId;
    const limit = Math.min(query.limit ?? PAGE_SIZE, 100);
    const pageNumber = query.page && Number(query.page) > 0 ? Number(query.page) : undefined;
    if (query.cursor && !UUID.test(query.cursor))
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY);

    const classSlotFilter: Prisma.SlotKelasWhereInput = {};
    let resolvedBranchId: Prisma.StringNullableFilter | string | undefined = undefined;
    if (customerFlow) {
      if (query.branchId) resolvedBranchId = query.branchId;
    } else if (instructorFlow) {
      classSlotFilter.instructorId = principal.userId;
      if (query.branchId) {
        if (!principal.branchIds?.includes(query.branchId)) {
          throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
        }
        resolvedBranchId = query.branchId;
      }
    } else {
      const branchScope = this.staffBranchScope(principal, query.branchId);
      if (branchScope) resolvedBranchId = branchScope;
    }
    if (query.from || query.until) {
      classSlotFilter.startAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.until ? { lte: new Date(query.until) } : {}),
      };
    }

    // Kondisi dasar dipakai bersama oleh daftar dan ringkasan (KPI): tanpa filter status,
    // timeline, maupun cursor, agar kartu KPI menunjukkan sebaran seluruh hasil pencarian.
    const conditions: Prisma.PemesananKelasWhereInput[] = [];
    if (query.q?.trim()) {
      const q = query.q.trim();
      let userIds: string[] = [];
      if (typeof this.db.user?.findMany === 'function') {
        const matchedUsers = await this.db.user.findMany({
          where: { displayName: { contains: q } },
          select: { id: true },
          take: 100,
        });
        userIds = matchedUsers.map((u) => u.id);
      }
      conditions.push({
        OR: [
          { bookingNumber: { contains: q } },
          ...(userIds.length > 0
            ? [{ userId: { in: userIds } }]
            : [{ user: { displayName: { contains: q } } }]),
        ],
      });
    }
    const baseWhere: Prisma.PemesananKelasWhereInput = {
      ...(targetUserId ? { userId: targetUserId } : {}),
      ...(resolvedBranchId ? { branchId: resolvedBranchId } : {}),
      ...(query.classSlotId ? { classSlotId: query.classSlotId } : {}),
      ...(Object.keys(classSlotFilter).length > 0 ? { classSlot: classSlotFilter } : {}),
      ...(conditions.length > 0 ? { AND: conditions } : {}),
    };

    const listConditions = [...conditions];
    if (query.timeline === 'UPCOMING') {
      listConditions.push({ classSlot: { startAt: { gte: new Date() } } });
    } else if (query.timeline === 'HISTORY') {
      listConditions.push({
        OR: [
          { status: { in: ['ATTENDED', 'CANCELLED'] } },
          { classSlot: { endAt: { lt: new Date() } } },
        ],
      });
    }
    const where: Prisma.PemesananKelasWhereInput = {
      ...baseWhere,
      ...(query.timeline === 'UPCOMING'
        ? { status: 'BOOKED' }
        : query.status
          ? { status: query.status as BookingStatus }
          : {}),
      ...(listConditions.length > 0 ? { AND: listConditions } : {}),
    };
    const orderBy: Prisma.PemesananKelasOrderByWithRelationInput[] =
      query.timeline === 'UPCOMING'
        ? [{ classSlot: { startAt: 'asc' } }, { id: 'asc' }]
        : [{ bookedAt: 'desc' }, { id: 'desc' }];

    const rescheduleWhere: Prisma.UbahJadwalWhereInput =
      Object.keys(baseWhere).length === 0
        ? { status: 'PENDING' }
        : { status: 'PENDING', booking: baseWhere };

    const hasSpecialFilter = Boolean(query.q?.trim() || query.timeline || query.classSlotId);
    const needDistinctCount =
      hasSpecialFilter ||
      (query.status && !['BOOKED', 'ATTENDED', 'CANCELLED', 'NO_SHOW'].includes(query.status));

    const [statusGroups, reschedulePending, explicitCount] = await Promise.all([
      this.db.pemesananKelas.groupBy({
        by: ['status'],
        where: baseWhere,
        _count: { _all: true },
      }),
      this.db.ubahJadwal.count({ where: rescheduleWhere }),
      needDistinctCount
        ? typeof this.db.pemesananKelas.count === 'function'
          ? this.db.pemesananKelas.count({ where })
          : Promise.resolve(0)
        : Promise.resolve(null),
    ]);

    const statusCount = (status: BookingStatus) =>
      statusGroups.find((group) => group.status === status)?._count._all ?? 0;
    const allStatusTotal = statusGroups.reduce((sum, group) => sum + group._count._all, 0);

    const totalFiltered =
      explicitCount !== null
        ? explicitCount
        : query.status
          ? statusCount(query.status as BookingStatus)
          : allStatusTotal;

    const skipCount = pageNumber ? (pageNumber - 1) * limit : 0;
    const isOutOfBounds = Boolean(pageNumber && skipCount >= totalFiltered);

    const paginationArgs = pageNumber
      ? { skip: skipCount, take: limit }
      : {
          take: limit + 1,
          ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        };

    const items = isOutOfBounds
      ? []
      : await this.db.pemesananKelas.findMany({
      where,
      ...paginationArgs,
      include: {
        user: true,
        classSlot: {
          include: {
            branch: true,
            classType: true,
            instructor: true,
            studio: true,
          },
        },
        customerPackage: {
          include: { package: true, user: true },
        },
        attendance: true,
        checkInTokens: { take: 1, orderBy: { createdAt: 'desc' } },
      },
      orderBy,
    });

    const total = totalFiltered || (pageNumber ? items.length : (items.length > limit ? limit : items.length));
    const totalPages = Math.ceil(total / limit) || 1;
    const hasNext = pageNumber ? pageNumber < totalPages : items.length > limit;
    const pageItems = pageNumber ? items : (items.length > limit ? items.slice(0, limit) : items);
    const nextCursor = hasNext ? (pageItems[pageItems.length - 1]?.id ?? null) : null;
    const reserved = await this.reservedByPackage(pageItems.map((b: any) => b.customerPackageId));

    return {
      items: pageItems.map((b) => this.bookingView(b, reserved)),
      page: query.page != null
        ? {
            hasMore: hasNext,
            nextCursor,
            current: pageNumber ?? 1,
            total,
            totalPages,
            pageSize: limit,
          }
        : { hasMore: hasNext, nextCursor },
      total,
      currentPage: pageNumber ?? 1,
      totalPages,
      pageSize: limit,
      nextCursor,
      summary: {
        total: statusGroups.reduce((sum, group) => sum + group._count._all, 0),
        booked: statusCount('BOOKED'),
        attended: statusCount('ATTENDED'),
        cancelled: statusCount('CANCELLED'),
        noShow: statusCount('NO_SHOW'),
        reschedulePending,
      },
    };
  }

  async detail(principal: SessionPrincipal, id: string) {
    if (!UUID.test(id)) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const customerFlow = this.isCustomer(principal);
    if (!customerFlow) this.policy.requireCapability(principal.capabilities, 'booking:read');

    const booking = await this.db.pemesananKelas.findUnique({
      where: { id },
      include: {
        user: true,
        classSlot: {
          include: {
            branch: true,
            classType: true,
            instructor: true,
            studio: true,
          },
        },
        customerPackage: {
          include: { package: true, user: true },
        },
        attendance: true,
        checkInTokens: { take: 1, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!booking) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (customerFlow && booking.userId !== principal.userId)
      throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (!customerFlow) this.requireBranch(principal, booking.classSlot.branchId, 'booking:read');

    return this.bookingView(booking, await this.reservedByPackage([booking.customerPackageId]));
  }

  async create(
    principal: SessionPrincipal,
    input: BookingCommand,
    key: string,
    _correlationId: string,
  ) {
    if (this.isCustomer(principal)) await this.requireVerifiedCustomer(principal);
    const customerFlow = input.source === 'SELF';
    if (
      !key ||
      !UUID.test(input.classSlotId) ||
      !UUID.test(input.customerPackageId) ||
      !['SELF', 'ADMIN_ASSISTED'].includes(input.source) ||
      (customerFlow && input.customerUserId && input.customerUserId !== principal.userId) ||
      (!customerFlow && (!input.customerUserId || !UUID.test(input.customerUserId)))
    )
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST);

    this.policy.requireCapability(
      principal.capabilities,
      customerFlow ? 'booking:self:create' : 'booking:create:assisted',
    );
    const customerUserId = customerFlow ? principal.userId : input.customerUserId!;
    const policy = this.syntheticPolicy();

    return this.idempotency.execute(
      {
        scope: `booking-create:${principal.userId}`,
        key,
        payload: { ...input, customerUserId },
        ttlMs: 86_400_000,
        leaseMs: 30_000,
      },
      async (tx) => {
        // Kunci baris slot_kelas secara eksklusif (pessimistic lock) untuk mencegah race condition & overbooking
        await tx.$queryRaw`SELECT id FROM slot_kelas WHERE id = ${input.classSlotId} FOR UPDATE`;

        const slot = await tx.slotKelas.findUnique({
          where: { id: input.classSlotId },
          include: { branch: true, classType: true, instructor: true, studio: true },
        });
        if (!slot) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
        if (!customerFlow)
          this.requireBranch(principal, slot.branchId, 'booking:create:assisted');

        const [customerPackage, customer] = await Promise.all([
          tx.paketPelanggan.findUnique({
            where: { id: input.customerPackageId },
            include: { package: true, purchase: true, sharedMembers: true },
          }),
          tx.user.findUnique({ where: { id: customerUserId } }),
        ]);

        if (!customerPackage || !customer || customer.status !== 'ACTIVE')
          throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

        const isOwner = customerPackage.userId === customerUserId;
        const isAuthorizedSharedMember =
          !isOwner &&
          Boolean(customerPackage.package?.isShareable) &&
          customerPackage.sharedMembers?.some((sm) => sm.userId === customerUserId);

        if (!isOwner && !isAuthorizedSharedMember)
          throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
        if (
          (customerPackage.purchase && customerPackage.purchase.status !== 'PAID') ||
          (customerPackage.purchaseId && (!customerPackage.purchase || customerPackage.purchase.status !== 'PAID'))
        ) {
          throw new ApiProblem('PURCHASE_NOT_PAID', HttpStatus.CONFLICT);
        }
        const now = new Date();
        const slotPast = slot.endAt <= now;
        const isPrivilegedStaff =
          principal.roles?.some((r) =>
            ['SUPER_OWNER', 'ADMIN', 'OWNER', 'MANAGER'].includes(r.role as any),
          ) || principal.capabilities?.includes('class-slot:manage');

        // Untuk backdated booking oleh Admin/Super Owner, paket cukup valid saat jadwal kelas berlangsung
        const packageExpired = isPrivilegedStaff && slotPast
          ? customerPackage.validUntil <= slot.startAt
          : customerPackage.validUntil <= now;
        if (customerPackage.status !== 'ACTIVE' || packageExpired)
          throw new ApiProblem('INSUFFICIENT_AVAILABLE_SESSIONS', HttpStatus.CONFLICT);

        // Validasi kecocokan cabang & jenis kelas paket (Integritas Aturan Bisnis)
        if (!paketBerlakuDi(customerPackage, slot.branchId)) {
          throw new ApiProblem('PACKAGE_BRANCH_MISMATCH', HttpStatus.CONFLICT);
        }
        if (
          customerPackage.package?.classTypeId &&
          customerPackage.package.classTypeId !== slot.classTypeId
        ) {
          throw new ApiProblem('PACKAGE_CLASS_TYPE_MISMATCH', HttpStatus.CONFLICT);
        }

        // Periksa sisa sesi dikurangi booking aktif (Rule #1 & #2: sesi fisik belum dipotong)
        const activeBookingsCount = await tx.pemesananKelas.count({
          where: {
            customerPackageId: customerPackage.id,
            status: 'BOOKED',
          },
        });
        if (customerPackage.remainingSessions - activeBookingsCount <= 0)
          throw new ApiProblem('INSUFFICIENT_AVAILABLE_SESSIONS', HttpStatus.CONFLICT);

        if (!['PUBLISHED', 'CONFIRMED'].includes(slot.status))
          throw new ApiProblem('INVALID_STATE_TRANSITION', HttpStatus.CONFLICT);

        if (customerFlow) {
          if (slot.startAt <= now)
            throw new ApiProblem('BOOKING_CUTOFF_PASSED', HttpStatus.CONFLICT);
          const effectiveCutoffHours = slot.bookingCutoffHours ?? policy.cutoffHours;
          const cutoffAt = new Date(slot.startAt.getTime() - effectiveCutoffHours * 3_600_000);
          if (now >= cutoffAt) throw new ApiProblem('BOOKING_CUTOFF_PASSED', HttpStatus.CONFLICT);
        } else {
          // Staf biasa diblokir jika kelas sudah selesai; Admin / Super Owner diizinkan backdated booking
          if (slotPast && !isPrivilegedStaff)
            throw new ApiProblem('CLASS_ALREADY_FINISHED', HttpStatus.CONFLICT);
        }

        const duplicate = await tx.pemesananKelas.findFirst({
          where: {
            userId: customerUserId,
            classSlotId: slot.id,
            status: { in: ['BOOKED', 'ATTENDED'] },
          },
        });
        if (duplicate) throw new ApiProblem('DUPLICATE_ACTIVE_BOOKING', HttpStatus.CONFLICT);

        // Pencegahan booking ganda lintas kelas dengan jadwal bertabrakan (Overlapping Schedule)
        const scheduleConflict = await tx.pemesananKelas.findFirst({
          where: {
            userId: customerUserId,
            status: { in: ['BOOKED', 'ATTENDED'] },
            classSlotId: { not: slot.id },
            classSlot: {
              startAt: { lt: slot.endAt },
              endAt: { gt: slot.startAt },
            },
          },
        });
        if (scheduleConflict) {
          throw new ApiProblem('SCHEDULE_CONFLICT', HttpStatus.CONFLICT);
        }

        const currentSlot = await tx.slotKelas.findUnique({
          where: { id: slot.id },
          select: { bookedCount: true, capacity: true },
        });

        // Hitung riil booking aktif di database untuk memastikan tidak ada selisih/drift kuota
        const activeBookingsOnSlot =
          typeof tx.pemesananKelas?.count === 'function'
            ? await tx.pemesananKelas.count({
                where: {
                  classSlotId: slot.id,
                  status: { in: [...STATUS_MENEMPATI_KURSI] },
                },
              })
            : (currentSlot?.bookedCount ?? 0);
        // Hanya booking yang benar-benar ada: penghitung lama bisa membengkak (sinkronisasi V1) dan
        // membuat kelas tampak penuh. Menyimpan hitungan riil di bawah juga memulihkan penghitungnya.
        const effectiveBooked = activeBookingsOnSlot;
        if (!currentSlot || effectiveBooked >= currentSlot.capacity)
          throw new ApiProblem('CLASS_CAPACITY_FULL', HttpStatus.CONFLICT);

        const bookingNumber = `BK-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
        const booking = await tx.pemesananKelas.create({
          data: {
            id: randomUUID(),
            bookingNumber,
            classSlotId: slot.id,
            branchId: slot.branchId,
            userId: customerUserId,
            customerPackageId: customerPackage.id,
            status: 'BOOKED',
            source: input.source,
          },
          include: {
            user: true,
            classSlot: {
              include: { branch: true, classType: true, instructor: true, studio: true },
            },
            customerPackage: { include: { package: true } },
            attendance: true,
            checkInTokens: true,
          },
        });

        // Catatan: Sesi TIDAK dipotong saat booking (Rule #1).
        // Pemotongan sesi ke SessionLedger & PaketPelanggan dieksekusi saat kelas COMPLETED dan customer hadir.

        // Tambah bookedCount disinkronkan dengan kuota efektif aktual (mencegah overcapacity 5/4, 6/4)
        // Bila kelas ini jadwal masa lalu (endAt <= now) dan masih PUBLISHED, otomatis konfirmasi agar presensi & completion dapat dilakukan staf
        const shouldAutoConfirm = slotPast && slot.status === 'PUBLISHED';
        await tx.slotKelas.update({
          where: { id: slot.id },
          data: {
            bookedCount: effectiveBooked + 1,
            ...(shouldAutoConfirm ? { status: 'CONFIRMED' } : {}),
          },
        });

        // Booking atas nama pelanggan oleh staf dicatat permanen; booking mandiri sudah punya jejak di data booking.
        if (!customerFlow)
          await this.audit?.catat(tx, {
            actorId: principal.userId,
            branchId: slot.branchId,
            correlationId: _correlationId,
            action: slotPast ? 'booking.backdated_by_staff' : 'booking.created_by_staff',
            objectType: 'Booking',
            objectId: booking.id,
            targetUserId: customerUserId,
            afterMasked: {
              bookingNumber,
              classSlotId: slot.id,
              customerPackageId: customerPackage.id,
              backdated: slotPast,
            },
          });

        return {
          status: HttpStatus.CREATED,
          body: this.bookingView(booking) as unknown as Prisma.InputJsonValue,
        };
      },
    );
  }
  /**
   * Alur Cepat Walk-In & Booking Kasir (One-Stop Walk-In Flow):
   * Mencatat pembayaran kasir studio (CASH/CARD/QRIS) yang langsung masuk antrean verifikasi Manager,
   * sekaligus memberikan Instant Reserve Sesi Pertama (Confirmed Seat) agar member walk-in tidak
   * terhalang masuk kelas yang segera berlangsung di studio.
   */
  async walkIn(
    principal: SessionPrincipal,
    input: WalkInCommand,
    key: string,
    _correlationId: string,
  ) {
    if (
      !key ||
      !UUID.test(input.branchId) ||
      !UUID.test(input.classSlotId) ||
      !UUID.test(input.customerUserId) ||
      !UUID.test(input.packageId)
    ) {
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST);
    }

    this.policy.requireCapability(principal.capabilities, 'booking:create:assisted');
    this.requireBranch(principal, input.branchId, 'booking:create:assisted');

    const paymentMethod = (input.paymentMethod || 'CASH') as PaymentMethod;
    if (!Object.values(PaymentMethod).includes(paymentMethod)) {
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST);
    }

    return this.idempotency.execute(
      {
        scope: `walk-in:${input.branchId}:${input.classSlotId}:${input.customerUserId}`,
        key,
        payload: input,
        ttlMs: 86_400_000,
        leaseMs: 30_000,
      },
      async (tx) => {
        const customer = await tx.user.findUnique({
          where: { id: input.customerUserId },
        });
        if (!customer || customer.role !== 'CUSTOMER' || customer.status !== 'ACTIVE') {
          throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
        }

        const slot = await tx.slotKelas.findUnique({
          where: { id: input.classSlotId },
          include: { branch: true, classType: true, instructor: true, studio: true },
        });
        if (!slot || slot.branchId !== input.branchId) {
          throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
        }

        if (!['PUBLISHED', 'CONFIRMED'].includes(slot.status)) {
          throw new ApiProblem('INVALID_STATE_TRANSITION', HttpStatus.CONFLICT);
        }

        const now = new Date();
        const slotPast = slot.endAt <= now;
        const isPrivilegedStaff =
          principal.roles?.some((r) =>
            ['SUPER_OWNER', 'ADMIN', 'OWNER', 'MANAGER'].includes(r.role as any),
          ) || principal.capabilities?.includes('class-slot:manage');

        if (slotPast && !isPrivilegedStaff) {
          throw new ApiProblem('CLASS_ALREADY_ENDED', HttpStatus.CONFLICT);
        }

        const duplicate = await tx.pemesananKelas.findFirst({
          where: {
            userId: customer.id,
            classSlotId: slot.id,
            status: { in: ['BOOKED', 'ATTENDED'] },
          },
        });
        if (duplicate) {
          throw new ApiProblem('DUPLICATE_ACTIVE_BOOKING', HttpStatus.CONFLICT);
        }

        const activeBookingsOnSlot =
          typeof tx.pemesananKelas?.count === 'function'
            ? await tx.pemesananKelas.count({
                where: {
                  classSlotId: slot.id,
                  status: { in: [...STATUS_MENEMPATI_KURSI] },
                },
              })
            : (slot.bookedCount ?? 0);
        if (activeBookingsOnSlot >= slot.capacity) {
          throw new ApiProblem('CLASS_CAPACITY_FULL', HttpStatus.CONFLICT);
        }

        const pkg = await tx.paket.findUnique({
          where: { id: input.packageId },
        });
        if (!pkg || pkg.status !== 'ACTIVE') {
          throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
        }
        if (pkg.branchId && pkg.branchId !== input.branchId) {
          throw new ApiProblem('PACKAGE_BRANCH_MISMATCH', HttpStatus.UNPROCESSABLE_ENTITY);
        }
        if (pkg.classTypeId && pkg.classTypeId !== slot.classTypeId) {
          throw new ApiProblem('PACKAGE_CLASS_TYPE_MISMATCH', HttpStatus.UNPROCESSABLE_ENTITY);
        }

        // 1. Catat Pembelian Kasir (Status PENDING untuk antrean Maker-Checker Manager)
        const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
        const note = input.paymentNote?.trim() || 'Walk-in kasir meja depan (Instant Reserve)';
        const order = await tx.pembelian.create({
          data: {
            id: randomUUID(),
            invoiceNumber,
            userId: customer.id,
            branchId: input.branchId,
            packageId: pkg.id,
            subtotalRp: pkg.priceRp,
            discountRp: 0,
            totalAmountRp: pkg.priceRp,
            status: 'PENDING',
            paymentMethod,
            paymentExpiresAt: null,
            recordedById: principal.userId,
            recordNote: note,
          },
        });

        // 2. Buat Paket Pelanggan Aktif (Instant Reserve Sesi Pertama)
        const durationDays = pkg.validityDays || 30;
        const validUntil = new Date(now.getTime() + durationDays * 86_400_000);
        const customerPackage = await tx.paketPelanggan.create({
          data: {
            id: randomUUID(),
            userId: customer.id,
            packageId: pkg.id,
            purchaseId: order.id,
            totalSessions: pkg.sessionCount,
            remainingSessions: pkg.sessionCount,
            usedSessions: 0,
            validFrom: now,
            validUntil,
            status: 'ACTIVE',
          },
        });

        // 3. Catat Saldo Awal ke SessionLedger
        await tx.sessionLedger.create({
          data: {
            id: randomUUID(),
            customerPackageId: customerPackage.id,
            type: SessionMutationType.PURCHASE,
            amount: pkg.sessionCount,
            balanceAfter: pkg.sessionCount,
            referenceId: order.id,
            notes: `Saldo awal walk-in kasir meja depan #${invoiceNumber}`,
            createdById: principal.userId,
          },
        });

        // 4. Daftarkan Booking Peserta ke Kelas Hari Ini (Confirmed Seat / BOOKED)
        const bookingNumber = `BK-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
        const booking = await tx.pemesananKelas.create({
          data: {
            id: randomUUID(),
            bookingNumber,
            classSlotId: slot.id,
            branchId: slot.branchId,
            userId: customer.id,
            customerPackageId: customerPackage.id,
            status: 'BOOKED',
            source: 'ADMIN_ASSISTED',
          },
          include: {
            user: true,
            classSlot: {
              include: { branch: true, classType: true, instructor: true, studio: true },
            },
            customerPackage: { include: { package: true } },
            attendance: true,
            checkInTokens: true,
          },
        });

        // 5. Update Kuota Terisi
        const shouldAutoConfirm = slotPast && slot.status === 'PUBLISHED';
        await tx.slotKelas.update({
          where: { id: slot.id },
          data: {
            bookedCount: activeBookingsOnSlot + 1,
            ...(shouldAutoConfirm ? { status: 'CONFIRMED' } : {}),
          },
        });

        // 6. Audit Log
        await this.audit?.catat(tx, {
          actorId: principal.userId,
          branchId: slot.branchId,
          correlationId: _correlationId,
          action: slotPast ? 'booking.backdated_by_staff_walkin' : 'booking.created_by_staff_walkin',
          objectType: 'Booking',
          objectId: booking.id,
          targetUserId: customer.id,
          afterMasked: {
            bookingNumber,
            classSlotId: slot.id,
            customerPackageId: customerPackage.id,
            backdated: slotPast,
          },
        });

        return {
          status: HttpStatus.CREATED,
          body: {
            booking: this.bookingView(booking),
            purchase: {
              id: order.id,
              invoiceNumber: order.invoiceNumber,
              status: order.status,
              totalAmountRp: order.totalAmountRp,
              paymentMethod: order.paymentMethod,
            },
            customerPackage: {
              id: customerPackage.id,
              totalSessions: customerPackage.totalSessions,
              remainingSessions: customerPackage.remainingSessions,
              validUntil: customerPackage.validUntil.toISOString(),
            },
          } as unknown as Prisma.InputJsonValue,
        };
      },
    );
  }
}
