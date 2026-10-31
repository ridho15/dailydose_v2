import { test, expect } from '@playwright/test';
import { STAFF_ACCOUNTS, loginAs } from './staff-helper';

const SCREENSHOT_PATH =
  '/Users/lrmcorporation/.t3/userdata/providers/antigravity/ac0a3dfd6dddb20962cecff6ee5fe65e19d3923be20e52c5ab52ff877f7e4c32/antigravity-acp/brain/ea4cab5f-38d1-42f0-81f6-96a96e87eb0d/bukti-phase4-cash-and-kyc.png';

test.describe('Bukti Pengujian Fase 4: Otorisasi Pembayaran Langsung & Delegasi KYC', () => {
  test('Verifikasi akses verifikasi KYC pelanggan dan antrean pembayaran kasir langsung', async ({
    page,
  }) => {
    // 1. Login sebagai Super Owner
    await loginAs(page, STAFF_ACCOUNTS.superOwner);

    // 2. Buka halaman Antrean Verifikasi Identitas (KYC)
    await page.goto('/identity-verifications');
    await expect(page).toHaveURL(/\/identity-verifications/);
    await page.waitForLoadState('networkidle');

    // 3. Pastikan header Verifikasi Pelanggan dan link Mode Cepat terlihat
    const header = page.locator('h1, h2').filter({ hasText: /Verifikasi Pelanggan/i }).first();
    await expect(header).toBeVisible({ timeout: 15_000 });

    const modeCepatLink = page.getByRole('link', { name: /Mode Cepat/i });
    await expect(modeCepatLink).toBeVisible({ timeout: 10_000 });

    // 4. Buka halaman Antrean Pembayaran Kasir / Workspace Payments
    await page.goto('/workspace/payments?status=ALL');
    await expect(page).toHaveURL(/\/workspace\/payments/);
    await page.waitForLoadState('networkidle');

    // 5. Pastikan antrean transaksi termuat
    const paymentHeader = page.locator('h1').filter({ hasText: /Antrean Pembayaran/i });
    await expect(paymentHeader).toBeVisible({ timeout: 15_000 });

    // 6. Ambil tangkapan layar bukti pengujian Fase 4
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
    console.log(`Phase 4 Proof Screenshot saved to: ${SCREENSHOT_PATH}`);
  });
});
