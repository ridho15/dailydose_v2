'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { Camera, CameraOff, ScanLine } from 'lucide-react';
import type { HasilPindai } from '../../api-clients/check-in-desk-client';

/** Kode yang sama diabaikan selama ini, karena kamera membaca QR berkali-kali per detik. */
const JEDA_KODE_SAMA_MS = 5_000;
/** Lama hasil pindaian tampil sebelum diganti pesan siap. */
export const DURASI_HASIL_MS = 8_000;
const AWALAN_PASS = 'dd-pass:';

function jam(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

/** Hasil pindaian dalam kalimat untuk staf meja: apa yang terjadi dan apa yang perlu dilakukan. */
export function kalimatHasil(hasil: HasilPindai): {
  nada: 'berhasil' | 'info' | 'tolak';
  judul: string;
  isi: string;
} {
  const nama = hasil.orang?.nama ?? 'Pemilik QR ini';
  const tz = hasil.timezone;
  const kelas = hasil.kelas;
  const namaKelas = kelas?.namaKelas ?? 'kelas';
  if (hasil.tercatat && hasil.orang) {
    return {
      nada: 'berhasil',
      judul: `${nama} tercatat${hasil.orang.peran === 'INSTRUKTUR' ? ' (instruktur)' : ''}`,
      isi: kelas
        ? `${namaKelas} ${jam(kelas.mulai, tz)} sampai ${jam(kelas.selesai, tz)}${kelas.studio ? ` · ${kelas.studio}` : ''}.${
            hasil.orang.peran === 'INSTRUKTUR' ? ' Masuk ke hitungan honor.' : ''
          }`
        : 'Kehadiran tercatat.',
    };
  }
  switch (hasil.alasan) {
    case 'PASS_TIDAK_DIKENALI':
      return {
        nada: 'tolak',
        judul: 'QR tidak dikenali',
        isi: 'Bukan QR kehadiran Daily Dose. Minta orangnya membuka QR dari menu Akun di aplikasi, atau dari foto yang ia simpan.',
      };
    case 'AKUN_BERHENTI':
      return { nada: 'tolak', judul: 'Akun tidak aktif', isi: `Akun ${nama} sudah tidak aktif.` };
    case 'BELUM_WAKTUNYA':
      return {
        nada: 'tolak',
        judul: 'Belum waktunya',
        isi: kelas
          ? `${namaKelas} pukul ${jam(kelas.mulai, tz)} baru bisa dipindai mulai ${jam(
              new Date(
                new Date(kelas.mulai).getTime() - (hasil.bukaPadaMenitSebelum ?? 45) * 60_000,
              ).toISOString(),
              tz,
            )}.`
          : `Kelas ${nama} belum bisa dipindai sekarang.`,
      };
    case 'KELAS_SUDAH_LEWAT':
      return {
        nada: 'tolak',
        judul: 'Kelas sudah selesai',
        isi: kelas
          ? `${namaKelas} pukul ${jam(kelas.mulai, tz)} sudah selesai. Bila ${nama} tadi hadir, pakai "Catat kehadiran manual".`
          : `Kelas ${nama} sudah selesai. Pakai "Catat kehadiran manual" bila ia tadi hadir.`,
      };
    case 'SUDAH_TERCATAT':
      return {
        nada: 'info',
        judul: 'Sudah tercatat',
        isi: kelas
          ? `${nama} sudah tercatat untuk ${namaKelas} pukul ${jam(kelas.mulai, tz)}. Tidak perlu dipindai lagi.`
          : `${nama} sudah tercatat. Tidak perlu dipindai lagi.`,
      };
    case 'TIDAK_ADA_KELAS':
    default:
      return {
        nada: 'tolak',
        judul: 'Tidak ada kelas',
        isi: `${nama} tidak punya kelas di ${hasil.namaCabang} sekitar jam ini. QR-nya benar, tetapi jadwalnya tidak cocok, jadi dihitung tidak hadir.`,
      };
  }
}

/** Fokus sedang di kolom isian lain (alasan, catatan): ketikan itu milik staf, bukan pemindai. */
function sedangMengetik(target: EventTarget | null, kolomPindai: HTMLInputElement | null) {
  if (!(target instanceof HTMLElement) || target === kolomPindai) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

const GAYA = {
  berhasil: 'border-dd-forest bg-dd-success-soft text-dd-forest',
  info: 'border-dd-line bg-white text-dd-ink',
  tolak: 'border-dd-danger/50 bg-dd-danger-soft text-dd-danger',
} as const;

/**
 * Pemindai di meja check-in. Barcode scanner (USB/Bluetooth) mengetik isi QR lalu Enter, seperti
 * papan ketik; kolom pindai selalu siap, dan ketikan pemindai tetap tertangkap walau fokus sedang
 * di tombol lain. Kamera perangkat bisa dinyalakan bila tidak ada barcode scanner.
 */
export function PemindaiMeja({
  pindai,
  onTercatat,
  kameraTersedia = true,
}: {
  pindai(pass: string): Promise<HasilPindai>;
  onTercatat(hasil: HasilPindai): void;
  /** Hanya untuk tes: sembunyikan tombol kamera. */
  kameraTersedia?: boolean;
}) {
  const kolom = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const kontrol = useRef<IScannerControls | undefined>(undefined);
  const terakhir = useRef<{ kode: string; pada: number } | null>(null);
  const sibuk = useRef(false);
  const ketikan = useRef('');
  const timer = useRef<number | undefined>(undefined);

  const [isi, setIsi] = useState('');
  const [hasil, setHasil] = useState<HasilPindai | null>(null);
  const [gangguan, setGangguan] = useState('');
  const [kamera, setKamera] = useState<'mati' | 'menyala' | 'gagal'>('mati');

  const kirim = useCallback(
    async (kode: string) => {
      const bersih = kode.trim();
      if (!bersih || sibuk.current) return;
      const kini = Date.now();
      if (terakhir.current?.kode === bersih && kini - terakhir.current.pada < JEDA_KODE_SAMA_MS)
        return;
      terakhir.current = { kode: bersih, pada: kini };
      sibuk.current = true;
      setGangguan('');
      try {
        const jawaban = await pindai(bersih);
        window.clearTimeout(timer.current);
        setHasil(jawaban);
        timer.current = window.setTimeout(() => setHasil(null), DURASI_HASIL_MS);
        if (jawaban.tercatat) onTercatat(jawaban);
      } catch {
        setGangguan('Pindaian belum terkirim. Periksa koneksi internet, lalu pindai lagi.');
        terakhir.current = null;
      } finally {
        sibuk.current = false;
        setIsi('');
        kolom.current?.focus({ preventScroll: true });
      }
    },
    [onTercatat, pindai],
  );

  // Ketikan pemindai saat fokus tidak berada di kolom isian mana pun (mis. setelah menekan tombol).
  useEffect(() => {
    const tekan = (event: KeyboardEvent) => {
      if (event.target === kolom.current || sedangMengetik(event.target, kolom.current)) {
        ketikan.current = '';
        return;
      }
      if (event.key === 'Enter') {
        const teks = ketikan.current;
        ketikan.current = '';
        if (teks.startsWith(AWALAN_PASS)) void kirim(teks);
        return;
      }
      if (event.key.length === 1) ketikan.current = (ketikan.current + event.key).slice(-300);
    };
    window.addEventListener('keydown', tekan);
    return () => window.removeEventListener('keydown', tekan);
  }, [kirim]);

  useEffect(() => {
    if (kamera !== 'menyala' || !video.current) return;
    let batal = false;
    const reader = new BrowserMultiFormatReader();
    reader
      .decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } } },
        video.current,
        (decoded) => {
          const teks = decoded?.getText();
          if (teks) void kirim(teks);
        },
      )
      .then((c) => {
        if (batal) c.stop();
        else kontrol.current = c;
      })
      .catch(() => setKamera('gagal'));
    return () => {
      batal = true;
      kontrol.current?.stop();
      kontrol.current = undefined;
    };
  }, [kamera, kirim]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const serahkan = (event: FormEvent) => {
    event.preventDefault();
    void kirim(isi);
  };

  const pesan = hasil ? kalimatHasil(hasil) : null;

  return (
    <section
      aria-labelledby="pindai-title"
      className="rounded-dd-lg border border-dd-line bg-white p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="pindai-title"
          className="m-0 flex items-center gap-2 text-lg font-semibold text-dd-ink"
        >
          <ScanLine className="size-5 text-dd-forest" aria-hidden="true" />
          Pindai QR member atau instruktur
        </h2>
        {kameraTersedia && (
          <button
            type="button"
            onClick={() => setKamera((k) => (k === 'menyala' ? 'mati' : 'menyala'))}
            className="inline-flex min-h-11 items-center gap-2 rounded-dd-lg border border-dd-border-interactive bg-white px-4 text-[15px] font-semibold text-dd-ink hover:border-dd-forest"
          >
            {kamera === 'menyala' ? (
              <CameraOff className="size-4" aria-hidden="true" />
            ) : (
              <Camera className="size-4" aria-hidden="true" />
            )}
            {kamera === 'menyala' ? 'Matikan kamera' : 'Pakai kamera'}
          </button>
        )}
      </div>
      <form onSubmit={serahkan} className="mt-3 flex gap-2">
        <input
          ref={kolom}
          // Fokus otomatis: layar ini memang untuk memindai, barcode scanner langsung mengetik di sini.
          autoFocus
          value={isi}
          onChange={(e) => setIsi(e.target.value)}
          aria-label="Isi QR"
          placeholder="Arahkan barcode scanner ke QR; isinya masuk di sini"
          autoComplete="off"
          className="min-h-12 min-w-0 flex-1 rounded-dd-lg border border-dd-border-interactive bg-white px-4 text-[15px] text-dd-ink"
        />
        <button
          type="submit"
          disabled={!isi.trim()}
          className="min-h-12 rounded-dd-lg bg-dd-forest px-5 text-[15px] font-semibold text-white disabled:opacity-50"
        >
          Catat
        </button>
      </form>
      {kamera !== 'mati' && (
        <div className="relative mt-3 overflow-hidden rounded-dd-lg bg-dd-ink">
          <video ref={video} muted playsInline className="aspect-video w-full object-cover" />
          {kamera === 'gagal' && (
            <p className="absolute inset-0 m-0 grid place-items-center p-4 text-center text-[15px] text-white">
              Kamera tidak bisa dibuka. Izinkan akses kamera di browser, atau pakai barcode scanner.
            </p>
          )}
        </div>
      )}
      <div aria-live="assertive" aria-atomic="true" className="mt-3">
        {gangguan ? (
          <p className={`m-0 rounded-dd-lg border p-3 text-[15px] ${GAYA.tolak}`}>{gangguan}</p>
        ) : pesan ? (
          <div className={`rounded-dd-lg border p-3 ${GAYA[pesan.nada]}`}>
            <p className="m-0 text-[16px] font-semibold">{pesan.judul}</p>
            <p className="m-0 mt-0.5 text-[15px] text-dd-ink">{pesan.isi}</p>
          </div>
        ) : (
          <p className="m-0 text-[15px] text-dd-muted">
            Siap memindai. Hanya orang yang punya kelas di cabang ini pada jamnya yang tercatat.
          </p>
        )}
      </div>
    </section>
  );
}
