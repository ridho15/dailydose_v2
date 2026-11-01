'use client';

import { ArrowLeft, CheckCircle2, Clock, Eye, Filter, RefreshCw, UploadCloud } from 'lucide-react';
import { browserOrderClient, sha256Upload } from '@/api-clients/order-client';
import { compressImageIfNeeded } from '@/lib/image-compression';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  browserPurchaseReviewClient,
  purchaseFailure,
  type PurchaseReviewClient,
  type ReviewDetail,
  type ReviewPurchase,
  type ReviewSummary,
} from '@/api-clients/purchase-client';
import { Badge, Pagination, Panel } from '../../../components/admin/admin-ui';
import { Button, ButtonLink } from '../../../components/actions';
import { AlertBanner, useOptionalAppFeedback } from '../../../components/app-feedback';
import { useSessionContext } from '../../../session-context';
import { Skeleton } from '../../../ui';
import { paymentStatusTone } from '../../../purchases/purchase-review-view';
import { SelectInput, Textarea } from '../../../components/forms';
import { formatRupiah } from '../../../lib/formatters';
import { useDelayedAction } from '../../../lib/use-delayed-action';
import { PaymentAmountCheck } from './payment-amount-check';
import { ProofImageViewer } from './proof-image-viewer';

const statusLabels: Record<string, string> = {
  AWAITING_PAYMENT: 'Menunggu pembayaran',
  PENDING: 'Menunggu pemeriksaan',
  ACTION_REQUIRED: 'Perlu perbaikan',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
  EXPIRED: 'Kedaluwarsa',
};
const reasonLabels = {
  PROOF_INVALID: 'Bukti tidak valid',
  AMOUNT_MISMATCH: 'Nominal tidak sesuai',
  OTHER_REVIEW_REQUIRED: 'Perlu tinjauan lain',
} as const;
type RejectReason = keyof typeof reasonLabels;

const quickRejectionTemplates: Array<{
  label: string;
  reason: RejectReason;
  text: string;
}> = [
  {
    label: 'Bukti buram / terpotong',
    reason: 'PROOF_INVALID',
    text: 'Bukti transfer tidak jelas atau terpotong. Mohon unggah ulang bukti transfer yang jelas.',
  },
  {
    label: 'Nominal tidak sesuai',
    reason: 'AMOUNT_MISMATCH',
    text: 'Nominal pada bukti transfer tidak sesuai dengan total tagihan pesanan.',
  },
  {
    label: 'Rekening tidak cocok',
    reason: 'PROOF_INVALID',
    text: 'Nama rekening pengirim atau nomor rekening tujuan tidak sesuai dengan instruksi pembayaran.',
  },
  {
    label: 'Dana belum masuk',
    reason: 'OTHER_REVIEW_REQUIRED',
    text: 'Dana mutasi belum masuk pada rekening studio. Mohon konfirmasi ke bank pengirim.',
  },
];

export function safePaymentReturnTo(value?: string) {
  if (!value || !value.startsWith('/workspace/payments') || value.startsWith('//'))
    return '/workspace/payments';
  try {
    const parsed = new URL(value, 'http://local.invalid');
    if (parsed.origin !== 'http://local.invalid' || parsed.pathname !== '/workspace/payments')
      return '/workspace/payments';
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return '/workspace/payments';
  }
}

function formatDateTime(val?: Date | string | null): string {
  if (!val) return 'Belum terjadi';
  const d = val instanceof Date ? val : new Date(val);
  return isNaN(d.getTime()) ? 'Tidak valid' : d.toLocaleString('id-ID');
}

function formatDate(val?: Date | string | null): string {
  if (!val) return '-';
  const d = val instanceof Date ? val : new Date(val);
  return isNaN(d.getTime()) ? '-' : d.toLocaleDateString('id-ID');
}

const ageLabel = (submittedAt?: Date | string | null) => {
  if (!submittedAt) return 'baru saja';
  const time = new Date(submittedAt).getTime();
  const hours = Math.max(
    0,
    Math.floor((Date.now() - (Number.isNaN(time) ? Date.now() : time)) / 3_600_000),
  );
  if (hours < 1) return 'menunggu < 1 jam';
  if (hours < 24) return `menunggu ${hours} jam`;
  return `menunggu ${Math.floor(hours / 24)} hari`;
};

export function PaymentReviewDetailView({
  id,
  returnTo,
  client = browserPurchaseReviewClient,
  authorityOverride,
  decisionDelayMs = 10_000,
}: {
  id: string;
  returnTo?: string;
  client?: PurchaseReviewClient;
  authorityOverride?: { canReview: boolean; canDecide: boolean };
  /** Keputusan baru dikirim setelah jeda ini supaya petugas masih bisa membatalkan. */
  decisionDelayMs?: number;
}) {
  const router = useRouter();
  const delayed = useDelayedAction(decisionDelayMs);
  const sessionContext = useSessionContext();
  const feedback = useOptionalAppFeedback();
  const sessionReady = Boolean(authorityOverride) || sessionContext?.status === 'authenticated';
  const canReview =
    authorityOverride?.canReview ??
    Boolean(sessionContext?.hasCapability('payment:review', 'purchase:review'));
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const canRecord = Boolean(sessionContext?.hasCapability('purchase:record'));
  const isDirectPayment = ['CASH', 'CARD', 'MANUAL_STAFF'].includes(detail?.purchase?.paymentMethod || '');
  const canDecide =
    authorityOverride?.canDecide ??
    Boolean(
      sessionContext?.hasCapability('payment:decide', 'purchase:decide') ||
      (canRecord && isDirectPayment),
    );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mutating, setMutating] = useState(false);
  const [reasonCode, setReasonCode] = useState<RejectReason>('PROOF_INVALID');
  const [note, setNote] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewType, setPreviewType] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  /** Gambar bukti benar-benar tampil di layar; persetujuan hanya boleh setelah itu. */
  const [proofImageShown, setProofImageShown] = useState(false);
  const [manualFile, setManualFile] = useState<File | null>(null);
  const [manualUploading, setManualUploading] = useState(false);
  const [manualUploadError, setManualUploadError] = useState('');
  const [manualUploadSuccess, setManualUploadSuccess] = useState('');
  const isImagePreview = previewType.startsWith('image/');
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageCursor, setUsageCursor] = useState<string>();
  const [usageCursorHistory, setUsageCursorHistory] = useState<string[]>([]);
  const [pendingQueue, setPendingQueue] = useState<ReviewPurchase[]>([]);
  const [pendingTotal, setPendingTotal] = useState<number>(0);
  const [oldestSubmitted, setOldestSubmitted] = useState<Date | null>(null);
  const [sortOrder, setSortOrder] = useState<'oldest' | 'newest'>('oldest');
  const backHref = safePaymentReturnTo(returnTo);

  const load = useCallback(async () => {
    if (!sessionReady || !canReview) return;
    setLoading(true);
    setError('');
    try {
      setDetail(await client.detail(id));
      setUsageCursor(undefined);
      setUsageCursorHistory([]);
    } catch (cause) {
      setError(purchaseFailure(cause));
    } finally {
      setLoading(false);
    }
  }, [canReview, client, id, sessionReady]);

  useEffect(() => void load(), [load]);

  useEffect(() => {
    if (!sessionReady || !canReview) return;
    let active = true;
    client
      .list({ status: 'PENDING', limit: 20 })
      .then((result) => {
        if (!active) return;
        setPendingQueue(result.items);
        setPendingTotal(result.total ?? result.items.length);
        if (result.items.length > 0) {
          const sorted = [...result.items].sort(
            (a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime(),
          );
          if (sorted[0]?.submittedAt) setOldestSubmitted(new Date(sorted[0].submittedAt));
        }
      })
      .catch(() => {
        // Abaikan kegagalan pemuatan antrean samping
      });
    return () => {
      active = false;
    };
  }, [canReview, client, sessionReady]);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const handleManualUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualFile || !detail?.purchase) return;
    setManualUploading(true);
    setManualUploadError('');
    setManualUploadSuccess('');
    try {
      const compressed = await compressImageIfNeeded(manualFile);
      const sha256 = await sha256Upload(compressed);
      await browserOrderClient.uploadProof(
        detail.purchase as any,
        compressed,
        sha256,
        undefined,
      );
      setManualFile(null);
      setManualUploadSuccess('Bukti transfer manual berhasil diunggah.');
      feedback?.showToast({ tone: 'success', title: 'Bukti transfer manual berhasil diunggah', message: 'Status pesanan diperbarui.' });
      await load();
    } catch (err: any) {
      setManualUploadError(err.message || 'Gagal mengunggah bukti manual.');
      feedback?.showToast({ tone: 'danger', title: 'Gagal mengunggah bukti manual', message: err.message });
    } finally {
      setManualUploading(false);
    }
  };

  const loadPreview = useCallback(async () => {
    const proof = detail?.purchase.paymentProof;
    if (!proof || proof.scanStatus !== 'CLEAN') return;
    setPreviewLoading(true);
    setError('');
    try {
      const blob = await client.loadProof(proof.id);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewType(blob.type || proof.mimeType);
      setProofImageShown(false);
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (cause) {
      setError(purchaseFailure(cause));
    } finally {
      setPreviewLoading(false);
    }
  }, [client, detail?.purchase.paymentProof, previewUrl]);

  const loadUsagePage = async (cursor?: string) => {
    if (!detail) return;
    setUsageLoading(true);
    try {
      const next = await client.detail(id, cursor);
      setDetail({
        ...detail,
        usageHistory: next.usageHistory,
      });
      setUsageCursor(cursor);
    } catch (cause) {
      setError(purchaseFailure(cause));
    } finally {
      setUsageLoading(false);
    }
  };

  /** Setelah keputusan tersimpan, buka bukti berikutnya di antrean; bila tidak ada, tetap di sini. */
  const goToNext = async (currentId: string) => {
    try {
      const page = await client.list({ status: 'PENDING', limit: 5 });
      const next = page.items.find(
        (item) => item.id !== currentId && (item.status === 'PENDING' || item.status === 'WAITING_VERIFICATION'),
      );
      if (next) router.push(`/workspace/payments/${next.id}?returnTo=${encodeURIComponent(backHref)}`);
    } catch {
      // Antrean tidak dapat dimuat: tetap di bukti yang baru diputuskan.
    }
  };

  const decide = async (action: 'APPROVE' | 'ACTION_REQUIRED' | 'DUPLICATE') => {
    const purchase = detail?.purchase;
    const isSuper = Boolean(
      sessionContext?.session?.roles?.some((r) =>
        r === 'SUPER_OWNER',
      ),
    );
    const isRecorder = Boolean(
      (purchase?.recordedById || purchase?.recordedBy?.id) &&
        sessionContext?.session?.id &&
        (purchase.recordedById === sessionContext.session.id ||
          purchase.recordedBy?.id === sessionContext.session.id),
    );
    const isSelfCustomer = Boolean(
      purchase?.customer?.id &&
        sessionContext?.session?.id &&
        purchase.customer.id === sessionContext.session.id,
    );
    const isDirectCashOrCard = ['CASH', 'CARD', 'MANUAL_STAFF'].includes(purchase?.paymentMethod || '');
    const separationOfDutiesBlocked = !isSuper && (isSelfCustomer || (!isDirectCashOrCard && isRecorder));
    const proofRequiresReview = Boolean(purchase?.paymentProof);
    const proofNotYetViewed =
      proofRequiresReview && (!previewUrl || previewLoading || (isImagePreview && !proofImageShown));
    const isPending =
      purchase?.status === 'PENDING' || purchase?.status === 'WAITING_VERIFICATION';
    const canRecordUser = Boolean(sessionContext?.hasCapability('purchase:record'));
    const effectiveCanDecide = canDecide || (canRecordUser && isDirectCashOrCard);
    if (!purchase || !effectiveCanDecide || !isPending || separationOfDutiesBlocked) return;
    if (action === 'APPROVE' && proofNotYetViewed) {
      setError('Anda wajib melihat pratinjau bukti transfer terlebih dahulu sebelum dapat menyetujui pembayaran.');
      return;
    }
    if (
      action === 'ACTION_REQUIRED' &&
      reasonCode === 'OTHER_REVIEW_REQUIRED' &&
      note.trim().length < 3
    ) {
      setError('Catatan wajib diisi minimal 3 karakter untuk alasan tinjauan lain.');
      return;
    }
    const copy = {
      APPROVE: [
        'Setujui dan aktifkan paket',
        'Paket pelanggan akan diaktifkan.',
      ],
      ACTION_REQUIRED: [
        'Minta perbaikan bukti',
        'Pelanggan harus mengunggah bukti pembayaran pengganti.',
      ],
      DUPLICATE: [
        'Tolak pembayaran',
        'Transaksi ditolak tanpa mengaktifkan paket atau ledger.',
      ],
    } as const;
    const confirmed = feedback
      ? await feedback.confirm({
          tone: action === 'APPROVE' ? 'warning' : 'danger',
          title: copy[action][0],
          message: `${purchase.customer.displayName} · ${purchase.branch.name} · ${formatRupiah(purchase.payableAmountRpSnapshot ?? purchase.priceRpSnapshot)}. ${copy[action][1]} Keputusan dikirim 10 detik setelah ini; Anda masih bisa membatalkannya sebelum itu.`,
          confirmLabel: copy[action][0],
        })
      : Boolean(authorityOverride);
    if (!confirmed) return;
    const execute = async () => {
      setMutating(true);
      setError('');
      let succeeded = false;
      try {
        const latest = await client.detail(purchase.id).catch(() => null);
        const versionToUse = latest?.purchase?.version ?? purchase.version;
        if (action === 'APPROVE') {
          const result = await client.approve(
            purchase.id,
            versionToUse,
            crypto.randomUUID(),
            note.trim() || undefined,
          );
          feedback?.showToast({
            tone: 'success',
            title: 'Pembayaran disetujui',
            message: `${result.customerPackage?.packageName ?? purchase.packageNameSnapshot} aktif dengan ${result.customerPackage?.available ?? 0} sesi.`,
            correlationReference: result.purchase.auditReference ?? undefined,
          });
        } else {
          await client.reject(
            purchase.id,
            versionToUse,
            action === 'DUPLICATE' ? 'DUPLICATE_PURCHASE' : reasonCode,
            crypto.randomUUID(),
            note.trim() || undefined,
          );
          feedback?.showToast({
            tone: 'success',
            title: action === 'DUPLICATE' ? 'Transaksi ditolak' : 'Perbaikan bukti diminta',
            message: 'Keputusan dan audit telah disimpan.',
          });
        }
        succeeded = true;
        await load();
      } catch (cause) {
        await load();
        setError(purchaseFailure(cause));
      } finally {
        setMutating(false);
      }
      if (succeeded) await goToNext(purchase.id);
    };
    delayed.schedule(copy[action][0], execute);
  };

  if (sessionContext?.status === 'unauthenticated' && !authorityOverride)
    return (
      <AlertBanner
        tone="warning"
        title="Sesi telah berakhir"
        message="Masuk kembali untuk memeriksa pembayaran."
      />
    );
  if (!sessionReady) return <Skeleton label="Memuat sesi dan izin pembayaran" />;
  if (!canReview)
    return (
      <AlertBanner
        tone="danger"
        title="Akses tidak tersedia"
        message="Role Anda tidak memiliki izin untuk memeriksa pembayaran."
      />
    );
  if (!detail) {
    if (loading) {
      return <Skeleton label="Memuat detail pembayaran" />;
    }
    if (error) {
      return (
        <AlertBanner
          tone="danger"
          title="Detail pembayaran belum tersedia"
          message={error}
          action={{ label: 'Coba lagi', onSelect: () => void load() }}
        />
      );
    }
    return <Skeleton label="Memuat detail pembayaran" />;
  }

  const purchase = detail.purchase;
  const isPendingDecision =
    purchase.status === 'PENDING' || purchase.status === 'WAITING_VERIFICATION';
  const timeline = [
    ['Bukti dikirim', detail.timeline.submittedAt],
    ['Pemeriksaan file selesai', detail.timeline.proofFinalizedAt],
    ['Keputusan dibuat', detail.timeline.decidedAt],
  ] as const;

  const sortedQueue = [...pendingQueue].sort((a, b) => {
    const timeA = new Date(a.submittedAt).getTime();
    const timeB = new Date(b.submittedAt).getTime();
    return sortOrder === 'oldest' ? timeA - timeB : timeB - timeA;
  });

  return (
    <section className="space-y-5 font-sans text-dd-ink" aria-labelledby="payment-detail-title">
      {/* Top Header: Bukti transfer menunggu & Finance info */}
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-dd-line pb-4">
        <div>
          <div className="flex items-center gap-3">
            <ButtonLink
              href={backHref}
              variant="ghost"
              size="sm"
              leadingIcon={<ArrowLeft className="size-4" />}
            >
              Kembali ke antrean
            </ButtonLink>
            <h1
              id="payment-detail-title"
              className="text-2xl font-black tracking-tight text-dd-ink sm:text-3xl"
            >
              Bukti transfer menunggu
            </h1>
          </div>
          <p className="mt-1 text-xs text-dd-muted">Transaksi {purchase.id}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-dd-muted">Finance, semua cabang</span>
          <Badge tone={paymentStatusTone(purchase.status)}>
            {statusLabels[purchase.status] ?? purchase.status}
          </Badge>
          <Button
            variant="secondary"
            size="sm"
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
      </header>

      {error && (
        <AlertBanner
          tone="danger"
          title="Tindakan belum dapat diproses"
          message={error}
          action={{ label: 'Muat data terbaru', onSelect: () => void load() }}
        />
      )}
      {!canDecide && (
        <AlertBanner
          tone="info"
          title="Mode hanya baca"
          message="Anda dapat melihat transaksi dan bukti. Keputusan dilakukan oleh Finance atau Super Owner."
        />
      )}      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* Panel Kiri: Antrean Bukti Transfer Menunggu (Mockup 16) */}
        <aside aria-label="Antrean bukti transfer" className="space-y-3 lg:w-80 shrink-0">
          <div className="rounded-dd-xl border border-dd-border-interactive bg-white p-4 space-y-3">
            <div>
              <p className="text-sm font-bold text-dd-ink">
                <span className="text-dd-forest">{pendingTotal || pendingQueue.length} bukti</span> menunggu diperiksa.
              </p>
              {oldestSubmitted && (
                <p className="text-xs text-dd-muted mt-0.5">
                  Tertua dikirim {formatDate(oldestSubmitted)}.
                </p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as 'oldest' | 'newest')}
                aria-label="Urutan antrean"
                className="w-full rounded-dd-md border border-dd-border-interactive bg-white px-2.5 py-1.5 text-xs font-semibold text-dd-ink"
              >
                <option value="oldest">Tertua dulu</option>
                <option value="newest">Terbaru dulu</option>
              </select>
              <Button variant="secondary" size="sm" leadingIcon={<Filter className="size-3.5" />}>
                Filter
              </Button>
            </div>

            <div className="rounded-dd-md bg-dd-surface-muted border border-dd-line p-2 text-xs text-dd-muted leading-tight">
              Filter aktif: semua cabang, status menunggu pemeriksaan.
            </div>

            <div className="space-y-1.5 max-h-[calc(100vh-22rem)] overflow-y-auto pr-1">
              {sortedQueue.length === 0 ? (
                <p className="text-xs text-dd-muted py-2">Tidak ada bukti lain di antrean.</p>
              ) : (
                sortedQueue.map((item) => {
                  const isActive = item.id === purchase.id;
                  return (
                    <Link
                      key={item.id}
                      href={`/workspace/payments/${encodeURIComponent(item.id)}?returnTo=${encodeURIComponent(backHref)}`}
                      className={`block rounded-dd-lg border p-3 text-left transition no-underline ${
                        isActive
                          ? 'border-2 border-dd-forest bg-dd-forest/5 text-dd-ink'
                          : 'border-dd-line bg-white text-dd-ink hover:border-dd-border-interactive hover:bg-dd-surface-muted'
                      }`}
                    >
                      <p className="font-bold text-sm truncate">{item.customer.displayName}</p>
                      <p className="text-xs text-dd-muted truncate">
                        {item.branch.name}, {item.packageNameSnapshot}
                      </p>
                      <div className="mt-2 flex items-center justify-between text-xs">
                        <span className="font-bold text-dd-forest">
                          {formatRupiah(item.payableAmountRpSnapshot ?? item.priceRpSnapshot)}
                        </span>
                        <span className="text-dd-muted">{ageLabel(item.submittedAt)}</span>
                      </div>
                    </Link>
                  );
                })
              )}
            </div>
          </div>
        </aside>

        {/* Panel Kanan: Pemeriksaan Bukti Terpilih */}
        <div className="flex-1 space-y-5 min-w-0">
          {/* Header Pelanggan & Paket */}
          <Panel className="p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-[13px] font-bold text-dd-forest">
                  Detail pembayaran
                </h2>
                <h3 className="mt-1 text-2xl font-black text-dd-ink sm:text-3xl">
                  {purchase.customer.displayName}
                </h3>
                <p className="text-sm font-medium text-dd-muted mt-1">
                  {purchase.branch.name} · {purchase.packageNameSnapshot}
                </p>
              </div>
              <Badge>{purchase.branch.name}</Badge>
            </div>
          </Panel>

          {/* KARTU NOMINAL DISANDINGKAN (Elemen Terbesar di Layar - Tiket T-21 / Mockup 16) */}
          <PaymentAmountCheck
            expectedRp={purchase.payableAmountRpSnapshot ?? purchase.priceRpSnapshot}
          />

          {/* Grid Bukti Transfer & Panel Keputusan */}
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            {/* Kartu Gambar Bukti Transfer */}
            <Panel id="private-payment-proof-panel" className="p-5 sm:p-6 flex flex-col justify-between">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-dd-line pb-3">
                  <div>
                    <h3 className="text-lg font-bold text-dd-ink">Bukti transfer</h3>
                    <p className="text-xs text-dd-muted">
                      Status scan: {purchase.paymentProof?.scanStatus ?? 'Belum tersedia'}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    leadingIcon={<Eye className="size-4" aria-hidden="true" />}
                    disabled={
                      previewLoading ||
                      !purchase.paymentProof ||
                      purchase.paymentProof.scanStatus !== 'CLEAN'
                    }
                    onClick={() => void loadPreview()}
                  >
                    {previewLoading
                      ? 'Memuat…'
                      : previewUrl
                        ? 'Terbitkan ulang preview'
                        : 'Preview bukti'}
                  </Button>
                </div>

                {previewLoading ? (
                  <div className="mt-5 grid min-h-[420px] place-items-center rounded-dd-lg border border-dd-line bg-dd-surface-muted p-6">
                    <Skeleton label="Memuat bukti pembayaran…" />
                  </div>
                ) : previewUrl && (previewType.startsWith('image/') || previewType === 'image/svg+xml') ? (
                  <ProofImageViewer
                    src={previewUrl}
                    alt={`Bukti pembayaran ${purchase.customer.displayName}`}
                    onLoad={() => setProofImageShown(true)}
                    onError={() => setProofImageShown(false)}
                  />
                ) : previewUrl && previewType === 'application/pdf' ? (
                  <object
                    data={previewUrl}
                    type={previewType}
                    title={`Bukti pembayaran ${purchase.customer.displayName}`}
                    className="mt-5 min-h-[420px] h-[34rem] w-full rounded-dd-lg border border-dd-line bg-white"
                  >
                    <p>Preview PDF tidak didukung browser ini.</p>
                  </object>
                ) : previewUrl ? (
                  <AlertBanner
                    tone="warning"
                    title="Format tidak didukung"
                    message="Bukti hanya dapat dipreview sebagai JPEG, PNG, WebP, atau PDF."
                  />
                ) : (
                  <div className="mt-5 grid min-h-[420px] place-items-center rounded-dd-lg border border-dashed border-dd-line bg-dd-surface-muted p-6 text-center text-sm text-dd-muted">
                    {purchase.paymentProof?.scanStatus === 'CLEAN'
                      ? 'Pilih Preview bukti untuk menerbitkan akses privat berumur pendek.'
                      : 'Preview tersedia setelah pemeriksaan file selesai dan berstatus bersih.'}
                  </div>
                )}

                {/* Form Upload Bukti Manual oleh Staf / Admin */}
                <div className="mt-4 rounded-dd-lg border border-dashed border-dd-line bg-dd-surface-muted/60 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-dd-forest">
                        Upload Bukti Manual oleh Staf / Admin
                      </h4>
                      <p className="mt-0.5 text-xs text-dd-muted">
                        Unggah struk transfer bank atau foto bukti pembayaran manual pelanggan.
                      </p>
                    </div>
                  </div>
                  {manualUploadSuccess && (
                    <div className="mt-2 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 p-2 rounded">
                      {manualUploadSuccess}
                    </div>
                  )}
                  {manualUploadError && (
                    <div className="mt-2 text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-200 p-2 rounded">
                      {manualUploadError}
                    </div>
                  )}
                  <form onSubmit={handleManualUpload} className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                      type="file"
                      data-testid="manual-proof-input"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      disabled={manualUploading}
                      onChange={(e) => {
                        const selected = e.target.files?.[0];
                        if (selected) {
                          setManualFile(selected);
                          setManualUploadError('');
                        }
                      }}
                      className="text-xs file:mr-2 file:rounded-dd-sm file:border-0 file:bg-dd-forest/10 file:px-2.5 file:py-1 file:text-xs file:font-semibold file:text-dd-forest hover:file:bg-dd-forest/20 cursor-pointer"
                    />
                    {manualFile && (
                      <Button
                        type="submit"
                        variant="primary"
                        size="sm"
                        data-testid="btn-submit-manual-proof"
                        disabled={manualUploading}
                        leadingIcon={<UploadCloud className="size-4" aria-hidden="true" />}
                      >
                        {manualUploading ? 'Mengunggah…' : 'Simpan Bukti Manual'}
                      </Button>
                    )}
                  </form>
                </div>
              </div>
            </Panel>

            {/* Panel Ringkasan Informasi Sesi & Tiga Keputusan (Mockup 16) */}
            <aside className="space-y-4">
              <Panel className="p-5 space-y-4">
                <h3 className="text-lg font-bold text-dd-ink">Keputusan Finance</h3>

                {/* Ringkasan Informasi Sesi */}
                <div className="space-y-2.5 rounded-dd-lg border border-dd-line bg-dd-surface-muted p-4 text-xs sm:text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-dd-muted">Waktu pengiriman</span>
                    <span className="font-semibold text-dd-ink">{formatDateTime(detail.timeline.submittedAt)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-dd-muted">Paket berlaku hingga</span>
                    <span className="font-semibold text-dd-ink">
                      {formatDate(
                        detail.activation?.expiryAt ??
                          (purchase.durationDaysSnapshot
                            ? new Date(new Date(purchase.submittedAt).getTime() + purchase.durationDaysSnapshot * 86400000)
                            : null),
                      )}
                    </span>
                  </div>
                  <hr className="border-dd-line my-1" />
                  <div className="flex justify-between items-center">
                    <span className="text-dd-muted">Sesi belum dipakai</span>
                    <span className="font-semibold text-dd-ink">{detail.balance?.available ?? purchase.sessionCountSnapshot ?? 0}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-dd-muted">Sesi sudah dibooking</span>
                    <span className="font-semibold text-dd-ink">{detail.balance?.reserved ?? 0}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-dd-muted">Sesi sudah terpakai</span>
                    <span className="font-semibold text-dd-ink">{detail.balance?.used ?? 0}</span>
                  </div>
                </div>

                {canDecide && isPendingDecision ? (() => {
                  const isSuper = Boolean(
                    sessionContext?.session?.roles?.some((r) =>
                      r === 'SUPER_OWNER',
                    ),
                  );
                  const isRecorder = Boolean(
                    (purchase.recordedById || purchase.recordedBy?.id) &&
                      sessionContext?.session?.id &&
                      (purchase.recordedById === sessionContext.session.id ||
                        purchase.recordedBy?.id === sessionContext.session.id),
                  );
                  const isSelfCustomer = Boolean(
                    purchase.customer?.id &&
                      sessionContext?.session?.id &&
                      purchase.customer.id === sessionContext.session.id,
                  );
                  const isDirectCashOrCard = ['CASH', 'CARD', 'MANUAL_STAFF'].includes(purchase.paymentMethod || '');
                  const separationOfDutiesBlocked = !isSuper && !isDirectCashOrCard && (isRecorder || isSelfCustomer);
                  const proofRequiresReview = Boolean(purchase.paymentProof);
                  const proofNotYetViewed =
                    proofRequiresReview && (!previewUrl || previewLoading || (isImagePreview && !proofImageShown));

                  return (
                    <div className="space-y-3 pt-2 border-t border-dd-line">
                      {delayed.pending && (
                        <div role="status" className="space-y-2 rounded-dd-md border border-dd-forest bg-dd-forest/5 p-3 text-sm text-dd-ink">
                          <p>
                            <strong>{delayed.pending.label}</strong> akan dikirim dalam {delayed.pending.secondsLeft} detik.
                            Setelah terkirim, keputusan tidak bisa dibatalkan.
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Button variant="secondary" size="sm" onClick={() => delayed.cancel()}>
                              Batalkan
                            </Button>
                            <Button size="sm" onClick={() => delayed.flush()}>
                              Kirim sekarang
                            </Button>
                          </div>
                        </div>
                      )}

                      {separationOfDutiesBlocked && (
                        <div className="rounded-dd-md border border-dd-warning/30 bg-dd-warning-soft p-3 text-xs text-dd-warning leading-relaxed">
                          <strong className="block font-semibold">Pemeriksaan Silang Staf:</strong>
                          {isRecorder
                            ? 'Anda mencatat transaksi ini. Untuk menjaga transparansi, persetujuan pembayaran harus dilakukan oleh staf atau manajer lain.'
                            : 'Anda tidak dapat menyetujui transaksi milik akun Anda sendiri.'}
                        </div>
                      )}

                      {proofNotYetViewed && !separationOfDutiesBlocked && (
                        <div className="rounded-dd-md border border-dd-warning/30 bg-dd-warning-soft p-3 text-xs text-dd-warning leading-relaxed space-y-2">
                          <div>
                            <strong className="block font-semibold">Tinjauan Bukti Wajib:</strong>
                            Buka dan periksa pratinjau bukti transfer di panel kiri sebelum menyetujui transaksi ini.
                          </div>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="w-full text-xs"
                            disabled={
                              previewLoading ||
                              !purchase.paymentProof ||
                              purchase.paymentProof.scanStatus !== 'CLEAN'
                            }
                            onClick={() => {
                              const el = document.getElementById('private-payment-proof-panel');
                              el?.scrollIntoView({ behavior: 'smooth' });
                              void loadPreview();
                            }}
                          >
                            {previewLoading ? 'Memuat bukti…' : 'Buka & Periksa Bukti Sekarang'}
                          </Button>
                        </div>
                      )}

                      {/* Tombol 1: Setujui dan aktifkan paket */}
                      <Button
                        className="w-full justify-center text-sm font-bold min-h-11"
                        aria-label="Setujui pembayaran"
                        disabled={mutating || Boolean(delayed.pending) || separationOfDutiesBlocked || proofNotYetViewed}
                        title={
                          proofNotYetViewed
                            ? 'Buka pratinjau bukti transfer terlebih dahulu sebelum menyetujui.'
                            : undefined
                        }
                        onClick={() => void decide('APPROVE')}
                      >
                        <CheckCircle2 className="size-4" /> Setujui dan aktifkan paket
                      </Button>

                      {/* Tombol 2: Minta perbaikan bukti */}
                      <Button
                        className="w-full justify-center text-sm font-semibold min-h-11"
                        variant="secondary"
                        disabled={mutating || Boolean(delayed.pending) || separationOfDutiesBlocked}
                        onClick={() => void decide('ACTION_REQUIRED')}
                      >
                        Minta perbaikan bukti
                      </Button>

                      {/* Tombol 3: Tolak pembayaran */}
                      <Button
                        className="w-full justify-center text-sm font-semibold min-h-11"
                        variant="danger"
                        aria-label="Tolak sebagai duplikat"
                        disabled={mutating || Boolean(delayed.pending) || separationOfDutiesBlocked}
                        onClick={() => void decide('DUPLICATE')}
                      >
                        Tolak pembayaran
                      </Button>

                      <p className="text-xs text-dd-muted leading-relaxed pt-1">
                        Tombol setujui baru aktif setelah gambar bukti terbuka. Setelah diputuskan, antrean langsung pindah ke bukti berikutnya dan keputusan bisa dibatalkan dalam 10 detik.
                      </p>

                      {/* Detail form alasan perbaikan jika dibutuhkan */}
                      <div className="pt-3 border-t border-dd-line space-y-3">
                        <SelectInput
                          label="Alasan perbaikan"
                          value={reasonCode}
                          onChange={(event) => setReasonCode(event.target.value as RejectReason)}
                        >
                          {Object.entries(reasonLabels).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </SelectInput>
                        <div className="space-y-1.5">
                          <span className="text-xs font-medium text-dd-muted">Templat alasan cepat:</span>
                          <div className="flex flex-wrap gap-1.5">
                            {quickRejectionTemplates.map((tpl) => (
                              <button
                                key={tpl.label}
                                type="button"
                                onClick={() => {
                                  setReasonCode(tpl.reason);
                                  setNote(tpl.text);
                                }}
                                className="rounded-full border border-dd-line bg-dd-surface px-2.5 py-1 text-xs text-dd-ink transition hover:border-dd-forest hover:bg-dd-forest/5 hover:text-dd-forest"
                              >
                                {tpl.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <Textarea
                          label={`Catatan ${reasonCode === 'OTHER_REVIEW_REQUIRED' ? '(wajib)' : '(opsional)'}`}
                          value={note}
                          onChange={(event) => setNote(event.target.value)}
                          maxLength={500}
                          placeholder="Jelaskan alasan keputusan"
                        />
                      </div>
                    </div>
                  );
                })() : (
                  <AlertBanner
                    tone={purchase.status === 'APPROVED' || purchase.status === 'PAID' ? 'success' : 'info'}
                    title={isPendingDecision ? 'Mode hanya baca' : 'Keputusan telah dibuat'}
                    message={
                      isPendingDecision
                        ? 'Keputusan dilakukan Finance atau Super Owner.'
                        : 'Mutation control ditutup untuk transaksi yang sudah diputus.'
                    }
                  />
                )}
              </Panel>
            </aside>
          </div>

          {/* Rincian paket & Timeline Detail */}
          <Panel className="p-5 sm:p-6">
            <h3 className="text-lg font-bold text-dd-ink">Timeline pembayaran</h3>
            <p className="mt-1 text-sm text-dd-muted">
              Waktu berikut berasal dari proses sistem, bukan waktu transfer pada bank pelanggan.
            </p>
            <ol className="mt-5 space-y-4">
              {timeline.map(([label, value], index) => (
                <li key={label} className="flex gap-3">
                  <span
                    className={`mt-1 grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${value ? 'bg-dd-success-soft text-dd-success' : 'bg-dd-surface-muted text-dd-muted'}`}
                  >
                    {value ? <CheckCircle2 className="size-4" /> : index + 1}
                  </span>
                  <div>
                    <strong className="block text-sm">{label}</strong>
                    <span className="text-sm text-dd-muted">
                      {formatDateTime(value)}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>

          {/* Penggunaan Sesi & Aktivasi (jika sudah aktif) */}
          {detail.activation && (
            <Panel className="border-dd-success/30 bg-dd-success-soft/35 p-5 sm:p-6">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="size-6 text-dd-success" />
                <div>
                  <h3 className="text-lg font-bold">Paket pelanggan telah aktif</h3>
                  <p className="text-sm text-dd-muted">
                    Hasil ini dimuat dari data paket dan catatan sesi resmi.
                  </p>
                </div>
              </div>
              <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <dt className="text-dd-muted">Paket aktif</dt>
                  <dd className="mt-1 font-semibold">{detail.activation.packageName}</dd>
                </div>
                <div>
                  <dt className="text-dd-muted">Saldo awal</dt>
                  <dd className="mt-1 font-semibold">{detail.activation.sessionCount} sesi</dd>
                </div>
                <div>
                  <dt className="text-dd-muted">Aktif / kedaluwarsa</dt>
                  <dd className="mt-1 font-semibold">
                    {formatDate(detail.activation.activationDate)} –{' '}
                    {formatDate(detail.activation.expiryAt)}
                  </dd>
                </div>
              </dl>
            </Panel>
          )}

          {detail.balance && (
            <Panel className="p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold">Penggunaan sesi</h3>
                  <p className="mt-1 text-sm text-dd-muted">
                    Saldo dan perubahan sesi berasal dari catatan sesi resmi.
                  </p>
                </div>
                <Badge
                  tone={
                    detail.balance.status === 'ACTIVE'
                      ? 'success'
                      : detail.balance.status === 'EXPIRED'
                        ? 'danger'
                        : 'neutral'
                  }
                >
                  {detail.balance.status === 'ACTIVE'
                    ? 'Paket aktif'
                    : detail.balance.status === 'EXPIRED'
                      ? 'Paket kedaluwarsa'
                      : 'Paket tidak aktif'}
                </Badge>
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-3 rounded-dd-lg border border-dd-line bg-dd-surface-muted p-4 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-dd-muted">Saldo awal</dt>
                  <dd className="mt-1 font-semibold">{detail.balance.sessionCount}</dd>
                </div>
                <div>
                  <dt className="text-dd-muted">Tersedia</dt>
                  <dd className="mt-1 font-semibold">{detail.balance.available}</dd>
                </div>
                <div>
                  <dt className="text-dd-muted">Direservasi</dt>
                  <dd className="mt-1 font-semibold">{detail.balance.reserved}</dd>
                </div>
                <div>
                  <dt className="text-dd-muted">Terpakai</dt>
                  <dd className="mt-1 font-semibold">{detail.balance.used}</dd>
                </div>
              </dl>
            </Panel>
          )}
        </div>
      </div>
    </section>
  );
}
