import { bentrokJadwal } from './slot-kelas.service';

const lain = (instructorId: string | null) => ({
  instructorId,
  startAt: new Date('2026-10-30T10:00:00Z'),
  endAt: new Date('2026-10-30T11:00:00Z'),
  classType: { name: 'Reformer Group' },
  branch: { name: 'Daily Dose Green Garden', timezone: 'Asia/Jakarta' },
});

describe('bentrokJadwal', () => {
  it('menyebut instruktur sebagai penyebab bila ia sudah mengajar, walau di cabang lain', () => {
    const galat = bentrokJadwal(lain('agatha'), 'agatha');
    expect(galat.code).toBe('INSTRUCTOR_SCHEDULE_COLLISION');
    expect(galat.details).toEqual([
      { field: 'instructorUserId', issue: expect.stringContaining('Reformer Group') },
    ]);
    expect(galat.details[0]!.issue).toContain('17.00 sampai 18.00');
    expect(galat.details[0]!.issue).toContain('Daily Dose Green Garden');
  });

  it('menyebut ruangan bila kelas lain memakai ruangan itu dengan instruktur berbeda', () => {
    expect(bentrokJadwal(lain('dina'), 'agatha').code).toBe('SLOT_SCHEDULE_COLLISION');
    expect(bentrokJadwal(lain('dina'), null).details[0]!.field).toBe('roomId');
  });
});
