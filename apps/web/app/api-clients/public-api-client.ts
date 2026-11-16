export interface PublicClassTypeRef {
  id: string;
  code: string;
  name: string;
  description?: string | null;
}

export interface PublicClassProfile {
  code: string;
  slug: string;
  summary: string;
  description: string;
  level: string;
  durationMinutes: number;
  equipment: string[];
  benefits: string[];
  heroImageKey: string;
  prerequisites?: string[];
  equipmentRequired?: string[];
}

export interface PublicPackageProfile {
  summary: string;
  description: string;
  highlights: string[];
  usageGuidance: string;
  terms: string[];
}

export interface PublicStudioDetailAllOfClasses {
  code: string;
  name: string;
  profile: PublicClassProfile;
}

export interface PublicBranch {
  id: string;
  code: string;
  name: string;
  timezone: string;
  supportWhatsappE164?: string | null;
  publicProfile: {
    slug: string;
    area: string;
    city: string;
    address: string;
    description: string;
    arrivalInformation?: string | null;
    parkingInformation?: string | null;
    openingHours: Array<{ days: string; hours: string }>;
    amenities: string[];
    heroImageKey: string;
    galleryImageKeys: string[];
  };
}

export interface PublicPackageSummary {
  id: string;
  name: string;
  description?: string | null;
  priceRp: number;
  sessionCount: number;
  validityDays?: number;
  durationDays?: number;
  branch?: PublicBranch | null;
  branchId?: string;
  classType?: PublicClassTypeRef | null;
  publicProfile?: PublicPackageProfile | null;
  effectiveUntil?: string | Date | null;
  effectivePriceRp?: number;
  pricePerSessionRp?: number;
  promotion?: any;
  /** Paket 0 sesi yang menambah masa aktif satu paket member yang masih aktif. */
  perpanjanganMasaAktif?: boolean;
  extensionDays?: number | null;
}

export interface PublicScheduleSummary {
  id: string;
  branchId?: string;
  timezone: string;
  status: string;
  capacity: number;
  available: number;
  /** Server-side: fitur booking aktif, masih ada tempat, dan belum lewat cutoff. */
  canBook: boolean;
  startAt: string | Date;
  endAt: string | Date;
  branch?: PublicBranch | null;
  classType: PublicClassTypeRef;
  classProfile?: PublicClassProfile;
  instructor?: { displayName: string } | null;
  room?: { id: string; name: string } | null;
}


export async function publicFetch<T>(path: string, query?: Record<string, any>): Promise<T> {
  const params = new URLSearchParams();
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') {
        if (v instanceof Date) params.set(k, v.toISOString());
        else params.set(k, String(v));
      }
    }
  }
  const qs = params.toString() ? `?${params.toString()}` : '';
  const response = await fetch(`/api/v1${path}${qs}`, {
    credentials: 'omit',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    const error = new Error(`Public request failed: ${response.status}`);
    (error as any).response = { status: response.status };
    (error as any).status = response.status;
    throw error;
  }
  return response.json() as Promise<T>;
}

export const publicApi = {
  listPublicPackages(query?: { branchId?: string }) {
    return publicFetch<{ branches: PublicBranch[]; items: PublicPackageSummary[] }>(
      '/public/package-catalog',
      query,
    );
  },
  getPublicPackageDetail(params: { id: string }) {
    return publicFetch<any>(`/public/package-catalog/${params.id}`);
  },
  listPublicClassSchedule(query?: { branchId?: string; from?: Date | string; until?: Date | string }) {
    return publicFetch<{
      branches: PublicBranch[];
      items: Array<any>;
      range: { from: string; until: string };
    }>('/public/class-catalog', query);
  },
  getPublicScheduleDetail(params: { id: string }) {
    return publicFetch<any>(`/public/class-catalog/${params.id}`);
  },
  getPublicClassDetail(params: { slug: string }) {
    return publicFetch<any>(`/public/class-types/${params.slug}`);
  },
  getPublicStudioDetail(params: { slug: string }) {
    return publicFetch<any>(`/public/studios/${params.slug}`);
  },
};

export const publicGeneratedApi = {
  classes: {
    listPublicClassSchedule: (input?: any) => publicApi.listPublicClassSchedule(input),
    getPublicScheduleDetail: (input: { id: string }) => publicApi.getPublicScheduleDetail(input),
    getPublicClassDetail: (input: { slug: string }) => publicApi.getPublicClassDetail(input),
  },
  master: {
    getPublicStudioDetail: (input: { slug: string }) => publicApi.getPublicStudioDetail(input),
  },
  packages: {
    listPublicPackages: (input?: any) => publicApi.listPublicPackages(input),
    getPublicPackageDetail: (input: { id: string }) => publicApi.getPublicPackageDetail(input),
  },
};

export function publicApiStatus(error: unknown): number | undefined {
  return (
    (error as { response?: { status?: number } })?.response?.status ??
    (error as { status?: number })?.status
  );
}
