'use client';

import Link from 'next/link';
import { ArrowLeft, CalendarDays, CalendarX, CheckCircle, Download, ExternalLink, MapPin, QrCode, User, Users } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  bookingFailure,
  browserBookingClient,
  type BookingClient,
  type CustomerBookingRecord,
  type CustomerRescheduleOptions,
} from '@/api-clients/booking-client';
import { AlertBanner } from '../../components/app-feedback';
import { AksiBooking } from '../../components/customer/aksi-booking';
import { tandaiBerandaSegar } from '@/lib/beranda-segar';
import { Button, ButtonLink } from '../../components/actions';
import { useSessionContext } from '../../session-context';
import { isCustomerOnlySession } from '@/lib/session-audience';
import { PageHeader, Skeleton } from '../../ui';

const statusLabels: Record<string, string> = {
  BOOKED: 'Terjadwal',
  RESCHEDULE_PENDING: 'Menunggu persetujuan',
  CANCELLED: 'Dibatalkan',
  ATTENDED: 'Hadir',
  NO_SHOW: 'Tidak hadir',
};

export function BookingDetailView({
  id,
  client = browserBookingClient,
}: {
  id: string;
  client?: BookingClient;
}) {
  const context = useSessionContext();
  const canLoadReschedule =
    context === null ||
    (context.status === 'authenticated' &&
      isCustomerOnlySession(context.session) &&
      context.hasCapability('reschedule:self:read'));
  const [booking, setBooking] = useState<CustomerBookingRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailError, setDetailError] = useState('');
  const [options, setOptions] = useState<CustomerRescheduleOptions | null>(null);
  const [qrPayload, setQrPayload] = useState<string | null>(null);
  const [qrPassUrl, setQrPassUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState('');
  // Hasil pemeriksaan API: bila `canCancel` false, tombol batalkan tidak ditawarkan. Null = belum diketahui.
  const [cancelOptions, setCancelOptions] = useState<{
    canCancel: boolean;
    unavailableReason: string | null;
    cutoffAt: string;
  } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Batas mandiri dihitung dari cutoff yang dikirim API (mengikuti pengaturan cutoff), bukan angka tetap.
  const cutoffRef = cancelOptions?.cutoffAt ?? options?.cutoffAt ?? null;
  const jamBatas =
    cutoffRef && booking?.classSlot?.startAt
      ? Math.round((booking.classSlot.startAt.getTime() - new Date(cutoffRef).getTime()) / 3600e3)
      : null;
  const batasLabel = jamBatas && jamBatas > 0 ? `${jamBatas} jam sebelum kelas dimulai` : 'batas waktu yang ditentukan studio';

  // Pilihan ganti jadwal dimuat di dialog Ganti jadwal; di sini hanya untuk status permintaan terakhir.
  const loadRescheduleOptions = useCallback(async () => {
    if (!canLoadReschedule) {
      setOptions(null);
      return;
    }
    try {
      setOptions(await client.rescheduleOptions(id));
    } catch {
      setOptions(null);
    }
  }, [canLoadReschedule, client, id]);

  const loadCancelOptions = useCallback(
    async (current: CustomerBookingRecord) => {
      setCancelOptions(null);
      if (current.status !== 'BOOKED' || current.attendance || !client.cancellationOptions) return;
      try {
        setCancelOptions(await client.cancellationOptions(current.id));
      } catch {
        // Tidak diketahui: tombol tetap ditawarkan dan server yang memutuskan dengan pesan yang jelas.
        setCancelOptions(null);
      }
    },
    [client],
  );

  const loadQr = useCallback(
    async (currentBooking: CustomerBookingRecord) => {
      if (currentBooking.status !== 'BOOKED' || !client.issueCheckIn) return;
      if (
        currentBooking.classSlot?.endAt &&
        new Date(currentBooking.classSlot.endAt).getTime() <= Date.now()
      ) {
        setQrError('Kelas telah selesai. Sesi check-in telah ditutup.');
        return;
      }
      setQrLoading(true);
      setQrError('');
      try {
        const res = await client.issueCheckIn(
          currentBooking.id,
          currentBooking.version,
          `self-qr-${currentBooking.id}`,
        );
        if (res?.qrPayload) {
          setQrPayload(res.qrPayload);
          setQrPassUrl(res.passUrl ?? null);
        }
      } catch (err: unknown) {
        const status = (err as { status?: number })?.status;
        if (status === 410) {
          setQrError('Sesi check-in telah ditutup untuk kelas ini.');
        } else {
          setQrError('Pass QR belum tersedia atau sedang disiapkan oleh studio.');
        }
      } finally {
        setQrLoading(false);
      }
    },
    [client],
  );

  useEffect(() => {
    if (canvasRef.current && qrPayload) {
      void QRCode.toCanvas(canvasRef.current, qrPayload, {
        width: 220,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: { dark: '#17392d', light: '#ffffff' },
      }).catch(() => {
        // Abaikan error render canvas jika unmounted
      });
    }
  }, [qrPayload]);

  const downloadQr = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `daily-dose-qr-${id.slice(-8)}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const load = useCallback(async () => {
    setLoading(true);
    setDetailError('');
    try {
      const bookingResult = await client.detail(id);
      setBooking(bookingResult);
      await Promise.all([loadRescheduleOptions(), loadQr(bookingResult), loadCancelOptions(bookingResult)]);
    } catch (cause) {
      setBooking(null);
      setOptions(null);
      setCancelOptions(null);
      setDetailError(await bookingFailure(cause));
    } finally {
      setLoading(false);
    }
  }, [client, id, loadCancelOptions, loadQr, loadRescheduleOptions]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading)
    return (
      <section className="rounded-none border border-ed-line bg-white p-6 shadow-none">
        <Skeleton label="Memuat detail booking" />
      </section>
    );
  if (!booking)
    return (
      <section className="rounded-none border border-ed-line bg-white p-6 shadow-none">
        <h1 className="font-serif text-2xl font-normal tracking-tight text-ed-ink">Booking tidak tersedia</h1>
        {detailError && (
          <div className="mt-4">
            <AlertBanner tone="danger" title="Detail belum dapat dimuat" message={detailError} />
          </div>
        )}
        <div className="mt-5 flex flex-wrap gap-3">
          <ButtonLink href="/bookings">Kembali</ButtonLink>
          <ButtonLink href="/contact" variant="secondary">
            Hubungi studio
          </ButtonLink>
        </div>
      </section>
    );

  return (
    <main className="space-y-6" aria-labelledby="booking-detail-title">
      <PageHeader
        eyebrow="Detail booking"
        title={booking.classSlot?.classType.name ?? 'Kelas Daily Dose'}
        description={`${statusLabels[booking.status] ?? 'Status booking'} · Booking •${booking.id.slice(-8)}`}
        titleId="booking-detail-title"
        backHref="/bookings"
        backLabel="Kembali ke Booking Saya"
      />
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <article className="rounded-none border border-ed-line bg-white p-5 shadow-none">
          <CalendarDays className="size-6 text-ed-forest" />
          <h2 className="mt-4 text-[13px] font-bold text-ed-muted">Waktu Sesi</h2>
          <p className="font-serif mt-1 text-sm font-normal text-ed-ink leading-relaxed">
            {booking.classSlot
              ? booking.classSlot.startAt.toLocaleString('id-ID', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  ...(booking.classSlot.startAt.getFullYear() !== new Date().getFullYear() || booking.status !== 'BOOKED'
                    ? { year: 'numeric' }
                    : {}),
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZone: booking.classSlot.timezone,
                })
              : 'Jadwal tidak tersedia'}
          </p>
        </article>

        <article className="rounded-none border border-ed-line bg-white p-5 shadow-none">
          <MapPin className="size-6 text-ed-forest" />
          <h2 className="mt-4 text-[13px] font-bold text-ed-muted">Studio & Lokasi</h2>
          <p className="font-serif mt-1 text-sm font-normal text-ed-ink leading-relaxed">
            {booking.classSlot?.studio?.name
              ? `${booking.classSlot.studio.name} · ${booking.branch?.name}`
              : (booking.branch?.name ?? 'Studio Daily Dose')}
          </p>
        </article>

        <article className="rounded-none border border-ed-line bg-white p-5 shadow-none">
          <User className="size-6 text-ed-forest" />
          <h2 className="mt-4 text-[13px] font-bold text-ed-muted">Instruktur</h2>
          <p className="font-serif mt-1 text-sm font-normal text-ed-ink leading-relaxed">
            {booking.classSlot?.instructor?.displayName ?? 'Tim Daily Dose'}
          </p>
        </article>

        {booking.status === 'CANCELLED' ? (
          <article className="rounded-none border border-ed-line bg-white p-5 shadow-none">
            <CalendarX className="size-6 text-rose-800" />
            <h2 className="mt-4 text-[13px] font-bold text-rose-800">Status Booking</h2>
            <p className="font-serif mt-1 text-sm font-normal text-ed-ink leading-relaxed">
              Booking dibatalkan
            </p>
          </article>
        ) : booking.status === 'ATTENDED' ? (
          <article className="rounded-none border border-ed-line bg-white p-5 shadow-none">
            <CheckCircle className="size-6 text-ed-green" />
            <h2 className="mt-4 text-[13px] font-bold text-ed-muted">Status Kehadiran</h2>
            <p className="font-serif mt-1 text-sm font-normal text-ed-ink leading-relaxed">
              Selesai dihadiri
            </p>
          </article>
        ) : (
          <article className="rounded-none border border-ed-line bg-white p-5 shadow-none">
            <Users className="size-6 text-ed-forest" />
            <h2 className="mt-4 text-[13px] font-bold text-ed-muted">Kapasitas Slot</h2>
            <p className="font-serif mt-1 text-sm font-normal text-ed-ink leading-relaxed">
              {booking.classSlot?.capacity
                ? `${booking.classSlot.bookedCount ?? 1}/${booking.classSlot.capacity} terisi (${Math.max(0, booking.classSlot.capacity - (booking.classSlot.bookedCount ?? 1))} sisa tempat)`
                : 'Tersedia'}
            </p>
          </article>
        )}
      </section>
      {booking.attendance && (
        <AlertBanner
          tone="success"
          title="Kehadiran tercatat"
          message={`Check-in pada ${booking.attendance.checkedInAt.toLocaleString('id-ID')}.`}
        />
      )}
      {booking.status === 'BOOKED' && !booking.attendance && (
        <section
          className="overflow-hidden rounded-none border border-ed-line bg-ed-tint/30 p-6 shadow-none"
          aria-label="Pass Check-in Studio"
        >
          <div className="flex flex-col items-center text-center sm:flex-row sm:items-start sm:text-left sm:gap-6">
            <div className="flex flex-col items-center">
              <div className="rounded-none border border-ed-line bg-white p-3 shadow-none">
                <canvas ref={canvasRef} className="block size-[220px]" />
              </div>
              {qrLoading && (
                <p className="mt-2 text-xs text-ed-muted animate-pulse">Menyiapkan QR Pass…</p>
              )}
              {qrPayload && (
                <Button
                  type="button"
                  variant="secondary"
                  className="mt-3 w-full text-xs"
                  leadingIcon={<Download className="size-3.5" />}
                  onClick={downloadQr}
                >
                  Unduh QR (PNG)
                </Button>
              )}
            </div>
            <div className="mt-4 flex-1 sm:mt-0">
              <span className="inline-flex items-center gap-1.5 rounded-none border border-ed-line bg-ed-tint px-3 py-1 text-[13px] font-bold text-ed-forest">
                <QrCode className="size-3.5" />
                Pass Check-in Studio
              </span>
              <h2 className="font-serif mt-2 text-lg font-normal tracking-tight text-ed-ink">
                Tunjukkan QR Ini Saat Tiba di Studio
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-ed-muted sm:text-sm">
                Tunjukkan kode QR ini ke meja resepsionis untuk mencatat kehadiran Anda.
                QR aktif mulai 45 menit sebelum sesi kelas dimulai.
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-ed-muted">
                <span className="rounded-none bg-white px-2.5 py-1 border border-ed-line font-mono font-medium">
                  Ref: •{booking.id.slice(-8)}
                </span>
                {booking.classSlot && (
                  <span className="rounded-none bg-white px-2.5 py-1 border border-ed-line">
                    Studio: {booking.classSlot.studio?.name ?? booking.branch?.name ?? 'Daily Dose'}
                  </span>
                )}
              </div>
              {qrPassUrl && (
                <div className="mt-4">
                  <a
                    href={qrPassUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-ed-forest underline hover:text-ed-green"
                  >
                    Buka tampilan QR layar penuh
                    <ExternalLink className="size-3" />
                  </a>
                </div>
              )}
              {qrError && !qrPayload && (
                <p className="mt-3 text-xs text-amber-900 bg-amber-50 rounded-none p-2 border border-amber-800/20">
                  {qrError}
                </p>
              )}
            </div>
          </div>
        </section>
      )}
      {options?.latestRequest && (
        <AlertBanner
          tone={
            options.latestRequest.status === 'APPROVED'
              ? 'success'
              : options.latestRequest.status === 'REJECTED'
                ? 'danger'
                : 'warning'
          }
          title={
            options.latestRequest.status === 'APPROVED'
              ? 'Jadwal sudah dipindah'
              : options.latestRequest.status === 'REJECTED'
                ? 'Ganti jadwal ditolak'
                : 'Menunggu persetujuan'
          }
          message={
            options.latestRequest.status === 'PENDING'
              ? 'Kursi Anda pada jadwal kelas awal tetap aman sampai tim studio memberikan keputusan.'
              : options.latestRequest.status === 'APPROVED'
                ? 'Booking Anda sudah dipindahkan ke jadwal baru.'
                : 'Booking tetap berada di jadwal semula. Hubungi studio bila Anda memerlukan bantuan.'
          }
        />
      )}
      {booking.status === 'BOOKED' && !booking.attendance && (
        <section
          aria-labelledby="ubah-booking"
          className="space-y-3 rounded-dd-xl border border-dd-line bg-white p-5 sm:p-6"
        >
          <h2 id="ubah-booking" className="m-0 text-xl font-semibold text-dd-ink">
            Ubah atau batalkan
          </h2>
          <p className="m-0 text-base text-dd-muted">
            Ganti jadwal dan pembatalan langsung bisa sampai {batasLabel}. Setelah itu, ajukan pembatalan dan Manager studio yang memutuskan.
          </p>
          <AksiBooking
            booking={{
              id: booking.id,
              classSlotId: booking.classSlot?.id ?? '',
              customerPackageId: booking.customerPackageId ?? null,
              className: booking.classSlot?.classType?.name ?? 'Kelas',
              timezone: booking.classSlot?.timezone ?? 'Asia/Jakarta',
            }}
            client={client as BookingClient}
            onBerubah={() => {
              tandaiBerandaSegar();
              void load();
            }}
          />
        </section>
      )}
    </main>
  );
}
