import { expect, test } from '@playwright/test';
import { captureHelpScreenshot, hideDevelopmentAffordances } from './help-capture-helper';

const VIEWPORTS: Array<'desktop' | 'mobile'> = ['desktop', 'mobile'];

// Fixture Data Fiktif Aman
const MOCK_BRANCHES = [
  {
    id: 'branch-senopati',
    code: 'SEN',
    name: 'Daily Dose Senopati',
    timezone: 'Asia/Jakarta',
    active: true,
    version: 1,
    address: 'Jl. Senopati No. 12, Jakarta Selatan',
    supportWhatsappE164: '+62895329736127',
    publicProfile: {
      area: 'Senopati',
      city: 'Jakarta Selatan',
      address: 'Jl. Senopati No. 12, Jakarta Selatan',
      slug: 'senopati',
      description: 'Studio Reformer Pilates di pusat Jakarta Selatan',
    },
    dependencies: {
      assignments: 4,
      futureClasses: 12,
      packages: 5,
      paymentAccounts: 2,
      classTypes: 3,
      staff: 6,
    },
    auditActivity: [],
  },
  {
    id: 'branch-pik',
    code: 'PIK',
    name: 'Daily Dose PIK Avenue',
    timezone: 'Asia/Jakarta',
    active: true,
    version: 1,
    address: 'Ruko Golf Island Blok A No. 5, PIK, Jakarta Utara',
    supportWhatsappE164: '+62895329736127',
    publicProfile: {
      area: 'PIK',
      city: 'Jakarta Utara',
      address: 'Ruko Golf Island Blok A No. 5, PIK, Jakarta Utara',
      slug: 'pik',
      description: 'Studio Reformer Pilates premium di kawasan Pantai Indah Kapuk',
    },
    dependencies: {
      assignments: 2,
      futureClasses: 8,
      packages: 5,
      paymentAccounts: 2,
      classTypes: 3,
      staff: 4,
    },
    auditActivity: [],
  },
];

const MOCK_PACKAGES = [
  {
    id: 'pkg-intro-10',
    title: 'Intro 10 Sessions Pass',
    description:
      'Paket perkenalan 10 sesi reformer pilates untuk pemula dengan pendampingan intensif.',
    priceIdr: 1850000,
    sessionCount: 10,
    validityDays: 60,
    category: 'INTRODUCTORY',
    classTypes: [{ id: 'ct-flow', code: 'FLOW', name: 'Reformer Flow', active: true }],
  },
  {
    id: 'pkg-unlimited-30',
    title: 'Monthly Unlimited Pilates',
    description: 'Akses tanpa batas seluruh kelas reformer selama 30 hari di cabang terdaftar.',
    priceIdr: 3200000,
    sessionCount: 99,
    validityDays: 30,
    category: 'UNLIMITED',
    classTypes: [{ id: 'ct-flow', code: 'FLOW', name: 'Reformer Flow', active: true }],
  },
];

const MOCK_SESSIONS = {
  customer: {
    id: 'user-cust-001',
    displayName: 'Amanda Member (Fiktif)',
    roles: ['CUSTOMER'],
    branchIds: ['branch-senopati'],
    sessionExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    capabilities: [
      'customer:self',
      'booking:self:read',
      'booking:create',
      'booking:read',
      'purchase:create',
      'attendance:self-checkin',
    ],
    branches: MOCK_BRANCHES,
    preferredBranch: MOCK_BRANCHES[0],
  },
  admin: {
    id: 'user-admin-001',
    displayName: 'Siti Front Desk (Fiktif)',
    roles: ['ADMIN'],
    branchIds: ['branch-senopati'],
    sessionExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    capabilities: [
      'user:read',
      'booking:read',
      'booking:create',
      'booking:reschedule',
      'reschedule:read',
      'attendance:manage',
      'attendance:scan',
      'attendance:manual',
      'purchase:review',
      'payment:review',
      'ledger:read',
      'class-slot:read',
      'class-slot:manage',
    ],
    branches: [MOCK_BRANCHES[0]],
    preferredBranch: MOCK_BRANCHES[0],
  },
  superAdmin: {
    id: 'user-super-001',
    displayName: 'Super Owner (Fiktif)',
    roles: ['SUPER_OWNER'],
    branchIds: ['branch-senopati', 'branch-pik'],
    sessionExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    capabilities: [
      'user:admin',
      'user:read',
      'role:assign',
      'branch:admin',
      'master:read',
      'master:manage',
      'audit:read',
      'identity-verification:read',
      'identity-verification:decide',
      'system:health',
      'operations:read',
      'operations:admin',
      'notification:manage',
      'notification:admin',
      'public-content:read',
      'public-content:admin',
    ],
    branches: MOCK_BRANCHES,
    preferredBranch: MOCK_BRANCHES[0],
  },
};

test.beforeEach(async ({ page }) => {
  await hideDevelopmentAffordances(page);

  // Inisialisasi cabang aktif agar seluruh layar staf langsung membuka cabang Senopati
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem('dd_active_branch', 'branch-senopati');
    } catch {}
  });

  // Default routes dasar
  await page.route('**/api/v1/public/site-config', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        brandName: 'Daily Dose Pilates',
        supportWhatsappE164: '+62895329736127',
        fallbackWhatsappE164: '+62895329736127',
        supportEmail: 'halo@dailydosepilates.id',
        defaultBranchCode: 'SEN',
        branches: MOCK_BRANCHES,
      }),
    }),
  );

  await page.route('**/api/v1/branches**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: MOCK_BRANCHES,
        summary: { total: MOCK_BRANCHES.length, active: MOCK_BRANCHES.length },
        page: { nextCursor: null, hasMore: false },
      }),
    }),
  );

  await page.route('**/api/v1/public/package-catalog**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: MOCK_PACKAGES }),
    }),
  );

  await page.route('**/api/v1/me/notifications**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], count: 0 }),
    }),
  );

  await page.route('**/api/v1/queue-counts**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ counts: { bookings: 2, payments: 1, verifications: 1 } }),
    }),
  );

  await page.route('**/api/v1/me/profile', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'user-cust-001',
        displayName: 'Amanda Member (Fiktif)',
        email: 'amanda.member@dailydose.test',
        phoneE164: '+6281200000001',
        preferredBranchId: 'branch-senopati',
        version: 1,
      }),
    }),
  );

  await page.route('**/api/v1/auth/security', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        passwordEnabled: true,
        hasPassword: true,
        passwordChangedAt: '2026-10-01T12:00:00Z',
      }),
    }),
  );

  await page.route('**/api/v1/identity-verification/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'APPROVED',
        rejectionReason: null,
      }),
    }),
  );

  await page.route('**/api/v1/me/check-in-pass', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ pass: 'dd-pass:v1:STATIC-MEMBER-PASS-12345' }),
    }),
  );

  await page.route('**/api/v1/me/dashboard', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        upcomingBookings: [
          {
            id: 'bkg-demo-01',
            status: 'BOOKED',
            classTitle: 'Reformer Flow Level 1',
            branchName: 'Daily Dose Senopati',
            startAt: new Date(Date.now() + 3600000 * 24).toISOString(),
          },
        ],
      }),
    }),
  );

  await page.route('**/api/v1/lookups/customers**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          {
            id: 'user-cust-001',
            label: 'Amanda Member (Fiktif)',
            description: '0812-****-0001',
            metadata: { eligiblePackageCount: 1 },
          },
        ],
      }),
    }),
  );

  await page.route('**/api/v1/reschedules**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [],
        page: { nextCursor: null },
        summary: { pending: 0 },
      }),
    }),
  );
});

// Helper untuk set session peran
async function mockSession(page: any, role: 'customer' | 'admin' | 'superAdmin') {
  await page.addInitScript((activeBranch: string) => {
    try {
      sessionStorage.setItem('dd_active_branch', activeBranch);
    } catch {}
  }, 'branch-senopati');

  await page.route('**/api/v1/me', (route: any) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_SESSIONS[role]),
    }),
  );
}

// ==========================================
// 1. AUDIENS CUSTOMER
// ==========================================
test.describe('Customer Help Screenshots', () => {
  for (const vp of VIEWPORTS) {
    test(`C1a: Form Registrasi [${vp}]`, async ({ page }) => {
      await page.route('**/api/v1/me', (route) => route.fulfill({ status: 401 }));
      await page.goto('/register', { waitUntil: 'domcontentloaded' });
      await captureHelpScreenshot(page, {
        category: 'customer',
        name: 'c01-register-form',
        viewport: vp,
      });
    });

    test(`C1b: Aktivasi Akun [${vp}]`, async ({ page }) => {
      await page.route('**/api/v1/me', (route) => route.fulfill({ status: 401 }));
      await page.goto('/activate-account?email=amanda.member@dailydose.test', {
        waitUntil: 'domcontentloaded',
      });
      await captureHelpScreenshot(page, {
        category: 'customer',
        name: 'c01-activate-account',
        viewport: vp,
      });
    });

    test(`C2a: Login Form [${vp}]`, async ({ page }) => {
      await page.route('**/api/v1/me', (route) => route.fulfill({ status: 401 }));
      await page.goto('/sign-in', { waitUntil: 'domcontentloaded' });
      await captureHelpScreenshot(page, {
        category: 'customer',
        name: 'c02-sign-in-form',
        viewport: vp,
      });
    });

    test(`C2b: Login Error Validasi [${vp}]`, async ({ page }) => {
      await page.route('**/api/v1/me', (route) => route.fulfill({ status: 401 }));
      await page.goto('/sign-in', { waitUntil: 'domcontentloaded' });

      const emailInput = page.locator('input[name="email"]');
      const passwordInput = page.locator('input[name="password"]');
      const submitBtn = page.getByRole('button', { name: /masuk ke akun/i });

      await emailInput.fill('salah@dailydose.test');
      await passwordInput.fill('SalahPassword123');

      await page.route('**/api/v1/auth/password/sessions', (route) =>
        route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Email, username/nomor WhatsApp, atau password tidak valid.',
          }),
        }),
      );

      await submitBtn.click();
      await expect(
        page.getByText('Email, username/nomor WhatsApp, atau password tidak valid.'),
      ).toBeVisible({ timeout: 10_000 });
      await captureHelpScreenshot(page, {
        category: 'customer',
        name: 'c02-sign-in-error',
        viewport: vp,
      });
    });

    test(`C3a: Lupa Password [${vp}]`, async ({ page }) => {
      await page.route('**/api/v1/me', (route) => route.fulfill({ status: 401 }));
      await page.goto('/forgot-password', { waitUntil: 'domcontentloaded' });
      await captureHelpScreenshot(page, {
        category: 'customer',
        name: 'c03-forgot-password-form',
        viewport: vp,
      });
    });

    test(`C3b: Reset Password Form [${vp}]`, async ({ page }) => {
      await page.route('**/api/v1/me', (route) => route.fulfill({ status: 401 }));
      await page.goto('/reset-password?token=dummy-reset-token-123', {
        waitUntil: 'domcontentloaded',
      });
      await captureHelpScreenshot(page, {
        category: 'customer',
        name: 'c03-reset-password-form',
        viewport: vp,
      });
    });

    test(`C4: Verifikasi Identitas (Selfie/KTP) [${vp}]`, async ({ page }) => {
      await mockSession(page, 'customer');
      await page.route('**/api/v1/identity-verification/me', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'PENDING',
            documents: [{ kind: 'SELFIE', status: 'PENDING', rejectionReason: null }],
          }),
        }),
      );

      await page.goto('/account/verification', { waitUntil: 'domcontentloaded' });
      await captureHelpScreenshot(page, {
        category: 'customer',
        name: 'c04-identity-verification',
        viewport: vp,
      });
    });

    test(`C5: Memilih Studio Cabang [${vp}]`, async ({ page }) => {
      await page.goto('/locations', { waitUntil: 'domcontentloaded' });
      await captureHelpScreenshot(page, {
        category: 'customer',
        name: 'c05-locations-catalog',
        viewport: vp,
      });
    });

    test(`C6a: Katalog Paket [${vp}]`, async ({ page }) => {
      await mockSession(page, 'customer');
      await page.goto('/packages', { waitUntil: 'domcontentloaded' });
      await captureHelpScreenshot(page, {
        category: 'customer',
        name: 'c06-packages-catalog',
        viewport: vp,
      });
    });

    test(`C6b: Checkout & Bukti Transfer [${vp}]`, async ({ page }) => {
      await mockSession(page, 'customer');
      await page.route('**/api/v1/checkout/options**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            package: {
              ...MOCK_PACKAGES[0],
              classTypes: [{ id: 'ct-flow', code: 'FLOW', name: 'Reformer Flow', active: true }],
            },
            branches: MOCK_BRANCHES,
            selectedBranch: MOCK_BRANCHES[0],
            paymentMethods: [
              {
                id: 'pay-bca',
                type: 'BANK_TRANSFER',
                bankName: 'BCA',
                accountNumber: '1234567890',
                accountName: 'PT Daily Dose Pilates Indonesia',
              },
            ],
            priceSummary: {
              subtotalIdr: 1850000,
              discountIdr: 0,
              totalIdr: 1850000,
            },
          }),
        }),
      );

      await page.goto('/checkout?package=pkg-intro-10', { waitUntil: 'domcontentloaded' });
      await captureHelpScreenshot(page, {
        category: 'customer',
        name: 'c06-checkout-instructions',
        viewport: vp,
      });
    });

    test(`C7a: Jadwal Kelas [${vp}]`, async ({ page }) => {
      await mockSession(page, 'customer');
      await page.route('**/api/v1/public/class-catalog**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [
              {
                id: 'slot-01',
                title: 'Reformer Flow Level 1',
                studio: 'Daily Dose Senopati',
                instructor: 'Coach Sarah (Fiktif)',
                startAt: new Date(Date.now() + 3600000 * 24).toISOString(),
                endAt: new Date(Date.now() + 3600000 * 25).toISOString(),
                capacity: 8,
                booked: 4,
                status: 'SCHEDULED',
              },
            ],
          }),
        }),
      );

      await page.goto('/classes', { waitUntil: 'domcontentloaded' });
      await captureHelpScreenshot(page, {
        category: 'customer',
        name: 'c07-classes-schedule',
        viewport: vp,
      });
    });

    test(`C7b: Booking Member [${vp}]`, async ({ page }) => {
      await mockSession(page, 'customer');
      await page.route('**/api/v1/bookings**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [
              {
                id: 'bkg-demo-01',
                status: 'BOOKED',
                classTitle: 'Reformer Flow Level 1',
                branchName: 'Daily Dose Senopati',
                startAt: new Date(Date.now() + 3600000 * 24).toISOString(),
                endAt: new Date(Date.now() + 3600000 * 25).toISOString(),
                instructorName: 'Coach Sarah (Fiktif)',
              },
            ],
            summary: { total: 1, booked: 1, attended: 0, cancelled: 0 },
            page: { hasMore: false, nextCursor: null },
          }),
        }),
      );
      await page.goto('/bookings', { waitUntil: 'domcontentloaded' });
      await captureHelpScreenshot(page, {
        category: 'customer',
        name: 'c07-my-bookings',
        viewport: vp,
      });
    });

    test(`C8: QR Check-in Pass [${vp}]`, async ({ page }) => {
      await mockSession(page, 'customer');
      await page.route('**/api/v1/bookings/**/customer-check-in-links', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            qrPayload: 'dd-checkin:v1:DD-QR-SECURE-TOKEN-12345',
            className: 'Reformer Flow Level 1',
            branchName: 'Daily Dose Senopati',
            instructorName: 'Coach Sarah (Fiktif)',
            startAt: new Date(Date.now() + 15 * 60000).toISOString(),
            endAt: new Date(Date.now() + 75 * 60000).toISOString(),
            timezone: 'Asia/Jakarta',
          }),
        }),
      );

      await page.goto('/check-in-pass?bookingId=bkg-demo-01', { waitUntil: 'domcontentloaded' });
      await captureHelpScreenshot(page, {
        category: 'customer',
        name: 'c08-qr-check-in-open',
        viewport: vp,
      });
    });

    test(`C9: Sisa Sesi & Paket Aktif [${vp}]`, async ({ page }) => {
      await mockSession(page, 'customer');
      await page.route('**/api/v1/me/packages**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [
              {
                id: 'cpkg-001',
                packageTitle: 'Intro 10 Sessions Pass',
                totalSessions: 10,
                remainingSessions: 7,
                usedSessions: 3,
                expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
                status: 'ACTIVE',
              },
            ],
            summary: { activeCount: 1, totalRemaining: 7 },
          }),
        }),
      );

      await page.goto('/account/packages', { waitUntil: 'domcontentloaded' });
      await captureHelpScreenshot(page, {
        category: 'customer',
        name: 'c09-account-packages',
        viewport: vp,
      });
    });

    test(`C10a: Profil Akun [${vp}]`, async ({ page }) => {
      await mockSession(page, 'customer');
      await page.goto('/account/profile', { waitUntil: 'domcontentloaded' });
      await captureHelpScreenshot(page, {
        category: 'customer',
        name: 'c10-account-profile',
        viewport: vp,
      });
    });

    test(`C10b: Keamanan Akun & Password [${vp}]`, async ({ page }) => {
      await mockSession(page, 'customer');
      await page.goto('/account/security', { waitUntil: 'domcontentloaded' });
      await captureHelpScreenshot(page, {
        category: 'customer',
        name: 'c10-account-security',
        viewport: vp,
      });
    });
  }
});

// ==========================================
// 2. AUDIENS ADMIN
// ==========================================
test.describe('Admin Help Screenshots', () => {
  for (const vp of VIEWPORTS) {
    test(`A1a: Assisted Bookings [${vp}]`, async ({ page }) => {
      await mockSession(page, 'admin');

      await page.route('**/api/v1/bookings**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [
              {
                id: 'bkg-staff-01',
                status: 'BOOKED',
                customer: {
                  id: 'user-cust-001',
                  displayName: 'Amanda Member (Fiktif)',
                  phoneMasked: '0812-****-0001',
                },
                classSlot: {
                  id: 'slot-today-01',
                  title: 'Reformer Flow Level 1',
                  startAt: new Date(Date.now() + 3600000 * 2).toISOString(),
                  endAt: new Date(Date.now() + 3600000 * 3).toISOString(),
                  studioName: 'Daily Dose Senopati',
                  branchName: 'Daily Dose Senopati',
                },
                packageNameSnapshot: 'Intro 10 Sessions Pass',
                createdAt: new Date().toISOString(),
              },
            ],
            summary: { total: 1, booked: 1, attended: 0, cancelled: 0 },
            page: { hasMore: false, nextCursor: null },
          }),
        }),
      );

      await page.route('**/api/v1/class-slots**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [
              {
                id: 'slot-today-01',
                title: 'Reformer Flow Level 1',
                branchId: 'branch-senopati',
                startAt: new Date(Date.now() + 3600000 * 2).toISOString(),
                endAt: new Date(Date.now() + 3600000 * 3).toISOString(),
                capacity: 8,
                bookedCount: 6,
                instructor: { displayName: 'Coach Sarah (Fiktif)' },
              },
            ],
            page: { hasMore: false, nextCursor: null },
          }),
        }),
      );

      await page.goto('/workspace/bookings?branch=branch-senopati', {
        waitUntil: 'domcontentloaded',
      });
      await captureHelpScreenshot(page, {
        category: 'admin',
        name: 'a01-assisted-bookings',
        viewport: vp,
      });
    });

    test(`A1b: Antrean Reschedule [${vp}]`, async ({ page }) => {
      await mockSession(page, 'admin');
      await page.route('**/api/v1/work-queue/overdue**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            dibuatPada: new Date().toISOString(),
            items: [
              {
                key: 'ubahJadwal',
                jumlah: 2,
                nada: 'MENUNGGU',
                acuanPada: new Date().toISOString(),
                umurJam: 1,
                href: '/workspace/bookings?tab=reschedules',
              },
              {
                key: 'bukti',
                jumlah: 1,
                nada: 'TENGGAT',
                acuanPada: new Date().toISOString(),
                umurJam: 2,
                nilaiRp: 1850000,
                href: '/workspace/payments',
              },
            ],
            gagal: [],
          }),
        }),
      );

      await page.goto('/workspace/antrean', { waitUntil: 'domcontentloaded' });
      await captureHelpScreenshot(page, {
        category: 'admin',
        name: 'a01-reschedule-queue',
        viewport: vp,
      });
    });

    test(`A2: Timetable Kelas Studio [${vp}]`, async ({ page }) => {
      await mockSession(page, 'admin');

      await page.route('**/api/v1/class-slots**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [
              {
                id: 'slot-tt-01',
                branchId: 'branch-senopati',
                classTypeId: 'ct-flow',
                studioId: 'studio-01',
                roomId: 'room-01',
                instructorUserId: 'inst-01',
                title: 'Reformer Flow Level 1',
                startAt: new Date(Date.now() + 3600000 * 2).toISOString(),
                endAt: new Date(Date.now() + 3600000 * 3).toISOString(),
                timezone: 'Asia/Jakarta',
                status: 'PUBLISHED',
                minimumQuota: 3,
                capacity: 8,
                bookedCount: 5,
                version: 1,
              },
            ],
            page: { hasMore: false, nextCursor: null },
          }),
        }),
      );

      await page.route('**/api/v1/class-types**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [
              {
                id: 'ct-flow',
                branchId: 'branch-senopati',
                code: 'FLOW',
                name: 'Reformer Flow',
                active: true,
              },
            ],
          }),
        }),
      );

      await page.route('**/api/v1/branches/**/studios', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [
              {
                id: 'studio-01',
                branchId: 'branch-senopati',
                code: 'ST-SEN',
                name: 'Daily Dose Senopati Studio',
                active: true,
                rooms: [
                  {
                    id: 'room-01',
                    studioId: 'studio-01',
                    code: 'R1',
                    name: 'Studio Reformer Utama',
                    capacity: 8,
                    active: true,
                  },
                ],
              },
            ],
          }),
        }),
      );

      await page.route('**/api/v1/rooms**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [{ id: 'room-01', code: 'R1', name: 'Studio Reformer Utama' }],
          }),
        }),
      );

      await page.route('**/api/v1/assignments**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [
              {
                id: 'asgn-01',
                branchId: 'branch-senopati',
                instructorUserId: 'inst-01',
                instructor: { id: 'inst-01', displayName: 'Coach Sarah (Fiktif)' },
              },
            ],
          }),
        }),
      );

      await page.goto('/workspace/classes?branch=branch-senopati', {
        waitUntil: 'domcontentloaded',
      });
      await captureHelpScreenshot(page, {
        category: 'admin',
        name: 'a02-classes-timetable',
        viewport: vp,
      });
    });

    test(`A3: Pemeriksaan Pembayaran [${vp}]`, async ({ page }) => {
      await mockSession(page, 'admin');
      const mockPurchases = {
        items: [
          {
            id: 'pay-001',
            version: 1,
            status: 'SUBMITTED',
            customer: {
              id: 'user-cust-001',
              displayName: 'Amanda Member (Fiktif)',
              email: 'amanda.member@dailydose.test',
              phoneMasked: '0812-****-0001',
            },
            branch: {
              id: 'branch-senopati',
              name: 'Daily Dose Senopati',
              code: 'SEN',
            },
            packageNameSnapshot: 'Intro 10 Sessions Pass',
            sessionCountSnapshot: 10,
            durationDaysSnapshot: 60,
            priceRpSnapshot: 1850000,
            payableAmountRpSnapshot: 1850000,
            paymentMethod: 'MANUAL_TRANSFER',
            submittedAt: new Date(Date.now() - 3600000).toISOString(),
            paymentProof: {
              id: 'proof-001',
              scanStatus: 'CLEAN',
              mimeType: 'image/png',
              fileName: 'bukti-transfer-bca.png',
              sizeBytes: 102400,
              finalizedAt: new Date(Date.now() - 3600000).toISOString(),
            },
            activationSummary: {
              status: 'INACTIVE',
              activationDate: new Date().toISOString(),
              expiryAt: new Date(Date.now() + 60 * 86400000).toISOString(),
            },
          },
        ],
        summary: { pending: 1, approved: 12, rejected: 1, total: 14 },
        total: 1,
        totalPages: 1,
        currentPage: 1,
        pageSize: 20,
        page: {
          hasMore: false,
          nextCursor: null,
          current: 1,
          total: 1,
          totalPages: 1,
          pageSize: 20,
        },
        generatedAt: new Date().toISOString(),
      };

      await page.route('**/api/v1/purchases**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockPurchases),
        }),
      );
      await page.route('**/api/v1/payments**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockPurchases),
        }),
      );

      await page.goto('/workspace/payments', { waitUntil: 'domcontentloaded' });
      await captureHelpScreenshot(page, {
        category: 'admin',
        name: 'a03-payments-queue',
        viewport: vp,
      });
    });

    test(`A4: Scan Check-in Front Desk [${vp}]`, async ({ page }) => {
      await mockSession(page, 'admin');
      await page.route('**/api/v1/attendance/desk**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            branchId: 'branch-senopati',
            namaCabang: 'Daily Dose Senopati',
            timezone: 'Asia/Jakarta',
            tanggal: new Date().toISOString().slice(0, 10),
            kelas: [
              {
                id: 'slot-01',
                startAt: new Date(Date.now() + 1800000).toISOString(),
                endAt: new Date(Date.now() + 5400000).toISOString(),
                namaKelas: 'Reformer Flow Level 1',
                namaStudio: 'Studio Senopati',
                namaInstruktur: 'Coach Sarah (Fiktif)',
                status: 'RUNNING',
                version: 1,
                kapasitas: 8,
                terdaftar: 6,
                hadir: 4,
                kuota: {
                  status: 'TERPENUHI',
                  hadir: 4,
                  minimum: 3,
                  kurang: 0,
                  menitTersisa: 0,
                  perluKeputusan: false,
                },
                keputusan: null,
                berjalan: true,
                perluDitutup: false,
              },
            ],
            tercatat: [
              {
                id: 'att-001',
                jenis: 'MEMBER',
                nama: 'Amanda Member (Fiktif)',
                fotoUrl: null,
                namaKelas: 'Reformer Flow Level 1',
                mulaiKelas: new Date(Date.now() + 1800000).toISOString(),
                selesaiKelas: new Date(Date.now() + 5400000).toISOString(),
                namaStudio: 'Studio Senopati',
                tercatatPada: new Date().toISOString(),
                manual: false,
                dicatatOleh: null,
              },
            ],
          }),
        }),
      );
      await page.route('**/api/v1/attendance/no-shows**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ rows: [] }),
        }),
      );

      await page.goto('/workspace/check-in?branch=branch-senopati', {
        waitUntil: 'domcontentloaded',
      });
      await captureHelpScreenshot(page, {
        category: 'admin',
        name: 'a04-scan-check-in-desk',
        viewport: vp,
      });
    });

    test(`A5: Ledger & Penyesuaian Sesi [${vp}]`, async ({ page }) => {
      await mockSession(page, 'admin');
      await page.route('**/api/v1/customer-packages**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [
              {
                id: 'cpkg-01',
                customerUserId: 'user-cust-001',
                customer: {
                  id: 'user-cust-001',
                  displayName: 'Amanda Member (Fiktif)',
                  phoneMasked: '0812-****-0001',
                },
                packageName: 'Intro 10 Sessions Pass',
                branchName: 'Daily Dose Senopati',
                classTypeName: 'Reformer Flow',
                available: 7,
                ledgerBalance: 7,
                reserved: 0,
                sessionCountSnapshot: 10,
                status: 'ACTIVE',
                activationDate: new Date(Date.now() - 5 * 86400000).toISOString(),
                expiryAt: new Date(Date.now() + 25 * 86400000).toISOString(),
                isMultiBranch: false,
                allowedBranchIds: ['branch-senopati'],
              },
            ],
            summary: {
              totalActivePackages: 1,
              totalRemainingSessions: 7,
              expiringThisMonth: 0,
              customersWithPackages: 1,
            },
            total: 1,
            totalPages: 1,
            currentPage: 1,
            pageSize: 20,
            page: {
              hasMore: false,
              nextCursor: null,
              total: 1,
              totalPages: 1,
              current: 1,
              pageSize: 20,
            },
          }),
        }),
      );

      await page.goto('/ledger', { waitUntil: 'domcontentloaded' });
      await captureHelpScreenshot(page, {
        category: 'admin',
        name: 'a05-ledger-overview',
        viewport: vp,
      });
    });

    test(`A6: Manajemen Pengguna Terscope [${vp}]`, async ({ page }) => {
      await mockSession(page, 'admin');
      await page.route('**/api/v1/users**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [
              {
                id: 'u-admin-01',
                displayName: 'Siti Front Desk (Fiktif)',
                email: 'siti.frontdesk@dailydose.test',
                phoneE164: '+6281200000001',
                status: 'ACTIVE',
                roles: [{ role: 'ADMIN', branch: { name: 'Senopati' } }],
              },
            ],
            summary: { total: 1, active: 1, inactive: 0 },
            page: { hasMore: false, nextCursor: null },
          }),
        }),
      );

      await page.goto('/users', { waitUntil: 'domcontentloaded' });
      await captureHelpScreenshot(page, {
        category: 'admin',
        name: 'a06-scoped-users-list',
        viewport: vp,
      });
    });

    test(`A7: Ringkasan Workspace Cabang [${vp}]`, async ({ page }) => {
      await mockSession(page, 'admin');

      await page.route('**/api/v1/class-slots**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [
              {
                id: 'slot-today-01',
                title: 'Reformer Flow Level 1',
                branchId: 'branch-senopati',
                startAt: new Date(Date.now() + 3600000 * 2).toISOString(),
                endAt: new Date(Date.now() + 3600000 * 3).toISOString(),
                capacity: 8,
                bookedCount: 6,
                instructor: { displayName: 'Coach Sarah (Fiktif)' },
              },
            ],
            page: { hasMore: false, nextCursor: null },
          }),
        }),
      );

      await page.route('**/api/v1/branches/**/studios', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [
              {
                id: 'studio-01',
                branchId: 'branch-senopati',
                code: 'ST-SEN',
                name: 'Daily Dose Senopati Studio',
                active: true,
                rooms: [
                  {
                    id: 'room-01',
                    studioId: 'studio-01',
                    code: 'R1',
                    name: 'Studio Reformer Utama',
                    capacity: 8,
                    active: true,
                  },
                ],
              },
            ],
          }),
        }),
      );

      await page.route('**/api/v1/dashboard/overview**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            generatedAt: new Date().toISOString(),
            period: {
              from: new Date().toISOString().slice(0, 10),
              until: new Date().toISOString().slice(0, 10),
            },
            financial: {
              grossSalesRp: 18500000,
              netRevenueRp: 18500000,
              grossProfitRp: 12500000,
              netOperatingProfitRp: 9500000,
            },
            views: { finance: true, operations: true },
            sections: { trend: true, queue: true, risk: false, branchComparison: true },
            metrics: [
              {
                key: 'active_members',
                label: 'Member Aktif',
                value: 142,
                unit: 'COUNT',
                changePercent: 5.2,
              },
              {
                key: 'today_bookings',
                label: 'Booking Hari Ini',
                value: 28,
                unit: 'COUNT',
                changePercent: 12.0,
              },
              {
                key: 'occupancy_rate',
                label: 'Okupansi Studio',
                value: 85,
                unit: '%',
                changePercent: 3.5,
              },
            ],
            queues: [
              {
                key: 'pending_payments',
                label: 'Verifikasi Pembayaran',
                count: 1,
                href: '/workspace/payments',
              },
              {
                key: 'reschedules',
                label: 'Antrean Ubah Jadwal',
                count: 2,
                href: '/workspace/bookings?tab=reschedules',
              },
            ],
            trend: [
              { date: new Date().toISOString(), revenue: 5500000, profit: 3200000, bookings: 12 },
            ],
            branches: [
              {
                id: 'branch-senopati',
                code: 'SEN',
                name: 'Senopati',
                bookingsCount: 18,
                revenueIdr: 12000000,
              },
            ],
            risks: [],
          }),
        }),
      );

      await page.route('**/api/v1/attendance/owner-exceptions**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: [], summary: {} }),
        }),
      );

      await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
      await captureHelpScreenshot(page, {
        category: 'admin',
        name: 'a07-workspace-dashboard',
        viewport: vp,
      });
    });
  }
});

// ==========================================
// 3. AUDIENS SUPER ADMIN
// ==========================================
test.describe('Super Admin Help Screenshots', () => {
  for (const vp of VIEWPORTS) {
    test(`S1: User, Role & Permissions Matrix [${vp}]`, async ({ page }) => {
      await mockSession(page, 'superAdmin');
      await page.route('**/api/v1/access/roles**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [
              {
                id: 'role-admin',
                code: 'ADMIN',
                displayName: 'Front Desk Admin',
                description: 'Akses operasional kasir, check-in, dan booking',
                scope: 'BRANCH',
                system: true,
                systemRole: 'ADMIN',
                active: true,
                capabilities: [
                  { key: 'booking:read', category: 'BOOKING' },
                  { key: 'attendance:scan', category: 'ATTENDANCE' },
                ],
              },
              {
                id: 'role-manager',
                code: 'MANAGER',
                displayName: 'Studio Manager',
                description: 'Supervisi studio, jadwal kelas, dan approval kasir',
                scope: 'BRANCH',
                system: true,
                systemRole: 'MANAGER',
                active: true,
                capabilities: [
                  { key: 'payment:review', category: 'FINANCE' },
                  { key: 'class-slot:manage', category: 'CLASS' },
                ],
              },
            ],
          }),
        }),
      );
      await page.route('**/api/v1/access/capabilities**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [
              { key: 'booking:read', category: 'BOOKING', label: 'Melihat Daftar Booking' },
              { key: 'attendance:scan', category: 'ATTENDANCE', label: 'Scan Check-in Barcode' },
              { key: 'payment:review', category: 'FINANCE', label: 'Verifikasi Pembayaran' },
              { key: 'class-slot:manage', category: 'CLASS', label: 'Mengatur Jadwal Kelas' },
            ],
          }),
        }),
      );

      await page.goto('/users/roles-permissions', { waitUntil: 'domcontentloaded' });
      await captureHelpScreenshot(page, {
        category: 'super-admin',
        name: 's01-roles-permissions-matrix',
        viewport: vp,
      });
    });

    test(`S2: Verifikasi Identitas Nasional [${vp}]`, async ({ page }) => {
      await mockSession(page, 'superAdmin');
      await page.route('**/api/v1/identity-verifications**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [
              {
                id: 'k-case-01',
                user: {
                  id: 'user-cust-001',
                  displayName: 'Amanda Member (Fiktif)',
                  phoneMasked: '0812-****-0001',
                  status: 'ACTIVE',
                },
                verificationStatus: 'PENDING',
                oldestAt: new Date(Date.now() - 3600000).toISOString(),
                documents: [
                  {
                    id: 'doc-01',
                    kind: 'SELFIE',
                    status: 'PENDING',
                    version: 1,
                    rejectionReasonCode: null,
                    rejectionNote: null,
                    reviewedAt: null,
                    deletedAt: null,
                    createdAt: new Date(Date.now() - 3600000).toISOString(),
                  },
                ],
              },
            ],
            summary: {
              totalCustomers: 1,
              totalDocuments: 1,
              pendingDocuments: 1,
              approvedDocuments: 45,
              rejectedDocuments: 2,
              deletionIssues: 0,
              pendingCustomers: 1,
              approvedCustomers: 45,
            },
            page: {
              hasMore: false,
              nextCursor: null,
              currentPage: 1,
              totalPages: 1,
              totalCount: 1,
            },
            generatedAt: new Date().toISOString(),
          }),
        }),
      );

      await page.goto('/identity-verifications', { waitUntil: 'domcontentloaded' });
      await captureHelpScreenshot(page, {
        category: 'super-admin',
        name: 's02-identity-verifications-queue',
        viewport: vp,
      });
    });

    test(`S3: Manajemen Cabang & Rekening Pembayaran [${vp}]`, async ({ page }) => {
      await mockSession(page, 'superAdmin');
      await page.goto('/workspace/branches', { waitUntil: 'domcontentloaded' });
      await captureHelpScreenshot(page, {
        category: 'super-admin',
        name: 's03-branches-master',
        viewport: vp,
      });
    });

    test(`S4: Audit Trail Log Sistem [${vp}]`, async ({ page }) => {
      await mockSession(page, 'superAdmin');
      const mockAudit = {
        items: [
          {
            id: 'aud-001',
            occurredAt: new Date().toISOString(),
            action: 'payment.decide',
            objectType: 'Payment',
            actor: { displayName: 'Finance Lead (Fiktif)' },
            target: { displayName: 'Amanda Member (Fiktif)' },
            branch: { name: 'Daily Dose Senopati' },
            details: 'Pembayaran disetujui (Rp 1.850.000)',
          },
        ],
        page: { hasMore: false, nextCursor: null },
      };

      await page.route('**/api/v1/audit-logs**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockAudit),
        }),
      );
      await page.route('**/api/v1/audit**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockAudit),
        }),
      );

      await page.goto('/audit', { waitUntil: 'domcontentloaded' });
      await captureHelpScreenshot(page, {
        category: 'super-admin',
        name: 's04-audit-trail',
        viewport: vp,
      });
    });

    test(`S5: Pengaturan Konten Publik & Hero [${vp}]`, async ({ page }) => {
      await mockSession(page, 'superAdmin');
      await page.route('**/api/v1/public-content-management**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: 'content-hero-01',
              contentKey: 'HOME_HERO_CAROUSEL',
              locale: 'en-US',
              version: 1,
              payload: {
                autoplay: true,
                intervalMs: 6000,
                slides: [
                  {
                    id: 'slide-1',
                    title: 'Welcome to Daily Dose Pilates',
                    subtitle: 'Discover strength, balance, and mindful movement',
                    ctaText: 'Lihat Jadwal Kelas',
                    ctaLink: '/classes',
                    imageUrl: '/images/public/hero-placeholder.jpg',
                  },
                ],
              },
            },
          ]),
        }),
      );

      await page.goto('/public-content-management', { waitUntil: 'domcontentloaded' });
      await captureHelpScreenshot(page, {
        category: 'super-admin',
        name: 's05-public-content-management',
        viewport: vp,
      });
    });

    test(`S6: Broadcast Notifikasi Massal [${vp}]`, async ({ page }) => {
      await mockSession(page, 'superAdmin');
      await page.route('**/api/v1/notification-management**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            catalog: [
              {
                templateKey: 'BOOKING_CONFIRMATION',
                label: 'Konfirmasi Booking Kelas',
                description: 'Dikirim ke member sesaat setelah booking kelas reformer terkonfirmasi.',
                channel: 'WHATSAPP',
                variables: ['nama', 'nama_kelas', 'waktu_mulai', 'nama_studio'],
                defaultBody:
                  'Halo {{nama}}, booking kelas {{nama_kelas}} pada {{waktu_mulai}} di {{nama_studio}} berhasil terkonfirmasi.',
              },
            ],
            templates: [],
            deliveries: [],
            metrics: { DELIVERED: 142, FAILED: 0 },
          }),
        }),
      );

      await page.goto('/notification-management', { waitUntil: 'domcontentloaded' });
      await captureHelpScreenshot(page, {
        category: 'super-admin',
        name: 's06-notification-management',
        viewport: vp,
      });
    });

    test(`S7: Operasi & Diagnostic Health [${vp}]`, async ({ page }) => {
      await mockSession(page, 'superAdmin');
      await page.route('**/api/v1/operations/health**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'READY',
            checkedAt: new Date().toISOString(),
            dependencies: [
              { name: 'api', status: 'READY', detailCode: null },
              { name: 'database', status: 'READY', detailCode: null },
              { name: 'scheduler', status: 'READY', detailCode: null },
              { name: 'private-storage', status: 'READY', detailCode: null },
              { name: 'payment-proof-scanner', status: 'READY', detailCode: null },
            ],
          }),
        }),
      );

      await page.goto('/health', { waitUntil: 'domcontentloaded' });
      await captureHelpScreenshot(page, {
        category: 'super-admin',
        name: 's07-system-health',
        viewport: vp,
      });
    });
  }
});

// ==========================================
// 4. KONDISI UMUM & SISTEM (COMMON)
// ==========================================
test.describe('Common System Help Screenshots', () => {
  for (const vp of VIEWPORTS) {
    test(`G1: Akses Terbatas / 403 Forbidden [${vp}]`, async ({ page }) => {
      await mockSession(page, 'customer');
      await page.goto('/workspace/branches', { waitUntil: 'domcontentloaded' });
      await captureHelpScreenshot(page, {
        category: 'common',
        name: 'g01-forbidden-access',
        viewport: vp,
      });
    });

    test(`G2a: Halaman Pusat Bantuan Customer [${vp}]`, async ({ page }) => {
      await page.goto('/help?role=customer', { waitUntil: 'domcontentloaded' });
      await captureHelpScreenshot(page, {
        category: 'common',
        name: 'g02-help-center-customer',
        viewport: vp,
      });
    });

    test(`G2b: Halaman Pusat Bantuan Admin [${vp}]`, async ({ page }) => {
      await page.goto('/help?role=admin', { waitUntil: 'domcontentloaded' });
      await captureHelpScreenshot(page, {
        category: 'common',
        name: 'g02-help-center-admin',
        viewport: vp,
      });
    });
  }
});
