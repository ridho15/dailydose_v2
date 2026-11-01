import { expect, test } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';

const evidenceDir = '/Users/lrmcorporation/.gemini/antigravity/brain/76f97d71-94b4-486b-839d-52c584f12663/uat-evidence';

test.beforeAll(() => {
  if (!fs.existsSync(evidenceDir)) {
    fs.mkdirSync(evidenceDir, { recursive: true });
  }
});

const today = new Date();
const y = today.getFullYear();
const m = String(today.getMonth() + 1).padStart(2, '0');
const d = String(today.getDate()).padStart(2, '0');

const slot1Start = `${y}-${m}-${d}T11:00:00+07:00`;
const slot1End = `${y}-${m}-${d}T12:00:00+07:00`;
const slot2Start = `${y}-${m}-${d}T14:00:00+07:00`;
const slot2End = `${y}-${m}-${d}T15:00:00+07:00`;
const slot3Start = `${y}-${m}-${d}T16:00:00+07:00`;
const slot3End = `${y}-${m}-${d}T17:00:00+07:00`;

const mockBranch = {
  id: 'branch-surabaya',
  code: 'SBY-GH',
  name: 'Graha Family Surabaya',
  timezone: 'Asia/Jakarta',
};

const slotPublishedZeroBooking = {
  id: 'slot-pub-zero',
  branchId: 'branch-surabaya',
  classTypeId: 'type-private',
  instructorUserId: 'inst-dina',
  startAt: new Date(slot1Start).toISOString(),
  endAt: new Date(slot1End).toISOString(),
  timezone: 'Asia/Jakarta',
  status: 'PUBLISHED',
  minimumQuota: 1,
  capacity: 4,
  bookedCount: 0,
  cancellationReasonCode: null,
  version: 1,
  idempotentReplay: false,
  classType: { id: 'type-private', code: 'PRV', name: 'Private Group' },
  instructor: { id: 'inst-dina', displayName: 'Coach Dina' },
};

const slotConfirmedWithBookings = {
  id: 'slot-pub-booked',
  branchId: 'branch-surabaya',
  classTypeId: 'type-group',
  instructorUserId: 'inst-dina',
  startAt: new Date(slot2Start).toISOString(),
  endAt: new Date(slot2End).toISOString(),
  timezone: 'Asia/Jakarta',
  status: 'CONFIRMED',
  minimumQuota: 2,
  capacity: 8,
  bookedCount: 3,
  cancellationReasonCode: null,
  version: 1,
  idempotentReplay: false,
  classType: { id: 'type-group', code: 'GRP', name: 'Group Class' },
  instructor: { id: 'inst-dina', displayName: 'Coach Dina' },
};

const slotConfirmedZeroBooking = {
  id: 'slot-conf-zero',
  branchId: 'branch-surabaya',
  classTypeId: 'type-private',
  instructorUserId: 'inst-dina',
  startAt: new Date(slot3Start).toISOString(),
  endAt: new Date(slot3End).toISOString(),
  timezone: 'Asia/Jakarta',
  status: 'CONFIRMED',
  minimumQuota: 1,
  capacity: 4,
  bookedCount: 0,
  cancellationReasonCode: null,
  version: 1,
  idempotentReplay: false,
  classType: { id: 'type-private', code: 'PRV', name: 'Private Group' },
  instructor: { id: 'inst-dina', displayName: 'Coach Dina' },
};

test.use({ channel: 'chrome', video: 'off' });

test.describe('UAT Timetable: Update Tipe Kelas & Ganti Instruktur (Happy Path & No Happy Path)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });

    // Inisialisasi cabang aktif ke Graha Family Surabaya sebelum halaman dimuat
    await page.addInitScript(() => {
      sessionStorage.setItem('dd_active_branch', 'branch-surabaya');
      sessionStorage.setItem('dd_session_hint', '1');
      localStorage.setItem('dd_session_hint', '1');
    });

    // Mock Session: Super Owner dengan cabang Surabaya
    await page.route('**/api/v1/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'user-admin',
          displayName: 'Super Admin Ridho',
          roles: ['SUPER_OWNER'],
          branchIds: ['branch-surabaya'],
          capabilities: [
            'branch:all',
            'class-slot:read',
            'class-slot:manage',
            'attendance:manage',
            'assignment:read',
            'assignment:manage',
            'user:admin',
            'booking:read',
          ],
          branches: [mockBranch],
          sessionExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        }),
      }),
    );

    // Mock Notifications & reminders
    await page.route(/\/api\/v1\/me\/notifications/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], count: 0, unreadCount: 0 }),
      }),
    );

    // Mock Dashboard overview
    await page.route('**/api/v1/dashboard/overview*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ stats: {} }),
      }),
    );

    // Mock Class Slots API (GET & PATCH)
    await page.route('**/api/v1/class-slots*', (route) => {
      const method = route.request().method();
      const url = route.request().url();
      if (url.includes('/assign-instructor')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ...slotPublishedZeroBooking,
            instructorUserId: 'inst-melissa',
            instructor: { id: 'inst-melissa', displayName: 'Coach Melissa' },
            version: 2,
          }),
        });
      }
      if (method === 'PATCH' && url.includes('/slot-pub-zero')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ...slotPublishedZeroBooking,
            classTypeId: 'type-group',
            classType: { id: 'type-group', code: 'GRP', name: 'Group Class' },
            version: 2,
          }),
        });
      }
      if (method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [slotPublishedZeroBooking, slotConfirmedWithBookings, slotConfirmedZeroBooking],
            page: { nextCursor: null },
          }),
        });
      }
      return route.continue();
    });

    // Mock Class Types API
    await page.route('**/api/v1/class-types*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            { id: 'type-private', code: 'PRV', name: 'Private Group', active: true },
            { id: 'type-group', code: 'GRP', name: 'Group Class', active: true },
          ],
        }),
      }),
    );

    // Mock Assignments API
    await page.route('**/api/v1/assignments*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              id: 'asgn-1',
              branchId: 'branch-surabaya',
              userId: 'inst-dina',
              assignmentType: 'INSTRUCTOR',
              status: 'ACTIVE',
              activeFrom: '2020-01-01',
              user: { displayName: 'Coach Dina' },
            },
            {
              id: 'asgn-2',
              branchId: 'branch-surabaya',
              userId: 'inst-agatha',
              assignmentType: 'INSTRUCTOR',
              status: 'ACTIVE',
              activeFrom: '2020-01-01',
              user: { displayName: 'Coach Agatha' },
            },
            {
              id: 'asgn-3',
              branchId: 'branch-surabaya',
              userId: 'inst-melissa',
              assignmentType: 'INSTRUCTOR',
              status: 'ACTIVE',
              activeFrom: '2020-01-01',
              user: { displayName: 'Coach Melissa' },
            },
          ],
          page: { hasMore: false },
        }),
      }),
    );

    // Mock Studios API
    await page.route('**/api/v1/branches/**/studios*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              id: 'std-1',
              branchId: 'branch-surabaya',
              code: 'STD1',
              name: 'Main Studio',
              active: true,
              rooms: [
                {
                  id: 'rm-1',
                  studioId: 'std-1',
                  code: 'R1',
                  name: 'Tower Room',
                  capacity: 6,
                  active: true,
                },
              ],
            },
          ],
        }),
      }),
    );

    // Mock Bookings API
    await page.route(/\/api\/v1\/bookings\/late-cancellations/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], total: 0 }),
      }),
    );
    await page.route('**/api/v1/bookings*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], total: 0 }),
      }),
    );
  });

  test('UAT 1 (Happy Path): Kelas PUBLISHED 0 booking memiliki tombol Edit kelas & form edit terbuka', async ({
    page,
  }) => {
    await page.goto('/workspace/classes');

    // Tunggu heading Timetable kelas muncul
    await expect(page.getByRole('heading', { name: 'Timetable kelas' })).toBeVisible({
      timeout: 15000,
    });

    // Pastikan kartu slot Private Group di region kalender muncul
    const calendar = page.getByRole('region', { name: 'Kalender kelas tujuh hari' });
    const privateCard = calendar.getByRole('button', { name: /Private Group/ }).first();
    await expect(privateCard).toBeVisible({ timeout: 10000 });
    await privateCard.click();

    // Verifikasi drawer roster terbuka
    const rosterDialog = page.getByRole('dialog');
    await expect(rosterDialog).toBeVisible({ timeout: 5000 });

    // Klik tombol "Atur kelas" untuk membuka drawer pengaturan lengkap
    const manageBtn = rosterDialog.getByRole('button', { name: 'Atur kelas' });
    await expect(manageBtn).toBeVisible();
    await manageBtn.click();

    // Drawer pengaturan detail kelas terbuka
    const drawer = page.getByRole('dialog').last();
    await expect(drawer).toBeVisible({ timeout: 5000 });

    // BUKTI UAT 1: Tombol "Edit kelas" HARUS MUNCUL pada kelas PUBLISHED dengan 0 pesanan
    const editClassBtn = drawer.getByRole('button', { name: 'Edit kelas' });
    await expect(editClassBtn).toBeVisible({ timeout: 5000 });

    // Ambil screenshot bukti tombol Edit kelas muncul di drawer
    await page.screenshot({
      path: path.join(evidenceDir, 'uat-1-tombol-edit-kelas-muncul.png'),
    });

    // Klik tombol "Edit kelas"
    await editClassBtn.click();

    // Form edit harus terbuka
    const form = drawer.getByRole('form', { name: 'Edit draft kelas' });
    await expect(form).toBeVisible();

    // Pastikan pilihan tipe kelas muncul di dalam form
    await expect(drawer.getByRole('combobox', { name: 'Tipe kelas' })).toBeVisible();

    // Ambil screenshot form edit terbuka dengan opsi ganti tipe kelas
    await page.screenshot({
      path: path.join(evidenceDir, 'uat-2-form-edit-tipe-kelas-terbuka.png'),
    });
  });

  test('UAT 2 (NO HAPPY PATH 1): Kelas CONFIRMED dengan pesanan (bookedCount > 0) DIKUNCI (tombol Edit kelas Terkunci)', async ({
    page,
  }) => {
    await page.goto('/workspace/classes');

    await expect(page.getByRole('heading', { name: 'Timetable kelas' })).toBeVisible({
      timeout: 15000,
    });

    // Klik kartu jadwal Group Class di kalender yang sudah ada pesanan (bookedCount === 3)
    const calendar = page.getByRole('region', { name: 'Kalender kelas tujuh hari' });
    const bookedCard = calendar.getByRole('button', { name: /Group Class/ }).first();
    await expect(bookedCard).toBeVisible({ timeout: 10000 });
    await bookedCard.click();

    const rosterDialog = page.getByRole('dialog');
    await expect(rosterDialog).toBeVisible({ timeout: 5000 });

    // Klik "Atur kelas"
    const manageBtn = rosterDialog.getByRole('button', { name: 'Atur kelas' });
    await expect(manageBtn).toBeVisible();
    await manageBtn.click();

    const drawer = page.getByRole('dialog').last();
    await expect(drawer).toBeVisible({ timeout: 5000 });

    // BUKTI UAT 2 (NO HAPPY PATH): Tombol "Edit kelas" biasa TIDAK ADA, melainkan tombol "Edit kelas (Terkunci)" yang disabled!
    const editClassBtn = drawer.getByRole('button', { name: 'Edit kelas', exact: true });
    await expect(editClassBtn).not.toBeVisible();

    const lockedBtn = drawer.getByRole('button', { name: 'Edit kelas (Terkunci)' });
    await expect(lockedBtn).toBeVisible();
    await expect(lockedBtn).toBeDisabled();

    // Verifikasi pesan informatif alasan terkunci
    await expect(drawer.getByText(/3 peserta sudah memesan kelas ini/)).toBeVisible();

    // Namun tombol Ganti instruktur tetap harus ada
    const changeInstructorBtn = drawer.getByRole('button', { name: 'Ganti instruktur' });
    await expect(changeInstructorBtn).toBeVisible();

    // Ambil screenshot bukti penguncian (no happy path)
    await page.screenshot({
      path: path.join(evidenceDir, 'uat-3-no-happy-path-booked-count-terkunci.png'),
    });
  });

  test('UAT 3 (Happy Path Ganti Instruktur): Ganti Instruktur pada kelas PUBLISHED membuka opsi dan memperbarui penugasan', async ({
    page,
  }) => {
    await page.goto('/workspace/classes');

    await expect(page.getByRole('heading', { name: 'Timetable kelas' })).toBeVisible({
      timeout: 15000,
    });

    // Klik kartu Private Group di kalender
    const calendar = page.getByRole('region', { name: 'Kalender kelas tujuh hari' });
    const card = calendar.getByRole('button', { name: /Private Group/ }).first();
    await expect(card).toBeVisible({ timeout: 10000 });
    await card.click();

    const rosterDialog = page.getByRole('dialog');
    await expect(rosterDialog).toBeVisible({ timeout: 5000 });

    // Klik "Atur kelas"
    const manageBtn = rosterDialog.getByRole('button', { name: 'Atur kelas' });
    await expect(manageBtn).toBeVisible();
    await manageBtn.click();

    const drawer = page.getByRole('dialog').last();
    await expect(drawer).toBeVisible({ timeout: 5000 });

    // Tombol "Ganti instruktur" ada
    const changeInstBtn = drawer.getByRole('button', { name: 'Ganti instruktur' });
    await expect(changeInstBtn).toBeVisible();
    // Awalnya disabled karena instruktur belum diubah (masih Coach Dina)
    await expect(changeInstBtn).toBeDisabled();

    // Pilih instruktur baru: Coach Melissa
    const instructorInput = drawer.getByRole('combobox', { name: 'Instruktur' });
    await instructorInput.click();
    await page.getByRole('option', { name: 'Coach Melissa' }).click();

    // Tombol "Ganti instruktur" kini aktif/enabled
    await expect(changeInstBtn).toBeEnabled();

    // Ambil screenshot bukti opsi ganti instruktur aktif
    await page.screenshot({
      path: path.join(evidenceDir, 'uat-4-ganti-instruktur-siap.png'),
    });

    // Klik tombol "Ganti instruktur"
    await changeInstBtn.click();

    // Tunggu aksi selesai dan ambil screenshot hasil perubahan instruktur
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: path.join(evidenceDir, 'uat-5-instruktur-berhasil-diganti.png'),
    });
  });
});
