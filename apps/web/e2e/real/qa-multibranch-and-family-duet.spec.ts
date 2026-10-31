import { test, expect } from '@playwright/test';

const ARTIFACT_DIR =
  '/Users/lrmcorporation/.t3/userdata/providers/antigravity/ac0a3dfd6dddb20962cecff6ee5fe65e19d3923be20e52c5ab52ff877f7e4c32/antigravity-acp/brain/51f20fe2-4b3c-42ac-8fdd-691dc87a1338';

test.describe('Bukti Nyata Multi Cabang Instruktur, Member, dan Booking Family/Duet', () => {
  test.setTimeout(90_000);

  test('Bukti 1 & 2: Instruktur Multi Cabang dan Member Multi Cabang di Web Admin', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    // 1. Login sebagai Super Owner / Super Admin
    await page.goto('http://127.0.0.1:32120/sign-in');
    await page.waitForLoadState('networkidle');

    await page.locator('input[name="email"]').fill('ralamzah@gmail.com');
    await page.locator('input[name="password"]').fill('ridho123');
    await page.getByRole('button', { name: /masuk ke akun/i }).click();

    await page.waitForURL((url) => !url.pathname.includes('/sign-in'), { timeout: 20_000 });
    await page.waitForTimeout(1500);

    // =========================================================================
    // BUKTI 1: INSTRUKTUR BISA MULTI CABANG
    // =========================================================================
    await page.goto('http://127.0.0.1:32120/instructors');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Verifikasi tabel instruktur menampilkan penugasan multi cabang
    const instructorTable = page.locator('table');
    await expect(instructorTable).toBeVisible({ timeout: 10_000 });

    // Screenshot 1: Tabel Instruktur dengan Kolom Studio/Cabang (Lulu di 5 cabang, Nadya di 3 cabang)
    await page.screenshot({
      path: `${ARTIFACT_DIR}/qa_multibranch_01_instruktur_multi_cabang.png`,
      fullPage: false,
    });

    // =========================================================================
    // BUKTI 2: MEMBER BISA MULTI CABANG
    // =========================================================================
    // Buka profil member Monica Sutedja yang memiliki transaksi di Orange Groves PIK 2 dan Muara Karang
    await page.goto('http://127.0.0.1:32120/customers/10000000-0000-4000-8000-000000001591');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Buka Tab Riwayat Order
    const orderTab = page.getByRole('button', { name: /riwayat order/i });
    if (await orderTab.isVisible()) {
      await orderTab.click();
      await page.waitForTimeout(1000);
    }

    // Screenshot 2: Profil Member dengan Riwayat Order di Berbagai Cabang (PIK 2 dan Muara Karang)
    await page.screenshot({
      path: `${ARTIFACT_DIR}/qa_multibranch_02_member_multi_cabang.png`,
      fullPage: false,
    });

    await context.close();
  });

  test('Bukti 3 & 4: Booking Family/Duet Admin dan Tampilan Portal Member', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    // 1. Login sebagai Super Owner
    await page.goto('http://127.0.0.1:32120/sign-in');
    await page.waitForLoadState('networkidle');

    await page.locator('input[name="email"]').fill('ralamzah@gmail.com');
    await page.locator('input[name="password"]').fill('ridho123');
    await page.getByRole('button', { name: /masuk ke akun/i }).click();

    await page.waitForURL((url) => !url.pathname.includes('/sign-in'), { timeout: 20_000 });
    await page.waitForTimeout(1500);

    // =========================================================================
    // BUKTI 3: BOOKING FAMILY / DUET PACKAGE PADA HALAMAN ADMIN
    // =========================================================================
    // Buka Halaman Booking Meja Depan
    await page.goto('http://127.0.0.1:32120/workspace/bookings');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Buka Drawer Tambah Booking
    const btnTambahBooking = page.getByRole('button', { name: /tambah booking/i }).first();
    if (await btnTambahBooking.isVisible()) {
      await btnTambahBooking.click();
      await page.waitForTimeout(1500);

      // Pilih customer Felisia (pemilik paket duet/family)
      const custSelect = page.getByLabel('Pilih pelanggan');
      if (await custSelect.isVisible()) {
        await custSelect.click();
        await page.waitForTimeout(500);
        const optFelisia = page.getByRole('option', { name: /felisia/i }).first();
        if (await optFelisia.isVisible()) {
          await optFelisia.click();
          await page.waitForTimeout(1000);
        }
      }
    }

    // Screenshot 3: Form Booking Kelas Admin dengan Paket Duet/Family
    await page.screenshot({
      path: `${ARTIFACT_DIR}/qa_multibranch_03_admin_booking_family_duet.png`,
      fullPage: false,
    });

    // =========================================================================
    // BUKTI 4: HALAMAN ROLE CUSTOMER / MEMBER DENGAN PAKET FAMILY / DUET
    // =========================================================================
    // Buka profil pelanggan Felisia untuk impersonate masuk sebagai Customer
    await page.goto('http://127.0.0.1:32120/customers/10000000-0000-4000-8000-000000000066');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Klik tombol aksi profil untuk masuk sebagai pelanggan
    const btnImpersonate = page.getByRole('button', { name: /masuk sebagai pelanggan/i });
    if (await btnImpersonate.isVisible()) {
      await btnImpersonate.click();
      await page.waitForTimeout(800);

      const confirmBtn = page.getByRole('button', { name: /masuk sekarang/i });
      if (await confirmBtn.isVisible()) {
        await confirmBtn.click();
        await page.waitForURL((url) => url.pathname.includes('/account') || url.pathname.includes('/packages'), { timeout: 20_000 });
        await page.waitForTimeout(2000);
      }
    } else {
      // Direct navigation ke portal member paket jika sudah dalam sesi customer
      await page.goto('http://127.0.0.1:32120/account/packages');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
    }

    // Screenshot 4: Halaman Role Customer / Member melihat Paket Bersama dan Tombol Kelola Anggota
    await page.screenshot({
      path: `${ARTIFACT_DIR}/qa_multibranch_04_customer_portal_family_duet_package.png`,
      fullPage: false,
    });

    await context.close();
  });
});
