'use client';

import { ChevronLeft, ChevronRight, Copy } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  availabilityFailure,
  type AvailabilityClient,
  type AvailabilityWindow,
} from '@/api-clients/availability-client';
import { localDateKey, zonedLocalDateTime } from '@/lib/class-time';
import { Button } from '../../components/actions';
import { useAppFeedback } from '../../components/app-feedback';

/** Tiga blok jam yang dipilih instruktur; tiap blok disimpan sebagai satu baris ketersediaan. */
export const BLOK_JAM = [
  { kode: 'PAGI', label: 'Pagi', mulai: '07:00', selesai: '11:00' },
  { kode: 'SIANG', label: 'Siang', mulai: '11:00', selesai: '15:00' },
  { kode: 'SORE', label: 'Sore', mulai: '15:00', selesai: '20:00' },
] as const;
type KodeBlok = (typeof BLOK_JAM)[number]['kode'];

const HARI_MS = 86_400_000;

function tambahHari(dateKey: string, hari: number) {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + hari * HARI_MS).toISOString().slice(0, 10);
}

function seninDari(dateKey: string) {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  const geser = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return tambahHari(dateKey, -geser);
}

const sel = (tanggal: string, blok: KodeBlok) => `${tanggal}|${blok}`;

/** Blok mana yang dicakup sebuah ketersediaan: blok yang jam mulainya ada di dalam rentang itu. */
export function blokTerisi(items: AvailabilityWindow[], timeZone: string) {
  const hasil = new Set<string>();
  for (const item of items) {
    if (item.status !== 'ACTIVE') continue;
    const tanggal = localDateKey(item.startAt, timeZone);
    for (const blok of BLOK_JAM) {
      const mulai = zonedLocalDateTime(tanggal, blok.mulai, timeZone);
      if (mulai >= item.startAt && mulai < item.endAt) hasil.add(sel(tanggal, blok.kode));
    }
  }
  return hasil;
}

/**
 * Isi ketersediaan seminggu dengan beberapa klik: tekan kotak hari x Pagi/Siang/Sore, atau salin
 * dari minggu lalu, lalu kirim. Tiap kotak menjadi satu baris di tabel ketersediaan yang sudah ada.
 */
export function GridKetersediaan({
  client,
  branch,
  onTersimpan,
  now = Date.now,
}: {
  client: AvailabilityClient;
  branch: { id: string; name: string; timezone: string };
  onTersimpan(): void;
  now?: () => number;
}) {
  const feedback = useAppFeedback();
  const hariIni = localDateKey(new Date(now()), branch.timezone);
  // Bawaan minggu depan: jadwal biasanya disusun untuk minggu berikutnya.
  const [awal, setAwal] = useState(() => tambahHari(seninDari(hariIni), 7));
  const [ada, setAda] = useState<Set<string>>(new Set());
  const [mingguLalu, setMingguLalu] = useState<Set<string>>(new Set());
  const [dipilih, setDipilih] = useState<Set<string>>(new Set());
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState('');

  const hari = useMemo(() => Array.from({ length: 7 }, (_, i) => tambahHari(awal, i)), [awal]);

  const muat = useCallback(async () => {
    try {
      const page = await client.list({
        branchId: branch.id,
        from: zonedLocalDateTime(tambahHari(awal, -7), '00:00', branch.timezone).toISOString(),
        until: zonedLocalDateTime(tambahHari(awal, 6), '23:59', branch.timezone).toISOString(),
      });
      const terisi = blokTerisi(page.items, branch.timezone);
      setAda(new Set([...terisi].filter((k) => k >= awal)));
      // Minggu lalu dipetakan ke tanggal minggu ini (+7 hari) supaya bisa disalin.
      setMingguLalu(
        new Set(
          [...terisi]
            .filter((k) => k < awal)
            .map((k) => {
              const [tanggal, blok] = k.split('|') as [string, KodeBlok];
              return sel(tambahHari(tanggal, 7), blok);
            }),
        ),
      );
      setGalat('');
    } catch (error) {
      setGalat(availabilityFailure(error) ?? 'Ketersediaan belum bisa dimuat. Periksa koneksi, lalu coba lagi.');
    }
  }, [awal, branch.id, branch.timezone, client]);

  useEffect(() => {
    setDipilih(new Set());
    void muat();
  }, [muat]);

  const lewat = (tanggal: string, blok: (typeof BLOK_JAM)[number]) =>
    zonedLocalDateTime(tanggal, blok.mulai, branch.timezone).getTime() <= now();

  const salinan = [...mingguLalu].filter((k) => {
    const [tanggal, kode] = k.split('|') as [string, KodeBlok];
    const blok = BLOK_JAM.find((b) => b.kode === kode)!;
    return !ada.has(k) && !lewat(tanggal, blok);
  });

  const ubah = (kunci: string) =>
    setDipilih((lama) => {
      const baru = new Set(lama);
      if (baru.has(kunci)) baru.delete(kunci);
      else baru.add(kunci);
      return baru;
    });

  const kirim = async () => {
    setSibuk(true);
    setGalat('');
    let terkirim = 0;
    try {
      for (const kunci of [...dipilih].sort()) {
        const [tanggal, kode] = kunci.split('|') as [string, KodeBlok];
        const blok = BLOK_JAM.find((b) => b.kode === kode)!;
        await client.create({
          branchId: branch.id,
          startAt: zonedLocalDateTime(tanggal, blok.mulai, branch.timezone),
          endAt: zonedLocalDateTime(tanggal, blok.selesai, branch.timezone),
        });
        terkirim += 1;
      }
      feedback.showToast({
        tone: 'success',
        title: 'Ketersediaan terkirim',
        message: `${terkirim} blok jam di ${branch.name} sudah terlihat oleh admin.`,
      });
      setDipilih(new Set());
      await muat();
      onTersimpan();
    } catch (error) {
      setGalat(
        `${terkirim > 0 ? `${terkirim} blok sudah terkirim. ` : ''}${availabilityFailure(error) ?? 'Pengiriman terputus.'} Tekan Kirim lagi untuk sisanya.`,
      );
      await muat();
    } finally {
      setSibuk(false);
    }
  };

  const labelHari = (tanggal: string, panjang = false) =>
    new Intl.DateTimeFormat('id-ID', {
      weekday: panjang ? 'long' : 'short',
      day: 'numeric',
      month: 'short',
      timeZone: branch.timezone,
    }).format(zonedLocalDateTime(tanggal, '12:00', branch.timezone));

  return (
    <section aria-labelledby="grid-ketersediaan" className="space-y-4 rounded-2xl border border-dd-line/80 bg-white p-5">
      <div className="space-y-1">
        <h2 id="grid-ketersediaan" className="m-0 text-lg font-semibold text-dd-ink">
          Kapan Anda bisa mengajar?
        </h2>
        <p className="m-0 text-base text-dd-muted">
          Tekan kotak hari dan jam, lalu Kirim. Pagi 07.00 sampai 11.00, Siang 11.00 sampai 15.00, Sore 15.00 sampai 20.00.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2" aria-label="Pilih minggu">
        <button
          type="button"
          aria-label="Minggu sebelumnya"
          onClick={() => setAwal((a) => tambahHari(a, -7))}
          disabled={awal <= seninDari(hariIni)}
          className="grid size-12 place-items-center rounded-dd-md border border-dd-border-interactive bg-white text-dd-ink disabled:opacity-40"
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>
        <p className="m-0 min-w-0 flex-1 text-center text-base font-semibold text-dd-ink" aria-live="polite">
          {labelHari(hari[0]!)} sampai {labelHari(hari[6]!)}
        </p>
        <button
          type="button"
          aria-label="Minggu berikutnya"
          onClick={() => setAwal((a) => tambahHari(a, 7))}
          className="grid size-12 place-items-center rounded-dd-md border border-dd-border-interactive bg-white text-dd-ink"
        >
          <ChevronRight className="size-5" aria-hidden="true" />
        </button>
      </div>

      {salinan.length > 0 && (
        <Button
          variant="secondary"
          size="lg"
          fullWidth
          leadingIcon={<Copy className="size-5" aria-hidden="true" />}
          className="text-base"
          onClick={() => setDipilih((lama) => new Set([...lama, ...salinan]))}
        >
          Sama seperti minggu lalu ({salinan.length} blok)
        </Button>
      )}

      <div role="grid" aria-label="Ketersediaan per hari" className="grid gap-2">
        {hari.map((tanggal) => (
          <div role="row" key={tanggal} className="grid grid-cols-[minmax(84px,1fr)_repeat(3,minmax(0,1fr))] items-center gap-2">
            <span role="rowheader" className="text-base font-semibold text-dd-ink">
              {labelHari(tanggal)}
            </span>
            {BLOK_JAM.map((blok) => {
              const kunci = sel(tanggal, blok.kode);
              const sudah = ada.has(kunci);
              const pilih = dipilih.has(kunci);
              const tutup = sudah || lewat(tanggal, blok);
              return (
                <button
                  key={blok.kode}
                  type="button"
                  role="gridcell"
                  aria-pressed={sudah || pilih}
                  aria-label={`${labelHari(tanggal, true)} ${blok.label}${sudah ? ', sudah diajukan' : ''}`}
                  disabled={tutup || sibuk}
                  onClick={() => ubah(kunci)}
                  className={`min-h-12 rounded-dd-md border-2 px-1 text-base font-semibold transition-colors motion-reduce:transition-none ${
                    sudah
                      ? 'border-dd-forest bg-dd-forest text-white'
                      : pilih
                        ? 'border-dd-forest bg-dd-success-soft text-dd-forest'
                        : tutup
                          ? 'border-dd-line bg-dd-surface-muted text-dd-muted'
                          : 'border-dd-line bg-white text-dd-ink hover:border-dd-forest'
                  }`}
                >
                  {blok.label}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {galat && (
        <p role="alert" className="m-0 rounded-dd-lg border border-dd-danger/40 bg-dd-danger-soft p-3 text-base text-dd-danger">
          {galat}
        </p>
      )}

      <Button
        size="lg"
        fullWidth
        disabled={dipilih.size === 0}
        loading={sibuk}
        loadingLabel="Mengirim…"
        className="text-base"
        onClick={() => void kirim()}
      >
        {dipilih.size > 0 ? `Kirim ${dipilih.size} blok jam` : 'Pilih kotak dulu'}
      </Button>
    </section>
  );
}
