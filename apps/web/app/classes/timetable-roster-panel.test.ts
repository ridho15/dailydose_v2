import { describe, expect, it } from 'vitest';
import type { CustomerPackageBalance } from '@/api-clients/booking-client';
import { calonUntuk } from './timetable-roster-panel';

const slot = {
  classTypeId: 'pg',
  startAt: new Date('2026-11-01T03:00:00Z'),
  timezone: 'Asia/Jakarta',
  branchId: 'gg',
};
const khamelia = { id: 'u1', displayName: 'Khamelia Alice' };
const paket = (over: Partial<CustomerPackageBalance> = {}): CustomerPackageBalance => ({
  id: 'cp1',
  customerUserId: 'u1',
  classTypeId: 'pg',
  status: 'ACTIVE',
  available: 9,
  expiryAt: new Date('2026-12-31T00:00:00Z'),
  packageName: 'Double Trouble Deal',
  ...over,
});

describe('calonUntuk (paket bawa teman)', () => {
  it('member yang belum di kelas tampil biasa', () => {
    const calon = calonUntuk(khamelia, [paket()], slot, new Map());
    expect(calon).toMatchObject({ kendala: null });
    expect(calon?.teman).toBeUndefined();
  });

  it('member yang sudah di kelas tampil lagi sebagai kursi teman bila paketnya bawa teman', () => {
    const calon = calonUntuk(khamelia, [paket({ maksTeman: 1 })], slot, new Map([['u1', 1]]));
    expect(calon).toMatchObject({ teman: true, kendala: null, paket: { id: 'cp1' } });
  });

  it('tanpa paket bawa teman, member yang sudah di kelas tidak bisa dimasukkan lagi', () => {
    expect(calonUntuk(khamelia, [paket()], slot, new Map([['u1', 1]]))).toBeNull();
  });

  it('jatah teman sudah terpakai: tidak tampil lagi', () => {
    expect(calonUntuk(khamelia, [paket({ maksTeman: 1 })], slot, new Map([['u1', 2]]))).toBeNull();
  });

  it('member dengan paket shareable/family (isShareable: true) tampil lagi sebagai kursi teman', () => {
    const calon = calonUntuk(khamelia, [paket({ isShareable: true })], slot, new Map([['u1', 1]]));
    expect(calon).toMatchObject({ teman: true, kendala: null, paket: { id: 'cp1' } });
  });

  it('member dengan paket shareable/family yang jatah temannya sudah terpakai: tidak tampil lagi', () => {
    expect(calonUntuk(khamelia, [paket({ isShareable: true })], slot, new Map([['u1', 2]]))).toBeNull();
  });
});
