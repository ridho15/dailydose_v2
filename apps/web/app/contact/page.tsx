import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { PublicFooter } from '../components/public/public-footer';
import { PublicHeader } from '../components/public/public-header';
import { PublicPageHero, PublicSectionHeading } from '../components/public/public-page';
import { KontakWhatsapp } from './kontak-whatsapp';

export const metadata: Metadata = {
  title: 'Hubungi Kami',
  description: 'Hubungi tim Daily Dose Pilates untuk bantuan kelas, paket, dan kunjungan studio.',
};

export default function ContactPage() {
  return (
    <div className="ed-scope min-w-0 overflow-x-clip bg-ed-cream text-ed-ink">
      <a className="skip-link" href="#contact-main">
        Langsung ke kontak
      </a>
      <PublicHeader variant="editorial" />
      <main id="contact-main">
        <PublicPageHero
          eyebrow="Kami siap membantu"
          title="Ada yang ingin Anda tanyakan?"
          description="Tim Daily Dose siap membantu memilih kelas, paket, atau studio yang sesuai dengan kebutuhan Anda."
        />
        <section className="py-[clamp(64px,8vw,120px)]" aria-labelledby="contact-options-title">
          <div className="ed-wrap">
            <PublicSectionHeading
              eyebrow="Pilih kebutuhan"
              title="Mulai dari jalur yang tepat."
              titleId="contact-options-title"
              description="Pilih kebutuhan Anda agar kami dapat mengarahkan ke informasi yang relevan."
            />
            <ol className="m-0 list-none border-t border-ed-line p-0">
              {[
                {
                  title: 'Jadwal kelas',
                  description: 'Lihat jadwal publik yang tersedia menurut studio dan zona waktunya.',
                  href: '/classes',
                  label: 'Jelajahi jadwal',
                },
                {
                  title: 'Paket Pilates',
                  description: 'Bandingkan paket aktif, jumlah sesi, harga, dan masa berlaku.',
                  href: '/packages',
                  label: 'Jelajahi paket',
                },
              ].map((item, index) => (
                <li
                  className="grid gap-x-8 gap-y-3 border-b border-ed-line py-8 transition-colors duration-200 hover:bg-ed-tint md:grid-cols-[48px_minmax(0,0.9fr)_minmax(0,1.3fr)_auto] md:items-center"
                  key={item.title}
                >
                  <span className="text-xs font-bold text-ed-green">0{index + 1}</span>
                  <h3 className="m-0 text-[clamp(24px,2.4vw,34px)] leading-[1.1] font-medium tracking-[-0.05em]">
                    {item.title}
                  </h3>
                  <p className="m-0 text-[15px] leading-[1.65] text-ed-muted">{item.description}</p>
                  <Link className="ed-link text-ed-green" href={item.href}>
                    <span>{item.label}</span>
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </Link>
                </li>
              ))}
              <KontakWhatsapp />
            </ol>
            <div className="mt-12 border-l-2 border-ed-green bg-ed-mist p-6">
              <strong className="text-ed-ink">Privasi Anda tetap penting.</strong>
              <p className="m-0 mt-2 text-[15px] leading-[1.65] text-ed-muted">
                Halaman ini tidak meminta atau menyimpan data pribadi secara publik. Setiap pesan
                dan pertanyaan Anda kami jaga kerahasiaannya untuk membantu kebutuhan latihan Anda di
                Daily Dose.
              </p>
            </div>
          </div>
        </section>
      </main>
      <PublicFooter variant="editorial" />
    </div>
  );
}
