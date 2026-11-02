import { berlakuSampai } from './masa-berlaku';

describe('berlakuSampai', () => {
  it('aktif 1 November 120 hari berakhir 1 Maret 23.59.59 WIB', () => {
    expect(berlakuSampai(new Date('2026-11-01T07:30:00Z'), 120).toISOString()).toBe('2027-03-01T16:59:59.000Z');
  });
  it('memakai tanggal WIB, bukan UTC (aktif 1 Nov 02.00 WIB = 31 Okt UTC)', () => {
    expect(berlakuSampai(new Date('2026-10-31T19:00:00Z'), 30).toISOString()).toBe('2026-12-01T16:59:59.000Z');
  });
});
