import { STATUS_MENEMPATI_KURSI, terisi } from './terisi';

describe('terisi', () => {
  it('memakai jumlah booking nyata, bukan penghitung tersimpan yang membengkak', () => {
    // Timetable menulis 3/8 padahal daftar pesertanya kosong.
    expect(terisi({ bookedCount: 3, _count: { bookings: 0 } })).toBe(0);
    expect(terisi({ bookedCount: 3, _count: { bookings: 2 } })).toBe(2);
  });

  it('jatuh ke penghitung lama bila hitungan booking tidak dimuat', () => {
    expect(terisi({ bookedCount: 4 })).toBe(4);
  });

  it('booking batal tidak menempati kursi; tidak hadir tetap', () => {
    expect(STATUS_MENEMPATI_KURSI).not.toContain('CANCELLED');
    expect(STATUS_MENEMPATI_KURSI).toContain('NO_SHOW');
  });
});
