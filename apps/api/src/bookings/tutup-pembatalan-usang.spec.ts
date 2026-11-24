import { prosesBookingSetelahDitolak } from './pembatalan-terlambat';
import { AKSI_TUTUP_PEMBATALAN, KODE_TUTUP_OTOMATIS, alasanPembatalanUsang, tutupPembatalanUsang } from './tutup-pembatalan-usang';

const aktif = { status: 'BOOKED', classSlot: { status: 'CONFIRMED' } };

describe('alasanPembatalanUsang', () => {
  it('booking aktif: masih berlaku', () => {
    expect(alasanPembatalanUsang({ reason: 'Sakit', booking: aktif })).toBeNull();
  });
  it('booking dibatalkan staf, kelas dibatalkan, atau booking hilang: usang', () => {
    expect(alasanPembatalanUsang({ reason: 'Sakit', booking: { ...aktif, status: 'CANCELLED' } })).toBe('BOOKING_SUDAH_DIBATALKAN');
    expect(alasanPembatalanUsang({ reason: 'Sakit', booking: { status: 'BOOKED', classSlot: { status: 'CANCELLED' } } })).toBe('KELAS_DIBATALKAN');
    expect(alasanPembatalanUsang({ reason: 'Sakit', booking: null })).toBe('BOOKING_TIDAK_ADA');
  });
  it('izin medis membatalkan booking sejak diajukan: booking batal BUKAN tanda usang', () => {
    expect(alasanPembatalanUsang({ reason: '[IZIN MEDIS] Demam', booking: { ...aktif, status: 'CANCELLED' } })).toBeNull();
    expect(
      alasanPembatalanUsang({ reason: '[IZIN MEDIS] Demam', booking: { status: 'CANCELLED', classSlot: { status: 'CANCELLED' } } }),
    ).toBe('KELAS_DIBATALKAN');
  });
});

describe('tutupPembatalanUsang', () => {
  it('menutup yang usang sebagai REJECTED berkode otomatis, hanya bila masih PENDING, dan mencatat audit', async () => {
    const db: any = {
      sessionAdjustRequest: {
        findMany: jest.fn(async () => [
          { id: 'r-1', reason: 'Sakit', bookingId: 'b-1', booking: { status: 'BOOKED', classSlot: { status: 'CONFIRMED', branchId: 'gg' } } },
          { id: 'r-2', reason: 'Sakit', bookingId: 'b-2', booking: { status: 'CANCELLED', classSlot: { status: 'CONFIRMED', branchId: 'mk' } } },
        ]),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      auditLog: { createMany: jest.fn(async () => ({})) },
    };
    expect(await tutupPembatalanUsang(db)).toBe(1);
    expect(db.sessionAdjustRequest.updateMany).toHaveBeenCalledTimes(1);
    expect(db.sessionAdjustRequest.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 'r-2', status: 'PENDING' },
      data: { status: 'REJECTED', decisionCode: KODE_TUTUP_OTOMATIS },
    });
    expect(db.auditLog.createMany.mock.calls[0][0].data[0]).toMatchObject({
      action: AKSI_TUTUP_PEMBATALAN,
      objectId: 'r-2',
      branchId: 'mk',
    });
  });

  it('gagal membaca database tidak menghalangi antrean', async () => {
    const db: any = { sessionAdjustRequest: { findMany: jest.fn(async () => { throw new Error('down'); }) } };
    expect(await tutupPembatalanUsang(db)).toBe(0);
  });
});

describe('prosesBookingSetelahDitolak', () => {
  const now = new Date('2026-11-24T05:00:00Z');
  const buat = (o: { status?: string; attendance?: unknown; endAt?: Date; sudahDipotong?: boolean } = {}) => {
    const tx: any = {
      pemesananKelas: {
        findUnique: jest.fn(async () => ({
          id: 'b-1',
          status: o.status ?? 'BOOKED',
          bookingNumber: 'BK-1',
          customerPackageId: 'cp-1',
          attendance: o.attendance ?? null,
          classSlot: {
            endAt: o.endAt ?? new Date('2026-11-11T02:00:00Z'),
            status: 'CONFIRMED',
            classType: { name: 'Reformer' },
            branch: { name: 'Untar' },
          },
        })),
        update: jest.fn(async () => ({})),
      },
      sessionLedger: {
        findFirst: jest.fn(async () => (o.sudahDipotong ? { id: 'l-1' } : null)),
        create: jest.fn(async () => ({})),
      },
      paketPelanggan: {
        findUnique: jest.fn(async () => ({ id: 'cp-1', remainingSessions: 5, status: 'ACTIVE' })),
        update: jest.fn(async () => ({})),
      },
    };
    return tx;
  };

  it('kelas sudah lewat tanpa presensi: Tidak hadir dan sesi dipotong sekali (Eva Rosalin 11 Nov)', async () => {
    const tx = buat();
    expect(await prosesBookingSetelahDitolak(tx, 'b-1', 'mgr', now)).toBe('NO_SHOW');
    expect(tx.pemesananKelas.update).toHaveBeenCalledWith({ where: { id: 'b-1' }, data: { status: 'NO_SHOW' } });
    expect(tx.sessionLedger.create.mock.calls[0][0].data).toMatchObject({ amount: -1, balanceAfter: 4, referenceId: 'b-1' });
  });

  it('ada presensi: Hadir; sudah pernah dipotong: tidak dipotong lagi', async () => {
    const tx = buat({ attendance: { id: 'a' }, sudahDipotong: true });
    expect(await prosesBookingSetelahDitolak(tx, 'b-1', 'mgr', now)).toBe('ATTENDED');
    expect(tx.sessionLedger.create).not.toHaveBeenCalled();
  });

  it('kelas belum berakhir: booking tidak disentuh', async () => {
    const tx = buat({ endAt: new Date('2026-11-25T02:00:00Z') });
    expect(await prosesBookingSetelahDitolak(tx, 'b-1', 'mgr', now)).toBeNull();
    expect(tx.pemesananKelas.update).not.toHaveBeenCalled();
  });
});
