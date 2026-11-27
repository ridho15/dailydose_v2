import { adaNominal, bacaNominal, bacaTanggal, bacaWaktu, cocokkanBukti, rapikanTeksOcr } from './ocr-bukti';

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
  it('salah baca OCR di sekitar angka dirapikan', () => {
    expect(rapikanTeksOcr('Rp 1. 500. 123, 00')).toBe('Rp 1.500.123,00');
    expect(bacaNominal('Rp 1. 500. 123, 00')).toContain(1_500_123);
    expect(bacaNominal('Rp1.5O0.l23')).toContain(1_500_123);
    expect(bacaNominal('Rp 1 500 123')).toContain(1_500_123);
    expect(bacaNominal('Biaya Admin Rpo')).not.toContain(1_500_123);
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
  it('pemisah tanggal-jam dari berbagai aplikasi dan jam tanpa titik dua', () => {
    const t = wib('2026-11-23T10:15:32').toISOString();
    for (const teks of ['23 Nov 2026 » 10:15:32 WIB', '23 Nov 2026 • 10:15:32', '23 Nov 2026 + 10:15:32', '23/11/2026 | 10:15:32'])
      expect(bacaWaktu(teks).map((d) => d.toISOString())).toContain(t);
    expect(bacaWaktu('23 Nov 2026, 1015').map((d) => d.toISOString())).toContain(wib('2026-11-23T10:15:00').toISOString());
  });
  it('tanggal tanpa tahun memakai tahun dari waktu unggah', () => {
    const acuan = wib('2026-11-23T10:40:00');
    expect(bacaWaktu('23 Nov, 10:15', acuan).map((d) => d.toISOString())).toContain(wib('2026-11-23T10:15:00').toISOString());
    expect(bacaWaktu('23/11 10:15', acuan).map((d) => d.toISOString())).toContain(wib('2026-11-23T10:15:00').toISOString());
    expect(bacaWaktu('23 Nov, 10:15')).toEqual([]);
    // Unggah 1 Januari, transfer 31 Desember: tahun sebelumnya.
    expect(bacaWaktu('31 Des, 23:50', wib('2027-01-01T00:10:00'))[0]!.toISOString()).toBe(wib('2026-12-31T23:50:00').toISOString());
  });
  it('tanggal tanpa jam dibaca sebagai rentang satu hari', () => {
    expect(bacaTanggal('Tanggal 23/11/2026')[0]).toEqual({ mulai: wib('2026-11-23T00:00:00'), akhir: new Date(wib('2026-11-24T00:00:00').getTime() - 1) });
    expect(bacaTanggal('23 November 2026')).toHaveLength(1);
  });
  it('memperhitungkan WITA', () => {
    expect(bacaWaktu('23/11/2026 11:15 WITA')[0]!.toISOString()).toBe(wib('2026-11-23T10:15:00').toISOString());
  });
  it('tanggal tanpa jam dan tanggal tidak sah diabaikan', () => {
    expect(bacaWaktu('23/11/2026')).toEqual([]);
    expect(bacaWaktu('31/02/2026 10:00')).toEqual([]);
  });
});

describe('adaNominal', () => {
  it('membandingkan digit sesudah Rp/IDR bila pemisahnya terbaca aneh', () => {
    expect(adaNominal('Rp1500.123', 1_500_123)).toBe(true);
    expect(adaNominal('Rp 1.500.12300', 1_500_123)).toBe(true);
    expect(adaNominal('Rp 1.500.124', 1_500_123)).toBe(false);
    // Nomor rekening/referensi yang kebetulan memuat digit nominal tidak dihitung.
    expect(adaNominal('No. Ref: 9915001230', 1_500_123)).toBe(false);
  });
});

describe('cocokkanBukti (nominal unik + waktu antara pesanan dibuat dan bukti diunggah)', () => {
  const dasar = {
    teks: BCA,
    totalRp: 1_500_123,
    dibuatPada: wib('2026-11-23T10:05:00'),
    diunggahPada: wib('2026-11-23T10:40:00'),
  };
  it('cocok: nominal sama persis dan jam transfer sesudah pesanan dibuat', () => {
    expect(cocokkanBukti(dasar)).toEqual({ cocok: true, nominal: 1_500_123, waktu: wib('2026-11-23T10:15:32'), dasarWaktu: 'JAM' });
  });
  it('nominal berbeda satu rupiah: tidak cocok', () => {
    expect(cocokkanBukti({ ...dasar, totalRp: 1_500_124 })).toEqual({ cocok: false, alasan: 'NOMINAL_TIDAK_DITEMUKAN' });
  });
  it('bukti diunggah terlambat (lebih dari 1 jam sesudah transfer): tetap cocok', () => {
    expect(cocokkanBukti({ ...dasar, dibuatPada: wib('2026-11-23T08:00:00'), diunggahPada: wib('2026-11-23T15:30:00') })).toMatchObject({
      cocok: true,
      dasarWaktu: 'JAM',
    });
  });
  it('waktu transfer sebelum pesanan dibuat (bukti lama dipakai ulang): tidak cocok', () => {
    expect(cocokkanBukti({ ...dasar, dibuatPada: wib('2026-11-23T10:30:00') })).toEqual({
      cocok: false,
      alasan: 'WAKTU_DI_LUAR_JENDELA',
    });
  });
  it('tanpa jam, tanggal di hari pesanan: cocok; tanggal lain: tidak cocok', () => {
    expect(cocokkanBukti({ ...dasar, teks: 'Rp 1.500.123\nTanggal 23/11/2026' })).toMatchObject({ cocok: true, dasarWaktu: 'TANGGAL' });
    expect(cocokkanBukti({ ...dasar, teks: 'Rp 1.500.123\nTanggal 20/11/2026' })).toEqual({ cocok: false, alasan: 'WAKTU_DI_LUAR_JENDELA' });
  });
  it('tanpa jam dan tanggal: cocok hanya bila layar menyatakan transfer berhasil', () => {
    expect(cocokkanBukti({ ...dasar, teks: 'Transfer Sukses\nRp 1.500.123' })).toMatchObject({ cocok: true, dasarWaktu: 'KATA_BERHASIL' });
    expect(cocokkanBukti({ ...dasar, teks: 'Konfirmasi Transfer\nRp 1.500.123' })).toEqual({ cocok: false, alasan: 'WAKTU_TIDAK_TERBACA' });
  });
  it('jam di luar rentang menang atas kata berhasil', () => {
    expect(cocokkanBukti({ ...dasar, teks: 'Transfer Berhasil\n20/11/2026 10:15 WIB\nRp 1.500.123' })).toEqual({
      cocok: false,
      alasan: 'WAKTU_DI_LUAR_JENDELA',
    });
  });
});
