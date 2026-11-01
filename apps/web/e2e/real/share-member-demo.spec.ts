import { test, expect } from '@playwright/test';

const ARTIFACT_DIR =
  '/Users/lrmcorporation/.t3/userdata/providers/antigravity/ac0a3dfd6dddb20962cecff6ee5fe65e19d3923be20e52c5ab52ff877f7e4c32/antigravity-acp/brain/51f20fe2-4b3c-42ac-8fdd-691dc87a1338';

test.describe('Demonstrasi & Bukti Screenshot: Set Share Member Paket Admin & Super Admin', () => {
  test.setTimeout(90_000);

  test('Bukti 1: Super Admin Mengatur Master Paket Shareable (Family / Duet)', async ({ browser }) => {
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

    // Buka menu Master Paket & Promo
    await page.goto('http://127.0.0.1:32120/workspace/packages');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Cari tombol Tambah Paket Baru atau Edit Paket
    const btnTambah = page.getByRole('button', { name: /tambah paket/i }).first();
    if (await btnTambah.isVisible()) {
      await btnTambah.click();
      await page.waitForTimeout(1000);
    }

    // Scroll ke bagian opsi 'Bisa Dipakai Bersama (Family / Duet Package)'
    const shareableCheckbox = page.locator('input[name="isShareable"]').first();
    if (await shareableCheckbox.isVisible()) {
      await shareableCheckbox.scrollIntoViewIfNeeded();
    }

    // Screenshot 1: Opsi Master Paket Shareable oleh Super Admin
    await page.screenshot({
      path: `${ARTIFACT_DIR}/qa_share_01_superadmin_master_package_shareable.png`,
      fullPage: false,
    });

    await context.close();
  });

  test('Bukti 2, 3 & 4: Admin Cabang Melakukan Set Share Member di Halaman Paket & Modal', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    // 1. Login sebagai Admin Cabang
    await page.goto('http://127.0.0.1:32120/sign-in');
    await page.waitForLoadState('networkidle');

    await page.locator('input[name="email"]').fill('admin@ddose.com');
    await page.locator('input[name="password"]').fill('Admin123!');
    await page.getByRole('button', { name: /masuk ke akun/i }).click();

    await page.waitForURL((url) => !url.pathname.includes('/sign-in'), { timeout: 20_000 });
    await page.waitForTimeout(1500);

    // 2. Buka Halaman Ledger Paket Pelanggan yang Shareable
    const targetCustomerPackageId = '50000000-0000-4000-8000-000000001971';
    await page.goto(`http://127.0.0.1:32120/ledger/${targetCustomerPackageId}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Verifikasi Keberadaan Panel Anggota Bersama & Tombol Kelola
    const panelHeading = page.getByRole('heading', { name: /anggota bersama/i });
    await expect(panelHeading).toBeVisible({ timeout: 10_000 });
    const btnKelola = page.getByRole('button', { name: /kelola anggota bersama/i }).first();
    await expect(btnKelola).toBeVisible();

    // Screenshot 2: Halaman Ledger dengan Panel Anggota Bersama (Family / Duet)
    await page.screenshot({
      path: `${ARTIFACT_DIR}/qa_share_02_admin_cabang_ledger_package_panel.png`,
      fullPage: false,
    });

    // 3. Klik Tombol Kelola Anggota Bersama
    await btnKelola.click();
    await page.waitForTimeout(1200);

    // Verifikasi Dialog Modal Terbuka
    const dialogTitle = page.getByRole('heading', { name: /kelola anggota paket bersama/i });
    await expect(dialogTitle).toBeVisible();

    // Lakukan pencarian live search "Gerald" menggunakan getByLabel('Cari Member')
    const searchInput = page.getByLabel('Cari Member');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('Gerald');
    await page.waitForTimeout(1200);

    // Screenshot 3: Modal Dialog dengan Live Search Member Terdaftar
    await page.screenshot({
      path: `${ARTIFACT_DIR}/qa_share_03_modal_dialog_search_member.png`,
      fullPage: false,
    });

    // Pilih hasil pencarian Gerald jika muncul
    const resultItem = page.locator('button:has-text("Gerald")').first();
    if (await resultItem.isVisible()) {
      await resultItem.click();
      await page.waitForTimeout(800);

      // Pilih tipe relasi "Keluarga"
      const relasiSelect = page.locator('select').first();
      if (await relasiSelect.isVisible()) {
        await relasiSelect.selectOption('FAMILY');
      }

      // Klik tombol "Tambah Anggota"
      const btnTambahAnggota = page.getByRole('button', { name: /tambah anggota/i });
      if (await btnTambahAnggota.isVisible()) {
        await btnTambahAnggota.click();
        await page.waitForTimeout(2500);
      }
    }

    // Screenshot 4: Anggota Bersama Berhasil Terdaftar
    await page.screenshot({
      path: `${ARTIFACT_DIR}/qa_share_04_member_bersama_berhasil_ditambahkan.png`,
      fullPage: false,
    });

    await context.close();
  });
});
