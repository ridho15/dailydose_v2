import { describe, expect, it } from 'vitest';
import { pilihCalon } from './timetable-roster-panel';

const customer = { id: 'c1', displayName: 'Ayu' } as never;
const slot = { classTypeId: 'ct', startAt: new Date('2026-11-02T02:00:00Z'), branchId: 'mk' };
const paket = (allowedBranchIds: string[] | 'SEMUA') => ({
  id: 'p1',
  customerUserId: 'c1',
  classTypeId: 'ct',
  status: 'ACTIVE',
  available: 3,
  expiryAt: new Date('2026-12-31T00:00:00Z'),
  allowedBranchIds,
});

describe('pilihCalon dan cabang paket', () => {
  it('memakai paket V1 milik GG yang dibeli di MK untuk kelas MK', () => {
    expect(pilihCalon(customer, [paket(['gg', 'mk'])], slot, 'Asia/Jakarta').paket?.id).toBe('p1');
  });

  it('menyebut alasan bila paketnya hanya berlaku di cabang lain', () => {
    expect(pilihCalon(customer, [paket(['sby'])], slot, 'Asia/Jakarta')).toMatchObject({
      paket: null,
      kendala: 'Paketnya berlaku di cabang lain',
    });
  });

  it('member tanpa paket tetap tampil dengan alasannya', () => {
    expect(pilihCalon(customer, [], slot, 'Asia/Jakarta').kendala).toBe(
      'Belum punya paket untuk kelas ini',
    );
  });
});
