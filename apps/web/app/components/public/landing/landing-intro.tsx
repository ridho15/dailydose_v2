import { LandingPillars } from './landing-pillars';
import { Reveal } from './reveal';

/**
 * Pengantar landing: judul display + paragraf pendek (grid 2 kolom), diikuti empat
 * keunggulan studio. Memegang anchor `#about` (menu About dan footer) sejak seksi studio dihapus.
 */
export function LandingIntro() {
  return (
    <section
      className="ed-scope bg-ed-cream text-ed-ink"
      id="about"
      aria-labelledby="landing-intro-title"
    >
      <div className="ed-wrap ed-section">
        <Reveal className="grid items-end gap-10 lg:grid-cols-[1.25fr_0.75fr] lg:gap-[clamp(40px,8vw,140px)]">
          <div>
            <span className="ed-eyebrow text-ed-green">Why Daily Dose</span>
            <h2
              className="ed-display mt-6 text-[clamp(44px,6vw,91px)] text-balance"
              id="landing-intro-title"
            >
              A small space to <span className="ed-serif">move differently.</span>
            </h2>
          </div>
          <p className="m-0 max-w-[440px] pb-2 text-[17px] leading-[1.7] text-ed-ink">
            Small classes, certified instructors, and a calm studio, so every session feels personal
            and guided.
          </p>
        </Reveal>

        <LandingPillars />
      </div>
    </section>
  );
}
