'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTrackedRouter } from '../../components/app-loading';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import {
  browserLedgerClient,
  ledgerFailure,
  manageCustomerPackage,
  packageActionFailure,
  type CustomerPackageAction,
  type LedgerHistory,
} from '@/api-clients/ledger-client';
import { Button, ButtonLink } from '../../components/actions';
import { Badge, Pagination, Panel, StatCard } from '../../components/admin/admin-ui';
import { EmptyState, Feedback, Skeleton } from '../../ui';
import { AdminPageHeader } from '../../components/admin/admin-page-header';
import { ReasonDialog } from '../../components/admin/reason-dialog';
import { DateInput, TextInput } from '../../components/forms';
import { useSessionContext } from '../../session-context';
import { SharedPackageMembersDialog } from '../../components/shared-package-members-dialog';

const ledgerLabels: Record<string, string> = {
  PURCHASE: 'Aktivasi paket',
  MIGRATION_OPENING: 'Saldo awal migrasi',
  ATTEND: 'Pemakaian sesi',
  REVERSAL: 'Pengembalian sesi',
  ADJUST_MANUAL: 'Penyesuaian manual',
};

const formatDate = (value: Date, withTime = false) =>
  new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' as const } : {}),
    timeZone: 'Asia/Jakarta',
  }).format(value);

export function CustomerSessionDetailView({ id }: { id: string }) {
  const searchParams = useSearchParams();
  const router = useTrackedRouter();
  const requestedReturnTo = searchParams.get('returnTo');
  const returnTo =
    requestedReturnTo?.startsWith('/ledger') && !requestedReturnTo.startsWith('//')
      ? requestedReturnTo
      : '/ledger';
  const [cursor, setCursor] = useState(searchParams.get('cursor') ?? '');
  const [history, setHistory] = useState<LedgerHistory>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const sessionContext = useSessionContext();
  const canManagePackage = Boolean(sessionContext?.hasCapability('customer-package:manage'));
  const [action, setAction] = useState<CustomerPackageAction | null>(null);
  const [days, setDays] = useState('30');
  const [targetDate, setTargetDate] = useState('');
  const [extendMode, setExtendMode] = useState<'date' | 'days'>('date');
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [manageMembersOpen, setManageMembersOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setHistory(await browserLedgerClient.detail(id, cursor || undefined));
    } catch (cause) {
      setError(await ledgerFailure(cause));
    } finally {
      setLoading(false);
    }
  }, [cursor, id]);

  useEffect(() => void load(), [load]);

  const runAction = async (reason: string) => {
    if (!action || !history) return;
    setActing(true);
    setActionError('');
    try {
      const payload: { reason: string; days?: number; newValidUntil?: string; expectedValidUntil?: string } = {
        reason,
        expectedValidUntil: history.balance.expiryAt.toISOString(),
      };
      if (action === 'extend') {
        if (extendMode === 'date' && targetDate) {
          payload.newValidUntil = new Date(`${targetDate}T23:59:59.999Z`).toISOString();
        } else {
          payload.days = Number(days);
        }
      }
      await manageCustomerPackage(id, action, payload);
      setAction(null);
      setNotice(
        action === 'extend'
          ? 'Masa berlaku paket diperpanjang.'
          : action === 'freeze'
            ? 'Paket dibekukan.'
            : 'Paket dibuka kembali.',
      );
      await load();
    } catch (cause) {
      setActionError(packageActionFailure(cause));
    } finally {
      setActing(false);
    }
  };

  const changePage = (nextCursor: string) => {
    setLoadingMore(true);
    setCursor(nextCursor);
    const query = new URLSearchParams(searchParams.toString());
    if (nextCursor) query.set('cursor', nextCursor);
    else query.delete('cursor');
    router.replace(`/ledger/${id}?${query.toString()}`, { scroll: false });
  };
  useEffect(() => {
    if (!loading) setLoadingMore(false);
  }, [loading]);

  if (loading && !history) return <Skeleton label="Memuat detail sesi pelanggan" />;
  if (!history)
    return (
      <div className="space-y-4">
        <EmptyState
          title="Detail sesi belum tersedia"
          description={error || 'Paket pelanggan tidak ditemukan atau berada di luar cakupan Anda.'}
        />
        <div className="text-center">
          <Button onClick={() => void load()}>Coba lagi</Button>
        </div>
      </div>
    );

  const { balance } = history;
  return (
    <section className="space-y-6" aria-labelledby="customer-session-detail-title">
      <ButtonLink
        variant="ghost"
        href={returnTo}
        leadingIcon={<ArrowLeft className="size-4" aria-hidden="true" />}
      >
        Kembali ke Sesi Pelanggan
      </ButtonLink>
      <AdminPageHeader
        title={balance.packageName ?? 'Paket pelanggan'}
        titleId="customer-session-detail-title"
        description={`${balance.customer?.displayName ?? 'Pelanggan'} · ${balance.branchName ?? 'Cabang'} · ${balance.classTypeName ?? 'Tipe kelas'}`}
        actions={
          <Button
            variant="secondary"
            leadingIcon={<RefreshCw className="size-4" aria-hidden="true" />}
            onClick={() => void load()}
          >
            Perbarui
          </Button>
        }
      />
      {error && <Feedback kind="error">{error}</Feedback>}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Saldo sesi">
        <StatCard
          label="Sesi awal"
          value={String(balance.usage?.initialSessions ?? balance.sessionCountSnapshot ?? 0)}
        />
        <StatCard label="Sesi terpakai" value={String(balance.usage?.usedSessions ?? 0)} />
        <StatCard label="Sesi tertahan" value={String(balance.reserved)} tone="warning" />
        <StatCard label="Sesi tersedia" value={String(balance.available)} tone="success" />
      </section>
      <Panel className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-dd-ink">Status paket</h2>
            <p className="mt-1 text-sm text-dd-muted">
              Aktif {formatDate(balance.activationDate)} · berakhir {formatDate(balance.expiryAt)}
            </p>
          </div>
          <Badge
            tone={
              balance.status === 'ACTIVE'
                ? 'success'
                : balance.status === 'FROZEN'
                  ? 'warning'
                  : 'neutral'
            }
          >
            {balance.status === 'ACTIVE'
              ? 'Aktif'
              : balance.status === 'EXPIRED'
                ? 'Berakhir'
                : balance.status === 'FROZEN'
                  ? 'Dibekukan'
                  : 'Tidak aktif'}
          </Badge>
        </div>
        {notice && (
          <div className="mt-4">
            <Feedback kind="status">{notice}</Feedback>
          </div>
        )}
        {canManagePackage && (
          <div className="mt-4 flex flex-wrap gap-2" aria-label="Kelola paket">
            {balance.status !== 'FROZEN' && balance.ledgerBalance > 0 && (
              <Button
                variant="secondary"
                data-testid="btn-open-extend-dialog"
                onClick={() => {
                  const base = Math.max(new Date(balance.expiryAt).getTime(), Date.now());
                  const defaultNext = new Date(base + 30 * 86400000).toISOString().slice(0, 10);
                  setTargetDate(defaultNext);
                  setDays('30');
                  setExtendMode('date');
                  setAction('extend');
                }}
              >
                Perpanjang masa berlaku
              </Button>
            )}
            {balance.status === 'ACTIVE' && (
              <Button variant="secondary" onClick={() => setAction('freeze')}>
                Bekukan paket
              </Button>
            )}
            {balance.status === 'FROZEN' && (
              <Button variant="secondary" onClick={() => setAction('unfreeze')}>
                Buka kembali paket
              </Button>
            )}
            {balance.isShareable && (
              <Button variant="secondary" onClick={() => setManageMembersOpen(true)}>
                Kelola Anggota Bersama ({balance.sharedMembers?.length ?? 0})
              </Button>
            )}
          </div>
        )}
        {balance.customer?.id && (
          <ButtonLink className="mt-4" variant="secondary" href={`/users/${balance.customer.id}`}>
            Buka detail pelanggan
          </ButtonLink>
        )}
      </Panel>
      {balance.isShareable && (
        <Panel className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-dd-ink">Anggota Bersama (Family / Duet)</h2>
                <Badge tone="success">Paket Bersama</Badge>
              </div>
              <p className="mt-1 text-sm text-dd-muted">
                Pemilik dan anggota terdaftar berbagi kuota {balance.available} sesi yang tersedia.
              </p>
            </div>
            {canManagePackage && (
              <Button variant="secondary" size="sm" onClick={() => setManageMembersOpen(true)}>
                Kelola Anggota
              </Button>
            )}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-dd-sm border border-dd-line bg-dd-surface-muted/20 p-3">
              <span className="text-xs font-bold text-dd-muted uppercase">Pemilik Utama</span>
              <p className="text-sm font-semibold text-dd-ink">{balance.customer?.displayName}</p>
              <p className="text-xs text-dd-muted">{balance.customer?.phoneMasked}</p>
            </div>
            {(balance.sharedMembers ?? []).map((m) => (
              <div key={m.id} className="rounded-dd-sm border border-dd-line bg-white p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-dd-forest uppercase">Anggota Terdaftar</span>
                  <Badge tone="neutral">{m.relationship || 'FAMILY'}</Badge>
                </div>
                <p className="text-sm font-semibold text-dd-ink mt-0.5">{m.displayName}</p>
                <p className="text-xs text-dd-muted">{m.phoneMasked}</p>
              </div>
            ))}
          </div>
        </Panel>
      )}
      <Panel className="overflow-hidden">
        <div className="border-b border-dd-line px-5 py-4">
          <h2 className="font-semibold text-dd-ink">Reservation aktif</h2>
          <p className="mt-1 text-sm text-dd-muted">
            Sesi yang sedang ditahan oleh booking mendatang.
          </p>
        </div>
        {history.reservations.items.length === 0 ? (
          <p className="px-5 py-4 text-sm text-dd-muted">Tidak ada sesi yang sedang ditahan.</p>
        ) : (
          <ul className="divide-y divide-dd-line">
            {history.reservations.items.map((reservation) => (
              <li
                key={reservation.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
              >
                <div>
                  <strong className="text-sm text-dd-ink">
                    {reservation.className ?? 'Booking kelas'}
                  </strong>
                  <p className="mt-1 text-xs text-dd-muted">
                    {reservation.branchName ?? 'Cabang'} ·{' '}
                    {reservation.startsAt
                      ? formatDate(reservation.startsAt, true)
                      : 'Jadwal tidak tersedia'}
                  </p>
                </div>
                {reservation.bookingId ? (
                  <ButtonLink variant="ghost" href={`/bookings/${reservation.bookingId}`}>
                    Lihat booking
                  </ButtonLink>
                ) : (
                  <Badge tone="warning">{reservation.quantity} sesi tertahan</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel className="overflow-hidden">
        <div className="border-b border-dd-line px-5 py-4">
          <h2 className="font-semibold text-dd-ink">Histori penggunaan sesi</h2>
          <p className="mt-1 text-sm text-dd-muted">
            Urutan terbaru berdasarkan catatan sesi resmi.
          </p>
        </div>
        {history.entries.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="Belum ada histori"
              description="Perubahan sesi akan tampil di sini."
            />
          </div>
        ) : (
          <ol className="divide-y divide-dd-line">
            {history.entries.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
              >
                <div>
                  <strong className="text-sm text-dd-ink">
                    {ledgerLabels[entry.type] ?? 'Perubahan sesi'}
                  </strong>
                  <p className="mt-1 text-xs text-dd-muted">
                    {entry.referenceLabel ?? 'Perubahan sesi'} ·{' '}
                    {formatDate(entry.occurredAt, true)}
                    {entry.balanceAfter !== null && entry.balanceAfter !== undefined
                      ? ` · saldo setelah transaksi ${entry.balanceAfter}`
                      : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <strong className={entry.quantity >= 0 ? 'text-dd-success' : 'text-dd-danger'}>
                    {entry.quantity > 0 ? `+${entry.quantity}` : entry.quantity} sesi
                  </strong>
                  {entry.bookingId && (
                    <ButtonLink variant="ghost" href={`/bookings/${entry.bookingId}`}>
                      Booking
                    </ButtonLink>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
        <div className="border-t border-dd-line p-4">
          <Pagination
            hasPrevious={cursor !== ''}
            hasNext={Boolean(history.nextCursor)}
            totalLabel={loadingMore ? 'Memuat halaman…' : 'Histori penggunaan sesi'}
            onPrevious={() => changePage(history.previousCursor ?? '')}
            onNext={() => history.nextCursor && changePage(history.nextCursor)}
          />
        </div>
      </Panel>
      <ReasonDialog
        open={action !== null}
        title={
          action === 'extend'
            ? 'Perpanjang masa berlaku paket'
            : action === 'freeze'
              ? 'Bekukan paket pelanggan?'
              : 'Buka kembali paket pelanggan?'
        }
        description={
          action === 'extend'
            ? 'Masa berlaku bertambah dari tanggal berakhir saat ini (atau dari hari ini bila sudah lewat). Saldo sesi tidak berubah.'
            : action === 'freeze'
              ? 'Selama dibekukan pelanggan tidak dapat memesan kelas. Paket tidak dapat dibekukan bila masih ada booking mendatang.'
              : 'Masa berlaku otomatis bertambah sepanjang paket dibekukan.'
        }
        label="Alasan"
        confirmLabel={
          action === 'extend' ? 'Perpanjang' : action === 'freeze' ? 'Bekukan' : 'Buka kembali'
        }
        maxLength={500}
        busy={acting}
        error={actionError}
        onCancel={() => {
          setAction(null);
          setActionError('');
        }}
        onConfirm={(reason) => void runAction(reason)}
      >
        {action === 'extend' && (
          <div className="space-y-4">
            <div>
              <span className="block text-xs font-semibold text-dd-ink mb-1">
                Tanggal Berakhir Saat Ini:
              </span>
              <div className="text-xs font-mono text-dd-muted bg-dd-surface-muted p-2 rounded border border-dd-line">
                {formatDate(history.balance.expiryAt)} ({history.balance.status === 'EXPIRED' ? 'Sudah Kedaluwarsa' : 'Masih Aktif'})
              </div>
            </div>

            <DateInput
              label="Pilih tanggal berakhir baru (bebas tanggal berapapun)"
              data-testid="input-extend-date"
              value={targetDate}
              onChange={(event) => {
                setTargetDate(event.target.value);
                setExtendMode('date');
              }}
            />

            <div>
              <span className="block text-xs font-semibold text-dd-muted mb-1.5">
                Tombol Cepat Tambahan Hari:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {[14, 30, 60, 90].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      const base = Math.max(new Date(history.balance.expiryAt).getTime(), Date.now());
                      const next = new Date(base + d * 86400000).toISOString().slice(0, 10);
                      setTargetDate(next);
                      setDays(String(d));
                      setExtendMode('date');
                    }}
                    className="rounded-dd-sm border border-dd-line bg-white px-2.5 py-1 text-xs font-semibold text-dd-ink hover:border-dd-forest hover:bg-dd-forest/5 transition"
                  >
                    +{d} hari
                  </button>
                ))}
              </div>
            </div>

            {targetDate && (() => {
              const currentExpiry = new Date(history.balance.expiryAt).getTime();
              const selectedTime = new Date(targetDate).getTime();
              const diffDays = Math.round((selectedTime - currentExpiry) / 86400000);
              return (
                <div className="rounded-dd-sm bg-emerald-50 border border-emerald-200 p-2 text-xs text-emerald-800">
                  Paket akan diset hingga: <strong>{targetDate}</strong> (
                  {diffDays > 0 ? `+${diffDays} hari` : diffDays < 0 ? `${diffDays} hari` : 'sama dengan tanggal saat ini'} dari masa berlaku saat ini)
                </div>
              );
            })()}
          </div>
        )}
      </ReasonDialog>

      {manageMembersOpen && (
        <SharedPackageMembersDialog
          open={manageMembersOpen}
          onClose={() => setManageMembersOpen(false)}
          customerPackageId={id}
          packageName={balance.packageName}
          canManage={canManagePackage}
          onChanged={() => void load()}
        />
      )}
    </section>
  );
}
