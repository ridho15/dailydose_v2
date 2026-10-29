'use client';

import { useEffect, useId, useState } from 'react';
import { Star } from 'lucide-react';
import {
  browserUlasanInstrukturClient,
  type UlasanInstrukturClient,
  type UlasanTertunda,
} from '@/api-clients/ulasan-instruktur-client';
import { Button } from '../actions';
import { Textarea } from '../forms';

const LABEL_BINTANG = ['Kurang', 'Cukup', 'Baik', 'Sangat baik', 'Luar biasa'] as const;
const MAKS_KOMENTAR = 1000;

function waktuKelas(item: UlasanTertunda) {
  try {
    return new Intl.DateTimeFormat('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: item.timezone,
    }).format(new Date(item.mulai));
  } catch {
    return '';
  }
}

/**
 * Meminta member menilai instruktur kelas yang baru ia hadiri: bintang 1-5 dan catatan opsional.
 * Tampil di beranda member dan di lembar booking; tidak tampil apa pun bila tidak ada yang tertunda.
 * Hasilnya hanya dibaca tim studio.
 */
export function UlasanInstruktur({
  client = browserUlasanInstrukturClient,
  ringkas = false,
}: {
  client?: Pick<UlasanInstrukturClient, 'tertunda' | 'kirim'>;
  /** Versi rapat untuk lembar booking. */
  ringkas?: boolean;
}) {
  const [antrean, setAntrean] = useState<UlasanTertunda[] | null>(null);
  const [rating, setRating] = useState(0);
  const [komentar, setKomentar] = useState('');
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState('');
  const [terkirim, setTerkirim] = useState(false);
  const judulId = useId();
  // Di lembar booking, judul utamanya nama kelas yang akan dipesan.
  const Judul = ringkas ? 'h3' : 'h2';

  useEffect(() => {
    let batal = false;
    Promise.resolve()
      .then(() => client.tertunda())
      .then((items) => !batal && setAntrean(items))
      .catch(() => !batal && setAntrean([]));
    return () => {
      batal = true;
    };
  }, [client]);

  const item = antrean?.[0];
  if (!item) {
    return terkirim ? (
      <p role="status" className="m-0 text-sm font-semibold text-dd-forest">
        Terima kasih, ulasan Anda sudah kami terima.
      </p>
    ) : null;
  }

  const lanjut = () => {
    setAntrean((a) => (a ? a.slice(1) : a));
    setRating(0);
    setKomentar('');
  };

  const kirim = async (lewati: boolean) => {
    setSibuk(true);
    setGalat('');
    try {
      const catatan = komentar.trim();
      await client.kirim(
        lewati
          ? { bookingId: item.bookingId, skip: true }
          : { bookingId: item.bookingId, rating, ...(catatan ? { comment: catatan } : {}) },
      );
      setTerkirim(!lewati);
      lanjut();
    } catch {
      setGalat('Ulasan belum terkirim. Coba lagi sebentar.');
    } finally {
      setSibuk(false);
    }
  };

  return (
    <section
      aria-labelledby={judulId}
      className={`rounded-dd-xl border border-dd-line bg-white ${ringkas ? 'p-4' : 'p-5'}`}
    >
      <Judul id={judulId} className="m-0 text-base font-semibold text-dd-ink">
        Bagaimana kelas bersama {item.namaInstruktur}?
      </Judul>
      <p className="mt-1 mb-0 text-sm text-dd-muted">
        {item.namaKelas} · {waktuKelas(item)}
        {item.namaCabang ? ` · ${item.namaCabang}` : ''}
      </p>

      <fieldset className="mt-3 border-0 p-0" disabled={sibuk}>
        <legend className="sr-only">Nilai untuk {item.namaInstruktur}</legend>
        <div className="flex items-center gap-1">
          {LABEL_BINTANG.map((label, i) => {
            const nilai = i + 1;
            const nyala = nilai <= rating;
            return (
              <label
                key={label}
                className="cursor-pointer rounded-dd-sm p-1 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-dd-forest"
              >
                <input
                  type="radio"
                  name={`rating-${item.bookingId}`}
                  value={nilai}
                  checked={rating === nilai}
                  onChange={() => setRating(nilai)}
                  className="sr-only"
                  aria-label={`${nilai} bintang, ${label}`}
                />
                <Star
                  aria-hidden="true"
                  className={`size-8 ${nyala ? 'fill-dd-brass text-dd-brass' : 'text-dd-line'}`}
                  strokeWidth={1.5}
                />
              </label>
            );
          })}
          <span className="ml-2 text-sm font-semibold text-dd-ink" aria-hidden="true">
            {rating ? LABEL_BINTANG[rating - 1] : ''}
          </span>
        </div>
      </fieldset>

      {rating > 0 && (
        <Textarea
          label="Catatan (opsional)"
          wrapperClassName="mt-3"
          className="min-h-20"
          maxLength={MAKS_KOMENTAR}
          value={komentar}
          disabled={sibuk}
          onChange={(e) => setKomentar(e.target.value)}
          placeholder="Apa yang paling membantu, atau yang bisa lebih baik?"
        />
      )}

      {galat && (
        <p role="alert" className="mt-2 mb-0 text-sm text-dd-danger">
          {galat}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={sibuk || rating === 0} onClick={() => void kirim(false)}>
          Kirim ulasan
        </Button>
        <Button size="sm" variant="ghost" disabled={sibuk} onClick={() => void kirim(true)}>
          Lewati
        </Button>
        <span className="text-xs text-dd-muted">Hanya dibaca tim studio.</span>
      </div>
    </section>
  );
}
