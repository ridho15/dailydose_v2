import { Prisma } from '@prisma/client';
import { bookingTeman, maksTemanPaket } from '../packages/bawa-teman';
import { bacaOpsional, tabelBelumAda } from './tabel-opsional';

const galatPrisma = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('The table `booking_teman` does not exist', {
    code,
    clientVersion: 'test',
  });

describe('bacaOpsional (tabel tambahan belum dibuat di server)', () => {
  it('mengenali tabel (P2021) dan kolom (P2022) yang belum ada', () => {
    expect(tabelBelumAda(galatPrisma('P2021'))).toBe(true);
    expect(tabelBelumAda(galatPrisma('P2022'))).toBe(true);
    expect(tabelBelumAda(galatPrisma('P2002'))).toBe(false);
    expect(tabelBelumAda(new Error('x'))).toBe(false);
  });

  it('mengembalikan cadangan bila tabel belum ada, galat lain tetap dilempar', async () => {
    await expect(
      bacaOpsional('booking_teman', () => Promise.reject(galatPrisma('P2021')), []),
    ).resolves.toEqual([]);
    await expect(
      bacaOpsional('booking_teman', () => Promise.reject(new Error('koneksi putus')), []),
    ).rejects.toThrow('koneksi putus');
  });

  it('daftar peserta tetap jalan tanpa tabel booking_teman dan paket_bawa_teman', async () => {
    const db = {
      bookingTeman: { findMany: jest.fn(() => Promise.reject(galatPrisma('P2021'))) },
      paketBawaTeman: { findMany: jest.fn(() => Promise.reject(galatPrisma('P2021'))) },
    };
    await expect(bookingTeman(db as never, ['b1'])).resolves.toEqual(new Map());
    await expect(maksTemanPaket(db as never, ['p1'])).resolves.toEqual(new Map());
  });
});
