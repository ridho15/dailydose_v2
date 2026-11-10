import { bacaMasaJual, sedangDijual } from './masa-jual';

describe('masa jual paket', () => {
  it('membaca tanggal dari form; kosong berarti tanpa batas; berakhir tidak boleh sebelum mulai', () => {
    expect(bacaMasaJual({ effectiveFrom: '2026-11-01', effectiveUntil: '2026-11-30' })).toEqual({
      mulai: new Date('2026-11-01T00:00:00.000Z'),
      berakhir: new Date('2026-11-30T00:00:00.000Z'),
    });
    expect(bacaMasaJual({ effectiveUntil: '' })).toEqual({ berakhir: null });
    expect(bacaMasaJual({})).toEqual({});
    expect(() => bacaMasaJual({ effectiveFrom: '2026-11-30', effectiveUntil: '2026-11-01' })).toThrow();
  });

  it('dijual sampai tanggal berakhir (inklusif, tanggal WIB)', () => {
    const masa = { mulai: new Date('2026-11-01T00:00:00Z'), berakhir: new Date('2026-11-30T00:00:00Z') };
    expect(sedangDijual(masa, new Date('2026-11-30T16:00:00Z'))).toBe(true); // 30 Nov 23.00 WIB
    expect(sedangDijual(masa, new Date('2026-11-30T17:30:00Z'))).toBe(false); // 1 Des 00.30 WIB
    expect(sedangDijual(masa, new Date('2026-10-31T10:00:00Z'))).toBe(false);
    expect(sedangDijual(undefined)).toBe(true);
  });
});
