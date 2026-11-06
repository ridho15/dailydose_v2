import { nomorWajib, perluLengkapiNomor } from './nomor-wajib';

describe('nomor WhatsApp tidak wajib kecuali PHONE_REQUIRED=true', () => {
  it('bawaannya tidak wajib, walau nomor kosong', () => {
    expect(nomorWajib({})).toBe(false);
    expect(perluLengkapiNomor(null, {})).toBe(false);
    expect(perluLengkapiNomor('', { PHONE_REQUIRED: 'false' })).toBe(false);
  });

  it('bila diwajibkan, hanya akun tanpa nomor yang diminta melengkapi', () => {
    const env = { PHONE_REQUIRED: 'true' };
    expect(perluLengkapiNomor(null, env)).toBe(true);
    expect(perluLengkapiNomor('', env)).toBe(true);
    expect(perluLengkapiNomor('+6281234567890', env)).toBe(false);
  });
});
