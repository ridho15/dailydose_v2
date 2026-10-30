'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  QrCode,
  Sparkles,
  User,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import {
  browserBookingClient,
  type BookingClient,
  type WalkInResult,
} from '../api-clients/booking-client';
import {
  browserAssistedSaleClient,
  type AssistedPaymentMethod,
  type AssistedSaleClient,
  type PurchasePackage,
} from '../api-clients/purchase-client';
import type { ClassSlot, ClassWorkspace } from '../api-clients/class-slot-client';
import { customerClient, type CustomerSummary } from '../customers/customer-client';
import { Button } from '../components/actions';
import { Drawer, useAppFeedback } from '../components/app-feedback';
import { AsyncSearchSelect, TextInput, type SearchSelectOption } from '../components/forms';
import { Feedback } from '../ui';
import { formatRupiah } from '../lib/formatters';
import { formatBranchTime } from '../lib/class-time';
import { cleanWhatsAppPhone } from './whatsapp-reminder-presets';

export interface WalkInDrawerProps {
  open: boolean;
  onClose: () => void;
  branch: { id: string; name: string; timezone?: string };
  slots?: ClassSlot[];
  workspace?: ClassWorkspace | null;
  bookingClient?: BookingClient;
  assistedSaleClient?: AssistedSaleClient;
  customerApi?: typeof customerClient;
  onSuccess?: (result: WalkInResult) => void;
  now?: Date;
}

type Step = 1 | 2 | 3;

export function WalkInDrawer({
  open,
  onClose,
  branch,
  slots = [],
  workspace,
  bookingClient = browserBookingClient,
  assistedSaleClient = browserAssistedSaleClient,
  customerApi = customerClient,
  onSuccess,
  now = new Date(),
}: WalkInDrawerProps) {
  const feedback = useAppFeedback();
  const timezone = branch.timezone ?? 'Asia/Jakarta';

  // Wizard Step
  const [step, setStep] = useState<Step>(1);

  // Step 1: Member Data
  const [isNewCustomer, setIsNewCustomer] = useState(true);
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [existingCustomerOption, setExistingCustomerOption] = useState<SearchSelectOption | undefined>();

  // Step 2: Slot Selection
  const [selectedSlotId, setSelectedSlotId] = useState<string>('');

  // Step 3: Package & Cashier Payment
  const [packages, setPackages] = useState<PurchasePackage[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(false);
  const [selectedPackageId, setSelectedPackageId] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CARD' | 'QRIS'>('CASH');
  const [paymentNote, setPaymentNote] = useState('');

  // Submission State
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const idempotencyKey = useRef<string | undefined>(undefined);

  // Reset or load initial packages when opened
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setIsNewCustomer(true);
    setDisplayName('');
    setPhone('');
    setEmail('');
    setExistingCustomerOption(undefined);
    setSelectedSlotId('');
    setSelectedPackageId('');
    setPaymentMethod('CASH');
    setPaymentNote('');
    setErrorMessage('');
    idempotencyKey.current = undefined;

    let cancelled = false;
    setPackagesLoading(true);
    assistedSaleClient
      .searchPackages('')
      .then((pkgs) => {
        if (!cancelled) {
          const eligible = pkgs.filter(
            (p) => (!p.branchId || p.branchId === branch.id) && p.status === 'ACTIVE',
          );
          setPackages(eligible);
          if (eligible.length > 0 && !selectedPackageId) {
            setSelectedPackageId(eligible[0]!.id);
          }
        }
      })
      .catch(() => {
        if (!cancelled) setPackages([]);
      })
      .finally(() => {
        if (!cancelled) setPackagesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, branch.id, assistedSaleClient]);

  // Customer search for existing member mode
  const searchExistingCustomers = useCallback(
    async (query: string) => {
      try {
        const result = await customerApi.list({ q: query || undefined, status: 'ACTIVE' });
        return {
          items: result.items.map((item: CustomerSummary) => ({
            id: item.id,
            label: item.displayName,
            description: [item.phoneE164, item.email].filter(Boolean).join(' · ') || undefined,
          })),
          nextCursor: result.page?.nextCursor ?? undefined,
        };
      } catch {
        return { items: [], nextCursor: undefined };
      }
    },
    [customerApi],
  );

  // Available slots for today in this branch (exclude already ended slots)
  const availableSlots = useMemo(() => {
    const curTime = now.getTime();
    return slots
      .filter((s) => s.branchId === branch.id && ['PUBLISHED', 'CONFIRMED'].includes(s.status))
      .filter((s) => {
        const end = new Date(s.endAt).getTime();
        return end > curTime;
      })
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  }, [slots, branch.id, now]);


  const getClassName = (slot: ClassSlot) =>
    workspace?.classTypes.find((t) => t.id === slot.classTypeId)?.name ??
    (slot as any).classType?.name ??
    'Kelas Pilates';

  const getStudioName = (slot: ClassSlot) =>
    workspace?.studios.find((s) => s.id === slot.studioId)?.name ??
    (slot as any).studio?.name ??
    'Studio Utama';

  const getInstructorName = (slot: ClassSlot) =>
    (slot as any).instructor?.displayName ??
    workspace?.instructors.find((i) => i.id === slot.instructorUserId)?.displayName ??
    'Instruktur';

  const selectedSlot = useMemo(
    () => availableSlots.find((s) => s.id === selectedSlotId),
    [availableSlots, selectedSlotId],
  );

  const selectedPackage = useMemo(
    () => packages.find((p) => p.id === selectedPackageId),
    [packages, selectedPackageId],
  );

  // Validation checks per step
  const cleanPhone = cleanWhatsAppPhone(phone);
  const isStep1Valid = useMemo(() => {
    if (isNewCustomer) {
      return displayName.trim().length >= 2 && Boolean(cleanPhone && cleanPhone.length >= 9);
    }
    return Boolean(existingCustomerOption?.id);
  }, [isNewCustomer, displayName, cleanPhone, existingCustomerOption]);

  const isStep2Valid = Boolean(selectedSlot && selectedSlot.bookedCount < selectedSlot.capacity);
  const isStep3Valid = Boolean(selectedPackage && paymentMethod);

  // Step 1 validation feedback
  const step1PhoneError =
    phone.trim().length > 0 && (!cleanPhone || cleanPhone.length < 9)
      ? 'Nomor WhatsApp belum valid (minimal 9 digit angka).'
      : null;

  // Execute Walk-In & Instant Reserve
  const handleCompleteWalkIn = async () => {
    if (!isStep1Valid || !isStep2Valid || !isStep3Valid || !selectedSlot || !selectedPackage) {
      return;
    }

    setSubmitting(true);
    setErrorMessage('');
    idempotencyKey.current ??= crypto.randomUUID();

    try {
      let customerUserId = existingCustomerOption?.id;

      // If new customer, register customer first
      if (isNewCustomer) {
        const phoneE164 = `+${cleanPhone}`;
        try {
          const newCust = await customerApi.create(
            {
              displayName: displayName.trim(),
              phoneE164,
              email: email.trim() || undefined,
              preferredBranchId: branch.id,
            },
            { idempotencyKey: `cust-${idempotencyKey.current}` },
          );
          customerUserId = newCust.id;
        } catch (custError: any) {
          const code = custError?.code ?? custError?.error?.code;
          if (code === 'IDENTITY_CONFLICT') {
            setErrorMessage(
              'Nomor WhatsApp atau email ini sudah terdaftar sebagai member. Silakan gunakan opsi "Member Sudah Terdaftar" untuk mencari namanya.',
            );
            setSubmitting(false);
            setStep(1);
            return;
          }
          throw custError;
        }
      }

      if (!customerUserId) {
        throw new Error('Data member tidak ditemukan.');
      }

      // Execute Walk-in Instant Reserve on backend
      if (!bookingClient.walkIn) {
        throw new Error('Fitur walk-in kasir belum didukung.');
      }

      const noteText =
        paymentNote.trim() ||
        `Walk-in kasir meja depan (${paymentMethod === 'CASH' ? 'Tunai' : paymentMethod === 'CARD' ? 'Kartu EDC' : 'QRIS'})`;

      const result = await bookingClient.walkIn(
        {
          branchId: branch.id,
          classSlotId: selectedSlot.id,
          customerUserId,
          packageId: selectedPackage.id,
          paymentMethod,
          paymentNote: noteText,
        },
        idempotencyKey.current,
      );

      feedback.showToast({
        tone: 'success',
        title: 'Walk-In Berhasil Didaftarkan! ✨',
        message: `${isNewCustomer ? displayName.trim() : existingCustomerOption?.label} resmi terdaftar di kelas. Pembayaran kasir dikirim ke antrean verifikasi Manager.`,
      });

      onSuccess?.(result);
      onClose();
    } catch (cause: any) {
      const code = cause?.code ?? cause?.data?.code ?? cause?.error?.code;
      if (code === 'CLASS_CAPACITY_FULL') {
        setErrorMessage('Kapasitas kelas telah penuh. Silakan pilih jadwal kelas lain hari ini.');
        setStep(2);
      } else if (code === 'CLASS_ALREADY_ENDED') {
        setErrorMessage('Kelas ini sudah selesai. Silakan pilih kelas berikutnya hari ini.');
        setStep(2);
      } else if (code === 'DUPLICATE_ACTIVE_BOOKING') {
        setErrorMessage('Member sudah memiliki booking aktif di kelas ini.');
      } else {
        setErrorMessage(
          cause instanceof Error ? cause.message : 'Terjadi kendala saat memproses walk-in kasir.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer
      open={open}
      title="Alur Cepat Walk-In & Booking Kasir"
      description={`Daftarkan member baru, pilih kelas hari ini, dan catat pembayaran kasir untuk cabang ${branch.name}.`}
      busy={submitting}
      dirty={isStep1Valid || Boolean(selectedSlotId)}
      onClose={onClose}
      onDirtyClose={() =>
        feedback.confirm({
          tone: 'warning',
          title: 'Batalkan walk-in member?',
          message: 'Data isian walk-in dan pilihan kelas belum tersimpan.',
          confirmLabel: 'Batalkan',
        })
      }
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          {step > 1 ? (
            <Button
              type="button"
              variant="secondary"
              disabled={submitting}
              onClick={() => setStep((s) => (s - 1) as Step)}
            >
              ← Kembali
            </Button>
          ) : (
            <Button type="button" variant="secondary" disabled={submitting} onClick={onClose}>
              Batal
            </Button>
          )}

          <div className="flex items-center gap-2">
            {step < 3 ? (
              <Button
                type="button"
                variant="primary"
                disabled={step === 1 ? !isStep1Valid : !isStep2Valid}
                onClick={() => setStep((s) => (s + 1) as Step)}
              >
                Lanjut ke Langkah {step + 1} →
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                loading={submitting}
                disabled={!isStep1Valid || !isStep2Valid || !isStep3Valid}
                leadingIcon={<Sparkles className="size-4" aria-hidden="true" />}
                onClick={() => void handleCompleteWalkIn()}
              >
                Konfirmasi Walk-In & Ikut Kelas
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Step Indicator */}
        <nav aria-label="Langkah Walk-In" className="border-b border-dd-line pb-4">
          <ol className="flex items-center justify-between text-xs sm:text-sm">
            <li
              className={`flex items-center gap-1.5 font-semibold ${
                step === 1 ? 'text-dd-forest' : isStep1Valid ? 'text-dd-ink' : 'text-dd-muted'
              }`}
            >
              <span
                className={`flex size-6 items-center justify-center rounded-full text-xs font-bold ${
                  step === 1
                    ? 'bg-dd-forest text-white'
                    : isStep1Valid
                      ? 'bg-dd-forest/15 text-dd-forest'
                      : 'bg-dd-line text-dd-muted'
                }`}
              >
                {isStep1Valid && step > 1 ? '✓' : '1'}
              </span>
              <span>1. Data Member</span>
            </li>
            <span className="text-dd-muted" aria-hidden="true">
              →
            </span>
            <li
              className={`flex items-center gap-1.5 font-semibold ${
                step === 2 ? 'text-dd-forest' : isStep2Valid ? 'text-dd-ink' : 'text-dd-muted'
              }`}
            >
              <span
                className={`flex size-6 items-center justify-center rounded-full text-xs font-bold ${
                  step === 2
                    ? 'bg-dd-forest text-white'
                    : isStep2Valid
                      ? 'bg-dd-forest/15 text-dd-forest'
                      : 'bg-dd-line text-dd-muted'
                }`}
              >
                {isStep2Valid && step > 2 ? '✓' : '2'}
              </span>
              <span>2. Pilih Kelas</span>
            </li>
            <span className="text-dd-muted" aria-hidden="true">
              →
            </span>
            <li
              className={`flex items-center gap-1.5 font-semibold ${
                step === 3 ? 'text-dd-forest' : 'text-dd-muted'
              }`}
            >
              <span
                className={`flex size-6 items-center justify-center rounded-full text-xs font-bold ${
                  step === 3 ? 'bg-dd-forest text-white' : 'bg-dd-line text-dd-muted'
                }`}
              >
                3
              </span>
              <span>3. Paket & Kasir</span>
            </li>
          </ol>
        </nav>

        {errorMessage && (
          <Feedback kind="error">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-dd-danger" aria-hidden="true" />
              <span>{errorMessage}</span>
            </div>
          </Feedback>
        )}

        {/* STEP 1: MEMBER DATA */}
        {step === 1 && (
          <div className="space-y-5" data-testid="walkin-step-1">
            <div>
              <h3 className="m-0 text-base font-semibold text-dd-ink">Pilih Status Member</h3>
              <p className="m-0 mt-0.5 text-xs text-dd-muted">
                Daftarkan member baru yang belum memiliki akun, atau cari data member yang sudah pernah terdaftar.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setIsNewCustomer(true)}
                className={`flex items-center gap-2 rounded-dd-md border p-3 text-left transition ${
                  isNewCustomer
                    ? 'border-dd-forest bg-dd-success-soft/30 text-dd-forest font-semibold ring-1 ring-dd-forest'
                    : 'border-dd-line bg-white text-dd-ink hover:border-dd-forest/60'
                }`}
              >
                <UserPlus className="size-4 shrink-0" aria-hidden="true" />
                <span className="text-sm">Member Baru Walk-In</span>
              </button>

              <button
                type="button"
                onClick={() => setIsNewCustomer(false)}
                className={`flex items-center gap-2 rounded-dd-md border p-3 text-left transition ${
                  !isNewCustomer
                    ? 'border-dd-forest bg-dd-success-soft/30 text-dd-forest font-semibold ring-1 ring-dd-forest'
                    : 'border-dd-line bg-white text-dd-ink hover:border-dd-forest/60'
                }`}
              >
                <UserCheck className="size-4 shrink-0" aria-hidden="true" />
                <span className="text-sm">Member Sudah Terdaftar</span>
              </button>
            </div>

            {isNewCustomer ? (
              <div className="space-y-4 rounded-dd-md border border-dd-line bg-white p-4">
                <div className="space-y-1">
                  <TextInput
                    label="Nama Lengkap Member"
                    required
                    value={displayName}
                    placeholder="Contoh: Dewi Lestari"
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                  {displayName.trim().length > 0 && displayName.trim().length < 2 && (
                    <p className="m-0 text-xs text-dd-danger">Nama member minimal 2 karakter.</p>
                  )}
                </div>

                <div className="space-y-1">
                  <TextInput
                    label="Nomor WhatsApp"
                    required
                    type="tel"
                    value={phone}
                    placeholder="Contoh: 081234567890"
                    onChange={(e) => setPhone(e.target.value)}
                  />
                  {step1PhoneError ? (
                    <p className="m-0 text-xs text-dd-danger">{step1PhoneError}</p>
                  ) : (
                    <p className="m-0 text-xs text-dd-muted">
                      Nomor WhatsApp aktif untuk kirim info booking dan tautan check-in mandiri.
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <TextInput
                    label="Alamat Email (Opsional)"
                    type="email"
                    value={email}
                    placeholder="dewi@example.com"
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-dd-md border border-dd-line bg-white p-4">
                <AsyncSearchSelect
                  label="Cari Akun Member"
                  required
                  value={existingCustomerOption?.id ?? ''}
                  selectedOption={existingCustomerOption}
                  placeholder="Ketik nama, nomor telepon, atau email…"
                  loadOptions={searchExistingCustomers}
                  onChange={(_id, opt) => setExistingCustomerOption(opt)}
                />
              </div>
            )}
          </div>
        )}

        {/* STEP 2: CLASS SLOT SELECTION */}
        {step === 2 && (
          <div className="space-y-4" data-testid="walkin-step-2">
            <div>
              <h3 className="m-0 text-base font-semibold text-dd-ink">Pilih Kelas Hari Ini</h3>
              <p className="m-0 mt-0.5 text-xs text-dd-muted">
                Pilih sesi kelas aktif hari ini di {branch.name} yang ingin diikuti langsung.
              </p>
            </div>

            {availableSlots.length === 0 ? (
              <Feedback kind="info">
                Tidak ada kelas yang masih berlangsung atau akan mulai hari ini di {branch.name}.
              </Feedback>
            ) : (
              <div className="grid gap-2.5">
                {availableSlots.map((slot) => {
                  const isSelected = selectedSlotId === slot.id;
                  const isFull = slot.bookedCount >= slot.capacity;
                  const availableSeats = Math.max(0, slot.capacity - slot.bookedCount);
                  const startTime = formatBranchTime(slot.startAt, timezone);
                  const endTime = formatBranchTime(slot.endAt, timezone);

                  return (
                    <button
                      key={slot.id}
                      type="button"
                      disabled={isFull}
                      onClick={() => setSelectedSlotId(slot.id)}
                      className={`relative flex w-full flex-col gap-1.5 rounded-dd-md border p-3.5 text-left transition ${
                        isFull
                          ? 'cursor-not-allowed border-dd-line bg-dd-sand/30 opacity-60'
                          : isSelected
                            ? 'border-dd-forest bg-dd-success-soft/30 ring-1 ring-dd-forest'
                            : 'border-dd-line bg-white hover:border-dd-forest/60'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-sm font-bold tabular-nums text-dd-ink">
                          <Clock className="size-3.5 text-dd-forest" aria-hidden="true" />
                          {startTime} – {endTime}
                        </span>
                        {isFull ? (
                          <span className="rounded-full bg-dd-danger/10 px-2 py-0.5 text-xs font-semibold text-dd-danger">
                            Penuh
                          </span>
                        ) : (
                          <span className="rounded-full bg-dd-forest/10 px-2 py-0.5 text-xs font-semibold text-dd-forest">
                            Tersisa {availableSeats} kursi
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-dd-ink">
                          {getClassName(slot)}
                        </span>
                        {isSelected && (
                          <span className="flex items-center gap-1 text-xs font-semibold text-dd-forest">
                            <CheckCircle2 className="size-3.5" aria-hidden="true" />
                            Dipilih
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-dd-muted">
                        <span>Studio: {getStudioName(slot)}</span>
                        <span>•</span>
                        <span>Instruktur: {getInstructorName(slot)}</span>
                        <span>•</span>
                        <span>
                          {slot.bookedCount} / {slot.capacity} peserta
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* STEP 3: PACKAGE & CASHIER PAYMENT */}
        {step === 3 && (
          <div className="space-y-5" data-testid="walkin-step-3">
            <div>
              <h3 className="m-0 text-base font-semibold text-dd-ink">Pilih Paket & Kasir Studio</h3>
              <p className="m-0 mt-0.5 text-xs text-dd-muted">
                Pilih paket latihan dan metode pembayaran kasir meja depan.
              </p>
            </div>

            {/* Selected Slot Summary Pill */}
            {selectedSlot && (
              <div className="flex items-center justify-between rounded-dd-md border border-dd-forest/30 bg-dd-forest/5 p-3 text-xs text-dd-forest">
                <div className="flex items-center gap-2">
                  <Calendar className="size-4 shrink-0" aria-hidden="true" />
                  <span className="font-semibold">
                    Kelas Hari Ini: {getClassName(selectedSlot)} ({formatBranchTime(selectedSlot.startAt, timezone)} –{' '}
                    {formatBranchTime(selectedSlot.endAt, timezone)})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="font-semibold underline hover:text-dd-forest/80"
                >
                  Ganti
                </button>
              </div>
            )}

            {/* Package Selection */}
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-dd-ink">Pilihan Paket Member</label>
              {packagesLoading ? (
                <div className="py-4 text-center text-xs text-dd-muted">Memuat paket cabang…</div>
              ) : packages.length === 0 ? (
                <Feedback kind="warning">Tidak ada paket aktif untuk cabang ini.</Feedback>
              ) : (
                <div className="grid gap-2">
                  {packages.map((pkg) => {
                    const isSelected = selectedPackageId === pkg.id;
                    return (
                      <button
                        key={pkg.id}
                        type="button"
                        onClick={() => setSelectedPackageId(pkg.id)}
                        className={`flex w-full items-center justify-between rounded-dd-md border p-3 text-left transition ${
                          isSelected
                            ? 'border-dd-forest bg-dd-success-soft/30 ring-1 ring-dd-forest'
                            : 'border-dd-line bg-white hover:border-dd-forest/60'
                        }`}
                      >
                        <div>
                          <p className="m-0 text-sm font-semibold text-dd-ink">{pkg.name}</p>
                          <p className="m-0 text-xs text-dd-muted">
                            {pkg.sessionCount} Sesi · Berlaku {pkg.durationDays} hari
                          </p>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-bold text-dd-forest">
                            {formatRupiah(pkg.priceRp)}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Payment Method Selector */}
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-dd-ink">Metode Pembayaran Kasir</label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('CASH')}
                  className={`flex flex-col items-center justify-center gap-1.5 rounded-dd-md border p-3 text-center transition ${
                    paymentMethod === 'CASH'
                      ? 'border-dd-forest bg-dd-forest text-white font-semibold'
                      : 'border-dd-line bg-white text-dd-ink hover:border-dd-forest'
                  }`}
                >
                  <Wallet className="size-5" aria-hidden="true" />
                  <span className="text-xs">💵 Tunai / Cash</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentMethod('CARD')}
                  className={`flex flex-col items-center justify-center gap-1.5 rounded-dd-md border p-3 text-center transition ${
                    paymentMethod === 'CARD'
                      ? 'border-dd-forest bg-dd-forest text-white font-semibold'
                      : 'border-dd-line bg-white text-dd-ink hover:border-dd-forest'
                  }`}
                >
                  <CreditCard className="size-5" aria-hidden="true" />
                  <span className="text-xs">💳 Kartu (EDC)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentMethod('QRIS')}
                  className={`flex flex-col items-center justify-center gap-1.5 rounded-dd-md border p-3 text-center transition ${
                    paymentMethod === 'QRIS'
                      ? 'border-dd-forest bg-dd-forest text-white font-semibold'
                      : 'border-dd-line bg-white text-dd-ink hover:border-dd-forest'
                  }`}
                >
                  <QrCode className="size-5" aria-hidden="true" />
                  <span className="text-xs">📱 QRIS Studio</span>
                </button>
              </div>
            </div>

            {/* Payment Note */}
            <div>
              <TextInput
                label="Catatan Pembayaran / No. Struk (Opsional)"
                value={paymentNote}
                placeholder="Contoh: Uang tunai pas diterima di meja resepsionis"
                onChange={(e) => setPaymentNote(e.target.value)}
              />
            </div>

            {/* Maker-Checker & Instant Reserve Explanation Box */}
            <div className="rounded-dd-md border border-dd-forest/30 bg-dd-forest/5 p-4 text-xs text-dd-ink space-y-2">
              <div className="flex items-center gap-1.5 font-bold text-dd-forest">
                <Sparkles className="size-4 shrink-0" aria-hidden="true" />
                <span>Instant Reserve Sesi Pertama & Rekap Kasir</span>
              </div>
              <p className="m-0 leading-relaxed text-dd-ink">
                <strong>1. Kursi Terkonfirmasi Instan:</strong> Member langsung terdaftar di kelas hari ini sehingga dapat segera masuk latihan tanpa menunggu persetujuan.
              </p>
              <p className="m-0 leading-relaxed text-dd-muted">
                <strong>2. Rekapitulasi Kasir Studio (Maker-Checker):</strong> Catatan pembayaran kasir ini otomatis masuk antrean verifikasi Manager untuk rekonsiliasi kas harian studio.
              </p>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}
