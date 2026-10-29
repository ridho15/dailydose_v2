'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Download, Maximize2 } from 'lucide-react';

/** QR tetap milik akun yang sedang masuk (`dd-pass:v1:…`). */
export async function ambilQrSaya(): Promise<string> {
  const res = await fetch('/api/v1/me/check-in-pass', { credentials: 'include' });
  if (!res.ok) throw new Error('QR_TIDAK_TERSEDIA');
  const data = (await res.json()) as { pass?: string };
  if (!data.pass) throw new Error('QR_TIDAK_TERSEDIA');
  return data.pass;
}

/**
 * Kartu QR kehadiran di beranda member dan instruktur. QR-nya sama setiap kali datang; staf di
 * meja check-in yang memindainya. Bisa disimpan ke galeri supaya tetap bisa dipakai tanpa sinyal.
 */
export function QrKehadiran({
  nama,
  peran,
  muat = ambilQrSaya,
}: {
  nama: string;
  peran: 'member' | 'instruktur';
  /** Hanya untuk tes. */
  muat?: () => Promise<string>;
}) {
  const kanvas = useRef<HTMLCanvasElement>(null);
  const [pass, setPass] = useState<string | null>(null);
  const [gagal, setGagal] = useState(false);
  const [tersimpan, setTersimpan] = useState(false);

  useEffect(() => {
    let batal = false;
    muat()
      .then((p) => !batal && setPass(p))
      .catch(() => !batal && setGagal(true));
    return () => {
      batal = true;
    };
  }, [muat]);

  useEffect(() => {
    if (!pass || !kanvas.current) return;
    void QRCode.toCanvas(kanvas.current, pass, {
      width: 168,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#111827', light: '#ffffff' },
    }).catch(() => undefined);
  }, [pass]);

  const simpan = () => {
    if (!kanvas.current) return;
    const tautan = document.createElement('a');
    tautan.download = 'daily-dose-qr-kehadiran.png';
    tautan.href = kanvas.current.toDataURL('image/png');
    tautan.click();
    setTersimpan(true);
  };

  return (
    <section
      aria-labelledby="qr-kehadiran-title"
      className="flex flex-col items-center gap-5 rounded-dd-xl border border-dd-line bg-white p-5 sm:flex-row sm:items-center"
    >
      <div className="grid size-[184px] shrink-0 place-items-center rounded-dd-lg border border-dd-line bg-white">
        {gagal ? (
          <p className="m-0 px-4 text-center text-sm text-dd-muted">
            QR belum bisa dimuat. Coba muat ulang halaman.
          </p>
        ) : (
          <canvas
            ref={kanvas}
            role="img"
            aria-label={`QR kehadiran ${nama}`}
            className={pass ? '' : 'opacity-0'}
          />
        )}
      </div>
      <div className="min-w-0 flex-1 text-center sm:text-left">
        <h2 id="qr-kehadiran-title" className="m-0 text-xl font-semibold text-dd-ink">
          QR kehadiran saya
        </h2>
        <p className="m-0 mt-1 text-[15px] text-dd-muted">
          {peran === 'instruktur'
            ? 'Tunjukkan ke staf di meja check-in saat tiba. Presensi mengajar dan honor tercatat dari sini.'
            : 'Tunjukkan ke staf di meja check-in saat datang. QR-nya sama setiap kali, tidak perlu buka tautan.'}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
          <button
            type="button"
            onClick={simpan}
            disabled={!pass}
            className="inline-flex min-h-11 items-center gap-2 rounded-dd-lg bg-dd-forest px-4 text-[15px] font-semibold text-white disabled:opacity-50"
          >
            <Download className="size-4" aria-hidden="true" />
            {tersimpan ? 'Tersimpan ✓' : 'Simpan ke galeri'}
          </button>
          <Link
            href="/check-in-pass"
            className="inline-flex min-h-11 items-center gap-2 rounded-dd-lg border border-dd-border-interactive bg-white px-4 text-[15px] font-semibold text-dd-ink no-underline hover:border-dd-forest"
          >
            <Maximize2 className="size-4" aria-hidden="true" />
            Perbesar
          </Link>
        </div>
      </div>
    </section>
  );
}
