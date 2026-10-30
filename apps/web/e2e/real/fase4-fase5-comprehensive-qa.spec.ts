import { test, expect } from '@playwright/test';

const ARTIFACT_DIR =
  '/Users/lrmcorporation/.t3/userdata/providers/antigravity/ac0a3dfd6dddb20962cecff6ee5fe65e19d3923be20e52c5ab52ff877f7e4c32/antigravity-acp/brain/51f20fe2-4b3c-42ac-8fdd-691dc87a1338';

test.describe('Comprehensive QA UAT & No-Happy Path: Fase 4 & Fase 5', () => {
  test.setTimeout(90_000);

  test('Fase 4 & Fase 5: Pengujian End-to-End, Negative Path & Boundary Scenarios', async ({ page }) => {
    // =========================================================================
    // BAGIAN 1: FASE 5 - PERAMPINGAN NAVIGASI 4 MENU INTI (DESKTOP)
    // =========================================================================
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://127.0.0.1:32120/sign-in');
    await page.waitForLoadState('networkidle');

    // 1.1 Login sebagai Admin Cabang
    await page.locator('input[name="email"]').fill('admin@ddose.com');
    await page.locator('input[name="password"]').fill('Admin123!');
    await page.getByRole('button', { name: /masuk ke akun/i }).click();

    await page.waitForURL((url) => !url.pathname.includes('/sign-in'), { timeout: 20_000 });
    await page.goto('http://127.0.0.1:32120/workspace');
    await page.waitForTimeout(2000);

    // 1.2 Verifikasi Sidebar Admin Cabang: Tepat 4 Menu
    const nav = page.getByRole('navigation', { name: 'Navigasi utama' });
    await expect(nav).toBeVisible();

    // Verifikasi Lencana peran "Admin Cabang"
    await expect(page.getByText('Admin Cabang', { exact: true })).toBeVisible();

    // Verifikasi Heading "Menu Utama Cabang"
    await expect(page.getByRole('heading', { name: 'Menu Utama Cabang' })).toBeVisible();

    // Verifikasi 4 menu inti ada
    await expect(page.getByRole('link', { name: /hari ini & presensi/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /kalender kelas/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /member & booking/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /kasir & pengeluaran/i })).toBeVisible();

    // Verifikasi ketiadaan grup menu lanjutan dan non-inti
    await expect(page.locator('text=Operasional Studio')).not.toBeVisible();
    await expect(page.locator('text=Member & Pelanggan')).not.toBeVisible();
    await expect(page.locator('text=Penjualan & Keuangan')).not.toBeVisible();
    await expect(page.locator('text=Pengaturan & Sistem')).not.toBeVisible();
    await expect(page.locator('text=Alat & Sistem Lanjutan')).not.toBeVisible();

    // Screenshot 1: Desktop 4 Menu
    await page.screenshot({
      path: `${ARTIFACT_DIR}/qa_fase5_01_desktop_4_menu_verified.png`,
      fullPage: false,
    });

    // =========================================================================
    // BAGIAN 2: FASE 4 - FORM KAS STUDIO & TOLERANSI 15 MENIT
    // =========================================================================
    // 2.1 Navigasi ke Kasir & Pengeluaran
    await page.getByRole('link', { name: /kasir & pengeluaran/i }).click();
    await page.waitForTimeout(1500);
    expect(page.url()).toContain('/workspace/kas');

    // 2.2 Verifikasi pesan ramah toleransi 15 menit
    await expect(page.getByText(/salah ketik nominal\? anda memiliki jendela toleransi 15 menit/i)).toBeVisible();

    // 2.3 No-Happy Path: Form Kas tanpa nominal / nominal kosong
    const descInput = page.locator('input[placeholder*="Contoh: handuk 10 pcs"]');
    const nominalInput = page.locator('input[placeholder="450.000"]');
    const submitExpenseBtn = page.getByRole('button', { name: /simpan pengeluaran/i });

    // Kosongkan nominal tapi isi deskripsi
    await descInput.fill('Pengeluaran Uji Validasi');
    await nominalInput.fill('');
    // Verifikasi tombol submit berstatus disabled
    await expect(submitExpenseBtn).toBeDisabled();

    // Screenshot 2: No-Happy Path Kas Validasi Kosong
    await page.screenshot({
      path: `${ARTIFACT_DIR}/qa_fase4_01_no_happy_path_kas_nominal_kosong.png`,
      fullPage: false,
    });

    // 2.4 Happy Path: Catat pengeluaran baru dengan toleransi 15 menit
    const testDesc = `Tisu Studio QA Test ${Date.now()}`;
    await descInput.fill(testDesc);
    await nominalInput.fill('50.000');
    await expect(submitExpenseBtn).toBeEnabled();
    await submitExpenseBtn.click();
    await page.waitForTimeout(2000);

    // 2.5 Verifikasi pengeluaran tercatat dan tombol koreksi 15 menit muncul
    const row = page.locator('tr').filter({ hasText: testDesc });
    await expect(row).toBeVisible();
    const koreksiBtn = row.getByRole('button', { name: /koreksi \/ batalkan/i });
    await expect(koreksiBtn).toBeVisible();
    await expect(koreksiBtn).toContainText('(15m)');

    // Screenshot 3: Tombol Koreksi 15 Menit Muncul
    await page.screenshot({
      path: `${ARTIFACT_DIR}/qa_fase4_02_tombol_koreksi_15m_muncul.png`,
      fullPage: false,
    });

    // 2.6 Happy Path: Lakukan koreksi nominal dan deskripsi
    await koreksiBtn.click();
    await page.waitForTimeout(800);

    const koreksiModal = page.getByRole('heading', { name: /koreksi pengeluaran/i });
    await expect(koreksiModal).toBeVisible();

    // Modal koreksi: gunakan selector di dalam modal dialog
    const modal = page.locator('div[role="dialog"], .fixed');
    const editNominalInput = modal.getByLabel('Nominal (Rp)');
    const editDescInput = modal.getByLabel('Keterangan');
    const simpanKoreksiBtn = page.getByRole('button', { name: /simpan perubahan/i });

    await editNominalInput.fill('');
    await expect(simpanKoreksiBtn).toBeDisabled();

    // Koreksi ke nilai valid
    await editNominalInput.fill('75.000');
    await editDescInput.fill(`${testDesc} (Revisi 75k)`);
    await expect(simpanKoreksiBtn).toBeEnabled();

    // Screenshot 4: Modal Koreksi Form
    await page.screenshot({
      path: `${ARTIFACT_DIR}/qa_fase4_03_modal_koreksi_form.png`,
      fullPage: false,
    });

    await simpanKoreksiBtn.click();
    await page.waitForTimeout(2000);

    // Verifikasi row terupdate
    const updatedRow = page.locator('tr').filter({ hasText: `${testDesc} (Revisi 75k)` });
    await expect(updatedRow).toBeVisible();
    await expect(updatedRow).toContainText('Rp 75.000');

    // Screenshot 5: Pengeluaran Berhasil Dikoreksi
    await page.screenshot({
      path: `${ARTIFACT_DIR}/qa_fase4_04_pengeluaran_terkoreksi_sukses.png`,
      fullPage: false,
    });

    // =========================================================================
    // BAGIAN 3: FASE 4 - KALENDER KELAS & ROSTER VIEW
    // =========================================================================
    await page.goto('http://127.0.0.1:32120/workspace/classes');
    await page.waitForTimeout(2000);

    // Screenshot 6: Halaman Kalender Kelas
    await page.screenshot({
      path: `${ARTIFACT_DIR}/qa_fase4_05_kalender_kelas_view.png`,
      fullPage: false,
    });

    // =========================================================================
    // BAGIAN 4: FASE 5 - RESPONSIVE MOBILE NAVIGATION (375x812)
    // =========================================================================
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

    // Screenshot 7: Mobile Bottom Nav
    await page.screenshot({
      path: `${ARTIFACT_DIR}/qa_fase5_02_mobile_bottom_bar.png`,
      fullPage: false,
    });

    // Klik Menu di Bottom Nav -> Membuka Drawer Mobile
    await bottomNav.getByRole('button', { name: 'Buka semua menu navigasi' }).click();
    await page.waitForTimeout(800);

    const drawerNav = page.locator('nav#workspace-navigation');
    await expect(drawerNav).toBeVisible();
    await expect(drawerNav.getByRole('heading', { name: 'Menu Utama Cabang' })).toBeVisible();

    // Screenshot 8: Mobile Drawer 4 Menu
    await page.screenshot({
      path: `${ARTIFACT_DIR}/qa_fase5_03_mobile_drawer_4_menu.png`,
      fullPage: false,
    });

    // Tutup Drawer
    await page.locator('button:has(svg.lucide-x)').click();
    await page.waitForTimeout(500);

    // =========================================================================
    // BAGIAN 5: FASE 5 - NO-HAPPY PATH: AKSES DIRECT URL KE HALAMAN TERLARANG
    // =========================================================================
    // Kembali ke viewport desktop
    await page.setViewportSize({ width: 1440, height: 900 });

    // 5.1 Direct URL ke /workspace/packages (Katalog Master Paket - khusus Admin Master / Owner)
    await page.goto('http://127.0.0.1:32120/workspace/packages');
    await page.waitForTimeout(2000);

    // Verifikasi Route Guard: Admin Cabang otomatis di-redirect kembali ke /workspace karena tidak memiliki hak akses master paket
    expect(page.url()).toContain('/workspace');
    await expect(page.getByRole('heading', { name: /hari ini di meja depan/i })).toBeVisible();

    // Screenshot 9: Direct URL Packages Terproteksi & Redirect ke Workspace
    await page.screenshot({
      path: `${ARTIFACT_DIR}/qa_fase5_04_no_happy_path_direct_url_packages_redirected.png`,
      fullPage: false,
    });

    // 5.2 Direct URL ke /workspace/payroll (Payroll Instruktur - khusus Instruktur)
    await page.goto('http://127.0.0.1:32120/workspace/payroll');
    await page.waitForTimeout(2000);

    // Verifikasi Route Guard: Admin Cabang otomatis di-redirect kembali ke /workspace karena tidak memiliki hak attendance:self
    expect(page.url()).toContain('/workspace');
    await expect(page.getByRole('heading', { name: /hari ini di meja depan/i })).toBeVisible();

    // Screenshot 10: Direct URL Payroll Terproteksi & Redirect ke Workspace
    await page.screenshot({
      path: `${ARTIFACT_DIR}/qa_fase5_05_no_happy_path_direct_url_payroll_redirected.png`,
      fullPage: false,
    });

    // =========================================================================
    // BAGIAN 6: FASE 5 - NO-HAPPY PATH: ROLE BOUNDARY (SUPER OWNER TETAP PENUH)
    // =========================================================================
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

    // Verifikasi Super Owner tidak terdampak oleh 4 menu perampingan front desk
    await expect(ownerPage.getByText('Super Owner', { exact: true })).toBeVisible();
    await expect(ownerPage.locator('text=Operasional Studio')).toBeVisible();
    await expect(ownerPage.locator('text=Pengaturan & Sistem')).toBeVisible();
    await expect(ownerPage.locator('text=Alat & Sistem Lanjutan')).toBeVisible();

    // Screenshot 11: Super Owner Retains Full Multi-Group Menu
    await ownerPage.screenshot({
      path: `${ARTIFACT_DIR}/qa_fase5_06_super_owner_retains_full_menu.png`,
      fullPage: false,
    });

    await ownerContext.close();
  });
});
