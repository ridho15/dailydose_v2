'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Building2,
  CalendarCheck2,
  Check,
  CheckCircle2,
  Clock,
  Info,
  MapPin,
  MessageCircle,
  QrCode,
  ShieldCheck,
  Sparkles,
  Timer,
  User,
  Users,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  bookingFailure,
  browserBookingClient,
  type Booking,
  type BookingClient,
  type CustomerBookingOptions,
} from '@/api-clients/booking-client';
import { AlertBanner, useAppFeedback } from '../../components/app-feedback';
import { Button, ButtonLink } from '../../components/actions';
import { EmptyState, Skeleton, StatusBadge } from '../../ui';

const dateTime = (value: Date, timezone: string) =>
  new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(value);

const eligibilityCopy = {
  IDENTITY_VERIFICATION_REQUIRED: {
    title: 'Verifikasi identitas diperlukan',
    description: 'Ambil foto selfie dulu sebelum memesan kelas. Tidak perlu KTP.',
  },
  MATCHING_PACKAGE_REQUIRED: {
    title: 'Paket yang sesuai diperlukan',
    description: 'Anda belum memiliki paket aktif untuk studio dan tipe kelas ini.',
  },
  INSUFFICIENT_AVAILABLE_SESSION: {
    title: 'Saldo sesi belum mencukupi',
    description:
      'Paket yang sesuai tersedia, tetapi seluruh saldonya sudah terpakai atau direservasi.',
  },
  SLOT_FULL: {
    title: 'Kelas sudah penuh',
    description: 'Kapasitas kelas ini tidak lagi tersedia. Pilih jadwal lain untuk melanjutkan.',
  },
  SLOT_UNAVAILABLE: {
    title: 'Kelas tidak tersedia',
    description: 'Status kelas berubah dan booking tidak dapat dilanjutkan.',
  },
  BOOKING_CUTOFF_PASSED: {
    title: 'Waktu booking sudah ditutup',
    description: 'Hubungi studio jika Anda memerlukan bantuan untuk jadwal ini.',
  },
} as const;

const createIntent = () => ({ signature: '', key: crypto.randomUUID() });

function ClassSessionDetailCard({
  slot,
  eligibility,
  durationMinutes,
}: {
  slot: CustomerBookingOptions['slot'];
  eligibility: CustomerBookingOptions['eligibility'];
  durationMinutes: number;
}) {
  const roomName = slot.room?.name || slot.studio?.name || 'Studio Utama';
  // Label mengikuti jenis kelas yang dipesan, bukan nama alat yang tidak ada di datanya.
  const modalityLabel =
    {
      GROUP: 'Kelas grup',
      PRIVATE: 'Kelas private',
      DUET: 'Kelas duet',
      SEMI_PRIVATE: 'Kelas semi private',
    }[slot.classType.modality ?? ''] ?? 'Kelas Pilates';

  return (
    <section className="rounded-dd-xl border border-dd-line bg-white p-5 sm:p-6 space-y-5">
      {/* Top Header: Modality + Badges */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-dd-success-soft px-2.5 py-0.5 text-xs font-semibold text-dd-forest border border-dd-success/30">
              {modalityLabel}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-dd-surface-muted px-2.5 py-0.5 text-xs font-medium text-dd-muted">
              <Building2 className="size-3 text-dd-muted" />
              {roomName}
            </span>
          </div>
          <h2 className="mt-2.5 text-2xl font-semibold sm:text-3xl text-dd-ink">
            {slot.classType.name}
          </h2>
          <p className="mt-1 text-sm text-dd-muted flex items-center gap-1.5">
            <MapPin className="size-4 shrink-0 text-dd-forest" />
            <span className="font-medium text-dd-ink">{slot.branch.name}</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          {slot.available <= 0 ? (
            <StatusBadge tone="danger">Penuh</StatusBadge>
          ) : slot.available <= 2 ? (
            <StatusBadge tone="warning">Sisa {slot.available} Kuota</StatusBadge>
          ) : (
            <StatusBadge tone="success">{slot.available} Kuota Tersedia</StatusBadge>
          )}
        </div>
      </div>

      {/* Grid of Key Session Metrics */}
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Waktu & Tanggal */}
        <div className="rounded-dd-lg bg-dd-surface-muted p-4">
          <dt className="flex items-center gap-1.5 text-xs text-dd-muted">
            <Clock className="size-3.5 text-dd-forest" />
            Waktu Sesi
          </dt>
          <dd className="mt-1 font-semibold text-dd-ink text-sm sm:text-base">
            {new Intl.DateTimeFormat('id-ID', {
              hour: '2-digit',
              minute: '2-digit',
              timeZone: slot.timezone,
            }).format(slot.startAt)}{' '}
            –{' '}
            {new Intl.DateTimeFormat('id-ID', {
              hour: '2-digit',
              minute: '2-digit',
              timeZone: slot.timezone,
            }).format(slot.endAt)}{' '}
            WIB
          </dd>
          <p className="mt-1 text-xs text-dd-muted">
            {new Intl.DateTimeFormat('id-ID', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
              timeZone: slot.timezone,
            }).format(slot.startAt)}
          </p>
        </div>

        {/* Durasi */}
        <div className="rounded-dd-lg bg-dd-surface-muted p-4">
          <dt className="flex items-center gap-1.5 text-xs text-dd-muted">
            <Timer className="size-3.5 text-dd-forest" />
            Durasi Latihan
          </dt>
          <dd className="mt-1 font-semibold text-dd-ink text-sm sm:text-base">{durationMinutes} menit</dd>
          <p className="mt-1 text-xs text-dd-muted">Sesi terpandu</p>
        </div>

        {/* Instruktur */}
        <div className="rounded-dd-lg bg-dd-surface-muted p-4">
          <dt className="flex items-center gap-1.5 text-xs text-dd-muted">
            <User className="size-3.5 text-dd-forest" />
            Instruktur
          </dt>
          <dd className="mt-1 font-semibold text-dd-ink text-sm sm:text-base truncate">
            {slot.instructor?.displayName ?? 'Tim Daily Dose'}
          </dd>
          <p className="mt-1 text-xs text-dd-muted">Instruktur Bersertifikat</p>
        </div>

        {/* Kapasitas & Kuota */}
        <div className="rounded-dd-lg bg-dd-surface-muted p-4">
          <dt className="flex items-center gap-1.5 text-xs text-dd-muted">
            <Users className="size-3.5 text-dd-forest" />
            Kapasitas Kelas
          </dt>
          <dd className="mt-1 font-semibold text-dd-ink text-sm sm:text-base">
            {slot.available} dari {slot.capacity} slot
          </dd>
          <p className="mt-1 text-xs text-dd-muted">
            {slot.bookedCount > 0 ? `${slot.bookedCount} peserta terdaftar` : 'Belum ada reservasi'}
          </p>
        </div>
      </dl>

      {/* Alamat Lengkap & Batas Cutoff */}
      <div className="grid gap-3 pt-1 sm:grid-cols-2 text-xs">
        {slot.branch.address && (
          <div className="flex items-start gap-2 rounded-dd-lg border border-dd-line/60 bg-white p-3 text-dd-muted">
            <MapPin className="size-4 shrink-0 text-dd-forest mt-0.5" />
            <div>
              <strong className="block text-dd-ink font-semibold">Alamat Studio:</strong>
              <span>{slot.branch.address}</span>
            </div>
          </div>
        )}
        <div className="flex items-start gap-2 rounded-dd-lg border border-dd-line/60 bg-white p-3 text-dd-muted">
          <Clock className="size-4 shrink-0 text-dd-forest mt-0.5" />
          <div>
            <strong className="block text-dd-ink font-semibold">Batas Reservasi:</strong>
            <span>
              Ditutup{' '}
              {new Intl.DateTimeFormat('id-ID', {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: slot.timezone,
              }).format(eligibility.cutoffAt)}{' '}
              WIB
            </span>
          </div>
        </div>
      </div>

      {/* Deskripsi Kelas jika ada */}
      {slot.classType.description && (
        <div className="rounded-dd-lg bg-dd-surface-muted/60 p-3.5 text-xs text-dd-muted leading-relaxed flex items-start gap-2 border border-dd-line/40">
          <Info className="size-4 shrink-0 text-dd-forest mt-0.5" />
          <span>{slot.classType.description}</span>
        </div>
      )}
    </section>
  );
}

export function CustomerBookingFlow({ client = browserBookingClient }: { client?: BookingClient }) {
  const router = useRouter();
  const feedback = useAppFeedback();
  const [options, setOptions] = useState<CustomerBookingOptions | null>(null);
  const [selectedPackageId, setSelectedPackageId] = useState('');
  const [booking, setBooking] = useState<Booking | null>(null);
  const [step, setStep] = useState<'select' | 'review'>('select');
  const [status, setStatus] = useState<'loading' | 'ready' | 'submitting' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const intent = useRef(createIntent());
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    const slot = new URLSearchParams(window.location.search).get('slot');
    if (!slot) {
      router.replace('/classes');
      return;
    }
    client
      .options(slot)
      .then((result) => {
        setOptions(result);
        setSelectedPackageId(result.packages[0]?.id ?? '');
        setStatus('ready');
      })
      .catch(async (error) => {
        setMessage(await bookingFailure(error));
        setStatus('error');
      });
  }, [client]);

  if (status === 'loading') {
    return (
      <section className="rounded-dd-xl border border-dd-line bg-white p-6">
        <Skeleton label="Menyiapkan rincian booking…" />
      </section>
    );
  }

  if (!options) {
    return (
      <section className="rounded-dd-xl border border-dd-line bg-white p-6">
        <EmptyState
          title={status === 'error' ? 'Jadwal kelas tidak dapat dibuka' : 'Pilih jadwal kelas terlebih dahulu'}
          description={
            message || 'Silakan buka halaman jadwal kelas dan pilih sesi latihan yang ingin Anda ikuti.'
          }
        />
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/classes#schedule" leadingIcon={<ArrowLeft className="size-4" />}>
            Kembali ke jadwal
          </ButtonLink>
          {status === 'error' && (
            <ButtonLink variant="secondary" href="/contact">
              Hubungi studio
            </ButtonLink>
          )}
        </div>
      </section>
    );
  }

  const { slot } = options;
  const selectedPackage = options.packages.find(({ id }) => id === selectedPackageId);
  const purchaseUrl = `/packages?branch=${encodeURIComponent(slot.branchId)}&classType=${encodeURIComponent(slot.classTypeId)}&slot=${encodeURIComponent(slot.id)}`;
  const eligibility = options.eligibility;
  const eligibilityMessage = eligibility.reasonCode
    ? eligibilityCopy[eligibility.reasonCode]
    : null;

  const durationMinutes = Math.max(
    15,
    Math.round((slot.endAt.getTime() - slot.startAt.getTime()) / 60_000),
  );

  const cleanPhone = slot.branch?.supportWhatsappE164?.replace(/[^0-9]/g, '');
  const waText = encodeURIComponent(
    `Halo ${slot.branch.name}, saya ingin menanyakan sesi ${slot.classType.name} pada ${dateTime(slot.startAt, slot.timezone)}.`,
  );
  const whatsappUrl = cleanPhone ? `https://wa.me/${cleanPhone}?text=${waText}` : null;

  return (
    <main className="space-y-6 pt-2" aria-labelledby="customer-booking-title">
      {/* Header */}
      <header>
        <Link
          href="/classes#schedule"
          className="inline-flex items-center gap-2 text-sm font-semibold text-dd-forest no-underline hover:underline"
        >
          <ArrowLeft className="size-4" />
          Kembali ke jadwal
        </Link>
        <p className="mt-5 text-[13px] font-bold text-dd-forest">
          Booking kelas
        </p>
        <h1 id="customer-booking-title" className="mt-2 text-2xl font-semibold sm:text-3xl">
          Konfirmasi reservasi kelas
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-dd-muted">
          Pilih paket aktif yang sesuai untuk mengonfirmasi sesi latihan Anda. Satu kuota sesi akan direservasi setelah konfirmasi berhasil.
        </p>
      </header>

      {message && (
        <AlertBanner tone="danger" title="Booking belum dapat diproses" message={message} />
      )}

      {/* Step Tracker (Identical to Checkout) - shown when booking not done and eligible */}
      {!booking && eligibility.canBook && (
        <ol
          aria-label="Tahapan booking"
          className="grid grid-cols-2 gap-2 rounded-dd-xl border border-dd-line bg-white p-3"
        >
          {[
            { key: 'select', label: '1. Pilih paket' },
            { key: 'review', label: '2. Review & Konfirmasi' },
          ].map(({ key, label }, index) => {
            const isActive = step === key;
            const isDone = step === 'review' && key === 'select';
            return (
              <li
                key={label}
                aria-current={isActive ? 'step' : undefined}
                className={`flex items-center gap-2 rounded-dd-lg px-3 py-2 text-xs font-semibold sm:text-sm ${
                  isActive
                    ? 'bg-dd-forest text-white'
                    : isDone
                      ? 'bg-dd-success-soft text-dd-success'
                      : 'text-dd-muted'
                }`}
              >
                <span className="grid size-6 place-items-center rounded-full border border-current text-[11px]">
                  {isDone ? <Check className="size-3.5 stroke-[2.5]" /> : index + 1}
                </span>
                {label}
              </li>
            );
          })}
        </ol>
      )}

      {/* Booking Result (Success View) */}
      {booking ? (
        <section
          className="rounded-dd-xl border border-dd-success/30 bg-dd-success-soft p-6"
          aria-live="polite"
        >
          <div className="flex items-center gap-3">
            <CheckCircle2 className="size-8 text-dd-success shrink-0" aria-hidden="true" />
            <div>
              <p className="text-[13px] font-bold text-dd-success">
                Booking berhasil
              </p>
              <h2 className="text-2xl font-semibold text-dd-ink">{slot.classType.name}</h2>
            </div>
          </div>

          <p className="mt-3 text-sm leading-6 text-dd-muted">
            Sesi latihan Anda pada <strong>{dateTime(slot.startAt, slot.timezone)}</strong> di{' '}
            <strong>{slot.branch.name}</strong> telah terkonfirmasi.
          </p>

          <dl className="mt-5 grid gap-3 rounded-dd-lg bg-white/80 p-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-dd-muted">ID Referensi</dt>
              <dd className="mt-1 font-mono font-semibold text-dd-ink">•{booking.id.slice(-8)}</dd>
            </div>
            <div>
              <dt className="text-xs text-dd-muted">Paket Digunakan</dt>
              <dd className="mt-1 font-semibold text-dd-ink truncate">{selectedPackage?.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-dd-muted">Sisa Sesi Tersedia</dt>
              <dd className="mt-1 font-semibold text-dd-success">
                {selectedPackage?.projectedAvailable ?? 0} sesi
              </dd>
            </div>
          </dl>

          <div className="mt-6 flex flex-wrap gap-3">
            <ButtonLink
              href={`/bookings/${encodeURIComponent(booking.id)}`}
              leadingIcon={<QrCode className="size-4" />}
            >
              Lihat tiket & QR check-in
            </ButtonLink>
            <ButtonLink variant="secondary" href="/classes#schedule">
              Kembali ke jadwal
            </ButtonLink>
          </div>
        </section>
      ) : !eligibility.canBook && eligibilityMessage ? (
        /* Ineligible State with Full Session Detail Card */
        <div className="space-y-6">
          <ClassSessionDetailCard
            slot={slot}
            eligibility={eligibility}
            durationMinutes={durationMinutes}
          />

          <section className="rounded-dd-xl border border-dd-warning/30 bg-dd-warning-soft/40 p-6 space-y-4">
            <AlertBanner
              tone="warning"
              title={eligibilityMessage.title}
              message={eligibilityMessage.description}
            />

            <div className="rounded-dd-lg bg-white/90 p-4 border border-dd-warning/30 text-xs sm:text-sm text-dd-muted leading-relaxed">
              {eligibility.reasonCode === 'MATCHING_PACKAGE_REQUIRED' && (
                <p>
                  Untuk mengikuti sesi <strong>{slot.classType.name}</strong> di{' '}
                  <strong>{slot.branch.name}</strong>, Anda memerlukan paket aktif yang berlaku untuk
                  cabang dan jenis kelas ini. Silakan beli paket yang sesuai melalui tautan di bawah,
                  atau hubungi tim studio kami jika Anda memiliki pertanyaan.
                </p>
              )}
              {eligibility.reasonCode === 'INSUFFICIENT_AVAILABLE_SESSION' && (
                <p>
                  Seluruh saldo kuota sesi pada paket Anda telah direservasi atau terpakai. Anda dapat
                  membeli paket tambahan untuk melanjutkan booking sesi ini.
                </p>
              )}
              {eligibility.reasonCode === 'IDENTITY_VERIFICATION_REQUIRED' && (
                <p>
                  Sesuai kebijakan keselamatan Daily Dose Pilates, akun Anda perlu menyelesaikan
                  verifikasi identitas terlebih dahulu sebelum melakukan reservasi mandiri.
                </p>
              )}
              {eligibility.reasonCode === 'SLOT_FULL' && (
                <p>
                  Seluruh kapasitas ({slot.capacity} slot) pada jadwal ini sudah terisi penuh. Silakan
                  pilih jadwal sesi lain yang masih memiliki kuota tersedia.
                </p>
              )}
              {eligibility.reasonCode === 'BOOKING_CUTOFF_PASSED' && (
                <p>
                  Batas waktu booking mandiri untuk jadwal ini telah ditutup. Silakan hubungi studio
                  secara langsung jika Anda memerlukan bantuan khusus.
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              {eligibility.requiredAction === 'COMPLETE_IDENTITY_VERIFICATION' && (
                <ButtonLink href="/account/verification">
                  Selesaikan verifikasi identitas
                </ButtonLink>
              )}
              {eligibility.requiredAction === 'BUY_MATCHING_PACKAGE' && (
                <ButtonLink href={purchaseUrl} leadingIcon={<Sparkles className="size-4" />}>
                  Beli paket yang sesuai
                </ButtonLink>
              )}
              {whatsappUrl && (
                <ButtonLink
                  variant="secondary"
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  leadingIcon={<MessageCircle className="size-4 text-dd-success" />}
                >
                  Tanya admin studio via WhatsApp
                </ButtonLink>
              )}
              {eligibility.requiredAction === 'CONTACT_STUDIO' && !whatsappUrl && (
                <ButtonLink variant="secondary" href="/contact">
                  Hubungi studio
                </ButtonLink>
              )}
              <ButtonLink
                variant="secondary"
                href="/classes#schedule"
                leadingIcon={<ArrowLeft className="size-4" />}
              >
                Pilih jadwal lain
              </ButtonLink>
            </div>
          </section>
        </div>
      ) : (
        /* Two-Column Booking Layout */
        <form
          aria-label="Formulir booking mandiri"
          onSubmit={(event) => {
            event.preventDefault();
            if (!selectedPackageId || step === 'select') {
              setStep('review');
              return;
            }
            if (isSubmittingRef.current || status === 'submitting') return;
            isSubmittingRef.current = true;
            setStatus('submitting');
            setMessage('');
            const signature = `${slot.id}:${selectedPackageId}`;
            if (intent.current.signature !== signature) {
              intent.current = { signature, key: crypto.randomUUID() };
            }
            void client
              .create(
                {
                  classSlotId: slot.id,
                  customerPackageId: selectedPackageId,
                  source: 'SELF',
                },
                intent.current.key,
              )
              .then((result) => {
                setBooking(result);
                setStatus('ready');
                feedback.showToast({
                  tone: 'success',
                  title: 'Booking berhasil dikonfirmasi',
                  message: `Sesi ${slot.classType.name} terjadwal pada ${dateTime(slot.startAt, slot.timezone)}.`,
                });
              })
              .catch(async (error) => {
                setMessage(await bookingFailure(error));
                setStatus('error');
              })
              .finally(() => {
                isSubmittingRef.current = false;
              });
          }}
        >
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,.85fr)]">
            {/* Left Column: Class Detail & Package / Review Form */}
            <div className="space-y-5">
              {/* Selected Class Summary Card */}
              <ClassSessionDetailCard
                slot={slot}
                eligibility={eligibility}
                durationMinutes={durationMinutes}
              />

              {/* Step 1: Package Selection */}
              {step === 'select' ? (
                <section className="rounded-dd-xl border border-dd-line bg-white p-5 sm:p-6 space-y-4">
                  <div>
                    <h3 className="text-base font-semibold text-dd-ink">
                      Pilih paket aktif untuk sesi ini
                    </h3>
                    <p className="mt-1 text-xs text-dd-muted">
                      Hanya paket yang sesuai dengan cabang dan jenis kelas ini yang dapat dipilih.
                    </p>
                  </div>

                  <div className="space-y-3">
                    {options.packages.map((item) => {
                      const isSelected = selectedPackageId === item.id;
                      return (
                        <label
                          key={item.id}
                          className={`block rounded-dd-lg border p-4 cursor-pointer transition-colors ${
                            isSelected
                              ? 'border-dd-forest bg-dd-forest/5 ring-1 ring-dd-forest'
                              : 'border-dd-line bg-white hover:border-dd-forest/40'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <input
                              type="radio"
                              name="customerPackageId"
                              value={item.id}
                              checked={isSelected}
                              onChange={() => {
                                setSelectedPackageId(item.id);
                                intent.current = createIntent();
                              }}
                              className="mt-1 size-4 accent-dd-forest"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <strong className="text-base font-semibold text-dd-ink">
                                  {item.name}
                                </strong>
                                <span className="inline-flex items-center rounded-full bg-dd-success-soft px-2.5 py-0.5 text-xs font-semibold text-dd-success">
                                  {item.available} sesi tersedia
                                </span>
                              </div>

                              <div className="mt-1.5 text-xs text-dd-muted">
                                <span>Setelah booking sisa {item.projectedAvailable} sesi</span>
                                {' · '}
                                <span>
                                  Berlaku s/d{' '}
                                  {new Date(item.expiryAt).toLocaleDateString('id-ID', {
                                    day: 'numeric',
                                    month: 'long',
                                    year: 'numeric',
                                  })}
                                </span>
                              </div>
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>

                  <div className="rounded-dd-lg bg-dd-surface-muted p-4 text-xs leading-relaxed text-dd-muted">
                    1 kuota sesi akan direservasi dari paket terpilih setelah Anda mengonfirmasi booking.
                  </div>

                  <div className="pt-2">
                    <Button
                      disabled={!selectedPackageId}
                      type="submit"
                      fullWidth
                      trailingIcon={<CalendarCheck2 className="size-4" aria-hidden="true" />}
                    >
                      Lanjutkan ke review booking
                    </Button>
                  </div>
                </section>
              ) : (
                /* Step 2: Review Final */
                <section className="rounded-dd-xl border border-dd-line bg-white p-5 sm:p-6 space-y-4">
                  <div>
                    <p className="text-[13px] font-bold text-dd-forest">
                      Review reservasi
                    </p>
                    <h3 className="mt-1 text-xl font-semibold text-dd-ink">
                      Konfirmasi detail booking
                    </h3>
                  </div>

                  <dl className="grid gap-3 rounded-dd-lg bg-dd-surface-muted p-4 text-sm divide-y divide-dd-line/50">
                    <div className="flex items-center justify-between py-2 first:pt-0">
                      <dt className="text-xs text-dd-muted">Studio & Lokasi</dt>
                      <dd className="font-semibold text-dd-ink">{slot.branch.name}</dd>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <dt className="text-xs text-dd-muted">Jenis Kelas</dt>
                      <dd className="font-semibold text-dd-ink">{slot.classType.name}</dd>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <dt className="text-xs text-dd-muted">Waktu Sesi</dt>
                      <dd className="font-semibold text-dd-ink">
                        {dateTime(slot.startAt, slot.timezone)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <dt className="text-xs text-dd-muted">Instruktur</dt>
                      <dd className="font-semibold text-dd-ink">
                        {slot.instructor?.displayName ?? 'Tim Daily Dose'}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <dt className="text-xs text-dd-muted">Paket Digunakan</dt>
                      <dd className="font-semibold text-dd-ink truncate max-w-[200px] sm:max-w-xs">
                        {selectedPackage?.name}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between py-2 last:pb-0">
                      <dt className="text-xs text-dd-muted">Saldo Sesi</dt>
                      <dd className="font-semibold text-dd-forest">
                        {selectedPackage?.available} → {selectedPackage?.projectedAvailable} sesi
                      </dd>
                    </div>
                  </dl>

                  <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between pt-2">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={status === 'submitting'}
                      leadingIcon={<ArrowLeft className="size-4" aria-hidden="true" />}
                      onClick={() => setStep('select')}
                    >
                      Kembali ubah paket
                    </Button>
                    <Button
                      disabled={status === 'submitting'}
                      loading={status === 'submitting'}
                      loadingLabel="Mengonfirmasi…"
                      type="submit"
                      leadingIcon={<CalendarCheck2 className="size-4" aria-hidden="true" />}
                    >
                      Ya, konfirmasi booking
                    </Button>
                  </div>
                </section>
              )}
            </div>

            {/* Right Column: Studio Guidelines & Policy (Aside) */}
            <aside className="space-y-5">
              <div className="rounded-dd-xl border border-dd-brass/50 bg-dd-brass-soft p-5 sm:p-6">
                <ShieldCheck className="size-8 text-dd-forest" />
                <h3 className="mt-3 text-lg font-semibold text-dd-ink">
                  Kebijakan & panduan studio
                </h3>
                <ul className="mt-4 space-y-3 text-sm leading-6 text-dd-muted">
                  <li className="flex gap-2">
                    <Check className="mt-1 size-4 shrink-0 text-dd-forest" />
                    <span>Satu sesi akan langsung direservasi atas nama akun Anda.</span>
                  </li>
                  <li className="flex gap-2">
                    <Check className="mt-1 size-4 shrink-0 text-dd-forest" />
                    <span>
                      Permohonan reschedule mandiri dapat diajukan hingga tepat <strong>H-24</strong> sebelum sesi dimulai.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <Check className="mt-1 size-4 shrink-0 text-dd-forest" />
                    <span>
                      QR Code Check-in Pass akan terbit dan siap dipindai di pintu masuk studio.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <Check className="mt-1 size-4 shrink-0 text-dd-forest" />
                    <span>
                      Harap hadir 10 menit sebelum kelas dimulai untuk persiapan dan pemanasan.
                    </span>
                  </li>
                </ul>
              </div>

              <div className="rounded-dd-xl border border-dd-line bg-white p-5 text-xs leading-relaxed text-dd-muted">
                <p className="flex items-center gap-1.5 font-semibold text-dd-ink mb-1">
                  <MapPin className="size-3.5 text-dd-forest" />
                  Alamat Studio
                </p>
                <p className="font-semibold text-dd-ink">{slot.branch.name}</p>
                {slot.branch.address && <p className="mt-1 text-dd-muted">{slot.branch.address}</p>}
                {whatsappUrl ? (
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center gap-1.5 font-semibold text-dd-forest no-underline hover:underline"
                  >
                    <MessageCircle className="size-3.5" />
                    Hubungi WhatsApp studio
                  </a>
                ) : (
                  <Link
                    href="/contact"
                    className="mt-3 inline-flex items-center gap-1.5 font-semibold text-dd-forest no-underline hover:underline"
                  >
                    <MessageCircle className="size-3.5" />
                    Hubungi customer service studio
                  </Link>
                )}
              </div>
            </aside>
          </div>
        </form>
      )}
    </main>
  );
}
