import { PolicyService } from '../identity/policy.service';
import { UlasanInstrukturService } from './ulasan-instruktur.service';

const member = {
  sessionId: 's',
  userId: 'm-1',
  roles: [{ role: 'CUSTOMER', branchId: null }],
  capabilities: ['customer:self'],
  branchIds: [],
} as never;

const manager = {
  sessionId: 's',
  userId: 'mgr',
  roles: [{ role: 'MANAGER', branchId: 'gg' }],
  capabilities: ['instructor-review:read'],
  branchIds: ['gg'],
} as never;

const now = new Date('2026-10-29T10:00:00Z');

const booking = (id: string, endAt: string, status = 'ATTENDED') => ({
  id,
  status,
  classSlot: {
    id: `slot-${id}`,
    startAt: new Date(new Date(endAt).getTime() - 3_600_000),
    endAt: new Date(endAt),
    instructorId: 'ins-1',
    branchId: 'gg',
    classType: { name: 'Reformer' },
    instructor: { displayName: 'Dina' },
    branch: { name: 'Green Garden', timezone: 'Asia/Jakarta' },
  },
});

function setup() {
  const db = {
    pemesananKelas: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          booking('b1', '2026-10-28T02:00:00Z'),
          booking('b2', '2026-10-27T02:00:00Z'),
        ]),
      findFirst: jest.fn(),
    },
    ulasanInstruktur: {
      findMany: jest.fn().mockResolvedValue([{ bookingId: 'b2' }]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }) => ({ id: 'u1', rating: data.rating })),
    },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    slotKelas: { findMany: jest.fn().mockResolvedValue([]) },
    cabang: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return { db, service: new UlasanInstrukturService(db as never, new PolicyService()) };
}

describe('UlasanInstrukturService', () => {
  it('menanyakan kelas yang dihadiri dan belum diulas atau dilewati', async () => {
    const { db, service } = setup();
    const hasil = await service.tertunda(member, now);
    expect(hasil.map((r) => r.bookingId)).toEqual(['b1']);
    expect(hasil[0]).toMatchObject({ namaInstruktur: 'Dina', namaKelas: 'Reformer' });
    expect(db.pemesananKelas.findMany.mock.calls[0][0].where).toMatchObject({
      userId: 'm-1',
      status: 'ATTENDED',
    });
  });

  it('menyimpan bintang dan komentar untuk instruktur kelas itu', async () => {
    const { db, service } = setup();
    db.pemesananKelas.findFirst.mockResolvedValue(booking('b1', '2026-10-28T02:00:00Z'));
    await expect(
      service.kirim(member, { bookingId: 'b1', rating: 5, comment: '  Sangat jelas  ' }, now),
    ).resolves.toEqual({ id: 'u1', skipped: false });
    expect(db.ulasanInstruktur.create.mock.calls[0]![0].data).toMatchObject({
      instructorId: 'ins-1',
      rating: 5,
      comment: 'Sangat jelas',
    });
    expect(db.pemesananKelas.findFirst.mock.calls[0][0].where).toEqual({
      id: 'b1',
      userId: 'm-1',
    });
  });

  it('mencatat lewati tanpa bintang agar tidak ditanya lagi', async () => {
    const { db, service } = setup();
    db.pemesananKelas.findFirst.mockResolvedValue(booking('b1', '2026-10-28T02:00:00Z'));
    await expect(service.kirim(member, { bookingId: 'b1', skip: true }, now)).resolves.toEqual({
      id: 'u1',
      skipped: true,
    });
    expect(db.ulasanInstruktur.create.mock.calls[0]![0].data).toMatchObject({
      rating: null,
      comment: null,
    });
  });

  it('menolak bintang di luar 1-5, kelas yang tidak dihadiri, dan ulasan ganda', async () => {
    const { db, service } = setup();
    await expect(service.kirim(member, { bookingId: 'b1', rating: 6 }, now)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    db.pemesananKelas.findFirst.mockResolvedValueOnce(
      booking('b1', '2026-10-28T02:00:00Z', 'NO_SHOW'),
    );
    await expect(service.kirim(member, { bookingId: 'b1', rating: 4 }, now)).rejects.toMatchObject({
      code: 'REVIEW_NOT_AVAILABLE',
    });
    db.pemesananKelas.findFirst.mockResolvedValueOnce(booking('b1', '2026-10-28T02:00:00Z'));
    db.ulasanInstruktur.findUnique.mockResolvedValueOnce({ id: 'lama' });
    await expect(service.kirim(member, { bookingId: 'b1', rating: 4 }, now)).rejects.toMatchObject({
      code: 'REVIEW_ALREADY_SUBMITTED',
    });
    expect(db.ulasanInstruktur.create).not.toHaveBeenCalled();
  });

  it('laporan merangkum per instruktur dan hanya cabang yang boleh dibaca', async () => {
    const { db, service } = setup();
    db.ulasanInstruktur.findMany.mockResolvedValue([
      {
        id: 'u1',
        userId: 'm-1',
        instructorId: 'ins-1',
        classSlotId: 's1',
        branchId: 'gg',
        rating: 5,
        comment: 'Mantap',
        createdAt: now,
      },
      {
        id: 'u2',
        userId: 'm-2',
        instructorId: 'ins-1',
        classSlotId: 's1',
        branchId: 'gg',
        rating: 4,
        comment: null,
        createdAt: now,
      },
    ]);
    db.user.findMany.mockResolvedValue([{ id: 'ins-1', displayName: 'Dina' }]);
    const hasil = await service.laporan(manager, {}, now);
    expect(db.ulasanInstruktur.findMany.mock.calls[0][0].where.branchId).toEqual({ in: ['gg'] });
    expect(hasil.instruktur).toEqual([
      expect.objectContaining({
        namaInstruktur: 'Dina',
        jumlahUlasan: 2,
        rataRata: 4.5,
        sebaran: [0, 0, 0, 1, 1],
      }),
    ]);
    await expect(service.laporan(manager, { branchId: 'mk' }, now)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(service.laporan(member, {}, now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
