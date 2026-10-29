'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { HeroCarouselPayload, HeroSlideItem } from '@/api-clients/account-client';

const DEFAULT_SLIDES: HeroSlideItem[] = [
  {
    id: 'default-1',
    badge: 'Move better, live better',
    title: 'Stronger Body.',
    highlightTitle: 'Calmer Mind.',
    description:
      'Daily Dose Pilates is a modern studio that helps you feel stronger, move better, and go through your day with more balance.',
    imageSrc: '/images/public/landing/hero-pilates.png',
    primaryCta: {
      label: 'See Schedule',
      href: '/classes#schedule',
    },
    secondaryCta: {
      label: 'See Packages',
      href: '/packages',
    },
    active: true,
    order: 1,
  },
  {
    id: 'default-2',
    badge: 'New member offer',
    title: 'Start Your Pilates Journey',
    highlightTitle: 'With a Special Package',
    description:
      'Get a private introduction session and guidance from internationally certified instructors.',
    imageSrc: '/images/public/landing/hero-studio-reformer.jpg',
    // Foto potret: hero yang melebar menampilkan pita jendela dan deretan reformer.
    imagePosition: '50% 64%',
    primaryCta: {
      label: 'Choose a Package',
      href: '/packages',
    },
    secondaryCta: {
      label: 'Explore Studios',
      href: '/locations',
    },
    active: true,
    order: 2,
  },
  {
    id: 'default-3',
    badge: 'Private & Semi-Private Group',
    title: 'Calm & Personal',
    highlightTitle: 'In Every Movement',
    description:
      'With at most 4 people per class, your posture and technique are always looked after.',
    imageSrc: '/images/public/classes/cadillac-pilates.png',
    primaryCta: {
      label: 'Book a Class Today',
      href: '/classes',
    },
    secondaryCta: {
      label: 'Ask on WhatsApp',
      href: '/contact',
    },
    active: true,
    order: 3,
  },
];

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * Hero beranda bergaya "Editorial Calm": foto full-bleed dengan overlay hijau gelap,
 * judul display + kata serif, satu tombol utama dan satu tautan teks, serta kontrol
 * minimalis (penanda garis + nomor). Data slide tetap berasal dari CMS.
 */
export function HeroCarousel({ config }: { config?: HeroCarouselPayload | null }) {
  const slides = useMemo(() => {
    if (!config?.slides || config.slides.length === 0) return DEFAULT_SLIDES;
    const activeSlides = config.slides
      .filter((s) => s.active !== false)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return activeSlides.length > 0 ? activeSlides : DEFAULT_SLIDES;
  }, [config]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);

  const total = slides.length;
  const autoplay = config?.autoplay ?? true;
  const intervalMs = config?.intervalMs && config.intervalMs >= 2000 ? config.intervalMs : 6000;

  const nextSlide = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % total);
  }, [total]);

  const prevSlide = useCallback(() => {
    setCurrentIndex((prev) => (prev - 1 + total) % total);
  }, [total]);

  const goToSlide = (index: number) => {
    setCurrentIndex(index);
  };

  // Hormati preferensi gerak: tanpa autoplay bila pengguna meminta gerak dikurangi.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduceMotion(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  // Autoplay Timer (dijeda saat hover atau fokus berada di dalam hero)
  useEffect(() => {
    if (!autoplay || reduceMotion || total <= 1 || paused) return;
    const timer = setInterval(() => {
      nextSlide();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [autoplay, reduceMotion, total, paused, intervalMs, nextSlide]);

  // Touch Swipe Handlers for Mobile
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.targetTouches[0]?.clientX ?? null;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.targetTouches[0]?.clientX ?? null;
  };

  const handleTouchEnd = () => {
    if (touchStartX.current === null || touchEndX.current === null) return;
    const distance = touchStartX.current - touchEndX.current;
    const isLeftSwipe = distance > 50;
    const isRightSwipe = distance < -50;
    if (isLeftSwipe) {
      nextSlide();
    } else if (isRightSwipe) {
      prevSlide();
    }
    touchStartX.current = null;
    touchEndX.current = null;
  };

  const controlButton =
    'grid size-11 place-items-center border border-white/60 bg-transparent text-white transition-colors hover:bg-white/15 sm:size-12';

  return (
    <section
      className="ed-scope relative isolate flex min-h-[690px] items-end overflow-hidden bg-ed-deep text-white select-none sm:min-h-[760px] lg:min-h-[min(820px,calc(100svh-86px))]"
      aria-roledescription="carousel"
      aria-label="Daily Dose classes and offers"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Background Images with Cross-Fade + slow drift */}
      {slides.map((slide, index) => {
        const isActive = index === currentIndex;
        return (
          <div
            key={slide.id || index}
            className={`absolute inset-0 -z-20 transition-opacity duration-1000 ease-in-out ${
              isActive ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
            aria-hidden={!isActive}
          >
            <div
              className={`absolute -inset-[3%] origin-[66%_38%] will-change-transform ${
                isActive
                  ? '[animation:ed-drift_14s_ease-in-out_infinite_alternate] motion-reduce:[animation:none]'
                  : ''
              }`}
            >
              <Image
                className="object-cover object-[65%_center] lg:object-[60%_center]"
                src={slide.imageSrc || '/images/public/landing/hero-pilates.png'}
                style={slide.imagePosition ? { objectPosition: slide.imagePosition } : undefined}
                fill
                priority={index === 0}
                sizes="100vw"
                alt={slide.title}
              />
            </div>
          </div>
        );
      })}

      {/* Overlay hijau gelap: horizontal + bawah (desktop), bawah saja (mobile) */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 max-sm:hidden bg-[linear-gradient(90deg,rgba(7,28,20,0.9),rgba(7,28,20,0.4)_72%),linear-gradient(0deg,rgba(7,28,20,0.55),transparent_62%)]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0 -z-10 sm:hidden bg-[linear-gradient(0deg,rgba(7,28,20,0.95),rgba(7,28,20,0.3)_90%)]"
        aria-hidden="true"
      />

      {/* Slide Content */}
      <div className="ed-wrap relative z-20 pt-[85px] pb-12 sm:pt-[115px] sm:pb-[73px]">
        {slides.map((slide, index) => {
          if (index !== currentIndex) return null;

          return (
            <div key={slide.id || index}>
              {slide.badge && <span className="ed-eyebrow text-ed-mint">{slide.badge}</span>}

              <h1
                id="marketing-hero-title"
                className="ed-display mt-7 mb-8 max-w-[1050px] text-[clamp(50px,7.4vw,124px)] text-balance"
              >
                {slide.title}{' '}
                {slide.highlightTitle && (
                  <span className="ed-serif mt-1.5 block text-ed-mint sm:mt-2">
                    {slide.highlightTitle}
                  </span>
                )}
              </h1>

              <div className="flex max-w-[1010px] flex-col gap-8 sm:flex-row sm:items-end sm:justify-between sm:gap-10">
                <p className="m-0 max-w-[430px] text-[clamp(17px,1.8vw,22px)] leading-[1.55] text-white">
                  {slide.description}
                </p>
                <div className="flex flex-wrap items-center gap-x-8 gap-y-5">
                  {slide.primaryCta?.href && (
                    <Link className="ed-button-light" href={slide.primaryCta.href}>
                      {slide.primaryCta.label || 'See Schedule'}
                    </Link>
                  )}
                  {slide.secondaryCta?.href && (
                    <Link className="ed-link text-white" href={slide.secondaryCta.href}>
                      <span>{slide.secondaryCta.label || 'See Packages'}</span>
                      <span aria-hidden="true">↗</span>
                    </Link>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Baris bawah: catatan + kontrol */}
        <div className="mt-12 flex flex-wrap items-center justify-between gap-x-8 gap-y-5 border-t border-white/35 pt-5 sm:mt-[72px]">
          <span className="text-[13px] text-white/80">
            Private and small-group training · Move with intention
          </span>

          {total > 1 && (
            <div className="flex items-center gap-4">
              <span
                className="hidden text-[13px] font-bold tabular-nums sm:inline"
                aria-hidden="true"
              >
                {pad(currentIndex + 1)} / {pad(total)}
              </span>
              <nav className="flex items-center" aria-label="Choose a slide">
                {slides.map((_, index) => {
                  const isActive = index === currentIndex;
                  return (
                    <button
                      key={index}
                      type="button"
                      onClick={() => goToSlide(index)}
                      aria-label={`Show slide ${index + 1} of ${total}`}
                      aria-current={isActive}
                      className="group relative h-11 w-9 bg-transparent sm:h-12 sm:w-10"
                    >
                      <span
                        className={`absolute inset-x-1 top-1/2 h-[3px] -translate-y-1/2 transition-colors ${
                          isActive ? 'bg-white' : 'bg-white/35 group-hover:bg-white/70'
                        }`}
                      />
                    </button>
                  );
                })}
              </nav>
              <button
                type="button"
                onClick={prevSlide}
                aria-label="Previous slide"
                className={controlButton}
              >
                <ChevronLeft className="size-5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={nextSlide}
                aria-label="Next slide"
                className={controlButton}
              >
                <ChevronRight className="size-5" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
