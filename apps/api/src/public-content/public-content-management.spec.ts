import { PolicyService } from '../identity/policy.service';
import { validateHeroCarousel } from './hero-carousel.validation';
import { PublicContentManagementService } from './public-content-management.service';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const contentId = id(10);

const principalFor = (capabilities: string[], branchIds: string[] = []) => ({
  sessionId: 's',
  userId: id(100),
  roles: [] as never,
  capabilities,
  branchIds,
});
const owner = principalFor(['public-content:read', 'public-content:manage', 'branch:all']);
const branchStaff = principalFor(['public-content:read', 'public-content:manage'], [id(1)]);

const slide = (overrides: Record<string, unknown> = {}) => ({
  id: 's1',
  title: 'Stronger Body',
  description: 'Deskripsi slide',
  imageSrc: '/images/public/landing/hero-pilates.png',
  primaryCta: { label: 'Lihat Jadwal', href: '/classes' },
  active: true,
  ...overrides,
});
const hero = (overrides: Record<string, unknown> = {}) => ({
  autoplay: true,
  intervalMs: 6000,
  slides: [slide()],
  ...overrides,
});

describe('validateHeroCarousel', () => {
  it('normalizes a valid payload and numbers the slides in order', () => {
    const result = validateHeroCarousel(
      hero({ slides: [slide({ title: '  Satu  ' }), slide({ id: undefined, title: 'Dua' })] }),
    );
    expect(result.slides.map((item) => [item.id, item.title, item.order])).toEqual([
      ['s1', 'Satu', 1],
      ['slide-2', 'Dua', 2],
    ]);
    expect(result).toMatchObject({ autoplay: true, intervalMs: 6000 });
  });

  it('rejects unsafe links, missing text and out-of-range settings', () => {
    const bad = [
      hero({ slides: [slide({ imageSrc: 'javascript:alert(1)' })] }),
      hero({ slides: [slide({ imageSrc: '//evil.example/x.png' })] }),
      hero({ slides: [slide({ imageSrc: 'http://insecure.example/x.png' })] }),
      hero({ slides: [slide({ primaryCta: { label: 'Klik', href: 'data:text/html,x' } })] }),
      hero({ slides: [slide({ primaryCta: { label: '', href: '/classes' } })] }),
      hero({ slides: [slide({ title: '' })] }),
      hero({ slides: [slide({ title: 'x'.repeat(121) })] }),
      hero({ slides: [slide({ description: 'x'.repeat(401) })] }),
      hero({ intervalMs: 500 }),
      hero({ intervalMs: 60000 }),
      hero({ autoplay: 'ya' }),
      hero({ slides: Array.from({ length: 11 }, () => slide()) }),
      hero({ slides: 'bukan-array' }),
      null,
    ];
    for (const payload of bad)
      expect(() => validateHeroCarousel(payload)).toThrow(
        expect.objectContaining({ code: 'VALIDATION_ERROR' }),
      );
  });

  it('accepts https and relative links and an empty slide list', () => {
    expect(() =>
      validateHeroCarousel(
        hero({
          slides: [
            slide({ imageSrc: 'https://cdn.example/x.png', primaryCta: { label: 'A', href: 'https://x.example/y' } }),
          ],
        }),
      ),
    ).not.toThrow();
    expect(validateHeroCarousel(hero({ slides: [] })).slides).toEqual([]);
  });
});

function setup(row: Record<string, unknown> | null = null, active: boolean = true) {
  const stored = {
    id: contentId,
    contentKey: 'HOME_HERO_CAROUSEL',
    scopeKey: 'GLOBAL',
    branchId: null,
    kind: 'HERO_CAROUSEL',
    locale: 'id-ID',
    version: 3,
    status: 'PUBLISHED',
    payload: hero(),
    createdById: id(100),
    publishedAt: new Date('2026-09-01T00:00:00Z'),
    archivedAt: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    ...row,
  };
  const db = {
    publicContent: {
      findMany: jest.fn().mockResolvedValue([stored]),
      findFirst: jest.fn().mockResolvedValue(active ? stored : null),
      aggregate: jest.fn().mockResolvedValue({ _max: { version: 3 } }),
      create: jest.fn().mockImplementation(async ({ data }) => ({ ...stored, ...data, id: id(11) })),
      update: jest.fn().mockImplementation(async ({ data }) => ({ ...stored, ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const service = new PublicContentManagementService(db as never, new PolicyService());
  return { service, db };
}

describe('PublicContentManagementService', () => {
  it('requires the read and manage capabilities', async () => {
    const { service } = setup();
    const nobody = principalFor([]);
    await expect(service.list(nobody, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.save(nobody, 'HERO_CAROUSEL', { payload: hero() }, 'c')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(service.reset(nobody, 'HERO_CAROUSEL', 'c')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('only lets branch:all holders change global content, and hides everything else from branch staff', async () => {
    const { service, db } = setup();
    await expect(
      service.save(branchStaff, 'HERO_CAROUSEL', { payload: hero() }, 'c'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.reset(branchStaff, 'HERO_CAROUSEL', 'c')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(db.publicContent.create).not.toHaveBeenCalled();
    expect(db.publicContent.update).not.toHaveBeenCalled();
    await service.list(branchStaff, {});
    expect(JSON.stringify(db.publicContent.findMany.mock.calls[0]![0].where)).toContain('"in":["' + id(1) + '"]');
  });

  it('lists only what is live on the site, never leftover drafts or archives', async () => {
    const { service, db } = setup();
    await service.list(owner, { kind: 'faq' });
    expect(JSON.stringify(db.publicContent.findMany.mock.calls[0]![0].where)).toContain('"status":"PUBLISHED"');
    expect(JSON.stringify(db.publicContent.findMany.mock.calls[0]![0].where)).toContain('"kind":"FAQ"');
  });

  it('refuses kinds the public site does not read and invalid payloads', async () => {
    const { service, db } = setup();
    await expect(service.save(owner, 'BANNER', { payload: { items: [] } }, 'c')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(
      service.save(owner, 'HERO_CAROUSEL', { payload: hero({ slides: [slide({ imageSrc: 'javascript:x' })] }) }, 'c'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(db.publicContent.create).not.toHaveBeenCalled();
    expect(db.publicContent.update).not.toHaveBeenCalled();
  });

  it('replaces the live content in place when there is one', async () => {
    const { service, db } = setup();
    const saved = await service.save(owner, 'hero_carousel', { payload: hero({ intervalMs: 8000 }) }, 'c');
    expect(db.publicContent.create).not.toHaveBeenCalled();
    expect(db.publicContent.update).toHaveBeenCalledWith({
      where: { id: contentId },
      data: { payload: expect.objectContaining({ intervalMs: 8000 }) },
    });
    expect(saved).toMatchObject({ id: contentId, status: 'PUBLISHED', version: 3 });
  });

  it('publishes the first content straight away, numbered after any legacy versions', async () => {
    const { service, db } = setup(null, false);
    const saved = await service.save(owner, 'HERO_CAROUSEL', { payload: hero() }, 'c');
    expect(db.publicContent.update).not.toHaveBeenCalled();
    expect(db.publicContent.create.mock.calls[0]![0].data).toMatchObject({
      contentKey: 'HOME_HERO_CAROUSEL',
      scopeKey: 'GLOBAL',
      version: 4,
      status: 'PUBLISHED',
      createdById: owner.userId,
    });
    expect(saved).toMatchObject({ status: 'PUBLISHED', version: 4 });
  });

  it('menyimpan slider hero sebagai en-US untuk beranda Inggris, FAQ tetap id-ID', async () => {
    const { service, db } = setup(null, false);
    await service.save(owner, 'HERO_CAROUSEL', { payload: hero() }, 'c');
    expect(db.publicContent.findFirst.mock.calls[0]![0].where).toMatchObject({ locale: 'en-US' });
    expect(db.publicContent.create.mock.calls[0]![0].data).toMatchObject({ locale: 'en-US' });
    await service.reset(owner, 'HERO_CAROUSEL', 'c');
    expect(db.publicContent.findMany.mock.calls.at(-1)![0].where).toMatchObject({ locale: 'en-US' });
    await service.reset(owner, 'FAQ', 'c');
    expect(db.publicContent.findMany.mock.calls.at(-1)![0].where).toMatchObject({ locale: 'id-ID' });
  });

  it('resetting archives the live content so the site shows its defaults; optional reason', async () => {
    const { service, db } = setup();
    await expect(service.reset(owner, 'HERO_CAROUSEL', 'c', 'ab')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(db.publicContent.updateMany).not.toHaveBeenCalled();
    await expect(service.reset(owner, 'HERO_CAROUSEL', 'c')).resolves.toEqual({ reset: true });
    expect(db.publicContent.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ contentKey: 'HOME_HERO_CAROUSEL', status: 'PUBLISHED' }),
      data: { status: 'ARCHIVED', archivedAt: expect.any(Date) },
    });
    const empty = setup(null, false);
    empty.db.publicContent.findMany.mockResolvedValue([]);
    await expect(empty.service.reset(owner, 'HERO_CAROUSEL', 'c')).resolves.toEqual({ reset: false });
  });
});
