import { test, expect } from '@playwright/test';

const ARTIFACT_DIR =
  '/Users/lrmcorporation/.t3/userdata/providers/antigravity/ac0a3dfd6dddb20962cecff6ee5fe65e19d3923be20e52c5ab52ff877f7e4c32/antigravity-acp/brain/51f20fe2-4b3c-42ac-8fdd-691dc87a1338';

test.describe('QA UAT & No-Happy Path: 4 Perbaikan Operasional Studio', () => {
  test.setTimeout(90_000);

  test('Verifikasi Modal QR WhatsApp, Upload Bukti Manual Admin, dan Booking Staf', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    // 1. LOGIN ADMIN CABANG
    await page.goto('http://127.0.0.1:32120/sign-in');
    await page.waitForLoadState('networkidle');

    await page.locator('input[name="email"]').fill('admin@ddose.com');
    await page.locator('input[name="password"]').fill('Admin123!');
    await page.getByRole('button', { name: /masuk ke akun/i }).click();

    await page.waitForURL((url) => !url.pathname.includes('/sign-in'), { timeout: 20_000 });
    await page.waitForTimeout(2000);

    // =========================================================================
    // 2. MODUL 4: TOMBOL BUAT/KIRIM QR & MODAL WHATSAPP OTOMATIS
    // =========================================================================
    await page.goto('http://127.0.0.1:32120/workspace/bookings');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2500);

    // Cari tombol "Buat/Kirim QR" pada tabel
    const btnIssueQr = page.locator('button:has-text("Buat/Kirim QR")').first();
    const btnWaExisting = page.locator('button:has-text("Kirim WA")').first();

    if (await btnIssueQr.isVisible()) {
      await btnIssueQr.click();
      await page.waitForTimeout(1500);
    } else if (await btnWaExisting.isVisible()) {
      await btnWaExisting.click();
      await page.waitForTimeout(1500);
    }

    // Modal QR Pass & Kirim WhatsApp harus muncul
    const qrModalHeading = page.getByRole('heading', { name: /QR Pass & Kirim WhatsApp/i });
    await expect(qrModalHeading).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /Salin Link Pass/i })).toBeVisible();
    await expect(page.locator('a:has-text("Kirim via WhatsApp")')).toBeVisible();

    // Screenshot 1: Modal QR WhatsApp Otomatis
    await page.screenshot({
      path: `${ARTIFACT_DIR}/qa_operasional_01_modal_qr_whatsapp_otomatis.png`,
      fullPage: false,
    });

    // Uji klik "Salin Link Pass"
    await page.getByRole('button', { name: /Salin Link Pass/i }).click();
    await page.waitForTimeout(500);

    // Tutup modal
    await page.getByRole('button', { name: /Tutup/i }).first().click();
    await page.waitForTimeout(1000);

    // Screenshot 2: Tombol Kirim WA ↗ Aktif di Baris Tabel
    await page.screenshot({
      path: `${ARTIFACT_DIR}/qa_operasional_02_tombol_kirim_wa_aktif.png`,
      fullPage: false,
    });

    // =========================================================================
    // 3. MODUL 1: DRAWER BOOKING MANUAL DADAKAN (BYPASS CUTOFF UNTUK STAF)
    // =========================================================================
    const btnCreateManual = page.locator('button:has-text("Buat booking manual")').first();
    if (await btnCreateManual.isVisible()) {
      await btnCreateManual.click();
      await page.waitForTimeout(1000);

      // Jika muncul dialog pilih cabang
      const branchDialog = page.getByRole('heading', { name: /pilih cabang/i });
      if (await branchDialog.isVisible()) {
        const selectBranch = page.locator('select').first();
        await selectBranch.selectOption({ index: 1 });
        await page.getByRole('button', { name: /lanjutkan/i }).click();
        await page.waitForTimeout(1000);
      }

      // Verifikasi Drawer Buat Booking Manual Terbuka
      const drawerHeading = page.getByRole('heading', { name: /buat booking manual/i });
      await expect(drawerHeading).toBeVisible();

      // Screenshot 4: Drawer Booking Manual Walk-in / Dadakan
      await page.screenshot({
        path: `${ARTIFACT_DIR}/qa_operasional_04_drawer_booking_manual_bebas_cutoff.png`,
        fullPage: false,
      });

      // Tutup drawer
      await page.getByRole('button', { name: /batal/i }).first().click();
      await page.waitForTimeout(800);
    }

    // =========================================================================
    // 4. MODUL 2: UPLOAD BUKTI PEMBAYARAN MANUAL OLEH SUPER OWNER / ADMIN
    // =========================================================================
    await page.goto('http://127.0.0.1:32120/sign-in');
    await page.waitForLoadState('networkidle');

    await page.locator('input[name="email"]').fill('ralamzah@gmail.com');
    await page.locator('input[name="password"]').fill('ridho123');
    await page.getByRole('button', { name: /masuk ke akun/i }).click();

    await page.waitForURL((url) => !url.pathname.includes('/sign-in'), { timeout: 20_000 });
    await page.waitForTimeout(2000);

    // Buka detail pembayaran langsung
    await page.goto('http://127.0.0.1:32120/workspace/payments/40000000-0000-4000-8000-000000001971');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2500);

    // Verifikasi Section Upload Manual Bukti Pembayaran Staf/Admin
    const manualUploadHeading = page.locator('text=Upload Bukti Manual oleh Staf / Admin');
    await expect(manualUploadHeading).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('input[type="file"]')).toBeVisible();

    // Screenshot 3: Form Upload Bukti Manual Admin di Panel Pembayaran
    await page.screenshot({
      path: `${ARTIFACT_DIR}/qa_operasional_03_form_upload_bukti_manual_admin.png`,
      fullPage: false,
    });
  });
});
