'use client';

import {
  AlertCircle,
  AlertTriangle,
  Camera,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Eye,
  RotateCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  DocumentKind,
  DocumentReviewStatus,
  DocumentScanStatus,
  VerificationDocument,
} from '@/api-clients/identity-verification-client';
import { Button } from '../components/actions';
import { AlertBanner, Modal } from '../components/app-feedback';
import { Badge, Panel } from '../components/admin/admin-ui';
import { SelectInput, Textarea } from '../components/forms';

export const statusLabels: Record<DocumentReviewStatus, string> = {
  PENDING: 'Menunggu pemeriksaan',
  APPROVED: 'Disetujui',
  REJECTED: 'Perlu diperbaiki',
  PENDING_DELETION: 'Sedang dihapus',
  DELETE_FAILED: 'Penghapusan gagal',
  DELETED: 'Telah dihapus',
};

export const scanLabels: Record<DocumentScanStatus, string> = {
  PENDING: 'Menunggu pemindaian',
  CLEAN: 'Aman diperiksa',
  REJECTED: 'File ditolak',
  INFECTED: 'File tidak aman',
  ERROR: 'Pemindaian bermasalah',
};

export const reasonLabels = {
  BLURRY: 'Foto buram',
  GLARE: 'Pantulan cahaya berlebihan',
  CROPPED: 'Dokumen terpotong',
  DOCUMENT_UNREADABLE: 'Dokumen tidak dapat dibaca',
  FACE_MISMATCH: 'Wajah tidak sesuai',
  WRONG_DOCUMENT: 'Dokumen yang diunggah salah',
  OTHER_REQUIRES_NOTE: 'Alasan lain',
} as const;
export type RejectionReason = keyof typeof reasonLabels;

export function kindLabel(kind: DocumentKind) {
  return kind === 'SELFIE' ? 'Selfie' : 'KTP depan';
}

function badgeTone(status: DocumentReviewStatus) {
  if (status === 'APPROVED') return 'success' as const;
  if (status === 'REJECTED' || status === 'PENDING_DELETION') return 'warning' as const;
  if (status === 'DELETE_FAILED') return 'danger' as const;
  return 'neutral' as const;
}

export function ageLabel(value: string | null) {
  if (!value) return 'Waktu tidak tersedia';
  const hours = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 3_600_000));
  if (hours < 24) return `${hours} jam`;
  return `${Math.floor(hours / 24)} hari`;
}

export function SummaryButton({
  label,
  value,
  active,
  tone = 'neutral',
  onClick,
}: {
  label: string;
  value: number;
  active: boolean;
  tone?: 'neutral' | 'danger';
  onClick(): void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-2xl border p-5 sm:p-6 text-left transition duration-200 cursor-pointer ${
        active
          ? 'border-dd-forest bg-dd-forest text-white shadow-dd-soft'
          : tone === 'danger'
            ? 'border-dd-danger/30 bg-dd-danger-soft/80 text-dd-danger hover:border-dd-danger'
            : 'border-dd-line/80 bg-white/95 text-dd-ink hover:border-dd-forest/60 hover:-translate-y-0.5'
      }`}
    >
      <span className="block text-[13px] font-bold opacity-80">{label}</span>
      <strong className="mt-2.5 block text-2xl sm:text-3xl font-bold">
        {(value ?? 0).toLocaleString('id-ID')}
      </strong>
    </button>
  );
}

export function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[][];
  onChange(value: string): void;
}) {
  return (
    <SelectInput
      label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      wrapperClassName="min-w-40"
    >
      <option value="">Semua</option>
      {options.map(([optionValue, optionLabel]) => (
        <option key={optionValue} value={optionValue}>
          {optionLabel}
        </option>
      ))}
    </SelectInput>
  );
}

export function DocumentBadge({ document }: { document?: VerificationDocument }) {
  if (!document) return <Badge tone="neutral">Belum tersedia</Badge>;
  return (
    <div className="flex flex-wrap gap-1">
      <Badge tone={badgeTone(document.status)}>
        {kindLabel(document.kind)} · {statusLabels[document.status]}
      </Badge>
      {document.scanStatus !== 'CLEAN' && (
        <Badge tone="warning">{scanLabels[document.scanStatus]}</Badge>
      )}
    </div>
  );
}

export function DocumentReviewCard({
  document,
  previewUrl,
  previewError,
  previewLoading,
  onPreview,
  onApprove,
  onReject,
  canDelete,
  mayDecide,
  onDelete,
}: {
  document?: VerificationDocument;
  previewUrl?: string;
  previewError?: { title: string; message: string };
  previewLoading: boolean;
  onPreview(document: VerificationDocument): void;
  onApprove(document: VerificationDocument): void;
  onReject(document: VerificationDocument): void;
  canDelete: boolean;
  mayDecide: boolean;
  onDelete(document: VerificationDocument): void;
}) {
  if (!document)
    return (
      <div className="flex min-h-[380px] flex-col items-center justify-center rounded-dd-xl border-2 border-dashed border-dd-line/80 bg-dd-surface-muted/40 p-8 text-center">
        <div className="grid size-12 place-items-center rounded-full bg-white border border-dd-line">
          <ShieldCheck className="size-6 text-dd-muted" />
        </div>
        <strong className="mt-4 block text-base font-semibold text-dd-ink">
          Dokumen belum diunggah
        </strong>
        <p className="mt-1 max-w-xs text-xs text-dd-muted">
          Pelanggan belum mengunggah dokumen aktif untuk bagian ini.
        </p>
      </div>
    );

  const canDecide =
    document.status === 'PENDING' &&
    document.scanStatus === 'CLEAN' &&
    document.uploadStatus === 'FINALIZED';

  const KindIcon = document.kind === 'SELFIE' ? Camera : CreditCard;

  return (
    <div className="flex flex-col justify-between rounded-dd-xl border border-dd-line/80 bg-white p-5 transition-shadow hover:shadow-dd-soft">
      <div className="space-y-4">
        {/* Header Dokumen */}
        <div className="flex items-start justify-between gap-3 border-b border-dd-line/60 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="grid size-9 place-items-center rounded-lg bg-dd-surface-muted border border-dd-line/70 text-dd-forest">
              <KindIcon className="size-4.5" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-dd-ink sm:text-base">
                {kindLabel(document.kind)}
              </h3>
              <p className="text-[11px] font-medium text-dd-muted">
                {(document.sizeBytes / 1024).toFixed(0)} KB · Versi {document.version}
              </p>
            </div>
          </div>
          <Badge tone={badgeTone(document.status)}>{statusLabels[document.status]}</Badge>
        </div>

        {/* Area Preview Gambar */}
        <div className="relative group flex min-h-[240px] max-h-[340px] w-full items-center justify-center overflow-hidden rounded-dd-lg border border-dd-line/80 bg-dd-ink/[0.03]">
          {previewUrl ? (
            <>
              <img
                src={previewUrl}
                alt={`Preview privat ${kindLabel(document.kind)}`}
                onClick={() => window.open(previewUrl, '_blank')}
                className="max-h-[320px] w-full object-contain p-1 rounded-dd-md cursor-pointer transition-transform duration-150 group-hover:scale-[1.01]"
              />
              <Button
                variant="secondary"
                size="sm"
                className="absolute top-2.5 right-2.5 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-dd-ink shadow-sm border border-dd-line backdrop-blur-xs hover:bg-white hover:text-dd-forest"
                leadingIcon={
                  <ExternalLink className="size-3.5 text-dd-forest" aria-hidden="true" />
                }
                onClick={() => window.open(previewUrl, '_blank')}
              >
                Buka Detail
              </Button>
            </>
          ) : previewLoading ? (
            <div className="p-8 text-center">
              <div className="mx-auto mb-2 size-8 animate-spin rounded-full border-2 border-dd-forest border-t-transparent" />
              <p className="text-xs font-semibold text-dd-ink">Memuat Berkas Privat…</p>
              <p className="mt-0.5 text-[11px] text-dd-muted">Mendekripsi data gambar aman</p>
            </div>
          ) : previewError ? (
            <div className="p-6 text-center space-y-3">
              <AlertCircle className="mx-auto size-8 text-dd-danger" />
              <p className="text-xs font-semibold text-dd-danger">
                {previewError.title || 'Gagal memuat preview'}
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="justify-center"
                leadingIcon={<RotateCw className="size-3.5" aria-hidden="true" />}
                onClick={() => void onPreview(document)}
              >
                Coba lagi preview
              </Button>
            </div>
          ) : (
            <div className="p-6 text-center">
              <div className="mx-auto mb-2 grid size-10 place-items-center rounded-full bg-white border border-dd-line">
                <Eye className="size-5 text-dd-muted" />
              </div>
              <p className="text-xs font-semibold text-dd-ink">Preview Aman Terenkripsi</p>
              <p className="mt-0.5 text-[11px] text-dd-muted">
                Dokumen sedang disiapkan untuk peninjauan
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={() => void onPreview(document)}
              >
                Lihat dokumen
              </Button>
            </div>
          )}
        </div>

        {/* Metadata & Tag Lifecycle */}
        <div className="rounded-dd-lg border border-dd-line/70 bg-dd-surface-muted/60 p-3 text-xs">
          <span className="block text-[13px] font-bold text-dd-muted mb-1.5">Status Berkas</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-md border border-dd-line bg-white px-2 py-0.5 text-[11px] font-medium text-dd-ink shadow-2xs">
              Upload: <strong className="font-semibold">{document.uploadStatus}</strong>
            </span>
            <span
              className={`rounded-md border px-2 py-0.5 text-[11px] font-medium shadow-2xs ${
                document.scanStatus === 'CLEAN'
                  ? 'border-dd-success/30 bg-dd-success-soft/80 text-dd-success'
                  : 'border-dd-warning/30 bg-dd-warning-soft text-dd-warning'
              }`}
            >
              Scan: <strong className="font-semibold">{scanLabels[document.scanStatus]}</strong>
            </span>
          </div>
          {document.rejectionReasonCode && (
            <div className="mt-2 rounded-md border border-dd-warning/30 bg-dd-warning-soft/70 p-2 text-[11px] text-dd-warning">
              <strong>Catatan Perbaikan:</strong>{' '}
              {reasonLabels[document.rejectionReasonCode as RejectionReason] ?? 'Perlu perbaikan'}
              {document.rejectionNote && <span> — {document.rejectionNote}</span>}
            </div>
          )}
        </div>

        {document.status === 'DELETE_FAILED' && (
          <AlertBanner
            tone="warning"
            title="Penghapusan gagal"
            message="File belum dapat dihapus. Tindakan dapat dicoba ulang oleh Super Owner."
          />
        )}

        {document.status === 'PENDING' && !canDecide && (
          <AlertBanner
            tone="warning"
            title="Belum dapat diputuskan"
            message="File harus selesai diunggah dan berstatus aman sebelum reviewer mengambil keputusan."
          />
        )}
      </div>

      {/* Baris Tombol Keputusan - Bersih & Rapi Vertikal */}
      <div className="mt-5 space-y-3 pt-3 border-t border-dd-line/60">
        {canDecide && mayDecide && (
          <div className="flex flex-col gap-2.5">
            <Button
              className="w-full justify-center bg-dd-forest hover:bg-dd-forest-dark text-white font-semibold py-2.5 shadow-xs"
              leadingIcon={<CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />}
              onClick={() => onApprove(document)}
            >
              Setujui dokumen
            </Button>
            <Button
              variant="secondary"
              className="w-full justify-center border-dd-warning/30 bg-dd-warning-soft/50 text-dd-warning hover:bg-dd-warning-soft font-semibold py-2.5 shadow-2xs"
              leadingIcon={
                <AlertCircle className="size-4 shrink-0 text-dd-warning" aria-hidden="true" />
              }
              onClick={() => onReject(document)}
            >
              Minta perbaikan
            </Button>
          </div>
        )}

        {canDelete && document.status !== 'DELETED' && (
          <details className="pt-2 text-xs">
            <summary className="cursor-pointer font-semibold text-dd-danger hover:underline">
              Tindakan lanjutan (Penghapusan)
            </summary>
            <Button
              className="mt-2 w-full justify-center"
              variant="danger"
              leadingIcon={<Trash2 className="size-4" aria-hidden="true" />}
              onClick={() => onDelete(document)}
            >
              Hapus file permanen
            </Button>
          </details>
        )}
      </div>
    </div>
  );
}

export function DecisionDialog({
  decision,
  submitting,
  onClose,
  onSubmit,
}: {
  decision?: { document: VerificationDocument; kind: 'approve' | 'reject' };
  submitting: boolean;
  onClose(): void;
  onSubmit(
    document: VerificationDocument,
    kind: 'approve' | 'reject',
    reasonCode?: RejectionReason,
    note?: string,
  ): Promise<void>;
}) {
  const [reason, setReason] = useState<RejectionReason>('BLURRY');
  useEffect(() => {
    if (decision) setReason('BLURRY');
  }, [decision]);
  if (!decision) return null;
  return (
    <Modal
      open
      title={decision.kind === 'approve' ? 'Setujui dokumen' : 'Minta perbaikan dokumen'}
      description={`${kindLabel(decision.document.kind)} · versi ${decision.document.version}`}
      onClose={onClose}
      busy={submitting}
      footer={
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" disabled={submitting} onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" form="verification-decision-form" loading={submitting}>
            {decision.kind === 'approve' ? 'Lanjutkan persetujuan' : 'Lanjutkan perbaikan'}
          </Button>
        </div>
      }
    >
      <form
        id="verification-decision-form"
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void onSubmit(
            decision.document,
            decision.kind,
            decision.kind === 'reject' ? reason : undefined,
            String(data.get('note') ?? ''),
          );
        }}
      >
        {decision.kind === 'reject' && (
          <>
            <SelectInput
              label="Alasan"
              value={reason}
              onChange={(event) => setReason(event.target.value as RejectionReason)}
            >
              {Object.entries(reasonLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectInput>
            <Textarea
              label="Catatan"
              name="note"
              maxLength={500}
              required={reason === 'OTHER_REQUIRES_NOTE'}
              placeholder={
                reason === 'OTHER_REQUIRES_NOTE' ? 'Jelaskan alasan perbaikan' : 'Opsional'
              }
            />
          </>
        )}
        <div className="rounded-dd-md border border-dd-warning/30 bg-dd-warning-soft p-4 text-sm text-dd-warning">
          <AlertTriangle className="mr-2 inline size-4" />
          Keputusan dicatat dalam audit dan memberitahu pelanggan.
        </div>
      </form>
    </Modal>
  );
}
