import { HITUNG_TERISI, terisi } from '../classes/terisi';
import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { RuntimeConfigService } from '../configuration/runtime-config.service';
import { ApiProblem } from '../identity/security';
import { assertPublicUuid, publicScheduleRange } from './public-query.validation';
import { branchPublicLocation } from '../master/branch-location';

@Injectable()
export class PublicScheduleQueryService {
  constructor(
    private readonly db: PrismaService,
    private readonly config: RuntimeConfigService,
  ) {}

  /** Slot dapat di-booking bila fitur aktif, masih ada tempat, dan belum melewati batas cutoff. */
  private canBook(startAt: Date, available: number, now: Date): boolean {
    const { enabled, cutoffHours } = this.config.value.booking;
    if (!enabled || cutoffHours === null || available < 1) return false;
    return now < new Date(startAt.getTime() - cutoffHours * 3_600_000);
  }

  async list(input: { branchId?: string; from?: string; until?: string }) {
    if (input.branchId) assertPublicUuid(input.branchId, 'VALIDATION_ERROR');
    const { from, until } = publicScheduleRange(input.from, input.until);

    const rawBranches = await this.db.cabang.findMany({
      where: { active: true },
      select: {
        id: true,
        code: true,
        name: true,
        timezone: true,
        address: true,
        supportWhatsappE164: true,
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });

    const branches = rawBranches.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      timezone: b.timezone,
      supportWhatsappE164: b.supportWhatsappE164,
      publicProfile: {
        slug: b.code.toLowerCase(),
        ...branchPublicLocation(b.code, b.name, b.address),
        address: b.address ?? '',
        openingHours: ['Senin - Minggu: 06:00 - 21:00'],
      },
    }));

    if (input.branchId && !branches.some(({ id }) => id === input.branchId))
      throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

    const branch = branches.find(({ id }) => id === input.branchId);

    const slots = input.branchId
      ? await this.db.slotKelas.findMany({
          where: {
            branchId: input.branchId,
            status: { in: ['PUBLISHED', 'CONFIRMED'] },
            startAt: { gte: from, lt: until },
          },
          select: {
            id: true,
            branchId: true,
            startAt: true,
            endAt: true,
            status: true,
            capacity: true,
            bookedCount: true,
            ...HITUNG_TERISI,
            classType: { select: { id: true, code: true, name: true } },
            instructor: { select: { displayName: true } },
          },
          orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
          take: 100,
        })
      : [];

    const now = new Date();
    return {
      branches,
      items: slots.map(({ bookedCount, _count, ...slot }) => {
        const available = Math.max(0, slot.capacity - terisi({ bookedCount, _count }));
        return {
          ...slot,
          timezone: branch?.timezone ?? 'Asia/Jakarta',
          branch,
          available,
          canBook: this.canBook(slot.startAt, available, now),
        };
      }),
      range: { from, until },
    };
  }

  async detail(id: string) {
    assertPublicUuid(id);
    const slot = await this.db.slotKelas.findFirst({
      where: {
        id,
        status: { in: ['PUBLISHED', 'CONFIRMED'] },
      },
      include: {
        classType: true,
        instructor: { select: { displayName: true } },
        studio: { select: { id: true, name: true } },
        room: { select: { id: true, name: true } },
        branch: true,
        ...HITUNG_TERISI,
      },
    });

    if (!slot) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

    const publicProfile = {
      slug: slot.branch.code.toLowerCase(),
      ...branchPublicLocation(slot.branch.code, slot.branch.name, slot.branch.address),
      address: slot.branch.address ?? '',
    };

    const classProfile = {
      code: slot.classType.code,
      name: slot.classType.name,
      slug: slot.classType.code.toLowerCase(),
      summary: slot.classType.description ?? `${slot.classType.name} Pilates`,
      description: slot.classType.description ?? `${slot.classType.name} Pilates`,
      level: 'ALL_LEVELS',
      durationMinutes: slot.classType.durationMinutes,
      equipment: ['Reformer'],
      benefits: ['Core Strength', 'Flexibility'],
      heroImageKey: null,
    };

    const { bookedCount, _count, ...safeSlot } = slot;
    const available = Math.max(0, slot.capacity - terisi({ bookedCount, _count }));

    return {
      ...safeSlot,
      timezone: slot.branch.timezone,
      available,
      canBook: this.canBook(slot.startAt, available, new Date()),
      branch: {
        ...slot.branch,
        publicProfile,
      },
      classProfile,
    };
  }
}
