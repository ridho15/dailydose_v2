import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import { routes } from '@/lib/routes';
import { Reveal } from './reveal';

const steps = [
  ['01', 'Choose a studio', 'Prices and packages depend on where you train.'],
  ['02', 'Compare packages', 'See the number of sessions, validity period, and price per session.'],
  ['03', 'Book a class', 'Use your active package to pick an available time.'],
] as const;

/**
 * Pita penutup: ajakan memilih paket + tiga langkah bernomor, dan tautan jadwal (menggantikan
 * banner penutup terpisah agar tidak ada dua blok hijau berurutan).
 * `data-testid="package-journey"` dipertahankan: berisi satu `h2` dan satu `ol` dengan tiga baris.
 */
export function LandingPackages() {
  return (
    <section
      className="ed-scope bg-ed-forest text-ed-cream"
      aria-labelledby="package-cta-title"
    >
      <div className="ed-wrap ed-section" data-testid="package-journey">
        <Reveal className="grid items-end gap-10 lg:grid-cols-[1.25fr_0.75fr] lg:gap-[clamp(40px,8vw,140px)]">
          <div>
            <span className="ed-eyebrow text-ed-mint">Daily Dose packages</span>
            <h2
              className="ed-display mt-6 text-[clamp(40px,5vw,72px)] text-balance"
              id="package-cta-title"
            >
              Build a routine that <span className="ed-serif">lasts.</span>
            </h2>
          </div>
          <div className="flex flex-col items-start gap-8 pb-2">
            <p className="m-0 max-w-[440px] text-[17px] leading-[1.7] text-ed-mint">
              Compare packages by studio, class type, number of sessions, and validity period.
              All prices come straight from the current catalog.
            </p>
            <div className="flex flex-wrap items-center gap-x-10 gap-y-6">
              <Link className="ed-button-light" href={routes.packages}>
                Choose a Package
              </Link>
              <Link className="ed-link" href={`${routes.classes}#schedule`}>
                <span>See Schedule</span>
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </div>
          </div>
        </Reveal>

        <Reveal className="mt-12 sm:mt-[75px]">
          <ol className="m-0 list-none border-t border-ed-mint/25 p-0">
            {steps.map(([number, label, description]) => (
              <li
                className="grid gap-x-8 gap-y-3 border-b border-ed-mint/25 py-7 transition-colors duration-200 hover:bg-ed-cream/5 sm:grid-cols-[48px_minmax(0,0.9fr)_minmax(0,1.4fr)] sm:items-baseline sm:gap-y-2"
                key={number}
              >
                <span className="text-xs font-bold text-ed-mint">{number}</span>
                <h3 className="m-0 text-[clamp(22px,2.2vw,30px)] leading-[1.25] font-medium tracking-[-0.02em]">
                  {label}
                </h3>
                <p className="m-0 text-[15px] leading-[1.65] text-ed-mint">{description}</p>
              </li>
            ))}
          </ol>
          <p className="m-0 mt-6 text-[13px] text-ed-mint">
            Pick a class by studio and available time.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
