import { expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const HELP_VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
} as const;

export type HelpCategory = 'customer' | 'admin' | 'super-admin' | 'common';

export async function hideDevelopmentAffordances(page: Page) {
  await page.addInitScript(() => {
    const hide = () => {
      if (!document.head || document.querySelector('[data-help-clean-styles]')) return;
      const style = document.createElement('style');
      style.dataset.helpCleanStyles = 'true';
      style.textContent = `
        nextjs-portal,
        [data-nextjs-toast],
        [data-nextjs-dialog-overlay] {
          display: none !important;
        }
        *, *::before, *::after {
          animation-duration: 0.001ms !important;
          animation-iteration-count: 1 !important;
          transition-duration: 0.001ms !important;
        }
      `;
      document.head.append(style);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', hide, { once: true });
    } else {
      hide();
    }
  });
}

/**
 * Memastikan tidak ada kebocoran Data Pribadi (PII) nyata pada halaman
 * sebelum tangkapan layar disimpan.
 */
export async function assertNoPIILeak(page: Page) {
  const pageText = await page.locator('body').innerText();

  // 1. Cek NIK nyata (16 digit yang tidak berakhiran 0000 atau tidak disensor)
  const nikMatches =
    pageText.match(/\b(1[1-9]|21|[37][1-6]|5[1-3]|6[1-5]|[89][12])\d{2}\d{6}\d{4}\b/g) ?? [];
  for (const nik of nikMatches) {
    if (!nik.endsWith('0000') && !nik.includes('*')) {
      throw new Error(`[PII GUARD] Potensi kebocoran NIK nyata terdeteksi: ${nik}`);
    }
  }

  // 2. Cek email pribadi/produksi selain domain uji resmi Daily Dose
  const emailMatches = pageText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? [];
  const allowedEmailDomains = [
    'dailydose.test',
    'ddose.com',
    'dailydose.local',
    'dailydosepilates.id',
    'example.com',
  ];
  for (const email of emailMatches) {
    const domain = email.split('@')[1]?.toLowerCase();
    if (domain && !allowedEmailDomains.includes(domain)) {
      throw new Error(`[PII GUARD] Potensi kebocoran email non-fiktif terdeteksi: ${email}`);
    }
  }

  // 3. Cek nomor HP asli (selain dummy 0000, nomor WhatsApp resmi, atau dummy 0812-0000-0001)
  const phoneMatches = pageText.match(/\b(?:(?:\+62|62|0)8[1-9][0-9]{7,10})\b/g) ?? [];
  const allowedPhonePatterns = [
    '0895329736127',
    '62895329736127',
    '+62895329736127',
    '081200000001',
    '081200000002',
    '081200000003',
  ];
  for (const phone of phoneMatches) {
    const cleanPhone = phone.replace(/\D/g, '');
    const isAllowed =
      allowedPhonePatterns.some((pattern) => pattern.replace(/\D/g, '') === cleanPhone) ||
      cleanPhone.includes('0000');
    if (!isAllowed) {
      throw new Error(`[PII GUARD] Potensi kebocoran nomor telepon nyata terdeteksi: ${phone}`);
    }
  }

  // 4. Cek path sistem lokal
  expect(pageText).not.toMatch(/\/Users\/|\/home\/|C:\\|PRIVATE_UPLOAD_ROOT/i);
}

export interface CaptureOptions {
  category: HelpCategory;
  name: string;
  viewport: 'desktop' | 'mobile';
  waitForSelector?: string;
  clip?: { x: number; y: number; width: number; height: number };
}

export async function captureHelpScreenshot(page: Page, options: CaptureOptions): Promise<string> {
  const { category, name, viewport, waitForSelector, clip } = options;
  const vpConfig = HELP_VIEWPORTS[viewport];
  await page.setViewportSize(vpConfig);
  await page.waitForTimeout(300);

  // Tunggu skeleton animasi/loading menghilang
  await page
    .waitForSelector('[data-loading], .animate-pulse', { state: 'detached', timeout: 6000 })
    .catch(() => {});

  if (waitForSelector) {
    await page.waitForSelector(waitForSelector, { state: 'visible', timeout: 10_000 });
  } else {
    // Tunggu kontainer konten utama stabil
    await page
      .waitForSelector('main, form, table, [role="table"], [data-admin-shell]', {
        state: 'visible',
        timeout: 6000,
      })
      .catch(() => {});
  }

  // Jeda rendering agar tata letak dan font stabil
  await page.waitForTimeout(400);

  await assertNoPIILeak(page);

  const targetDir = resolve(process.cwd(), `public/images/help/${category}`);
  await mkdir(targetDir, { recursive: true });

  const fileName = `${name}-${viewport}.png`;
  const filePath = join(targetDir, fileName);

  await page.screenshot({
    path: filePath,
    fullPage: false,
    clip,
  });

  return filePath;
}
