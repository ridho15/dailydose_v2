import { Prisma } from '@prisma/client';
import { bacaMasaJual, sedangDijual, simpanMasaJual } from './masa-jual';

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

  it('simpanMasaJual tetap aman bila tabel paket_masa_jual belum ada (P2021), galat lain tetap dilempar', async () => {
    const p2021 = new Prisma.PrismaClientKnownRequestError('The table `paket_masa_jual` does not exist', {
      code: 'P2021',
      clientVersion: 'test',
    });
    const txMissing = { paketMasaJual: { upsert: jest.fn(() => Promise.reject(p2021)) } };
    await expect(
      simpanMasaJual(txMissing, 'pkg-1', { mulai: new Date('2026-11-10T00:00:00Z'), berakhir: null }, 'u-1'),
    ).resolves.toEqual({});

    const txFail = { paketMasaJual: { upsert: jest.fn(() => Promise.reject(new Error('koneksi putus'))) } };
    await expect(
      simpanMasaJual(txFail, 'pkg-1', { mulai: new Date('2026-11-10T00:00:00Z') }, 'u-1'),
    ).rejects.toThrow('koneksi putus');

    const txOk = { paketMasaJual: { upsert: jest.fn(() => Promise.resolve({})) } };
    const masa = { mulai: new Date('2026-11-10T00:00:00Z'), berakhir: null };
    await expect(simpanMasaJual(txOk, 'pkg-1', masa, 'u-1')).resolves.toEqual(masa);
  });
});

describe('simpan masa jual saat tabelnya belum dibuat di server', () => {
  it('dilewati tanpa galat, supaya pembuatan/revisi paket tetap berhasil', async () => {
    const { simpanMasaJual } = await import('./masa-jual');
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      paketMasaJual: { upsert: jest.fn() },
    };
    await expect(
      simpanMasaJual(tx, 'pkg-1', { mulai: new Date('2026-11-11T00:00:00Z'), berakhir: null }, 'u'),
    ).resolves.toEqual({});
    expect(tx.paketMasaJual.upsert).not.toHaveBeenCalled();
  });
});
