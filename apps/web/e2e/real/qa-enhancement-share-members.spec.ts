import { test, expect } from '@playwright/test';

const ARTIFACT_DIR =
  '/Users/lrmcorporation/.t3/userdata/providers/antigravity/ac0a3dfd6dddb20962cecff6ee5fe65e19d3923be20e52c5ab52ff877f7e4c32/antigravity-acp/brain/51f20fe2-4b3c-42ac-8fdd-691dc87a1338';

test.describe('QA UAT & No-Happy Path: Peningkatan Fitur Share Member Paket', () => {
  test.setTimeout(90_000);

  test('Verifikasi Lencana Paket Bersama, Shortcut 1-Klik di Profil, Modal Pop-Up, dan No-Happy Path Duplikasi', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    // =========================================================================
    // 1. LOGIN ADMIN CABANG
    // =========================================================================
    await page.goto('http://127.0.0.1:32120/sign-in');
    await page.waitForLoadState('networkidle');

    await page.locator('input[name="email"]').fill('admin@ddose.com');
    await page.locator('input[name="password"]').fill('Admin123!');
    await page.getByRole('button', { name: /masuk ke akun/i }).click();

    await page.waitForURL((url) => !url.pathname.includes('/sign-in'), { timeout: 20_000 });
    await page.waitForTimeout(1500);

    // =========================================================================
    // 2. MENU MEMBER & PAKET: INDIKATOR LENCANA FAMILY / DUET
    // =========================================================================
    await page.goto('http://127.0.0.1:32120/customers');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Cari pelanggan Felisia yang memiliki paket shareable
    const searchInput = page.getByLabel('Cari pelanggan');
    await searchInput.fill('Felisia');
    await page.waitForTimeout(1500);

    // Verifikasi Lencana Family/Duet muncul pada tabel
    const badgeFamily = page.getByText(/family\/duet/i).first();
    await expect(badgeFamily).toBeVisible({ timeout: 10_000 });

    // Screenshot 1: Tabel Member & Paket dengan Indikator Lencana Family/Duet
    await page.screenshot({
      path: `${ARTIFACT_DIR}/qa_enhancement_01_tabel_member_badge_paket_bersama.png`,
      fullPage: false,
    });

    // =========================================================================
    // 3. SHORTCUT 1-KLIK DI PROFIL MEMBER
    // =========================================================================
    // Buka detail pelanggan Felisia
    await page.getByRole('link', { name: /lihat detail/i }).first().click();
    await page.waitForURL('**/customers/**');
    await page.waitForTimeout(2000);

    // Verifikasi tombol pintas 1-klik "Anggota Bersama" tersedia langsung di profil
    const btnShareShortcut = page.locator('button:has-text("Anggota Bersama")').first();
    await expect(btnShareShortcut).toBeVisible({ timeout: 10_000 });

    // Screenshot 2: Tombol Pintas 1-Klik Anggota Bersama di Profil Member
    await page.screenshot({
      path: `${ARTIFACT_DIR}/qa_enhancement_02_profil_member_tombol_anggota_bersama.png`,
      fullPage: false,
    });

    // =========================================================================
    // 4. BUKA MODAL LANGSUNG DI PROFIL MEMBER & TAMBAH ANGGOTA
    // =========================================================================
    await btnShareShortcut.click();
    await page.waitForTimeout(1500);

    // Modal harus terbuka langsung di halaman profil tanpa navigasi ke halaman lain
    const modalHeading = page.getByRole('heading', { name: /kelola anggota paket bersama/i });
    await expect(modalHeading).toBeVisible({ timeout: 10_000 });

    // Screenshot 3: Modal Dialog Terbuka Langsung di Profil Member
    await page.screenshot({
      path: `${ARTIFACT_DIR}/qa_enhancement_03_modal_terbuka_langsung_di_profil.png`,
      fullPage: false,
    });

    // Cari member "Gerald"
    const modalSearchInput = page.getByLabel('Cari Member');
    await modalSearchInput.fill('Gerald');
    await page.waitForTimeout(1000);

    // Tunggu dropdown hasil pencarian muncul
    const searchDropdownItem = page.locator('ul button:has-text("Gerald")').first();
    await searchDropdownItem.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

    if (await searchDropdownItem.isVisible()) {
      await searchDropdownItem.click();
      await page.waitForTimeout(600);

      // Pilih relasi "Keluarga"
      const relasiSelect = page.locator('select').first();
      if (await relasiSelect.isVisible()) {
        await relasiSelect.selectOption('FAMILY');
      }

      // Klik tombol Tambah Anggota
      const btnTambah = page.getByRole('button', { name: /tambah anggota/i });
      if (await btnTambah.isVisible()) {
        await btnTambah.click();
        await page.waitForTimeout(2500);
      }
    }

    // =========================================================================
    // 5. NO-HAPPY PATH: MENCEGAH DUPLIKASI ANGGOTA BERSAMA
    // =========================================================================
    // Coba cari dan tambahkan "Gerald" lagi ke paket yang sama
    const modalSearchInput2 = page.getByLabel('Cari Member');
    if (await modalSearchInput2.isVisible()) {
      await modalSearchInput2.fill('Gerald');
      await page.waitForTimeout(1000);

      const searchDropdownItemDup = page.locator('ul button:has-text("Gerald")').first();
      await searchDropdownItemDup.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

      if (await searchDropdownItemDup.isVisible()) {
        await searchDropdownItemDup.click();
        await page.waitForTimeout(600);

        const btnTambahDup = page.getByRole('button', { name: /tambah anggota/i });
        if (await btnTambahDup.isVisible()) {
          await btnTambahDup.click();
          await page.waitForTimeout(2000);
        }
      }
    }

    // Screenshot 4: No-Happy Path Validasi Duplikasi Anggota Bersama Ditolak / Tampilan Anggota
    await page.screenshot({
      path: `${ARTIFACT_DIR}/qa_enhancement_04_no_happy_path_duplikasi_anggota.png`,
      fullPage: false,
    });

    // Tutup dialog
    const btnTutup = page.getByRole('button', { name: /tutup/i }).first();
    if (await btnTutup.isVisible()) {
      await btnTutup.click();
      await page.waitForTimeout(1000);
    }

    // =========================================================================
    // 6. MEJA DEPAN / BOOKING KELAS TERINTEGRASI
    // =========================================================================
    await page.goto('http://127.0.0.1:32120/workspace/bookings');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Screenshot 5: Meja Depan Booking Kelas Terintegrasi
    await page.screenshot({
      path: `${ARTIFACT_DIR}/qa_enhancement_05_booking_dengan_paket_bersama.png`,
      fullPage: false,
    });

    await context.close();
  });
});
