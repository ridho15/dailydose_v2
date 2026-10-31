import { test, expect } from '@playwright/test';
import { STAFF_ACCOUNTS, loginAs } from './staff-helper';

const SCREENSHOT_PATH = '/Users/lrmcorporation/.t3/userdata/providers/antigravity/ac0a3dfd6dddb20962cecff6ee5fe65e19d3923be20e52c5ab52ff877f7e4c32/antigravity-acp/brain/ea4cab5f-38d1-42f0-81f6-96a96e87eb0d/bukti-phase1-generate-key.png';

test.describe('Bukti Pengujian Fase 1: Generator Otomatis Business Key Paket', () => {
  test('Menghasilkan Business Key otomatis saat tombol Generate diklik', async ({ page }) => {
    // 1. Login sebagai Super Owner
    await loginAs(page, STAFF_ACCOUNTS.superOwner);

    // 2. Buka menu Katalog Paket
    await page.goto('/workspace/packages');
    await expect(page).toHaveURL(/\/workspace\/packages/);

    // 3. Buka drawer "Buat paket"
    const buatPaketBtn = page.getByRole('button', { name: /Buat paket/i });
    await expect(buatPaketBtn).toBeVisible({ timeout: 15_000 });
    await buatPaketBtn.click();

    // 4. Pastikan form terbuka dan tombol Generate Otomatis tampil
    await expect(page.getByRole('heading', { name: 'Buat paket' })).toBeVisible();
    const generateBtn = page.getByRole('button', { name: /Generate Otomatis/i });
    await expect(generateBtn).toBeVisible();

    // 5. Klik Generate Otomatis
    await generateBtn.click();

    // 6. Verifikasi nilai terisi di input
    const input = page.locator('input[name="businessKey"]');
    await expect(input).not.toHaveValue('');
    const val = await input.inputValue();
    console.log(`Generated Business Key: ${val}`);
    expect(val).toMatch(/^PKG-[A-Z0-9]+-[A-Z0-9]{4}$/);

    // 7. Ambil screenshot bukti
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
    console.log(`Screenshot saved to ${SCREENSHOT_PATH}`);
  });
});
