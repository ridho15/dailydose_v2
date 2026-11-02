import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { AuditService } from '../foundation/audit.service';
import { maskContactEmail, maskContactPhone, relatedCustomerIdsById, staffBranchScope } from '../identity/customer-visibility';
import { Prisma, type RescheduleStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { RuntimeConfigService } from '../configuration/runtime-config.service';
import { PrismaService } from '../database/prisma.service';
import { IdempotencyService } from '../foundation/idempotency.service';
import type { SessionPrincipal } from '../identity/identity.service';
import { PolicyService } from '../identity/policy.service';
import { ApiProblem, ENTITY_ID_REGEX } from '../identity/security';
import { HITUNG_TERISI, terisi } from '../classes/terisi';
import { paketBerlakuDi } from './cabang-paket';

export type RescheduleRequestReasonCode =
  | 'CUSTOMER_SCHEDULE_CONFLICT'
  | 'WRONG_CLASS_SELECTED'
  | 'PERSONAL_UNAVAILABLE'
  | 'OTHER';

export type RescheduleDecisionReasonCode =
  | 'ELIGIBILITY_VERIFIED'
  | 'TARGET_UNAVAILABLE'
  | 'OUTSIDE_POLICY'
  | 'OUT_OF_SCOPE'
  | 'OTHER';

export type RescheduleRequestCommand = {
  bookingId: string;
  targetClassSlotId: string;
  reasonCode: RescheduleRequestReasonCode;
  expectedBookingVersion?: number;
};

export type RescheduleDecisionCommand = {
  reasonCode: RescheduleDecisionReasonCode;
  expectedVersion?: number;
};

const UUID = ENTITY_ID_REGEX;
const REQUEST_CODES: RescheduleRequestReasonCode[] = [
  'CUSTOMER_SCHEDULE_CONFLICT',
  'WRONG_CLASS_SELECTED',
  'PERSONAL_UNAVAILABLE',
  'OTHER',
];
const PAGE_SIZE = 20;

export function isRescheduleEntitled(
  sourceStartAt: Date,
  evaluatedAt: Date,
  cutoffHours: number,
): boolean {
  return evaluatedAt.getTime() <= sourceStartAt.getTime() - cutoffHours * 3_600_000;
}

@Injectable()
export class ReschedulesService {
  constructor(
    private readonly db: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly policy: PolicyService,
    private readonly config: RuntimeConfigService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private syntheticPolicy() {
    const booking = this.config.value.booking;
    const reschedule = this.config.value.reschedule;
    if (
      !booking.enabled ||
      booking.cutoffHours === null ||
      !reschedule.enabled ||
      reschedule.cutoffHours === null
    )
      throw new ApiProblem('CONFIGURATION_REQUIRED', HttpStatus.SERVICE_UNAVAILABLE);
    return { bookingCutoffHours: booking.cutoffHours, cutoffHours: reschedule.cutoffHours };
  }

  private requireBranch(principal: SessionPrincipal, branchId: string, capability: string) {
    if (
      !this.policy.hasCapability(principal, 'branch:all', branchId) &&
      !this.policy.hasCapability(principal, capability, branchId)
    )
      throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
  }

  async options(principal: SessionPrincipal, bookingId: string) {
    this.policy.requireCapability(principal.capabilities, 'reschedule:self:read');
    if (!UUID.test(bookingId)) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const policy = this.syntheticPolicy();

    const booking = await this.db.pemesananKelas.findFirst({
      where: { id: bookingId, userId: principal.userId },
      include: {
        classSlot: {
          include: {
            branch: { select: { id: true, name: true, timezone: true } },
            classType: { select: { id: true, name: true } },
          },
        },
        customerPackage: {
          include: { package: true },
        },
        reschedules: { orderBy: { requestedAt: 'desc' }, take: 1 },
      },
    });
    if (!booking) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

    const now = new Date();
    const cutoffAt = new Date(booking.classSlot.startAt.getTime() - policy.cutoffHours * 3_600_000);
    const latestRequest = booking.reschedules[0] ?? null;
    const pending = latestRequest?.status === 'PENDING';

    const unavailableReason =
      booking.status !== 'BOOKED'
        ? 'BOOKING_NOT_ACTIVE'
        : pending
          ? 'RESCHEDULE_PENDING'
          : !isRescheduleEntitled(booking.classSlot.startAt, now, policy.cutoffHours)
            ? 'RESCHEDULE_CUTOFF_PASSED'
            : null;

    const availableSlots = await this.db.slotKelas.findMany({
      where: {
        id: { not: booking.classSlotId },
        branchId: booking.classSlot.branchId,
        classTypeId: booking.classSlot.classTypeId,
        status: { in: ['PUBLISHED', 'CONFIRMED'] },
        startAt: { gt: now },
      },
      include: {
        classType: { select: { id: true, name: true } },
        instructor: { select: { id: true, displayName: true } },
        studio: { select: { id: true, name: true } },
        ...HITUNG_TERISI,
      },
      orderBy: { startAt: 'asc' },
      take: 20,
    });

    const customerBookings = await this.db.pemesananKelas.findMany({
      where: {
        userId: principal.userId,
        status: { in: ['BOOKED', 'ATTENDED'] },
        id: { not: booking.id },
      },
      select: {
        classSlotId: true,
        classSlot: { select: { startAt: true, endAt: true } },
      },
    });

    const targets = availableSlots.map((slot) => {
      // Kursi terisi dari booking nyata; kolom bookedCount bisa melenceng (sinkronisasi V1).
      const remaining = Math.max(0, slot.capacity - terisi(slot));
      const duplicate = customerBookings.some((b) => b.classSlotId === slot.id);
      const conflict = customerBookings.some(
        (b) => b.classSlot.startAt < slot.endAt && b.classSlot.endAt > slot.startAt,
      );
      const eligible = remaining > 0 && !duplicate && !conflict;
      const ineligibilityReason =
        remaining <= 0
          ? 'SLOT_FULL'
          : duplicate
            ? 'DUPLICATE_BOOKING'
            : conflict
              ? 'SCHEDULE_CONFLICT'
              : null;
      return {
        id: slot.id,
        startAt: slot.startAt,
        endAt: slot.endAt,
        timezone: booking.classSlot.branch.timezone,
        capacity: slot.capacity,
        bookedCount: terisi(slot),
        available: remaining,
        availableCapacity: remaining,
        eligible,
        ineligibilityReason,
        classType: slot.classType,
        instructor: slot.instructor,
        studio: slot.studio,
      };
    });

    const canRequest = unavailableReason === null && targets.some((t) => t.eligible);
    const supportAction =
      unavailableReason === 'RESCHEDULE_CUTOFF_PASSED' ? 'CONTACT_STUDIO' : null;

    return {
      bookingId: booking.id,
      bookingVersion: 1,
      cutoffAt,
      canReschedule: unavailableReason === null,
      canRequest,
      supportAction,
      unavailableReason: canRequest ? null : unavailableReason ?? (targets.length === 0 ? 'NO_ELIGIBLE_TARGET' : null),
      source: {
        id: booking.classSlot.id,
        startAt: booking.classSlot.startAt,
        endAt: booking.classSlot.endAt,
        branch: booking.classSlot.branch,
        classType: booking.classSlot.classType,
      },
      latestRequest,
      targets,
    };
  }

  async list(
    principal: SessionPrincipal,
    query: { branchId?: string; status?: string; cursor?: string } = {},
  ) {
    const customer = principal.capabilities.includes('reschedule:self:read');
    this.policy.requireCapability(
      principal.capabilities,
      customer ? 'reschedule:self:read' : 'reschedule:read',
    );

    // Staf hanya melihat permintaan yang menyentuh cabangnya (asal atau tujuan); lintas cabang melihat semuanya.
    const staffScope = customer ? 'ALL' : staffBranchScope(principal);
    const items = await this.db.ubahJadwal.findMany({
      where: {
        ...(customer ? { requestedById: principal.userId } : {}),
        ...(query.status ? { status: query.status as RescheduleStatus } : {}),
        AND: [
          ...(staffScope === 'ALL'
            ? []
            : [
                {
                  OR: [
                    { sourceSlot: { branchId: { in: staffScope } } },
                    { targetSlot: { branchId: { in: staffScope } } },
                  ],
                },
              ]),
          ...(query.branchId
            ? [
                {
                  OR: [
                    { sourceSlot: { branchId: query.branchId } },
                    { targetSlot: { branchId: query.branchId } },
                  ],
                },
              ]
            : []),
        ],
      },
      include: {
        booking: {
          include: {
            user: { select: { id: true, displayName: true, email: true, phone: true } },
            customerPackage: {
              include: { package: { select: { id: true, name: true } } },
            },
          },
        },
        sourceSlot: {
          include: {
            classType: { select: { id: true, name: true } },
            branch: { select: { id: true, name: true, timezone: true } },
          },
        },
        targetSlot: {
          include: {
            classType: { select: { id: true, name: true } },
            branch: { select: { id: true, name: true, timezone: true } },
          },
        },
      },
      orderBy: { requestedAt: 'desc' },
      take: PAGE_SIZE,
    });

    // Kontak pelanggan yang belum berkaitan dengan cabang staf (mis. hanya slot tujuannya di sini) disamarkan.
    const visible = customer
      ? new Set(items.map((item) => item.booking.user.id))
      : await relatedCustomerIdsById(this.db, principal, items.map((item) => item.booking.user.id));

    return {
      items: items.map((item) => ({
        id: item.id,
        bookingId: item.bookingId,
        sourceClassSlotId: item.sourceSlotId,
        targetClassSlotId: item.targetSlotId,
        requestedById: item.requestedById,
        status: item.status,
        reason: item.reason,
        requestedAt: item.requestedAt,
        version: 1,
        branch: item.targetSlot.branch,
        customer: visible.has(item.booking.user.id)
          ? { ...item.booking.user, contactMasked: false }
          : {
              ...item.booking.user,
              email: maskContactEmail(item.booking.user.email),
              phone: maskContactPhone(item.booking.user.phone),
              contactMasked: true,
            },
        package: item.booking.customerPackage?.package ?? null,
        sourceClassSlot: item.sourceSlot,
        targetClassSlot: item.targetSlot,
      })),
      page: {
        hasMore: false,
        nextCursor: null,
      },
    };
  }

  async request(
    principal: SessionPrincipal,
    input: RescheduleRequestCommand,
    key: string,
    _correlationId: string,
  ) {
    if (
      !key ||
      !UUID.test(input.bookingId) ||
      !UUID.test(input.targetClassSlotId) ||
      !REQUEST_CODES.includes(input.reasonCode)
    )
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST);

    this.policy.requireCapability(principal.capabilities, 'reschedule:self:request');
    const policy = this.syntheticPolicy();

    return this.idempotency.execute(
      {
        scope: `reschedule-request:${principal.userId}:${input.bookingId}`,
        key,
        payload: input,
        ttlMs: 86_400_000,
        leaseMs: 30_000,
      },
      async (tx) => {
        const booking = await tx.pemesananKelas.findUnique({
          where: { id: input.bookingId },
          include: {
            classSlot: true,
            customerPackage: { include: { package: true, purchase: true } },
            user: true,
          },
        });
        if (!booking || booking.userId !== principal.userId || booking.status !== 'BOOKED')
          throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

        const now = new Date();
        if (!isRescheduleEntitled(booking.classSlot.startAt, now, policy.cutoffHours))
          throw new ApiProblem('RESCHEDULE_CUTOFF_PASSED', HttpStatus.CONFLICT);

        const targetSlot = await tx.slotKelas.findUnique({
          where: { id: input.targetClassSlotId },
          include: { branch: true, classType: true, ...HITUNG_TERISI },
        });
        if (!targetSlot) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
        validasiTujuan(booking, targetSlot, now);

        const duplicate = await tx.pemesananKelas.findFirst({
          where: {
            userId: principal.userId,
            classSlotId: targetSlot.id,
            status: { in: ['BOOKED', 'ATTENDED'] },
          },
          select: { id: true },
        });
        if (duplicate) throw new ApiProblem('DUPLICATE_ACTIVE_BOOKING', HttpStatus.CONFLICT);

        const scheduleConflict = await tx.pemesananKelas.findFirst({
          where: {
            userId: principal.userId,
            status: { in: ['BOOKED', 'ATTENDED'] },
            id: { not: booking.id },
            classSlotId: { not: targetSlot.id },
            classSlot: {
              startAt: { lt: targetSlot.endAt },
              endAt: { gt: targetSlot.startAt },
            },
          },
          select: { id: true },
        });
        if (scheduleConflict) throw new ApiProblem('SCHEDULE_CONFLICT', HttpStatus.CONFLICT);

        // Buat record UbahJadwal berstatus PENDING
        const reschedule = await tx.ubahJadwal.create({
          data: {
            id: randomUUID(),
            bookingId: booking.id,
            sourceSlotId: booking.classSlotId,
            targetSlotId: targetSlot.id,
            requestedById: principal.userId,
            status: 'PENDING',
            reason: input.reasonCode,
          },
          include: {
            sourceSlot: { include: { classType: true, branch: true } },
            targetSlot: { include: { classType: true, branch: true } },
            booking: { include: { user: true, customerPackage: { include: { package: true } } } },
          },
        });

        await this.audit?.catat(tx, {
          actorId: principal.userId,
          branchId: targetSlot.branchId,
          correlationId: _correlationId,
          action: 'reschedule.requested',
          objectType: 'Reschedule',
          objectId: reschedule.id,
          targetUserId: principal.userId,
          reason: input.reasonCode,
          afterMasked: { bookingId: booking.id, sourceSlotId: reschedule.sourceSlotId, targetSlotId: reschedule.targetSlotId },
        });

        return {
          status: HttpStatus.CREATED,
          body: {
            id: reschedule.id,
            status: 'PENDING',
            bookingId: booking.id,
            sourceClassSlotId: reschedule.sourceSlotId,
            targetClassSlotId: reschedule.targetSlotId,
            requestedAt: reschedule.requestedAt,
          } as unknown as Prisma.InputJsonValue,
        };
      },
    );
  }

  async decide(
    principal: SessionPrincipal,
    id: string,
    decision: 'approve' | 'reject',
    input: RescheduleDecisionCommand,
    key: string,
    _correlationId: string,
  ) {
    this.policy.requireCapability(principal.capabilities, 'reschedule:decide');
    // Menolak permintaan ubah jadwal wajib punya kode alasan yang dikenal (K4).
    const REJECT_CODES: RescheduleDecisionReasonCode[] = ['TARGET_UNAVAILABLE', 'OUTSIDE_POLICY', 'OUT_OF_SCOPE', 'OTHER'];
    if (decision === 'reject' && !REJECT_CODES.includes(input?.reasonCode))
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'reasonCode', issue: input?.reasonCode ? 'INVALID' : 'REQUIRED' },
      ]);
    return this.idempotency.execute(
      {
        scope: `reschedule-decide:${id}`,
        key,
        payload: { decision, ...input },
        ttlMs: 86_400_000,
        leaseMs: 30_000,
      },
      async (tx) => {
        // Semua kunci diambil SEBELUM pembacaan biasa pertama: di MySQL REPEATABLE READ, snapshot
        // dibuat saat pembacaan biasa pertama, sehingga membaca dulu baru mengunci menghasilkan
        // bookedCount yang basi.
        const [locked] = await tx.$queryRaw<{ sourceSlotId: string; targetSlotId: string }[]>`
          SELECT sourceSlotId, targetSlotId FROM ubah_jadwal WHERE id = ${id} FOR UPDATE`;
        if (!locked) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
        if (decision === 'approve') {
          // Urut id agar dua persetujuan silang tidak deadlock.
          const [lockA, lockB] = [locked.sourceSlotId, locked.targetSlotId].sort();
          await tx.$queryRaw`SELECT id FROM slot_kelas WHERE id IN (${lockA}, ${lockB}) ORDER BY id FOR UPDATE`;
        }

        const reschedule = await tx.ubahJadwal.findUnique({
          where: { id },
          include: {
            booking: { include: { customerPackage: { include: { package: true, purchase: true } } } },
            targetSlot: true,
            sourceSlot: true,
          },
        });
        if (!reschedule) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

        // Cakupan cabang: menyetujui memakai kuota slot tujuan, jadi staf harus berhak di cabang tujuan;
        // menolak cukup berhak di cabang asal atau tujuan.
        const staffScope = staffBranchScope(principal);
        if (staffScope !== 'ALL') {
          const sourceBranch = reschedule.sourceSlot?.branchId;
          const targetBranch = reschedule.targetSlot?.branchId;
          const allowed =
            decision === 'approve'
              ? Boolean(targetBranch && staffScope.includes(targetBranch))
              : Boolean(
                  (targetBranch && staffScope.includes(targetBranch)) ||
                    (sourceBranch && staffScope.includes(sourceBranch)),
                );
          if (!allowed) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
        }

        // Permintaan yang sudah diputuskan, atau booking yang sudah berubah, tidak boleh memindahkan
        // kursi lagi: pemindahan ganda menggeser bookedCount kedua slot.
        if (
          reschedule.status !== 'PENDING' ||
          (decision === 'approve' &&
            (reschedule.booking.status !== 'BOOKED' ||
              reschedule.booking.classSlotId !== reschedule.sourceSlotId))
        ) {
          throw new ApiProblem('RESCHEDULE_ALREADY_DECIDED', HttpStatus.CONFLICT);
        }

        const newStatus: RescheduleStatus = decision === 'approve' ? 'APPROVED' : 'REJECTED';

        if (decision === 'approve') {
          const targetSlot = await tx.slotKelas.findUnique({
            where: { id: reschedule.targetSlotId },
            select: {
              id: true,
              bookedCount: true,
              capacity: true,
              status: true,
              startAt: true,
              endAt: true,
              branchId: true,
              classTypeId: true,
            },
          });
          // Diperiksa ulang saat diputuskan: kelas tujuan bisa sudah batal/lewat sejak diajukan.
          if (targetSlot) validasiTujuan(reschedule.booking, targetSlot, new Date(), false);

          // Hitung riil booking aktif di target slot agar tidak ada selisih kuota
          const activeBookingsOnTarget =
            typeof tx.pemesananKelas?.count === 'function'
              ? await tx.pemesananKelas.count({
                  where: {
                    classSlotId: reschedule.targetSlotId,
                    status: { in: ['BOOKED', 'ATTENDED', 'NO_SHOW'] },
                  },
                })
              : (targetSlot?.bookedCount ?? 0);
          // Kursi dari booking nyata (kolom bookedCount bisa melenceng karena sinkronisasi V1).
          const effectiveBooked = activeBookingsOnTarget;
          if (!targetSlot || effectiveBooked >= targetSlot.capacity) {
            throw new ApiProblem('CLASS_CAPACITY_FULL', HttpStatus.CONFLICT);
          }

          const duplicate = await tx.pemesananKelas.findFirst({
            where: {
              userId: reschedule.booking.userId,
              classSlotId: reschedule.targetSlotId,
              status: { in: ['BOOKED', 'ATTENDED'] },
            },
          });
          if (duplicate) {
            throw new ApiProblem('DUPLICATE_ACTIVE_BOOKING', HttpStatus.CONFLICT);
          }

          if (targetSlot) {
            const scheduleConflict = await tx.pemesananKelas.findFirst({
              where: {
                userId: reschedule.booking.userId,
                status: { in: ['BOOKED', 'ATTENDED'] },
                id: { not: reschedule.bookingId },
                classSlotId: { not: reschedule.targetSlotId },
                classSlot: {
                  startAt: { lt: targetSlot.endAt },
                  endAt: { gt: targetSlot.startAt },
                },
              },
              select: { id: true },
            });
            if (scheduleConflict) {
              throw new ApiProblem('SCHEDULE_CONFLICT', HttpStatus.CONFLICT);
            }
          }

          // Pindahkan booking ke targetSlot
          await tx.pemesananKelas.update({
            where: { id: reschedule.bookingId },
            data: { classSlotId: reschedule.targetSlotId },
          });

          // Kurangi bookedCount slot lama (kapasitas kembali bertambah)
          await tx.slotKelas.update({
            where: { id: reschedule.sourceSlotId },
            data: { bookedCount: { decrement: 1 } },
          });

          // Tambah bookedCount slot baru disinkronkan dengan kuota riil
          await tx.slotKelas.update({
            where: { id: reschedule.targetSlotId },
            data: { bookedCount: effectiveBooked + 1 },
          });
        }

        const updated = await tx.ubahJadwal.update({
          where: { id },
          data: {
            status: newStatus,
            reason: input.reasonCode ?? reschedule.reason,
          },
        });

        await this.audit?.catat(tx, {
          actorId: principal.userId,
          branchId: reschedule.targetSlot?.branchId ?? null,
          correlationId: _correlationId,
          action: decision === 'approve' ? 'reschedule.approved' : 'reschedule.rejected',
          objectType: 'Reschedule',
          objectId: id,
          targetUserId: reschedule.booking.userId,
          reason: input.reasonCode ?? null,
          beforeMasked: { status: reschedule.status, sourceSlotId: reschedule.sourceSlotId },
          afterMasked: { status: newStatus, targetSlotId: reschedule.targetSlotId },
        });

        return {
          status: HttpStatus.OK,
          body: {
            id: updated.id,
            status: updated.status,
          } as unknown as Prisma.InputJsonValue,
        };
      },
    );
  }
}

/**
 * Kelas tujuan pindah jadwal harus bisa dibooking dengan paket booking ini: masih dibuka, belum
 * dimulai, cabang dan jenis kelasnya cocok dengan paket, dan paket masih berlaku saat kelas itu.
 */
function validasiTujuan(
  booking: {
    customerPackage?: {
      validUntil: Date;
      package?: { classTypeId?: string | null; isMultiBranch?: boolean | null; branchId?: string | null } | null;
      purchase?: { branchId?: string | null } | null;
    } | null;
  },
  target: {
    status: string;
    startAt: Date;
    branchId: string;
    classTypeId: string;
    capacity: number;
    bookedCount: number;
    _count?: { bookings?: number } | null;
  },
  now: Date,
  cekKapasitas = true,
) {
  if (!['PUBLISHED', 'CONFIRMED'].includes(target.status))
    throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
  if (target.startAt <= now) throw new ApiProblem('BOOKING_CUTOFF_PASSED', HttpStatus.CONFLICT);
  const cp = booking.customerPackage;
  if (cp) {
    if (!paketBerlakuDi(cp, target.branchId))
      throw new ApiProblem('PACKAGE_BRANCH_MISMATCH', HttpStatus.CONFLICT);
    if (cp.package?.classTypeId && cp.package.classTypeId !== target.classTypeId)
      throw new ApiProblem('PACKAGE_CLASS_TYPE_MISMATCH', HttpStatus.CONFLICT);
    if (cp.validUntil <= target.startAt)
      throw new ApiProblem('INSUFFICIENT_AVAILABLE_SESSIONS', HttpStatus.CONFLICT);
  }
  if (cekKapasitas && terisi(target) >= target.capacity)
    throw new ApiProblem('CLASS_CAPACITY_FULL', HttpStatus.CONFLICT);
}
