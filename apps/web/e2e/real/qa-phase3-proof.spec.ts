import { test, expect } from '@playwright/test';
import { STAFF_ACCOUNTS, loginAs } from './staff-helper';

const SCREENSHOT_PATH =
  '/Users/lrmcorporation/.t3/userdata/providers/antigravity/ac0a3dfd6dddb20962cecff6ee5fe65e19d3923be20e52c5ab52ff877f7e4c32/antigravity-acp/brain/ea4cab5f-38d1-42f0-81f6-96a96e87eb0d/bukti-phase3-whatsapp-broadcast.png';

test.describe('Bukti Pengujian Fase 3: Notifikasi WhatsApp Pembatalan Kelas Manual', () => {
  test('Menampilkan panel pembatalan kelas dengan transparansi notifikasi WhatsApp multi-pihak', async ({
    page,
  }) => {
    // 1. Login sebagai Super Owner
    await loginAs(page, STAFF_ACCOUNTS.superOwner);

    // 2. Buka halaman Timetable Kelas
    await page.goto('/workspace/classes');
    await expect(page).toHaveURL(/\/workspace\/classes/);
    await page.waitForLoadState('networkidle');

    // 3. Klik salah satu slot kelas di timetable yang memiliki peserta
    const slotCard = page.getByRole('button', { name: /peserta sudah booking/i }).first();
    await expect(slotCard).toBeVisible({ timeout: 15_000 });
    await slotCard.click();

    // 4. Klik tombol "Atur kelas" di laci roster untuk membuka detail drawer kelas
    const aturKelasBtn = page.getByRole('button', { name: 'Atur kelas' });
    await expect(aturKelasBtn).toBeVisible({ timeout: 10_000 });
    await aturKelasBtn.click();

    // 5. Pastikan panel "Batalkan kelas" terlihat
    const cancelSection = page.locator('#class-cancel-title');
    await expect(cancelSection).toBeVisible({ timeout: 10_000 });
    await cancelSection.scrollIntoViewIfNeeded();

    // 6. Verifikasi deskripsi transparansi notifikasi WhatsApp
    const descriptionText = page.locator('text=/WhatsApp/i').first();
    await expect(descriptionText).toBeVisible();

    // 7. Pilih alasan pembatalan
    const reasonSelect = page.getByLabel('Alasan pembatalan');
    await expect(reasonSelect).toBeVisible();
    await reasonSelect.selectOption('STUDIO_UNAVAILABLE');

    // 8. Ambil tangkapan layar bukti pengujian Fase 3
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
    console.log(`Phase 3 Proof Screenshot saved to: ${SCREENSHOT_PATH}`);
  });
});
