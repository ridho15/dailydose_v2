import { test, expect } from '@playwright/test';

const ARTIFACT_DIR =
  '/Users/lrmcorporation/.t3/userdata/providers/antigravity/ac0a3dfd6dddb20962cecff6ee5fe65e19d3923be20e52c5ab52ff877f7e4c32/antigravity-acp/brain/51f20fe2-4b3c-42ac-8fdd-691dc87a1338';

test.describe('QA UAT & No-Happy Path: Order Paket Manual & Perpanjangan Pilihan Tanggal', () => {
  test.setTimeout(90_000);

  test('Verifikasi Form Order Manual dengan Bukti Bayar & Modal Perpanjangan Pilihan Tanggal', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    // 1. LOGIN SEBAGAI SUPER OWNER
    await page.goto('http://127.0.0.1:32120/sign-in');
    await page.waitForLoadState('networkidle');

    await page.locator('input[name="email"]').fill('ralamzah@gmail.com');
    await page.locator('input[name="password"]').fill('ridho123');
    await page.getByRole('button', { name: /masuk ke akun/i }).click();

    await page.waitForURL((url) => !url.pathname.includes('/sign-in'), { timeout: 20_000 });
    await page.waitForTimeout(2000);

    // =========================================================================
    // 2. MODUL ORDER PAKET MANUAL DENGAN UPLOAD BUKTI (AssistedSaleDrawer)
    // =========================================================================
    await page.goto('http://127.0.0.1:32120/workspace/payments');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Klik tombol "Catat penjualan"
    const btnCatat = page.locator('button:has-text("Catat penjualan")').first();
    await expect(btnCatat).toBeVisible({ timeout: 10_000 });
    await btnCatat.click();
    await page.waitForTimeout(1500);

    // Verifikasi drawer terbuka
    const drawerHeading = page.getByRole('heading', { name: /catat penjualan paket/i });
    await expect(drawerHeading).toBeVisible();

    // Verifikasi keberadaan input upload bukti pembayaran di dalam formulir
    const proofLabel = page.locator('text=Bukti transfer / struk pembayaran (opsional)');
    await expect(proofLabel).toBeVisible();
    const proofInput = page.locator('input[data-testid="input-assisted-sale-proof"]');
    await expect(proofInput).toBeVisible();

    // Screenshot 1: Form Catat Penjualan Manual lengkap dengan field upload bukti
    await page.screenshot({
      path: `${ARTIFACT_DIR}/qa_assisted_01_form_order_manual_dengan_upload_bukti.png`,
      fullPage: false,
    });

    // Tutup drawer
    await page.getByRole('button', { name: /batal/i }).first().click();
    await page.waitForTimeout(1000);

    // =========================================================================
    // 3. MODUL PERPANJANGAN PAKET DENGAN PILIHAN TANGGAL (CustomerSessionDetailView)
    // =========================================================================
    // Kunjungi langsung halaman saldo sesi pelanggan aktif
    await page.goto('http://127.0.0.1:32120/ledger/50000000-0000-4000-8000-000000001971');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2500);

    // Cari dan klik tombol "Perpanjang masa berlaku"
    const btnExtend = page.locator('button:has-text("Perpanjang masa berlaku")').first();
    await expect(btnExtend).toBeVisible({ timeout: 10_000 });
    await btnExtend.click();
    await page.waitForTimeout(1500);

    // Dialog perpanjangan terbuka
    const extendHeading = page.getByRole('heading', { name: /perpanjang masa berlaku paket/i });
    await expect(extendHeading).toBeVisible();

    // Verifikasi field pilihan tanggal berakhir baru dan preset tombol cepat
    const dateInput = page.locator('input[data-testid="input-extend-date"]');
    await expect(dateInput).toBeVisible();
    await expect(page.locator('button:has-text("+14 hari")')).toBeVisible();
    await expect(page.locator('button:has-text("+30 hari")')).toBeVisible();
    await expect(page.locator('button:has-text("+60 hari")')).toBeVisible();
    await expect(page.locator('button:has-text("+90 hari")')).toBeVisible();

    // Klik preset +60 hari
    await page.locator('button:has-text("+60 hari")').click();
    await page.waitForTimeout(500);

    // Screenshot 2: Modal Perpanjangan Paket dengan Pilihan Tanggal & Preset Cepat
    await page.screenshot({
      path: `${ARTIFACT_DIR}/qa_extend_02_modal_pilihan_tanggal_perpanjangan.png`,
      fullPage: false,
    });

    // =========================================================================
    // 4. VERIFIKASI TANPA BATAS TANGGAL: ADMIN BEBAS PILIH TANGGAL BERAPAPUN
    // =========================================================================
    // Pastikan tidak ada batasan atribut min pada DateInput
    const minDateAttr = await dateInput.getAttribute('min');
    expect(minDateAttr).toBeNull();

    // Super Admin bebas mengisi tanggal berapapun (misal custom date di masa depan/lampau)
    await dateInput.fill('2028-12-31');
    await page.waitForTimeout(500);

    // Verifikasi kalkulasi teks dinamis menampilkan tanggal yang dipilih
    await expect(page.locator('text=2028-12-31')).toBeVisible();

    // Screenshot 4: Tanggal Bebas Tanpa Batasan Min
    await page.screenshot({
      path: `${ARTIFACT_DIR}/qa_extend_04_bebas_pilih_tanggal_tanpa_batas.png`,
      fullPage: false,
    });

    // Validasi alasan tetap aktif (minimal 3 karakter)
    const reasonTextarea = page.locator('textarea').first();
    await reasonTextarea.fill('ok');
    const confirmBtn = page.getByRole('button', { name: /perpanjang/i }).last();
    expect(await confirmBtn.isDisabled()).toBe(true);
  });
});
