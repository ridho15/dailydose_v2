import { PolicyService } from '../identity/policy.service';
import { ClassSlotService } from './slot-kelas.service';

const branchId = '00000000-0000-4000-8000-000000000002';
const slotId = '00000000-0000-4000-8000-000000000010';
const principal = {
  sessionId: 's',
  userId: '00000000-0000-4000-8000-000000000001',
  roles: [{ role: 'ADMIN', branchId }],
  capabilities: ['class-slot:read', 'class-slot:manage'],
  branchIds: [branchId],
} as never;

function build(bookings: unknown[], endAt: Date) {
  const slot = {
    id: slotId, branchId, classTypeId: 'ct', instructorId: 'i',
    startAt: new Date(endAt.getTime() - 3_600_000), endAt, capacity: 8, bookedCount: 0,
    status: 'CONFIRMED', version: 1, bookings, classType: { name: 'X' }, branch: { name: 'B' },
    instructorAttendance: null,
  };
  const tx = {
    slotKelas: {
      findUnique: async () => slot,
      updateMany: jest.fn(async () => ({ count: 1 })),
      findUniqueOrThrow: async () => ({ ...slot, status: 'COMPLETED' }),
    },
    pemesananKelas: { update: jest.fn(async () => ({})) },
    sessionLedger: { create: jest.fn(async () => ({})), findFirst: async () => null },
    paketPelanggan: {
      findUnique: jest.fn(async () => ({ id: 'p', remainingSessions: 5, status: 'ACTIVE' })),
      update: jest.fn(async () => ({})),
    },
    checkInToken: { updateMany: async () => ({ count: 0 }) },
    auditLog: { create: async () => ({}) },
  };
  const idem = { execute: async (_o: unknown, aksi: (t: unknown) => unknown) => aksi(tx) };
  const svc = new ClassSlotService(
    {} as never, new PolicyService(), idem as never, { value: {} } as never, { catat: async () => {} } as never,
  );
  return { svc, tx };
}

const KEY = '1234567890123456';

describe('menyelesaikan kelas', () => {
  it('tidak menyentuh booking yang sudah dibatalkan (tanpa NO_SHOW, tanpa potong sesi)', async () => {
    const { svc, tx } = build(
      [{ id: 'b1', status: 'CANCELLED', attendance: null, customerPackageId: 'p' }],
      new Date(Date.now() - 1000),
    );
    await svc.complete(principal, slotId, {}, KEY, 'c');
    expect(tx.pemesananKelas.update).not.toHaveBeenCalled();
    expect(tx.sessionLedger.create).not.toHaveBeenCalled();
    expect(tx.paketPelanggan.update).not.toHaveBeenCalled();
  });

  it('tetap memotong sesi peserta yang tidak hadir di kelas yang sudah berakhir', async () => {
    const { svc, tx } = build(
      [{ id: 'b1', status: 'BOOKED', attendance: null, customerPackageId: 'p' }],
      new Date(Date.now() - 1000),
    );
    await svc.complete(principal, slotId, {}, KEY, 'c');
    expect(tx.pemesananKelas.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'NO_SHOW' } }),
    );
  });

  it('menolak kelas yang belum berakhir', async () => {
    const { svc, tx } = build(
      [{ id: 'b1', status: 'BOOKED', attendance: null, customerPackageId: 'p' }],
      new Date(Date.now() + 7 * 86_400_000),
    );
    await expect(svc.complete(principal, slotId, {}, KEY, 'c')).rejects.toMatchObject({
      code: 'CLASS_NOT_ENDED',
    });
    expect(tx.slotKelas.updateMany).not.toHaveBeenCalled();
    expect(tx.sessionLedger.create).not.toHaveBeenCalled();
  });

  it('kelas Terbit (belum dikonfirmasi) yang sudah berakhir juga diselesaikan dan sesi peserta hadir dipotong', async () => {
    const { svc, tx } = build(
      [{ id: 'b1', status: 'ATTENDED', attendance: { id: 'a1' }, customerPackageId: 'p' }],
      new Date(Date.now() - 1000),
    );
    (tx.slotKelas as any).findUnique = async () => ({
      id: slotId, branchId, classTypeId: 'ct', instructorId: 'i', startAt: new Date(Date.now() - 3_600_000),
      endAt: new Date(Date.now() - 1000), capacity: 8, bookedCount: 1, status: 'PUBLISHED', version: 1,
      bookings: [{ id: 'b1', status: 'ATTENDED', attendance: { id: 'a1' }, customerPackageId: 'p' }],
      classType: { name: 'X' }, branch: { name: 'B' }, instructorAttendance: null,
    });
    await svc.complete(principal, slotId, {}, KEY, 'c');
    expect(tx.sessionLedger.create).toHaveBeenCalledTimes(1);
    expect(tx.paketPelanggan.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ remainingSessions: { decrement: 1 } }) }),
    );
  });

  it('booking hasil migrasi V1 tidak dipotong lagi', async () => {
    const { svc, tx } = build(
      [{ id: 'b1', status: 'ATTENDED', bookingNumber: 'BKG-V1-00000001', attendance: null, customerPackageId: 'p' }],
      new Date(Date.now() - 1000),
    );
    await svc.complete(principal, slotId, {}, KEY, 'c');
    expect(tx.sessionLedger.create).not.toHaveBeenCalled();
  });

  it('penjadwal menyelesaikan kelas yang sudah lewat jeda tanpa akun pengguna', async () => {
    const { svc, tx } = build([{ id: 'b1', status: 'BOOKED', attendance: { id: 'a1' }, customerPackageId: 'p' }], new Date(Date.now() - 3_600_000));
    (svc as any).db = { slotKelas: { findMany: async () => [{ id: slotId, bookings: [{ status: 'ATTENDED', bookingNumber: 'BK-1', attendance: { id: 'a' } }] }] } };
    const hasil = await svc.selesaikanOtomatis(new Date());
    expect(hasil).toEqual({ diperiksa: 1, selesai: 1, gagal: 0, dilewati: 0, kegagalan: [] });
    expect(tx.sessionLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ createdById: null }) }),
    );
  });

  it('kelas yang gagal diselesaikan otomatis dicatat di hasil dan di log, bukan dibuang diam-diam', async () => {
    const { svc } = build([], new Date(Date.now() - 3_600_000));
    (svc as any).db = { slotKelas: { findMany: async () => [{ id: slotId, bookings: [{ status: 'ATTENDED', bookingNumber: 'BK-1', attendance: { id: 'a' } }] }] } };
    jest.spyOn(svc, 'complete').mockRejectedValue(Object.assign(new Error('x'), { code: 'STALE_VERSION' }));
    const galat = jest.spyOn((svc as any).logger, 'error').mockImplementation(() => undefined);
    const hasil = await svc.selesaikanOtomatis(new Date());
    expect(hasil).toEqual({ diperiksa: 1, selesai: 0, gagal: 1, dilewati: 0, kegagalan: [{ id: slotId, sebab: 'STALE_VERSION' }] });
    expect(galat).toHaveBeenCalledWith(expect.stringContaining(slotId));
  });

  it('saldo paket yang sudah nol tidak turun menjadi negatif saat kelas diselesaikan', async () => {
    const { svc, tx } = build([{ id: 'b1', status: 'ATTENDED', attendance: { id: 'a1' }, customerPackageId: 'p' }], new Date(Date.now() - 1000));
    tx.paketPelanggan.findUnique.mockResolvedValue({ id: 'p', remainingSessions: 0, status: 'DEPLETED' });
    await svc.complete(principal, slotId, {}, KEY, 'c');
    const data = (tx.paketPelanggan.update.mock.calls as unknown as Array<[{ data: Record<string, unknown> }]>)[0]![0].data;
    expect(data.remainingSessions).toEqual({ set: 0 });
    expect(data.usedSessions).toEqual({ increment: 1 });
  });

  describe('aturan pengaman: kelas tanpa satu pun presensi peserta tidak diselesaikan otomatis', () => {
    const jalankan = async (bookings: unknown[]) => {
      const { svc } = build([], new Date(Date.now() - 3_600_000));
      (svc as any).db = { slotKelas: { findMany: async () => [{ id: slotId, bookings }] } };
      const selesai = jest.spyOn(svc, 'complete').mockResolvedValue({} as never);
      jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
      const hasil = await svc.selesaikanOtomatis(new Date());
      return { hasil, selesai };
    };

    it('dilewati bila ada peserta tetapi tidak ada yang tercatat hadir', async () => {
      const { hasil, selesai } = await jalankan([
        { status: 'BOOKED', bookingNumber: 'BK-1', attendance: null },
        { status: 'BOOKED', bookingNumber: 'BK-2', attendance: null },
      ]);
      expect(selesai).not.toHaveBeenCalled();
      expect(hasil).toMatchObject({ diperiksa: 0, selesai: 0, dilewati: 1 });
    });

    it('diselesaikan bila minimal satu peserta tercatat hadir', async () => {
      const { hasil, selesai } = await jalankan([
        { status: 'ATTENDED', bookingNumber: 'BK-1', attendance: { id: 'a' } },
        { status: 'BOOKED', bookingNumber: 'BK-2', attendance: null },
      ]);
      expect(selesai).toHaveBeenCalledTimes(1);
      expect(hasil).toMatchObject({ selesai: 1, dilewati: 0 });
    });

    it('diselesaikan bila tidak ada peserta aktif (semua batal atau kelas kosong)', async () => {
      const { hasil, selesai } = await jalankan([{ status: 'CANCELLED', bookingNumber: 'BK-1', attendance: null }]);
      expect(selesai).toHaveBeenCalledTimes(1);
      expect(hasil).toMatchObject({ dilewati: 0 });
    });

    it('booking V1 tidak dihitung sebagai peserta aktif', async () => {
      const { selesai } = await jalankan([{ status: 'BOOKED', bookingNumber: 'BKG-V1-0001', attendance: null }]);
      expect(selesai).toHaveBeenCalledTimes(1);
    });
  });
});
