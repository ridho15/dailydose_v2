'use client';

import { useEffect, useState } from 'react';

import { accountClient, type PublicSiteConfig } from '@/api-clients/account-client';
import { isCustomerOnlySession } from '@/lib/session-audience';
import { useSessionContext } from './session-context';
import { useTrackedRouter } from './components/app-loading';
import { PublicFooter } from './components/public/public-footer';
import { PublicHeader } from './components/public/public-header';
import { HeroCarousel } from './components/public/hero-carousel';
import { LandingClasses } from './components/public/landing/landing-classes';
import { LandingIntro } from './components/public/landing/landing-intro';
import { LandingPackages } from './components/public/landing/landing-packages';
import { LandingTestimonials } from './components/public/landing/landing-testimonials';

export function PublicLanding() {
  const sessionContext = useSessionContext();
  const router = useTrackedRouter();
  const [siteConfig, setSiteConfig] = useState<PublicSiteConfig | null>(null);
  const [catalogError, setCatalogError] = useState('');

  const isCustomer = Boolean(
    sessionContext?.status === 'authenticated' &&
      sessionContext.session &&
      (isCustomerOnlySession(sessionContext.session) ||
        sessionContext.session.roles.includes('CUSTOMER')),
  );

  useEffect(() => {
    if (isCustomer) {
      router.replace('/account');
    }
  }, [isCustomer, router]);

  useEffect(() => {
    let active = true;
    accountClient
      .siteConfig()
      .then((result) => {
        if (active) setSiteConfig(result);
      })
      .catch(() => {
        if (active) setCatalogError('Studio information could not be loaded.');
      });
    return () => {
      active = false;
    };
  }, []);

  if (isCustomer) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-ed-cream text-ed-forest" role="status">
        <p className="font-serif text-lg">Taking you to your member home…</p>
      </div>
    );
  }

  const classCards = siteConfig?.classes ?? [];
  return (
    <div className="ed-scope min-w-0 overflow-hidden bg-ed-cream text-ed-ink" id="top">
      <a className="skip-link" href="#public-main">
        Skip to main content
      </a>
      <PublicHeader variant="editorial" lang="en" />

      <main id="public-main">
        {/* Hero Carousel Section */}
        <HeroCarousel config={siteConfig?.heroCarousel} />

        {/* Intro + 4 keunggulan studio (Editorial Calm) */}
        <LandingIntro />

        {/* Kelas populer */}
        <LandingClasses classes={siteConfig === null ? null : classCards} error={catalogError} />

        {/* Testimoni member & filosofi studio */}
        <LandingTestimonials />

        {/* Paket + ajakan penutup */}
        <LandingPackages />
      </main>

      <PublicFooter variant="editorial" lang="en" />
    </div>
  );
}
