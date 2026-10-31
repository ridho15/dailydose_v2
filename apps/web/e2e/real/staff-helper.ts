import { expect, type Page } from '@playwright/test';
import { prisma } from './db-helper';

/** Akun uji bawaan database dev. Dapat ditimpa lewat env tanpa mengubah spec. */
export const STAFF_ACCOUNTS = {
  admin: {
    email: process.env.E2E_ADMIN_EMAIL ?? 'admin@ddose.com',
    password: process.env.E2E_ADMIN_PASSWORD ?? 'ridho123',
  },
  superOwner: {
    email: process.env.E2E_SUPER_OWNER_EMAIL ?? 'ralamzah@gmail.com',
    password: process.env.E2E_SUPER_OWNER_PASSWORD ?? 'ridho123',
  },
  coachSarah: {
    email: process.env.E2E_COACH_EMAIL ?? 'coach.sarah@dailydose.test',
    password: process.env.E2E_COACH_PASSWORD ?? 'ridho123',
  },
  otherInstructor: {
    email: process.env.E2E_OTHER_INSTRUCTOR_EMAIL ?? 'instdevi@ddose.com',
    password: process.env.E2E_OTHER_INSTRUCTOR_PASSWORD ?? 'ridho123',
  },
} as const;

export type Account = { email: string; password: string };

export async function loginAs(page: Page, account: Account) {
  await page.goto('/sign-in');
  await page.locator('input[name="email"]').fill(account.email);
  await page.locator('input[name="password"]').fill(account.password);
  await page.getByRole('button', { name: /masuk ke akun|masuk dengan email/i }).click();
  await page.waitForURL((url) => !url.pathname.includes('/sign-in'), { timeout: 20_000 });
}

/** Staf harus memilih cabang aktif di topbar sebelum timetable terbuka. */
export async function selectBranch(page: Page, branchName: RegExp) {
  const combobox = page.getByRole('combobox', { name: 'Cabang aktif' });
  await combobox.click();
  await page.getByRole('option', { name: branchName }).first().click();
}

export const slotTimeLabel = (date: Date) =>
  new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Jakarta',
  }).format(date);

/** Menit awal yang bukan kelipatan 5 supaya label jam tidak bentrok dengan jadwal seed. */
export function uniqueStart(offsetMinutes: number) {
  const start = new Date(Date.now() + offsetMinutes * 60_000);
  start.setSeconds(0, 0);
  while (start.getMinutes() % 5 === 0) start.setMinutes(start.getMinutes() + 1);
  return start;
}

const SLOT_ID_PREFIX = 'f1000000-0e2e-4000-8000-';
export const e2eSlotId = (n: number) => `${SLOT_ID_PREFIX}${String(n).padStart(12, '0')}`;

export async function loadSarah() {
  return prisma.user.findFirstOrThrow({
    where: { email: STAFF_ACCOUNTS.coachSarah.email },
    select: { id: true, displayName: true },
  });
}

export async function loadOtherInstructor() {
  return prisma.user.findFirstOrThrow({
    where: { email: STAFF_ACCOUNTS.otherInstructor.email },
    select: { id: true, displayName: true },
  });
}

/**
 * Membuat kelas uji dengan menyalin salah satu kelas nyata (studio/ruang/tipe valid).
 * `templateInstructorId` menentukan kelas mana yang disalin, sehingga cabangnya dapat dipilih.
 */
export async function createSlot(input: {
  id: string;
  instructorId: string;
  startAt: Date;
  templateInstructorId?: string;
  status?: 'CONFIRMED' | 'DRAFT' | 'PUBLISHED';
  durationMinutes?: number;
}) {
  const template = await prisma.slotKelas.findFirstOrThrow({
    where: {
      instructorId: input.templateInstructorId ?? input.instructorId,
      id: { not: { startsWith: SLOT_ID_PREFIX } },
    },
    orderBy: { startAt: 'desc' },
  });
  const { createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = template;
  void _createdAt;
  void _updatedAt;
  await cleanupSlots([input.id]);
  return prisma.slotKelas.create({
    data: {
      ...rest,
      id: input.id,
      instructorId: input.instructorId,
      status: input.status ?? 'CONFIRMED',
      bookedCount: 0,
      startAt: input.startAt,
      endAt: new Date(input.startAt.getTime() + (input.durationMinutes ?? 50) * 60_000),
    },
  });
}

export async function cleanupSlots(ids: string[]) {
  await prisma.kehadiranInstruktur.deleteMany({ where: { classSlotId: { in: ids } } });
  await prisma.instructorCheckInToken.deleteMany({ where: { classSlotId: { in: ids } } });
  await prisma.slotKelas.deleteMany({ where: { id: { in: ids } } });
}

export async function openClassDetail(page: Page, startAt: Date) {
  const calendar = page.getByRole('region', { name: 'Kalender kelas tujuh hari' });
  const card = calendar.getByRole('button', { name: new RegExp(slotTimeLabel(startAt).replace('.', '\\.')) });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.click();
  const dialog = page.getByRole('dialog').first();
  await expect(dialog).toBeVisible();
  return dialog;
}
