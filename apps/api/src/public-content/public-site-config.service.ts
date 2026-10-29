import { Injectable } from '@nestjs/common';
import { RuntimeConfigService } from '../configuration/runtime-config.service';
import { PrismaService } from '../database/prisma.service';
import { FAQ_CONTENT_KEY, FAQ_LOCALE } from './faq.validation';
import { HERO_CONTENT_KEY, HERO_LOCALE } from './hero-carousel.validation';
import { branchPublicLocation } from '../master/branch-location';

@Injectable()
export class PublicSiteConfigService {
  constructor(
    private readonly db: PrismaService,
    private readonly runtimeConfig: RuntimeConfigService,
  ) {}

  async get() {
    const rawBranches = await this.db.cabang.findMany({
      where: { active: true },
      select: {
        id: true,
        code: true,
        name: true,
        timezone: true,
        address: true,
        supportWhatsappE164: true,
        heroImageKey: true,
        galleryImageKeys: true,
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
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

    const branches = rawBranches.map((b) => {
      const meta = branchMetadata[b.code];
      return {
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
          heroImageKey: b.heroImageKey ?? meta?.heroImageKey ?? null,
          galleryImageKeys: (b.galleryImageKeys as string[]) ?? [],
        },
      };
    });

    const activeClassTypes = await this.db.jenisKelas.findMany({
      where: { active: true },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        durationMinutes: true,
        heroImageKey: true,
        galleryImageKeys: true,
      },
      orderBy: [{ code: 'asc' }],
    });

    const classes = activeClassTypes.map((ct) => ({
      code: ct.code,
      name: ct.name,
      slug: ct.code.toLowerCase(),
      summary: ct.description ?? `${ct.name} Pilates Session`,
      description: ct.description ?? `${ct.name} Pilates Session`,
      level: 'ALL_LEVELS',
      durationMinutes: ct.durationMinutes,
      equipment: ['Reformer', 'Mat'],
      benefits: ['Core Strength', 'Flexibility', 'Posture Correction'],
      heroImageKey:
        ct.heroImageKey ??
        (ct.code.includes('MAT') ? 'classes/mat-pilates.png' : 'classes/reformer-pilates.png'),
    }));

    const published = (contentKey: string, locale: string) =>
      this.db.publicContent.findFirst({
        where: { contentKey, scopeKey: 'GLOBAL', locale, status: 'PUBLISHED' },
        orderBy: { version: 'desc' },
        select: { payload: true },
      });
    const [publishedHero, publishedFaq] = await Promise.all([
      // Beranda berbahasa Inggris: slider hero id-ID lama tidak lagi ditampilkan.
      published(HERO_CONTENT_KEY, HERO_LOCALE),
      published(FAQ_CONTENT_KEY, FAQ_LOCALE),
    ]);

    return {
      branches,
      classes,
      heroCarousel: publishedHero?.payload ?? null,
      faq: publishedFaq?.payload ?? null,
      fallbackWhatsappE164: this.runtimeConfig.value.publicSupportWhatsappE164 ?? null,
      mobileFeatures: {
        accountRecovery: this.runtimeConfig.value.mobileFeatures.accountRecovery,
        revokeAllSessions: this.runtimeConfig.value.mobileFeatures.revokeAllSessions,
        bookingCancellation: this.runtimeConfig.value.bookingCancellation.enabled,
        reschedule: this.runtimeConfig.value.reschedule.enabled,
        customerCheckIn: this.runtimeConfig.value.mobileFeatures.customerCheckIn,
        instructorCheckIn: this.runtimeConfig.value.mobileFeatures.instructorCheckIn,
      },
    };
  }
}
