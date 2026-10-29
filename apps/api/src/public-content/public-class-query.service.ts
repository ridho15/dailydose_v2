import { HITUNG_TERISI, terisi } from '../classes/terisi';
import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ApiProblem } from '../identity/security';
import { branchPublicLocation } from '../master/branch-location';

@Injectable()
export class PublicClassQueryService {
  constructor(private readonly db: PrismaService) {}

  async detail(slugOrCode: string) {
    const raw = slugOrCode?.trim();
    if (!raw) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

    const now = new Date();

    const aliasMap: Record<string, string> = {
      'reformer-pilates': 'GROUP_CLASS',
      reformer: 'GROUP_CLASS',
      'group-class': 'GROUP_CLASS',
      group_class: 'GROUP_CLASS',
      group: 'GROUP_CLASS',
      'private-class': 'PRIVATE_CLASS',
      private_class: 'PRIVATE_CLASS',
      private: 'PRIVATE_CLASS',
      'semi-private': 'SEMI_PRIVATE',
      semi_private: 'SEMI_PRIVATE',
      'private-group': 'PRIVATE_GROUP',
      private_group: 'PRIVATE_GROUP',
    };
    const lookupCode = aliasMap[raw.toLowerCase()] ?? raw.toUpperCase();

    const classType = await this.db.jenisKelas.findFirst({
      where: {
        active: true,
        OR: [{ code: lookupCode }, { code: raw.toUpperCase() }, { id: raw }],
      },
    });

    if (!classType) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

    const profile = {
      code: classType.code,
      name: classType.name,
      slug: classType.code.toLowerCase(),
      summary: classType.description ?? `${classType.name} Pilates`,
      description: classType.description ?? `${classType.name} Pilates`,
      level: 'ALL_LEVELS',
      durationMinutes: classType.durationMinutes,
      equipment: ['Reformer', 'Mat'],
      benefits: ['Core Strength', 'Flexibility', 'Posture Correction'],
      heroImageKey: null,
    };

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
      orderBy: [{ name: 'asc' }],
    });

    const studios = rawBranches.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      timezone: b.timezone,
      supportWhatsappE164: b.supportWhatsappE164,
      publicProfile: {
        slug: b.code.toLowerCase(),
        ...branchPublicLocation(b.code, b.name, b.address),
        address: b.address ?? '',
        description: `${b.name} Studio Pilates`,
        arrivalInformation: 'Silakan datang 10-15 menit sebelum sesi kelas dimulai.',
        parkingInformation: 'Tersedia tempat parkir kendaraan.',
        openingHours: ['Senin - Minggu: 06:00 - 21:00'],
        amenities: ['Locker', 'Shower', 'Water Refill', 'Towel'],
        heroImageKey: null,
        galleryImageKeys: [],
      },
    }));

    const packagesRaw = await this.db.paket.findMany({
      where: {
        status: 'ACTIVE',
        OR: [{ classTypeId: classType.id }, { classTypeId: null }],
      },
      orderBy: [{ priceRp: 'asc' }],
      take: 6,
    });

    const packages = packagesRaw.flatMap((pkg) => {
      const targetBranches = studios.slice(0, 1);
      return targetBranches.map((branch) => ({
        id: pkg.id,
        name: pkg.name,
        sessionCount: pkg.sessionCount,
        durationDays: pkg.validityDays,
        publicProfile: {
          summary: `${pkg.sessionCount} Sesi - Masa Aktif ${pkg.validityDays} Hari`,
        },
        branchId: branch.id,
        branch,
        classTypes: [{ id: classType.id, code: classType.code, name: classType.name }],
        priceRp: pkg.priceRp,
        isDiscounted: false,
        discountedPriceRp: pkg.priceRp,
        discountPercent: 0,
      }));
    });

    const classSlots = await this.db.slotKelas.findMany({
      where: {
        classTypeId: classType.id,
        status: { in: ['PUBLISHED', 'CONFIRMED'] },
        startAt: { gt: now },
      },
      include: {
        instructor: { select: { displayName: true } },
        branch: {
          select: {
            id: true,
            code: true,
            name: true,
            timezone: true,
            address: true,
            supportWhatsappE164: true,
          },
        },
        ...HITUNG_TERISI,
      },
      orderBy: [{ startAt: 'asc' }],
      take: 6,
    });

    const schedules = classSlots.map(({ bookedCount: tersimpan, _count, ...slot }) => {
      const bookedCount = terisi({ bookedCount: tersimpan, _count });
      return {
        id: slot.id,
        branchId: slot.branchId,
        startAt: slot.startAt,
        endAt: slot.endAt,
        timezone: slot.branch.timezone,
        status: slot.status,
        capacity: slot.capacity,
        bookedCount,
        available: Math.max(0, slot.capacity - bookedCount),
        classType: { id: classType.id, code: classType.code, name: classType.name },
        instructor: slot.instructor?.displayName
          ? { displayName: slot.instructor.displayName }
          : null,
        branch: {
          id: slot.branch.id,
          code: slot.branch.code,
          name: slot.branch.name,
          timezone: slot.branch.timezone,
          supportWhatsappE164: slot.branch.supportWhatsappE164,
          publicProfile: {
            slug: slot.branch.code.toLowerCase(),
            ...branchPublicLocation(slot.branch.code, slot.branch.name, slot.branch.address),
            address: slot.branch.address ?? '',
          },
        },
      };
    });

    return {
      profile,
      studios,
      packages,
      schedules,
    };
  }
}
