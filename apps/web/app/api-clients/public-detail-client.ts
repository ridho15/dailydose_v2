import type {
  PublicBranch,
  PublicClassProfile,
  PublicClassTypeRef,
  PublicPackageProfile,
  PublicPackageSummary,
  PublicScheduleSummary,
  PublicStudioDetailAllOfClasses,
} from './public-api-client';
import { appLoading } from '../components/app-loading';
import { publicApiStatus, publicGeneratedApi } from './public-api-client';
import type { PublicPromotionPrice } from '../components/public/package-price';

type EffectivePublicPrice = {
  effectivePriceRp: number;
  promotion: PublicPromotionPrice | null;
};

export type PublicProfileBranch = PublicBranch;

export type RelatedSchedule = Pick<
  PublicScheduleSummary,
  'id' | 'branchId' | 'timezone' | 'status' | 'capacity' | 'available' | 'classType'
> & {
  startAt: string;
  endAt: string;
  branch?: PublicBranch;
};

export interface GeneratedPublicPackageDetail {
  id: string;
  name: string;
  description?: string | null;
  priceRp: number;
  effectivePriceRp?: number;
  /** null untuk paket perpanjangan masa aktif (0 sesi). */
  pricePerSessionRp: number | null;
  sessionCount: number;
  perpanjanganMasaAktif?: boolean;
  extensionDays?: number | null;
  validityDays?: number;
  durationDays?: number;
  branch: PublicBranch;
  classType: PublicClassTypeRef;
  publicProfile: PublicPackageProfile;
  effectiveFrom: Date;
  effectiveUntil?: Date | null;
  schedules: PublicScheduleSummary[];
}

export interface GeneratedPublicScheduleDetail {
  id: string;
  branchId: string;
  branch: PublicBranch;
  classType: PublicClassTypeRef;
  classProfile: PublicClassProfile;
  instructor?: { id?: string; displayName: string } | null;
  room?: { id: string; name: string } | null;
  timezone: string;
  startAt: Date | string;
  endAt: Date | string;
  capacity: number;
  available: number;
  canBook: boolean;
  status: string;
}

export interface GeneratedPublicClassDetail {
  profile: PublicClassProfile;
  studios: PublicBranch[];
  packages: Array<PublicPackageSummary>;
  schedules: PublicScheduleSummary[];
}

export interface GeneratedPublicStudioDetail {
  id: string;
  code: string;
  name: string;
  timezone: string;
  supportWhatsappE164?: string | null;
  publicProfile: PublicBranch['publicProfile'];
  classes: Array<PublicStudioDetailAllOfClasses>;
  packages: Array<PublicPackageSummary>;
  schedules: PublicScheduleSummary[];
}

export type PublicPackageDetail = Omit<
  GeneratedPublicPackageDetail,
  'effectiveFrom' | 'effectiveUntil' | 'schedules'
> & {
  effectiveFrom: string;
  effectiveUntil: string | null;
  schedules: RelatedSchedule[];
} & EffectivePublicPrice;

export type PublicScheduleDetail = Omit<GeneratedPublicScheduleDetail, 'startAt' | 'endAt'> & {
  startAt: string;
  endAt: string;
};

export interface PublicClassDetail {
  profile: PublicClassProfile;
  studios: PublicProfileBranch[];
  packages: Array<
    Pick<PublicPackageSummary, 'id' | 'name' | 'sessionCount' | 'durationDays' | 'priceRp'> & {
      publicProfile: Pick<PublicPackageProfile, 'summary'>;
      branch: PublicProfileBranch;
    } & EffectivePublicPrice
  >;
  schedules: RelatedSchedule[];
}

export interface PublicStudioDetail extends Pick<
  GeneratedPublicStudioDetail,
  'id' | 'code' | 'name' | 'timezone' | 'supportWhatsappE164' | 'publicProfile'
> {
  classes: Array<PublicStudioDetailAllOfClasses & { profile: PublicClassProfile }>;
  packages: Array<
    Pick<PublicPackageSummary, 'id' | 'name' | 'sessionCount' | 'durationDays' | 'priceRp'> & {
      publicProfile: Pick<PublicPackageProfile, 'summary'>;
      classType: PublicClassTypeRef;
    } & EffectivePublicPrice
  >;
  schedules: RelatedSchedule[];
}

function scheduleView(item: PublicScheduleSummary): RelatedSchedule {
  return {
    ...item,
    startAt: typeof item.startAt === 'string' ? item.startAt : (item.startAt as any).toISOString(),
    endAt: typeof item.endAt === 'string' ? item.endAt : (item.endAt as any).toISOString(),
    branch: item.branch ?? undefined,
  };
}

function classDetailView(item: GeneratedPublicClassDetail): PublicClassDetail {
  return {
    profile: item.profile,
    studios: item.studios,
    packages: item.packages
      .filter(
        (
          candidate,
        ): candidate is PublicPackageSummary & {
          publicProfile: PublicPackageProfile;
          branch: PublicBranch;
        } => Boolean(candidate.publicProfile && candidate.branch),
      )
      .map(({ id, name, sessionCount, durationDays, priceRp, publicProfile, branch, ...rest }) => ({
        id,
        name,
        sessionCount,
        durationDays,
        priceRp,
        publicProfile,
        branch,
        effectivePriceRp: (rest as any).effectivePriceRp ?? priceRp,
        promotion: (rest as any).promotion ?? null,
      })),
    schedules: item.schedules.map(scheduleView),
  };
}

function studioDetailView(item: GeneratedPublicStudioDetail): PublicStudioDetail {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    timezone: item.timezone,
    supportWhatsappE164: item.supportWhatsappE164,
    publicProfile: item.publicProfile,
    classes: item.classes.filter(
      (candidate): candidate is PublicStudioDetailAllOfClasses & { profile: PublicClassProfile } =>
        Boolean(candidate.profile),
    ),
    packages: item.packages
      .filter(
        (
          candidate,
        ): candidate is PublicPackageSummary & {
          publicProfile: PublicPackageProfile;
          classType: PublicClassTypeRef;
        } => Boolean(candidate.publicProfile && candidate.classType),
      )
      .map(
        ({ id, name, sessionCount, durationDays, priceRp, publicProfile, classType, ...rest }) => ({
          id,
          name,
          sessionCount,
          durationDays,
          priceRp,
          publicProfile,
          classType,
          effectivePriceRp: (rest as any).effectivePriceRp ?? priceRp,
          promotion: (rest as any).promotion ?? null,
        }),
      ),
    schedules: item.schedules.map(scheduleView),
  };
}

export const publicDetailClient = {
  async package(id: string): Promise<PublicPackageDetail> {
    const item = await appLoading.track(
      publicGeneratedApi.packages.getPublicPackageDetail({ id }),
      { label: 'Memuat detail paket…' },
    );
    return {
      ...item,
      effectivePriceRp: (item as any).effectivePriceRp ?? item.priceRp,
      promotion: (item as any).promotion ?? null,
      effectiveFrom: item.effectiveFrom.toISOString(),
      effectiveUntil: item.effectiveUntil?.toISOString() ?? null,
      schedules: item.schedules.map(scheduleView),
    };
  },
  async schedule(id: string): Promise<PublicScheduleDetail> {
    const item = await appLoading.track(
      publicGeneratedApi.classes.getPublicScheduleDetail({ id }),
      { label: 'Memuat detail jadwal…' },
    );
    return {
      ...item,
      startAt: item.startAt.toISOString(),
      endAt: item.endAt.toISOString(),
    };
  },
  async classType(slug: string): Promise<PublicClassDetail> {
    return classDetailView(
      await appLoading.track(publicGeneratedApi.classes.getPublicClassDetail({ slug }), {
        label: 'Memuat detail kelas…',
      }),
    );
  },
  async studio(slug: string): Promise<PublicStudioDetail> {
    return studioDetailView(
      await appLoading.track(publicGeneratedApi.master.getPublicStudioDetail({ slug }), {
        label: 'Memuat detail studio…',
      }),
    );
  },
};

export function publicDetailFailure(error: unknown) {
  const status = publicApiStatus(error);
  if (status === 404) return 'NOT_FOUND';
  if (status === 503) return 'Layanan sedang tidak tersedia. Silakan coba beberapa saat lagi.';
  return 'Detail belum dapat dimuat. Periksa koneksi lalu coba lagi.';
}
