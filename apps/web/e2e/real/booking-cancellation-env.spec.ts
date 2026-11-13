import { test, expect } from '@playwright/test';
import { prisma } from './db-helper';

/**
 * Bukti konfigurasi pembatalan booking pada stack yang sedang berjalan.
 *
 * Mode `configured` (default): API dijalankan dengan BOOKING_CANCELLATION_* lengkap, pembatalan harus berhasil.
 * Mode `missing` (DD_CANCEL_ENV_MODE=missing): API dijalankan TANPA variabel itu; harus mereproduksi
 * kegagalan production (503 CONFIGURATION_REQUIRED -> "Fitur booking yang diminta belum tersedia.").
 */
const MODE = process.env.DD_CANCEL_ENV_MODE === 'missing' ? 'missing' : 'configured';
// Default mengikuti seed lokal (apps/api/prisma/seed.ts); timpa lewat env bila datanya berbeda.
const EMAIL = process.env.DD_E2E_CUSTOMER_EMAIL ?? 'customer.maya@dailydose.test';
const PASSWORD = process.env.DD_E2E_CUSTOMER_PASSWORD ?? 'ridho123';
const SLOT_ID = process.env.DD_E2E_SLOT_ID ?? '00000000-0000-4000-8000-000000000402';
const MISSING_ENV_MESSAGE = 'Fitur booking yang diminta belum tersedia.';

test.describe(`Pembatalan booking, env ${MODE}`, () => {
  let userId: string;
  let packageId: string;
  let bookingId = '';
  let originalSelfie: string | null = null;

  test.beforeEach(async ({ page }) => {
    userId = (
      await prisma.user.findFirstOrThrow({
        where: { email: EMAIL },
        select: { id: true },
      })
    ).id;

    // Booking mandiri mensyaratkan selfie (profile.selfieUrl); isi sementara, dikembalikan di afterAll.
    const profile = await prisma.profilPengguna.findUnique({ where: { userId } });
    originalSelfie = profile?.selfieUrl ?? null;
    if (!originalSelfie)
      await prisma.profilPengguna.update({ where: { userId }, data: { selfieUrl: 'e2e/selfie-uji.png' } });

    // Kelas 72 jam lagi supaya jauh di luar batas pembatalan (H-12 lokal, H-24 production).
    const startAt = new Date(Date.now() + 72 * 3_600_000);
    await prisma.slotKelas.update({
      where: { id: SLOT_ID },
      data: {
        status: 'PUBLISHED',
        bookedCount: 0,
        startAt,
        endAt: new Date(startAt.getTime() + 3_600_000),
      },
    });
    await prisma.pemesananKelas.updateMany({
      where: { userId, classSlotId: SLOT_ID, status: 'BOOKED' },
      data: { status: 'CANCELLED' },
    });

    const slot = await prisma.slotKelas.findUniqueOrThrow({ where: { id: SLOT_ID } });
    const master = await prisma.paket.findFirstOrThrow({
      where: {
        status: 'ACTIVE',
        AND: [
          { OR: [{ branchId: null }, { branchId: slot.branchId }] },
          { OR: [{ classTypeId: null }, { classTypeId: slot.classTypeId }] },
        ],
      },
    });
    await prisma.paketPelanggan.updateMany({
      where: { userId, status: 'ACTIVE' },
      data: { status: 'EXPIRED' },
    });
    packageId = (
      await prisma.paketPelanggan.create({
        data: {
          userId,
          packageId: master.id,
          totalSessions: 10,
          remainingSessions: 10,
          usedSessions: 0,
          validUntil: new Date(Date.now() + 30 * 86_400_000),
          status: 'ACTIVE',
        },
      })
    ).id;

    await page.goto('/sign-in');
    await page.getByLabel(/Email, Username/).fill(EMAIL);
    await page.getByPlaceholder('Masukkan password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Masuk ke Akun' }).click();
    await page.waitForURL((url) => !url.pathname.includes('/sign-in'), { timeout: 15_000 });
  });

  test.afterEach(async () => {
    if (bookingId)
      await prisma.pemesananKelas.updateMany({
        where: { id: bookingId, status: 'BOOKED' },
        data: { status: 'CANCELLED' },
      });
    await prisma.slotKelas.update({ where: { id: SLOT_ID }, data: { bookedCount: 0 } });
  });

  test.afterAll(async () => {
    if (!originalSelfie)
      await prisma.profilPengguna
        .updateMany({ where: { user: { email: EMAIL } }, data: { selfieUrl: null } })
        .catch(() => undefined);
    await prisma.$disconnect();
  });

  test(`membatalkan booking dari UI (${MODE})`, async ({ page }, testInfo) => {
    // 1. Buat booking nyata lewat UI.
    await page.goto(`/bookings/new?slot=${SLOT_ID}`);
    const radio = page.locator(`input[value="${packageId}"]`);
    if ((await radio.isVisible()) && !(await radio.isChecked())) await radio.check();
    await page.getByRole('button', { name: 'Lanjutkan ke review booking' }).click();
    const created = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/api\/v1\/bookings$/.test(r.url()),
    );
    await page.getByRole('button', { name: 'Ya, konfirmasi booking' }).click();
    const createdResponse = await created;
    expect(createdResponse.ok()).toBe(true);
    bookingId = ((await createdResponse.json()) as { id: string }).id;

    // 2. Buka detail booking dan lewati dialog konfirmasi pembatalan.
    await page.goto(`/bookings/${bookingId}`);
    await page.getByRole('button', { name: 'Batalkan booking' }).click();
    await expect(page.getByText('Konfirmasi Pembatalan Booking')).toBeVisible();

    const cancelled = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/api\/v1\/bookings\/[^/]+\/cancel$/.test(r.url()),
    );
    await page.getByRole('button', { name: 'Ya, Batalkan' }).click();
    const cancelResponse = await cancelled;

    const row = await prisma.pemesananKelas.findUniqueOrThrow({ where: { id: bookingId } });
    if (MODE === 'configured') {
      expect(cancelResponse.status()).toBe(200);
      await expect(page.getByText('Booking berhasil dibatalkan', { exact: true })).toBeVisible();
      await expect(page.getByText(MISSING_ENV_MESSAGE)).toHaveCount(0);
      expect(row.status).toBe('CANCELLED');
      const active = await prisma.pemesananKelas.count({
        where: { customerPackageId: packageId, status: 'BOOKED' },
      });
      expect(active).toBe(0);
    } else {
      expect(cancelResponse.status()).toBe(503);
      await expect(page.getByText(MISSING_ENV_MESSAGE)).toBeVisible();
      expect(row.status).toBe('BOOKED');
    }
    await page.screenshot({ path: testInfo.outputPath(`cancel-${MODE}.png`), fullPage: true });
    await testInfo.attach(`cancel-${MODE}`, {
      path: testInfo.outputPath(`cancel-${MODE}.png`),
      contentType: 'image/png',
    });
  });
});
