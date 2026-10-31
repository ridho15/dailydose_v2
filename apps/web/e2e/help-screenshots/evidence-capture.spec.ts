import { expect, test } from '@playwright/test';
import { hideDevelopmentAffordances } from './help-capture-helper';
import { resolve } from 'node:path';

const ARTIFACT_DIR = '/Users/lrmcorporation/.gemini/antigravity/brain/1da81b46-643f-48f6-9b07-dd0582dfaa64';

const MOCK_BRANCH_GRAHA = {
  id: 'branch-graha',
  code: 'GRA',
  name: 'Daily Dose Graha Family Surabaya',
  timezone: 'Asia/Jakarta',
  active: true,
  version: 1,
  address: 'Graha Family Blok D-15, Surabaya',
  supportWhatsappE164: '+62895329736127',
  publicProfile: {
    area: 'Graha Family',
    city: 'Surabaya',
    address: 'Graha Family Blok D-15, Surabaya',
    slug: 'graha-family-surabaya',
    description: 'Studio Reformer Pilates di Surabaya Barat',
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
};

const MOCK_ADMIN_SESSION = {
  id: 'user-admin-01',
  displayName: 'Melissa Front Desk (Fiktif)',
  roles: ['BRANCH_STAFF', 'ADMIN'],
  branchIds: ['branch-graha'],
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
  branches: [MOCK_BRANCH_GRAHA],
  preferredBranch: MOCK_BRANCH_GRAHA,
};

const MOCK_CUSTOMER_SESSION = {
  id: '40000000-0000-4000-8000-000000017358',
  displayName: 'Marcia Sumampow (Fiktif)',
  email: 'marcia.sumampow@dailydose.test',
  phoneE164: '+6281200000001',
  roles: ['CUSTOMER'],
  branchIds: ['branch-graha'],
  sessionExpiresAt: new Date(Date.now() + 86400000).toISOString(),
  capabilities: [
    'customer:self',
    'booking:self:read',
    'booking:read',
    'booking:create',
    'booking:reschedule',
    'order:read',
    'order:create',
    'purchase:create',
  ],
  branches: [MOCK_BRANCH_GRAHA],
  preferredBranch: MOCK_BRANCH_GRAHA,
};

const MOCK_CO_MEMBER_SESSION = {
  id: 'user-comember-wiwik',
  displayName: 'Wiwik Then',
  email: 'wiwik.then@dailydose.test',
  phoneE164: '+6281234567890',
  roles: ['CUSTOMER'],
  branchIds: ['branch-graha'],
  identityVerificationStatus: 'APPROVED',
  phoneRequired: false,
  sessionExpiresAt: new Date(Date.now() + 86400000).toISOString(),
  capabilities: [
    'customer:self',
    'booking:self:read',
    'booking:self:create',
    'booking:read',
    'booking:create',
    'order:read',
  ],
  branches: [MOCK_BRANCH_GRAHA],
  preferredBranch: MOCK_BRANCH_GRAHA,
};

test.beforeEach(async ({ page }) => {
  await hideDevelopmentAffordances(page);

  await page.route('**/api/v1/public/site-config', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        brandName: 'Daily Dose Pilates',
        supportWhatsappE164: '+62895329736127',
        fallbackWhatsappE164: '+62895329736127',
        supportEmail: 'halo@dailydosepilates.id',
        defaultBranchCode: 'GRA',
        branches: [MOCK_BRANCH_GRAHA],
      }),
    }),
  );

  await page.route('**/api/v1/branches**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [MOCK_BRANCH_GRAHA],
        summary: { total: 1, active: 1 },
        page: { nextCursor: null, hasMore: false },
      }),
    }),
  );

  await page.route('**/api/v1/me/notifications**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], count: 0 }),
    }),
  );

  await page.route('**/api/v1/bookings**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], page: { hasMore: false, nextCursor: null } }),
    }),
  );

  await page.route('**/api/v1/dashboard/overview**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ todayBookings: 0, checkedInCount: 0, activePackageCount: 0 }),
    }),
  );
});

test('Evidence 1: Timetable Class Drawer dengan status DRAFT Guard', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.addInitScript((branchId: string) => {
    try {
      sessionStorage.setItem('dd_active_branch', branchId);
      sessionStorage.setItem('dd_session_hint', '1');
      localStorage.setItem('dd_session_hint', '1');
    } catch {}
  }, 'branch-graha');

  await page.route('**/api/v1/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_ADMIN_SESSION),
    }),
  );

  await page.route('**/api/v1/class-types**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          {
            id: 'ct-private-group',
            branchId: 'branch-graha',
            code: 'PVT-GRP',
            name: 'Private Group',
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
            branchId: 'branch-graha',
            code: 'ST-GRA',
            name: 'Group Studio',
            active: true,
            rooms: [
              {
                id: 'room-01',
                studioId: 'studio-01',
                code: 'R1',
                name: 'Group Studio',
                capacity: 5,
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
        items: [{ id: 'room-01', code: 'R1', name: 'Group Studio' }],
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
            branchId: 'branch-graha',
            instructorUserId: 'inst-melissa',
            instructor: { id: 'inst-melissa', displayName: 'Melissa (Coach)' },
          },
        ],
      }),
    }),
  );

  // Set tanggal slot hari ini pukul 10.00
  const today = new Date();
  const startAt = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 10, 0, 0);
  const endAt = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 10, 50, 0);

  const mockSlot = {
    id: 'slot-draft-01',
    branchId: 'branch-graha',
    classTypeId: 'ct-private-group',
    studioId: 'studio-01',
    roomId: 'room-01',
    instructorUserId: 'inst-melissa',
    title: 'Private Group',
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    timezone: 'Asia/Jakarta',
    status: 'DRAFT',
    minimumQuota: 1,
    capacity: 5,
    bookedCount: 0,
    version: 1,
    classType: { id: 'ct-private-group', code: 'PVT-GRP', name: 'Private Group' },
    room: { id: 'room-01', code: 'R1', name: 'Group Studio' },
    instructor: { id: 'inst-melissa', displayName: 'Melissa' },
    bookings: [],
  };

  await page.route('**/api/v1/class-slots**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [mockSlot],
        page: { hasMore: false, nextCursor: null },
      }),
    }),
  );

  await page.goto('/workspace/classes?branch=branch-graha', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);

  // Klik slot Private Group pada timetable
  const slotCard = page.locator('text=Private Group').first();
  await expect(slotCard).toBeVisible({ timeout: 10_000 });
  await slotCard.click();

  // Pastikan drawer roster terbuka dan banner edukasi DRAFT tampil
  const draftCallout = page.locator('text=Kelas masih berstatus Draf');
  await expect(draftCallout).toBeVisible({ timeout: 10_000 });

  await page.waitForTimeout(500);

  // Tangkap screenshot browser langsung
  const outputPath = resolve(ARTIFACT_DIR, 'bukti-screenshot-1-timetable-draft.png');
  await page.screenshot({ path: outputPath, fullPage: false });
  console.log(`[EVIDENCE] Screenshot 1 tersimpan di: ${outputPath}`);
});

test('Evidence 2: Detail Pesanan REJECTED dengan Alasan, Actions & Reconstructed Timeline', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.addInitScript((branchId: string) => {
    try {
      sessionStorage.setItem('dd_active_branch', branchId);
      sessionStorage.setItem('dd_session_hint', '1');
      localStorage.setItem('dd_session_hint', '1');
    } catch {}
  }, 'branch-graha');

  await page.route('**/api/v1/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_CUSTOMER_SESSION),
    }),
  );

  await page.route('**/api/v1/me/profile', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: '40000000-0000-4000-8000-000000017358',
        displayName: 'Marcia Sumampow (Fiktif)',
        email: 'marcia.sumampow@dailydose.test',
        phoneE164: '+6281200000001',
        preferredBranchId: 'branch-graha',
        version: 1,
      }),
    }),
  );

  await page.route('**/api/v1/me/dashboard', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        upcomingBookings: [],
        activePackages: [],
      }),
    }),
  );

  const orderId = '40000000-0000-4000-8000-000000017358';

  const mockRejectedOrder = {
    id: orderId,
    invoiceNumber: 'INV-20261031-17358',
    status: 'REJECTED',
    packageName: 'Drop In Private Class',
    packageDescription: 'Daily Dose Graha Family Surabaya · 1 sesi · 30 hari',
    sessionCount: 1,
    validityDays: 30,
    baseAmountRp: 675000,
    uniqueCode: 376,
    payableAmountRp: 675376,
    branchName: 'Daily Dose Graha Family Surabaya',
    branchCode: 'GRA',
    branchSupportWhatsapp: '+62895329736127',
    branchTimezone: 'Asia/Jakarta',
    submittedAt: '2026-10-31T06:00:00.000Z',
    decidedAt: '2026-10-31T06:30:00.000Z',
    expiresAt: '2026-10-31T12:00:00.000Z',
    continuationSlotId: null,
    paymentProofId: 'proof-17358',
    paymentProofStatus: { uploadStatus: 'FINALIZED', scanStatus: 'CLEAN' },
    decisionReasonCode: 'AMOUNT_MISMATCH',
    timelineComplete: true,
    version: 1,
    activation: null,
    paymentAccount: {
      bankName: 'BCA',
      accountNumber: '8290123456',
      accountHolderName: 'PT Daily Dose Indonesia',
    },
    timeline: {
      items: [
        {
          id: `${orderId}:created`,
          type: 'ORDER_CREATED',
          occurredAt: '2026-10-31T06:00:00.000Z',
          reasonCode: null,
          derived: false,
        },
        {
          id: `${orderId}:deadline`,
          type: 'PAYMENT_DEADLINE_SET',
          occurredAt: '2026-10-31T08:00:00.000Z',
          reasonCode: null,
          derived: false,
        },
        {
          id: `${orderId}:proof-submitted`,
          type: 'PROOF_SUBMITTED',
          occurredAt: '2026-10-31T06:15:00.000Z',
          reasonCode: null,
          derived: false,
        },
        {
          id: `${orderId}:proof-scanned`,
          type: 'PROOF_SCAN_COMPLETED',
          occurredAt: '2026-10-31T06:16:00.000Z',
          reasonCode: null,
          derived: false,
        },
        {
          id: `${orderId}:rejected`,
          type: 'PAYMENT_REJECTED',
          occurredAt: '2026-10-31T06:30:00.000Z',
          reasonCode: 'AMOUNT_MISMATCH',
          derived: false,
        },
      ],
      page: { hasMore: false, nextCursor: null },
    },
  };

  await page.route(`**/api/v1/orders/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockRejectedOrder),
    }),
  );

  await page.goto(`/orders/${orderId}?returnTo=%2Forders`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);

  // Pastikan status Ditolak, banner merah penolakan, tombol recovery, dan timeline tampil
  await expect(page.locator('text=Drop In Private Class').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('text=Ditolak').first()).toBeVisible();
  await expect(page.locator('text=Nominal transfer tidak sesuai').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Buat pesanan baru' })).toBeVisible();
  await expect(page.locator('text=Hubungi studio via WhatsApp')).toBeVisible();

  // Pastikan riwayat lengkap terlihat di bagian bawah
  await expect(page.locator('text=Timeline pembayaran')).toBeVisible();
  await expect(page.locator('text=Riwayat lengkap')).toBeVisible();

  await page.waitForTimeout(500);

  // Tangkap screenshot browser langsung (full page dan viewport)
  const outputPath = resolve(ARTIFACT_DIR, 'bukti-screenshot-2-order-rejected.png');
  await page.screenshot({ path: outputPath, fullPage: true });
  console.log(`[EVIDENCE] Screenshot 2 tersimpan di: ${outputPath}`);
});

test('Evidence 3: Co-Member dapat memilih paket bersama Family & Duet dan melakukan booking mandiri', async ({
  page,
}) => {
  page.on('console', (msg) => console.log('[BROWSER CONSOLE]', msg.type(), msg.text()));
  page.on('pageerror', (err) => console.log('[BROWSER PAGEERROR]', err.message));
  page.on('requestfailed', (req) =>
    console.log('[BROWSER REQ FAILED]', req.url(), req.failure()?.errorText),
  );
  page.on('response', (res) => {
    if (res.status() >= 400) console.log('[BROWSER RES >= 400]', res.status(), res.url());
  });

  await page.setViewportSize({ width: 1280, height: 800 });

  await page.addInitScript((branchId: string) => {
    try {
      sessionStorage.setItem('dd_active_branch', branchId);
      sessionStorage.setItem('dd_session_hint', '1');
      localStorage.setItem('dd_session_hint', '1');
    } catch {}
  }, 'branch-graha');

  await page.route('**/api/v1/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_CO_MEMBER_SESSION),
    }),
  );

  await page.route('**/api/v1/me/profile', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'user-comember-wiwik',
        displayName: 'Wiwik Then',
        email: 'wiwik.then@dailydose.test',
        phoneE164: '+6281234567890',
        preferredBranchId: 'branch-graha',
        version: 1,
      }),
    }),
  );

  await page.route('**/api/v1/me/dashboard', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        upcomingBookings: [],
        activePackages: [],
      }),
    }),
  );

  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_CO_MEMBER_SESSION),
    }),
  );

  const slotId = 'slot-duet-01';
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const startAt = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 10, 0, 0);
  const endAt = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 10, 50, 0);

  const mockSlot = {
    id: slotId,
    branchId: 'branch-graha',
    classTypeId: 'ct-duet',
    studioId: 'studio-01',
    roomId: 'room-01',
    instructorUserId: 'inst-melissa',
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    timezone: 'Asia/Jakarta',
    status: 'PUBLISHED',
    capacity: 2,
    bookedCount: 0,
    available: 2,
    branch: MOCK_BRANCH_GRAHA,
    classType: {
      id: 'ct-duet',
      code: 'DUET-01',
      name: 'Duet Reformer Pilates',
      modality: 'DUET',
      description: 'Sesi latihan duet dengan instruktur tersertifikasi untuk 2 orang.',
    },
    studio: { id: 'studio-01', name: 'Private Studio' },
    room: { id: 'room-01', name: 'Studio Duet' },
    instructor: { id: 'inst-melissa', displayName: 'Coach Melissa' },
  };

  const mockOptions = {
    slot: mockSlot,
    packages: [
      {
        id: 'cp-duet-family-01',
        customerPackageId: 'cp-duet-family-01',
        packageId: 'pkg-duet-10',
        name: 'Family & Duet Package (10 Sesi)',
        packageName: 'Family & Duet Package (10 Sesi)',
        available: 8,
        remainingSessions: 8,
        projectedAvailable: 7,
        totalSessions: 10,
        expiryAt: new Date(Date.now() + 30 * 86400000).toISOString(),
        expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
        isEligible: true,
      },
    ],
    eligibility: {
      canBook: true,
      reasonCode: null,
      requiredAction: null,
      cutoffAt: new Date(startAt.getTime() - 2 * 3600000).toISOString(),
    },
  };

  await page.route('**/api/v1/bookings**', async (route) => {
    const url = route.request().url();
    if (url.includes('/options/')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockOptions),
      });
    }
    if (route.request().method() === 'POST') {
      const payload = JSON.parse(route.request().postData() || '{}');
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'bkg-comember-001',
          slotId: payload.classSlotId,
          customerId: MOCK_CO_MEMBER_SESSION.id,
          customerPackageId: payload.customerPackageId,
          status: 'BOOKED',
          bookedAt: new Date().toISOString(),
          bookedByUserId: MOCK_CO_MEMBER_SESSION.id,
          attendanceStatus: 'PENDING',
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], page: { hasMore: false, nextCursor: null } }),
    });
  });

  await page.goto(`/bookings/new?slot=${slotId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);

  // Verifikasi UI Step 1: Member Wiwik Then melihat paket bersama terpilih
  await expect(page.locator('text=Duet Reformer Pilates').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('text=Family & Duet Package (10 Sesi)').first()).toBeVisible();
  await expect(page.locator('text=8 sesi tersedia').first()).toBeVisible();
  await expect(page.locator('text=Lanjutkan ke review booking')).toBeVisible();

  // Tangkap screenshot Step 1 (Pilihan paket bersama aktif)
  const outputPathSelection = resolve(ARTIFACT_DIR, 'bukti-screenshot-3-co-member-booking.png');
  await page.screenshot({ path: outputPathSelection, fullPage: true });
  console.log(`[EVIDENCE] Screenshot 3 tersimpan di: ${outputPathSelection}`);

  // Klik tombol Lanjutkan ke review booking
  await page.getByRole('button', { name: 'Lanjutkan ke review booking' }).click();
  await page.waitForTimeout(500);

  // Verifikasi Step 2: Halaman review menampilkan konfirmasi detail booking
  await expect(page.locator('text=Konfirmasi detail booking').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ya, konfirmasi booking' })).toBeVisible();

  // Klik Konfirmasi Booking
  await page.getByRole('button', { name: 'Ya, konfirmasi booking' }).click();
  await page.waitForTimeout(800);

  // Verifikasi Hasil Sukses: Kartu konfirmasi booking berhasil tampil
  await expect(page.locator('text=Booking berhasil').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('text=Lihat tiket & QR check-in')).toBeVisible();

  // Tangkap screenshot Step 3 (Konfirmasi sukses booking)
  const outputPathConfirmed = resolve(ARTIFACT_DIR, 'bukti-screenshot-4-co-member-confirmed.png');
  await page.screenshot({ path: outputPathConfirmed, fullPage: true });
  console.log(`[EVIDENCE] Screenshot 4 tersimpan di: ${outputPathConfirmed}`);
});
