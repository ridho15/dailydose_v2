import { test, expect } from '@playwright/test';

const ARTIFACT_DIR =
  '/Users/lrmcorporation/.t3/userdata/providers/antigravity/ac0a3dfd6dddb20962cecff6ee5fe65e19d3923be20e52c5ab52ff877f7e4c32/antigravity-acp/brain/51f20fe2-4b3c-42ac-8fdd-691dc87a1338';

test.describe('UAT Fase 5: Perampingan Navigasi 4 Menu Inti Admin Cabang', () => {
  test('Verifikasi Navigasi Desktop & Mobile Admin Cabang vs Super Owner', async ({ page }) => {
    // 1. Login sebagai Admin Cabang
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://127.0.0.1:32120/sign-in');
    await page.waitForLoadState('networkidle');

    await page.locator('input[name="email"]').fill('admin@ddose.com');
    await page.locator('input[name="password"]').fill('Admin123!');
    await page.getByRole('button', { name: /masuk ke akun/i }).click();

    await page.waitForURL((url) => !url.pathname.includes('/sign-in'), { timeout: 20_000 });
    await page.goto('http://127.0.0.1:32120/workspace');
    await page.waitForTimeout(2000);

    const nav = page.getByRole('navigation', { name: 'Navigasi utama' });
    await expect(nav).toBeVisible();

    // Verifikasi badge peran "Admin Cabang"
    await expect(page.getByText('Admin Cabang', { exact: true })).toBeVisible();

    // Verifikasi Header Menu
    await expect(page.getByRole('heading', { name: 'Menu Utama Cabang' })).toBeVisible();

    // Verifikasi ketiadaan grup membingungkan
    await expect(page.locator('text=Operasional Studio')).not.toBeVisible();
    await expect(page.locator('text=Member & Pelanggan')).not.toBeVisible();
    await expect(page.locator('text=Penjualan & Keuangan')).not.toBeVisible();
    await expect(page.locator('text=Alat & Sistem Lanjutan')).not.toBeVisible();

    // Screenshot 1: Desktop Sidebar 4 Menu
    await page.screenshot({
      path: `${ARTIFACT_DIR}/uat_fase5_01_desktop_sidebar_4_menu.png`,
      fullPage: false,
    });

    // 2. Navigasi ke Kalender Kelas
    await page.getByRole('link', { name: /kalender kelas/i }).click();
    await page.waitForTimeout(1500);
    expect(page.url()).toContain('/workspace/classes');
    await page.screenshot({
      path: `${ARTIFACT_DIR}/uat_fase5_02_kalender_kelas_active.png`,
      fullPage: false,
    });

    // 3. Navigasi ke Member & Booking
    await page.getByRole('link', { name: /member & booking/i }).click();
    await page.waitForTimeout(1500);
    expect(page.url()).toContain('/workspace/bookings');
    await page.screenshot({
      path: `${ARTIFACT_DIR}/uat_fase5_03_member_booking_active.png`,
      fullPage: false,
    });

    // 4. Navigasi ke Kasir & Pengeluaran
    await page.getByRole('link', { name: /kasir & pengeluaran/i }).click();
    await page.waitForTimeout(1500);
    expect(page.url()).toContain('/workspace/kas');
    await page.screenshot({
      path: `${ARTIFACT_DIR}/uat_fase5_04_kasir_pengeluaran_active.png`,
      fullPage: false,
    });

    // 5. Mobile View: 375x812
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('http://127.0.0.1:32120/workspace');
    await page.waitForTimeout(1500);

    const bottomNav = page.getByRole('navigation', { name: 'Navigasi Bawah Workspace' });
    await expect(bottomNav).toBeVisible();
    await expect(bottomNav.getByText('Hari Ini')).toBeVisible();
    await expect(bottomNav.getByText('Kalender')).toBeVisible();
    await expect(bottomNav.getByText('Booking')).toBeVisible();
    await expect(bottomNav.getByText('Kasir & Kas')).toBeVisible();
    await expect(bottomNav.getByText('Menu')).toBeVisible();

    await page.screenshot({
      path: `${ARTIFACT_DIR}/uat_fase5_05_mobile_bottom_nav.png`,
      fullPage: false,
    });

    // 6. Klik Menu di Bottom Nav -> Buka Drawer Mobile
    await bottomNav.getByRole('button', { name: 'Buka semua menu navigasi' }).click();
    await page.waitForTimeout(800);
    const drawerNav = page.locator('nav#workspace-navigation');
    await expect(drawerNav).toBeVisible();
    await expect(drawerNav.getByRole('heading', { name: 'Menu Utama Cabang' })).toBeVisible();

    await page.screenshot({
      path: `${ARTIFACT_DIR}/uat_fase5_06_mobile_drawer_4_menu.png`,
      fullPage: false,
    });

    // 7. Non-happy path / Role Boundary Check (Super Owner tetap punya akses lengkap dalam konteks terpisah)
    const ownerContext = await page.context().browser()!.newContext({ viewport: { width: 1440, height: 900 } });
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto('http://127.0.0.1:32120/sign-in');
    await ownerPage.waitForLoadState('networkidle');

    await ownerPage.locator('input[name="email"]').fill('ralamzah@gmail.com');
    await ownerPage.locator('input[name="password"]').fill('ridho123');
    await ownerPage.getByRole('button', { name: /masuk ke akun/i }).click();

    await ownerPage.waitForURL((url) => !url.pathname.includes('/sign-in'), { timeout: 20_000 });
    await ownerPage.goto('http://127.0.0.1:32120/workspace');
    await ownerPage.waitForTimeout(2000);

    // Verifikasi Super Owner memiliki multi-grup menu dan Alat Lanjutan
    await expect(ownerPage.getByText('Super Owner', { exact: true })).toBeVisible();
    await expect(ownerPage.locator('text=Operasional Studio')).toBeVisible();
    await expect(ownerPage.locator('text=Pengaturan & Sistem')).toBeVisible();
    await expect(ownerPage.locator('text=Alat & Sistem Lanjutan')).toBeVisible();

    await ownerPage.screenshot({
      path: `${ARTIFACT_DIR}/uat_fase5_07_no_happy_path_super_owner_retains_full_menu.png`,
      fullPage: false,
    });

    await ownerContext.close();
  });
});
