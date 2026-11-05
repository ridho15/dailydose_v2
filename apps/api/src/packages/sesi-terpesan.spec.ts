import { MEMEGANG_SESI, ringkasBookingPaket, tanpaPotongan, tertahanPerPaket } from './sesi-terpesan';

const fakeDb = (opts: { held?: unknown[]; ledgerRefs?: string[]; booking?: unknown[] }) => ({
  pemesananKelas: { findMany: jest.fn().mockImplementation(async (args: any) => (args.where.AND ? opts.held ?? [] : opts.booking ?? [])) },
  sessionLedger: {
    findMany: jest.fn().mockImplementation(async (args: any) =>
      (opts.ledgerRefs ?? []).filter((id) => args.where.referenceId.in.includes(id)).map((referenceId) => ({ referenceId })),
    ),
  },
});
const held = (id: string, status: string, pkg = 'p1') => ({ id, status, customerPackageId: pkg });

describe('sesi tertahan: satu sesi tidak boleh dihitung dua kali', () => {
  it('booking hadir yang sesinya sudah dipotong tidak lagi dihitung tertahan', async () => {
    // Kasus paket Nathania: dua booking hadir di kelas yang belum selesai, tetapi sesinya sudah terpotong.
    const db = fakeDb({
      held: [held('b1', 'ATTENDED'), held('b2', 'ATTENDED'), held('b3', 'BOOKED')],
      ledgerRefs: ['b1', 'b2'],
    });
    expect((await tertahanPerPaket(db as never, ['p1'])).get('p1')).toBe(1);
  });

  it('booking hadir yang belum dipotong tetap menahan sesi', async () => {
    const db = fakeDb({ held: [held('b1', 'ATTENDED'), held('b2', 'ATTENDED')] });
    expect((await tertahanPerPaket(db as never, ['p1'])).get('p1')).toBe(2);
  });

  it('hanya memeriksa buku besar untuk booking hadir, BOOKED tidak perlu', async () => {
    const db = fakeDb({ held: [held('b1', 'BOOKED')] });
    await tanpaPotongan(db as never, [{ id: 'b1', status: 'BOOKED' }]);
    expect(db.sessionLedger.findMany).not.toHaveBeenCalled();
  });
});

describe('ringkasBookingPaket (dasar sinkronisasi saldo)', () => {
  const baris = (id: string, status: string, kelas: string, nomor = `BK-${id}`) => ({
    id,
    status,
    bookingNumber: nomor,
    classSlot: { status: kelas },
  });

  it('hadir di kelas yang belum selesai belum dihitung terpakai, tetapi tertahan', async () => {
    const db = fakeDb({ booking: [baris('a', 'ATTENDED', 'CONFIRMED'), baris('b', 'ATTENDED', 'CONFIRMED')] });
    expect(await ringkasBookingPaket(db as never, 'p1')).toEqual({
      hadir: 0, tidakHadir: 0, booked: 0, dibatalkan: 0, tertahanHadir: 2,
    });
  });

  it('terpakai bila kelas sudah selesai, sudah ada potongan, atau booking migrasi V1', async () => {
    const db = fakeDb({
      booking: [
        baris('a', 'ATTENDED', 'COMPLETED'),
        baris('b', 'ATTENDED', 'CONFIRMED'), // sudah ada potongan
        baris('c', 'ATTENDED', 'CONFIRMED', 'BKG-V1-0001'),
        baris('d', 'NO_SHOW', 'COMPLETED'),
        baris('e', 'BOOKED', 'PUBLISHED'),
        baris('f', 'CANCELLED', 'CONFIRMED'),
      ],
      ledgerRefs: ['b'],
    });
    expect(await ringkasBookingPaket(db as never, 'p1')).toEqual({
      hadir: 3, tidakHadir: 1, booked: 1, dibatalkan: 1, tertahanHadir: 0,
    });
  });
});

describe('MEMEGANG_SESI', () => {
  it('excludes legacy migrated V1 bookings (BKG-V1-*) so they do not hold active package sessions', () => {
    expect(MEMEGANG_SESI.NOT).toEqual({ bookingNumber: { startsWith: 'BKG-V1-' } });
  });

  it('includes BOOKED and uncompleted ATTENDED bookings', () => {
    expect(MEMEGANG_SESI.OR).toEqual([
      { status: 'BOOKED' },
      { status: 'ATTENDED', classSlot: { status: { notIn: ['COMPLETED', 'CANCELLED'] } } },
    ]);
  });
});
