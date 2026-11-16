'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  MapPin,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {
  browserPublicPackageCatalogClient,
  publicPackageFailure,
  type PublicPackageCatalogClient,
  type PublicPackage,
  type PublicPackageBranch,
} from '@/api-clients/public-package-catalog-client';
import { PackagePrice } from '../components/public/package-price';
import { PublicFooter } from '../components/public/public-footer';
import { PublicHeader } from '../components/public/public-header';
import { PublicStatePanel } from '../components/public/public-page';
import { signInReturnTo } from '@/lib/routes';
import type { WebSession } from '@/api-clients/session-client';
import {
  isCustomerOnlySession,
  packageAudienceState,
  type PackageAudienceState,
} from '@/lib/session-audience';
import { useSessionContext } from '../session-context';
import { SearchSelect } from '../components/forms';

export const PRICE_RANGES = [
  { id: 'under-2m', label: '< Rp 2.000.000', min: 0, max: 1_999_999 },
  { id: '2m-5m', label: 'Rp 2.000.000 – Rp 5.000.000', min: 2_000_000, max: 5_000_000 },
  { id: '5m-10m', label: 'Rp 5.000.000 – Rp 10.000.000', min: 5_000_001, max: 10_000_000 },
  { id: 'above-10m', label: '> Rp 10.000.000', min: 10_000_001, max: Infinity },
] as const;

export const SESSION_RANGES = [
  { id: '1-5', label: '1 – 5 sesi', min: 1, max: 5 },
  { id: '6-10', label: '6 – 10 sesi', min: 6, max: 10 },
  { id: '11-20', label: '11 – 20 sesi', min: 11, max: 20 },
  { id: 'above-20', label: '> 20 sesi', min: 21, max: Infinity },
] as const;

export type PackageSortOption = 'cheapest_per_session' | 'most_sessions' | 'popular';

export const PACKAGE_SORT_OPTIONS: { id: PackageSortOption; label: string }[] = [
  { id: 'cheapest_per_session', label: 'Termurah per sesi' },
  { id: 'most_sessions', label: 'Sesi terbanyak' },
  { id: 'popular', label: 'Paling sering dibeli' },
];

export function recommendedPackageId(allItems: PublicPackage[]) {
  // Paket perpanjangan masa aktif (0 sesi) tidak ikut dibandingkan per sesi.
  const items = allItems.filter((item) => item.sessionCount > 0);
  if (items.length < 2) return null;
  return [...items].sort(
    (left, right) =>
      right.sessionCount - left.sessionCount ||
      (left.effectivePriceRp ?? left.priceRp) / left.sessionCount -
        (right.effectivePriceRp ?? right.priceRp) / right.sessionCount ||
      left.id.localeCompare(right.id),
  )[0]!.id;
}

export function recommendedFirst(items: PublicPackage[], recommendedId: string | null) {
  if (!recommendedId) return items;
  const recommended = items.find((item) => item.id === recommendedId);
  return recommended ? [recommended, ...items.filter((item) => item.id !== recommendedId)] : items;
}

export function publicBranchLocation(branch: PublicPackageBranch) {
  const location = branch.name.replace(/^Daily Dose\s+/i, '').trim() || branch.name;
  const timezone = branch.timezone === 'Asia/Jakarta' ? 'WIB' : branch.timezone;
  return `${location} · ${timezone}`;
}

export function packageDescriptor(
  item: PublicPackage,
  items: PublicPackage[],
  recommendedId: string | null,
) {
  if (item.id === recommendedId) return 'Nilai terbaik untuk latihan rutin';
  const minimumSessions = Math.min(...items.map((candidate) => candidate.sessionCount));
  return item.sessionCount === minimumSessions
    ? 'Cocok untuk mulai mencoba'
    : 'Fleksibel untuk latihan mingguan';
}

export function packageCtaLabel(session: WebSession | null) {
  const audience = packageAudienceState(session);
  if (audience === 'GUEST') return 'Masuk untuk memilih';
  if (audience === 'STAFF') return 'Buka Workspace';
  return 'Pilih paket';
}

export function packageJourneyCopy(session: WebSession | null) {
  const audience = packageAudienceState(session);
  if (audience === 'GUEST') return 'Masuk atau buat akun untuk melanjutkan pembelian.';
  if (audience === 'STAFF')
    return 'Anda sedang menggunakan akun staf. Pembelian paket menggunakan akun customer.';
  return 'Pilih paket yang sesuai, lalu lanjutkan ke pembayaran.';
}

export function packageCtaHref(audience: PackageAudienceState, purchase: string): string {
  if (audience === 'GUEST') return signInReturnTo(purchase);
  if (audience === 'STAFF') return '/workspace';
  return purchase;
}

export function isPackagePromoExpired(item: PublicPackage): boolean {
  if (item.effectiveUntil) {
    const expiry = new Date(item.effectiveUntil);
    if (!isNaN(expiry.getTime()) && expiry < new Date()) {
      return true;
    }
  }
  return false;
}

export function filterActivePackages(items: PublicPackage[]): PublicPackage[] {
  return items.filter((item) => !isPackagePromoExpired(item));
}

export function findCheapestPackageId(items: PublicPackage[]): string | null {
  if (!items.length) return null;
  let cheapestId: string | null = null;
  let minPrice = Infinity;

  for (const item of items) {
    if (item.sessionCount > 0) {
      const perSession = (item.effectivePriceRp ?? item.priceRp) / item.sessionCount;
      if (perSession < minPrice) {
        minPrice = perSession;
        cheapestId = item.id;
      }
    }
  }
  return cheapestId;
}

export function sortPackages(items: PublicPackage[], sort: PackageSortOption): PublicPackage[] {
  const copied = [...items];
  switch (sort) {
    case 'cheapest_per_session':
      return copied.sort((a, b) => {
        const perSessionA = (a.effectivePriceRp ?? a.priceRp) / Math.max(1, a.sessionCount);
        const perSessionB = (b.effectivePriceRp ?? b.priceRp) / Math.max(1, b.sessionCount);
        return perSessionA - perSessionB || a.id.localeCompare(b.id);
      });
    case 'most_sessions':
      return copied.sort((a, b) => b.sessionCount - a.sessionCount || a.id.localeCompare(b.id));
    case 'popular':
    default:
      return copied;
  }
}

export function groupPackages(items: PublicPackage[]) {
  const introductory: PublicPackage[] = [];
  const routine: PublicPackage[] = [];

  for (const item of items) {
    if (item.sessionCount >= 1 && item.sessionCount <= 3) {
      introductory.push(item);
    } else {
      routine.push(item);
    }
  }

  return { introductory, routine };
}

function syncCatalogQuery(
  branchId: string,
  classTypeId: string,
  searchQuery = '',
  priceRange = '',
  sessionRange = '',
  sortOption = '',
) {
  if (typeof window === 'undefined') return;
  const query = new URLSearchParams(window.location.search);
  if (branchId) query.set('branch', branchId);
  else query.delete('branch');
  if (classTypeId) query.set('classType', classTypeId);
  else query.delete('classType');
  if (searchQuery.trim()) query.set('q', searchQuery.trim());
  else query.delete('q');
  if (priceRange) query.set('price', priceRange);
  else query.delete('price');
  if (sessionRange) query.set('sessions', sessionRange);
  else query.delete('sessions');
  if (sortOption && sortOption !== 'cheapest_per_session') query.set('sort', sortOption);
  else query.delete('sort');
  const search = query.toString();
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`,
  );
}

export function PublicPackagesView({
  client = browserPublicPackageCatalogClient,
}: {
  client?: PublicPackageCatalogClient;
}) {
  const session = useSessionContext()?.session;
  const inCustomerShell = isCustomerOnlySession(session);
  const audience = packageAudienceState(session);
  const [branches, setBranches] = useState<PublicPackageBranch[]>([]);
  const [items, setItems] = useState<PublicPackage[]>([]);
  const [branchId, setBranchId] = useState('');
  const [classTypeId, setClassTypeId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [priceRange, setPriceRange] = useState('');
  const [sessionRange, setSessionRange] = useState('');
  const [sortOption, setSortOption] = useState<PackageSortOption>('cheapest_per_session');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [continuationSlot, setContinuationSlot] = useState('');

  const loadBranch = async (selected: string) => {
    if (!selected) {
      setItems([]);
      setStatus('ready');
      return;
    }
    setStatus('loading');
    setMessage('');
    try {
      const result = await client.list(selected);
      setBranches(result.branches);
      setItems(result.items);
      setStatus('ready');
    } catch (error) {
      setItems([]);
      setStatus('error');
      setMessage(publicPackageFailure(error));
    }
  };

  const retryCatalog = async () => {
    if (branchId) {
      await loadBranch(branchId);
      return;
    }
    setStatus('loading');
    setMessage('');
    try {
      const result = await client.list();
      setBranches(result.branches);
      setItems([]);
      setStatus('ready');
    } catch (error) {
      setMessage(publicPackageFailure(error));
      setStatus('error');
    }
  };

  useEffect(() => {
    let active = true;
    void client
      .list()
      .then(async (result) => {
        if (!active) return;
        setBranches(result.branches);
        const query = new URLSearchParams(window.location.search);
        const requestedBranch = query.get('branch');
        const requestedClassType = query.get('classType');
        const requestedQ = query.get('q') ?? '';
        const requestedPrice = query.get('price') ?? '';
        const requestedSessions = query.get('sessions') ?? '';
        const requestedSort = query.get('sort') as PackageSortOption | null;
        setContinuationSlot(query.get('slot') ?? '');
        if (requestedClassType) setClassTypeId(requestedClassType);
        if (requestedQ) setSearchQuery(requestedQ);
        if (requestedPrice) setPriceRange(requestedPrice);
        if (requestedSessions) setSessionRange(requestedSessions);
        if (
          requestedSort &&
          PACKAGE_SORT_OPTIONS.some((opt) => opt.id === requestedSort)
        ) {
          setSortOption(requestedSort);
        }
        const storedBranch =
          typeof window !== 'undefined' ? window.sessionStorage.getItem('dd_active_branch') : null;
        const initialBranch =
          requestedBranch && result.branches.some(({ id }) => id === requestedBranch)
            ? requestedBranch
            : result.branches.find(({ id }) => id === session?.preferredBranch?.id)?.id ||
              result.branches.find(({ id }) => id === storedBranch)?.id;
        if (initialBranch) {
          setBranchId(initialBranch);
          try {
            const selected = await client.list(initialBranch);
            if (!active) return;
            setBranches(selected.branches);
            setItems(selected.items);
            setStatus('ready');
          } catch (innerError) {
            if (!active) return;
            setMessage(publicPackageFailure(innerError));
            setStatus('error');
          }
        } else {
          setStatus('ready');
        }
      })
      .catch((error) => {
        if (!active) return;
        setMessage(publicPackageFailure(error));
        setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [client, session?.preferredBranch?.id]);

  const selectBranch = async (selected: string) => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem('dd_active_branch', selected);
    }
    setBranchId(selected);
    setClassTypeId('');
    setSearchQuery('');
    setPriceRange('');
    setSessionRange('');
    syncCatalogQuery(selected, '', '', '', '', sortOption);
    await loadBranch(selected);
  };

  const classTypes = useMemo(
    () => [
      ...new Map(
        items
          .filter((item) => item.classType && item.classType.id)
          .map((item) => [item.classType.id, item.classType]),
      ).values(),
    ],
    [items],
  );

  // Active items: filter out expired promos
  const activeItems = useMemo(() => filterActivePackages(items), [items]);

  const visible = useMemo(() => {
    const filtered = activeItems.filter((item) => {
      // 1. Tipe Kelas
      if (classTypeId && item.classType?.id !== classTypeId) {
        return false;
      }

      // 2. Pencarian Nama Paket / Deskripsi / Tipe Kelas
      if (searchQuery.trim()) {
        const queryLower = searchQuery.toLowerCase().trim();
        const nameMatch = item.name.toLowerCase().includes(queryLower);
        const descMatch = (item.description ?? '').toLowerCase().includes(queryLower);
        const classTypeMatch = (item.classType?.name ?? '').toLowerCase().includes(queryLower);
        if (!nameMatch && !descMatch && !classTypeMatch) {
          return false;
        }
      }

      // 3. Rentang Harga
      if (priceRange) {
        const range = PRICE_RANGES.find((r) => r.id === priceRange);
        if (range) {
          const effectivePrice = item.effectivePriceRp ?? item.priceRp;
          if (effectivePrice < range.min || effectivePrice > range.max) {
            return false;
          }
        }
      }

      // 4. Jumlah Sesi
      if (sessionRange) {
        const range = SESSION_RANGES.find((r) => r.id === sessionRange);
        if (range) {
          if (item.sessionCount < range.min || item.sessionCount > range.max) {
            return false;
          }
        }
      }

      return true;
    });

    return sortPackages(filtered, sortOption);
  }, [activeItems, classTypeId, searchQuery, priceRange, sessionRange, sortOption]);

  const hasActiveFilters = Boolean(classTypeId || searchQuery || priceRange || sessionRange);

  const resetAllFilters = () => {
    setClassTypeId('');
    setSearchQuery('');
    setPriceRange('');
    setSessionRange('');
    syncCatalogQuery(branchId, '', '', '', '', sortOption);
  };

  const cheapestPackageId = useMemo(() => findCheapestPackageId(visible), [visible]);
  const ctaLabel = packageCtaLabel(session ?? null);
  const showCatalogState =
    status !== 'ready' || !branchId || (branchId.length > 0 && visible.length === 0);

  const { introductory, routine } = useMemo(() => groupPackages(visible), [visible]);
  const currentBranch = branches.find((b) => b.id === branchId);

  return (
    <div className="min-w-0 overflow-x-clip bg-dd-surface text-dd-ink min-h-screen">
      <a className="skip-link" href="#packages-main">
        Langsung ke paket
      </a>
      {!inCustomerShell && <PublicHeader variant="editorial" />}

      <main id="packages-main" className="mx-auto max-w-4xl px-4 py-4 sm:px-6 sm:py-6">
        {/* Header Ringkas (Spesifikasi 5.6 Poin 1) */}
        <div className="flex h-14 min-h-[56px] items-center justify-between gap-3 border-b border-dd-line/60 pb-3">
          <div className="flex items-center gap-3">
            <Link
              href={inCustomerShell ? '/account' : '/'}
              className="inline-flex size-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-dd-md border border-dd-border-interactive bg-white text-dd-forest transition hover:bg-dd-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dd-forest"
              aria-label={inCustomerShell ? 'Kembali ke Beranda' : 'Kembali ke situs utama'}
            >
              <ChevronLeft className="size-5" aria-hidden="true" />
            </Link>
            <h1 className="text-xl font-bold tracking-tight text-dd-ink sm:text-2xl">
              Pilih paket
            </h1>
          </div>
          {currentBranch && (
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-dd-forest/20 bg-dd-forest-soft px-3 py-1 text-xs font-semibold text-dd-forest">
              <MapPin className="size-3.5" aria-hidden="true" />
              <span>{currentBranch.name.replace(/^Daily Dose\s+/i, '')}</span>
            </span>
          )}
        </div>

        {/* Baris Pemilih Studio Ringkas (Spesifikasi 5.6 Poin 2) */}
        <section className="mt-4" aria-labelledby="studio-selection-heading">
          <span
            id="studio-selection-heading"
            className="block text-[13px] font-bold text-dd-forest mb-2"
          >
            Pilih Studio
          </span>

          {status === 'loading' && !branches.length ? (
            <div className="flex gap-2" role="status" aria-label="Memuat studio">
              {[0, 1].map((item) => (
                <div
                  className="h-11 w-36 animate-pulse rounded-full border border-dd-line/80 bg-white"
                  key={item}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {branches.map((item) => {
                const selected = item.id === branchId;
                return (
                  <button
                    type="button"
                    className={`inline-flex min-h-[44px] items-center gap-2 rounded-full px-4 py-2 text-xs sm:text-sm font-semibold transition cursor-pointer ${
                      selected
                        ? 'bg-dd-forest text-white shadow-xs'
                        : 'border border-dd-line/80 bg-white text-dd-ink hover:border-dd-forest/40 hover:bg-dd-surface-muted'
                    }`}
                    aria-pressed={selected}
                    key={item.id}
                    onClick={() => void selectBranch(item.id)}
                  >
                    <MapPin
                      className={`size-3.5 shrink-0 ${selected ? 'text-white' : 'text-dd-forest'}`}
                      aria-hidden="true"
                    />
                    <span>{item.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Baris Tab Tipe Kelas & Pengurutan (Spesifikasi 5.6 Poin 2 & 3) */}
        {branchId && (
          <section className="mt-5 space-y-3 rounded-dd-md border border-dd-line/70 bg-white p-3.5 sm:p-4" aria-label="Filter dan pengurutan paket">
            {/* Baris Tab Tipe Kelas */}
            <div>
              <span className="block text-[13px] font-bold text-dd-forest mb-2">
                Tipe Kelas
              </span>
              <div
                className="flex flex-wrap items-center gap-1.5"
                role="tablist"
                aria-label="Filter tipe kelas"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={!classTypeId}
                  onClick={() => {
                    setClassTypeId('');
                    syncCatalogQuery(branchId, '', searchQuery, priceRange, sessionRange, sortOption);
                  }}
                  className={`inline-flex min-h-[44px] items-center rounded-dd-sm px-3.5 py-1.5 text-xs font-bold transition cursor-pointer ${
                    !classTypeId
                      ? 'bg-dd-forest text-white shadow-xs'
                      : 'bg-dd-surface-muted text-dd-muted hover:text-dd-ink hover:bg-dd-surface-muted/80'
                  }`}
                >
                  Semua
                </button>
                {classTypes.map((type) => {
                  const isActive = classTypeId === type.id;
                  return (
                    <button
                      key={type.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => {
                        setClassTypeId(type.id);
                        syncCatalogQuery(
                          branchId,
                          type.id,
                          searchQuery,
                          priceRange,
                          sessionRange,
                          sortOption,
                        );
                      }}
                      className={`inline-flex min-h-[44px] items-center rounded-dd-sm px-3.5 py-1.5 text-xs font-bold transition cursor-pointer ${
                        isActive
                          ? 'bg-dd-forest text-white shadow-xs'
                          : 'bg-dd-surface-muted text-dd-muted hover:text-dd-ink hover:bg-dd-surface-muted/80'
                      }`}
                    >
                      {type.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Baris Pengurutan & Pencarian */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-dd-line/50 pt-3">
              {/* Opsi Urutkan */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-dd-muted">Urutkan:</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {PACKAGE_SORT_OPTIONS.map((opt) => {
                    const isSelected = sortOption === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => {
                          setSortOption(opt.id);
                          syncCatalogQuery(
                            branchId,
                            classTypeId,
                            searchQuery,
                            priceRange,
                            sessionRange,
                            opt.id,
                          );
                        }}
                        className={`inline-flex min-h-[44px] items-center rounded-dd-sm px-3 py-1 text-xs font-semibold transition cursor-pointer ${
                          isSelected
                            ? 'border border-dd-forest bg-[#e8f0ec] text-dd-forest font-bold'
                            : 'border border-dd-line/60 bg-white text-dd-muted hover:text-dd-ink hover:border-dd-forest/30'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Pencarian Teks */}
              <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
                <label htmlFor="package-search-input" className="sr-only">
                  Nama paket
                </label>
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-dd-muted"
                  aria-hidden="true"
                />
                <input
                  id="package-search-input"
                  type="search"
                  value={searchQuery}
                  disabled={!branchId}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSearchQuery(val);
                    syncCatalogQuery(
                      branchId,
                      classTypeId,
                      val,
                      priceRange,
                      sessionRange,
                      sortOption,
                    );
                  }}
                  placeholder="Cari nama paket…"
                  className="min-h-[44px] w-full rounded-dd-sm border border-dd-border-interactive bg-white pl-8 pr-7 text-xs text-dd-ink placeholder:text-dd-muted hover:border-dd-forest/40 focus:border-dd-forest focus:outline-hidden focus:ring-1 focus:ring-dd-forest/20 disabled:cursor-not-allowed disabled:bg-dd-surface-muted"
                />
                {searchQuery && (
                  <button
                    type="button"
                    aria-label="Hapus kata kunci pencarian"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-dd-muted hover:text-dd-ink cursor-pointer"
                    onClick={() => {
                      setSearchQuery('');
                      syncCatalogQuery(
                        branchId,
                        classTypeId,
                        '',
                        priceRange,
                        sessionRange,
                        sortOption,
                      );
                    }}
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>

            {/* Filter Lanjutan Dropdown (Accessible Comboboxes) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-dd-line/50 pt-3">
              <div className="min-w-0">
                <SearchSelect
                  variant="editorial"
                  label="Tipe kelas"
                  compact
                  value={classTypeId}
                  disabled={!branchId}
                  placeholder="Semua tipe kelas"
                  options={classTypes.map((item) => ({ id: item.id, label: item.name }))}
                  onChange={(selected) => {
                    setClassTypeId(selected);
                    syncCatalogQuery(
                      branchId,
                      selected,
                      searchQuery,
                      priceRange,
                      sessionRange,
                      sortOption,
                    );
                  }}
                />
              </div>

              <div className="min-w-0">
                <SearchSelect
                  variant="editorial"
                  label="Rentang harga"
                  compact
                  value={priceRange}
                  disabled={!branchId}
                  placeholder="Semua harga"
                  options={PRICE_RANGES.map((item) => ({ id: item.id, label: item.label }))}
                  onChange={(selected) => {
                    setPriceRange(selected);
                    syncCatalogQuery(
                      branchId,
                      classTypeId,
                      searchQuery,
                      selected,
                      sessionRange,
                      sortOption,
                    );
                  }}
                />
              </div>

              <div className="min-w-0">
                <SearchSelect
                  variant="editorial"
                  label="Jumlah sesi"
                  compact
                  value={sessionRange}
                  disabled={!branchId}
                  placeholder="Semua sesi"
                  options={SESSION_RANGES.map((item) => ({ id: item.id, label: item.label }))}
                  onChange={(selected) => {
                    setSessionRange(selected);
                    syncCatalogQuery(
                      branchId,
                      classTypeId,
                      searchQuery,
                      priceRange,
                      selected,
                      sortOption,
                    );
                  }}
                />
              </div>
            </div>

            {/* Status Filter & Reset */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-dd-muted">
              <span>
                Menampilkan <strong className="text-dd-ink">{visible.length}</strong> dari{' '}
                <strong className="text-dd-ink">{items.length}</strong> paket tersedia
              </span>
              {hasActiveFilters && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs font-bold text-dd-forest hover:underline cursor-pointer"
                  onClick={resetAllFilters}
                >
                  <RotateCcw className="size-3" aria-hidden="true" />
                  Reset filter
                </button>
              )}
            </div>
          </section>
        )}

        {/* State Panel: Loading, Error, Belum Pilih Studio, Kosong */}
        {showCatalogState && (
          <div className="mt-4" aria-live="polite">
            {status === 'loading' && branchId && (
              <div className="grid gap-4 md:grid-cols-2" role="status">
                {[0, 1].map((item) => (
                  <div
                    className="h-64 animate-pulse rounded-dd-md border border-dd-line/80 bg-white"
                    key={item}
                  />
                ))}
              </div>
            )}
            {status === 'error' && (
              <PublicStatePanel title="Paket belum dapat dimuat" tone="error" role="alert">
                <p>{message}</p>
                <button
                  type="button"
                  className="mt-4 min-h-11 rounded-dd-md border border-red-900/30 bg-white px-5 font-bold text-sm text-red-900 transition hover:bg-red-50 cursor-pointer"
                  onClick={() => void retryCatalog()}
                >
                  Coba lagi
                </button>
              </PublicStatePanel>
            )}
            {status === 'ready' && !branchId && (
              <PublicStatePanel title="Pilih studio untuk melihat paket">
                Harga, tipe kelas, dan masa berlaku paket akan muncul setelah Anda menentukan
                lokasi latihan.
              </PublicStatePanel>
            )}
            {status === 'ready' && branchId && visible.length === 0 && (
              <PublicStatePanel
                title={items.length > 0 ? 'Tidak ada paket yang sesuai' : 'Belum ada paket aktif'}
              >
                <p>
                  {items.length > 0
                    ? 'Coba ubah kata kunci pencarian, longgarkan filter harga atau jumlah sesi untuk menemukan paket yang sesuai.'
                    : 'Paket untuk studio ini belum tersedia. Silakan pilih studio Daily Dose lainnya untuk melihat pilihan paket yang tersedia.'}
                </p>
                {items.length > 0 && hasActiveFilters && (
                  <button
                    type="button"
                    className="mt-4 min-h-11 rounded-dd-md border border-dd-border-interactive bg-white px-5 font-bold text-sm text-dd-forest transition hover:bg-dd-surface-muted cursor-pointer"
                    onClick={resetAllFilters}
                  >
                    Reset semua filter
                  </button>
                )}
                {items.length === 0 && branches.filter((b) => b.id !== branchId).length > 0 && (
                  <div className="mt-5 flex flex-wrap justify-center gap-2.5">
                    {branches
                      .filter((b) => b.id !== branchId)
                      .map((otherBranch) => (
                        <button
                          key={otherBranch.id}
                          type="button"
                          className="inline-flex min-h-11 items-center gap-2 rounded-dd-md border border-dd-border-interactive bg-white px-4 text-sm font-semibold text-dd-forest transition hover:bg-dd-surface-muted cursor-pointer"
                          onClick={() => void selectBranch(otherBranch.id)}
                        >
                          <MapPin className="size-4" />
                          <span>Lihat paket {otherBranch.name}</span>
                        </button>
                      ))}
                  </div>
                )}
              </PublicStatePanel>
            )}
          </div>
        )}

        {/* Daftar Paket Terkelompok (Spesifikasi 5.6 Poin 4 & 5) */}
        {status === 'ready' && visible.length > 0 && (
          <div className="mt-6 space-y-8" aria-label="Daftar paket aktif">
            {/* Grup 1: COBA DULU, 1 SAMPAI 3 SESI */}
            {introductory.length > 0 && (
              <section aria-labelledby="heading-coba-dulu">
                <div className="flex items-center gap-2 border-b border-dd-line/60 pb-2 mb-4">
                  <h2
                    id="heading-coba-dulu"
                    className="text-[13px] font-bold text-dd-forest"
                  >
                    COBA DULU, 1 SAMPAI 3 SESI
                  </h2>
                  <span className="text-xs text-dd-muted font-medium">
                    ({introductory.length} paket)
                  </span>
                </div>
                <div className="grid gap-4 sm:gap-5 md:grid-cols-2">
                  {introductory.map((item) => (
                    <PackageCard
                      key={item.id}
                      item={item}
                      isCheapest={item.id === cheapestPackageId}
                      ctaLabel={ctaLabel}
                      audience={audience}
                      classTypeId={classTypeId}
                      continuationSlot={continuationSlot}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Grup 2: PAKET RUTIN, 5 SESI KE ATAS */}
            {routine.length > 0 && (
              <section aria-labelledby="heading-paket-rutin">
                <div className="flex items-center gap-2 border-b border-dd-line/60 pb-2 mb-4">
                  <h2
                    id="heading-paket-rutin"
                    className="text-[13px] font-bold text-dd-forest"
                  >
                    PAKET RUTIN, 5 SESI KE ATAS
                  </h2>
                  <span className="text-xs text-dd-muted font-medium">
                    ({routine.length} paket)
                  </span>
                </div>
                <div className="grid gap-4 sm:gap-5 md:grid-cols-2">
                  {routine.map((item) => (
                    <PackageCard
                      key={item.id}
                      item={item}
                      isCheapest={item.id === cheapestPackageId}
                      ctaLabel={ctaLabel}
                      audience={audience}
                      classTypeId={classTypeId}
                      continuationSlot={continuationSlot}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Baris Penutup (Spesifikasi 5.6 Poin 6) */}
            <footer className="mt-8 rounded-dd-md border border-dd-line/70 bg-white p-4 text-center text-xs text-dd-muted">
              <p>
                Menampilkan <strong className="font-semibold text-dd-ink">{visible.length}</strong>{' '}
                paket aktif untuk{' '}
                <strong className="font-semibold text-dd-ink">
                  {currentBranch?.name ?? 'Studio'}
                </strong>
                . Paket promo yang sudah lewat periodenya tidak ditampilkan.
              </p>
            </footer>
          </div>
        )}
      </main>

      {!inCustomerShell && <PublicFooter variant="editorial" />}
    </div>
  );
}

function PackageCard({
  item,
  isCheapest,
  ctaLabel,
  audience,
  classTypeId,
  continuationSlot,
}: {
  item: PublicPackage;
  isCheapest: boolean;
  ctaLabel: string;
  audience: PackageAudienceState;
  classTypeId: string;
  continuationSlot: string;
}) {
  const purchase = `/checkout?package=${item.id}&branch=${item.branchId}${classTypeId ? `&classType=${encodeURIComponent(classTypeId)}` : ''}${continuationSlot ? `&slot=${encodeURIComponent(continuationSlot)}` : ''}`;
  const href = packageCtaHref(audience, purchase);

  return (
    <article
      className={`relative flex flex-col justify-between rounded-dd-md bg-white p-5 sm:p-6 transition shadow-xs ${
        isCheapest
          ? 'border-2 border-dd-forest ring-1 ring-dd-forest/20'
          : 'border border-dd-line/80'
      }`}
      key={item.id}
    >
      <div>
        {/* Badges Bar: Class Type & TERMURAH PER SESI */}
        <div className="flex min-h-7 flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center rounded-dd-sm border border-dd-forest/20 bg-[#e8f0ec] px-2.5 py-0.5 text-[13px] font-bold text-dd-forest">
            {item.classType.name}
          </span>
          {isCheapest && (
            <span className="inline-flex items-center gap-1 rounded-full bg-dd-forest px-2.5 py-0.5 text-[13px] font-bold text-white">
              TERMURAH PER SESI
            </span>
          )}
        </div>

        {/* Nama Paket (Break-words, tidak terpotong di tengah kata) */}
        <h3 className="mt-3 text-xl sm:text-2xl font-bold tracking-tight text-dd-ink break-words">
          {item.name}
        </h3>

        {/* Harga & Nilai per Sesi */}
        <div className="mt-3">
          <PackagePrice
            priceRp={item.priceRp}
            effectivePriceRp={item.effectivePriceRp ?? item.priceRp}
            promotion={item.promotion}
            sessionCount={item.sessionCount}
          />
        </div>

        {/* Fakta Esensial: Sesi & Masa Aktif */}
        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-dd-line/60 pt-3 text-xs text-dd-muted">
          {item.perpanjanganMasaAktif ? (
            <>
              <div>
                <dt className="font-medium text-dd-muted">Jenis paket</dt>
                <dd className="mt-0.5 text-sm sm:text-base font-bold text-dd-ink">Perpanjangan masa aktif</dd>
              </div>
              <div>
                <dt className="font-medium text-dd-muted">Tambahan masa aktif</dt>
                <dd className="mt-0.5 text-sm sm:text-base font-bold text-dd-ink">
                  {item.extensionDays ?? 30} hari
                </dd>
              </div>
            </>
          ) : (
            <>
              <div>
                <dt className="font-medium text-dd-muted">Jumlah sesi</dt>
                <dd className="mt-0.5 text-sm sm:text-base font-bold text-dd-ink">
                  {item.sessionCount} sesi
                </dd>
              </div>
              <div>
                <dt className="font-medium text-dd-muted">Masa berlaku</dt>
                <dd className="mt-0.5 text-sm sm:text-base font-bold text-dd-ink">
                  {item.durationDays} hari
                </dd>
              </div>
            </>
          )}
        </dl>

        <p className="mt-3 flex items-center gap-1.5 text-xs text-dd-muted">
          <CalendarDays className="size-3.5 text-dd-forest shrink-0" aria-hidden="true" />
          <span>
            {item.effectiveUntil
              ? `Tersedia sampai ${new Intl.DateTimeFormat('id-ID', {
                  dateStyle: 'medium',
                }).format(new Date(item.effectiveUntil))}`
              : 'Tersedia untuk pembelian'}
          </span>
        </p>
      </div>

      <div className="mt-5 pt-3 border-t border-dd-line/50">
        {audience === 'STAFF' && (
          <p className="mb-2 rounded-dd-sm bg-dd-surface-muted px-2.5 py-1.5 text-xs text-dd-muted">
            Pembelian paket menggunakan akun customer.
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Link
            href={`/packages/${item.id}`}
            className="inline-flex h-11 min-h-[44px] w-full items-center justify-center rounded-dd-md border border-dd-border-interactive bg-white px-4 text-xs sm:text-sm font-semibold text-dd-forest shadow-2xs hover:bg-dd-surface-muted transition"
          >
            Lihat detail
          </Link>
          <Link
            href={href}
            className="inline-flex h-11 min-h-[44px] w-full items-center justify-center rounded-dd-md bg-dd-forest px-4 text-xs sm:text-sm font-bold text-white shadow-xs hover:bg-dd-forest-hover transition"
          >
            {ctaLabel === 'Pilih paket' ? 'Beli paket ini' : ctaLabel}
          </Link>
        </div>
      </div>
    </article>
  );
}
