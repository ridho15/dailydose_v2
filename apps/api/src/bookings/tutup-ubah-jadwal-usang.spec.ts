import { AKSI_TUTUP_OTOMATIS, alasanUsang, tutupUbahJadwalUsang } from './tutup-ubah-jadwal-usang';

const now = new Date('2026-11-24T05:00:00Z');
const besok = new Date('2026-11-25T01:00:00Z');
const kemarin = new Date('2026-11-23T01:00:00Z');
const baris = (o: Record<string, unknown> = {}) => ({
  id: 'r-1',
  bookingId: 'b-1',
  sourceSlotId: 's-asal',
  booking: { status: 'BOOKED', classSlotId: 's-asal' },
  sourceSlot: { startAt: besok, branchId: 'untar' },
  targetSlot: { startAt: besok },
  ...o,
});

describe('alasanUsang', () => {
  it('masih berlaku bila booking aktif di kelas asal dan kedua kelas belum mulai', () => {
    expect(alasanUsang(baris(), now)).toBeNull();
  });
  it('booking asal dibatalkan staf, sudah dipindah, atau kelas sudah lewat', () => {
    expect(alasanUsang(baris({ booking: { status: 'CANCELLED', classSlotId: 's-asal' } }), now)).toBe('BOOKING_TIDAK_AKTIF');
    expect(alasanUsang(baris({ booking: { status: 'BOOKED', classSlotId: 's-lain' } }), now)).toBe('BOOKING_SUDAH_PINDAH');
    expect(alasanUsang(baris({ sourceSlot: { startAt: kemarin, branchId: 'untar' } }), now)).toBe('KELAS_SUDAH_LEWAT');
    expect(alasanUsang(baris({ targetSlot: { startAt: kemarin } }), now)).toBe('KELAS_SUDAH_LEWAT');
  });
});

describe('tutupUbahJadwalUsang', () => {
  it('hanya menutup yang usang, tetap PENDING sebagai syarat, dan mencatat audit', async () => {
    const db: any = {
      ubahJadwal: {
        findMany: jest.fn(async () => [
          baris(),
          baris({ id: 'r-2', booking: { status: 'CANCELLED', classSlotId: 's-asal' } }),
        ]),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      auditLog: { createMany: jest.fn(async () => ({})) },
    };
    expect(await tutupUbahJadwalUsang(db, now)).toBe(1);
    expect(db.ubahJadwal.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['r-2'] }, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
    expect(db.auditLog.createMany.mock.calls[0][0].data[0]).toEqual(
      expect.objectContaining({ action: AKSI_TUTUP_OTOMATIS, objectId: 'r-2', branchId: 'untar' }),
    );
  });

  it('gagal membaca database tidak menghalangi antrean', async () => {
    const db: any = { ubahJadwal: { findMany: jest.fn(async () => { throw new Error('down'); }) } };
    expect(await tutupUbahJadwalUsang(db, now)).toBe(0);
  });
});
