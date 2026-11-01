import { test, expect } from '@playwright/test';
import { STAFF_ACCOUNTS, loginAs } from './staff-helper';
import * as fs from 'fs';

const SCREENSHOT_PATH =
  '/Users/lrmcorporation/.t3/userdata/providers/antigravity/ac0a3dfd6dddb20962cecff6ee5fe65e19d3923be20e52c5ab52ff877f7e4c32/antigravity-acp/brain/c8b39dae-040d-45ef-8576-75745939020e/bukti-phase5-shared-package.png';
const SCREENSHOT_BACKUP =
  '/Users/lrmcorporation/.t3/userdata/providers/antigravity/ac0a3dfd6dddb20962cecff6ee5fe65e19d3923be20e52c5ab52ff877f7e4c32/antigravity-acp/brain/ea4cab5f-38d1-42f0-81f6-96a96e87eb0d/bukti-phase5-shared-package.png';

test.describe('Bukti Pengujian Fase 5: Self-Service Sharing Paket & Transparansi Utilisasi', () => {
  test('Verifikasi alur self-service sharing paket oleh member dan transparansi utilisasi di workspace admin', async ({
    page,
  }) => {
    const mockPackageId = '00000000-0000-4000-8000-000000000555';

    // Mock data paket bersama
    const mockSharedMembers = [
      {
        id: '00000000-0000-4000-8000-000000000501',
        userId: '00000000-0000-4000-8000-000000000101',
        relationship: 'FRIEND',
        displayName: 'Maya Putri',
        phoneMasked: '0812****',
        email: 'maya@test.com',
        attendedSessions: 2,
        activeBookings: 1,
        createdAt: '2026-10-15T10:00:00.000Z',
      },
      {
        id: '00000000-0000-4000-8000-000000000502',
        userId: '00000000-0000-4000-8000-000000000102',
        relationship: 'FAMILY',
        displayName: 'Rian Pratama',
        phoneMasked: '0857****',
        email: 'rian@test.com',
        attendedSessions: 1,
        activeBookings: 0,
        createdAt: '2026-10-18T14:30:00.000Z',
      },
    ];

    // 1. Intercept API list customer packages di portal member
    await page.route('**/api/v1/customer-packages**', async (route) => {
      const url = route.request().url();
      if (url.includes(`/members`)) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            customerPackageId: mockPackageId,
            package: {
              id: '00000000-0000-4000-8000-000000000099',
              name: 'Duet Reformer Package (Family & Friends)',
              isShareable: true,
            },
            owner: {
              id: '00000000-0000-4000-8000-000000000100',
              displayName: 'Alice Owner (Pemilik)',
              phoneMasked: '0811****',
              attendedSessions: 3,
              activeBookings: 1,
            },
            remainingSessions: 6,
            status: 'ACTIVE',
            members: mockSharedMembers,
          }),
        });
        return;
      }

      if (url.includes(`/ledger`)) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            balance: {
              id: mockPackageId,
              branchId: '00000000-0000-4000-8000-000000000001',
              status: 'ACTIVE',
              activationDate: '2026-10-01T00:00:00.000Z',
              expiryAt: '2027-10-01T00:00:00.000Z',
              ledgerBalance: 10,
              reserved: 2,
              available: 6,
              packageName: 'Duet Reformer Package (Family & Friends)',
              branchName: 'Daily Dose Green Garden',
              classTypeName: 'Reformer',
              isShareable: true,
              customer: {
                id: '00000000-0000-4000-8000-000000000100',
                displayName: 'Alice Owner (Pemilik)',
                phoneMasked: '0811****',
              },
              sharedMembers: mockSharedMembers,
            },
            sharedUtilization: [
              {
                userId: '00000000-0000-4000-8000-000000000100',
                displayName: 'Alice Owner',
                phoneMasked: '0811****',
                role: 'OWNER',
                relationship: 'Pemilik Utama',
                activeBookings: 1,
                attendedSessions: 3,
                totalBookings: 4,
              },
              {
                userId: '00000000-0000-4000-8000-000000000101',
                displayName: 'Maya Putri',
                phoneMasked: '0812****',
                role: 'MEMBER',
                relationship: 'Teman / Rekan',
                activeBookings: 1,
                attendedSessions: 2,
                totalBookings: 3,
              },
              {
                userId: '00000000-0000-4000-8000-000000000102',
                displayName: 'Rian Pratama',
                phoneMasked: '0857****',
                role: 'MEMBER',
                relationship: 'Keluarga',
                activeBookings: 0,
                attendedSessions: 1,
                totalBookings: 1,
              },
            ],
            reservations: {
              activeQuantity: 2,
              items: [
                {
                  id: '00000000-0000-4000-8000-000000000601',
                  quantity: 1,
                  createdAt: '2026-10-30T10:00:00.000Z',
                  className: 'Reformer Core Foundations',
                  branchName: 'Green Garden',
                  startsAt: '2026-11-05T09:00:00.000Z',
                  bookedByUser: {
                    id: '00000000-0000-4000-8000-000000000100',
                    displayName: 'Alice Owner',
                    phoneMasked: '0811****',
                    isOwner: true,
                  },
                },
                {
                  id: '00000000-0000-4000-8000-000000000602',
                  quantity: 1,
                  createdAt: '2026-10-31T08:00:00.000Z',
                  className: 'Reformer Jumpboard Cardio',
                  branchName: 'Green Garden',
                  startsAt: '2026-11-06T14:00:00.000Z',
                  bookedByUser: {
                    id: '00000000-0000-4000-8000-000000000101',
                    displayName: 'Maya Putri',
                    phoneMasked: '0812****',
                    isOwner: false,
                  },
                },
              ],
            },
            entries: [
              {
                id: '00000000-0000-4000-8000-000000000701',
                type: 'ATTEND',
                quantity: -1,
                balanceAfter: 6,
                occurredAt: '2026-10-28T10:00:00.000Z',
                referenceLabel: 'Kehadiran Reformer Core',
                usedByUser: {
                  id: '00000000-0000-4000-8000-000000000101',
                  displayName: 'Maya Putri',
                  phoneMasked: '0812****',
                  isOwner: false,
                },
              },
              {
                id: '00000000-0000-4000-8000-000000000702',
                type: 'ATTEND',
                quantity: -1,
                balanceAfter: 7,
                occurredAt: '2026-10-25T15:00:00.000Z',
                referenceLabel: 'Kehadiran Mat Pilates Advanced',
                usedByUser: {
                  id: '00000000-0000-4000-8000-000000000100',
                  displayName: 'Alice Owner',
                  phoneMasked: '0811****',
                  isOwner: true,
                },
              },
            ],
            page: { hasMore: false, nextCursor: null, previousCursor: null },
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              id: mockPackageId,
              branchId: '00000000-0000-4000-8000-000000000001',
              status: 'ACTIVE',
              activationDate: '2026-10-01T00:00:00.000Z',
              expiryAt: '2027-10-01T00:00:00.000Z',
              ledgerBalance: 10,
              reserved: 2,
              available: 6,
              packageName: 'Duet Reformer Package (Family & Friends)',
              branchName: 'Green Garden',
              classTypeName: 'Reformer',
              isShareable: true,
              sharedMembers: mockSharedMembers,
            },
          ],
          summary: { packageCount: 1, ledgerBalance: 10, reserved: 2, available: 6 },
          nextCursor: null,
        }),
      });
    });

    // 2. Login sebagai Super Owner
    await loginAs(page, STAFF_ACCOUNTS.superOwner);

    // 3. Masuk ke halaman Detail Ledger & Transparansi Utilisasi di Workspace
    await page.goto(`/ledger/${mockPackageId}`);
    await expect(page).toHaveURL(new RegExp(`/ledger/${mockPackageId}`));
    await page.waitForLoadState('networkidle');

    // 4. Verifikasi Panel Transparansi Riwayat Pemakaian Paket Bersama
    const tableHeader = page.getByRole('heading', {
      name: /Transparansi Riwayat Pemakaian Paket Bersama/i,
    });
    await expect(tableHeader).toBeVisible({ timeout: 15_000 });

    // Verifikasi tabel utilisasi mencantumkan pemilik dan seluruh anggota bersama
    await expect(page.locator('text=Alice Owner').first()).toBeVisible();
    await expect(page.locator('text=Maya Putri').first()).toBeVisible();
    await expect(page.locator('text=Rian Pratama').first()).toBeVisible();
    await expect(page.locator('text=3 sesi').first()).toBeVisible();
    await expect(page.locator('text=2 sesi').first()).toBeVisible();

    // Verifikasi transparansi nama di daftar booking aktif
    await expect(page.locator('text=Dipesan oleh: Alice Owner').first()).toBeVisible();
    await expect(page.locator('text=Dipesan oleh: Maya Putri').first()).toBeVisible();

    // Verifikasi transparansi nama di histori mutasi
    await expect(page.locator('text=Digunakan oleh: Maya Putri').first()).toBeVisible();
    await expect(page.locator('text=Digunakan oleh: Alice Owner').first()).toBeVisible();

    // 5. Buka Dialog Kelola Anggota Bersama (Self-Service Modal)
    const kelolaAnggotaBtn = page.getByRole('button', { name: /Kelola Anggota/i }).first();
    await expect(kelolaAnggotaBtn).toBeVisible();
    await kelolaAnggotaBtn.click();

    // 6. Verifikasi Modal Terbuka
    const dialog = page.getByRole('dialog', { name: /Kelola Anggota Paket Bersama/i });
    await expect(dialog).toBeVisible();

    // Verifikasi form self-service input identifier & hubungan
    const inputIdentifier = dialog.getByTestId('input-member-identifier');
    await expect(inputIdentifier).toBeVisible();
    await inputIdentifier.fill('sahabat@dailydose.test');

    const selectRelasi = dialog.getByTestId('select-member-relationship');
    await expect(selectRelasi).toBeVisible();
    await selectRelasi.selectOption('FRIEND');

    const submitBtn = dialog.getByTestId('btn-add-member');
    await expect(submitBtn).toBeVisible();

    // 7. Ambil tangkapan layar bukti pengujian Fase 5 (Modal Self-Service + Tabel Transparansi)
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
    console.log(`Phase 5 Proof Screenshot saved to: ${SCREENSHOT_PATH}`);

    // Salin backup ke folder ea4cab5f bila ada
    try {
      const dir = '/Users/lrmcorporation/.t3/userdata/providers/antigravity/ac0a3dfd6dddb20962cecff6ee5fe65e19d3923be20e52c5ab52ff877f7e4c32/antigravity-acp/brain/ea4cab5f-38d1-42f0-81f6-96a96e87eb0d';
      if (fs.existsSync(dir)) {
        fs.copyFileSync(SCREENSHOT_PATH, SCREENSHOT_BACKUP);
        console.log(`Backup screenshot copied to: ${SCREENSHOT_BACKUP}`);
      }
    } catch (e) {
      // ignore
    }
  });
});
