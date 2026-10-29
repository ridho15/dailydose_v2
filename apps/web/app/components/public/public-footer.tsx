import Link from 'next/link';
import { ChevronRight, Heart, Mail, MapPin, MessageCircle } from 'lucide-react';

import { BrandMark } from './brand-mark';
import type { PublicChromeLang, PublicChromeVariant } from './public-header';

/** Kelompok tautan footer versi Inggris, dipakai beranda. */
const footerLinksEn = [
  {
    label: 'Studio',
    links: [
      { href: '/locations', label: 'Studio Locations' },
      { href: '/classes', label: 'Class Schedule' },
      { href: '/packages', label: 'Packages & Pricing' },
    ],
  },
  {
    label: 'Help & Info',
    links: [
      { href: '/guide', label: 'Studio Guide & Etiquette' },
      { href: '/#about', label: 'About the Studio' },
      { href: '/contact', label: 'Contact Us' },
    ],
  },
  {
    label: 'Legal & Privacy',
    links: [
      { href: '/terms', label: 'Terms & Conditions' },
      { href: '/privacy', label: 'Privacy Policy' },
    ],
  },
];

const kamusFooter = {
  id: {
    kabar: 'Kabar studio',
    tetapDekat: 'Tetap dekat dengan',
    ritme: 'ritme gerakmu.',
    hubungi: 'Hubungi Kami',
    kembali: 'Daily Dose Pilates, kembali ke halaman utama',
    deskripsi:
      'Studio Pilates modern di Jakarta, Tangerang & Surabaya. Bergerak lebih baik, hidup lebih seimbang.',
    viaWa: 'Hubungi via WhatsApp',
    dibuat: 'Dibuat untuk komunitas Pilates Indonesia',
  },
  en: {
    kabar: 'Studio news',
    tetapDekat: 'Stay close to',
    ritme: 'your movement rhythm.',
    hubungi: 'Contact Us',
    kembali: 'Daily Dose Pilates, back to the home page',
    deskripsi:
      'A modern Pilates studio in Jakarta, Tangerang & Surabaya. Move better, live more balanced.',
    viaWa: 'Contact via WhatsApp',
    dibuat: 'Made for the Pilates community in Indonesia',
  },
} as const;

const footerLinks = [
  {
    label: 'Studio',
    links: [
      { href: '/locations', label: 'Lokasi Studio' },
      { href: '/classes', label: 'Jadwal Kelas' },
      { href: '/packages', label: 'Paket & Harga' },
    ],
  },
  {
    label: 'Bantuan & Info',
    links: [
      { href: '/guide', label: 'Panduan & Etika Studio' },
      { href: '/#about', label: 'Tentang Studio' },
      { href: '/contact', label: 'Hubungi Kami' },
    ],
  },
  {
    label: 'Legal & Privasi',
    links: [
      { href: '/terms', label: 'Syarat & Ketentuan' },
      { href: '/privacy', label: 'Kebijakan Privasi' },
    ],
  },
];

function DefaultPublicFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-16 bg-dd-forest text-white">
      {/* CTA Strip */}
      <div className="mx-auto w-full max-w-[1180px] border-b border-white/10 px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
          <div className="flex items-center gap-4">
            <span
              className="grid size-12 shrink-0 place-items-center rounded-full border border-white/30 bg-white/10 text-white backdrop-blur-sm"
              aria-hidden="true"
            >
              <Mail className="size-5 text-dd-brass-soft" />
            </span>
            <div>
              <p className="m-0 text-sm font-semibold text-white">
                Dapatkan kabar terbaru tentang kelas, promo &amp; wellness tips
              </p>
              <p className="m-0 text-xs text-white/60 mt-0.5">
                Bergabung dengan komunitas mindful movement Daily Dose Pilates.
              </p>
            </div>
          </div>
          <Link
            className="inline-flex min-h-[46px] shrink-0 items-center justify-center gap-2 rounded-full border border-white/30 bg-white/10 px-6 text-sm font-bold text-white no-underline backdrop-blur-sm transition hover:bg-white hover:text-dd-forest"
            href="/contact"
          >
            <span>Hubungi Kami</span>
            <ChevronRight className="size-4" />
          </Link>
        </div>
      </div>

      {/* Main Footer Grid */}
      <div className="mx-auto w-full max-w-[1180px] px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-[2fr_1fr_1fr_1fr] lg:gap-12">
          {/* Brand Column */}
          <div className="col-span-2 sm:col-span-1">
            <p className="font-sans text-2xl font-bold tracking-tight text-white">
              Daily Dose Pilates
            </p>
            <p className="mt-2 max-w-[26ch] text-sm leading-6 text-white/65">
              Studio Pilates modern di Jakarta, Tangerang &amp; Surabaya. Bergerak lebih baik, hidup
              lebih seimbang.
            </p>
            <div className="mt-5 space-y-2 text-sm text-white/65">
              <p className="flex items-center gap-1.5">
                <MapPin className="size-3.5 text-white/70 shrink-0" />
                <span>Jakarta, Tangerang &amp; Surabaya</span>
              </p>
              <a
                href={`https://wa.me/${process.env.NEXT_PUBLIC_OFFICIAL_WHATSAPP || '62895329736127'}`}
                className="flex items-center gap-1.5 text-white/65 no-underline transition hover:text-white"
                target="_blank"
                rel="noreferrer"
                aria-label="Hubungi via WhatsApp"
              >
                <MessageCircle className="size-3.5 text-white/70 shrink-0" />
                <span>WhatsApp Admin</span>
              </a>
            </div>
            {/* Social Media */}
            <div
              className="mt-5 flex items-center gap-2"
              aria-label="Tautan sosial Daily Dose Pilates"
            >
              <a
                className="grid size-10 place-items-center rounded-full border border-white/40 text-white no-underline transition hover:border-white hover:bg-white/10"
                href="https://www.instagram.com/dailydosepilates/"
                aria-label="Instagram Daily Dose Pilates"
                rel="noreferrer"
                target="_blank"
              >
                <svg
                  className="size-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
                  <circle cx="12" cy="12" r="4" />
                  <circle cx="17.5" cy="6.5" r="0.8" fill="currentColor" stroke="none" />
                </svg>
              </a>
              <a
                className="grid size-10 place-items-center rounded-full border border-white/40 text-white no-underline transition hover:border-white hover:bg-white/10"
                href="https://www.tiktok.com/@dailydosepilates"
                aria-label="TikTok Daily Dose Pilates"
                rel="noreferrer"
                target="_blank"
              >
                <svg className="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.29 6.29 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.19 8.19 0 004.79 1.53V6.77a4.85 4.85 0 01-1.02-.08z" />
                </svg>
              </a>
            </div>
          </div>

          {/* Nav Link Columns */}
          {footerLinks.map((group) => (
            <div key={group.label}>
              <h3 className="mb-3 text-[13px] font-bold text-white/50">{group.label}</h3>
              <ul className="space-y-2.5 list-none m-0 p-0">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-white/65 no-underline transition hover:text-white"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="border-t border-white/10">
        <div className="mx-auto flex w-full max-w-[1180px] flex-col items-center justify-between gap-3 px-4 py-5 text-xs text-white/40 sm:flex-row sm:px-6 lg:px-8">
          <p className="m-0">© {year} Daily Dose Pilates. All rights reserved.</p>
          <p className="m-0 flex items-center gap-1">
            Dibuat dengan <Heart className="size-3.5 fill-dd-brass text-dd-brass inline" /> untuk
            komunitas Pilates Indonesia
          </p>
        </div>
      </div>
    </footer>
  );
}

const socialLinks = [
  {
    href: 'https://www.instagram.com/dailydosepilates/',
    label: 'Instagram',
    ariaLabel: 'Instagram Daily Dose Pilates',
  },
  {
    href: 'https://www.tiktok.com/@dailydosepilates',
    label: 'TikTok',
    ariaLabel: 'TikTok Daily Dose Pilates',
  },
] as const;

const editorialLink =
  'inline-flex min-h-11 min-w-11 items-center border-b border-transparent pb-1 text-[13px] font-semibold text-white no-underline transition hover:border-white';

/**
 * Footer varian "Editorial Calm": latar `ed-deep`, tanpa kartu/ikon bulat,
 * hanya teks, garis tipis, dan tautan bergaris bawah.
 */
function EditorialPublicFooter({ lang }: { lang: PublicChromeLang }) {
  const k = kamusFooter[lang];
  const grupTautan = lang === 'en' ? footerLinksEn : footerLinks;
  const year = new Date().getFullYear();
  const whatsapp = process.env.NEXT_PUBLIC_OFFICIAL_WHATSAPP || '62895329736127';

  return (
    <footer className="ed-scope bg-ed-deep text-white">
      <div className="ed-wrap flex flex-col items-start justify-between gap-6 border-b border-white/35 py-12 sm:flex-row sm:items-end">
        <div>
          <span className="ed-eyebrow text-ed-mint">{k.kabar}</span>
          <p className="ed-display mt-4 max-w-[22ch] text-[clamp(32px,4vw,56px)] text-balance">
            {k.tetapDekat} <span className="ed-serif text-ed-mint">{k.ritme}</span>
          </p>
        </div>
        <Link className="ed-button-light shrink-0" href="/contact">
          {k.hubungi}
        </Link>
      </div>

      <div className="ed-wrap grid gap-12 py-[65px] sm:grid-cols-[1.4fr_repeat(3,1fr)] lg:gap-16">
        <div>
          <BrandMark tone="light" className="w-[200px]" ariaLabel={k.kembali} />
          <p className="mt-6 max-w-[310px] text-sm leading-relaxed text-ed-mist">{k.deskripsi}</p>
          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
            <a
              className={editorialLink}
              href={`https://wa.me/${whatsapp}`}
              target="_blank"
              rel="noreferrer"
              aria-label={k.viaWa}
            >
              WhatsApp Admin
            </a>
            {socialLinks.map((link) => (
              <a
                className={editorialLink}
                href={link.href}
                key={link.label}
                target="_blank"
                rel="noreferrer"
                aria-label={link.ariaLabel}
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>

        {grupTautan.map((group) => (
          <nav key={group.label} aria-label={group.label}>
            <h3 className="ed-eyebrow m-0 mb-4 text-ed-mint">{group.label}</h3>
            <ul className="m-0 grid list-none gap-2 p-0">
              {group.links.map((link) => (
                <li key={link.label}>
                  <Link className={editorialLink} href={link.href}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="ed-wrap flex flex-col justify-between gap-2 border-t border-white/35 pb-6 pt-5 text-xs text-ed-mist sm:flex-row sm:gap-6">
        <span>© {year} Daily Dose Pilates. All rights reserved.</span>
        <span>{k.dibuat}</span>
      </div>
    </footer>
  );
}

export function PublicFooter({
  variant = 'default',
  lang = 'id',
}: { variant?: PublicChromeVariant; lang?: PublicChromeLang } = {}) {
  return variant === 'editorial' ? <EditorialPublicFooter lang={lang} /> : <DefaultPublicFooter />;
}
