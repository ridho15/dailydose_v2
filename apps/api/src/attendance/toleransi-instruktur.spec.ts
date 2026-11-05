import { menitTerlambat, scanWindowFor, scanWindowInstruktur, TOLERANSI_INSTRUKTUR_MENIT } from './check-in-pass';
import { checkInWindowInstruktur } from './kehadiran.service';
import { pilihKelas } from './studio-scan.service';

// Kelas 10.00–10.50 WIB.
const mulai = new Date('2026-11-05T03:00:00Z');
const selesai = new Date('2026-11-05T03:50:00Z');
const setelahMulai = (m: number) => new Date(mulai.getTime() + m * 60_000);

describe('instruktur boleh terlambat sampai 10 menit setelah kelas mulai', () => {
  it('kelas 10.00: scan 10.10 masih diterima, 10.11 ditolak', () => {
    expect(TOLERANSI_INSTRUKTUR_MENIT).toBe(10);
    expect(scanWindowInstruktur(mulai, selesai, setelahMulai(-40))).toBe('OPEN');
    expect(scanWindowInstruktur(mulai, selesai, setelahMulai(10))).toBe('OPEN');
    expect(scanWindowInstruktur(mulai, selesai, setelahMulai(11))).toBe('CLOSED');
    expect(checkInWindowInstruktur(mulai, setelahMulai(10))).toBe('OPEN');
    expect(checkInWindowInstruktur(mulai, setelahMulai(11))).toBe('EXPIRED');
  });

  it('menit terlambat dihitung dari jam mulai', () => {
    expect(menitTerlambat(mulai, setelahMulai(-5))).toBe(0);
    expect(menitTerlambat(mulai, setelahMulai(7))).toBe(7);
  });

  it('member tetap bisa di-scan sampai kelas selesai', () => {
    expect(scanWindowFor(mulai, selesai, setelahMulai(30))).toBe('OPEN');
  });

  it('pindaian instruktur 10.20 tidak lagi memilih kelas 10.00', () => {
    const kelas = { startAt: mulai, endAt: selesai, sudahTercatat: false };
    const berikut = { startAt: setelahMulai(60), endAt: setelahMulai(110), sudahTercatat: false };
    expect(pilihKelas([kelas, berikut], setelahMulai(20), scanWindowInstruktur)).toBe(berikut);
  });
});
