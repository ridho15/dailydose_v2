import { Reveal } from './reveal';

const pillars = [
  {
    number: '01',
    title: 'Small, Exclusive Classes',
    subtitle: 'Up to 4 people per session',
    description:
      'A maximum of 4 people per class, so you get personal attention in a comfortable, safe, and guided setting.',
  },
  {
    number: '02',
    title: 'Certified Instructors',
    subtitle: 'Experienced & attentive',
    description: 'Every session is guided by dedicated, certified instructors.',
  },
  {
    number: '03',
    title: 'Modern Pilates Equipment',
    subtitle: 'Precise, smooth & safe',
    description: 'Quality Pilates equipment for training that is safe, smooth, and precise.',
  },
  {
    number: '04',
    title: 'A Calm Studio',
    subtitle: '5 studios to choose from',
    description:
      'Train at our 5 studios in Jakarta, Tangerang, and Surabaya, on a flexible schedule that fits your rhythm.',
  },
] as const;

// Garis pemisah antarkolom bergantung pada jumlah kolom (1 → 2 → 4), jadi diatur per indeks.
const cellLayout = [
  'sm:pr-6 lg:pr-5',
  'sm:border-l sm:border-ed-line sm:pl-6 lg:pr-5',
  'sm:pr-6 lg:border-l lg:border-ed-line lg:pl-6 lg:pr-5',
  'sm:border-l sm:border-ed-line sm:pl-6 lg:pr-0',
] as const;

/** Empat keunggulan studio sebagai grid bergaris tipis tanpa kartu. */
export function LandingPillars() {
  return (
    <Reveal className="mt-12 border-t border-ed-line sm:mt-[75px]">
      <ul className="m-0 grid list-none grid-cols-1 p-0 sm:grid-cols-2 lg:grid-cols-4">
        {pillars.map(({ number, title, subtitle, description }, index) => (
          <li
            key={number}
            className={`flex min-h-[220px] flex-col gap-10 border-b border-ed-line py-6 transition-colors duration-200 hover:bg-ed-tint ${cellLayout[index]}`}
          >
            <span className="text-xs font-bold text-ed-green">{number}</span>
            <div>
              <h3 className="m-0 text-[clamp(22px,2.2vw,30px)] leading-[1.25] font-medium tracking-[-0.02em]">
                {title}
              </h3>
              <p className="ed-eyebrow mt-3 mb-0 text-ed-green">{subtitle}</p>
              <p className="mt-4 mb-0 text-[15px] leading-[1.65] text-ed-muted">{description}</p>
            </div>
          </li>
        ))}
      </ul>
    </Reveal>
  );
}
