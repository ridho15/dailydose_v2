import { HITUNG_TERISI, terisi } from '../classes/terisi';
import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ApiProblem } from '../identity/security';
import { branchPublicLocation } from '../master/branch-location';

@Injectable()
export class PublicStudioQueryService {
  constructor(private readonly db: PrismaService) {}

  async detail(slug: string) {
    const raw = slug?.trim();
    if (!raw) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

    const now = new Date();
    const branch = await this.db.cabang.findFirst({
      where: {
        active: true,
        OR: [
          { code: raw.toUpperCase() },
          { id: raw },
        ],
      },
      include: {
        studios: {
          where: { active: true },
          include: {
            rooms: { where: { active: true } },
          },
        },
      },
    });

    if (!branch) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

    const classTypes = await this.db.jenisKelas.findMany({
      where: { active: true },
      include: {
        classSlots: {
          where: {
            branchId: branch.id,
            status: { in: ['PUBLISHED', 'CONFIRMED'] },
            startAt: { gt: now },
          },
          include: {
            instructor: { select: { displayName: true } },
            ...HITUNG_TERISI,
          },
          orderBy: { startAt: 'asc' },
          take: 10,
        },
      },
      orderBy: { name: 'asc' },
    });

    const packages = await this.db.paket.findMany({
      where: { status: 'ACTIVE' },
      include: { classType: true },
      take: 20,
    });

    const branchMetadata: Record<string, { city: string; area: string; heroImageKey: string }> = {
      'DD-GG': {
        city: 'Jakarta Barat',
        area: 'Kedoya Utara, Kebon Jeruk',
        heroImageKey: 'branches/green-garden.png',
      },
      'DD-MK': {
        city: 'Jakarta Utara',
        area: 'Pluit, Penjaringan',
        heroImageKey: 'branches/muara-karang.png',
      },
      'DD-SBY': {
        city: 'Surabaya',
        area: 'Dukuhpakis, Surabaya Barat',
        heroImageKey: 'branches/graha-family-surabaya.png',
      },
      'DD-UNTAR': {
        city: 'Jakarta Barat',
        area: 'Tanjung Duren, Grogol Petamburan',
        heroImageKey: 'branches/untar-kampus-2.png',
      },
      'DD-PIK2': {
        city: 'Tangerang',
        area: 'PIK 2, Kosambi',
        heroImageKey: 'branches/orange-groves-pik2.png',
      },
    };

    const meta = branchMetadata[branch.code];
    const publicProfile = {
      slug: branch.code.toLowerCase(),
      ...branchPublicLocation(branch.code, branch.name, branch.address),
      address: branch.address ?? '',
      description: `${branch.name} Studio Pilates`,
      arrivalInformation: 'Silakan datang 10-15 menit sebelum sesi kelas dimulai.',
      parkingInformation: 'Tersedia tempat parkir kendaraan.',
      openingHours: ['Senin - Minggu: 06:00 - 21:00'],
      amenities: ['Locker', 'Shower', 'Water Refill', 'Towel'],
      heroImageKey: branch.heroImageKey ?? meta?.heroImageKey ?? null,
      galleryImageKeys: (branch.galleryImageKeys as string[]) ?? [],
    };

    return {
      ...branch,
      publicProfile,
      classes: classTypes.map((ct) => ({
        id: ct.id,
        code: ct.code,
        name: ct.name,
        profile: {
          code: ct.code,
          name: ct.name,
          slug: ct.code.toLowerCase(),
          summary: ct.description ?? `${ct.name} Pilates`,
          description: ct.description ?? `${ct.name} Pilates`,
          durationMinutes: ct.durationMinutes,
          level: 'ALL_LEVELS',
          equipment: ['Reformer'],
          benefits: ['Core Strength', 'Flexibility'],
          heroImageKey:
            ct.heroImageKey ??
            (ct.code.includes('MAT') ? 'classes/mat-pilates.png' : 'classes/reformer-pilates.png'),
        },
      })),
      packages: packages.map((p) => ({
        id: p.id,
        name: p.name,
        sessionCount: p.sessionCount,
        durationDays: p.validityDays,
        priceRp: p.priceRp,
        branchId: branch.id,
        classTypes: p.classType ? [{ id: p.classType.id, code: p.classType.code, name: p.classType.name }] : [],
        isDiscounted: false,
        discountedPriceRp: p.priceRp,
        discountPercent: 0,
      })),
      schedules: classTypes
        .flatMap((ct) =>
          ct.classSlots.map((slot) => ({
            id: slot.id,
            startAt: slot.startAt,
            endAt: slot.endAt,
            timezone: branch.timezone,
            status: slot.status,
            capacity: slot.capacity,
            bookedCount: terisi(slot),
            available: Math.max(0, slot.capacity - terisi(slot)),
            classType: { code: ct.code, name: ct.name },
            instructor: slot.instructor?.displayName ? { displayName: slot.instructor.displayName } : null,
          })),
        )
        .sort((left, right) => left.startAt.getTime() - right.startAt.getTime())
        .slice(0, 8),
    };
  }
}
