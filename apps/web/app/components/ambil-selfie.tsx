'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Camera } from 'lucide-react';

/**
 * Ambil atau ganti foto selfie. Di ponsel kamera depan langsung terbuka; di laptop memilih berkas.
 * Dipakai halaman verifikasi member dan beranda instruktur.
 */
export function AmbilSelfie({
  kirim,
  labelTombol = 'Simpan foto selfie',
  onTersimpan,
}: {
  kirim(file: File): Promise<unknown>;
  labelTombol?: string;
  onTersimpan?(): void;
}) {
  const [foto, setFoto] = useState<File | null>(null);
  const [pratinjau, setPratinjau] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState('');

  useEffect(() => {
    if (!foto || typeof URL.createObjectURL !== 'function') {
      setPratinjau(null);
      return;
    }
    const url = URL.createObjectURL(foto);
    setPratinjau(url);
    return () => URL.revokeObjectURL(url);
  }, [foto]);

  const simpan = async (event: FormEvent) => {
    event.preventDefault();
    if (!foto) return;
    if (foto.size > 8_000_000) {
      setGalat('Ukuran foto maksimal 8 MB.');
      return;
    }
    setSibuk(true);
    setGalat('');
    try {
      await kirim(foto);
      setFoto(null);
      onTersimpan?.();
    } catch {
      setGalat('Foto belum tersimpan. Periksa koneksi, lalu coba lagi.');
    } finally {
      setSibuk(false);
    }
  };

  return (
    <form onSubmit={simpan} className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <div className="grid size-28 shrink-0 place-items-center overflow-hidden rounded-full border border-dd-line bg-dd-surface-muted">
          {pratinjau ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={pratinjau} alt="Pratinjau foto selfie" className="size-full object-cover" />
          ) : (
            <Camera className="size-8 text-dd-muted" aria-hidden="true" />
          )}
        </div>
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-dd-lg border border-dd-border-interactive bg-white px-4 text-[15px] font-semibold text-dd-ink hover:border-dd-forest">
          <Camera className="size-4" aria-hidden="true" />
          {foto ? 'Ambil ulang' : 'Ambil foto sekarang'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="user"
            className="sr-only"
            aria-label="Pilih foto selfie"
            onChange={(e) => setFoto(e.target.files?.[0] ?? null)}
          />
        </label>
      </div>
      <p className="m-0 text-sm text-dd-muted">
        Cukup wajah terlihat jelas dan tidak gelap. Dipakai staf untuk mengenali Anda saat datang;
        tidak ditampilkan ke member lain.
      </p>
      {galat && (
        <p role="alert" className="m-0 text-sm font-semibold text-dd-danger">
          {galat}
        </p>
      )}
      <button
        type="submit"
        disabled={!foto || sibuk}
        className="min-h-11 rounded-dd-lg bg-dd-forest px-5 text-[15px] font-semibold text-white disabled:opacity-50"
      >
        {sibuk ? 'Menyimpan…' : labelTombol}
      </button>
    </form>
  );
}
