import { whereDaftarPaket } from './filter-paket';

const NOW = new Date('2026-11-17T05:00:00Z');
const db = {
  paketMasaJual: {
    findMany: jest.fn(async () => [
      { packageId: 'lewat', mulai: null, berakhir: new Date('2026-11-10T00:00:00Z') },
      { packageId: 'nanti', mulai: new Date('2026-12-01T00:00:00Z'), berakhir: null },
      { packageId: 'jalan', mulai: new Date('2026-11-01T00:00:00Z'), berakhir: new Date('2026-11-30T00:00:00Z') },
    ]),
  },
};

describe('whereDaftarPaket (filter Kelola Paket)', () => {
  it('status efektif dipakai server: Berakhir = masa jual lewat, Terjadwal = belum mulai', async () => {
    const berakhir = await whereDaftarPaket(db, { effectiveState: 'EXPIRED' }, NOW);
    expect(JSON.stringify(berakhir.where)).toContain('"id":{"in":["lewat"]}');
    const terjadwal = await whereDaftarPaket(db, { effectiveState: 'SCHEDULED' }, NOW);
    expect(JSON.stringify(terjadwal.where)).toContain('"id":{"in":["nanti"]}');
    const aktif = await whereDaftarPaket(db, { effectiveState: 'ACTIVE' }, NOW);
    expect(JSON.stringify(aktif.where)).toContain('"status":"ACTIVE","id":{"notIn":["nanti","lewat"]}');
    const nonaktif = await whereDaftarPaket(db, { effectiveState: 'INACTIVE' }, NOW);
    expect(JSON.stringify(nonaktif.where)).toContain('"status":{"in":["INACTIVE","ARCHIVED"]}');
  });

  it('tipe penggunaan dan tipe kelas ikut memfilter', async () => {
    const { where } = await whereDaftarPaket(db, { shareable: 'true', classTypeId: 'ct-1', q: 'TRIO PASS' }, NOW);
    const teks = JSON.stringify(where);
    expect(teks).toContain('{"classTypeId":"ct-1"}');
    expect(teks).toContain('{"isShareable":true}');
    expect(teks).toContain('{"name":{"contains":"TRIO PASS"}}');
    const biasa = await whereDaftarPaket(db, { shareable: 'false' }, NOW);
    expect(JSON.stringify(biasa.where)).toContain('{"isShareable":false}');
  });
});
