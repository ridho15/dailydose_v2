import { scanWindowFor, TOLERANSI_INSTRUKTUR_MENIT } from './check-in-pass';
import { checkInWindowState } from './kehadiran.service';
import { pilihKelas } from './studio-scan.service';

const mulai = new Date('2026-11-05T11:00:00Z');
const selesai = new Date('2026-11-05T11:50:00Z');
const menit = (m: number) => new Date(selesai.getTime() + m * 60_000);

describe('kelonggaran scan instruktur 10 menit setelah kelas selesai', () => {
  it('instruktur masih bisa scan 10 menit setelah jam selesai, tidak lebih', () => {
    expect(TOLERANSI_INSTRUKTUR_MENIT).toBe(10);
    expect(scanWindowFor(mulai, selesai, menit(9), TOLERANSI_INSTRUKTUR_MENIT)).toBe('OPEN');
    expect(scanWindowFor(mulai, selesai, menit(10), TOLERANSI_INSTRUKTUR_MENIT)).toBe('OPEN');
    expect(scanWindowFor(mulai, selesai, menit(11), TOLERANSI_INSTRUKTUR_MENIT)).toBe('CLOSED');
    expect(checkInWindowState(mulai, selesai, menit(9), TOLERANSI_INSTRUKTUR_MENIT)).toBe('OPEN');
    expect(checkInWindowState(mulai, selesai, menit(11), TOLERANSI_INSTRUKTUR_MENIT)).toBe('EXPIRED');
  });

  it('member tidak ikut mendapat kelonggaran', () => {
    expect(scanWindowFor(mulai, selesai, menit(5))).toBe('CLOSED');
  });

  it('pindaian instruktur 5 menit setelah selesai memilih kelas yang baru selesai itu', () => {
    const kelas = { startAt: mulai, endAt: selesai, sudahTercatat: false };
    expect(pilihKelas([kelas], menit(5), TOLERANSI_INSTRUKTUR_MENIT)).toBe(kelas);
  });
});
