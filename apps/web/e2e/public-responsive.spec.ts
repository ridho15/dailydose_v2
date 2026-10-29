import { expect, test } from '@playwright/test';
import { selectSearchOption } from './e2e-visual-helpers';

const viewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1024, height: 900 },
  { width: 1280, height: 900 },
  { width: 1440, height: 900 },
];

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/me', (route) => route.fulfill({ status: 401, body: '{}' }));
  await page.route('**/api/v1/auth/refresh', (route) => route.fulfill({ status: 401, body: '{}' }));
  await page.route('**/api/v1/public/site-config', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        branches: [
          {
            id: 'branch-jkt',
            code: 'DD-JKT',
            name: 'Daily Dose Jakarta',
            timezone: 'Asia/Jakarta',
            supportWhatsappE164: '+628111111111',
          },
        ],
        classes: [],
        fallbackWhatsappE164: '+628111111111',
      }),
    }),
  );
  await page.route('**/api/v1/public/package-catalog**', (route) => {
    const branchId = new URL(route.request().url()).searchParams.get('branchId');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        branches: [
          {
            id: 'branch-jkt',
            code: 'DD-JKT',
            name: 'Daily Dose Jakarta',
            timezone: 'Asia/Jakarta',
          },
          {
            id: 'branch-bsd',
            code: 'DD-BSD',
            name: 'Daily Dose BSD',
            timezone: 'Asia/Jakarta',
          },
        ],
        items: branchId
          ? [
              {
                id: 'package-reformer-10',
                branchId,
                name: 'Reformer Pilates 10',
                sessionCount: 10,
                durationDays: 90,
                priceRp: 1_600_000,
                effectivePriceRp: 1_440_000,
                promotion: {
                  id: 'promotion-reformer-10',
                  name: 'Reformer Routine 10%',
                  label: 'Promo 10%',
                  discountType: 'PERCENTAGE',
                  discountValue: 10,
                  discountRp: 160_000,
                  promotionalPriceRp: 1_440_000,
                  activeFrom: '2026-07-01T00:00:00.000Z',
                  activeUntil: '2026-08-31T00:00:00.000Z',
                  version: 1,
                },
                effectiveUntil: null,
                classType: {
                  id: 'type-reformer',
                  code: 'REFORMER',
                  name: 'Reformer Pilates',
                },
              },
              {
                id: 'package-reformer-5',
                branchId,
                name: 'Reformer Pilates 5',
                sessionCount: 5,
                durationDays: 45,
                priceRp: 850_000,
                effectiveUntil: null,
                classType: {
                  id: 'type-reformer',
                  code: 'REFORMER',
                  name: 'Reformer Pilates',
                },
              },
              {
                id: 'package-mat-8',
                branchId,
                name: 'Mat Pilates 8',
                sessionCount: 8,
                durationDays: 60,
                priceRp: 720_000,
                effectiveUntil: null,
                classType: { id: 'type-mat', code: 'MAT', name: 'Mat Pilates' },
              },
              {
                id: 'package-barre-8',
                branchId,
                name: 'Barre 8',
                sessionCount: 8,
                durationDays: 60,
                priceRp: 760_000,
                effectiveUntil: null,
                classType: { id: 'type-barre', code: 'BARRE', name: 'Barre' },
              },
            ]
          : [],
      }),
    });
  });
  await page.route('**/api/v1/public/class-catalog**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        branches: [
          {
            id: 'branch-jkt',
            code: 'DD-JKT',
            name: 'Daily Dose Jakarta',
            timezone: 'Asia/Jakarta',
          },
          {
            id: 'branch-bsd',
            code: 'DD-BSD',
            name: 'Daily Dose BSD',
            timezone: 'Asia/Jakarta',
          },
        ],
        items: [],
        range: {
          from: '2026-07-27T00:00:00.000Z',
          until: '2026-08-10T00:00:00.000Z',
        },
      }),
    }),
  );
});

for (const viewport of viewports) {
  test(`public surfaces fit ${viewport.width}px without horizontal overflow`, async ({ page }) => {
    await page.setViewportSize(viewport);
    for (const path of ['/', '/packages', '/classes', '/locations', '/contact']) {
      await page.goto(path);
      await expect(page.locator('h1')).toHaveCount(1);
      const dimensions = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth,
        bodyMargin: getComputedStyle(document.body).margin,
        bodyFont: getComputedStyle(document.body).fontFamily,
        headingFont: getComputedStyle(document.querySelector('h1')!).fontFamily,
      }));
      expect(dimensions.content, path).toBeLessThanOrEqual(dimensions.viewport);
      expect(dimensions.bodyMargin, path).toBe('0px');
      // Body tetap Poppins (aplikasi internal); konten publik bergaya editorial memakai DM Sans
      // lewat wrapper `.ed-scope`. Georgia hanya untuk kata aksen serif, bukan judul.
      expect(dimensions.bodyFont, path).toMatch(/poppins/i);
      expect(dimensions.headingFont, path).toMatch(/dm ?sans/i);
      expect(dimensions.headingFont, path).not.toMatch(/Cormorant|Georgia|Times New Roman/i);
    }
  });
}

for (const viewport of [
  { width: 1024, height: 900 },
  { width: 1280, height: 900 },
  { width: 1440, height: 900 },
]) {
  test(`landing editorial sections remain balanced at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');

    const metrics = await page.evaluate(() => {
      const measure = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector)!;
        const heading = element.querySelector<HTMLElement>('h2')!;
        const rect = element.getBoundingClientRect();
        const headingRect = heading.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: rect.height,
          headingWidth: headingRect.width,
          headingHeight: headingRect.height,
        };
      };

      const journey = document.querySelector<HTMLElement>('[data-testid="package-journey"] ol')!;
      return {
        viewportWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        intro: measure('#about'),
        packageJourney: measure('[data-testid="package-journey"]'),
        journeyWidth: journey.getBoundingClientRect().width,
        journeyRows: journey.children.length,
      };
    });

    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.intro.headingWidth).toBeGreaterThanOrEqual(360);
    expect(metrics.packageJourney.left).toBeGreaterThanOrEqual(24);
    expect(metrics.packageJourney.right).toBeLessThanOrEqual(metrics.viewportWidth - 24);
    expect(metrics.packageJourney.headingWidth).toBeGreaterThanOrEqual(360);
    expect(metrics.packageJourney.headingHeight).toBeLessThanOrEqual(180);
    expect(metrics.journeyWidth).toBeGreaterThanOrEqual(360);
    expect(metrics.journeyRows).toBe(3);
  });
}

test('mobile navigation uses a modal drawer instead of a horizontal menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Open navigation menu' });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const drawer = page.getByRole('dialog', { name: 'Navigation menu' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('link', { name: 'Packages', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
});

for (const viewport of [
  { name: 'mobile', width: 390, height: 844, maximumCardTop: 850 },
  { name: 'desktop', width: 1280, height: 720, maximumCardTop: 620 },
]) {
  test(`package catalog reaches products quickly on ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/packages?branch=branch-jkt&slot=slot-1');
    const recommended = page.getByRole('heading', { name: 'Reformer Pilates 10' });
    await expect(recommended).toBeVisible();
    const firstCard = page.locator('main article').first();
    await expect(firstCard.locator('del')).toContainText('1.600.000');
    await expect(firstCard.getByText('Promo 10%')).toBeVisible();
    await expect(firstCard.getByText(/Rp\s*1\.440\.000/)).toBeVisible();
    const top = await firstCard.evaluate((element) => element.getBoundingClientRect().top);
    expect(top).toBeLessThanOrEqual(viewport.maximumCardTop);
    const cardTitleSize = await recommended.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize),
    );
    expect(cardTitleSize).toBeGreaterThanOrEqual(22);
    const badgeContrast = await page.getByText('Direkomendasikan').evaluate((element) => {
      const channels = (value: string) => value.match(/\d+/g)!.slice(0, 3).map(Number);
      const luminance = (rgb: number[]) => {
        const [red, green, blue] = rgb.map((value) => {
          const channel = value! / 255;
          return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
      };
      const style = getComputedStyle(element);
      const foreground = luminance(channels(style.color));
      const background = luminance(channels(style.backgroundColor));
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    expect(badgeContrast).toBeGreaterThanOrEqual(4.5);
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
    if (viewport.name === 'mobile') {
      const whatsapp = page.getByRole('button', {
        name: 'Hubungi Daily Dose melalui WhatsApp',
      });
      await expect(whatsapp).toBeVisible();
      const fab = await whatsapp.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
      expect(fab).toEqual({ width: 56, height: 56 });
    }
    await page.screenshot({
      path: testInfo.outputPath(`packages-${viewport.name}.png`),
      fullPage: true,
    });

    await selectSearchOption(page, 'Tipe kelas', 'Mat Pilates');
    await expect(page).toHaveURL(/branch=branch-jkt/);
    await expect(page).toHaveURL(/classType=type-mat/);
    await expect(page).toHaveURL(/slot=slot-1/);
    await expect(page.getByRole('heading', { name: 'Mat Pilates 8' })).toBeVisible();
  });
}

test('staff sees a workspace CTA and is never sent to customer verification', async ({ page }) => {
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'super-owner-1',
        displayName: 'Ralamzah Super Owner',
        roles: ['SUPER_OWNER'],
        branchIds: [],
        capabilities: ['branch:all'],
        identityVerificationStatus: 'NOT_REQUIRED',
        sessionExpiresAt: '2027-07-28T00:00:00.000Z',
        branches: [],
      }),
    }),
  );
  await page.goto('/packages?branch=branch-jkt');
  await expect(
    page.getByText('Anda sedang menggunakan akun staf. Pembelian paket menggunakan akun customer.'),
  ).toBeVisible();
  const workspaceCtas = page.getByRole('link', { name: 'Buka Workspace' });
  await expect(workspaceCtas).toHaveCount(4);
  for (const link of await workspaceCtas.all())
    await expect(link).toHaveAttribute('href', '/workspace');
  await expect(page.getByRole('link', { name: 'Verifikasi untuk memilih' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Pilih paket' })).toHaveCount(0);
});
