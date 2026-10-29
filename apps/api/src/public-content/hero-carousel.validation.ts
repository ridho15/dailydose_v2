import { invalid, text } from './content-validation';

export const HERO_CONTENT_KEY = 'HOME_HERO_CAROUSEL';
export const HERO_KIND = 'HERO_CAROUSEL';
const MAX_SLIDES = 10;

/** Tautan hanya relatif ke situs ("/paket") atau https; bukan javascript:, data:, atau "//host". */
function link(value: unknown, field: string, max = 500, required = false): string | undefined {
  const href = text(value, field, max, required);
  if (href === undefined) return undefined;
  if (href.startsWith('/') && !href.startsWith('//')) return href;
  try {
    const url = new URL(href);
    if (url.protocol === 'https:') return href;
  } catch {
    // jatuh ke penolakan di bawah
  }
  throw invalid(field, 'UNSAFE_URL');
}

function cta(value: unknown, field: string) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object') throw invalid(field);
  const input = value as Record<string, unknown>;
  const label = text(input.label, `${field}.label`, 40);
  const href = link(input.href, `${field}.href`);
  if (!label && !href) return undefined;
  if (!label || !href) throw invalid(field, 'INCOMPLETE');
  return { label, href };
}

/** Validasi + normalisasi payload slider beranda; hasilnya satu-satunya bentuk yang disimpan. */
export function validateHeroCarousel(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalid('payload');
  const input = payload as Record<string, unknown>;
  const autoplay = input.autoplay === undefined ? true : input.autoplay;
  if (typeof autoplay !== 'boolean') throw invalid('autoplay');
  const intervalMs = input.intervalMs === undefined ? 6000 : input.intervalMs;
  if (
    typeof intervalMs !== 'number' ||
    !Number.isInteger(intervalMs) ||
    intervalMs < 2000 ||
    intervalMs > 30000
  )
    throw invalid('intervalMs');
  if (!Array.isArray(input.slides) || input.slides.length > MAX_SLIDES) throw invalid('slides');

  const slides = input.slides.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw invalid(`slides[${index}]`);
    const slide = raw as Record<string, unknown>;
    const field = (name: string) => `slides[${index}].${name}`;
    return {
      id: text(slide.id, field('id'), 64) ?? `slide-${index + 1}`,
      badge: text(slide.badge, field('badge'), 120),
      title: text(slide.title, field('title'), 120, true)!,
      highlightTitle: text(slide.highlightTitle, field('highlightTitle'), 120),
      description: text(slide.description, field('description'), 400, true)!,
      imageSrc: link(slide.imageSrc, field('imageSrc'), 500, true)!,
      primaryCta: cta(slide.primaryCta, field('primaryCta')),
      secondaryCta: cta(slide.secondaryCta, field('secondaryCta')),
      active: slide.active === undefined ? true : Boolean(slide.active),
      order: index + 1,
    };
  });
  return { autoplay, intervalMs, slides };
}

/** Slider hero hanya tampil di beranda yang berbahasa Inggris. */
export const HERO_LOCALE = 'en-US';
