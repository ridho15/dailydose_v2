import { describe, expect, it } from 'vitest';
import { canMutatePage, canReadPage, frontendPages, pageForPath } from './frontend-pages';
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
