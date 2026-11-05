import { describe, expect, it } from 'vitest';
import type { CustomerPackageBalance } from './booking-client';
import { paketBisaDipakaiUntukKelas } from './ledger-client';
import { pilihCalon } from '../classes/timetable-roster-panel';

const slot = {
  branchId: 'mk',
  classTypeId: 'reformer',
  startAt: new Date('2026-12-10T03:00:00Z'),
};
const paket = (over: Record<string, unknown> = {}) =>
  ({
    id: 'cp1',
    customerUserId: 'u1',
    status: 'ACTIVE',
    available: 5,
    expiryAt: new Date('2026-12-31T00:00:00Z'),
    classTypeId: null,
    allowedBranchIds: ['mk'],
    isMultiBranch: false,
    packageName: 'Paket',
    ...over,
  }) as unknown as CustomerPackageBalance;

// Timetable member dan layar staf harus sepakat, sama seperti server (kelayakan-paket.ts).
const kasus: Array<[string, Record<string, unknown>, boolean]> = [
  ['paket sehat', {}, true],
  ['habis sebelum kelas mulai', { expiryAt: new Date('2026-12-09T00:00:00Z') }, false],
  ['habis tepat saat kelas mulai', { expiryAt: slot.startAt }, false],
  ['sesi habis', { available: 0 }, false],
  ['paket beku', { status: 'FROZEN' }, false],
  ['cabang lain', { allowedBranchIds: ['sby'] }, false],
  ['multi-cabang', { allowedBranchIds: 'SEMUA', isMultiBranch: true }, true],
  ['tipe kelas lain', { classTypeId: 'mat' }, false],
];

describe('aturan paket untuk kelas', () => {
  it.each(kasus)('%s', (_nama, over, bisa) => {
    const item = paket(over);
    expect(paketBisaDipakaiUntukKelas(item, slot)).toBe(bisa);
    const calon = pilihCalon({ id: 'u1', displayName: 'U' } as any, [item], slot as any, 'Asia/Jakarta');
    expect(Boolean(calon.paket)).toBe(bisa);
  });
});
