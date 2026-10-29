'use client';

import { notifySessionFailure } from './session-client';
import { foregroundFetch } from '../components/app-loading';

export interface PreferredStudio {
  id: string;
  code: string;
  name: string;
  timezone: string;
  supportWhatsappE164: string | null;
  publicProfile?: {
    slug: string;
    area: string;
    city: string;
    address: string;
    description: string;
    arrivalInformation: string | null;
    parkingInformation: string | null;
    openingHours: Array<{ days: string; hours: string }>;
    amenities: string[];
    heroImageKey: string;
    galleryImageKeys: string[];
  };
}

export interface PublicClassMarketingProfile {
  code: string;
  name: string;
  slug: string;
  summary: string;
  description: string;
  level: string;
  durationMinutes: number;
  equipment: string[];
  benefits: string[];
  heroImageKey: string;
}

export interface MyProfile {
  id: string;
  username?: string | null;
  displayName: string;
  emailMasked: string | null;
  phoneMasked: string | null;
  preferredBranch: PreferredStudio | null;
  version: number;
}

export interface HeroSlideItem {
  id: string;
  badge?: string;
  title: string;
  highlightTitle?: string;
  description: string;
  imageSrc: string;
  /** Titik fokus foto (CSS object-position), misalnya '50% 62%'. Tanpa isi: fokus bawaan hero. */
  imagePosition?: string;
  primaryCta?: {
    label: string;
    href: string;
  };
  secondaryCta?: {
    label: string;
    href: string;
  };
  active: boolean;
  order: number;
}

export interface HeroCarouselPayload {
  autoplay: boolean;
  intervalMs: number;
  slides: HeroSlideItem[];
}

export interface PublicFaqItem {
  id: string;
  question: string;
  answer: string;
  order: number;
}

export interface PublicFaqPayload {
  items: PublicFaqItem[];
}

export interface PublicSiteConfig {
  branches: PreferredStudio[];
  classes: PublicClassMarketingProfile[];
  heroCarousel?: HeroCarouselPayload | null;
  faq?: PublicFaqPayload | null;
  fallbackWhatsappE164: string | null;
}

async function request<T>(path: string, init?: RequestInit, foreground = true): Promise<T> {
  const requestInit = {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  } satisfies RequestInit;
  const response = foreground
    ? await foregroundFetch(`/api/v1${path}`, requestInit, 'Memuat profil…')
    : await fetch(`/api/v1${path}`, requestInit);
  if (!response.ok) {
    const error = { response: { status: response.status }, body: await response.text() };
    notifySessionFailure(error);
    throw error;
  }
  return response.json();
}

export const accountClient = {
  profile(): Promise<MyProfile> {
    return request('/me/profile');
  },
  updateProfile(input: {
    displayName: string;
    preferredBranchId?: string;
    expectedVersion: number;
  }): Promise<MyProfile> {
    return request('/me/profile', { method: 'PATCH', body: JSON.stringify(input) });
  },
  siteConfig(): Promise<PublicSiteConfig> {
    return request('/public/site-config', undefined, false);
  },
};
