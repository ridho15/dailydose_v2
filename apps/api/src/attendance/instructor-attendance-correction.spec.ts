import { AttendanceService } from './kehadiran.service';

const SLOT = '11111111-1111-4111-8111-111111111111';
const owner = { userId: 'u1', roles: [{ role: 'SUPER_OWNER' }], capabilities: [] } as never;
const admin = { userId: 'u2', roles: [{ role: 'ADMIN' }], capabilities: [] } as never;

function setup(row: object | null) {
  const tx = {
    kehadiranInstruktur: { findUnique: jest.fn().mockResolvedValue(row), delete: jest.fn() },
  };
  const db = { $transaction: jest.fn((fn) => fn(tx)) };
  const audit = { catat: jest.fn() };
  const service = new AttendanceService(db as never, {} as never, {} as never, audit as never);
  return { tx, audit, service };
}
const row = {
  instructorId: 'i1',
  method: 'MANUAL_FRONTDESK',
  checkedInAt: new Date('2026-11-04T10:00:00Z'),
  classSlot: { branchId: 'b1' },
};

describe('Super Owner removes instructor attendance', () => {
  it('rejects non Super Owner and bad input before touching the database', async () => {
    const a = setup(row);
    await expect(a.service.removeInstructorAttendance(admin, SLOT, { reason: 'salah catat' }, 'c')).rejects.toMatchObject({ status: 403 });
    await expect(a.service.removeInstructorAttendance(owner, SLOT, { reason: 'ab' }, 'c')).rejects.toMatchObject({ status: 422 });
    await expect(a.service.removeInstructorAttendance(owner, 'bad id!', { reason: 'salah catat' }, 'c')).rejects.toMatchObject({ status: 422 });
    expect(a.tx.kehadiranInstruktur.delete).not.toHaveBeenCalled();
  });

  it('404 when no attendance was recorded', async () => {
    await expect(setup(null).service.removeInstructorAttendance(owner, SLOT, { reason: 'salah catat' }, 'c')).rejects.toMatchObject({ status: 404 });
  });

  it('deletes the row and writes an audit entry with the reason', async () => {
    const a = setup(row);
    await a.service.removeInstructorAttendance(owner, SLOT, { reason: 'salah catat' }, 'c');
    expect(a.tx.kehadiranInstruktur.delete).toHaveBeenCalledWith({ where: { classSlotId: SLOT } });
    expect(a.audit.catat).toHaveBeenCalledWith(a.tx, expect.objectContaining({ action: 'attendance.instructor_removed', reason: 'salah catat', targetUserId: 'i1' }));
  });
});
