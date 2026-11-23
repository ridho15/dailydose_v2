import { bacaNominal, bacaWaktu, cocokkanBukti } from './ocr-bukti';

// Teks hasil OCR dari contoh tampilan m-BCA, Livin' by Mandiri, dan DANA.
const BCA = 'm-BCA\nTransfer Berhasil\n23/11/2026 10:15:32 WIB\nKe 0123456789\nDAILY DOSE PILATES\nRp 1.500.123,00\nNo. Ref: 2311202610153212';
const MANDIRI = "Livin' by Mandiri\nTransfer Sukses\nNominal\nRp4.000.457\nTanggal 23 Nov 2026, 09:48 WIB";
const DANA = 'Kirim ke Bank\nRp570.665\n23 November 2026 - 14.02\nID Transaksi 2026112314020001';

const wib = (s: string) => new Date(`${s}+07:00`);

describe('bacaNominal', () => {
  it('mengenali format rupiah dari berbagai aplikasi', () => {
    expect(bacaNominal(BCA)).toContain(1_500_123);
    expect(bacaNominal(MANDIRI)).toContain(4_000_457);
    expect(bacaNominal(DANA)).toContain(570_665);
    expect(bacaNominal('IDR 1,500,123.00')).toContain(1_500_123);
  });
  it('nominal dengan sen bukan nol tidak dianggap nominal paket', () => {
    expect(bacaNominal('Rp 1.500.123,50')).not.toContain(1_500_123);
  });
});

describe('bacaWaktu', () => {
  it('membaca tanggal + jam dalam WIB dari berbagai format', () => {
    expect(bacaWaktu(BCA).map((d) => d.toISOString())).toContain(wib('2026-11-23T10:15:32').toISOString());
    expect(bacaWaktu(MANDIRI).map((d) => d.toISOString())).toContain(wib('2026-11-23T09:48:00').toISOString());
    expect(bacaWaktu(DANA).map((d) => d.toISOString())).toContain(wib('2026-11-23T14:02:00').toISOString());
    expect(bacaWaktu('2026-11-23 10:15').map((d) => d.toISOString())).toContain(wib('2026-11-23T10:15:00').toISOString());
  });
  it('memperhitungkan WITA', () => {
    expect(bacaWaktu('23/11/2026 11:15 WITA')[0]!.toISOString()).toBe(wib('2026-11-23T10:15:00').toISOString());
  });
  it('tanggal tanpa jam dan tanggal tidak sah diabaikan', () => {
    expect(bacaWaktu('23/11/2026')).toEqual([]);
    expect(bacaWaktu('31/02/2026 10:00')).toEqual([]);
  });
});

describe('cocokkanBukti (nominal unik + jendela 1 jam)', () => {
  const dasar = {
    teks: BCA,
    totalRp: 1_500_123,
    dibuatPada: wib('2026-11-23T10:05:00'),
    diunggahPada: wib('2026-11-23T10:40:00'),
  };
  it('cocok: nominal sama persis dan transfer 25 menit sebelum diunggah', () => {
    expect(cocokkanBukti(dasar)).toEqual({ cocok: true, nominal: 1_500_123, waktu: wib('2026-11-23T10:15:32') });
  });
  it('nominal berbeda satu rupiah: tidak cocok', () => {
    expect(cocokkanBukti({ ...dasar, totalRp: 1_500_124 })).toEqual({ cocok: false, alasan: 'NOMINAL_TIDAK_DITEMUKAN' });
  });
  it('transfer lebih dari 1 jam sebelum diunggah: tidak cocok', () => {
    expect(cocokkanBukti({ ...dasar, dibuatPada: wib('2026-11-23T08:00:00'), diunggahPada: wib('2026-11-23T11:30:00') })).toEqual({
      cocok: false,
      alasan: 'WAKTU_DI_LUAR_JENDELA',
    });
  });
  it('waktu transfer sebelum pesanan dibuat (bukti lama dipakai ulang): tidak cocok', () => {
    expect(cocokkanBukti({ ...dasar, dibuatPada: wib('2026-11-23T10:30:00') })).toEqual({
      cocok: false,
      alasan: 'WAKTU_DI_LUAR_JENDELA',
    });
  });
  it('tanpa waktu terbaca: tidak cocok', () => {
    expect(cocokkanBukti({ ...dasar, teks: 'Rp 1.500.123' })).toEqual({ cocok: false, alasan: 'WAKTU_TIDAK_TERBACA' });
  });
});
