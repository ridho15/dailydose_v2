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
      findUnique: async () => ({ id: 'p', remainingSessions: 5, status: 'ACTIVE' }),
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
});
