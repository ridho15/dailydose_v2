import { PolicyService } from '../identity/policy.service';
import { PindahJamService } from './pindah-jam.service';

const BOOKING = '00000000-0000-4000-8000-0000000000b1';
const LAMA = '00000000-0000-4000-8000-0000000000a1';
const BARU = '00000000-0000-4000-8000-0000000000a2';
const PNG = { buffer: Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex') };
const now = new Date('2026-11-20T01:00:00Z');
const admin = {
  sessionId: 's',
  userId: 'adm',
  roles: [{ role: 'ADMIN', branchId: 'untar' }],
  capabilities: ['booking:cancel:assisted'],
  branchIds: ['untar'],
} as never;

function setup(o: { punyaBookingBaru?: boolean; terisi?: number; targetHari?: string; status?: string } = {}) {
  const tx: any = {
    pemesananKelas: {
      findUnique: jest.fn(async () => ({
        id: BOOKING,
        userId: 'shelly',
        status: o.status ?? 'BOOKED',
        classSlotId: LAMA,
        attendance: null,
        classSlot: { id: LAMA, branchId: 'untar', startAt: new Date('2026-11-20T00:00:00Z'), status: 'CONFIRMED' },
        customerPackage: { package: { classTypeId: 'reformer', isMultiBranch: false, branchId: 'untar' }, purchase: { branchId: 'untar' } },
      })),
      findFirst: jest.fn(async () => (o.punyaBookingBaru ? { id: 'b-baru' } : null)),
      count: jest.fn(async () => o.terisi ?? 3),
      update: jest.fn(async () => ({})),
    },
    slotKelas: {
      findUnique: jest.fn(async () => ({
        id: BARU,
        branchId: 'untar',
        status: 'CONFIRMED',
        classTypeId: 'reformer',
        capacity: 8,
        startAt: new Date(o.targetHari ?? '2026-11-20T05:00:00Z'),
      })),
      update: jest.fn(async () => ({})),
    },
    checkInToken: { updateMany: jest.fn(async () => ({})) },
    ubahJadwal: { create: jest.fn(async () => ({})) },
  };
  const db: any = { $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)) };
  const storage = { put: jest.fn(async () => ({})), delete: jest.fn(async () => undefined), exists: jest.fn() };
  const audit = { catat: jest.fn(async () => undefined) };
  return { tx, storage, audit, service: new PindahJamService(db, new PolicyService(), audit as never, storage as never) };
}

const isian = { targetClassSlotId: BARU, reason: 'Member pindah ke jam 12 lewat WA' };

describe('PindahJamService.pindah', () => {
  it('belum ada booking di slot baru: booking dipindah, kursi dihitung, tidak ada potong sesi, tercatat', async () => {
    const { tx, audit, service } = setup();
    const hasil = await service.pindah(admin, BOOKING, isian, PNG, now);
    expect(hasil.cara).toBe('PINDAH');
    expect(tx.pemesananKelas.update).toHaveBeenCalledWith({ where: { id: BOOKING }, data: { classSlotId: BARU } });
    expect(tx.slotKelas.update).toHaveBeenCalledWith({ where: { id: BARU }, data: { bookedCount: 4 } });
    expect(tx.slotKelas.update).toHaveBeenCalledWith({ where: { id: LAMA }, data: { bookedCount: { decrement: 1 } } });
    expect(tx.ubahJadwal.create.mock.calls[0][0].data).toMatchObject({ status: 'APPROVED', sourceSlotId: LAMA, targetSlotId: BARU });
    expect(audit.catat).toHaveBeenCalledWith(tx, expect.objectContaining({ action: 'booking.moved_same_day' }));
  });

  it('member sudah booking slot baru sendiri (Shelly 20 Nov): slot lama dibatalkan, sesi utuh', async () => {
    const { tx, service } = setup({ punyaBookingBaru: true });
    const hasil = await service.pindah(admin, BOOKING, isian, PNG, now);
    expect(hasil.cara).toBe('BATAL_SLOT_LAMA');
    expect(tx.pemesananKelas.update.mock.calls[0][0].data).toMatchObject({ status: 'CANCELLED' });
    expect(tx.pemesananKelas.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: { classSlotId: BARU } }));
  });

  it('tanpa bukti, beda hari, kelas penuh, atau booking sudah tidak aktif: ditolak; bukti dihapus bila gagal', async () => {
    await expect(setup().service.pindah(admin, BOOKING, isian, undefined, now)).rejects.toMatchObject({ code: 'EVIDENCE_REQUIRED' });
    const beda = setup({ targetHari: '2026-11-21T05:00:00Z' });
    await expect(beda.service.pindah(admin, BOOKING, isian, PNG, now)).rejects.toMatchObject({ code: 'MOVE_NOT_SAME_DAY' });
    expect(beda.storage.delete).toHaveBeenCalled();
    await expect(setup({ terisi: 8 }).service.pindah(admin, BOOKING, isian, PNG, now)).rejects.toMatchObject({ code: 'CLASS_CAPACITY_FULL' });
    await expect(setup({ status: 'NO_SHOW' }).service.pindah(admin, BOOKING, isian, PNG, now)).rejects.toMatchObject({ code: 'BOOKING_NOT_ACTIVE' });
    await expect(setup().service.pindah(admin, BOOKING, { ...isian, reason: 'pindah' }, PNG, now)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
