import { describe, expect, it } from 'vitest';
import {
  geserDenganPanah,
  isDibatalkan,
  kelompokTipeKelas,
  nadaKeterisian,
  rentangJam,
} from './class-slot-presenters';

const hari = ['2026-10-26', '2026-10-27', '2026-10-28'];
const jam = [9, 10, 11];

describe('geserDenganPanah', () => {
  it('memindahkan hari dengan kiri dan kanan', () => {
    expect(geserDenganPanah({ hari: hari[1]!, jam: 10 }, 'ArrowRight', hari, jam)).toEqual({
      hari: hari[2],
      jam: 10,
    });
    expect(geserDenganPanah({ hari: hari[1]!, jam: 10 }, 'ArrowLeft', hari, jam)).toEqual({
      hari: hari[0],
      jam: 10,
    });
  });

  it('memindahkan jam dengan atas dan bawah', () => {
    expect(geserDenganPanah({ hari: hari[0]!, jam: 10 }, 'ArrowDown', hari, jam)?.jam).toBe(11);
    expect(geserDenganPanah({ hari: hari[0]!, jam: 10 }, 'ArrowUp', hari, jam)?.jam).toBe(9);
  });

  it('berhenti di tepi kalender alih-alih melompat ke minggu lain', () => {
    expect(geserDenganPanah({ hari: hari[2]!, jam: 11 }, 'ArrowRight', hari, jam)).toEqual({
      hari: hari[2],
      jam: 11,
    });
    expect(geserDenganPanah({ hari: hari[0]!, jam: 9 }, 'ArrowUp', hari, jam)?.jam).toBe(9);
  });

  it('mengabaikan tombol yang bukan panah', () => {
    expect(geserDenganPanah({ hari: hari[0]!, jam: 9 }, 'Enter', hari, jam)).toBeNull();
  });
});

describe('rentangJam', () => {
  it('memakai jam operasional 09.00 sampai 22.00 seperti mockup', () => {
    const r = rentangJam([10, 13]);
    expect(r[0]).toBe(9);
    expect(r.at(-1)).toBe(22);
    expect(r).toHaveLength(14);
  });

  it('melebar bila ada kelas pagi di luar jam buka', () => {
    expect(rentangJam([7, 10])[0]).toBe(7);
  });

  it('tetap memberi jam operasional bila minggu itu kosong', () => {
    expect(rentangJam([])).toHaveLength(14);
  });
});

describe('nadaKeterisian', () => {
  const kelas = { capacity: 8, minimumQuota: 3 };

  it('membedakan kosong, kurang, cukup, dan penuh', () => {
    expect(nadaKeterisian({ ...kelas, bookedCount: 0 })).toBe('kosong');
    expect(nadaKeterisian({ ...kelas, bookedCount: 2 })).toBe('kurang');
    expect(nadaKeterisian({ ...kelas, bookedCount: 3 })).toBe('cukup');
    expect(nadaKeterisian({ ...kelas, bookedCount: 8 })).toBe('penuh');
  });

  it('menganggap kelas privat satu orang penuh, bukan kurang', () => {
    expect(nadaKeterisian({ capacity: 1, minimumQuota: 1, bookedCount: 1 })).toBe('penuh');
  });
});

describe('kelompokTipeKelas', () => {
  it('menggabungkan tipe bernama sama dari banyak cabang menjadi satu chip', () => {
    expect(
      kelompokTipeKelas(['Group', 'Private Class', 'group ', 'Private  Class', undefined, '']),
    ).toEqual([
      { id: 'group', label: 'Group' },
      { id: 'private class', label: 'Private Class' },
    ]);
  });

  it('isDibatalkan mengenali batal manual dan otomatis', () => {
    expect(isDibatalkan({ status: 'CANCELLED' })).toBe(true);
    expect(isDibatalkan({ status: 'AUTO_CANCELLED' })).toBe(true);
    expect(isDibatalkan({ status: 'PUBLISHED' })).toBe(false);
  });
});
