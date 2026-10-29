'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronLeft,
  MapPin,
  SlidersHorizontal,
  Ticket,
  X,
} from 'lucide-react';
import {
  browserPublicClassCatalogClient,
  publicCatalogFailure,
  type PublicBranch,
  type PublicClassCatalogClient,
  type PublicClassSlot,
} from '@/api-clients/public-class-catalog-client';
import {
  browserLedgerClient,
  paketBerlakuDiCabang,
  type LedgerBalance,
  type LedgerClient,
} from '@/api-clients/ledger-client';
import { browserBookingClient, type BookingClient } from '@/api-clients/booking-client';
import { BookingConfirmationSheet } from '../components/booking/booking-confirmation-sheet';
import { PublicFooter } from '../components/public/public-footer';
import { PublicHeader } from '../components/public/public-header';
import { useSessionContext } from '../session-context';
import { isCustomerOnlySession } from '@/lib/session-audience';
import { formatTanggalSingkat } from '@/lib/formatters';
import { formatStudioName, formatTanggalHuman } from '@/lib/system-dictionary';

function dayKey(value: string, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

function dateLabel(value: string, timezone: string) {
  return formatTanggalSingkat(value, { timeZone: timezone, weekday: 'long', month: 'long' });
}

function timeLabel(value: string, timezone: string) {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

/** Kalimat banner jadwal menurut status verifikasi; `returnTo` membawa member kembali ke jadwal setelah selesai. */
function verificationBannerFor(status: string | undefined, here: string) {
  const to = `/account/verification?returnTo=${encodeURIComponent(here)}`;
  switch (status) {
    case 'PENDING':
      return {
        message:
          'Dokumen verifikasi Anda sedang diperiksa tim studio. Anda bisa memesan kelas setelah disetujui.',
        action: 'Cek status verifikasi',
        href: '/account/verification',
      };
    case 'REJECTED':
      return {
        message:
          'Verifikasi identitas Anda belum disetujui. Perbaiki dokumen untuk bisa memesan kelas.',
        action: 'Perbaiki dokumen',
        href: to,
      };
    case 'ACTION_REQUIRED':
      return {
        message: 'Ambil foto selfie dulu supaya bisa memesan kelas. Tidak perlu KTP.',
        action: 'Lengkapi verifikasi',
        href: to,
      };
    default:
      return null;
  }
}

function durationLabel(startAt: string, endAt: string) {
  const minutes = Math.max(
    0,
    Math.round((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60_000),
  );
  return `${minutes} menit`;
}

export function PublicClassesView({
  client = browserPublicClassCatalogClient,
  ledgerClient = browserLedgerClient,
  bookingClient = browserBookingClient,
}: {
  client?: PublicClassCatalogClient;
  ledgerClient?: LedgerClient;
  bookingClient?: BookingClient;
}) {
  const sessionContext = useSessionContext();
  const session = sessionContext?.session;
  const inCustomerShell = isCustomerOnlySession(session);
  const isCustomer = Boolean(session && inCustomerShell);
  const isStaff = Boolean(session && !isCustomerOnlySession(session));
  // Staf hanya diarahkan ke workspace (cutoff booking tidak relevan); customer/tamu mengikuti canBook.
  const isActionable = (slot: PublicClassSlot) => (isStaff ? slot.available > 0 : slot.canBook);
  const [branches, setBranches] = useState<PublicBranch[]>([]);
  const [branchId, setBranchId] = useState('');
  const [slots, setSlots] = useState<PublicClassSlot[]>([]);
  const [day, setDay] = useState('');
  const [classType, setClassType] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [customerPackages, setCustomerPackages] = useState<LedgerBalance[]>([]);
  const [onlyEligible, setOnlyEligible] = useState(false);
  const [isStudioSheetOpen, setIsStudioSheetOpen] = useState(false);
  const [isTypeSheetOpen, setIsTypeSheetOpen] = useState(false);
  const [bookingSlot, setBookingSlot] = useState<PublicClassSlot | null>(null);
  const [isBookingSheetOpen, setIsBookingSheetOpen] = useState(false);
  // classSlotId -> bookingId untuk booking aktif pelanggan, agar kartu kelas yang sudah dipesan tidak menawarkan booking lagi.
  const verificationBanner = verificationBannerFor(
    session?.identityVerificationStatus,
    typeof window !== 'undefined'
      ? `${window.location.pathname}${window.location.search}`
      : '/classes',
  );
  const [bookedBySlot, setBookedBySlot] = useState<Map<string, string>>(() => new Map());

  useEffect(() => {
    let active = true;
    if (session && inCustomerShell) {
      ledgerClient
        .list(undefined, undefined, undefined, 'ACTIVE')
        .then((res) => {
          if (!active) return;
          setCustomerPackages(
            res.items.filter((item) => item.status === 'ACTIVE' && item.available > 0),
          );
        })
        .catch(() => {
          if (!active) return;
          setCustomerPackages([]);
        });
    } else {
      setCustomerPackages([]);
    }
    return () => {
      active = false;
    };
  }, [session, inCustomerShell, ledgerClient]);

  const loadBookedSlots = useCallback(async () => {
    if (!isCustomer) {
      setBookedBySlot(new Map());
      return;
    }
    try {
      const page = await bookingClient.list({ status: 'BOOKED', timeline: 'UPCOMING', limit: 100 });
      setBookedBySlot(new Map((page?.items ?? []).map((item) => [item.classSlotId, item.id])));
    } catch {
      // Tanpa penanda "sudah dibooking"; server tetap menolak booking ganda.
    }
  }, [isCustomer, bookingClient]);

  useEffect(() => {
    void loadBookedSlots();
  }, [loadBookedSlots]);

  const findMatchingPackage = (slot: PublicClassSlot) => {
    if (!customerPackages.length) return null;
    return customerPackages.find((pkg) => {
      const branchMatches = paketBerlakuDiCabang(pkg, slot.branchId);
      const classTypeMatches = !pkg.classTypeId || pkg.classTypeId === slot.classType.id;
      const hasAvailable = pkg.available > 0;
      const notExpired = new Date(pkg.expiryAt) > new Date();
      return branchMatches && classTypeMatches && hasAvailable && notExpired;
    });
  };

  useEffect(() => {
    let active = true;
    setStatus('loading');
    void client
      .list({})
      .then((result) => {
        if (!active) return;
        setBranches(result.branches);
        setStatus('ready');
        const query = new URLSearchParams(window.location.search);
        setDay(query.get('date') ?? '');
        setClassType(query.get('classType') ?? '');
        const requestedBranchId = query.get('branch');
        const requestedStudio = query.get('studio');
        const requestedBranch = result.branches.find(
          ({ id, name }) =>
            id === requestedBranchId ||
            name.toLocaleLowerCase('id-ID') === requestedStudio?.toLocaleLowerCase('id-ID'),
        );
        let savedBranchId: string | null = null;
        try {
          if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
            savedBranchId = window.localStorage.getItem('dd_last_selected_branch');
          }
        } catch {}
        const preferredBranch =
          requestedBranch ??
          result.branches.find(({ id }) => id === session?.preferredBranch?.id) ??
          (savedBranchId ? result.branches.find(({ id }) => id === savedBranchId) : undefined);
        if (preferredBranch) {
          setBranchId(preferredBranch.id);
          void load(preferredBranch.id);
        }
      })
      .catch((error) => {
        if (!active) return;
        setMessage(publicCatalogFailure(error));
        setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [client, session?.preferredBranch?.id]);

  useEffect(() => {
    if (branches.length > 0 && customerPackages.length > 0) {
      const query = new URLSearchParams(window.location.search);
      if (query.get('branch') || query.get('studio')) return;
      const pkgBranchId = customerPackages[0]?.packageBranchId || customerPackages[0]?.branchId;
      const hasActivePkgInCurrentBranch = customerPackages.some((pkg) =>
        paketBerlakuDiCabang(pkg, branchId),
      );
      if (!hasActivePkgInCurrentBranch && pkgBranchId) {
        const matchingBranch = branches.find((b) => b.id === pkgBranchId);
        if (matchingBranch && matchingBranch.id !== branchId) {
          handleSelectBranch(matchingBranch.id);
        }
      }
    }
  }, [branches, branchId, customerPackages]);

  const load = async (selectedBranch = branchId) => {
    if (!selectedBranch) return;
    setStatus('loading');
    setMessage('');
    try {
      const from = new Date();
      const until = new Date(from.getTime() + 14 * 86_400_000);
      const result = await client.list({ branchId: selectedBranch, from, until });
      setBranches(result.branches);
      setSlots(result.items);
      setStatus('ready');

      const querySlot =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('slot')
          : null;
      if (querySlot) {
        const found = result.items.find((s) => s.id === querySlot);
        if (found) {
          setBookingSlot(found);
          setIsBookingSheetOpen(true);
        }
      }
    } catch (error) {
      setSlots([]);
      setMessage(publicCatalogFailure(error));
      setStatus('error');
    }
  };

  const handleSelectBranch = (selectedId: string) => {
    setBranchId(selectedId);
    try {
      if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
        if (selectedId) {
          window.localStorage.setItem('dd_last_selected_branch', selectedId);
        } else {
          window.localStorage.removeItem('dd_last_selected_branch');
        }
      }
    } catch {}
    setSlots([]);
    setDay('');
    setClassType('');
    updateQuery({ branch: selectedId, studio: '', date: '', classType: '' });
    if (selectedId) void load(selectedId);
  };

  const retryCatalog = async () => {
    if (branchId) {
      await load(branchId);
      return;
    }
    setStatus('loading');
    setMessage('');
    try {
      const result = await client.list({});
      setBranches(result.branches);
      const query = new URLSearchParams(window.location.search);
      const requestedBranchId = query.get('branch');
      const requestedStudio = query.get('studio');
      const requestedBranch = result.branches.find(
        ({ id, name }) =>
          id === requestedBranchId ||
          name.toLocaleLowerCase('id-ID') === requestedStudio?.toLocaleLowerCase('id-ID'),
      );
      let savedBranchId: string | null = null;
      try {
        if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
          savedBranchId = window.localStorage.getItem('dd_last_selected_branch');
        }
      } catch {}
      const preferredBranch =
        requestedBranch ??
        result.branches.find(({ id }) => id === session?.preferredBranch?.id) ??
        (savedBranchId ? result.branches.find(({ id }) => id === savedBranchId) : undefined);
      if (preferredBranch) {
        setBranchId(preferredBranch.id);
        await load(preferredBranch.id);
      } else {
        setStatus('ready');
      }
    } catch (error) {
      setMessage(publicCatalogFailure(error));
      setStatus('error');
    }
  };

  const branch = branches.find((item) => item.id === branchId);
  const activeStudio =
    branch ??
    (sessionContext?.activeBranch ? { ...sessionContext.activeBranch } : undefined) ??
    (session?.preferredBranch ? { ...session.preferredBranch } : undefined) ??
    (session?.branches?.[0] ? { ...session.branches[0] } : undefined);
  const activeStudioName = activeStudio
    ? formatStudioName(activeStudio.code || activeStudio.name, 'full')
    : 'studio Daily Dose';
  const classTypes = useMemo(
    () => [...new Map(slots.map((slot) => [slot.classType.id, slot.classType])).values()],
    [slots],
  );
  const visible = slots.filter((slot) => {
    if (day && dayKey(slot.startAt, slot.timezone) !== day) return false;
    if (classType && slot.classType.id !== classType) return false;
    if (onlyEligible && (!isActionable(slot) || !findMatchingPackage(slot))) return false;
    return true;
  });
  const grouped = visible.reduce<Record<string, PublicClassSlot[]>>((groups, slot) => {
    const key = dayKey(slot.startAt, slot.timezone);
    groups[key] = [...(groups[key] ?? []), slot];
    return groups;
  }, {});

  const calendarDays = useMemo(() => {
    if (!branch) return [];
    const tz = branch.timezone || 'Asia/Jakarta';
    const now = new Date();
    let baseDate = now;
    if (slots.length > 0) {
      const earliestSlotTime = Math.min(...slots.map((s) => new Date(s.startAt).getTime()));
      if (Math.abs(earliestSlotTime - now.getTime()) > 14 * 86_400_000) {
        baseDate = new Date(earliestSlotTime);
      }
    }

    const days: {
      key: string;
      label: string;
      weekdayShort: string;
      dayNumber: string;
      count: number;
    }[] = [];

    for (let i = 0; i < 14; i++) {
      const d = new Date(baseDate.getTime() + i * 86_400_000);
      const key = dayKey(d.toISOString(), tz);
      const count = slots.filter((slot) => dayKey(slot.startAt, slot.timezone) === key).length;
      const weekdayShort = new Intl.DateTimeFormat('id-ID', { timeZone: tz, weekday: 'short' })
        .format(d)
        .replace('.', '')
        .toUpperCase();
      const dayNumber = new Intl.DateTimeFormat('id-ID', { timeZone: tz, day: 'numeric' }).format(
        d,
      );
      const label = dateLabel(d.toISOString(), tz);
      days.push({ key, label, weekdayShort, dayNumber, count });
    }

    return days;
  }, [branch, slots]);

  const updateQuery = (updates: Record<string, string>) => {
    const query = new URLSearchParams(window.location.search);
    Object.entries(updates).forEach(([key, value]) => {
      if (value) query.set(key, value);
      else query.delete(key);
    });
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${query.size ? `?${query}` : ''}${window.location.hash}`,
    );
  };

  const hasFilterChanged = Boolean(day || classType || onlyEligible);

  const handleResetFilter = () => {
    setDay('');
    setClassType('');
    setOnlyEligible(false);
    updateQuery({ date: '', classType: '' });
  };

  return (
    <div className="min-w-0 overflow-x-clip bg-dd-surface text-dd-ink">
      <a className="skip-link" href="#catalog-main">
        Langsung ke jadwal
      </a>
      {!inCustomerShell && <PublicHeader />}

      <main id="catalog-main" className="mx-auto max-w-4xl px-4 py-4 sm:px-6 sm:py-6">
        {/* 1. Header 56 px */}
        <div className="flex h-14 min-h-[56px] items-center justify-between gap-3 border-b border-dd-line/60 pb-3">
          <div className="flex items-center gap-3">
            <Link
              href={inCustomerShell ? '/account' : '/'}
              aria-label={inCustomerShell ? 'Kembali ke Beranda' : 'Kembali ke situs utama'}
              className="inline-flex size-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-dd-md border border-dd-border-interactive bg-white text-dd-forest transition hover:bg-dd-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dd-forest"
            >
              <ChevronLeft className="size-5" aria-hidden="true" />
            </Link>
            <h1 className="text-xl font-bold tracking-tight text-dd-ink sm:text-2xl">
              Jadwal kelas
            </h1>
          </div>
          {branch && (
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-dd-forest/20 bg-dd-forest-soft px-3 py-1 text-xs font-semibold text-dd-forest">
              <MapPin className="size-3.5" aria-hidden="true" />
              <span>{branch.name}</span>
            </span>
          )}
        </div>

        {/* Verifikasi Status Banner (jika login tapi belum disetujui) */}
        {isCustomer && verificationBanner && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-dd-md border border-amber-800/30 bg-amber-50 p-4 text-xs sm:text-sm text-amber-900">
            <div className="flex items-center gap-2.5">
              <AlertCircle className="size-4 text-amber-800 shrink-0" />
              <span>{verificationBanner.message}</span>
            </div>
            <Link
              href={verificationBanner.href}
              className="font-semibold text-amber-900 underline shrink-0 hover:text-dd-ink"
            >
              {verificationBanner.action} →
            </Link>
          </div>
        )}

        {/* Customer Active Package Bar */}
        {isCustomer && customerPackages.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-dd-md border border-dd-forest/20 bg-dd-forest-soft p-4 text-xs sm:text-sm text-dd-forest">
            <div className="flex items-center gap-2.5">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-dd-sm bg-white text-dd-forest shadow-2xs">
                <Ticket className="size-3.5" aria-hidden="true" />
              </div>
              <div>
                <span className="font-semibold text-dd-forest">Paket Aktif: </span>
                <strong className="text-dd-ink">{customerPackages[0]!.packageName}</strong>
                <span className="text-dd-muted"> · {customerPackages[0]!.branchName}</span>
                <span className="text-dd-muted"> · Sisa </span>
                <strong className="text-dd-forest font-semibold">
                  {customerPackages[0]!.available} sesi
                </strong>
                <span className="text-dd-muted">
                  {' '}
                  (Berlaku s/d{' '}
                  {new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(
                    new Date(customerPackages[0]!.expiryAt),
                  )}
                  )
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 font-medium text-dd-forest cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={onlyEligible}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setOnlyEligible(checked);
                    if (checked) {
                      const targetBranchId =
                        customerPackages[0]?.packageBranchId || customerPackages[0]?.branchId;
                      if (targetBranchId && branchId !== targetBranchId) {
                        handleSelectBranch(targetBranchId);
                      }
                    }
                  }}
                  className="size-4 accent-dd-forest rounded-dd-sm"
                />
                <span>Hanya kelas sesuai paket saya</span>
              </label>
              <Link
                href="/account/packages"
                className="font-semibold text-dd-forest hover:underline"
              >
                Kelola paket →
              </Link>
            </div>
          </div>
        )}

        {/* 2. Baris Tanggal Horizontal (7 Pil 56 x 64 px) */}
        {branchId && status !== 'loading' && calendarDays.length > 0 && (
          <div className="mt-4">
            <div
              className="flex gap-2 overflow-x-auto pb-2 pt-1 scrollbar-none"
              role="group"
              aria-label="Pilih tanggal cepat"
            >
              {calendarDays.map((item) => {
                const isSelected = day === item.key;
                return (
                  <button
                    type="button"
                    key={item.key}
                    onClick={() => {
                      const nextDay = isSelected ? '' : item.key;
                      setDay(nextDay);
                      updateQuery({ date: nextDay });
                    }}
                    aria-label={`${item.label}, ${item.count} kelas tersedia`}
                    aria-pressed={isSelected}
                    className={`flex h-[64px] min-h-[64px] w-[56px] min-w-[56px] shrink-0 flex-col items-center justify-center rounded-dd-md transition-colors cursor-pointer ${
                      isSelected
                        ? 'border-transparent bg-[#396552] text-white shadow-xs'
                        : 'border-[1.5px] border-[#7a848f] bg-white text-dd-ink hover:bg-dd-surface-muted'
                    }`}
                  >
                    <span
                      className={`text-[13px] font-semibold tracking-wide ${
                        isSelected ? 'text-white/90' : 'text-dd-muted'
                      }`}
                    >
                      {item.weekdayShort}
                    </span>
                    <span className="mt-1 text-[20px] font-bold leading-none">
                      {item.dayNumber}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 3. Baris Filter Ringkas (2 Tombol Sejajar: Studio & Tipe Kelas) */}
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          {/* Studio button */}
          <button
            type="button"
            role="combobox"
            aria-expanded={isStudioSheetOpen}
            aria-haspopup="dialog"
            aria-label="Studio"
            onClick={() => setIsStudioSheetOpen(true)}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-dd-md border border-dd-border-interactive bg-white px-3.5 py-2 text-sm font-semibold text-dd-ink transition hover:bg-dd-surface-muted cursor-pointer"
          >
            <MapPin className="size-4 text-dd-forest shrink-0" aria-hidden="true" />
            <span>Studio: {branch ? branch.name : 'Pilih studio'}</span>
            <ChevronDown className="size-4 text-dd-muted shrink-0 ml-0.5" aria-hidden="true" />
          </button>

          {/* Tipe kelas button */}
          <button
            type="button"
            role="combobox"
            aria-expanded={isTypeSheetOpen}
            aria-haspopup="dialog"
            aria-label="Tipe kelas"
            disabled={!branchId}
            onClick={() => setIsTypeSheetOpen(true)}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-dd-md border border-dd-border-interactive bg-white px-3.5 py-2 text-sm font-semibold text-dd-ink transition hover:bg-dd-surface-muted disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
          >
            <SlidersHorizontal className="size-4 text-dd-forest shrink-0" aria-hidden="true" />
            <span>Tipe kelas: {classTypes.find((t) => t.id === classType)?.name ?? 'Semua'}</span>
            <ChevronDown className="size-4 text-dd-muted shrink-0 ml-0.5" aria-hidden="true" />
          </button>

          {/* Reset filter link */}
          {hasFilterChanged && (
            <button
              type="button"
              onClick={handleResetFilter}
              className="inline-flex min-h-[44px] items-center text-xs font-semibold text-dd-forest underline hover:text-dd-ink cursor-pointer px-1"
            >
              Reset filter
            </button>
          )}
        </div>

        {/* 4. Daftar Sesi Hari Terpilih */}
        <div className="mt-5">
          {status === 'loading' ? (
            <div
              className="rounded-dd-xl border border-dd-line bg-white p-6 sm:p-8 space-y-4"
              role="status"
              aria-label={`Memuat jadwal ${activeStudioName}...`}
            >
              <p className="text-sm font-medium text-dd-muted">Memuat jadwal {activeStudioName}…</p>
              {/* Kerangka abu tanpa animasi berulang */}
              <div className="space-y-3 pt-1">
                <div className="h-16 rounded-dd-lg bg-dd-surface-muted border border-dd-line/60" />
                <div className="h-16 rounded-dd-lg bg-dd-surface-muted border border-dd-line/60" />
                <div className="h-16 rounded-dd-lg bg-dd-surface-muted border border-dd-line/60" />
              </div>
            </div>
          ) : status === 'error' ? (
            <div
              className="rounded-dd-xl border border-red-900/20 bg-red-50 p-8 text-center text-red-900"
              role="alert"
            >
              <strong className="text-xl font-bold">Jadwal gagal dimuat</strong>
              <p className="mt-2 text-sm text-red-800">
                {message || 'Jadwal gagal dimuat. Koneksi internet terputus saat mengambil data.'}
              </p>
              <button
                className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-dd-md bg-white px-4 py-2 text-sm font-bold text-red-900 border border-red-300 hover:bg-red-100 cursor-pointer"
                type="button"
                onClick={() => void retryCatalog()}
              >
                Coba muat ulang
              </button>
            </div>
          ) : !branchId ? (
            <div className="rounded-dd-xl border border-dd-line bg-white p-6 sm:p-8 text-center">
              <MapPin className="mx-auto size-8 text-dd-forest" />
              <strong className="mt-3 block text-lg font-bold text-dd-ink">
                Pilih studio untuk melihat kelas
              </strong>
              <p className="mt-1 text-sm text-dd-muted">
                Silakan pilih studio terlebih dahulu untuk menampilkan jadwal kelas yang tersedia.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2.5">
                {branches.map((b) => (
                  <button
                    type="button"
                    key={b.id}
                    onClick={() => handleSelectBranch(b.id)}
                    className="min-h-[44px] rounded-dd-md border border-dd-border-interactive bg-white px-4 py-2.5 text-sm font-bold text-dd-ink transition hover:bg-dd-forest hover:text-white cursor-pointer"
                  >
                    {b.name}
                  </button>
                ))}
              </div>
            </div>
          ) : visible.length === 0 ? (
            <div className="rounded-dd-xl border border-dd-line bg-white p-6 sm:p-8 text-center">
              <strong className="text-lg font-bold text-dd-ink">
                {day
                  ? `Tidak ada kelas pada ${formatTanggalHuman(new Date(`${day}T12:00:00Z`), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`
                  : 'Belum ada kelas pada filter ini'}
              </strong>
              <p className="mt-1 text-sm text-dd-muted">
                {day
                  ? `Studio ${branches.find((b) => b.id === branchId)?.name ?? 'Daily Dose'} belum membuka kelas di tanggal ini.`
                  : 'Ubah tanggal atau tipe kelas untuk melihat pilihan lain.'}
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-3">
                {day && (
                  <button
                    type="button"
                    onClick={() => {
                      const currentDate = new Date(`${day}T12:00:00Z`);
                      currentDate.setDate(currentDate.getDate() + 1);
                      const nextDay = currentDate.toISOString().slice(0, 10);
                      setDay(nextDay);
                      updateQuery({ date: nextDay });
                    }}
                    className="min-h-[44px] rounded-dd-md border border-dd-border-interactive bg-dd-forest px-4 py-2 text-sm font-bold text-white hover:bg-dd-forest-hover cursor-pointer"
                  >
                    Lihat tanggal berikutnya
                  </button>
                )}
                {day && (
                  <button
                    type="button"
                    onClick={() => {
                      setDay('');
                      updateQuery({ date: '' });
                    }}
                    className="min-h-[44px] rounded-dd-md border border-dd-border-interactive bg-white px-4 py-2 text-sm font-bold text-dd-forest hover:bg-dd-forest-soft cursor-pointer"
                  >
                    Lihat Semua Tanggal
                  </button>
                )}
                <a
                  href="https://wa.me/6281234567890?text=Halo%20Daily%20Dose,%20saya%20ingin%20tanya%20jadwal%20kelas"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-[44px] inline-flex items-center justify-center rounded-dd-md bg-dd-forest px-4 py-2 text-sm font-bold text-white shadow-xs hover:bg-dd-forest-hover"
                >
                  Bantuan CS WhatsApp
                </a>
              </div>
            </div>
          ) : (
            <div className="grid gap-6" aria-live="polite">
              {Object.entries(grouped).map(([date, items]) => (
                <section
                  className="overflow-hidden rounded-dd-xl border border-dd-line bg-white"
                  aria-labelledby={`day-${date}`}
                  key={date}
                >
                  <header className="border-b border-dd-line/60 bg-dd-surface-muted/40 px-5 py-3.5">
                    <h2
                      className="font-sans text-base sm:text-lg font-bold tracking-tight text-dd-ink"
                      id={`day-${date}`}
                    >
                      {dateLabel(items[0]!.startAt, items[0]!.timezone)}
                    </h2>
                  </header>
                  <div className="divide-y divide-dd-line/60">
                    {items.map((slot) => {
                      const isFull = slot.available < 1;
                      const actionable = isActionable(slot);
                      const matchingPkg = findMatchingPackage(slot);
                      const bookedId = isCustomer ? bookedBySlot.get(slot.id) : undefined;

                      return (
                        <article
                          className={`p-4 sm:p-5 transition ${
                            isFull
                              ? 'bg-dd-surface-muted/20 opacity-75'
                              : 'hover:bg-dd-surface-muted/10'
                          }`}
                          key={slot.id}
                        >
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="grid gap-2 sm:grid-cols-[130px_minmax(0,1fr)] sm:gap-5 sm:items-center">
                              {/* Jam & Durasi */}
                              <div>
                                <strong className="block text-lg sm:text-xl font-bold tracking-tight text-dd-ink">
                                  {timeLabel(slot.startAt, slot.timezone)}
                                </strong>
                                <span className="text-xs text-dd-muted">
                                  sampai {timeLabel(slot.endAt, slot.timezone)} ·{' '}
                                  {durationLabel(slot.startAt, slot.endAt)}
                                </span>
                              </div>

                              {/* Tipe Kelas & Instruktur */}
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <h3 className="font-sans text-base sm:text-lg font-bold text-dd-ink">
                                    {slot.classType.name}
                                  </h3>
                                  {isFull ? (
                                    <span
                                      className="inline-flex items-center rounded-dd-sm border border-[#e8d5be] bg-[#fbf4eb] px-2 py-0.5 text-xs font-semibold text-[#8a5b17]"
                                      aria-disabled="true"
                                    >
                                      Penuh, 0 slot
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center rounded-dd-sm border border-dd-forest/20 bg-dd-forest-soft px-2 py-0.5 text-xs font-semibold text-dd-forest">
                                      Sisa {slot.available} tempat
                                    </span>
                                  )}
                                </div>

                                {slot.instructor?.displayName && (
                                  <p className="mt-1 text-xs font-medium text-dd-muted">
                                    Instruktur · {slot.instructor.displayName}
                                  </p>
                                )}

                                {/* Smart Booking Badges */}
                                {bookedId && (
                                  <span className="mt-1.5 inline-flex items-center gap-1 rounded-dd-sm border border-dd-forest/20 bg-dd-forest-soft px-2 py-0.5 text-[11px] font-semibold text-dd-forest">
                                    <Check className="size-3" /> Sudah Anda booking
                                  </span>
                                )}
                                {isCustomer && !bookedId && !isFull && matchingPkg && (
                                  <span className="mt-1.5 inline-flex items-center gap-1 rounded-dd-sm border border-dd-forest/20 bg-dd-forest-soft px-2 py-0.5 text-[11px] font-semibold text-dd-forest">
                                    <Check className="size-3" /> Paket Sesuai (
                                    {matchingPkg.available} sesi)
                                  </span>
                                )}
                                {isCustomer &&
                                  !bookedId &&
                                  !isFull &&
                                  !matchingPkg &&
                                  customerPackages.length > 0 && (
                                    <span className="mt-1.5 inline-flex items-center gap-1 rounded-dd-sm border border-amber-800/30 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                                      Perlu paket studio/kelas ini
                                    </span>
                                  )}
                              </div>
                            </div>

                            {/* Tombol Aksi */}
                            <div className="shrink-0">
                              {bookedId ? (
                                <a
                                  href={`/bookings/${bookedId}`}
                                  className="inline-flex min-h-[48px] w-full sm:w-auto items-center justify-center rounded-dd-md border-[1.5px] border-dd-border-interactive bg-white px-5 py-2.5 text-sm font-bold text-dd-forest shadow-xs transition hover:bg-dd-surface-muted focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#09371f]"
                                >
                                  Lihat booking
                                </a>
                              ) : isFull ? (
                                <span
                                  className="inline-flex min-h-[44px] w-full sm:w-auto items-center justify-center rounded-dd-md border border-[#e8d5be] bg-[#fbf4eb] px-4 py-2 text-xs font-bold text-[#8a5b17] pointer-events-none select-none cursor-not-allowed"
                                  aria-disabled="true"
                                >
                                  Penuh, 0 slot
                                </span>
                              ) : !actionable ? (
                                <span
                                  className="inline-flex min-h-[48px] w-full sm:w-auto items-center justify-center rounded-dd-md border border-dd-border-interactive bg-[#f8faf9] px-4 py-2 text-xs font-bold text-dd-muted pointer-events-none cursor-not-allowed"
                                  aria-disabled="true"
                                >
                                  Pemesanan ditutup
                                </span>
                              ) : (
                                <a
                                  href={
                                    isStaff
                                      ? '/workspace/classes'
                                      : isCustomer
                                        ? matchingPkg
                                          ? `/bookings/new?slot=${slot.id}`
                                          : `/packages?branch=${encodeURIComponent(slot.branchId)}&classType=${encodeURIComponent(slot.classType.id)}&slot=${encodeURIComponent(slot.id)}`
                                        : session
                                          ? `/bookings/new?slot=${slot.id}`
                                          : `/sign-in?returnTo=${encodeURIComponent(`/bookings/new?slot=${slot.id}`)}`
                                  }
                                  onClick={(e) => {
                                    if (isCustomer && matchingPkg) {
                                      e.preventDefault();
                                      setBookingSlot(slot);
                                      setIsBookingSheetOpen(true);
                                    }
                                  }}
                                  className={`inline-flex min-h-[48px] w-full sm:w-auto items-center justify-center rounded-dd-md px-5 py-2.5 text-sm font-bold shadow-xs transition cursor-pointer focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#09371f] ${
                                    isCustomer && !matchingPkg
                                      ? 'border-[1.5px] border-dd-border-interactive bg-white text-dd-forest hover:bg-dd-surface-muted'
                                      : 'bg-dd-forest text-white hover:bg-dd-forest-dark'
                                  }`}
                                >
                                  {isStaff
                                    ? 'Buka workspace kelas'
                                    : isCustomer && !matchingPkg
                                      ? 'Beli paket untuk kelas ini'
                                      : !session
                                        ? 'Masuk untuk booking'
                                        : 'Lanjutkan booking'}
                                </a>
                              )}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Bottom Sheet Studio */}
      {isStudioSheetOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Pilih Lokasi Studio"
          className="fixed inset-0 z-50 flex flex-col justify-end bg-[#111827]/45 backdrop-blur-xs"
          onClick={() => setIsStudioSheetOpen(false)}
        >
          <div
            className="max-h-[80vh] w-full overflow-y-auto rounded-t-[20px] bg-white p-6 shadow-2xl transition-transform"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-dd-line" />
            <div className="flex items-center justify-between pb-3 border-b border-dd-line/60">
              <h2 className="text-lg font-bold text-dd-ink">Pilih Lokasi Studio</h2>
              <button
                type="button"
                onClick={() => setIsStudioSheetOpen(false)}
                className="size-11 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-dd-md text-dd-muted hover:text-dd-ink"
                aria-label="Tutup pemilih studio"
              >
                <X className="size-5" />
              </button>
            </div>
            <div role="listbox" aria-label="Daftar Studio" className="mt-4 grid gap-2">
              {branches.map((b) => {
                const isSelected = b.id === branchId;
                return (
                  <button
                    type="button"
                    key={b.id}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      handleSelectBranch(b.id);
                      setIsStudioSheetOpen(false);
                    }}
                    className={`flex min-h-[48px] w-full items-center justify-between rounded-dd-md px-4 py-3 text-left transition cursor-pointer ${
                      isSelected
                        ? 'bg-dd-forest-soft text-dd-forest font-bold'
                        : 'hover:bg-dd-surface-muted text-dd-ink font-medium'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <MapPin
                        className={`size-4 ${isSelected ? 'text-dd-forest' : 'text-dd-muted'}`}
                      />
                      <span>{b.name}</span>
                    </div>
                    {isSelected && <Check className="size-4 text-dd-forest" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Bottom Sheet Tipe Kelas */}
      {isTypeSheetOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Pilih Tipe Kelas"
          className="fixed inset-0 z-50 flex flex-col justify-end bg-[#111827]/45 backdrop-blur-xs"
          onClick={() => setIsTypeSheetOpen(false)}
        >
          <div
            className="max-h-[80vh] w-full overflow-y-auto rounded-t-[20px] bg-white p-6 shadow-2xl transition-transform"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-dd-line" />
            <div className="flex items-center justify-between pb-3 border-b border-dd-line/60">
              <h2 className="text-lg font-bold text-dd-ink">Pilih Tipe Kelas</h2>
              <button
                type="button"
                onClick={() => setIsTypeSheetOpen(false)}
                className="size-11 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-dd-md text-dd-muted hover:text-dd-ink"
                aria-label="Tutup pemilih tipe kelas"
              >
                <X className="size-5" />
              </button>
            </div>
            <div role="listbox" aria-label="Daftar Tipe Kelas" className="mt-4 grid gap-2">
              <button
                type="button"
                role="option"
                aria-selected={!classType}
                onClick={() => {
                  setClassType('');
                  updateQuery({ classType: '' });
                  setIsTypeSheetOpen(false);
                }}
                className={`flex min-h-[48px] w-full items-center justify-between rounded-dd-md px-4 py-3 text-left transition cursor-pointer ${
                  !classType
                    ? 'bg-dd-forest-soft text-dd-forest font-bold'
                    : 'hover:bg-dd-surface-muted text-dd-ink font-medium'
                }`}
              >
                <span>Semua tipe kelas</span>
                {!classType && <Check className="size-4 text-dd-forest" />}
              </button>
              {classTypes.map((t) => {
                const isSelected = classType === t.id;
                return (
                  <button
                    type="button"
                    key={t.id}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      setClassType(t.id);
                      updateQuery({ classType: t.id });
                      setIsTypeSheetOpen(false);
                    }}
                    className={`flex min-h-[48px] w-full items-center justify-between rounded-dd-md px-4 py-3 text-left transition cursor-pointer ${
                      isSelected
                        ? 'bg-dd-forest-soft text-dd-forest font-bold'
                        : 'hover:bg-dd-surface-muted text-dd-ink font-medium'
                    }`}
                  >
                    <span>{t.name}</span>
                    {isSelected && <Check className="size-4 text-dd-forest" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Booking Confirmation Bottom Sheet (3-Tap Flow) */}
      <BookingConfirmationSheet
        isOpen={isBookingSheetOpen}
        onClose={() => setIsBookingSheetOpen(false)}
        slot={bookingSlot}
        studioName={
          bookingSlot
            ? (branches.find((b) => b.id === bookingSlot.branchId)?.name ?? branch?.name)
            : branch?.name
        }
        packageItem={bookingSlot ? (findMatchingPackage(bookingSlot) ?? null) : null}
        availablePackages={
          bookingSlot
            ? customerPackages.filter((pkg) => {
                const branchMatches = paketBerlakuDiCabang(pkg, bookingSlot.branchId);
                const classTypeMatches =
                  !pkg.classTypeId || pkg.classTypeId === bookingSlot.classType.id;
                return branchMatches && classTypeMatches && pkg.available > 0;
              })
            : []
        }
        isVerified={session?.identityVerificationStatus === 'APPROVED'}
        bookingClient={bookingClient}
        onBookingSuccess={() => {
          if (branchId) void load(branchId);
          void loadBookedSlots();
        }}
        onSlotUnavailable={() => {
          if (branchId) void load(branchId);
          void loadBookedSlots();
        }}
      />

      {!inCustomerShell && <PublicFooter variant="editorial" />}
    </div>
  );
}
