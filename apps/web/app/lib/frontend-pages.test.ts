import { describe, expect, it } from 'vitest';
import {
  canMutatePage,
  canReadPage,
  frontendPages,
  menuStaf,
  pageForPath,
  peranMenu,
  tabUntuk,
} from './frontend-pages';
import { pageIcons } from './page-icons';
import { canAccessSessionPath } from '../session-context';
import type { WebSession } from '@/api-clients/session-client';

const page = (href: string) => frontendPages.find((item) => item.href === href)!;

describe('frontend page registry', () => {
  it('keeps daily work pages out of the "advanced" menu', () => {
    for (const href of ['/finance', '/ledger/adjustments', '/workspace/payments']) {
      expect(page(href).isAdvanced).toBeFalsy();
    }
  });

  it('only advertises queue badges the dashboard API can supply', () => {
    // `total` dijumlahkan oleh useQueueCounts dari antrean yang sama, untuk halaman Antrean.
    const supplied = new Set(['payments', 'reschedules', 'adjustments', 'total']);
    const unsupported = frontendPages
      .filter((item) => item.queueBadgeSource && !supplied.has(item.queueBadgeSource))
      .map((item) => item.href);
    // Verifikasi ID dan Operations belum punya antrean di API dashboard; jangan tambah lagi tanpa API.
    expect(unsupported.sort()).toEqual(['/identity-verifications', '/operations']);
  });

  it('gates the WhatsApp automation page behind automation capabilities', () => {
    const reminders = page('/workspace/reminders');
    expect(canReadPage([], reminders)).toBe(false);
    expect(canReadPage(['class:assigned:read', 'attendance:self'], reminders)).toBe(false);
    expect(canReadPage(['automation:read'], reminders)).toBe(true);
    expect(canMutatePage(['automation:read'], reminders)).toBe(false);
    expect(canMutatePage(['automation:read', 'automation:run'], reminders)).toBe(true);
  });

  it('resolves detail paths to their list page', () => {
    expect(pageForPath('/workspace/payments')?.href).toBe('/workspace/payments');
    expect(pageForPath('/workspace/payments/abc-123')?.href).toBe('/workspace/payments');
    expect(pageForPath('/customers/xyz')?.group).toBe('Member & Pelanggan');
    expect(pageForPath('/tidak-ada')).toBeUndefined();
  });

  it('gives every staff page its own icon', () => {
    const staffHrefs = frontendPages
      .filter((item) => !item.capabilities.includes('customer:self'))
      .map((item) => item.href);
    const icons = staffHrefs.map((href) => pageIcons[href]);
    expect(icons.every(Boolean)).toBe(true);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it('declares a branch scope for every page', () => {
    for (const item of frontendPages) expect(['topbar', 'global']).toContain(item.branchScope);
    // Halaman lintas cabang yang tidak boleh mengikuti pemilih topbar.
    for (const href of ['/workspace/vouchers', '/operations', '/health']) {
      expect(page(href).branchScope).toBe('global');
    }
    for (const href of ['/workspace/bookings', '/workspace/payments', '/workspace/classes', '/customers']) {
      expect(page(href).branchScope).toBe('topbar');
    }
  });

  it('marks pages backed by sample or in-memory data as preview, each with an explanation', () => {
    const preview = frontendPages.filter((item) => item.maturity === 'preview');
    expect(preview.map((item) => item.href).sort()).toEqual(
      ['/audit', '/users/roles-permissions'].sort(),
    );
    for (const item of preview) expect(item.previewNote?.trim().length).toBeGreaterThan(20);
    // Catatan tanpa penanda tidak boleh ada, dan halaman biasa tidak boleh berlabel pratinjau.
    for (const item of frontendPages.filter((entry) => entry.maturity !== 'preview'))
      expect(item.previewNote).toBeUndefined();
  });

  it('every staff page can actually be opened by a session holding its read capabilities', () => {
    // Menangkap halaman yang ada di registry tetapi tidak punya aturan rute (ditolak untuk semua orang).
    const staff = frontendPages.filter(
      (item) => item.capabilities.length > 0 && !item.capabilities.includes('customer:self'),
    );
    for (const item of staff) {
      const session = {
        id: 'staff-1',
        displayName: 'Staf',
        roles: ['SUPER_OWNER'],
        branchIds: [],
        capabilities: [item.capabilities[0]!],
        sessionExpiresAt: new Date(Date.now() + 60_000),
        branches: [],
      } as unknown as WebSession;
      expect([item.href, canAccessSessionPath(session, item.href)]).toEqual([item.href, true]);
    }
  });
});

describe('menu staf per peran', () => {
  // Salinan izin peran dari apps/api/src/identity/role-capabilities.ts yang menentukan halaman menu.
  const IZIN = {
    ADMIN: ['class-slot:read', 'customer:read', 'expense:create', 'booking:read', 'payment:review', 'ledger:read', 'ledger:adjust:read', 'package:read', 'attendance:manage', 'user:read', 'assignment:read'],
    MANAGER: ['attendance:manage', 'class-slot:read', 'customer:read', 'expense:create', 'booking:read', 'payment:review', 'ledger:read', 'automation:read', 'instructor:hours:adjust', 'identity-verification:read', 'user:read', 'assignment:read'],
    OWNER: ['finance:read', 'class-slot:read', 'booking:read', 'package:read', 'voucher:read', 'package-promotion:read', 'ledger:read', 'user:read', 'audit:read', 'automation:read', 'assignment:read', 'instructor-review:read'],
    SUPER_OWNER: ['class-slot:read', 'customer:read', 'finance:reconcile', 'finance:read', 'package-promotion:read', 'assignment:read', 'master:read', 'user:admin', 'user:read', 'notification:manage', 'operations:read', 'voucher:read'],
    FINANCE: ['finance:read', 'finance:reconcile', 'voucher:read', 'ledger:read', 'payment:review', 'automation:read', 'package:read', 'ledger:adjust:read'],
  } as const;
  const jumlah = { ADMIN: 4, MANAGER: 5, OWNER: 3, SUPER_OWNER: 6, FINANCE: 4 } as const;

  for (const peran of Object.keys(IZIN) as (keyof typeof IZIN)[]) {
    it(`${peran}: ${jumlah[peran]} menu utama dan sisa halaman di bagian terpisah`, () => {
      const menu = menuStaf({ roles: [peran], capabilities: IZIN[peran] })!;
      expect(menu.peran).toBe(peran);
      expect(menu.utama).toHaveLength(jumlah[peran]);
      const utama = new Set(menu.utama.map((m) => m.href));
      // Tidak ada halaman yang dobel dan tidak ada halaman yang hilang dari menu.
      for (const item of menu.lainnya) expect(utama.has(item.href)).toBe(false);
      const terbaca = frontendPages.filter(
        (p) =>
          !p.hideFromNav &&
          p.capabilities.length > 0 &&
          !p.capabilities.includes('customer:self') &&
          canReadPage([...IZIN[peran]], p),
      );
      for (const p of terbaca)
        expect(utama.has(p.href) || menu.lainnya.some((l) => l.href === p.href)).toBe(true);
    });
  }

  it('akun berperan ganda memakai peran tertinggi; instruktur dan member tidak memakai menu staf', () => {
    expect(peranMenu(['ADMIN', 'OWNER'])).toBe('OWNER');
    expect(peranMenu(['ADMIN', 'INSTRUCTOR'])).toBe('ADMIN');
    expect(peranMenu(['INSTRUCTOR'])).toBeNull();
    expect(menuStaf({ roles: ['CUSTOMER'], capabilities: ['customer:self'] })).toBeNull();
    expect(menuStaf({ roles: ['SUPER_OWNER'], capabilities: IZIN.SUPER_OWNER })!.lainnyaLabel).toBe(
      'Pengaturan',
    );
  });

  it('halaman satu tema tampil sebagai tab, hanya yang boleh dibuka', () => {
    expect(tabUntuk('/workspace/kas', ['finance:read', 'finance:reconcile']).map((t) => t.href)).toEqual([
      '/finance',
      '/workspace/kas',
      '/workspace/branch-performance',
    ]);
    expect(tabUntuk('/workspace/kas', ['expense:create'])).toEqual([]);
    expect(tabUntuk('/instructors/abc', ['assignment:read', 'user:read']).find((t) => t.aktif)?.href).toBe(
      '/instructors',
    );
    expect(tabUntuk('/workspace/classes', ['class-slot:read'])).toEqual([]);
  });
});
