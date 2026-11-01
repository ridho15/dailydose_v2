import { test, expect } from '@playwright/test';

const ARTIFACT_DIR =
  '/Users/lrmcorporation/.t3/userdata/providers/antigravity/ac0a3dfd6dddb20962cecff6ee5fe65e19d3923be20e52c5ab52ff877f7e4c32/antigravity-acp/brain/51f20fe2-4b3c-42ac-8fdd-691dc87a1338';

test.describe('QA UAT & No-Happy Path: Menu Member & Paket Admin Cabang', () => {
  test.setTimeout(90_000);

  test('Verifikasi Menu Member & Paket, Filter Cabang, Sisa Sesi, dan Responsivitas Mobile', async ({ page }) => {
    // =========================================================================
    // 1. DESKTOP: 5 MENU INTI ADMIN CABANG
    // =========================================================================
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://127.0.0.1:32120/sign-in');
    await page.waitForLoadState('networkidle');

    // Login sebagai Admin Cabang
    await page.locator('input[name="email"]').fill('admin@ddose.com');
    await page.locator('input[name="password"]').fill('Admin123!');
    await page.getByRole('button', { name: /masuk ke akun/i }).click();

    await page.waitForURL((url) => !url.pathname.includes('/sign-in'), { timeout: 20_000 });
    await page.goto('http://127.0.0.1:32120/workspace');
    await page.waitForTimeout(2000);

    const nav = page.getByRole('navigation', { name: 'Navigasi utama' });
    await expect(nav).toBeVisible();

    // Verifikasi lencana Admin Cabang & Heading Menu Utama Cabang
    await expect(page.getByText('Admin Cabang', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Menu Utama Cabang' })).toBeVisible();

    // Verifikasi 5 Menu Inti Meja Depan
    await expect(page.getByRole('link', { name: /hari ini & presensi/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /kalender kelas/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /booking kelas/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /member & paket/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /kasir & pengeluaran/i })).toBeVisible();

    // Pastikan menu manajerial lanjutan disembunyikan
    await expect(page.locator('text=Operasional Studio')).not.toBeVisible();
    await expect(page.locator('text=Member & Pelanggan')).not.toBeVisible();
    await expect(page.locator('text=Penjualan & Keuangan')).not.toBeVisible();
    await expect(page.locator('text=Pengaturan & Sistem')).not.toBeVisible();

    // Screenshot 1: Desktop 5 Menu
    await page.screenshot({
      path: `${ARTIFACT_DIR}/qa_member_01_desktop_5_menu.png`,
      fullPage: false,
    });

    // =========================================================================
    // 2. NAVIGASI KE MEMBER & PAKET & VERIFIKASI SISA SESI
    // =========================================================================
    await page.getByRole('link', { name: /member & paket/i }).click();
    await page.waitForURL('**/customers**');
    await page.waitForTimeout(2000);

    // Verifikasi header halaman dan pemilih cabang topbar (Daily Dose Green Garden)
    await expect(page.getByRole('heading', { name: /data pelanggan/i })).toBeVisible();
    await expect(page.getByText('Daily Dose Green Garden', { exact: false }).first()).toBeVisible();

    // Verifikasi kolom Paket & Sisa Sesi
    await expect(page.getByRole('columnheader', { name: /paket & sisa sesi/i })).toBeVisible();

    // Screenshot 2: Halaman Member & Paket dengan Sisa Sesi
    await page.screenshot({
      path: `${ARTIFACT_DIR}/qa_member_02_customers_with_sessions.png`,
      fullPage: false,
    });

    // =========================================================================
    // 3. NO-HAPPY PATH: PENCARIAN MEMBER YANG TIDAK DITEMUKAN
    // =========================================================================
    const searchInput = page.getByLabel('Cari pelanggan');
    await searchInput.fill('UserTidakDitemukanXYZ999');
    await page.waitForTimeout(1500);

    await expect(page.getByText(/tidak ada pelanggan yang cocok/i)).toBeVisible();
    await expect(page.getByText(/ubah kata kunci atau filter/i)).toBeVisible();

    // Screenshot 3: No Happy Path Pencarian Tidak Ditemukan
    await page.screenshot({
      path: `${ARTIFACT_DIR}/qa_member_03_no_happy_empty_search.png`,
      fullPage: false,
    });

    // Bersihkan pencarian
    await searchInput.clear();
    await page.waitForTimeout(1500);

    // =========================================================================
    // 4. RESPONSIVE MOBILE: 5 TAB BOTTOM NAVIGATION & KARTU MEMBER
    // =========================================================================
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(1000);

    const bottomNav = page.getByRole('navigation', { name: 'Navigasi Bawah Workspace' });
    await expect(bottomNav).toBeVisible();

    // Verifikasi 5 tab bottom bar mobile
    await expect(bottomNav.getByRole('link', { name: /hari ini/i })).toBeVisible();
    await expect(bottomNav.getByRole('link', { name: /kalender/i })).toBeVisible();
    await expect(bottomNav.getByRole('link', { name: /booking/i })).toBeVisible();
    await expect(bottomNav.getByRole('link', { name: /member/i })).toBeVisible();
    await expect(bottomNav.getByRole('link', { name: /kasir/i })).toBeVisible();

    // Screenshot 4: Mobile View dengan 5 Tab Bottom Nav dan Kartu Member Sisa Sesi
    await page.screenshot({
      path: `${ARTIFACT_DIR}/qa_member_04_mobile_5_tabs_card.png`,
      fullPage: false,
    });
  });
});
