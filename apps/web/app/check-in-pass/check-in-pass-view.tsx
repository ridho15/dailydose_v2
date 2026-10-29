'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import QRCode from 'qrcode';
import { AlertCircle, ArrowLeft, CalendarX2, Check, Clock, Download, QrCode } from 'lucide-react';
import { useSessionContext } from '../session-context';

function formatPassSchedule(startAtStr: string, endAtStr: string, timezone = 'Asia/Jakarta') {
  try {
    const start = new Date(startAtStr);
    const end = new Date(endAtStr);
    if (isNaN(start.getTime())) return null;

    const dateFormatted = new Intl.DateTimeFormat('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: timezone,
    }).format(start);

    const startTime = new Intl.DateTimeFormat('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: timezone,
    }).format(start);

    const endTime = isNaN(end.getTime())
      ? ''
      : new Intl.DateTimeFormat('id-ID', {
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
          timeZone: timezone,
        }).format(end);

    return {
      date: dateFormatted,
      time: endTime ? `${startTime} - ${endTime} WIB` : `${startTime} WIB`,
    };
  } catch {
    return null;
  }
}

/** QR baru dapat dipindai 30 menit sebelum kelas (sama dengan aturan pemindaian di server). */
const OPENS_BEFORE_MS = 30 * 60_000;
const QR_UNAVAILABLE = 'Pass QR tidak valid atau sudah tidak tersedia.';

interface PassInfo {
  className: string;
  studioName: string;
  instructorName: string | null;
  startAt: string;
  endAt: string;
  timezone: string;
}

type PassWindow = 'TOO_EARLY' | 'OPEN' | 'ENDED';

export function passWindow(
  info: Pick<PassInfo, 'startAt' | 'endAt'>,
  now: number,
): PassWindow | null {
  const start = new Date(info.startAt).getTime();
  const end = new Date(info.endAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  if (now < start - OPENS_BEFORE_MS) return 'TOO_EARLY';
  return now < end ? 'OPEN' : 'ENDED';
}

function formatOpensAt(startAt: string, timezone: string) {
  const opens = new Date(new Date(startAt).getTime() - OPENS_BEFORE_MS);
  return new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: timezone,
  })
    .format(opens)
    .replace(':', '.');
}

type IssuedPass = {
  qrPayload?: string;
  token?: string;
  className?: string;
  branchName?: string;
  studioName?: string | null;
  instructorName?: string | null;
  startAt?: string;
  endAt?: string;
  timezone?: string;
};

function infoFrom(data: IssuedPass): PassInfo | null {
  if (!data.className || !data.startAt || !data.endAt) return null;
  return {
    className: data.className,
    studioName: data.studioName ?? data.branchName ?? '',
    instructorName: data.instructorName ?? null,
    startAt: data.startAt,
    endAt: data.endAt,
    timezone: data.timezone ?? 'Asia/Jakarta',
  };
}

async function issuePass(bookingId: string): Promise<IssuedPass> {
  const res = await fetch(
    `/api/v1/bookings/${encodeURIComponent(bookingId)}/customer-check-in-links`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
    },
  );
  if (!res.ok) throw new Error('CHECKIN_UNAVAILABLE');
  return (await res.json()) as IssuedPass;
}

/** QR tetap milik akun yang sedang masuk; sama untuk setiap kelas. */
async function staticPass(): Promise<string> {
  const res = await fetch('/api/v1/me/check-in-pass', { credentials: 'include' });
  if (!res.ok) throw new Error('PASS_UNAVAILABLE');
  const data = (await res.json()) as { pass?: string };
  return data.pass ?? '';
}

/** Booking mendatang terdekat milik pelanggan, untuk halaman yang dibuka tanpa memilih booking. */
async function nearestBookingId(): Promise<string | null> {
  const res = await fetch('/api/v1/me/dashboard', { credentials: 'include' });
  if (!res.ok) throw new Error('DASHBOARD_UNAVAILABLE');
  const data = (await res.json()) as { upcomingBookings?: Array<{ id: string; status?: string }> };
  return (
    data.upcomingBookings?.find((booking) => !booking.status || booking.status === 'BOOKED')?.id ??
    null
  );
}

async function linkInfo(rawToken: string): Promise<PassInfo | null> {
  const res = await fetch(
    `/api/v1/check-ins/customer-link-info?token=${encodeURIComponent(rawToken)}`,
    {
      credentials: 'include',
    },
  );
  if (!res.ok) return null;
  return infoFrom((await res.json()) as IssuedPass);
}

export function CheckInPassView() {
  const session = useSessionContext()?.session;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [payload, setPayload] = useState('');
  const [error, setError] = useState('');
  const [noBooking, setNoBooking] = useState(false);
  const [saved, setSaved] = useState(false);
  /** QR tetap milik akun (bukan QR per booking): satu untuk semua kelas, cukup disimpan sekali. */
  const [statis, setStatis] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Rincian kelas berasal dari server (atau parameter alamat bila ada); tidak ada nilai contoh sebagai pengganti.
  const [info, setInfo] = useState<PassInfo | null>(null);
  const [passHolder, setPassHolder] = useState(session?.displayName ?? '');

  const downloadQr = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = statis ? 'daily-dose-qr-kehadiran.png' : 'daily-dose-qr-pass.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // Status aktif QR diperbarui tiap 30 detik tanpa memuat ulang halaman.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (session?.displayName) setPassHolder((current) => current || session.displayName);
  }, [session?.displayName]);

  useEffect(() => {
    let cancelled = false;
    // 1. Screen Wake Lock (Spesifikasi 5.8: "Kecerahan layar dinaikkan saat halaman dibuka, kalau platform mengizinkan")
    let wakeLockSentinel: any = null;
    if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
      navigator.wakeLock
        .request('screen')
        .then((lock) => {
          wakeLockSentinel = lock;
        })
        .catch(() => {
          // Gracefully continue if wake lock is denied or unsupported
        });
    }

    // 2. Parse URL hash & search parameters
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/u, ''));

    const rawToken = hashParams.get('token') ?? searchParams.get('token') ?? '';
    const bookingId = searchParams.get('bookingId') ?? hashParams.get('bookingId') ?? '';

    // Metadata overrides
    const paramClass =
      searchParams.get('class') ??
      hashParams.get('class') ??
      searchParams.get('className') ??
      hashParams.get('className');
    const paramStudio =
      searchParams.get('branch') ??
      hashParams.get('branch') ??
      searchParams.get('studio') ??
      hashParams.get('studio');
    const paramInstructor = searchParams.get('instructor') ?? hashParams.get('instructor');
    const paramHolder =
      searchParams.get('holder') ??
      hashParams.get('holder') ??
      searchParams.get('holderName') ??
      hashParams.get('holderName');
    const paramStart =
      searchParams.get('start') ?? hashParams.get('start') ?? searchParams.get('startAt');
    const paramEnd = searchParams.get('end') ?? hashParams.get('end') ?? searchParams.get('endAt');
    const paramTz = searchParams.get('tz') ?? hashParams.get('timezone') ?? 'Asia/Jakarta';

    if (paramHolder) setPassHolder(paramHolder);
    if (paramClass) {
      setInfo({
        className: paramClass,
        studioName: paramStudio ?? '',
        instructorName: paramInstructor,
        startAt: paramStart ?? '',
        endAt: paramEnd ?? '',
        timezone: paramTz,
      });
    }

    const draw = (value: string) => {
      setPayload(value);
      if (!canvasRef.current) return;
      void QRCode.toCanvas(canvasRef.current, value, {
        width: 260,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: { dark: '#17392d', light: '#ffffff' },
      }).catch(() => setError('QR tidak dapat dirender pada perangkat ini.'));
    };

    const drawStatic = (value: string) => {
      if (!value.startsWith('dd-pass:v1:')) {
        setError(QR_UNAVAILABLE);
        return;
      }
      draw(value);
    };

    const showIssued = (data: IssuedPass) => {
      const value = data.qrPayload ?? (data.token ? `dd-checkin:v1:${data.token}` : '');
      if (!value.startsWith('dd-checkin:v1:')) {
        setError(QR_UNAVAILABLE);
        return;
      }
      const fromServer = infoFrom(data);
      if (fromServer) setInfo(fromServer);
      draw(value);
    };

    const decoded = rawToken ? decodeURIComponent(rawToken) : '';
    if (decoded.startsWith('dd-checkin:v1:')) {
      draw(decoded);
      // Tautan dari staf hanya membawa token; rincian kelas diambil dari server bila alamat tidak memuatnya.
      if (!paramClass) {
        void linkInfo(decoded.slice('dd-checkin:v1:'.length)).then((fromServer) => {
          if (!cancelled && fromServer) setInfo(fromServer);
        });
      }
    } else if (bookingId) {
      issuePass(bookingId)
        .then((data) => {
          if (!cancelled) showIssued(data);
        })
        .catch(() => {
          if (!cancelled) setError(QR_UNAVAILABLE);
        });
    } else {
      // Dibuka dari menu: tampilkan QR tetap milik akun. Tablet studio yang mencari kelasnya.
      staticPass()
        .then((pass) => {
          if (cancelled) return;
          setStatis(true);
          drawStatic(pass);
        })
        .catch(() => {
          if (!cancelled) setError(QR_UNAVAILABLE);
        });
    }

    return () => {
      cancelled = true;
      try {
        void wakeLockSentinel?.release?.();
      } catch {
        // Ignore
      }
    };
  }, []);

  const schedule = info?.startAt
    ? formatPassSchedule(info.startAt, info.endAt, info.timezone)
    : null;
  const state = info?.startAt && info.endAt ? passWindow(info, now) : null;

  return (
    <main className="flex min-h-dvh min-w-0 flex-col items-center justify-center overflow-x-hidden bg-[#0d5132] px-4 py-8 text-white">
      <meta name="referrer" content="no-referrer" />

      <header className="text-center">
        <p className="text-[13px] font-bold text-[#faeceb]">Daily Dose Pilates</p>
        <h1 className="mt-1 font-serif text-2xl font-normal tracking-tight text-white sm:text-3xl">
          {statis ? 'QR kehadiran Anda' : 'QR Pass Kelas'}
        </h1>
        <p className="mt-2 max-w-sm text-center text-sm font-normal text-white/85">
          {statis
            ? 'Simpan sekali ke galeri. Tunjukkan ke staf di meja check-in setiap datang, tanpa perlu masuk aplikasi.'
            : 'Tunjukkan QR ini ke pemindai tablet di meja resepsionis atau kiosk studio.'}
        </p>
      </header>

      {noBooking ? (
        <section className="mt-6 box-border w-full max-w-sm rounded-2xl bg-white p-6 text-center text-ed-ink shadow-2xl">
          <CalendarX2 className="mx-auto size-12 text-ed-forest" />
          <h2 className="mt-3 font-serif text-lg font-bold text-ed-ink">
            Belum ada booking mendatang
          </h2>
          <p className="mt-2 text-sm text-ed-muted">
            QR Pass muncul setelah Anda booking kelas. Pilih kelas di jadwal, lalu kembali ke sini.
          </p>
          <div className="mt-6 space-y-2">
            <Link
              href="/classes#schedule"
              className="inline-flex h-11 min-h-[44px] w-full items-center justify-center rounded-xl bg-[#396552] text-sm font-bold text-white transition hover:bg-[#2e5243]"
            >
              Lihat jadwal kelas
            </Link>
            <Link
              href="/account"
              className="inline-flex h-11 min-h-[44px] w-full items-center justify-center text-sm font-semibold text-ed-forest"
            >
              Kembali ke Beranda
            </Link>
          </div>
        </section>
      ) : error ? (
        <section
          role="alert"
          className="mt-6 box-border w-full max-w-sm rounded-2xl bg-white p-6 text-center text-ed-ink shadow-2xl"
        >
          <AlertCircle className="mx-auto size-12 text-ed-danger" />
          <h2 className="mt-3 font-serif text-lg font-bold text-ed-ink">Pass Tidak Tersedia</h2>
          <p className="mt-2 text-sm text-ed-muted">{error}</p>
          <div className="mt-6">
            <Link
              href="/account"
              className="inline-flex h-11 min-h-[44px] w-full items-center justify-center rounded-xl bg-[#396552] text-sm font-bold text-white transition hover:bg-[#2e5243]"
            >
              Kembali ke Beranda
            </Link>
          </div>
        </section>
      ) : (
        <>
          <section className="box-border mt-6 w-full max-w-sm rounded-2xl bg-white p-6 text-center text-ed-ink shadow-2xl">
            {state && (
              <p
                role="status"
                data-pass-state={state}
                className={`mb-4 flex items-start justify-center gap-2 rounded-xl border p-2.5 text-left text-xs font-semibold leading-relaxed ${
                  state === 'OPEN'
                    ? 'border-[#396552]/30 bg-[#e8f1ec] text-[#1f4a37]'
                    : 'border-amber-800/25 bg-amber-50 text-amber-900'
                }`}
              >
                {state === 'OPEN' ? (
                  <QrCode className="mt-0.5 size-4 shrink-0" />
                ) : (
                  <Clock className="mt-0.5 size-4 shrink-0" />
                )}
                <span>
                  {state === 'TOO_EARLY' &&
                    `Belum aktif. QR dapat dipindai mulai pukul ${formatOpensAt(info!.startAt, info!.timezone)} WIB, 30 menit sebelum kelas.`}
                  {state === 'OPEN' && 'QR aktif. Tunjukkan ke petugas saat tiba di studio.'}
                  {state === 'ENDED' && 'Kelas sudah selesai. QR ini tidak berlaku lagi.'}
                </span>
              </p>
            )}
            <canvas
              ref={canvasRef}
              className={`mx-auto box-border rounded-xl bg-white p-2 shadow-inner ${state === 'ENDED' ? 'opacity-30' : ''}`}
              style={{ width: 'min(260px, 100%)', minWidth: '230px', height: 'auto' }}
              aria-label="QR check-in"
            />

            <div className="mt-5 border-t border-ed-line pt-4 text-left space-y-1.5">
              {statis ? (
                <>
                  {passHolder && (
                    <h2 className="font-serif text-lg font-bold text-ed-ink">{passHolder}</h2>
                  )}
                  <p className="text-sm text-ed-muted">
                    QR ini sama untuk semua kelas Anda. Kehadiran tercatat bila Anda punya kelas di
                    studio itu, mulai 45 menit sebelum kelas sampai kelas selesai.
                  </p>
                </>
              ) : info ? (
                <>
                  <h2 className="font-serif text-lg font-bold text-ed-ink">{info.className}</h2>
                  {schedule && (
                    <p className="text-sm font-semibold text-ed-forest">
                      {schedule.date} · {schedule.time}
                    </p>
                  )}
                  <div className="pt-1 space-y-1 text-xs text-ed-muted">
                    {info.studioName && (
                      <p>
                        Studio: <span className="font-medium text-ed-ink">{info.studioName}</span>
                      </p>
                    )}
                    {info.instructorName && (
                      <p>
                        Instruktur:{' '}
                        <span className="font-medium text-ed-ink">{info.instructorName}</span>
                      </p>
                    )}
                    {passHolder && (
                      <p>
                        Pemegang Pass: <span className="font-medium text-ed-ink">{passHolder}</span>
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-sm text-ed-muted animate-pulse" aria-live="polite">
                  Memuat detail kelas…
                </p>
              )}
            </div>

            {!statis && (
              <p className="mt-4 rounded-xl border border-[#396552]/20 bg-[#faeceb]/60 p-2.5 text-center text-xs leading-relaxed text-[#396552]">
                Kode berlaku mulai 30 menit sebelum sesi dimulai hingga kelas selesai.
              </p>
            )}

            <button
              type="button"
              onClick={downloadQr}
              aria-label="Simpan ke galeri"
              className="mt-4 inline-flex h-11 min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#396552] px-6 text-sm font-bold text-white shadow-xs transition hover:bg-[#2e5243] active:scale-[0.99]"
            >
              {saved ? <Check className="size-4" /> : <Download className="size-4" />}
              <span>{saved ? 'Tersimpan di galeri ✓' : 'Simpan ke galeri'}</span>
            </button>

            <p className="mt-3 text-[11px] text-ed-muted">
              {statis
                ? 'Jangan bagikan QR ini. Staf mencocokkan wajah Anda dengan foto selfie saat check-in.'
                : 'Pass terenkripsi · jangan teruskan ke pihak lain'}
            </p>
          </section>

          <nav className="mt-6">
            <Link
              href="/account"
              className="inline-flex items-center gap-2 text-sm font-medium text-white/80 transition hover:text-white"
            >
              <ArrowLeft className="size-4" />
              <span>Kembali ke Beranda</span>
            </Link>
          </nav>
        </>
      )}
    </main>
  );
}
