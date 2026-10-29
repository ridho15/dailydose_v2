'use client';
import { useEffect, useState } from 'react';
import {
  browserOperationsClient,
  operationsFailure,
  type NotificationOccurrence,
  type NotificationOccurrencePage,
  type OperationsClient,
} from '@/api-clients/operations-client';
import { reminderClient, type AutoCancelResult } from '@/api-clients/reminder-client';
import { EmptyState, Feedback, Skeleton, StatusBadge } from '../ui';
import { AdminPageHeader } from '../components/admin/admin-page-header';
import { useSessionContext } from '../session-context';
import { Button } from '../components/actions';
import { useAppFeedback } from '../components/app-feedback';
import {
  Badge,
  DataTable,
  FilterBar,
  Pagination,
  Panel,
  StatCard,
} from '../components/admin/admin-ui';
import { SelectInput, TextInput } from '../components/forms';
import { pageOffset } from '../lib/pagination';

const statusLabel: Record<string, string> = {
  PENDING: 'Menunggu',
  SENDING: 'Sedang dikirim',
  ACCEPTED_BY_SMTP: 'Diterima server email',
  FAILED_RETRYABLE: 'Gagal—dapat dicoba lagi',
  FAILED_TERMINAL: 'Gagal permanen',
  EXPIRED: 'Kedaluwarsa',
  FALLBACK_IN_APP: 'Dialihkan ke notifikasi aplikasi',
};

const formatStart = (value: string) =>
  new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export function OperationsView({
  client = browserOperationsClient,
  evaluator = reminderClient,
  access,
}: {
  client?: OperationsClient;
  evaluator?: { triggerAutoCancel(): Promise<AutoCancelResult> };
  /** Menimpa izin dari sesi (dipakai tes): pemulihan email dan menjalankan evaluasi kuota. */
  access?: { canRecover?: boolean; canRunEvaluation?: boolean };
}) {
  const feedback = useAppFeedback();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [emailPage, setEmailPage] = useState<NotificationOccurrencePage>();
  const [emailStatusFilter, setEmailStatusFilter] = useState('');
  const [emailCursor, setEmailCursor] = useState<string>();
  const [emailCursorHistory, setEmailCursorHistory] = useState<(string | undefined)[]>([]);
  const [emailRetryReason, setEmailRetryReason] = useState('');
  const [evaluating, setEvaluating] = useState(false);
  const [evaluation, setEvaluation] = useState<AutoCancelResult>();
  const [evaluationFailure, setEvaluationFailure] = useState<string>();
  const sessionContext = useSessionContext();
  const session = sessionContext?.status === 'authenticated' ? sessionContext : undefined;
  const canRecover = access?.canRecover ?? session?.hasCapability('operations:recover') ?? false;
  const canRunEvaluation =
    access?.canRunEvaluation ?? session?.hasCapability('automation:run') ?? false;
  const run = async (action: () => Promise<void>, success: string) => {
    setBusy(true);
    setFailure(undefined);
    try {
      await action();
      setMessage(success);
    } catch (error) {
      setFailure(operationsFailure(error));
    } finally {
      setBusy(false);
    }
  };
  const runEvaluation = async () => {
    const accepted = await feedback.confirm({
      tone: 'warning',
      title: 'Jalankan evaluasi kuota H-24?',
      message:
        'Kelas yang kuotanya belum terpenuhi akan dibatalkan, reservasi pesertanya dilepas, dan peserta serta instruktur diberi tahu lewat WhatsApp. Tindakan ini tidak dapat dibatalkan.',
      confirmLabel: 'Jalankan evaluasi',
    });
    if (!accepted) return;
    setEvaluating(true);
    setEvaluationFailure(undefined);
    try {
      setEvaluation(await evaluator.triggerAutoCancel());
    } catch (error) {
      setEvaluation(undefined);
      setEvaluationFailure(operationsFailure(error));
    } finally {
      setEvaluating(false);
    }
  };
  useEffect(() => {
    if (!client.listEmails) return;
    let active = true;
    setBusy(true);
    setFailure(undefined);
    client
      .listEmails(emailStatusFilter || undefined, emailCursor)
      .then((email) => {
        if (active) setEmailPage(email);
      })
      .catch((error) => {
        if (active) setFailure(operationsFailure(error));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [client, emailCursor, emailStatusFilter]);
  return (
    <section className="space-y-6" aria-labelledby="operations-title">
      <AdminPageHeader
        title="Operasional"
        titleId="operations-title"
        description="Jalankan evaluasi kuota H-24 dan pantau pengiriman email transaksional."
        badges={<StatusBadge tone="info">Ops / Super Owner</StatusBadge>}
      />
      <Panel className="space-y-4 p-6 sm:p-8">
        <div>
          <p className="text-[13px] font-bold text-dd-muted">Kelas</p>
          <h2 className="mt-2 text-2xl font-semibold text-dd-ink">Evaluasi kuota H-24</h2>
          <p className="mt-2 text-sm text-dd-muted">
            Kelas yang sudah masuk batas konfirmasi diperiksa: kuota terpenuhi → dikonfirmasi; kurang
            dari minimum → dibatalkan otomatis, reservasi dilepas, dan peserta serta instruktur
            diberi tahu lewat WhatsApp. Evaluasi dijalankan manual dari sini atau dari halaman
            Reminder.
          </p>
        </div>
        {canRunEvaluation ? (
          <div>
            <Button loading={evaluating} disabled={evaluating} onClick={() => void runEvaluation()}>
              Jalankan evaluasi sekarang
            </Button>
          </div>
        ) : (
          <Feedback kind="info">
            Anda dapat melihat halaman ini, tetapi menjalankan evaluasi memerlukan izin otomasi.
          </Feedback>
        )}
        {evaluationFailure && <Feedback kind="error">{evaluationFailure}</Feedback>}
        {evaluation?.skipped && (
          <Feedback kind="warning">
            Evaluasi otomatis dinonaktifkan di lingkungan ini, jadi tidak ada kelas yang diperiksa.
            Hubungi administrator sistem bila ini tidak diharapkan.
          </Feedback>
        )}
        {evaluation && !evaluation.skipped && (
          <div className="space-y-3" role="status" aria-live="polite">
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard label="Kelas diperiksa" value={String(evaluation.evaluatedSlotsCount)} />
              <StatCard
                label="Dikonfirmasi"
                value={String(evaluation.confirmedSlotsCount)}
                tone="success"
              />
              <StatCard
                label="Dibatalkan"
                value={String(evaluation.cancelledSlotsCount)}
                tone={evaluation.cancelledSlotsCount > 0 ? 'warning' : undefined}
              />
            </div>
            {evaluation.cancelledSlots.length === 0 ? (
              <p className="m-0 text-sm text-dd-muted">Tidak ada kelas yang dibatalkan pada evaluasi ini.</p>
            ) : (
              <ul className="m-0 grid list-none gap-2 p-0">
                {evaluation.cancelledSlots.map((item) => (
                  <li
                    key={item.slotId}
                    className="rounded-dd-md border border-dd-line bg-dd-surface-muted p-3 text-sm"
                  >
                    <strong>{item.className}</strong> · {item.branchName} · {formatStart(item.startAt)}
                    <span className="block text-xs text-dd-muted">
                      {item.bookedCount} dari minimum {item.minQuota} peserta ·{' '}
                      {item.refundedBookingsCount} reservasi dilepas
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Panel>
      {busy && <Skeleton label="Memuat pengiriman email" />}
      {failure && <Feedback kind="error">{failure}</Feedback>}
      {message && !busy && <Feedback kind="status">{message}</Feedback>}
      <Panel className="p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[13px] font-bold text-dd-muted">
              Email transaksional
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-dd-ink">Pengiriman email</h2>
            <p className="mt-2 text-sm text-dd-muted">
              Penerima tetap dimasking dan percobaan ulang manual selalu masuk audit.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone="info">SMTP terkonfigurasi</StatusBadge>
            <StatusBadge tone="warning">Kegagalan terlihat</StatusBadge>
          </div>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="Pending" value={String(emailPage?.metrics.pendingCount ?? 0)} />
          <StatCard
            label="Accepted"
            value={`${((emailPage?.metrics.acceptedRateBasisPoints ?? 0) / 100).toFixed(2)}%`}
            tone="success"
          />
          <StatCard
            label="Terminal"
            value={String(emailPage?.metrics.terminalFailureCount ?? 0)}
            tone="warning"
          />
          <StatCard label="Percobaan ulang" value={String(emailPage?.metrics.retryCount ?? 0)} />
          <StatCard
            label="Queue age"
            value={`${emailPage?.metrics.queueAgeSeconds ?? 0}s`}
            helper={`Rate-limit waits: ${emailPage?.metrics.rateLimitWaitCount ?? 0}`}
          />
        </div>
      </Panel>
      <FilterBar>
        <SelectInput
          label="Filter status email"
          aria-label="Filter status email"
          value={emailStatusFilter}
          onChange={(event) => {
            setEmailStatusFilter(event.target.value);
            setEmailCursor(undefined);
            setEmailCursorHistory([]);
          }}
        >
          <option value="">Semua status</option>
          {[
            'PENDING',
            'SENDING',
            'ACCEPTED_BY_SMTP',
            'FAILED_RETRYABLE',
            'FAILED_TERMINAL',
            'EXPIRED',
            'FALLBACK_IN_APP',
          ].map((status) => (
            <option key={status} value={status}>
              {statusLabel[status]}
            </option>
          ))}
        </SelectInput>
        <TextInput
          label="Alasan mencoba kembali"
          aria-label="Alasan mencoba kembali pengiriman email"
          value={emailRetryReason}
          onChange={(event) => setEmailRetryReason(event.target.value)}
          placeholder="Contoh: konfigurasi email sudah diperbaiki"
        />
      </FilterBar>
      {emailPage && emailPage.items.length === 0 ? (
        <EmptyState
          title="Belum ada delivery email"
          description="Ubah filter atau muat ulang antrean."
        />
      ) : emailPage ? (
        <DataTable
          rowNumberOffset={pageOffset(emailCursorHistory.length)}
          items={emailPage.items}
          rowKey={(item) => item.id}
          columns={[
            {
              id: 'status',
              header: 'Status',
              cell: (item) => (
                <Badge
                  tone={
                    item.status === 'ACCEPTED_BY_SMTP'
                      ? 'success'
                      : ['FAILED_TERMINAL', 'FALLBACK_IN_APP', 'EXPIRED'].includes(item.status)
                        ? 'danger'
                        : 'warning'
                  }
                >
                  {statusLabel[item.status] ?? 'Status tidak dikenal'}
                </Badge>
              ),
            },
            {
              id: 'recipient',
              header: 'Penerima',
              cell: (item) => item.recipientMasked,
            },
            { id: 'event', header: 'Peristiwa', cell: (item) => humanizeEvent(item.eventType) },
            {
              id: 'attempt',
              header: 'Percobaan',
              cell: (item) => `${item.attemptCount}/${item.maxAttempts}`,
            },
            {
              id: 'action',
              header: 'Pemulihan',
              cell: (item) => (
                <Button
                  variant="secondary"
                  disabled={
                    busy ||
                    !canRecover ||
                    !client.retryEmail ||
                    emailRetryReason.trim().length < 3 ||
                    !['FAILED_TERMINAL', 'FAILED_RETRYABLE', 'FALLBACK_IN_APP'].includes(
                      item.status,
                    )
                  }
                  onClick={() =>
                    void run(async () => {
                      if (!client.retryEmail) return;
                      const result = await client.retryEmail(item.id, emailRetryReason.trim());
                      setEmailPage((current) =>
                        current
                          ? {
                              ...current,
                              items: current.items.map((delivery) =>
                                delivery.id === item.id
                                  ? ({
                                      ...delivery,
                                      status: result.status,
                                      nextAttemptAt: result.nextAttemptAt,
                                    } as NotificationOccurrence)
                                  : delivery,
                              ),
                            }
                          : current,
                      );
                    }, 'Pengiriman ulang email dijadwalkan.')
                  }
                >
                  Coba kirim kembali
                </Button>
              ),
            },
          ]}
          mobileCard={(item) => (
            <div>
              <div className="flex items-center justify-between gap-3">
                <Badge tone={item.status === 'ACCEPTED_BY_SMTP' ? 'success' : 'warning'}>
                  {statusLabel[item.status] ?? 'Status tidak dikenal'}
                </Badge>
                <span className="text-xs text-dd-muted">{item.recipientMasked}</span>
              </div>
              <p className="mt-3 break-all text-sm">{humanizeEvent(item.eventType)}</p>
              <p className="mt-1 text-xs text-dd-muted">
                {item.attemptCount}/{item.maxAttempts} percobaan · {item.rateLimitWaitCount} jeda
              </p>
            </div>
          )}
        />
      ) : null}
      {emailPage && (
        <Pagination
          hasPrevious={emailCursorHistory.length > 0}
          hasNext={Boolean(emailPage.page.nextCursor)}
          currentPage={emailCursorHistory.length + 1}
          onPrevious={() => {
            const history = [...emailCursorHistory];
            setEmailCursor(history.pop());
            setEmailCursorHistory(history);
          }}
          onNext={() => {
            const next = emailPage.page.nextCursor;
            if (!next) return;
            setEmailCursorHistory((current) => [...current, emailCursor]);
            setEmailCursor(next);
          }}
        />
      )}
    </section>
  );
}

function humanizeEvent(value: string) {
  return value.replace(/[._-]+/gu, ' ').replace(/\b\w/gu, (character) => character.toUpperCase());
}
