import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { BrandMark } from '../public/brand-mark';

export function AuthPageShell({
  eyebrow,
  title,
  description,
  children,
  compactMobileVisual = false,
  visualSrc = '/images/public/landing/studio-showcase.png',
  loginLabel = 'Sign in',
  loginHref = '/sign-in',
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
  compactMobileVisual?: boolean;
  visualSrc?: string;
  loginLabel?: string;
  loginHref?: string;
}) {
  return (
    <main
      className="ed-scope grid min-h-svh w-full grid-cols-1 lg:grid-cols-[minmax(360px,0.85fr)_minmax(0,1.15fr)] bg-ed-cream text-ed-ink"
      id="main-content"
    >
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2.5 focus:bg-ed-forest focus:text-white focus:text-[13px] focus:font-bold focus: focus: focus:shadow-lg focus:outline-none focus:rounded-none"
        href="#auth-form"
      >
        Skip to form
      </a>
      {/* Left Visual Panel */}
      <section
        className={`auth-visual-panel relative isolate flex flex-col justify-between overflow-hidden p-6 sm:p-12 lg:min-h-svh lg:sticky lg:top-0 lg:self-start border-r border-ed-line ${
          compactMobileVisual
            ? 'h-[140px] min-h-[140px] max-h-[140px] p-4 border-r-0 border-b lg:h-auto lg:min-h-svh lg:max-h-none lg:p-12 lg:border-r lg:border-b-0'
            : 'hidden lg:flex'
        }`}
      >
        <div className="absolute inset-0 -z-10 overflow-hidden">
          <Image
            className="object-cover object-center"
            src={visualSrc}
            alt="Daily Dose Studio Atmosphere"
            fill
            priority
            sizes="(max-width: 800px) 100vw, 45vw"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-ed-deep/95 via-ed-forest/80 to-ed-forest/50" />
        </div>

        {/* Top Brand Tag */}
        <div className="flex items-center gap-2 text-white/90">
          <span className="text-[13px] font-bold text-ed-mint">
            Daily Dose Pilates Studio
          </span>
        </div>

        {/* Bottom Editorial Copy (hidden on compact mobile) */}
        <div className={`space-y-4 text-white max-w-lg ${compactMobileVisual ? 'max-[800px]:hidden' : ''}`}>
          <div className="space-y-2">
            <p className="ed-eyebrow text-ed-mint tracking-[0.18em]">
              Move better, live better
            </p>
            <h2 className="ed-display text-3xl xl:text-4xl font-normal leading-[1.05] tracking-[-0.04em] text-ed-cream">
              Move with ease,{' '}
              <span className="ed-serif italic text-ed-mint">breathe with intention.</span>
            </h2>
            <p className="text-sm leading-relaxed text-ed-cream/80 max-w-md">
              Small classes, attentive instructors, and a calm studio built around how your body
              feels.
            </p>
          </div>

          <div
            className="flex items-center gap-4 text-xs font-medium text-ed-cream/75 pt-3 border-t border-white/10"
            aria-label="About the studio"
          >
            <span>Private &amp; semi-private</span>
            <span>•</span>
            <span>Certified instructors</span>
          </div>
        </div>
      </section>

      {/* Right Form Panel */}
      <section className="flex flex-col items-center justify-center w-full min-w-0 p-3 sm:p-8 lg:p-14">
        <div
          id="auth-form"
          className="w-full max-w-[560px] min-w-0 rounded-none border border-ed-line bg-white p-4 sm:p-8 lg:p-10 shadow-none"
        >
          {/* Header Bar */}
          <div className="mb-6 sm:mb-8 flex items-center justify-between gap-2 sm:gap-3 border-b border-ed-line pb-4 sm:pb-5">
            <BrandMark className="w-28 sm:w-36 shrink-0" priority />
            <Link
              className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 sm:gap-2 rounded-none px-2.5 sm:px-3 text-[13px] font-bold text-ed-forest hover:bg-ed-tint transition-colors no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ed-forest"
              href={loginHref}
            >
              <span>{loginLabel}</span>
              <ArrowRight className="size-3.5 shrink-0" />
            </Link>
          </div>

          {/* Form Eyebrow & Title */}
          <div className="space-y-2">
            <p className="ed-eyebrow text-ed-green">
              {eyebrow}
            </p>
            <h1 className="ed-display text-2xl sm:text-3xl font-normal tracking-[-0.04em] text-ed-ink">
              {title}
            </h1>
            <p className="text-sm leading-relaxed text-ed-muted">{description}</p>
          </div>

          {/* Form Content */}
          <div className="mt-8">{children}</div>
        </div>
      </section>
    </main>
  );
}
