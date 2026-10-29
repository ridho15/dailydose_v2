import { cabangPaket, paketBerlakuDi } from './cabang-paket';

const GG = 'gg';
const MK = 'mk';

describe('cabangPaket', () => {
  it('paket V1 milik GG yang dibeli di MK berlaku di GG dan MK', () => {
    const cp = { package: { branchId: GG }, purchase: { branchId: MK } };
    expect(cabangPaket(cp)).toEqual([GG, MK]);
    expect(paketBerlakuDi(cp, MK)).toBe(true);
    expect(paketBerlakuDi(cp, 'sby')).toBe(false);
  });

  it('paket multi-cabang atau tanpa cabang berlaku di semua cabang', () => {
    expect(paketBerlakuDi({ package: { isMultiBranch: true, branchId: GG } }, MK)).toBe(true);
    expect(cabangPaket({ package: { branchId: null }, purchase: null })).toBe('SEMUA');
  });

  it('paket satu cabang yang dibeli di cabang yang sama tetap hanya di cabang itu', () => {
    expect(cabangPaket({ package: { branchId: MK }, purchase: { branchId: MK } })).toEqual([MK]);
  });
});
