'use client';

import Link from 'next/link';
import { ArrowLeft, CalendarDays, CalendarX, CheckCircle, Download, ExternalLink, MapPin, QrCode, User, Users } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  bookingFailure,
  bookingProblem,
  browserBookingClient,
  type BookingClient,
  type BookingProblem,
  type CustomerBookingRecord,
  type CustomerRescheduleOptions,
} from '@/api-clients/booking-client';
import { AlertBanner } from '../../components/app-feedback';
import { Button, ButtonLink } from '../../components/actions';
import { SearchSelect, SelectInput } from '../../components/forms';
import { useSessionContext } from '../../session-context';
import { isCustomerOnlySession } from '@/lib/session-audience';
import { PageHeader, Skeleton } from '../../ui';

const statusLabels: Record<string, string> = {
  BOOKED: 'Terjadwal',
  RESCHEDULE_PENDING: 'Perubahan jadwal diproses',
  CANCELLED: 'Dibatalkan',
  ATTENDED: 'Hadir',
  NO_SHOW: 'Tidak hadir',
};

const reasonLabels = {
  PERSONAL_UNAVAILABLE: 'Saya tidak dapat hadir pada jadwal semula',
  CUSTOMER_SCHEDULE_CONFLICT: 'Jadwal saya berbenturan',
  WRONG_CLASS_SELECTED: 'Saya memilih jadwal yang keliru',
} as const;

const dateTime = (value: Date, timezone: string) =>
  value.toLocaleString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  });

const newIntentKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `reschedule-${Date.now()}-${Math.random().toString(36).slice(2)}`;

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
  const [rescheduleUnavailable, setRescheduleUnavailable] = useState<BookingProblem | null>(null);
  const [rescheduleLoading, setRescheduleLoading] = useState(false);
  const [mutationError, setMutationError] = useState('');
  const [options, setOptions] = useState<CustomerRescheduleOptions | null>(null);
  const [targetId, setTargetId] = useState('');
  const [reasonCode, setReasonCode] = useState<keyof typeof reasonLabels>('PERSONAL_UNAVAILABLE');
  const [showForm, setShowForm] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [rescheduleMessage, setRescheduleMessage] = useState('');
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
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelSubmitting, setCancelSubmitting] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const [cancelMessage, setCancelMessage] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Batas mandiri dihitung dari cutoff yang dikirim API (mengikuti pengaturan cutoff), bukan angka tetap.
  const cutoffRef = cancelOptions?.cutoffAt ?? options?.cutoffAt ?? null;
  const jamBatas =
    cutoffRef && booking?.classSlot?.startAt
      ? Math.round((booking.classSlot.startAt.getTime() - new Date(cutoffRef).getTime()) / 3600e3)
      : null;
  const batasLabel = jamBatas && jamBatas > 0 ? `${jamBatas} jam sebelum kelas dimulai` : 'batas waktu yang ditentukan studio';
  const intentKey = useRef(newIntentKey());

  const handleCancelBooking = async () => {
    if (!booking) return;
    setCancelSubmitting(true);
    setCancelError('');
    try {
      if (client.cancel) {
        await client.cancel(booking.id);
      } else {
        const response = await fetch(`/api/v1/bookings/${encodeURIComponent(booking.id)}/cancel`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json', 'idempotency-key': newIntentKey() },
          body: JSON.stringify({
            reasonCode: 'CUSTOMER_SCHEDULE_CONFLICT',
            reason: 'Dibatalkan mandiri oleh pelanggan',
          }),
        });
        if (!response.ok) throw await response.json();
      }
      setCancelDialogOpen(false);
      setCancelMessage('Booking berhasil dibatalkan. Kuota sesi paket Anda telah dikembalikan secara utuh.');
      await load();
    } catch (cause: any) {
      const code = cause?.error?.code ?? cause?.code ?? cause?.data?.error?.code;
      if (code === 'ATTENDANCE_RECORDED') {
        setCancelError('Kehadiran kelas sudah tercatat atau sesi telah berjalan. Booking tidak dapat dibatalkan.');
      } else if (code === 'CLASS_IN_PROGRESS') {
        setCancelError('Kelas sedang atau sudah selesai berlangsung. Booking tidak dapat dibatalkan.');
      } else if (code === 'CANCELLATION_CUTOFF_PASSED') {
        setCancelError(`Batas waktu pembatalan mandiri (${batasLabel}) telah terlewati. Hubungi admin studio jika terdapat kondisi darurat medis.`);
      } else if (code === 'BOOKING_ALREADY_CANCELLED') {
        setCancelError('Booking ini sudah dibatalkan sebelumnya.');
      } else if (code === 'RESOURCE_NOT_FOUND') {
        setCancelError('Data booking tidak ditemukan atau sudah tidak aktif.');
      } else {
        const friendly = await bookingFailure(cause);
        setCancelError(
          friendly && !friendly.includes('OFFLINE_OR_REQUEST_FAILED')
            ? friendly
            : 'Gagal membatalkan booking. Silakan hubungi admin studio.',
        );
      }
    } finally {
      setCancelSubmitting(false);
    }
  };

  const loadRescheduleOptions = useCallback(async () => {
    if (!canLoadReschedule) {
      setOptions(null);
      setRescheduleUnavailable(null);
      return;
    }
    setRescheduleLoading(true);
    setRescheduleUnavailable(null);
    try {
      const optionResult = await client.rescheduleOptions(id);
      setOptions(optionResult);
      setTargetId(
        optionResult.targets.find((t) => t.eligible !== false)?.id ??
          optionResult.targets[0]?.id ??
          '',
      );
    } catch (cause) {
      setOptions(null);
      setTargetId('');
      setRescheduleUnavailable(await bookingProblem(cause));
    } finally {
      setRescheduleLoading(false);
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
    setMutationError('');
    try {
      const bookingResult = await client.detail(id);
      setBooking(bookingResult);
      await Promise.all([loadRescheduleOptions(), loadQr(bookingResult), loadCancelOptions(bookingResult)]);
    } catch (cause) {
      setBooking(null);
      setOptions(null);
      setCancelOptions(null);
      setRescheduleUnavailable(null);
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
                QR aktif mulai 30 menit sebelum sesi kelas dimulai.
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
      {rescheduleUnavailable && (
        <section className="space-y-3" aria-label="Ketersediaan perubahan jadwal">
          <AlertBanner
            tone={rescheduleUnavailable.code === 'RESCHEDULE_CUTOFF_PASSED' ? 'warning' : 'info'}
            title={
              rescheduleUnavailable.code === 'RESCHEDULE_CUTOFF_PASSED'
                ? 'Batas reschedule telah lewat'
                : 'Perubahan jadwal sedang tidak tersedia'
            }
            message={
              rescheduleUnavailable.code === 'RESCHEDULE_CUTOFF_PASSED'
                ? `Batas perubahan jadwal mandiri (${batasLabel}) telah berakhir. Kursi kelas Anda saat ini tetap aman. Silakan hubungi admin studio untuk asistensi darurat.`
                : 'Booking Anda tetap aktif. Coba kembali atau hubungi studio jika Anda memerlukan bantuan untuk mengganti jadwal.'
            }
          />
          <div className="flex flex-wrap gap-3">
            {rescheduleUnavailable.code !== 'RESCHEDULE_CUTOFF_PASSED' && (
              <Button
                variant="secondary"
                loading={rescheduleLoading}
                loadingLabel="Memuat pilihan jadwal…"
                onClick={() => void loadRescheduleOptions()}
              >
                Coba lagi
              </Button>
            )}
            <ButtonLink href="/contact" variant="secondary">
              Hubungi studio
            </ButtonLink>
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
              ? 'Reschedule disetujui'
              : options.latestRequest.status === 'REJECTED'
                ? 'Reschedule ditolak'
                : 'Reschedule sedang ditinjau'
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
      {options?.supportAction === 'CONTACT_STUDIO' && (
        <div className="space-y-3">
          <AlertBanner
            tone="warning"
            title="Batas reschedule telah lewat"
            message={`Batas perubahan jadwal mandiri ditutup pada ${dateTime(options.cutoffAt, booking.classSlot?.timezone ?? 'Asia/Jakarta')}. Kursi Anda pada jadwal ini tetap aman. Hubungi studio untuk bantuan atau adjustment manual.`}
          />
          <ButtonLink href="/contact" variant="secondary">
            Hubungi studio
          </ButtonLink>
        </div>
      )}
      {cancelMessage && (
        <AlertBanner
          tone="success"
          title="Booking berhasil dibatalkan"
          message={cancelMessage}
        />
      )}
      {rescheduleMessage && (
        <AlertBanner
          tone="success"
          title="Permintaan berhasil dikirim"
          message={rescheduleMessage}
        />
      )}
      {booking.status === 'BOOKED' && !booking.attendance && (
        <section className="rounded-none border border-ed-line bg-white p-5 shadow-none sm:p-6">
          <h2 className="font-serif text-lg font-normal tracking-tight text-ed-ink">Perubahan atau Pembatalan Booking</h2>
          <p className="mt-2 text-sm leading-relaxed text-ed-muted">
            Perubahan jadwal (reschedule) dan pembatalan mandiri dapat dilakukan paling lambat {batasLabel}.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {options?.canRequest && !showForm && (
              <Button
                onClick={() => {
                  setMutationError('');
                  setShowForm(true);
                  setCancelDialogOpen(false);
                }}
              >
                Ajukan reschedule
              </Button>
            )}
            {!showForm && !cancelDialogOpen && cancelOptions?.canCancel !== false && (
              <Button
                variant="danger"
                onClick={() => {
                  setCancelError('');
                  setCancelDialogOpen(true);
                }}
              >
                Batalkan booking
              </Button>
            )}
          </div>
          {cancelOptions?.canCancel === false && options?.supportAction !== 'CONTACT_STUDIO' && (
            <p className="mt-4 text-sm leading-relaxed text-ed-muted" role="note">
              {cancelOptions.unavailableReason === 'CANCELLATION_CUTOFF_PASSED'
                ? `Batas pembatalan mandiri ditutup pada ${dateTime(new Date(cancelOptions.cutoffAt), booking.classSlot?.timezone ?? 'Asia/Jakarta')}. Hubungi studio bila Anda tidak dapat hadir.`
                : 'Booking ini tidak dapat dibatalkan sendiri lagi. Hubungi studio bila Anda memerlukan bantuan.'}
            </p>
          )}

          {cancelDialogOpen && (
            <div className="mt-5 space-y-3 rounded-none border border-rose-200 bg-rose-50/70 p-4">
              <h3 className="text-sm font-semibold text-rose-800">
                Konfirmasi Pembatalan Booking
              </h3>
              <p className="text-xs leading-relaxed text-rose-800/90 sm:text-sm">
                Apakah Anda yakin ingin membatalkan booking kelas ini? Kuota sesi paket Anda akan otomatis dikembalikan secara utuh.
              </p>
              {cancelError && (
                <p className="text-xs font-semibold text-rose-800 bg-rose-100 p-2.5 rounded-none border border-rose-300">
                  {cancelError}
                </p>
              )}
              <div className="flex flex-wrap gap-3 pt-1">
                <Button
                  variant="danger"
                  loading={cancelSubmitting}
                  loadingLabel="Membatalkan…"
                  onClick={() => void handleCancelBooking()}
                >
                  Ya, Batalkan
                </Button>
                <Button
                  variant="secondary"
                  disabled={cancelSubmitting}
                  onClick={() => setCancelDialogOpen(false)}
                >
                  Kembali
                </Button>
              </div>
            </div>
          )}
        </section>
      )}
      {showForm && options?.canRequest && (
        <form
          className="space-y-5 rounded-none border border-ed-line bg-white p-5 shadow-none sm:p-6"
          aria-label="Pengajuan reschedule"
          onSubmit={(event) => {
            event.preventDefault();
            if (!targetId) return;
            if (!confirming) {
              setConfirming(true);
              return;
            }
            setSubmitting(true);
            setMutationError('');
            void client
              .requestReschedule(
                {
                  bookingId: booking.id,
                  targetClassSlotId: targetId,
                  reasonCode,
                  expectedBookingVersion: options.bookingVersion,
                },
                intentKey.current,
              )
              .then(async () => {
                intentKey.current = newIntentKey();
                setRescheduleMessage(
                  'Tim studio akan meninjau jadwal tujuan. Anda akan menerima notifikasi setelah keputusan dibuat.',
                );
                setShowForm(false);
                setConfirming(false);
                await load();
              })
              .catch(async (cause) => {
                setMutationError(await bookingFailure(cause));
                setConfirming(false);
              })
              .finally(() => setSubmitting(false));
          }}
        >
          <div>
            <h2 className="font-serif text-lg font-normal tracking-tight text-ed-ink">Pilih jadwal pengganti</h2>
            <p className="mt-1 text-sm text-ed-muted">
              Hanya jadwal yang masih memenuhi syarat ditampilkan.
            </p>
          </div>
          {options.targets.length ? (
            <>
              <SearchSelect
                label="Jadwal tujuan"
                value={targetId}
                options={options.targets.map((target) => ({
                  id: target.id,
                  label: dateTime(target.startAt, target.timezone),
                  disabled: target.eligible === false,
                  description:
                    target.eligible === false
                      ? target.ineligibilityReason === 'SCHEDULE_CONFLICT'
                        ? 'Jadwal bertabrakan dengan kelas Anda'
                        : target.ineligibilityReason === 'DUPLICATE_BOOKING'
                          ? 'Anda sudah terdaftar di kelas ini'
                          : 'Kelas sudah penuh'
                      : `${target.availableCapacity} tempat tersedia`,
                }))}
                onChange={(value) => {
                  setTargetId(value);
                  setConfirming(false);
                }}
              />
              <SelectInput
                label="Alasan"
                value={reasonCode}
                onChange={(event) => {
                  setReasonCode(event.target.value as keyof typeof reasonLabels);
                  setConfirming(false);
                }}
              >
                {Object.entries(reasonLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </SelectInput>
              {confirming && (
                <AlertBanner
                  tone="warning"
                  title="Konfirmasi perubahan jadwal"
                  message="Setelah dikirim, jadwal asal tetap berlaku sampai permintaan disetujui oleh studio."
                />
              )}
              {mutationError && (
                <AlertBanner
                  tone="danger"
                  title="Permintaan belum dapat diproses"
                  message={mutationError}
                />
              )}
              <div className="flex flex-wrap gap-3">
                <Button type="submit" loading={submitting} loadingLabel="Mengirim…">
                  {confirming ? 'Kirim permintaan' : 'Tinjau permintaan'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowForm(false);
                    setConfirming(false);
                    setMutationError('');
                  }}
                >
                  Batal
                </Button>
              </div>
            </>
          ) : (
            <AlertBanner
              tone="warning"
              title="Belum ada jadwal pengganti"
              message="Tidak ada kelas dengan cabang dan jenis yang sama yang masih memiliki tempat."
            />
          )}
        </form>
      )}
    </main>
  );
}
