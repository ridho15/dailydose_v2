import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type { SessionPrincipal } from './identity.service';
import { PolicyService } from './policy.service';
import { ApiProblem } from './security';
import { buildPhoneSearchVariants } from './manajemen-pelanggan.service';
import {
  calculateSlotFee,
  periodRange,
  sortFeesNewestFirst,
  summarizeInstructorFees,
} from '../packages/instructor-fee-calculator';

@Injectable()
export class InstructorManagementService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  private scope(principal: SessionPrincipal, branchId?: string): Prisma.UserWhereInput {
    this.policy.requireCapability(principal.capabilities, 'assignment:read');
    if (
      branchId &&
      !principal.capabilities.includes('branch:all') &&
      !principal.branchIds.includes(branchId)
    )
      throw new ApiProblem('NOT_FOUND', HttpStatus.NOT_FOUND);

    const branchIds = branchId ? [branchId] : principal.branchIds;
    return {
      role: 'INSTRUCTOR',
      status: 'ACTIVE',
      ...(principal.capabilities.includes('branch:all') && !branchId
        ? {}
        : {
            instructorAssignments: {
              some: { branchId: { in: branchIds }, active: true },
            },
          }),
    };
  }

  /** Honor bulan berjalan per instruktur (kelas selesai), dengan rumus yang sama dengan laporan keuangan. */
  private async monthlyHonor(instructorIds: string[], branchIds: string[] | null) {
    const { period, fromDate, nextMonth } = periodRange();
    const [slots, fees] = await Promise.all([
      this.db.slotKelas.findMany({
        where: {
          instructorId: { in: instructorIds },
          status: 'COMPLETED',
          startAt: { gte: fromDate, lt: nextMonth },
          ...(branchIds ? { branchId: { in: branchIds } } : {}),
        },
        include: {
          instructor: { select: { id: true, displayName: true } },
          classType: { select: { name: true } },
          instructorAttendance: { select: { id: true } },
        },
      }),
      this.db.instructorFee.findMany({ where: { instructorId: { in: instructorIds } } }),
    ]);
    const byInstructor = new Map(summarizeInstructorFees(slots, fees).map((row) => [row.instructorId, row]));
    return { period, byInstructor, fees };
  }

  async list(
    principal: SessionPrincipal,
    filters: { q?: string; branchId?: string; cursor?: string },
  ) {
    const visibleBranchIds = filters.branchId
      ? [filters.branchId]
      : principal.capabilities.includes('branch:all')
        ? null
        : principal.branchIds;

    const q = filters.q?.trim();
    const phoneVariants = q ? buildPhoneSearchVariants(q) : [];

    const where: Prisma.UserWhereInput = {
      ...this.scope(principal, filters.branchId),
      // Daftar hanya berisi instruktur yang masih mengajar: tidak ditandai berhenti dan masih
      // ditugaskan aktif di setidaknya satu cabang (juga untuk tampilan semua cabang).
      stoppedAt: null,
      ...(principal.capabilities.includes('branch:all') && !filters.branchId
        ? { instructorAssignments: { some: { active: true } } }
        : {}),
      ...(q
        ? {
            OR: [
              { displayName: { contains: q } },
              { email: { contains: q } },
              ...phoneVariants.map((v) => ({ phone: { contains: v } })),
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.db.user.findMany({
        where: { ...where, ...(filters.cursor ? { id: { gt: filters.cursor } } : {}) },
        orderBy: { id: 'asc' },
        take: 21,
        select: {
          id: true,
          displayName: true,
          email: true,
          phone: true,
          status: true,
          instructorAssignments: {
            where: {
              active: true,
              ...(visibleBranchIds ? { branchId: { in: visibleBranchIds } } : {}),
            },
            select: {
              id: true,
              branch: { select: { id: true, code: true, name: true } },
              active: true,
              createdAt: true,
            },
          },
          _count: {
            select: {
              instructedClassSlots: true,
              instructorAttendances: true,
            },
          },
        },
      }),
      this.db.user.count({ where }),
    ]);

    const hasMore = rows.length > 20;
    const page = rows.slice(0, 20);

    const canSeeFees = principal.capabilities.includes('instructor:fee:read');
    const honor =
      canSeeFees && page.length
        ? await this.monthlyHonor(
            page.map((row) => row.id),
            visibleBranchIds,
          )
        : null;

    return {
      items: page.map((row) => ({
        id: row.id,
        displayName: row.displayName,
        email: row.email,
        phoneE164: row.phone,
        status: row.status,
        assignments: row.instructorAssignments.map((a) => ({
          id: a.id,
          branch: a.branch,
          activeFrom: a.createdAt,
          activeUntil: null,
        })),
        _count: row._count,
        compensationRp: canSeeFees ? (honor?.byInstructor.get(row.id)?.totalFeeRp ?? 0) : null,
        unverifiedCompensationRp: canSeeFees
          ? (honor?.byInstructor.get(row.id)?.unverifiedFeeRp ?? 0)
          : null,
        compensationPeriod: periodRange().period,
      })),
      summary: { total },
      page: { hasMore, nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null },
    };
  }

  async detail(principal: SessionPrincipal, id: string) {
    const scoped = this.scope(principal);
    const visibleBranches = principal.capabilities.includes('branch:all')
      ? {}
      : { branchId: { in: principal.branchIds } };

    const instructor = await this.db.user.findFirst({
      where: { id, ...scoped },
      select: {
        id: true,
        displayName: true,
        email: true,
        phone: true,
        status: true,
        instructorAssignments: {
          where: { active: true, ...visibleBranches },
          select: {
            id: true,
            branch: { select: { id: true, code: true, name: true } },
            active: true,
            createdAt: true,
          },
        },
        instructedClassSlots: {
          where: visibleBranches,
          orderBy: { startAt: 'desc' },
          take: 20,
          select: {
            id: true,
            startAt: true,
            endAt: true,
            status: true,
            branchId: true,
            classTypeId: true,
            classType: { select: { code: true, name: true } },
            branch: { select: { id: true, name: true } },
            instructorAttendance: { select: { checkedInAt: true, method: true } },
          },
        },
      },
    });

    if (!instructor) throw new ApiProblem('NOT_FOUND', HttpStatus.NOT_FOUND);

    const canSeeFees = principal.capabilities.includes('instructor:fee:read');
    const { period, byInstructor, fees } = await this.monthlyHonor(
      [id],
      principal.capabilities.includes('branch:all') ? null : principal.branchIds,
    );
    const honor = byInstructor.get(id);
    const sortedFees = sortFeesNewestFirst(fees);

    return {
      id: instructor.id,
      displayName: instructor.displayName,
      email: instructor.email,
      phoneE164: instructor.phone,
      status: instructor.status,
      version: 1,
      assignments: instructor.instructorAssignments.map((a) => ({
        id: a.id,
        branch: a.branch,
        activeFrom: a.createdAt,
        activeUntil: null,
      })),
      instructedClassSlots: instructor.instructedClassSlots.map(
        ({ instructorAttendance, branchId, classTypeId, ...slot }) => ({
          ...slot,
          instructorAttendances: instructorAttendance ? [instructorAttendance] : [],
          instructorHourLog:
            canSeeFees && slot.status === 'COMPLETED'
              ? {
                  amountRp: calculateSlotFee(sortedFees, {
                    startAt: slot.startAt,
                    endAt: slot.endAt,
                    branchId,
                    classTypeId,
                    instructorId: id,
                  }).feeRp,
                }
              : null,
        }),
      ),
      instructorAvailabilities: [],
      instructorAttendances: instructor.instructedClassSlots.flatMap((slot) =>
        slot.instructorAttendance ? [slot.instructorAttendance] : [],
      ),
      instructorHourLogs: [],
      compensationRp: canSeeFees ? (honor?.totalFeeRp ?? 0) : null,
      unverifiedCompensationRp: canSeeFees ? (honor?.unverifiedFeeRp ?? 0) : null,
      compensationPeriod: period,
      blockers: {
        completedWithoutCheckIn: honor?.unverifiedClassCount ?? 0,
        completedWithoutFee: honor?.unconfiguredFeeClassCount ?? 0,
      },
    };
  }
}
