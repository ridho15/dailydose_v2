'use client';

import { ArrowLeft, CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { browserLedgerClient, ledgerFailure, type Adjustment } from '@/api-clients/ledger-client';
import { Button, ButtonLink } from '../../../components/actions';
import { Modal, useAppFeedback } from '../../../components/app-feedback';
import { SelectInput, Textarea } from '../../../components/forms';
import { Badge, Panel, StatCard } from '../../../components/admin/admin-ui';
import { EmptyState, Feedback, Skeleton } from '../../../ui';
import { AdminPageHeader } from '../../../components/admin/admin-page-header';
import { useSessionContext } from '../../../session-context';

const statusCopy = {
  PENDING: { label: 'Menunggu keputusan', tone: 'warning' as const },
  POSTED: { label: 'Diposting ke ledger', tone: 'success' as const },
  REJECTED: { label: 'Ditolak', tone: 'danger' as const },
};

const reasonCopy: Record<string, string> = {
  MIGRATION_CORRECTION: 'Koreksi migrasi',
  ATTENDANCE_CORRECTION: 'Koreksi kehadiran',
  PACKAGE_COMPENSATION: 'Kompensasi paket',
  SUPPORT_RECONCILIATION: 'Rekonsiliasi bantuan',
  CORRECTION_VERIFIED: 'Koreksi telah diverifikasi',
  INVALID_EVIDENCE: 'Bukti tidak valid',
  DUPLICATE_REQUEST: 'Permintaan duplikat',
  OUT_OF_SCOPE: 'Di luar cakupan',
};

const formatDate = (value?: Date | null) =>
  value
    ? new Intl.DateTimeFormat('id-ID', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Jakarta',
      }).format(value)
    : '—';

export function SessionAdjustmentDetailView({ id }: { id: string }) {
  const searchParams = useSearchParams();
  const requestedReturnTo = searchParams.get('returnTo');
  const returnTo =
    requestedReturnTo?.startsWith('/ledger/adjustments') && !requestedReturnTo.startsWith('//')
      ? requestedReturnTo
      : '/ledger/adjustments';
  const session = useSessionContext();
  const feedback = useAppFeedback();
  const [item, setItem] = useState<Adjustment>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [decisionIntent, setDecisionIntent] = useState<'approve' | 'reject'>();
  const [decisionReason, setDecisionReason] = useState('CORRECTION_VERIFIED');
  const [decisionNote, setDecisionNote] = useState('');
  const decisionKeys = useRef(new Map<string, string>());
  const canDecide = Boolean(session?.hasCapability('ledger:adjust:decide'));

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItem(await browserLedgerClient.getAdjustment(id));
    } catch (cause) {
      setError(await ledgerFailure(cause));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => void load(), [load]);

  const decide = async () => {
    if (!item || !decisionIntent) return;
    const decision = decisionIntent;
    const reasonCode = decisionReason;
    const accepted = await feedback.confirm({
      tone: decision === 'approve' ? 'warning' : 'danger',
      title: decision === 'approve' ? 'Setujui penyesuaian sesi?' : 'Tolak penyesuaian sesi?',
      message: `${item.customer?.displayName ?? 'Pelanggan'} · perubahan ${item.quantity > 0 ? '+' : ''}${item.quantity} sesi · saldo tersedia diproyeksikan menjadi ${item.projectedAvailable ?? '—'} sesi. Keputusan dicatat pada audit trail.`,
      confirmLabel: decision === 'approve' ? 'Setujui dan posting' : 'Tolak permintaan',
    });
    if (!accepted) return;
    setBusy(true);
    setError('');
    try {
      const signature = `${item.id}:${decision}:${item.version}:${reasonCode}`;
      const key = decisionKeys.current.get(signature) ?? crypto.randomUUID();
      decisionKeys.current.set(signature, key);
      await browserLedgerClient.decideAdjustment(
        item.id,
        decision,
        { reasonCode, note: decisionNote.trim() || undefined, expectedVersion: item.version },
        key,
      );
      decisionKeys.current.delete(signature);
      setDecisionIntent(undefined);
      setDecisionNote('');
      await load();
      feedback.showToast({
        tone: 'success',
        title: decision === 'approve' ? 'Penyesuaian diposting' : 'Permintaan ditolak',
        message: 'Saldo dan status terbaru telah dimuat ulang.',
      });
    } catch (cause) {
      setError(await ledgerFailure(cause));
    } finally {
      setBusy(false);
    }
  };

  if (loading && !item) return <Skeleton label="Memuat detail penyesuaian sesi" />;
  if (!item)
    return (
      <div className="space-y-4">
        <EmptyState
          title="Penyesuaian tidak tersedia"
          description={error || 'Data tidak ditemukan atau berada di luar cakupan cabang Anda.'}
        />
        <div className="text-center">
          <Button onClick={() => void load()}>Coba lagi</Button>
        </div>
      </div>
    );

  const status = statusCopy[item.status];
  return (
    <section className="space-y-6" aria-labelledby="adjustment-detail-title">
      <ButtonLink
        href={returnTo}
        variant="ghost"
        leadingIcon={<ArrowLeft className="size-4" aria-hidden="true" />}
      >
        Kembali ke Penyesuaian Sesi
      </ButtonLink>
      <AdminPageHeader
        title={item.customer?.displayName ?? 'Pelanggan'}
        titleId="adjustment-detail-title"
        description={`${item.package?.name ?? 'Paket'} · ${item.branch?.name ?? 'Cabang'} · ${item.classType?.name ?? 'Tipe kelas'}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={status.tone}>{status.label}</Badge>
            <Button
              variant="secondary"
              loading={loading}
              leadingIcon={<RefreshCw className="size-4" aria-hidden="true" />}
              onClick={() => void load()}
            >
              Perbarui
            </Button>
          </div>
        }
      />
      {error && <Feedback kind="error">{error}</Feedback>}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Dampak penyesuaian">
        <StatCard label="Saldo saat diminta" value={String(item.ledgerBalanceAtRequest ?? '—')} />
        <StatCard
          label="Perubahan"
          value={`${item.quantity > 0 ? '+' : ''}${item.quantity}`}
          tone="warning"
        />
        <StatCard label="Saldo sekarang" value={String(item.currentBalance ?? '—')} />
        <StatCard
          label="Proyeksi tersedia"
          value={String(item.projectedAvailable ?? '—')}
          tone="success"
        />
      </section>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel className="p-5 sm:p-6">
          <h2 className="text-lg font-bold text-dd-ink">Rincian permintaan</h2>
          <dl className="mt-5 grid gap-4 sm:grid-cols-2">
            <Detail label="Alasan" value={reasonCopy[item.reasonCode] ?? 'Alasan tercatat'} />
            <Detail label="Diminta oleh" value={item.requestedBy?.displayName ?? 'Data legacy'} />
            <Detail label="Waktu permintaan" value={formatDate(item.createdAt)} />
            <Detail label="Sesi tertahan" value={String(item.currentReserved ?? '—')} />
            <Detail
              label="Diputuskan oleh"
              value={item.decidedBy?.displayName ?? 'Belum diputuskan'}
            />
            <Detail label="Waktu keputusan" value={formatDate(item.decidedAt)} />
            <Detail
              label="Alasan keputusan"
              value={item.decisionCode ? (reasonCopy[item.decisionCode] ?? 'Alasan tercatat') : '—'}
            />
            <Detail label="Catatan keputusan" value={item.decisionNote || 'Tidak ada catatan'} />
            <Detail label="Referensi audit" value={item.auditReference || 'Belum tersedia'} />
          </dl>
        </Panel>
        <Panel className="self-start p-5 sm:p-6">
          <h2 className="text-lg font-bold text-dd-ink">Keputusan</h2>
          {item.status !== 'PENDING' ? (
            <p className="mt-3 text-sm leading-6 text-dd-muted">
              Permintaan telah diputuskan dan tidak dapat dimutasi kembali.
            </p>
          ) : !canDecide ? (
            <p className="mt-3 text-sm leading-6 text-dd-muted">
              Akun Anda memiliki akses baca. Keputusan dilakukan Manager atau Super Owner.
            </p>
          ) : (
            <div className="mt-4 grid gap-2">
              {Boolean(item.requestedBy?.id && session?.session?.id && item.requestedBy.id === session.session.id) && (
                <div className="rounded-dd-md border border-dd-warning/30 bg-dd-warning-soft p-3 text-xs text-dd-warning mb-2">
                  <strong className="block font-semibold">Pemeriksaan Silang Staf:</strong>
                  Anda mengajukan permohonan ini. Untuk menjaga transparansi, persetujuan harus dilakukan oleh staf atau manajer lain.
                </div>
              )}
              {item.status === 'PENDING' && item.eligibleForApproval === false && (
                <div className="rounded-dd-md border border-dd-danger/30 bg-dd-danger-soft p-3 text-xs text-dd-danger mb-2">
                  <strong className="block font-semibold">Tidak Dapat Disetujui:</strong>
                  Saldo paket saat ini tidak mencukupi untuk pengurangan sesi yang diminta (atau masih ada sesi yang tertahan/direservasi).
                </div>
              )}
              <Button
                loading={busy}
                disabled={item.eligibleForApproval === false || Boolean(item.requestedBy?.id && session?.session?.id && item.requestedBy.id === session.session.id)}
                leadingIcon={<CheckCircle2 className="size-4" aria-hidden="true" />}
                onClick={() => {
                  setDecisionReason('CORRECTION_VERIFIED');
                  setDecisionIntent('approve');
                }}
              >
                Setujui dan posting
              </Button>
              <Button
                variant="danger"
                disabled={busy || Boolean(item.requestedBy?.id && session?.session?.id && item.requestedBy.id === session.session.id)}
                leadingIcon={<XCircle className="size-4" aria-hidden="true" />}
                onClick={() => {
                  setDecisionReason('INVALID_EVIDENCE');
                  setDecisionIntent('reject');
                }}
              >
                Tolak permintaan
              </Button>
            </div>
          )}
        </Panel>
      </div>
      <Modal
        open={Boolean(decisionIntent)}
        title={decisionIntent === 'approve' ? 'Setujui penyesuaian sesi' : 'Tolak penyesuaian sesi'}
        description="Pilih alasan dan tinjau dampak saldo sebelum mengonfirmasi."
        busy={busy}
        dirty={Boolean(decisionNote)}
        onClose={() => {
          setDecisionIntent(undefined);
          setDecisionNote('');
        }}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setDecisionIntent(undefined)}
            >
              Batal
            </Button>
            <Button
              variant={decisionIntent === 'reject' ? 'danger' : 'primary'}
              loading={busy}
              onClick={() => void decide()}
            >
              Konfirmasi keputusan
            </Button>
          </div>
        }
      >
        <div className="grid gap-4">
          <SelectInput
            label="Alasan keputusan"
            value={decisionReason}
            onChange={(event) => setDecisionReason(event.target.value)}
          >
            {(decisionIntent === 'approve'
              ? ['CORRECTION_VERIFIED']
              : ['INVALID_EVIDENCE', 'DUPLICATE_REQUEST', 'OUT_OF_SCOPE']
            ).map((code) => (
              <option key={code} value={code}>
                {reasonCopy[code]}
              </option>
            ))}
          </SelectInput>
          <Textarea
            label="Catatan keputusan (opsional)"
            value={decisionNote}
            maxLength={500}
            onChange={(event) => setDecisionNote(event.target.value)}
          />
        </div>
      </Modal>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-dd-md bg-dd-surface-muted p-4">
      <dt className="text-[13px] font-bold text-dd-muted">{label}</dt>
      <dd className="mt-2 text-sm font-semibold text-dd-ink">{value}</dd>
    </div>
  );
}
