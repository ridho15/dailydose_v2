import { PolicyService } from '../identity/policy.service';
import { PembatalanTerlambatService } from './pembatalan-terlambat.service';

const MK = '00000000-0000-4000-8000-0000000000a2';
const BOOKING = '00000000-0000-4000-8000-0000000000b1';
const REQ = '00000000-0000-4000-8000-0000000000c1';
const now = new Date('2026-10-29T10:00:00Z');
const besok = new Date('2026-10-30T02:00:00Z');

const admin = {
  sessionId: 's',
  userId: 'admin-1',
  roles: [{ role: 'ADMIN', branchId: MK }],
  capabilities: ['booking:cancel:assisted', 'booking:read'],
  branchIds: [MK],
} as never;
const manager = {
  sessionId: 's',
  userId: 'mgr-1',
  roles: [{ role: 'MANAGER', branchId: MK }],
  capabilities: ['booking:late-cancel:decide', 'booking:read'],
  branchIds: [MK],
} as never;

function setup(status = 'ATTENDED') {
  const tx = {
    pemesananKelas: {
      findUnique: jest.fn(async () => ({
        id: BOOKING,
        status,
        userId: 'cust-1',
        classSlotId: 'slot-1',
        customerPackageId: 'pkg-1',
        attendance: status === 'ATTENDED' ? { id: 'att-1' } : null,
        classSlot: { branchId: MK, startAt: besok },
      })),
      update: jest.fn(),
    },
    sessionAdjustRequest: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }) => ({
        ...data,
        id: REQ,
        version: 1,
        createdAt: now,
        requestedBy: { displayName: 'Admin MK' },
      })),
      findUnique: jest.fn(),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    sessionLedger: { findFirst: jest.fn(async () => null), create: jest.fn() },
    kehadiranPelanggan: { delete: jest.fn() },
    slotKelas: { update: jest.fn() },
    paketPelanggan: {
      findUniqueOrThrow: jest.fn(async () => ({
        id: 'pkg-1',
        remainingSessions: 0,
        status: 'DEPLETED',
        validUntil: new Date('2026-12-31T00:00:00Z'),
      })),
      update: jest.fn(),
    },
    auditLog: { create: jest.fn() },
  };
  const db = { $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
  return { tx, service: new PembatalanTerlambatService(db as never, new PolicyService()) };
}

describe('PembatalanTerlambatService', () => {
  it('admin mengajukan pembatalan booking yang terkunci Hadir; 1 sesi akan kembali', async () => {
    const { tx, service } = setup('ATTENDED');
    const hasil = await service.ajukan(
      admin,
      BOOKING,
      { reason: 'Member sakit, ada surat dokter' },
      now,
    );
    expect(hasil).toMatchObject({
      bookingId: BOOKING,
      sessionCount: 1,
      requestedByName: 'Admin MK',
    });
    expect(tx.sessionAdjustRequest.create.mock.calls[0]![0].data).toMatchObject({
      reasonCode: 'LATE_CANCELLATION',
      bookingId: BOOKING,
    });
  });

  it('booking aktif biasa di bawah H-24: sesinya belum terpotong, tidak ada yang dikembalikan', async () => {
    const { service } = setup('BOOKED');
    const hasil = await service.ajukan(
      admin,
      BOOKING,
      { reason: 'Member berhalangan mendadak' },
      now,
    );
    expect(hasil.sessionCount).toBe(0);
  });

  it('menolak alasan pendek, kelas yang sudah dimulai, dan pengajuan ganda', async () => {
    const { tx, service } = setup('BOOKED');
    await expect(service.ajukan(admin, BOOKING, { reason: 'sakit' }, now)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(
      service.ajukan(
        admin,
        BOOKING,
        { reason: 'Member berhalangan mendadak' },
        new Date('2026-10-30T03:00:00Z'),
      ),
    ).rejects.toMatchObject({ code: 'CLASS_ALREADY_STARTED' });
    tx.sessionAdjustRequest.findFirst.mockResolvedValueOnce({ id: 'lama' } as never);
    await expect(
      service.ajukan(admin, BOOKING, { reason: 'Member berhalangan mendadak' }, now),
    ).rejects.toMatchObject({ code: 'LATE_CANCELLATION_ALREADY_PENDING' });
  });

  it('manager menyetujui: booking batal, catatan hadir dihapus, kursi dibuka, 1 sesi kembali', async () => {
    const { tx, service } = setup('ATTENDED');
    tx.sessionAdjustRequest.findUnique.mockResolvedValue({
      id: REQ,
      version: 1,
      status: 'PENDING',
      reasonCode: 'LATE_CANCELLATION',
      requestedById: 'admin-1',
      bookingId: BOOKING,
      customerPackageId: 'pkg-1',
      sessionCount: 1,
      reason: 'Member sakit, ada surat dokter',
      booking: { classSlot: { branchId: MK } },
    } as never);
    const hasil = await service.putuskan(manager, REQ, 'approve', { expectedVersion: 1 }, now);
    expect(hasil).toMatchObject({ status: 'APPROVED', sessionsReturned: 1, resultingBalance: 1 });
    expect(tx.pemesananKelas.update.mock.calls[0]![0].data.status).toBe('CANCELLED');
    expect(tx.kehadiranPelanggan.delete).toHaveBeenCalledWith({ where: { id: 'att-1' } });
    expect(tx.slotKelas.update).toHaveBeenCalledWith({
      where: { id: 'slot-1' },
      data: { bookedCount: { decrement: 1 } },
    });
    expect(tx.paketPelanggan.update.mock.calls[0]![0].data).toMatchObject({
      remainingSessions: 1,
      status: 'ACTIVE',
    });
  });

  it('admin tidak bisa memutus, dan pengaju tidak memutus pengajuannya sendiri', async () => {
    const { tx, service } = setup('ATTENDED');
    await expect(
      service.putuskan(admin, REQ, 'approve', { expectedVersion: 1 }, now),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    tx.sessionAdjustRequest.findUnique.mockResolvedValue({
      id: REQ,
      status: 'PENDING',
      reasonCode: 'LATE_CANCELLATION',
      requestedById: 'mgr-1',
      bookingId: BOOKING,
      booking: { classSlot: { branchId: MK } },
    } as never);
    await expect(
      service.putuskan(manager, REQ, 'approve', { expectedVersion: 1 }, now),
    ).rejects.toMatchObject({
      code: 'SEPARATION_OF_DUTIES',
    });
  });

  it('ditolak: booking tetap seperti semula', async () => {
    const { tx, service } = setup('ATTENDED');
    tx.sessionAdjustRequest.findUnique.mockResolvedValue({
      id: REQ,
      status: 'PENDING',
      reasonCode: 'LATE_CANCELLATION',
      requestedById: 'admin-1',
      bookingId: BOOKING,
      sessionCount: 1,
      booking: { classSlot: { branchId: MK } },
    } as never);
    const hasil = await service.putuskan(manager, REQ, 'reject', { expectedVersion: 1 }, now);
    expect(hasil.status).toBe('REJECTED');
    expect(tx.pemesananKelas.update).not.toHaveBeenCalled();
  });
});
