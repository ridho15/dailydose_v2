'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Eye, RefreshCw, Search } from 'lucide-react';
import {
  assistedPaymentMethodLabels,
  browserPurchaseReviewClient,
  purchaseFailure,
  type PaymentReviewFilters,
  type PurchaseReviewClient,
  type ReviewPurchase,
  type ReviewSummary,
} from '@/api-clients/purchase-client';
import { Skeleton } from '../ui';
import { AdminPageHeader } from '../components/admin/admin-page-header';
import { useTrackedRouter } from '../components/app-loading';
import { Badge, DataTable, FilterBar, Pagination, Panel } from '../components/admin/admin-ui';
import { Button, ButtonLink } from '../components/actions';
import { AssistedSaleDrawer } from './assisted-sale-drawer';
import { AlertBanner, PreviewModal, useOptionalAppFeedback } from '../components/app-feedback';
import { useSessionContext } from '../session-context';
import { DateInput, SearchInput, SelectInput } from '../components/forms';
import { formatRupiah } from '../lib/formatters';
import { statusLabel } from '../lib/status-labels';
import { ADMIN_PAGE_SIZE, pageOffset } from '../lib/pagination';

/** Opsi filter antrean; status lain (mis. PAID) ditampilkan lewat `statusLabel`. */
const statusLabels: Record<string, string> = {
  AWAITING_PAYMENT: 'Menunggu pembayaran',
  PENDING: 'Menunggu pemeriksaan',
  ACTION_REQUIRED: 'Perlu perbaikan',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
  EXPIRED: 'Kedaluwarsa',
};
type Filters = PaymentReviewFilters & { status?: string };

const emptySummary: ReviewSummary = {
  pending: 0,
  actionRequired: 0,
  approved: 0,
  rejected: 0,
  expired: 0,
  totalAmountRp: 0,
  agingOver24Hours: 0,
};

const readFilters = (): Filters => {
  if (typeof window === 'undefined') return { status: 'PENDING', limit: ADMIN_PAGE_SIZE, page: 1 };
  const query = new URLSearchParams(window.location.search);
  const date = (name: string) => {
    const value = query.get(name);
    return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : undefined;
  };
  return {
    branchId: query.get('branch') || undefined,
    status: query.get('status') || 'PENDING',
    q: query.get('q') || undefined,
    from: date('from'),
    until: date('until'),
    cursor: query.get('cursor') || undefined,
    purchaseId: query.get('purchaseId') || undefined,
    page: Number(query.get('page')) > 0 ? Number(query.get('page')) : 1,
    limit: ADMIN_PAGE_SIZE,
  };
};

const dateInput = (value?: Date) =>
  value && Number.isFinite(value.getTime())
    ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
    : '';

const safeDate = (val?: Date | string | null): Date | null => {
  if (!val) return null;
  const d = val instanceof Date ? val : new Date(val);
  return Number.isFinite(d.getTime()) ? d : null;
};

const safeFormatDateTime = (val?: Date | string | null, fallback = '-'): string => {
  const d = safeDate(val);
  return d ? d.toLocaleString('id-ID') : fallback;
};

export const paymentStatusTone = (status: string): 'neutral' | 'success' | 'warning' | 'danger' =>
  status === 'APPROVED'
    ? 'success'
    : status === 'REJECTED' || status === 'EXPIRED'
      ? 'danger'
      : status === 'PENDING' || status === 'ACTION_REQUIRED'
        ? 'warning'
        : 'neutral';

export type PaymentRowState = 'danger' | 'success' | 'warning' | 'neutral' | 'default';

export function paymentRowState(item: ReviewPurchase, now = new Date()): PaymentRowState {
  const activation = item.activationSummary;
  const expiryTime = activation?.expiryAt ? new Date(activation.expiryAt).getTime() : 0;
  if (
    item.status === 'REJECTED' ||
    item.status === 'EXPIRED' ||
    activation?.status === 'EXPIRED' ||
    Boolean(activation && expiryTime > 0 && expiryTime <= now.getTime())
  )
    return 'danger';
  if (item.status === 'APPROVED' && activation?.status === 'ACTIVE') return 'success';
  if (item.status === 'PENDING' || item.status === 'ACTION_REQUIRED') return 'warning';
  if (item.status === 'AWAITING_PAYMENT' || !activation || activation.status === 'INACTIVE')
    return 'neutral';
  return 'default';
}

const rowClasses: Record<PaymentRowState, string> = {
  danger: 'border-l-4 border-l-dd-danger bg-dd-danger-soft/70',
  success: 'border-l-4 border-l-dd-forest bg-dd-success-soft/60',
  warning: 'border-l-4 border-l-dd-brass bg-dd-warning-soft/70',
  neutral: 'border-l-4 border-l-dd-muted/40 bg-dd-surface-muted/85',
  default: 'border-l-4 border-l-transparent bg-white',
};

const sessionSummary = (item: ReviewPurchase) => {
  const activation = item.activationSummary;
  if (!activation) return <span className="text-xs text-dd-muted">Paket belum diaktifkan</span>;
  const expiryDate = activation.expiryAt ? new Date(activation.expiryAt) : null;
  const expiryFormatted =
    expiryDate && Number.isFinite(expiryDate.getTime())
      ? expiryDate.toLocaleDateString('id-ID')
      : 'Tanggal tidak valid';
  return (
    <div className="text-xs leading-5">
      <strong className="block text-sm text-dd-ink">
        {activation.available} tersedia
        {activation.available === 0 && activation.status === 'ACTIVE' ? ' · sesi telah habis' : ''}
      </strong>
      <span className="text-dd-muted">
        {activation.reserved} dipesan · {activation.used} terpakai
      </span>
      <span className="block text-dd-muted">
        {activation.status === 'EXPIRED'
          ? '0 sesi dapat digunakan'
          : `Berlaku hingga ${expiryFormatted}`}
      </span>
    </div>
  );
};

const ageLabel = (submittedAt: Date | string) => {
  const time = new Date(submittedAt).getTime();
  const hours = Math.max(
    0,
    Math.floor((Date.now() - (Number.isNaN(time) ? Date.now() : time)) / 3_600_000),
  );
  if (hours < 1) return 'Kurang dari 1 jam';
  if (hours < 24) return `${hours} jam`;
  return `${Math.floor(hours / 24)} hari`;
};

const queueUrlWithoutLegacyDetail = () => {
  if (typeof window === 'undefined') return '/workspace/payments';
  const query = new URLSearchParams(window.location.search);
  query.delete('purchaseId');
  return `/workspace/payments${query.size ? `?${query}` : ''}`;
};

const detailHref = (id: string) =>
  `/workspace/payments/${encodeURIComponent(id)}?returnTo=${encodeURIComponent(queueUrlWithoutLegacyDetail())}`;

export function PurchaseReviewView({
  client = browserPurchaseReviewClient,
  branchOverride,
}: {
  client?: PurchaseReviewClient;
  branchOverride?: { id: string; name: string; timezone: string; code?: string };
}) {
  const router = useTrackedRouter();
  const sessionContext = useSessionContext();
  const feedback = useOptionalAppFeedback();
  const testAuthority = Boolean(branchOverride);
  const sessionReady = testAuthority || sessionContext?.status === 'authenticated';
  const canReview =
    testAuthority || Boolean(sessionContext?.hasCapability('payment:review', 'purchase:review'));
  const canDecide =
    testAuthority || Boolean(sessionContext?.hasCapability('payment:decide', 'purchase:decide'));
  const canRecord =
    !testAuthority && Boolean(sessionContext?.hasCapability('purchase:record'));
  const currentUserId = sessionContext?.session?.id;
  const activeBranch = branchOverride ?? sessionContext?.activeBranch ?? null;
  const [saleOpen, setSaleOpen] = useState(false);
  const saleBranches = (sessionContext?.session?.branches ?? []).map((item) => ({
    id: item.id,
    name: item.name,
  }));
  const availableBranches = useMemo(() => {
    if (branchOverride) {
      return [{ id: branchOverride.id, name: branchOverride.name }];
    }
    return saleBranches;
  }, [branchOverride, saleBranches]);
  const [filters, setFilters] = useState<Filters>(readFilters);
  const [search, setSearch] = useState(() => readFilters().q ?? '');
  const [items, setItems] = useState<ReviewPurchase[]>([]);
  const [summary, setSummary] = useState<ReviewSummary>(emptySummary);
  const [totalCount, setTotalCount] = useState<number | undefined>(undefined);
  const [totalPages, setTotalPages] = useState(1);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<ReviewPurchase | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewType, setPreviewType] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [modalVerified, setModalVerified] = useState(false);
  // Pembayaran yang buktinya sudah dibuka petugas di sesi ini; persetujuan dari daftar mewajibkannya.
  const [viewedProofIds, setViewedProofIds] = useState<ReadonlySet<string>>(() => new Set());
  const requestRef = useRef(0);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);

  const changeFilters = useCallback(
    (patch: Partial<Filters>, replace = false) => {
      if (patch.cursor === undefined && patch.page === undefined) {
        setCursorHistory([]);
      }
      setFilters((current) => {
        const next = { ...current, ...patch, purchaseId: undefined };
        return next;
      });

      if (typeof window !== 'undefined') {
        const query = new URLSearchParams();
        const current = readFilters();
        const next = { ...current, ...patch, purchaseId: undefined };
        if (next.branchId && next.branchId !== 'ALL') query.set('branch', next.branchId);
        if (next.status) query.set('status', next.status);
        if (next.q) query.set('q', next.q);
        if (next.from) query.set('from', dateInput(next.from));
        if (next.until) query.set('until', dateInput(next.until));
        if (next.cursor) query.set('cursor', next.cursor);
        if (next.page && next.page > 1) query.set('page', String(next.page));
        const url = `/workspace/payments${query.size ? `?${query.toString()}` : ''}`;
        router.replace(url, { scroll: false });
      }
    },
    [router],
  );

  const onNext = () => {
    if (totalPages > 1 && (filters.page ?? 1) < totalPages) {
      changeFilters({ page: (filters.page ?? 1) + 1, cursor: undefined }, true);
      return;
    }
    if (!nextCursor) return;
    setCursorHistory((current) => [...current, filters.cursor ?? '']);
    changeFilters({ cursor: nextCursor, page: (filters.page ?? 1) + 1 }, true);
  };

  const onPrevious = () => {
    if (filters.page && filters.page > 1) {
      const previous = cursorHistory.at(-1) ?? '';
      setCursorHistory((current) => current.slice(0, -1));
      changeFilters({ page: filters.page - 1, cursor: previous || undefined }, true);
      return;
    }
    const previous = cursorHistory.at(-1) ?? '';
    setCursorHistory((current) => current.slice(0, -1));
    changeFilters({ cursor: previous || undefined }, true);
  };

  useEffect(() => {
    const legacyPurchaseId = readFilters().purchaseId;
    if (legacyPurchaseId) router.replace(detailHref(legacyPurchaseId));
  }, [router]);

  useEffect(() => {
    const onPopState = () => {
      const next = readFilters();
      setFilters(next);
      setSearch(next.q ?? '');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if ((filters.q ?? '') !== search.trim())
        changeFilters({ q: search.trim() || undefined, cursor: undefined }, true);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [changeFilters, filters.q, search]);

  const effectiveBranchId = useMemo(() => {
    if (filters.branchId === 'ALL') return undefined;
    if (filters.branchId) return filters.branchId;
    if (branchOverride?.id) return branchOverride.id;
    if (sessionContext?.hasCapability('branch:all')) return undefined;
    return activeBranch?.id;
  }, [filters.branchId, branchOverride?.id, sessionContext, activeBranch?.id]);

  const requestFilters = useMemo<PaymentReviewFilters>(
    () => ({
      ...filters,
      purchaseId: undefined,
      branchId: effectiveBranchId,
      status: filters.status === 'ALL' ? undefined : filters.status,
      limit: ADMIN_PAGE_SIZE,
    }),
    [effectiveBranchId, filters],
  );

  const load = useCallback(async () => {
    if (!sessionReady || !canReview) return;
    const requestId = ++requestRef.current;
    setLoading(true);
    setError('');
    try {
      const result = await client.list(requestFilters);
      if (requestId !== requestRef.current) return;
      setItems(result.items);
      setSummary(result.summary);
      setTotalCount(result.total ?? result.page?.total);
      setTotalPages(result.totalPages ?? result.page?.totalPages ?? 1);
      setGeneratedAt(result.generatedAt);
      setNextCursor(result.page.nextCursor ?? null);
    } catch (cause) {
      if (requestId === requestRef.current) setError(purchaseFailure(cause));
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [canReview, client, requestFilters, sessionReady]);

  useEffect(() => void load(), [load]);

  const closePreview = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl('');
    setPreviewType('');
    setPreviewItem(null);
    setModalVerified(false);
  }, [previewUrl]);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const openPreview = async (item: ReviewPurchase) => {
    if (!item.paymentProof || item.paymentProof.scanStatus !== 'CLEAN') return;
    setPreviewItem(item);
    setModalVerified(false);
    setPreviewLoading(true);
    setError('');
    try {
      const blob = await client.loadProof(item.paymentProof.id);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewType(blob.type || item.paymentProof.mimeType);
      setPreviewUrl(URL.createObjectURL(blob));
      setViewedProofIds((current) => new Set(current).add(item.id));
    } catch (cause) {
      setError(purchaseFailure(cause));
    } finally {
      setPreviewLoading(false);
    }
  };

  const isPendingDecision = (status: string) =>
    status === 'PENDING' || status === 'WAITING_VERIFICATION';

  const approve = async (item: ReviewPurchase) => {
    if (!canDecideItem(item) || !isPendingDecision(item.status)) return;
    const confirmed = feedback
      ? await feedback.confirm({
          tone: 'warning',
          title: 'Setujui pembayaran',
          message: `${item.customer.displayName} · ${item.branch.name} · ${item.packageNameSnapshot} · ${formatRupiah(item.payableAmountRpSnapshot ?? item.priceRpSnapshot)}. Paket pelanggan akan diaktifkan dan ledger pembelian dibuat. Versi ${item.version}.`,
          confirmLabel: 'Setujui dan aktifkan paket',
        })
      : testAuthority;
    if (!confirmed) return;
    setMutatingId(item.id);
    try {
      const latest = await client.detail(item.id).catch(() => null);
      const versionToUse = latest?.purchase?.version ?? item.version;
      const result = await client.approve(item.id, versionToUse, crypto.randomUUID());
      feedback?.showToast({
        tone: 'success',
        title: 'Pembayaran disetujui',
        message: `${result.customerPackage?.packageName ?? item.packageNameSnapshot} aktif dengan ${result.customerPackage?.available ?? 0} sesi.${result.ledgerEntry?.id ? ` Ledger ${result.ledgerEntry.id}.` : ''}`,
        correlationReference: result.purchase.auditReference ?? undefined,
      });
      await load();
    } catch (cause) {
      await load();
      setError(purchaseFailure(cause));
    } finally {
      setMutatingId(null);
    }
  };

  if (sessionContext?.status === 'unauthenticated' && !testAuthority)
    return (
      <AlertBanner
        tone="warning"
        title="Sesi telah berakhir"
        message="Masuk kembali sebelum membuka antrean pembayaran."
      />
    );
  if (!sessionReady) return <Skeleton label="Memuat sesi dan izin pembayaran" />;
  if (!canReview)
    return (
      <AlertBanner
        tone="danger"
        title="Akses antrean tidak tersedia"
        message="Role Anda tidak memiliki izin untuk memeriksa pembayaran."
      />
    );

  const totalAll =
    summary.total ??
    (summary.pending +
      summary.actionRequired +
      summary.approved +
      summary.rejected +
      summary.expired);

  const summaryCards = [
    ['ALL', 'Semua status', totalAll],
    ['PENDING', 'Menunggu', summary.pending],
    ['ACTION_REQUIRED', 'Perlu perbaikan', summary.actionRequired],
    ['APPROVED', 'Disetujui', summary.approved],
    ['REJECTED', 'Ditolak', summary.rejected],
    ['EXPIRED', 'Kedaluwarsa', summary.expired],
  ] as const;

  const currentTotal = (() => {
    switch (filters.status) {
      case 'PENDING':
        return summary.pending;
      case 'ACTION_REQUIRED':
        return summary.actionRequired;
      case 'APPROVED':
        return summary.approved;
      case 'REJECTED':
        return summary.rejected;
      case 'EXPIRED':
        return summary.expired;
      case 'ALL':
      default:
        return totalAll;
    }
  })();

  const isSuper = Boolean(
    sessionContext?.session?.roles?.some((r) =>
      r === 'SUPER_OWNER',
    ),
  );

  const isDirectCashOrCard = (item: ReviewPurchase) =>
    item.paymentMethod === 'CASH' || item.paymentMethod === 'CARD' || item.paymentMethod === 'MANUAL_STAFF';

  const isOwnRecord = (item: ReviewPurchase) =>
    !isSuper && !isDirectCashOrCard(item) && Boolean(item.recordedById) && item.recordedById === currentUserId;

  const canDecideItem = (item: ReviewPurchase) =>
    canDecide || (canRecord && isDirectCashOrCard(item));

  const actions = (item: ReviewPurchase, compact = false) => (
    <div
      className={`flex flex-wrap gap-2 ${compact ? 'justify-end' : ''}`}
      onClick={(event) => event.stopPropagation()}
    >
      <ButtonLink
        variant="secondary"
        size="sm"
        href={detailHref(item.id)}
        leadingIcon={<Eye className="size-4" />}
      >
        Periksa detail
      </ButtonLink>
      <Button
        variant="secondary"
        disabled={previewLoading || !item.paymentProof || item.paymentProof.scanStatus !== 'CLEAN'}
        onClick={() => void openPreview(item)}
      >
        Preview bukti
      </Button>
      {canDecideItem(item) && isPendingDecision(item.status) && isOwnRecord(item) && (
        <span className="self-center text-xs text-dd-muted">
          Dicatat oleh Anda — disetujui penyetuju lain.
        </span>
      )}
      {canDecideItem(item) && isPendingDecision(item.status) && !isOwnRecord(item) && (
        <Button
          size="sm"
          disabled={mutatingId === item.id || (Boolean(item.paymentProof) && !viewedProofIds.has(item.id))}
          title={
            item.paymentProof && !viewedProofIds.has(item.id)
              ? 'Buka "Preview bukti" terlebih dahulu sebelum menyetujui.'
              : undefined
          }
          onClick={() => void approve(item)}
        >
          <CheckCircle2 className="size-4" /> {mutatingId === item.id ? 'Memproses…' : 'Setujui'}
        </Button>
      )}
    </div>
  );

  return (
    <section className="space-y-5" aria-labelledby="payment-review-title">
      <AdminPageHeader
        title="Antrean Pembayaran"
        titleId="payment-review-title"
        description="Periksa bukti privat dan snapshot transaksi. Keputusan hanya dapat diambil oleh peran yang berwenang (Finance, Manager, dan Super Owner)."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-dd-muted">
              {generatedAt ? `Diperbarui ${safeFormatDateTime(generatedAt)}` : 'Belum dimuat'}
            </span>
            {canRecord && saleBranches.length > 0 && (
              <Button onClick={() => setSaleOpen(true)}>Catat penjualan</Button>
            )}
            <Button
              variant="secondary"
              disabled={loading}
              leadingIcon={
                <RefreshCw
                  className={`size-4 ${loading ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
              }
              onClick={() => void load()}
            >
              Segarkan
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {summaryCards.map(([value, label, count]) => {
          const active = (filters.status ?? 'PENDING') === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              onClick={() => changeFilters({ status: value, cursor: undefined, page: 1 })}
              className={`rounded-dd-lg border bg-white p-4 text-left transition hover:border-dd-forest ${active ? 'border-dd-forest ring-1 ring-dd-forest/20' : 'border-dd-line'}`}
            >
              <span className="block text-xs font-semibold text-dd-muted">{label}</span>
              <strong className="mt-2 block text-2xl text-dd-ink">
                {count.toLocaleString('id-ID')}
              </strong>
            </button>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="p-4">
          <span className="text-xs font-semibold text-dd-muted">Nilai dalam hasil filter</span>
          <strong className="mt-1 block text-xl text-dd-ink">
            {formatRupiah(summary.totalAmountRp)}
          </strong>
        </Panel>
        <Panel className="p-4">
          <span className="text-xs font-semibold text-dd-muted">Menunggu lebih dari 24 jam</span>
          <strong className="mt-1 block text-xl text-dd-ink">{summary.agingOver24Hours}</strong>
        </Panel>
      </div>

      <FilterBar>
        {availableBranches.length > 0 && (
          <SelectInput
            label="Cabang"
            value={filters.branchId ?? (sessionContext?.hasCapability('branch:all') ? 'ALL' : (activeBranch?.id ?? 'ALL'))}
            onChange={(event) =>
              changeFilters({
                branchId: event.target.value === 'ALL' ? 'ALL' : event.target.value,
                cursor: undefined,
                page: 1,
              })
            }
          >
            <option value="ALL">Semua Cabang</option>
            {availableBranches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </SelectInput>
        )}
        <SearchInput
          wrapperClassName="min-w-56 flex-1"
          label="Cari pelanggan atau transaksi"
          leadingIcon={<Search className="size-4" />}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Nama, telepon, atau ID transaksi"
        />
        <SelectInput
          label="Status"
          value={filters.status ?? 'PENDING'}
          onChange={(event) => changeFilters({ status: event.target.value, cursor: undefined })}
        >
          <option value="PENDING">Menunggu pemeriksaan</option>
          <option value="ALL">Semua status</option>
          {Object.entries(statusLabels)
            .filter(([value]) => value !== 'PENDING')
            .map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
        </SelectInput>
        <DateInput
          label="Dari"
          value={dateInput(filters.from)}
          onChange={(event) =>
            changeFilters({
              from: event.target.value ? new Date(`${event.target.value}T00:00:00`) : undefined,
              cursor: undefined,
            })
          }
        />
        <DateInput
          label="Sampai"
          value={dateInput(filters.until)}
          onChange={(event) =>
            changeFilters({
              until: event.target.value ? new Date(`${event.target.value}T23:59:59`) : undefined,
              cursor: undefined,
            })
          }
        />
        <Button
          variant="ghost"
          onClick={() => {
            setSearch('');
            changeFilters({
              branchId: undefined,
              status: 'PENDING',
              q: undefined,
              from: undefined,
              until: undefined,
              cursor: undefined,
            });
          }}
        >
          Reset filter
        </Button>
      </FilterBar>

      {error && (
        <AlertBanner
          tone="danger"
          title="Antrean belum dapat diproses"
          message={error}
          action={{ label: 'Coba lagi', onSelect: () => void load() }}
        />
      )}

      <div
        className="flex flex-wrap gap-x-5 gap-y-2 rounded-dd-md border border-dd-line bg-white px-4 py-3 text-xs text-dd-muted"
        aria-label="Legenda status baris pembayaran"
      >
        {[
          ['bg-dd-success-soft border-dd-forest', 'Paket aktif'],
          ['bg-dd-warning-soft border-dd-brass', 'Menunggu tindakan'],
          ['bg-dd-danger-soft border-dd-danger', 'Ditolak atau kedaluwarsa'],
          ['bg-dd-surface-muted border-dd-muted/40', 'Belum dibayar atau belum aktif'],
        ].map(([classes, label]) => (
          <span key={label} className="inline-flex items-center gap-2">
            <span className={`size-3 rounded-sm border-l-2 ${classes}`} aria-hidden="true" />
            {label}
          </span>
        ))}
      </div>

      <DataTable
        items={items}
        loading={loading}
        rowNumberOffset={pageOffset((filters.page ?? 1) - 1)}
        rowKey={(item) => item.id}
        emptyTitle={
          filters.q
            ? 'Transaksi tidak ditemukan'
            : filters.status === 'PENDING'
              ? 'Antrean pembayaran kosong'
              : 'Daftar transaksi kosong'
        }
        emptyDescription={
          filters.q
            ? 'Ubah pencarian atau reset filter untuk melihat hasil lain.'
            : filters.status === 'PENDING'
              ? 'Tidak ada transaksi baru yang menunggu verifikasi saat ini. Anda dapat memeriksa riwayat seluruh transaksi yang telah diproses.'
              : 'Tidak ada transaksi yang perlu ditampilkan pada filter ini.'
        }
        emptyAction={
          filters.status === 'PENDING' && !filters.q ? (
            <Button
              variant="secondary"
              onClick={() => changeFilters({ status: 'ALL', cursor: undefined, page: 1 })}
            >
              Lihat Riwayat Semua Transaksi
            </Button>
          ) : filters.q ? (
            <Button
              variant="secondary"
              onClick={() => {
                setSearch('');
                changeFilters({ q: undefined, cursor: undefined, page: 1 });
              }}
            >
              Hapus Pencarian
            </Button>
          ) : undefined
        }
        onRowClick={(item) => router.push(detailHref(item.id))}
        rowClassName={(item) => rowClasses[paymentRowState(item)]}
        mobileCardClassName={(item) => rowClasses[paymentRowState(item)]}
        rowDescription={(item) =>
          `${item.customer.displayName}, ${statusLabels[item.status] ?? statusLabel(item.status)}, ${item.activationSummary?.status === 'ACTIVE' ? 'paket aktif' : 'paket belum aktif'}`
        }
        columns={[
          {
            id: 'customer',
            header: 'Pelanggan',
            cell: (item) => (
              <div>
                <strong>{item.customer.displayName}</strong>
                <p className="text-xs text-dd-muted">
                  {item.customer.email ? `${item.customer.email} · ` : ''}
                  {item.customer.phoneMasked ?? 'Kontak termasking tidak tersedia'}
                </p>
                {item.recordedBy && (
                  <p className="mt-1 text-xs font-semibold text-dd-forest">
                    Dicatat staf · {item.recordedBy.displayName}
                    {item.paymentMethod && assistedPaymentMethodLabels[item.paymentMethod as keyof typeof assistedPaymentMethodLabels]
                      ? ` · ${assistedPaymentMethodLabels[item.paymentMethod as keyof typeof assistedPaymentMethodLabels]}`
                      : ''}
                  </p>
                )}
              </div>
            ),
          },
          { id: 'branch', header: 'Cabang', cell: (item) => <Badge>{item.branch.name}</Badge> },
          {
            id: 'package',
            header: 'Paket',
            cell: (item) => (
              <div>
                <strong>{item.packageNameSnapshot}</strong>
                <p className="text-xs text-dd-muted">
                  {item.sessionCountSnapshot} sesi · {item.durationDaysSnapshot} hari
                </p>
              </div>
            ),
          },
          {
            id: 'amount',
            header: 'Nominal',
            cell: (item) => (
              <div>
                <strong>
                  {formatRupiah(item.payableAmountRpSnapshot ?? item.priceRpSnapshot)}
                </strong>
                <p className="text-xs text-dd-muted">
                  Harga {formatRupiah(item.priceRpSnapshot)}
                  {item.packagePromotionId && (
                    <>
                      {' '}
                      · Promo {item.packagePromotionNameSnapshot} −
                      {formatRupiah(item.packagePromotionDiscountRpSnapshot ?? 0)}
                    </>
                  )}
                  {item.voucherCodeSnapshot && (
                    <>
                      {' '}
                      · {item.voucherCodeSnapshot} −
                      {formatRupiah(item.voucherDiscountRpSnapshot ?? 0)}
                    </>
                  )}
                </p>
              </div>
            ),
          },
          {
            id: 'sessions',
            header: 'Sesi paket',
            cell: sessionSummary,
          },
          {
            id: 'proof',
            header: 'Bukti',
            cell: (item) =>
              item.paymentProof ? (
                <div>
                  <Badge
                    tone={
                      item.paymentProof.scanStatus === 'CLEAN'
                        ? 'success'
                        : item.paymentProof.scanStatus === 'REJECTED' ||
                            item.paymentProof.scanStatus === 'INFECTED'
                          ? 'danger'
                          : 'warning'
                    }
                  >
                    {item.paymentProof.scanStatus === 'CLEAN'
                      ? 'Siap diperiksa'
                      : item.paymentProof.scanStatus}
                  </Badge>
                  <p className="mt-1 text-xs text-dd-muted">
                    Dikirim {safeFormatDateTime(item.submittedAt)}
                  </p>
                </div>
              ) : (
                <Badge tone="warning">Belum ada</Badge>
              ),
          },
          {
            id: 'age',
            header: 'Usia / batas',
            cell: (item) => (
              <div>
                {ageLabel(item.submittedAt)}
                <p className="text-xs text-dd-muted">
                  {item.paymentExpiresAt
                    ? `Berakhir ${safeFormatDateTime(item.paymentExpiresAt)}`
                    : 'Tanpa batas pembayaran'}
                </p>
              </div>
            ),
          },
          {
            id: 'status',
            header: 'Status',
            cell: (item) => (
              <Badge tone={paymentStatusTone(item.status)}>
                {statusLabels[item.status] ?? statusLabel(item.status)}
              </Badge>
            ),
          },
          { id: 'action', header: 'Tindakan', cell: (item) => actions(item) },
        ]}
        mobileCard={(item) => (
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <strong>{item.customer.displayName}</strong>
                <p className="text-sm text-dd-muted">
                  {item.branch.name} · {item.packageNameSnapshot}
                </p>
              </div>
              <Badge tone={paymentStatusTone(item.status)}>
                {statusLabels[item.status] ?? statusLabel(item.status)}
              </Badge>
            </div>
            <div>
              <p className="text-xs text-dd-muted">Nominal transfer</p>
              <strong>{formatRupiah(item.payableAmountRpSnapshot ?? item.priceRpSnapshot)}</strong>
              <p className="mt-1 text-xs text-dd-muted">
                Bukti dikirim {safeFormatDateTime(item.submittedAt)}
              </p>
            </div>
            <div>{sessionSummary(item)}</div>
            {actions(item, true)}
          </div>
        )}
      />

      <Pagination
        currentPage={filters.page ?? 1}
        totalPages={totalPages > 1 ? totalPages : (Math.ceil(currentTotal / ADMIN_PAGE_SIZE) || 1)}
        totalItems={currentTotal}
        pageSize={ADMIN_PAGE_SIZE}
        hasPrevious={(filters.page ? filters.page > 1 : cursorHistory.length > 0) && !loading}
        hasNext={Boolean(nextCursor) || (totalPages > 1 && (filters.page ?? 1) < totalPages)}
        showPageNumbers
        totalLabel={`${currentTotal.toLocaleString('id-ID')} transaksi`}
        onPageChange={(target) => {
          changeFilters({ page: target, cursor: undefined }, true);
        }}
        onPrevious={onPrevious}
        onNext={onNext}
      />

      <PreviewModal
        open={Boolean(previewItem)}
        title={
          previewItem ? `Bukti pembayaran ${previewItem.customer.displayName}` : 'Bukti pembayaran'
        }
        description="File privat hanya ditampilkan selama pemeriksaan ini."
        onClose={closePreview}
        className="max-w-4xl"
      >
        <div className="min-h-72">
          {previewLoading && <Skeleton label="Memuat bukti pembayaran" />}
          {!previewLoading && previewUrl && previewType.startsWith('image/') && (
            <img
              src={previewUrl}
              alt={`Bukti pembayaran ${previewItem?.customer.displayName ?? ''}`}
              className="max-h-[65vh] w-full rounded-dd-lg border border-dd-line bg-white object-contain"
            />
          )}
          {!previewLoading && previewUrl && previewType === 'application/pdf' && (
            <object
              data={previewUrl}
              type={previewType}
              title="Preview bukti pembayaran privat"
              className="h-[65vh] w-full rounded-dd-lg border border-dd-line bg-white"
            >
              <p>Preview PDF tidak didukung browser ini.</p>
            </object>
          )}
          {!previewLoading &&
            previewUrl &&
            !previewType.startsWith('image/') &&
            previewType !== 'application/pdf' && (
              <AlertBanner
                tone="warning"
                title="Format tidak didukung"
                message="Unduh atau minta bukti dalam format JPEG, PNG, WebP, atau PDF."
              />
            )}
          {!previewLoading && !previewUrl && (
            <AlertBanner
              tone="warning"
              title="Bukti belum dapat ditampilkan"
              message="Tutup preview lalu coba kembali dari antrean."
            />
          )}

          {previewItem && (
            <div className="mt-4 space-y-4 border-t border-dd-line pt-4">
              <div className="grid grid-cols-2 gap-3 rounded-dd-lg bg-dd-surface-muted p-4 text-xs sm:grid-cols-4">
                <div>
                  <p className="text-dd-muted">ID Transaksi</p>
                  <p className="font-semibold text-dd-forest">{previewItem.id}</p>
                </div>
                <div>
                  <p className="text-dd-muted">Pelanggan</p>
                  <p className="font-semibold">{previewItem.customer.displayName}</p>
                  <p className="text-dd-muted">{previewItem.customer.phoneMasked || '-'}</p>
                </div>
                <div>
                  <p className="text-dd-muted">Paket & Cabang</p>
                  <p className="font-semibold">{previewItem.packageNameSnapshot}</p>
                  <p className="text-dd-muted">{previewItem.branch.name}</p>
                </div>
                <div>
                  <p className="text-dd-muted">Nominal Transfer</p>
                  <p className="text-sm font-bold text-dd-forest">
                    {formatRupiah(previewItem.payableAmountRpSnapshot ?? previewItem.priceRpSnapshot)}
                  </p>
                </div>
              </div>

              {canDecideItem(previewItem) && isPendingDecision(previewItem.status) && !isOwnRecord(previewItem) && (
                <div className="space-y-3">
                  <label className="flex cursor-pointer select-none items-start gap-3 rounded-dd-lg border border-dd-line p-3 hover:bg-dd-surface-muted/50">
                    <input
                      type="checkbox"
                      id="verify-transfer-proof-checkbox"
                      checked={modalVerified}
                      onChange={(e) => setModalVerified(e.target.checked)}
                      className="mt-0.5 size-4 rounded border-dd-line text-dd-forest focus:ring-dd-forest"
                    />
                    <span className="text-xs text-dd-charcoal">
                      <strong>Konfirmasi Pemeriksaan:</strong> Saya telah memeriksa mutasi rekening / foto bukti transfer di atas dan memvalidasi keabsahan serta nominal transfer sesuai dengan tagihan.
                    </span>
                  </label>

                  <div className="flex justify-end gap-3">
                    <Button variant="secondary" onClick={closePreview}>
                      Tutup
                    </Button>
                    <Button
                      disabled={!modalVerified || mutatingId === previewItem.id}
                      loading={mutatingId === previewItem.id}
                      onClick={async () => {
                        await approve(previewItem);
                        closePreview();
                      }}
                    >
                      <CheckCircle2 className="size-4" /> Setujui dan Aktifkan Paket
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </PreviewModal>
      {canRecord && saleBranches.length > 0 && (
        <AssistedSaleDrawer
          open={saleOpen}
          branch={activeBranch}
          branches={saleBranches}
          onClose={() => setSaleOpen(false)}
          onRecorded={() => void load()}
        />
      )}
    </section>
  );
}
