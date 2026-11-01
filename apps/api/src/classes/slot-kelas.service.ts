import { HITUNG_TERISI, terisi } from './terisi';
import { requireReason } from '../foundation/reason';
import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { WhatsAppGatewayService } from '../notifications/whatsapp-gateway.service';
import { ClassSlotStatus, Prisma, SessionMutationType } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { RuntimeConfigService } from '../configuration/runtime-config.service';
import { IdempotencyService } from '../foundation/idempotency.service';
import { AuditService } from '../foundation/audit.service';
import type { SessionPrincipal } from '../identity/identity.service';
import { PolicyService } from '../identity/policy.service';
import { ApiProblem, ENTITY_ID_REGEX, newId } from '../identity/security';

const UUID = ENTITY_ID_REGEX;
const OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const PAGE_SIZE = 20;

export const CANCELLATION_REASONS = [
  'STUDIO_UNAVAILABLE',
  'INSTRUCTOR_UNAVAILABLE',
  'SAFETY_ISSUE',
  'OTHER_REVIEW_REQUIRED',
] as const;
export type ClassSlotCancellationReason = (typeof CANCELLATION_REASONS)[number];
type Tx = Prisma.TransactionClient;

/** Status yang masih boleh menjalani tiap tindakan staf; selalu dipasangkan dengan klaim versi. */
const STATUS_ALLOWED: Record<
  'assign' | 'update' | 'publish' | 'cancel' | 'complete',
  readonly ClassSlotStatus[]
> = {
  assign: [ClassSlotStatus.DRAFT, ClassSlotStatus.PUBLISHED, ClassSlotStatus.CONFIRMED],
  update: [ClassSlotStatus.DRAFT, ClassSlotStatus.PUBLISHED, ClassSlotStatus.CONFIRMED],
  publish: [ClassSlotStatus.DRAFT],
  cancel: [ClassSlotStatus.DRAFT, ClassSlotStatus.PUBLISHED, ClassSlotStatus.CONFIRMED],
  complete: [ClassSlotStatus.CONFIRMED],
};

/** Kapasitas cabang + tipe kelas dari Data Master, atau null bila belum diatur. */
async function kapasitasCabang(tx: any, branchId: string, classTypeId: string) {
  if (typeof tx.kapasitasKelasCabang?.findUnique !== 'function') return null;
  const row = await tx.kapasitasKelasCabang.findUnique({
    where: { branchId_classTypeId: { branchId, classTypeId } },
    select: { capacity: true },
  });
  return row?.capacity ?? null;
}

const VIEW_INCLUDE = {
  branch: true,
  studio: true,
  room: true,
  classType: true,
  instructor: { include: { profile: true } },
  ...HITUNG_TERISI,
} satisfies Prisma.SlotKelasInclude;

function instant(value: string) {
  if (!OFFSET.test(value)) throw new ApiProblem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST);
  const result = new Date(value);
  if (Number.isNaN(result.getTime()))
    throw new ApiProblem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST);
  return result;
}

function decodeCursor(value?: string): { at: Date; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString()) as {
      at: string;
      id: string;
    };
    if (!UUID.test(parsed.id)) throw new Error();
    return { at: instant(parsed.at), id: parsed.id };
  } catch {
    throw new ApiProblem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST);
  }
}

const encodeCursor = (at: Date, id: string) =>
  Buffer.from(JSON.stringify({ at: at.toISOString(), id })).toString('base64url');

export function classCompletionControlHash(
  bookings: Array<{
    id: string;
    status: string;
    attendance?: { id: string } | null;
  }>,
) {
  const projection = bookings
    .map((booking) => ({
      id: booking.id,
      status: booking.status,
      attended: Boolean(booking.attendance),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return createHash('sha256').update(JSON.stringify(projection)).digest('hex');
}

@Injectable()
export class ClassSlotService {
  private readonly logger = new Logger(ClassSlotService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly idempotency: IdempotencyService,
    private readonly config: RuntimeConfigService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly whatsapp?: WhatsAppGatewayService,
  ) {}

  /** Jejak audit permanen untuk perubahan kelas; ikut transaksi sehingga batal bersama perubahannya. */
  private auditSlot(
    tx: Tx,
    principal: SessionPrincipal,
    correlationId: string,
    action: string,
    slot: { id: string; branchId: string },
    before: Prisma.InputJsonValue | undefined,
    after: Prisma.InputJsonValue | undefined,
    reason?: string | null,
  ) {
    return this.audit?.catat(tx, {
      actorId: principal.userId,
      branchId: slot.branchId,
      correlationId,
      action,
      objectType: 'ClassSlot',
      objectId: slot.id,
      reason,
      beforeMasked: before,
      afterMasked: after,
    });
  }

  private scope(principal: SessionPrincipal, branchId: string, capability: string) {
    if (
      !this.policy.hasCapability(principal, 'branch:all', branchId) &&
      !this.policy.hasCapability(principal, capability, branchId)
    )
      throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
  }

  private manage(principal: SessionPrincipal) {
    this.policy.requireCapability(principal.capabilities, 'class-slot:manage');
  }

  /**
   * Selesaikan kelas: staf dengan `class-slot:manage` (dan branch scope), ATAU instruktur pemilik
   * slot ini dengan `attendance:self` (Aturan #1 — instruktur menandai kelasnya sendiri selesai).
   */
  private authorizeCompletion(principal: SessionPrincipal, slot: { instructorId: string | null; branchId: string }) {
    const isOwningInstructor =
      principal.capabilities.includes('attendance:self') &&
      slot.instructorId !== null &&
      slot.instructorId === principal.userId;
    if (isOwningInstructor) return;
    this.manage(principal);
    this.scope(principal, slot.branchId, 'class-slot:manage');
  }

  private view(slot: any) {
    return {
      id: slot.id,
      branchId: slot.branchId,
      classTypeId: slot.classTypeId,
      studioId: slot.studioId,
      roomId: slot.roomId ?? null,
      instructorUserId: slot.instructorId ?? null,
      instructorId: slot.instructorId ?? null,
      startAt: slot.startAt,
      endAt: slot.endAt,
      timezone: slot.branch?.timezone ?? 'Asia/Jakarta',
      capacity: slot.capacity,
      bookedCount: terisi(slot),
      minimumQuota: slot.classType?.minimumQuota ?? 1,
      bookingCutoffHours: slot.bookingCutoffHours ?? null,
      status: slot.status,
      cancellationReasonCode: slot.cancellationReason ?? null,
      cancellationReason: slot.cancellationReason ?? null,
      notes: slot.notes ?? null,
      version: slot.version ?? 1,
      branch: slot.branch,
      studio: slot.studio,
      room: slot.room,
      classType: slot.classType,
      instructor: slot.instructor,
      instructorAttendance: slot.instructorAttendance ?? null,
    };
  }

  /** Versi wajib untuk tindakan staf; tanpa itu form usang bisa menimpa perubahan orang lain. */
  private requireVersion(value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1)
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'expectedVersion', issue: 'REQUIRED' },
      ]);
    return value;
  }

  /**
   * Versi opsional untuk tindakan yang tidak mengubah status kelas (tetapkan instruktur, ubah draf): bila dikirim
   * tetap diperiksa, bila tidak, penjaga status saja yang berlaku.
   */
  private optionalVersion(value: unknown): number | undefined {
    return value === undefined || value === null ? undefined : this.requireVersion(value);
  }

  /** Pemeriksaan awal dengan pesan jelas; klaim atomik di `claim` tetap penentu akhir bila ada balapan. */
  private assertClaimable(
    slot: { status: ClassSlotStatus; version: number },
    expectedVersion: number | undefined,
    allowed: readonly ClassSlotStatus[],
  ) {
    if (!allowed.includes(slot.status))
      throw new ApiProblem('INVALID_STATE_TRANSITION', HttpStatus.CONFLICT);
    if (expectedVersion !== undefined && slot.version !== expectedVersion)
      throw new ApiProblem('STALE_VERSION', HttpStatus.CONFLICT);
  }

  /** Menulis perubahan hanya jika versi dan status masih seperti yang dilihat staf, lalu menaikkan versi. */
  private async claim(
    tx: Tx,
    id: string,
    expectedVersion: number | undefined,
    allowed: readonly ClassSlotStatus[],
    data: Prisma.SlotKelasUncheckedUpdateManyInput,
  ) {
    const claimed = await tx.slotKelas.updateMany({
      where: {
        id,
        ...(expectedVersion !== undefined ? { version: expectedVersion } : {}),
        status: { in: [...allowed] },
      },
      data: { ...data, version: { increment: 1 } },
    });
    if (claimed.count === 1) return;
    const current = await tx.slotKelas.findUnique({ where: { id }, select: { status: true } });
    if (!current) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    throw new ApiProblem(
      allowed.includes(current.status) ? 'STALE_VERSION' : 'INVALID_STATE_TRANSITION',
      HttpStatus.CONFLICT,
    );
  }

  private async viewOf(tx: Tx, id: string) {
    return this.view(
      await tx.slotKelas.findUniqueOrThrow({ where: { id }, include: VIEW_INCLUDE }),
    );
  }

  async list(
    principal: SessionPrincipal,
    input: {
      branchId?: string;
      status?: string;
      from?: string;
      until?: string;
      cursor?: string;
      limit?: number;
      includeHistorical?: boolean;
    },
  ) {
    this.policy.requireCapability(principal.capabilities, 'class-slot:read');
    if (input.branchId) {
      this.scope(principal, input.branchId, 'class-slot:read');
    }

    const from = input.from ? instant(input.from) : undefined;
    const until = input.until ? instant(input.until) : undefined;
    if (from && until && from >= until)
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST);

    const cursor = decodeCursor(input.cursor);
    const limit = Math.min(Math.max(1, Number(input.limit ?? PAGE_SIZE)), 500);

    // Staf penjadwalan melihat semua status. Instruktur/coach (`class:assigned:read`) melihat jadwal
    // yang dipublikasikan plus kelasnya sendiri di status apa pun (mis. CONFIRMED untuk
    // diselesaikan) — tidak pernah draft/batal milik instruktur lain. Customer hanya PUBLISHED.
    // Untuk keduanya, pembatasan di-AND dengan filter `status` klien agar filter tidak melebarkannya.
    // Peran lain (mis. Owner) tetap: PUBLISHED secara bawaan, status lain hanya lewat filter eksplisit.
    const caps = principal.capabilities;
    let visibility: Prisma.SlotKelasWhereInput | undefined;
    let defaultStatus: Prisma.SlotKelasWhereInput = {};
    if (!caps.includes('class-slot:manage')) {
      if (caps.includes('class:assigned:read')) {
        visibility = { OR: [{ status: ClassSlotStatus.PUBLISHED }, { instructorId: principal.userId }] };
      } else if (caps.includes('customer:self')) {
        visibility = { status: ClassSlotStatus.PUBLISHED };
      } else {
        defaultStatus = { status: ClassSlotStatus.PUBLISHED };
      }
    }
    const where: Prisma.SlotKelasWhereInput = {
      ...(input.branchId ? { branchId: input.branchId } : {}),
      ...(input.status ? { status: input.status as ClassSlotStatus } : defaultStatus),
      ...(from ? { endAt: { gt: from } } : {}),
      ...(until ? { startAt: { lt: until } } : {}),
      ...(cursor
        ? {
            OR: [
              { startAt: { lt: cursor.at } },
              { startAt: cursor.at, id: { lt: cursor.id } },
            ],
          }
        : {}),
      ...(visibility ? { AND: [visibility] } : {}),
    };

    const isCalendarWindow = Boolean(from && until && !cursor);
    const orderBy: Prisma.SlotKelasOrderByWithRelationInput[] = isCalendarWindow
      ? [{ startAt: 'asc' }, { id: 'asc' }]
      : [{ startAt: 'desc' }, { id: 'desc' }];

    const slots = await this.db.slotKelas.findMany({
      where,
      include: {
        branch: true,
        studio: true,
        room: true,
        classType: true,
        instructor: { include: { profile: true } },
        instructorAttendance: { select: { checkedInAt: true, method: true } },
        ...HITUNG_TERISI,
      },
      orderBy,
      take: limit + 1,
    });

    const hasMore = slots.length > limit;
    const items = slots.slice(0, limit);
    const last = items.at(-1);

    return {
      items: items.map((slot) => this.view(slot)),
      page: {
        hasMore,
        nextCursor: hasMore && last ? encodeCursor(last.startAt, last.id) : null,
      },
    };
  }

  async create(
    principal: SessionPrincipal,
    input: {
      branchId: string;
      classTypeId: string;
      studioId: string;
      roomId?: string;
      instructorUserId?: string;
      startAt: string;
      endAt: string;
      capacity?: number;
      bookingCutoffHours?: number | null;
    },
    key: string,
    _correlationId: string,
  ) {
    this.manage(principal);
    this.validateKey(key);
    if (
      !UUID.test(input.branchId) ||
      !UUID.test(input.classTypeId) ||
      !UUID.test(input.studioId) ||
      (input.roomId && !UUID.test(input.roomId)) ||
      (input.instructorUserId && !UUID.test(input.instructorUserId))
    )
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST);

    const startAt = instant(input.startAt);
    const endAt = instant(input.endAt);
    if (startAt >= endAt) throw new ApiProblem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST);

    return this.execute(
      principal,
      `class-slot:create:${principal.userId}`,
      key,
      input,
      HttpStatus.CREATED,
      async (tx) => {
        this.scope(principal, input.branchId, 'class-slot:manage');
        const [branch, classType, studio, room] = await Promise.all([
          tx.cabang.findUnique({ where: { id: input.branchId } }),
          tx.jenisKelas.findUnique({ where: { id: input.classTypeId } }),
          tx.studio.findUnique({ where: { id: input.studioId } }),
          input.roomId ? tx.ruangan.findUnique({ where: { id: input.roomId } }) : null,
        ]);

        if (!branch?.active || !classType?.active || !studio?.active)
          throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
        // Studio dan ruangan harus milik cabang kelas; tanpa ini kelas bisa tersimpan di cabang lain
        // dan muncul di timetable yang salah.
        if (studio.branchId !== branch.id || (room && room.studioId !== studio.id))
          throw new ApiProblem('STUDIO_BRANCH_MISMATCH', HttpStatus.UNPROCESSABLE_ENTITY);

        const collisionConditions: Prisma.SlotKelasWhereInput[] = [];
        if (room?.id) {
          collisionConditions.push({ studioId: studio.id, roomId: room.id });
        } else {
          collisionConditions.push({ studioId: studio.id });
        }
        if (input.instructorUserId) {
          collisionConditions.push({ instructorId: input.instructorUserId });
        }

        const collision = await tx.slotKelas.findFirst({
          where: {
            status: { not: ClassSlotStatus.CANCELLED },
            startAt: { lt: endAt },
            endAt: { gt: startAt },
            OR: collisionConditions,
          },
          include: {
            classType: { select: { name: true } },
            branch: { select: { name: true, timezone: true } },
          },
        });
        if (collision) throw bentrokJadwal(collision, input.instructorUserId ?? null);

        const inputCapacity = (input as any).capacity;
        let effectiveCapacity: number;
        if (inputCapacity !== undefined && inputCapacity !== null) {
          const parsed = Number(inputCapacity);
          if (room && room.capacityBed > 0 && parsed > room.capacityBed) {
            throw new ApiProblem(
              'CAPACITY_EXCEEDS_ROOM_LIMIT',
              HttpStatus.BAD_REQUEST,
              false,
              [{ field: 'capacity', issue: `EXCEEDS_ROOM_CAPACITY_BED_${room.capacityBed}` }],
            );
          }
          effectiveCapacity = parsed;
        } else {
          // Kapasitas yang diatur di Data Master untuk cabang + tipe kelas ini menang.
          const diatur = await kapasitasCabang(tx, branch.id, classType.id);
          const defaultCap = classType.defaultCapacity ?? 8;
          effectiveCapacity =
            diatur ??
            (room && room.capacityBed > 0 ? Math.min(defaultCap, room.capacityBed) : defaultCap);
        }

        const slot = await tx.slotKelas.create({
          data: {
            id: newId(),
            branchId: branch.id,
            classTypeId: classType.id,
            studioId: studio.id,
            roomId: room?.id ?? null,
            instructorId: input.instructorUserId ?? null,
            startAt,
            endAt,
            capacity: effectiveCapacity,
            bookingCutoffHours: input.bookingCutoffHours !== undefined && input.bookingCutoffHours !== null ? Number(input.bookingCutoffHours) : null,
            bookedCount: 0,
            status: ClassSlotStatus.DRAFT,
          },
          include: {
            branch: true,
            studio: true,
            room: true,
            classType: true,
            instructor: { include: { profile: true } },
            ...HITUNG_TERISI,
          },
        });

        await this.auditSlot(
          tx, principal, _correlationId, 'class_slot.created', slot, undefined,
          {
            status: ClassSlotStatus.DRAFT,
            classTypeId: classType.id,
            studioId: studio.id,
            roomId: room?.id ?? null,
            instructorUserId: input.instructorUserId ?? null,
            startAt: startAt.toISOString(),
            capacity: effectiveCapacity,
          },
        );

        return this.view(slot);
      },
    );
  }

  async assign(
    principal: SessionPrincipal,
    id: string,
    input: { instructorUserId: string; expectedVersion?: number },
    key: string,
    _correlationId: string,
  ) {
    this.manage(principal);
    this.validateKey(key);
    if (!UUID.test(id) || !UUID.test(input.instructorUserId))
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST);
    const expectedVersion = this.optionalVersion(input.expectedVersion);

    return this.execute(
      principal,
      `class-slot:assign:${id}`,
      key,
      input,
      HttpStatus.OK,
      async (tx) => {
        const slot = await tx.slotKelas.findUnique({ where: { id } });
        if (!slot) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
        this.scope(principal, slot.branchId, 'class-slot:manage');
        this.assertClaimable(slot, expectedVersion, STATUS_ALLOWED.assign);

        const instructorCollision = await tx.slotKelas.findFirst({
          where: {
            id: { not: slot.id },
            instructorId: input.instructorUserId,
            status: { not: ClassSlotStatus.CANCELLED },
            startAt: { lt: slot.endAt },
            endAt: { gt: slot.startAt },
          },
          include: {
            classType: { select: { name: true } },
            branch: { select: { name: true, timezone: true } },
          },
        });
        if (instructorCollision) throw bentrokJadwal(instructorCollision, input.instructorUserId);

        await this.claim(tx, id, expectedVersion, STATUS_ALLOWED.assign, {
          instructorId: input.instructorUserId,
        });
        await this.auditSlot(
          tx, principal, _correlationId, 'class_slot.instructor_assigned', slot,
          { instructorId: slot.instructorId, status: slot.status },
          { instructorId: input.instructorUserId },
        );
        return this.viewOf(tx, id);
      },
    );
  }

  async update(
    principal: SessionPrincipal,
    id: string,
    input: {
      classTypeId: string;
      studioId?: string;
      roomId?: string | null;
      instructorUserId?: string | null;
      startAt: string;
      endAt: string;
      capacity?: number;
      bookingCutoffHours?: number | null;
      expectedVersion?: number;
      reason?: string;
    },
    key: string,
    _correlationId: string,
  ) {
    this.manage(principal);
    this.validateKey(key);
    if (!UUID.test(id) || !UUID.test(input.classTypeId))
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST);
    if (input.studioId != null && input.studioId !== '' && !UUID.test(input.studioId))
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST);
    if (input.roomId != null && input.roomId !== '' && !UUID.test(input.roomId))
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST);
    if (input.instructorUserId != null && input.instructorUserId !== '' && !UUID.test(input.instructorUserId))
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST);
    const expectedVersion = this.optionalVersion(input.expectedVersion);

    const startAt = instant(input.startAt);
    const endAt = instant(input.endAt);
    if (startAt >= endAt) throw new ApiProblem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST);

    return this.execute(
      principal,
      `class-slot:update:${id}`,
      key,
      input,
      HttpStatus.OK,
      async (tx) => {
        const slot = await tx.slotKelas.findUnique({
          where: { id },
          include: { bookings: { where: { status: 'BOOKED' }, select: { id: true } } },
        });
        if (!slot) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
        this.scope(principal, slot.branchId, 'class-slot:manage');
        this.assertClaimable(slot, expectedVersion, STATUS_ALLOWED.update);

        if (
          (slot.status === ClassSlotStatus.PUBLISHED || slot.status === ClassSlotStatus.CONFIRMED) &&
          (slot.bookedCount > 0 || (slot.bookings && slot.bookings.length > 0))
        ) {
          throw new ApiProblem('CLASS_SLOT_HAS_BOOKINGS', HttpStatus.CONFLICT, false, [
            {
              field: 'classSlotId',
              issue: 'Tipe kelas atau jadwal tidak dapat diubah karena sudah ada peserta yang memesan.',
            },
          ]);
        }

        const targetStudioId =
          input.studioId !== undefined && input.studioId !== '' ? input.studioId : slot.studioId;
        const targetRoomId = input.roomId !== undefined ? (input.roomId || null) : slot.roomId;
        if (targetStudioId && targetStudioId !== slot.studioId && tx.studio?.findUnique) {
          const studioBaru = await tx.studio.findUnique({ where: { id: targetStudioId } });
          if (!studioBaru) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
          if (studioBaru.branchId !== slot.branchId)
            throw new ApiProblem('STUDIO_BRANCH_MISMATCH', HttpStatus.UNPROCESSABLE_ENTITY);
        }

        let room = null;
        if (targetRoomId && (tx as any).ruangan) {
          room = await (tx as any).ruangan.findUnique({ where: { id: targetRoomId } });
          if (!room || room.studioId !== targetStudioId) {
            throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
          }
        }

        const classType = (tx as any).jenisKelas
          ? await (tx as any).jenisKelas.findUnique({ where: { id: input.classTypeId } })
          : null;
        if ((tx as any).jenisKelas && !classType) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

        let effectiveCapacity: number;
        if (input.capacity !== undefined && input.capacity !== null && (input.capacity as any) !== "") {
          const customCap = Number(input.capacity);
          if (!Number.isInteger(customCap) || customCap < 1) {
            throw new ApiProblem("VALIDATION_ERROR", HttpStatus.BAD_REQUEST, false, [
              { field: "capacity", issue: "CAPACITY_MUST_BE_POSITIVE_INTEGER" },
            ]);
          }
          const currentBooked = terisi(slot);
          if (customCap < currentBooked) {
            throw new ApiProblem("CAPACITY_BELOW_BOOKED_COUNT", HttpStatus.CONFLICT, false, [
              { field: "capacity", issue: `Kapasitas baru (${customCap}) tidak boleh di bawah jumlah peserta yang sudah booking (${currentBooked}).` },
            ]);
          }
          if (room && room.capacityBed > 0 && customCap > room.capacityBed) {
            throw new ApiProblem("CAPACITY_EXCEEDS_ROOM_LIMIT", HttpStatus.BAD_REQUEST, false, [
              { field: "capacity", issue: `EXCEEDS_ROOM_CAPACITY_BED_${room.capacityBed}` },
            ]);
          }
          effectiveCapacity = customCap;
        } else {
          const defaultCap = classType?.defaultCapacity ?? 8;
          const diatur = await kapasitasCabang(tx, slot.branchId, input.classTypeId);
          effectiveCapacity =
            diatur ??
            (room && room.capacityBed > 0 ? Math.min(defaultCap, room.capacityBed) : defaultCap);
        }

        const targetCutoffHours =
          input.bookingCutoffHours !== undefined
            ? (input.bookingCutoffHours !== null && (input.bookingCutoffHours as any) !== ""
                ? Number(input.bookingCutoffHours)
                : null)
            : slot.bookingCutoffHours;

        // Instruktur yang tidak dikirim tetap dipertahankan; hanya `null` eksplisit yang mengosongkannya.
        const targetInstructorId =
          input.instructorUserId !== undefined
            ? (input.instructorUserId || null)
            : slot.instructorId;
        const updateCollisionConditions: Prisma.SlotKelasWhereInput[] = [];
        if (targetRoomId) {
          updateCollisionConditions.push({ studioId: targetStudioId, roomId: targetRoomId });
        } else {
          updateCollisionConditions.push({ studioId: targetStudioId });
        }
        if (targetInstructorId) {
          updateCollisionConditions.push({ instructorId: targetInstructorId });
        }

        const updateCollision = await tx.slotKelas.findFirst({
          where: {
            id: { not: slot.id },
            status: { not: ClassSlotStatus.CANCELLED },
            startAt: { lt: endAt },
            endAt: { gt: startAt },
            OR: updateCollisionConditions,
          },
          include: {
            classType: { select: { name: true } },
            branch: { select: { name: true, timezone: true } },
          },
        });
        if (updateCollision) throw bentrokJadwal(updateCollision, targetInstructorId ?? null);

        await this.claim(tx, id, expectedVersion, STATUS_ALLOWED.update, {
          classTypeId: input.classTypeId,
          instructorId: targetInstructorId,
          studioId: targetStudioId,
          roomId: targetRoomId,
          capacity: effectiveCapacity,
          bookingCutoffHours: targetCutoffHours,
          startAt,
          endAt,
          notes: input.reason ?? slot.notes,
        });
        await this.auditSlot(
          tx, principal, _correlationId, 'class_slot.updated', slot,
          {
            classTypeId: slot.classTypeId,
            instructorId: slot.instructorId,
            studioId: slot.studioId,
            roomId: slot.roomId,
            startAt: slot.startAt.toISOString(),
            endAt: slot.endAt.toISOString(),
          },
          {
            classTypeId: input.classTypeId,
            instructorId: targetInstructorId,
            studioId: targetStudioId,
            roomId: targetRoomId,
            startAt: startAt.toISOString(),
            endAt: endAt.toISOString(),
          },
          input.reason,
        );
        return this.viewOf(tx, id);
      },
    );
  }

  async publish(
    principal: SessionPrincipal,
    id: string,
    input: { expectedVersion?: number },
    key: string,
    _correlationId: string,
  ) {
    this.manage(principal);
    this.validateKey(key);
    const expectedVersion = this.requireVersion(input?.expectedVersion);

    return this.execute(
      principal,
      `class-slot:publish:${id}`,
      key,
      input,
      HttpStatus.OK,
      async (tx) => {
        const slot = await tx.slotKelas.findUnique({ where: { id } });
        if (!slot) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
        this.scope(principal, slot.branchId, 'class-slot:manage');
        this.assertClaimable(slot, expectedVersion, STATUS_ALLOWED.publish);
        // Kelas tanpa instruktur tidak boleh dibuka untuk booking.
        if (!slot.instructorId)
          throw new ApiProblem('INSTRUCTOR_REQUIRED', HttpStatus.UNPROCESSABLE_ENTITY, false, [
            { field: 'instructorUserId', issue: 'INSTRUCTOR_REQUIRED' },
          ]);

        await this.claim(tx, id, expectedVersion, STATUS_ALLOWED.publish, {
          status: ClassSlotStatus.PUBLISHED,
        });
        await this.auditSlot(
          tx, principal, _correlationId, 'class_slot.published', slot,
          { status: slot.status },
          { status: ClassSlotStatus.PUBLISHED },
        );
        return this.viewOf(tx, id);
      },
    );
  }

  async cancel(
    principal: SessionPrincipal,
    id: string,
    input: { reasonCode: ClassSlotCancellationReason; expectedVersion?: number; note?: string },
    key: string,
    _correlationId: string,
  ) {
    this.manage(principal);
    this.validateKey(key);
    const expectedVersion = this.requireVersion(input?.expectedVersion);
    // Membatalkan kelas wajib punya alasan: kode yang dikenal, dan "lainnya" wajib disertai catatan.
    if (!CANCELLATION_REASONS.includes(input?.reasonCode))
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'reasonCode', issue: input?.reasonCode ? 'INVALID' : 'REQUIRED' },
      ]);
    const note =
      input.reasonCode === 'OTHER_REVIEW_REQUIRED' ? requireReason(input.note, 'note') : input.note?.trim() || undefined;

    let notificationPayload: {
      slotId: string;
      className: string;
      branchName: string;
      timezone: string;
      startAt?: Date;
      instructorPhone?: string | null;
      instructorName?: string | null;
      attendees: Array<{ phone?: string | null; name: string; bookingId: string }>;
    } | null = null;

    const result = await this.execute(
      principal,
      `class-slot:cancel:${id}`,
      key,
      input,
      HttpStatus.OK,
      async (tx) => {
        const slot = await tx.slotKelas.findUnique({
          where: { id },
          include: {
            bookings: {
              where: { status: 'BOOKED' },
              include: { user: true },
            },
            classType: true,
            branch: true,
            instructor: true,
          },
        });
        if (!slot) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
        this.scope(principal, slot.branchId, 'class-slot:manage');
        // Kelas selesai/batal tidak boleh "dibatalkan" lagi: riwayat kehadiran dan ledger harus utuh.
        this.assertClaimable(slot, expectedVersion, STATUS_ALLOWED.cancel);

        notificationPayload = {
          slotId: slot.id,
          className: (slot as any).classType?.name || 'Pilates',
          branchName: (slot as any).branch?.name || 'Daily Dose',
          timezone: (slot as any).branch?.timezone || 'Asia/Jakarta',
          startAt: slot.startAt,
          instructorPhone: (slot as any).instructor?.phone,
          instructorName: (slot as any).instructor?.displayName,
          attendees: ((slot as any).bookings || []).map((b: any) => ({
            bookingId: b.id,
            phone: b.user?.phone,
            name: b.user?.displayName || 'Member',
          })),
        };

        await this.claim(tx, id, expectedVersion, STATUS_ALLOWED.cancel, {
          status: ClassSlotStatus.CANCELLED,
          cancellationReason: input.reasonCode,
          bookedCount: 0,
        });
        await this.auditSlot(
          tx, principal, _correlationId, 'class_slot.cancelled', slot,
          { status: slot.status, bookedCount: slot.bookings.length },
          { status: ClassSlotStatus.CANCELLED, releasedBookings: slot.bookings.length },
          note ? `${input.reasonCode}: ${note}` : input.reasonCode,
        );

        // Refund all booked members
        for (const booking of slot.bookings) {
          await tx.pemesananKelas.update({
            where: { id: booking.id },
            data: { status: 'CANCELLED', cancellationReason: input.reasonCode, cancelledAt: new Date() },
          });

          // Rule #1: Sesi tidak dipotong saat booking, kuota virtual dipulihkan otomatis saat booking CANCELLED.
          // Audit integritas saldo paket:
          if (booking.customerPackageId) {
            const customerPkg = await tx.paketPelanggan.findUnique({
              where: { id: booking.customerPackageId },
            });
            if (customerPkg) {
              await tx.sessionLedger.create({
                data: {
                  customerPackageId: booking.customerPackageId,
                  type: SessionMutationType.REFUND_AUTOCANCEL,
                  amount: 0, // Saldo tidak terpotong di muka pada Rule #1, dicatat untuk audit trail
                  balanceAfter: customerPkg.remainingSessions,
                  referenceId: booking.id,
                  notes: `Manual cancel kelas slot: ${input.reasonCode}`,
                },
              });
            }
          }
        }

        return this.viewOf(tx, id);
      },
    );

    if (this.whatsapp && notificationPayload) {
      await this.dispatchCancellationBroadcast(notificationPayload, input.reasonCode, note).catch((err) => {
        this.logger.warn(`Gagal kirim notifikasi pembatalan manual WA: ${err?.message || err}`);
      });
    }

    return result;
  }

  private async dispatchCancellationBroadcast(
    payload: {
      slotId: string;
      className: string;
      branchName: string;
      timezone: string;
      startAt?: Date;
      instructorPhone?: string | null;
      instructorName?: string | null;
      attendees: Array<{ phone?: string | null; name: string; bookingId: string }>;
    },
    reasonCode: ClassSlotCancellationReason,
    note?: string,
  ) {
    if (!this.whatsapp) return;

    const classDateStr = payload.startAt
      ? new Intl.DateTimeFormat('id-ID', {
          dateStyle: 'full',
          timeStyle: 'short',
          timeZone: payload.timezone,
        }).format(payload.startAt)
      : '';

    const reasonLabelMap: Record<ClassSlotCancellationReason, string> = {
      STUDIO_UNAVAILABLE: 'Studio tidak dapat digunakan / pemeliharaan',
      INSTRUCTOR_UNAVAILABLE: 'Instruktur berhalangan hadir',
      SAFETY_ISSUE: 'Kendala teknis / keselamatan',
      OTHER_REVIEW_REQUIRED: 'Alasan operasional studio',
    };

    const reasonText = reasonLabelMap[reasonCode]
      ? (note ? `${reasonLabelMap[reasonCode]} (${note})` : reasonLabelMap[reasonCode])
      : (note ? `${reasonCode}: ${note}` : reasonCode);

    for (const attendee of payload.attendees) {
      if (attendee.phone) {
        const message =
          `Halo ${attendee.name},\n\n` +
          `Kami menginformasikan bahwa kelas Pilates *${payload.className}* di cabang *${payload.branchName}* ` +
          `pada *${classDateStr}* dibatalkan oleh pihak studio (${reasonText}).\n\n` +
          `Kuota sesi Anda tetap aman dan dapat langsung Anda gunakan kembali untuk memilih jadwal kelas lainnya.\n\n` +
          `Mohon maaf atas ketidaknyamanan ini.\n_Daily Dose Pilates_`;

        await this.whatsapp.sendMessage({
          to: attendee.phone,
          text: message,
          recipientType: 'CUSTOMER',
          reminderType: 'CLASS_CANCELLED_MANUAL',
          payload: { slotId: payload.slotId, bookingId: attendee.bookingId, reason: reasonCode },
        }).catch((err) => {
          this.logger.warn(`Gagal kirim WA ke ${attendee.phone}: ${err?.message || err}`);
        });
      }
    }

    if (payload.instructorPhone) {
      const coachName = payload.instructorName || 'Coach';
      const instructorMsg =
        `Halo Coach ${coachName},\n\n` +
        `Kelas *${payload.className}* di cabang *${payload.branchName}* pada *${classDateStr}* ` +
        `telah dibatalkan oleh pihak studio (${reasonText}).\n\n` +
        `Jadwal mengajar Anda telah dibebaskan. Terima kasih.\n_Daily Dose Pilates_`;

      await this.whatsapp.sendMessage({
        to: payload.instructorPhone,
        text: instructorMsg,
        recipientType: 'INSTRUCTOR',
        reminderType: 'CLASS_CANCELLED_MANUAL_INSTRUCTOR',
        payload: { slotId: payload.slotId, reason: reasonCode },
      }).catch((err) => {
        this.logger.warn(`Gagal kirim WA ke instruktur: ${err?.message || err}`);
      });
    }
  }

  async complete(
    principal: SessionPrincipal,
    id: string,
    input: { expectedVersion?: number; controlHash?: string; reason?: string },
    key: string,
    _correlationId: string,
    now = new Date(),
  ) {
    this.validateKey(key);
    if (!UUID.test(id))
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY);
    // Versi opsional untuk penyelesaian (klien lama), tetapi bila dikirim harus benar-benar cocok.
    const expectedVersion =
      input.expectedVersion === undefined ? undefined : this.requireVersion(input.expectedVersion);

    return this.execute(
      principal,
      `class-slot:complete:${id}`,
      key,
      input,
      HttpStatus.OK,
      async (tx) => {
        const slot = await tx.slotKelas.findUnique({
          where: { id },
          include: {
            branch: true,
            classType: true,
            instructorAttendance: { select: { checkedInAt: true, method: true } },
            bookings: {
              include: { attendance: true, customerPackage: true },
            },
          },
        });
        if (!slot) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
        this.authorizeCompletion(principal, slot);

        const tally = (bookings: Array<{ status: string }>) =>
          bookings.reduce(
            (acc, booking) => {
              if (booking.status === 'ATTENDED') acc.attendanceCount += 1;
              else if (booking.status === 'NO_SHOW') acc.noShowCount += 1;
              return acc;
            },
            { attendanceCount: 0, noShowCount: 0 },
          );

        // Jika slot sudah pernah COMPLETED, return view (idempotent guard)
        if (slot.status === ClassSlotStatus.COMPLETED) {
          return { ...this.view(slot), ...tally(slot.bookings) };
        }

        // Hanya kelas CONFIRMED yang dapat diselesaikan; DRAFT/PUBLISHED/CANCELLED tidak punya presensi sah.
        if (!STATUS_ALLOWED.complete.includes(slot.status))
          throw new ApiProblem('INVALID_STATE_TRANSITION', HttpStatus.CONFLICT);
        if (expectedVersion !== undefined && slot.version !== expectedVersion)
          throw new ApiProblem('STALE_VERSION', HttpStatus.CONFLICT);

        // Atomic lock guard: update status ke COMPLETED terlebih dahulu untuk mengunci baris secara eksklusif di MySQL
        const lockResult = await tx.slotKelas.updateMany({
          where: {
            id,
            status: ClassSlotStatus.CONFIRMED,
            ...(expectedVersion !== undefined ? { version: expectedVersion } : {}),
          },
          data: { status: ClassSlotStatus.COMPLETED, version: { increment: 1 } },
        });

        if (lockResult.count === 0) {
          // Sudah diselesaikan secara bersamaan oleh request paralel lain
          const currentSlot = await tx.slotKelas.findUniqueOrThrow({
            where: { id },
            include: {
              branch: true,
              studio: true,
              room: true,
              classType: true,
              instructor: { include: { profile: true } },
              ...HITUNG_TERISI,
              instructorAttendance: { select: { checkedInAt: true, method: true } },
              bookings: true,
            },
          });
          if (currentSlot.status !== ClassSlotStatus.COMPLETED)
            throw new ApiProblem(
              currentSlot.status === ClassSlotStatus.CONFIRMED
                ? 'STALE_VERSION'
                : 'INVALID_STATE_TRANSITION',
              HttpStatus.CONFLICT,
            );
          return { ...this.view(currentSlot), ...tally(currentSlot.bookings) };
        }

        // Evaluasi kehadiran & potong sesi bagi customer yang ATTENDED (Rule #1)
        let attendanceCount = 0;
        let noShowCount = 0;
        for (const booking of slot.bookings) {
          const wasAttended = booking.status === 'ATTENDED' || Boolean(booking.attendance);
          const newStatus = wasAttended ? 'ATTENDED' : 'NO_SHOW';
          if (wasAttended) attendanceCount += 1;
          else noShowCount += 1;

          if (booking.status !== newStatus) {
            await tx.pemesananKelas.update({
              where: { id: booking.id },
              data: { status: newStatus },
            });
          }

          // Rule #1 & Kebijakan No-Show: Sesi terpotong saat kelas COMPLETED baik hadir maupun mangkir
          const existingLedger = await tx.sessionLedger.findFirst({
            where: {
              referenceId: booking.id,
              type: SessionMutationType.ATTEND,
            },
          });

          if (!existingLedger && booking.customerPackageId) {
            const customerPackage = await tx.paketPelanggan.findUnique({
              where: { id: booking.customerPackageId },
            });

            if (customerPackage) {
              const remainingAfter = Math.max(0, customerPackage.remainingSessions - 1);
              const noteText = wasAttended
                ? `Class session completed: ${slot.classType?.name ?? 'Class'} at ${slot.branch?.name ?? 'Studio'}`
                : `Sesi hangus (NO SHOW): Mangkir tanpa pembatalan resmi kelas ${slot.classType?.name ?? 'Class'} di ${slot.branch?.name ?? 'Studio'}`;

              // Catat mutasi SessionLedger
              await tx.sessionLedger.create({
                data: {
                  customerPackageId: customerPackage.id,
                  type: SessionMutationType.ATTEND,
                  amount: -1,
                  balanceAfter: remainingAfter,
                  referenceId: booking.id,
                  notes: noteText,
                  createdById: principal.userId,
                },
              });

              // Update saldo kuota di PaketPelanggan
              await tx.paketPelanggan.update({
                where: { id: customerPackage.id },
                data: {
                  usedSessions: { increment: 1 },
                  remainingSessions: { decrement: 1 },
                  status: remainingAfter <= 0 ? 'DEPLETED' : customerPackage.status,
                },
              });
            }
          }

          // Revoke active checkin tokens
          await tx.checkInToken.updateMany({
            where: { bookingId: booking.id, isUsed: false },
            data: { isUsed: true },
          });
        }

        await this.auditSlot(
          tx, principal, _correlationId, 'class_slot.completed', slot,
          { status: slot.status },
          { status: ClassSlotStatus.COMPLETED, attendanceCount, noShowCount },
          input.reason,
        );

        const updated = await tx.slotKelas.findUniqueOrThrow({
          where: { id },
          include: {
            branch: true,
            studio: true,
            room: true,
            classType: true,
            instructor: { include: { profile: true } },
            ...HITUNG_TERISI,
            instructorAttendance: { select: { checkedInAt: true, method: true } },
          },
        });

        return { ...this.view(updated), attendanceCount, noShowCount };
      },
    );
  }

  async completionControl(principal: SessionPrincipal, id: string) {
    if (!UUID.test(id)) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const slot = await this.db.slotKelas.findUnique({ where: { id } });
    if (!slot) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    this.authorizeCompletion(principal, slot);

    const bookings = await this.db.pemesananKelas.findMany({
      where: { classSlotId: id },
      orderBy: { id: 'asc' },
      include: { attendance: { select: { id: true } } },
    });

    return {
      classSlotId: id,
      expectedVersion: slot.version,
      controlHash: classCompletionControlHash(bookings),
      attendanceCount: bookings.filter((b) => Boolean(b.attendance)).length,
      noShowCount: bookings.filter((b) => b.status === 'BOOKED' && !b.attendance).length,
      activeReservationCount: bookings.filter((b) => b.status === 'BOOKED' || b.status === 'ATTENDED').length,
    };
  }

  private validateKey(key: string) {
    if (!key || key.length < 16 || key.length > 128)
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST);
  }

  private execute(
    _principal: SessionPrincipal,
    scope: string,
    key: string,
    payload: unknown,
    status: number,
    action: (tx: Tx) => Promise<object>,
  ) {
    return this.idempotency
      .execute(
        {
          scope,
          key,
          payload,
          ttlMs: 86400000,
          leaseMs: 30000,
        },
        async (tx) => {
          const body = await action(tx);
          return { status, body: body as unknown as Prisma.InputJsonValue };
        },
      )
      .then((res) => ({ status: res.status, body: res.body as any, replay: res.replay }));
  }
}

/**
 * Kelas lain yang bentrok. Bila instruktur yang sama sudah mengajar (bisa di cabang lain, yang tidak
 * tampil di timetable cabang ini), kodenya INSTRUCTOR_SCHEDULE_COLLISION; selain itu ruangannya yang
 * terpakai. Detailnya menyebut kelas yang menghalangi supaya staf tahu harus mengubah apa.
 */
export function bentrokJadwal(
  lain: {
    instructorId: string | null;
    startAt: Date;
    endAt: Date;
    classType?: { name: string } | null;
    branch?: { name: string; timezone: string } | null;
  },
  instructorId: string | null,
): ApiProblem {
  const olehInstruktur = Boolean(instructorId) && lain.instructorId === instructorId;
  const tz = lain.branch?.timezone ?? 'Asia/Jakarta';
  const jam = (d: Date) =>
    new Intl.DateTimeFormat('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: tz,
    }).format(d);
  const hari = new Intl.DateTimeFormat('id-ID', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: tz,
  }).format(lain.startAt);
  const keterangan = [
    lain.classType?.name ?? 'Kelas',
    `${hari} ${jam(lain.startAt)} sampai ${jam(lain.endAt)}`,
    lain.branch?.name,
  ]
    .filter(Boolean)
    .join(', ');
  return new ApiProblem(
    olehInstruktur ? 'INSTRUCTOR_SCHEDULE_COLLISION' : 'SLOT_SCHEDULE_COLLISION',
    HttpStatus.CONFLICT,
    false,
    [{ field: olehInstruktur ? 'instructorUserId' : 'roomId', issue: keterangan }],
  );
}
