'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  MapPin,
  ShieldAlert,
  User,
  Users,
  X,
} from 'lucide-react';
import {
  bookingProblem,
  browserBookingClient,
  type Booking,
  type BookingClient,
} from '@/api-clients/booking-client';
import type { PublicClassSlot } from '@/api-clients/public-class-catalog-client';
import type { LedgerBalance } from '@/api-clients/ledger-client';
import type { UlasanInstrukturClient } from '@/api-clients/ulasan-instruktur-client';
import { UlasanInstruktur } from '../customer/ulasan-instruktur';

function formatFullDate(dateStr: string, timezone: string) {
  try {
    return new Intl.DateTimeFormat('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: timezone,
    }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

function formatTimeAndDuration(startAt: string, endAt: string, timezone: string) {
  try {
    const start = new Intl.DateTimeFormat('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: timezone,
    }).format(new Date(startAt));
    const end = new Intl.DateTimeFormat('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: timezone,
    }).format(new Date(endAt));
    const minutes = Math.max(
      0,
      Math.round((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60_000),
    );
    return `${start} - ${end} (${minutes} menit)`;
  } catch {
    return `${startAt} - ${endAt}`;
  }
}

export type BookingSheetStatus =
  'ready' | 'submitting' | 'success' | 'slot_full' | 'unverified' | 'error';

export interface BookingConfirmationSheetProps {
  isOpen: boolean;
  onClose: () => void;
  slot: PublicClassSlot | null;
  packageItem?: LedgerBalance | null;
  availablePackages?: LedgerBalance[];
  onBookingSuccess?: (booking: Booking) => void;
  /** Dipanggil saat server menolak karena kelas baru saja penuh atau sudah dipesan, agar daftar jadwal dimuat ulang. */
  onSlotUnavailable?: () => void;
  bookingClient?: BookingClient;
  isVerified?: boolean;
  studioName?: string;
  /** Ulasan instruktur kelas sebelumnya yang belum diisi, ditanyakan sebelum booking berikutnya. */
  ulasanClient?: Pick<UlasanInstrukturClient, 'tertunda' | 'kirim'>;
}

const EMPTY_PACKAGES: LedgerBalance[] = [];

export function BookingConfirmationSheet({
  isOpen,
  onClose,
  slot,
  packageItem,
  availablePackages = EMPTY_PACKAGES,
  onBookingSuccess,
  onSlotUnavailable,
  bookingClient = browserBookingClient,
  isVerified = true,
  studioName,
  ulasanClient,
}: BookingConfirmationSheetProps) {
  const [status, setStatus] = useState<BookingSheetStatus>('ready');
  const [selectedPkgId, setSelectedPkgId] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [bookingResult, setBookingResult] = useState<Booking | null>(null);
  const isSubmittingRef = useRef(false);
  const idempotencyKeyRef = useRef<string>('');

  const availablePkgIds = availablePackages.map((p) => p.id).join(',');

  // Reset state when opening a new slot
  useEffect(() => {
    if (isOpen && slot) {
      if (!isVerified) {
        setStatus('unverified');
      } else {
        setStatus('ready');
      }
      setErrorMessage('');
      setBookingResult(null);
      isSubmittingRef.current = false;
      idempotencyKeyRef.current = crypto.randomUUID();

      const initialPkg =
        packageItem?.id ?? availablePackages.find((pkg) => pkg.available > 0)?.id ?? '';
      setSelectedPkgId(initialPkg);
    }
  }, [isOpen, slot?.id, packageItem?.id, availablePkgIds, isVerified]);

  if (!isOpen || !slot) return null;

  const hasActionFooter = status !== 'success' && status !== 'slot_full' && status !== 'unverified';
  const currentPkg = availablePackages.find((p) => p.id === selectedPkgId) ?? packageItem;

  const handleConfirmBooking = async () => {
    if (!currentPkg?.id) {
      setErrorMessage('Pilih paket yang sesuai untuk mengonfirmasi sesi ini.');
      setStatus('error');
      return;
    }
    if (isSubmittingRef.current || status === 'submitting') return;

    isSubmittingRef.current = true;
    setStatus('submitting');
    setErrorMessage('');

    try {
      const result = await bookingClient.create(
        {
          classSlotId: slot.id,
          customerPackageId: currentPkg.id,
          source: 'SELF',
        },
        idempotencyKeyRef.current,
      );

      setBookingResult(result);
      setStatus('success');
      onBookingSuccess?.(result);
    } catch (err: unknown) {
      const problem = await bookingProblem(err);
      if (problem.code === 'CLASS_CAPACITY_FULL' || problem.code === 'TARGET_CLASS_FULL') {
        setStatus('slot_full');
        setErrorMessage('Slot kelas ini baru saja penuh. Pilih jam lain di hari yang sama.');
        onSlotUnavailable?.();
      } else if (
        problem.code === 'DUPLICATE_ACTIVE_BOOKING' ||
        problem.code === 'DUPLICATE_BOOKING'
      ) {
        setStatus('error');
        setErrorMessage(problem.message);
        onSlotUnavailable?.();
      } else if (
        problem.code === 'IDENTITY_VERIFICATION_REQUIRED' ||
        problem.code === 'UNVERIFIED'
      ) {
        setStatus('unverified');
        setErrorMessage('Booking belum bisa diproses karena identitas kamu belum diverifikasi.');
      } else {
        setStatus('error');
        setErrorMessage(problem.message || 'Gagal memproses booking. Silakan coba lagi.');
      }
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const handleOverlayClick = () => {
    if (status === 'submitting') return; // Sheet tidak bisa ditutup saat sedang memproses
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="booking-sheet-title"
      className="fixed inset-0 z-50 flex flex-col justify-end bg-[#111827]/45 backdrop-blur-xs transition-opacity"
      onClick={handleOverlayClick}
    >
      <div
        className="flex max-h-[80vh] w-full flex-col overflow-hidden rounded-t-[20px] bg-white shadow-2xl transition-transform"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Isi bisa digulir; tombol aksi ada di footer terpisah agar selalu terlihat. */}
        <div
          className={`min-h-0 flex-1 overflow-y-auto px-6 pt-6 ${
            hasActionFooter ? 'pb-4' : 'pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]'
          }`}
        >
          {/* 1. Garis pegangan dekoratif */}
          <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-dd-line" />

          {/* ======================================================== */}
          {/* KEADAAN 3: BERHASIL (SUCCESS) */}
          {/* ======================================================== */}
          {status === 'success' ? (
            <div className="space-y-5 text-center py-2" aria-live="polite">
              <div className="inline-flex size-14 items-center justify-center rounded-full bg-dd-forest-soft text-dd-forest mx-auto">
                <CheckCircle2 className="size-8" />
              </div>
              <div>
                <h2
                  id="booking-sheet-title"
                  className="text-2xl font-bold tracking-tight text-dd-ink"
                >
                  Booking berhasil
                </h2>
                <p className="mt-1 text-sm text-dd-muted">
                  Booking berhasil. {slot.classType.name},{' '}
                  {formatFullDate(slot.startAt, slot.timezone)},{' '}
                  {formatTimeAndDuration(slot.startAt, slot.endAt, slot.timezone)} di{' '}
                  {studioName ?? 'Studio Utama'}.
                </p>
              </div>

              {/* Ringkasan Booking */}
              <div className="rounded-dd-md border border-dd-line/80 bg-dd-surface-muted/40 p-4 text-left space-y-2 text-sm">
                <div className="flex justify-between items-center text-xs font-semibold text-dd-muted">
                  <span>NOMOR BOOKING</span>
                  <span className="font-mono text-dd-ink font-bold">
                    {bookingResult?.bookingNumber ?? 'BK-CONFIRMED'}
                  </span>
                </div>
                <div className="pt-2 border-t border-dd-line/60">
                  <strong className="block text-base font-bold text-dd-ink">
                    {slot.classType.name}
                  </strong>
                  <span className="block text-xs text-dd-muted mt-0.5">
                    {formatFullDate(slot.startAt, slot.timezone)} ·{' '}
                    {formatTimeAndDuration(slot.startAt, slot.endAt, slot.timezone)}
                  </span>
                  <span className="block text-xs text-dd-forest font-semibold mt-1">
                    Studio: {studioName ?? 'Studio Utama'}
                  </span>
                </div>
              </div>

              {/* Tombol Aksi */}
              <div className="space-y-2.5 pt-2">
                <Link
                  href={
                    bookingResult?.id
                      ? `/check-in-pass?bookingId=${encodeURIComponent(bookingResult.id)}`
                      : '/check-in-pass'
                  }
                  className="flex h-[52px] min-h-[52px] w-full items-center justify-center rounded-dd-md bg-dd-forest px-6 text-sm font-bold text-white shadow-xs transition hover:bg-dd-forest-hover"
                >
                  Lihat QR Pass
                </Link>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-[44px] min-h-[44px] w-full items-center justify-center text-sm font-semibold text-dd-muted hover:text-dd-ink"
                >
                  Tutup
                </button>
              </div>
            </div>
          ) : status === 'slot_full' ? (
            /* ======================================================== */
            /* KEADAAN 4A: SLOT HABIS (FULL CONCURRENCY 409) */
            /* ======================================================== */
            <div className="space-y-5 text-center py-2" aria-live="polite">
              <div className="inline-flex size-14 items-center justify-center rounded-full bg-[#fbf4eb] text-[#8a5b17] border border-[#e8d5be] mx-auto">
                <AlertTriangle className="size-8" />
              </div>
              <div>
                <h2
                  id="booking-sheet-title"
                  className="text-xl font-bold tracking-tight text-dd-ink"
                >
                  Slot kelas ini baru saja penuh
                </h2>
                <p className="mt-2 text-sm text-[#8a5b17] leading-relaxed">
                  Slot kelas ini baru saja penuh. Pilih jam lain di hari yang sama.
                </p>
              </div>

              <div className="pt-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-[52px] min-h-[52px] w-full items-center justify-center rounded-dd-md bg-dd-forest px-6 text-sm font-bold text-white shadow-xs transition hover:bg-dd-forest-hover cursor-pointer"
                >
                  Lihat jam lain
                </button>
              </div>
            </div>
          ) : status === 'unverified' ? (
            /* ======================================================== */
            /* KEADAAN 4B: BELUM VERIFIKASI IDENTITAS */
            /* ======================================================== */
            <div className="space-y-5 text-center py-2" aria-live="polite">
              <div className="inline-flex size-14 items-center justify-center rounded-full bg-dd-surface-muted text-[#27607c] mx-auto">
                <ShieldAlert className="size-8" />
              </div>
              <div>
                <h2
                  id="booking-sheet-title"
                  className="text-xl font-bold tracking-tight text-dd-ink"
                >
                  Verifikasi identitas diperlukan
                </h2>
                <p className="mt-2 text-sm text-dd-muted leading-relaxed">
                  Booking belum bisa diproses karena identitas kamu belum diverifikasi.
                </p>
              </div>

              <div className="space-y-2.5 pt-3">
                <Link
                  href="/account/verification"
                  className="flex h-[52px] min-h-[52px] w-full items-center justify-center rounded-dd-md bg-dd-forest px-6 text-sm font-bold text-white shadow-xs transition hover:bg-dd-forest-hover"
                >
                  Isi data verifikasi
                </Link>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-[44px] min-h-[44px] w-full items-center justify-center text-sm font-semibold text-dd-muted hover:text-dd-ink"
                >
                  Tutup
                </button>
              </div>
            </div>
          ) : (
            /* ======================================================== */
            /* KEADAAN 1: SIAP (READY) & KEADAAN 2: DIPROSES (SUBMITTING) */
            /* ======================================================== */
            <div className="space-y-5">
              {/* Header: Nama kelas 24 px & Tombol X */}
              <div className="flex items-start justify-between gap-4 pb-2 border-b border-dd-line/60">
                <div>
                  <span className="text-[13px] font-bold text-dd-forest">Konfirmasi Booking</span>
                  <h2
                    id="booking-sheet-title"
                    className="mt-1 text-2xl font-bold tracking-tight text-dd-ink"
                  >
                    {slot.classType.name}
                  </h2>
                </div>
                <button
                  type="button"
                  disabled={status === 'submitting'}
                  onClick={onClose}
                  className="inline-flex size-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-dd-md text-dd-muted hover:text-dd-ink disabled:opacity-30 disabled:pointer-events-none"
                  aria-label="Tutup konfirmasi booking"
                >
                  <X className="size-5" />
                </button>
              </div>

              {/* Lima baris dengan ikon (Spesifikasi 5.3) */}
              <div className="space-y-3 py-1 text-sm text-dd-ink">
                {/* 1. Tanggal lengkap dengan tahun */}
                <div className="flex items-center gap-3">
                  <Calendar className="size-5 text-dd-forest shrink-0" aria-hidden="true" />
                  <span className="font-medium">{formatFullDate(slot.startAt, slot.timezone)}</span>
                </div>

                {/* 2. Jam mulai sampai selesai dan durasi */}
                <div className="flex items-center gap-3">
                  <Clock className="size-5 text-dd-forest shrink-0" aria-hidden="true" />
                  <span className="font-medium">
                    {formatTimeAndDuration(slot.startAt, slot.endAt, slot.timezone)}
                  </span>
                </div>

                {/* 3. Nama instruktur */}
                <div className="flex items-center gap-3">
                  <User className="size-5 text-dd-forest shrink-0" aria-hidden="true" />
                  <span className="font-medium">
                    {slot.instructor?.displayName
                      ? `Instruktur: ${slot.instructor.displayName}`
                      : 'Instruktur: Ditentukan studio'}
                  </span>
                </div>

                {/* 4. Nama studio */}
                <div className="flex items-center gap-3">
                  <MapPin className="size-5 text-dd-forest shrink-0" aria-hidden="true" />
                  <span className="font-medium">Studio: {studioName ?? 'Studio Utama'}</span>
                </div>

                {/* 5. Sisa slot */}
                <div className="flex items-center gap-3">
                  <Users className="size-5 text-dd-forest shrink-0" aria-hidden="true" />
                  <span className="font-medium text-dd-forest">
                    Sisa {slot.available} slot tersedia
                  </span>
                </div>
              </div>

              {/* Kotak #e8f0ec berisi nama paket dan sisa sesi setelah booking */}
              <div className="rounded-dd-md border border-dd-forest/20 bg-[#e8f0ec] p-4 space-y-2">
                <span className="text-[13px] font-bold text-dd-forest">Paket yang Digunakan</span>

                {availablePackages.length > 1 ? (
                  <div className="space-y-2 pt-1">
                    {availablePackages.map((pkg) => {
                      const isChecked = selectedPkgId === pkg.id;
                      const remainingAfter = Math.max(0, pkg.available - 1);
                      return (
                        <label
                          key={pkg.id}
                          className={`flex items-start gap-3 rounded-dd-sm border p-2.5 text-xs cursor-pointer transition ${
                            isChecked
                              ? 'border-dd-forest bg-white font-semibold shadow-2xs'
                              : 'border-transparent bg-white/60 hover:bg-white'
                          }`}
                        >
                          <input
                            type="radio"
                            name="selectedPackage"
                            value={pkg.id}
                            checked={isChecked}
                            disabled={status === 'submitting'}
                            onChange={() => setSelectedPkgId(pkg.id)}
                            className="mt-0.5 size-4 accent-dd-forest"
                          />
                          <div className="flex-1">
                            <strong className="block text-dd-ink">{pkg.packageName}</strong>
                            <span className="text-dd-muted">
                              Sisa setelah booking: {remainingAfter} sesi
                            </span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                ) : currentPkg ? (
                  <div>
                    <strong className="block text-base font-bold text-dd-ink">
                      {currentPkg.packageName}
                    </strong>
                    <p className="mt-1 text-xs text-dd-forest font-medium">
                      Sisa sesi setelah booking:{' '}
                      <strong>{Math.max(0, currentPkg.available - 1)} sesi</strong> (dari{' '}
                      {currentPkg.available} sesi aktif).
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-red-800">
                    Tidak ditemukan paket aktif yang sesuai untuk kelas ini.
                  </p>
                )}
              </div>

              {status === 'ready' && <UlasanInstruktur ringkas client={ulasanClient} />}
            </div>
          )}
        </div>

        {hasActionFooter && (
          <div className="shrink-0 border-t border-dd-line/60 px-6 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
            {/* Pesan kesalahan di footer agar terlihat tanpa menggulir */}
            {errorMessage && (
              <div
                className="mb-3 rounded-dd-md border border-red-200 bg-red-50 p-3.5 text-xs text-red-900 leading-relaxed"
                role="alert"
              >
                {errorMessage}
              </div>
            )}

            {/* Tombol Utama (Tinggi 52 px) & Tombol Batal */}
            <div className="space-y-2.5">
              <button
                type="button"
                disabled={status === 'submitting' || !currentPkg}
                onClick={handleConfirmBooking}
                className="flex h-[52px] min-h-[52px] w-full items-center justify-center rounded-dd-md bg-dd-forest px-6 text-sm font-bold text-white shadow-xs transition hover:bg-dd-forest-hover disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
              >
                {status === 'submitting' ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    <span>Memproses booking...</span>
                  </span>
                ) : (
                  'Konfirmasi booking sekarang'
                )}
              </button>

              <button
                type="button"
                disabled={status === 'submitting'}
                onClick={onClose}
                className="flex h-[44px] min-h-[44px] w-full items-center justify-center text-sm font-semibold text-dd-muted hover:text-dd-ink disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
              >
                Batal
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
