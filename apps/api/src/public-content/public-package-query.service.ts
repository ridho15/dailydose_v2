import { HITUNG_TERISI, terisi } from '../classes/terisi';
import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ApiProblem } from '../identity/security';
import { assertPublicUuid } from './public-query.validation';
import { PackagePricingService } from '../packages/kalkulasi-harga-paket.service';
import { branchPublicLocation } from '../master/branch-location';

type Priced = ReturnType<PackagePricingService['calculate']>;

/** Bentuk harga yang dibaca katalog publik; sama untuk daftar dan detail. */
function publicPricing(priceRp: number, priced: Priced) {
  const promotion = priced.promotion
    ? {
        id: priced.promotion.id,
        name: priced.promotion.name,
        label: priced.promotion.label,
        discountType: priced.promotion.discountType === 'PERCENTAGE' ? 'PERCENTAGE' : 'FIXED_AMOUNT',
        discountValue: priced.promotion.discountValue,
        discountRp: priced.promotion.discountRp,
        promotionalPriceRp: priced.promotion.promotionalPriceRp,
        activeFrom: priced.promotion.activeFrom.toISOString(),
        activeUntil: priced.promotion.activeUntil.toISOString(),
        version: priced.promotion.version,
      }
    : null;
  return {
    isDiscounted: Boolean(promotion),
    discountedPriceRp: priced.effectivePriceRp,
    discountPercent: promotion ? Math.round((promotion.discountRp / priceRp) * 100) : 0,
    effectivePriceRp: priced.effectivePriceRp,
    promotion,
  };
}

@Injectable()
export class PublicPackageQueryService {
  private readonly pricing = new PackagePricingService();

  constructor(private readonly db: PrismaService) {}

  async list(branchId?: string) {
    if (branchId) assertPublicUuid(branchId, 'VALIDATION_ERROR');

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

    const branches = rawBranches.map((b: any) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      timezone: b.timezone,
      supportWhatsappE164: b.supportWhatsappE164,
      publicProfile: b.publicProfile ?? {
        slug: b.code.toLowerCase(),
        ...branchPublicLocation(b.code, b.name, b.address),
        address: b.address ?? '',
        openingHours: ['Senin - Minggu: 06:00 - 21:00'],
      },
    }));

    if (branchId && !branches.some((branch) => branch.id === branchId))
      throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

    if (!branchId) return { branches, items: [] };

    const rawPackages = await this.db.paket.findMany({
      where: {
        branchId,
        status: 'ACTIVE',
      },
      include: {
        classType: {
          select: { id: true, code: true, name: true },
        },
      },
      orderBy: [{ priceRp: 'asc' }, { id: 'asc' }],
      take: 100,
    });

    const branch = branches.find(({ id }) => id === branchId) ?? branches[0] ?? null;

    const seen = new Set<string>();
    const packages: typeof rawPackages = [];
    for (const pkg of rawPackages) {
      const key = (pkg as any).businessKey || pkg.id;
      if (!seen.has(key)) {
        seen.add(key);
        packages.push(pkg);
      }
    }

    const promotions = await this.pricing.activePromotions(
      this.db,
      packages.map((pkg) => pkg.id),
    );
    const items = packages.map((pkg: any) => {
      const classTypes =
        pkg.classTypeScopes?.map((s: any) => s.classType) ||
        (pkg.classType ? [pkg.classType] : []);
      return {
        id: pkg.id,
        name: pkg.name,
        sessionCount: pkg.sessionCount,
        durationDays: pkg.validityDays,
        priceRp: pkg.priceRp,
        branchId: branch?.id ?? branchId ?? '',
        classType: classTypes[0] ?? pkg.classType ?? { id: 'all', code: 'ALL', name: 'Semua Kelas' },
        classTypes,
        ...publicPricing(pkg.priceRp, this.pricing.calculate(pkg.priceRp, promotions.get(pkg.id))),
        branch,
      };
    });

    return { branches, items };
  }

  async detail(id: string, branchId?: string) {
    assertPublicUuid(id);
    const hasBranchFilter = Boolean(branchId && branchId.trim() !== '');
    if (hasBranchFilter) assertPublicUuid(branchId!);
    const now = new Date();

    const item = await this.db.paket.findFirst({
      where: {
        id,
        status: 'ACTIVE',
      },
      include: {
        classType: {
          select: { id: true, code: true, name: true },
        },
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
      },
    });

    if (!item) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

    let branchData = item.branch;
    if (hasBranchFilter) {
      branchData = await this.db.cabang.findFirst({
        where: { id: branchId, active: true },
        select: {
          id: true,
          code: true,
          name: true,
          timezone: true,
          address: true,
          supportWhatsappE164: true,
        },
      });
      if (!branchData) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    } else if (!branchData) {
      branchData = await this.db.cabang.findFirst({
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
      if (!branchData) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    const branch = {
      ...branchData,
      publicProfile: {
        slug: branchData.code.toLowerCase(),
        ...branchPublicLocation(branchData.code, branchData.name, branchData.address),
        address: branchData.address ?? '',
        heroImageKey: null,
        openingHours: ['Senin - Minggu: 06:00 - 21:00'],
      },
    };

    const schedules = await this.db.slotKelas.findMany({
      where: {
        branchId: branch.id,
        ...(item.classTypeId ? { classTypeId: item.classTypeId } : {}),
        status: { in: ['PUBLISHED', 'CONFIRMED'] },
        startAt: { gt: now },
      },
      select: {
        id: true,
        startAt: true,
        endAt: true,
        status: true,
        capacity: true,
        bookedCount: true,
        ...HITUNG_TERISI,
      },
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
      take: 4,
    });

    const classType = item.classType ?? { id: 'all', code: 'ALL', name: 'Semua Kelas' };
    const classTypes = [classType];
    const priced = this.pricing.calculate(
      item.priceRp,
      await this.pricing.activePromotion(this.db, item.id, now),
      now,
    );

    return {
      id: item.id,
      name: item.name,
      sessionCount: item.sessionCount,
      durationDays: item.validityDays,
      priceRp: item.priceRp,
      effectiveFrom: item.createdAt,
      effectiveUntil: null,
      publicProfile: {
        summary: `${item.sessionCount} Sesi Pilates - Berlaku ${item.validityDays} Hari`,
        description:
          item.description?.trim() ||
          `Paket latihan pilates ${item.name} dengan total ${item.sessionCount} sesi kelas.`,
        highlights: ['Akses instruktur bersertifikat', 'Fasilitas studio lengkap', 'Jadwal fleksibel'],
        usageGuidance: 'Pemesanan kelas dapat dilakukan melalui aplikasi kapan saja.',
        terms: [
          'Paket tidak dapat diuangkan kembali.',
          'Masa berlaku dihitung sejak tanggal aktivasi atau pembelian pertama.',
          'Pemesanan dan pembatalan kelas mengikuti ketentuan cutoff yang berlaku.',
        ],
      },
      branch,
      classType,
      classTypes,
      ...publicPricing(item.priceRp, priced),
      pricePerSessionRp: Math.round(priced.effectivePriceRp / item.sessionCount),
      schedules: schedules.map(({ bookedCount, _count, ...schedule }) => ({
        ...schedule,
        timezone: branch.timezone,
        available: Math.max(0, schedule.capacity - terisi({ bookedCount, _count })),
      })),
    };
  }
}
