import { AttendanceService } from './kehadiran.service';

const BOOKING = '11111111-1111-4111-8111-111111111111';
const KEY = 'k'.repeat(20);
const owner = { userId: 'u1', roles: [{ role: 'SUPER_OWNER' }], capabilities: [] } as never;
const admin = { userId: 'u2', roles: [{ role: 'ADMIN' }], capabilities: [] } as never;

function setup(booking: object | null, ledger: object | null = null) {
  const tx = {
    $queryRaw: jest.fn(),
    pemesananKelas: { findUnique: jest.fn().mockResolvedValue(booking), update: jest.fn() },
    sessionLedger: { findFirst: jest.fn().mockResolvedValue(ledger) },
    kehadiranPelanggan: { create: jest.fn(), delete: jest.fn() },
  };
  const idempotency = { execute: jest.fn((_o, fn) => fn(tx)) };
  const audit = { catat: jest.fn() };
  const service = new AttendanceService({} as never, {} as never, idempotency as never, audit as never);
  return { tx, audit, service };
}
const row = (status: string, slot = 'CONFIRMED', attendance: object | null = null) => ({
  id: BOOKING, status, userId: 'm1', attendance, classSlot: { status: slot, branchId: 'b1' },
});

describe('Super Owner booking status correction', () => {
  it('rejects non Super Owner', async () => {
    const { service } = setup(row('BOOKED'));
    await expect(service.correctStatus(admin, BOOKING, { toStatus: 'ATTENDED', reason: 'salah catat' }, KEY, 'c')).rejects.toMatchObject({ status: 403 });
  });

  it('requires a reason and a valid target status', async () => {
    const { service } = setup(row('BOOKED'));
    await expect(service.correctStatus(owner, BOOKING, { toStatus: 'ATTENDED', reason: 'ab' }, KEY, 'c')).rejects.toMatchObject({ status: 422 });
    await expect(service.correctStatus(owner, BOOKING, { toStatus: 'CANCELLED', reason: 'salah catat' }, KEY, 'c')).rejects.toMatchObject({ status: 422 });
  });

  it('refuses a settled class (COMPLETED) and a booking that already has a session deduction', async () => {
    const a = setup(row('ATTENDED', 'COMPLETED'));
    await expect(a.service.correctStatus(owner, BOOKING, { toStatus: 'NO_SHOW', reason: 'salah catat' }, KEY, 'c')).rejects.toMatchObject({ status: 409 });
    const b = setup(row('ATTENDED'), { id: 'l1' });
    await expect(b.service.correctStatus(owner, BOOKING, { toStatus: 'BOOKED', reason: 'salah catat' }, KEY, 'c')).rejects.toMatchObject({ status: 409 });
    expect(b.tx.pemesananKelas.update).not.toHaveBeenCalled();
  });

  it('refuses same status and cancelled bookings', async () => {
    await expect(setup(row('BOOKED')).service.correctStatus(owner, BOOKING, { toStatus: 'BOOKED', reason: 'salah catat' }, KEY, 'c')).rejects.toMatchObject({ status: 409 });
    await expect(setup(row('CANCELLED')).service.correctStatus(owner, BOOKING, { toStatus: 'BOOKED', reason: 'salah catat' }, KEY, 'c')).rejects.toMatchObject({ status: 409 });
  });

  it('BOOKED -> ATTENDED writes attendance and audit; ATTENDED -> BOOKED removes attendance', async () => {
    const up = setup(row('BOOKED'));
    await up.service.correctStatus(owner, BOOKING, { toStatus: 'ATTENDED', reason: 'salah catat' }, KEY, 'c');
    expect(up.tx.kehadiranPelanggan.create).toHaveBeenCalled();
    expect(up.tx.pemesananKelas.update).toHaveBeenCalledWith({ where: { id: BOOKING }, data: { status: 'ATTENDED' } });
    expect(up.audit.catat).toHaveBeenCalledWith(up.tx, expect.objectContaining({ action: 'booking.status_corrected', reason: 'salah catat' }));
    const down = setup(row('ATTENDED', 'CONFIRMED', { id: 'a1' }));
    await down.service.correctStatus(owner, BOOKING, { toStatus: 'BOOKED', reason: 'salah catat' }, KEY, 'c');
    expect(down.tx.kehadiranPelanggan.delete).toHaveBeenCalledWith({ where: { bookingId: BOOKING } });
  });
});
