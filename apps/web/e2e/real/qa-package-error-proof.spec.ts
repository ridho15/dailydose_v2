import { test, expect } from '@playwright/test';
import { STAFF_ACCOUNTS, loginAs } from './staff-helper';

const SCREENSHOT_PATH = '/Users/lrmcorporation/.t3/userdata/providers/antigravity/ac0a3dfd6dddb20962cecff6ee5fe65e19d3923be20e52c5ab52ff877f7e4c32/antigravity-acp/brain/ea4cab5f-38d1-42f0-81f6-96a96e87eb0d/bukti-pesan-error-business-key.png';

test.describe('Verifikasi Kejelasan Pesan Gagal Buat Paket (Business Key Duplikat)', () => {
  test('Menampilkan pesan kegagalan spesifik dan jelas saat Business Key sudah terpakai', async ({ page }) => {
    // 1. Login sebagai Super Owner
    await loginAs(page, STAFF_ACCOUNTS.superOwner);

    // 2. Buka menu Katalog Paket
    await page.goto('/workspace/packages');
    await expect(page).toHaveURL(/\/workspace\/packages/);

    // 3. Tekan tombol "Buat paket"
    const buatPaketBtn = page.getByRole('button', { name: /Buat paket/i });
    await expect(buatPaketBtn).toBeVisible({ timeout: 15_000 });
    await buatPaketBtn.click();

    // 4. Pastikan Drawer form terbuka
    await expect(page.getByRole('heading', { name: 'Buat paket' })).toBeVisible();

    // 5. Isi form dengan Business Key yang SUDAH ADA di database (PKG-142-PILATESNOV)
    await page.locator('input[name="businessKey"]').fill('PKG-142-PILATESNOV');
    await page.locator('input[name="name"]').fill('Testing Duplikasi Business Key');
    await page.locator('input[name="sessionCount"]').fill('10');
    await page.locator('input[name="durationDays"]').fill('30');
    await page.locator('input[name="priceRp"]').fill('750000');
    await page.locator('input[name="effectiveFrom"]').fill('2026-11-01');

    const reasonInput = page.locator('input[name="reason"], textarea[name="reason"]');
    if (await reasonInput.count() > 0) {
      await reasonInput.first().fill('Uji coba verifikasi kejelasan pesan error');
    }

    // Pilih minimal satu tipe kelas bila ada checkbox
    const classCheckboxes = page.locator('input[name="classTypeIds"]');
    if (await classCheckboxes.count() > 0) {
      await classCheckboxes.first().check();
    }

    // 6. Klik "Simpan paket"
    await page.getByRole('button', { name: 'Simpan paket' }).click();

    // 7. Konfirmasi dialog peringatan "Buat paket baru?"
    const confirmDialog = page.getByRole('dialog');
    const confirmBtn = confirmDialog.getByRole('button', { name: 'Buat paket' });
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // 8. Verifikasi pop-up kesalahan muncul dengan pesan yang spesifik & jelas
    const expectedMessage = page.getByText(/Business Key \(kode paket\) sudah digunakan oleh paket lain/i);
    await expect(expectedMessage).toBeVisible({ timeout: 15_000 });

    // 9. Ambil tangkapan layar (screenshot) sebagai bukti sah hasil pengujian
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
    console.log(`Screenshot saved to: ${SCREENSHOT_PATH}`);
  });
});
