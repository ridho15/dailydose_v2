import { test, expect } from '@playwright/test';
import { STAFF_ACCOUNTS, loginAs } from './staff-helper';

const SCREENSHOT_PATH =
  '/Users/lrmcorporation/.t3/userdata/providers/antigravity/ac0a3dfd6dddb20962cecff6ee5fe65e19d3923be20e52c5ab52ff877f7e4c32/antigravity-acp/brain/ea4cab5f-38d1-42f0-81f6-96a96e87eb0d/bukti-phase2-h24-shortcut.png';

test.describe('Bukti Pengujian Fase 2: Alur Pembatalan H-24 dengan Pintasan Penyesuaian Sesi', () => {
  test('Menampilkan peringatan H-24 dan tautan langsung ke Form Penyesuaian Sesi di dialog pembatalan staf', async ({
    page,
  }) => {
    // 1. Intercept cancel endpoint to simulate H-24 cutoff error
    await page.route('**/api/v1/bookings/*/cancel', async (route) => {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'CANCELLATION_CUTOFF_PASSED',
            message:
              'Batas pembatalan H-24 sudah terlewati. Untuk kondisi darurat medis, ajukan Penyesuaian Sesi.',
          },
        }),
      });
    });

    // 2. Login sebagai Super Owner
    await loginAs(page, STAFF_ACCOUNTS.superOwner);

    // 3. Masuk ke halaman Manajemen Booking
    await page.goto('/workspace/bookings');
    await expect(page).toHaveURL(/\/workspace\/bookings/);
    await page.waitForLoadState('networkidle');

    // 4. Cari tombol tindakan booking pertama pada tabel
    const actionMenu = page.locator('button[aria-label^="Aksi booking"]').first();
    await expect(actionMenu).toBeVisible({ timeout: 15_000 });
    await actionMenu.click();

    // 5. Klik menu item "Batalkan booking"
    const cancelItem = page.getByRole('menuitem', { name: /Batalkan booking/i });
    await expect(cancelItem).toBeVisible();
    await cancelItem.click();

    // 6. Dialog pembatalan terbuka
    const dialog = page.getByRole('dialog', { name: /Batalkan booking/i });
    await expect(dialog).toBeVisible();

    // 7. Masukkan alasan pembatalan
    const reasonInput = dialog.getByLabel(/Alasan pembatalan/i);
    await reasonInput.fill('Pelanggan mengalami cedera darurat medis');

    // 8. Klik tombol konfirmasi pembatalan
    const submitBtn = dialog.getByRole('button', { name: 'Batalkan booking' });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // 9. Verifikasi pesan H-24 dan tombol "Buka Form Penyesuaian Sesi" muncul
    const errorText = dialog.getByText(/Batas pembatalan H-24 sudah terlewati/i);
    await expect(errorText).toBeVisible({ timeout: 5000 });

    const shortcutLink = dialog.getByRole('link', { name: /Buka Form Penyesuaian Sesi/i });
    await expect(shortcutLink).toBeVisible();
    await expect(shortcutLink).toHaveAttribute('href', /adjustments/);

    // 10. Ambil tangkapan layar bukti pengujian
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
    console.log(`Phase 2 Proof Screenshot saved to: ${SCREENSHOT_PATH}`);
  });
});
