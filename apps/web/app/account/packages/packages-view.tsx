'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { browserLedgerClient, type LedgerBalance } from '@/api-clients/ledger-client';
import { Button, ButtonLink } from '../../components/actions';
import { EmptyState, Feedback, PageHeader, Skeleton, StatusBadge } from '../../ui';
import { Pagination } from '../../components/admin/admin-ui';
import { useSessionContext } from '../../session-context';
import { SharedPackageMembersDialog } from '../../components/shared-package-members-dialog';

export function isExpiredPackage(item: LedgerBalance): boolean {
  const isPast = new Date(item.expiryAt).getTime() < Date.now();
  return item.status === 'EXPIRED' || isPast;
}

export function CustomerPackagesView() {
  const session = useSessionContext();
  const currentUserId = session?.session?.id;
  const [items, setItems] = useState<LedgerBalance[]>([]);
  const [selectedPackageForMembers, setSelectedPackageForMembers] = useState<LedgerBalance | null>(null);
  const [tab, setTab] = useState<'ACTIVE' | 'HISTORY'>('ACTIVE');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cursor, setCursor] = useState<string>();
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>();
  const [total, setTotal] = useState(0);

  const loadPage = useCallback(async (pageCursor?: string) => {
    setLoading(true);
    setError('');
    try {
      const value = await browserLedgerClient.list(undefined, pageCursor);
      setItems(value.items);
      setNextCursor(value.nextCursor);
      setTotal(value.summary.packageCount);
      setCursor(pageCursor);
      return true;
    } catch {
      setError('Paket Anda belum dapat dimuat.');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  const activeItems = useMemo(
    () => items.filter((item) => item.status === 'ACTIVE' && !isExpiredPackage(item)),
    [items],
  );
  const historyItems = useMemo(
    () => items.filter((item) => isExpiredPackage(item) || item.status !== 'ACTIVE'),
    [items],
  );
  const displayedItems = tab === 'ACTIVE' ? activeItems : historyItems;

  return (
    <main className="space-y-6">
      <PageHeader
        eyebrow="Member area"
        title="Paket Saya"
        description="Lihat saldo sesi, masa aktif, dan lanjutkan langsung ke jadwal booking."
        backHref="/account"
        backLabel="Kembali ke Beranda"
        context={
          <ButtonLink variant="secondary" size="sm" href="/packages">
            Tambah paket
          </ButtonLink>
        }
      />
      {error && <Feedback kind="error">{error}</Feedback>}

      <div
        className="my-2 inline-flex rounded-none border border-ed-line bg-ed-tint/50 p-1"
        role="tablist"
        aria-label="Tab paket"
      >
        {(['ACTIVE', 'HISTORY'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={`min-h-11 rounded-none px-4 text-sm font-semibold transition cursor-pointer ${
              tab === value
                ? 'bg-ed-forest text-white'
                : 'bg-transparent text-ed-muted hover:bg-ed-tint hover:text-ed-ink'
            }`}
            onClick={() => setTab(value)}
          >
            {value === 'ACTIVE' ? 'Paket Aktif' : 'Riwayat Paket'}
          </button>
        ))}
      </div>

      {loading ? (
        <Skeleton />
      ) : displayedItems.length === 0 ? (
        <EmptyState
          title={tab === 'ACTIVE' ? 'Belum ada paket aktif' : 'Belum ada riwayat paket'}
          description={
            tab === 'ACTIVE'
              ? 'Paket akan tampil setelah bukti pembayaran pesanan disetujui.'
              : 'Paket yang masa berlakunya telah berakhir akan tersimpan di sini.'
          }
        />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {displayedItems.map((item, index) => {
              const expired = isExpiredPackage(item);
              return (
                <article
                  className="rounded-none border border-ed-line bg-white p-5 shadow-none sm:p-6"
                  key={item.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-none border border-ed-line bg-ed-tint font-serif text-xs font-normal text-ed-forest mt-0.5">
                        #{cursorHistory.length * 20 + index + 1}
                      </span>
                      <div>
                        <p className="text-[13px] font-bold text-ed-green">
                          {item.branchName ?? 'Daily Dose'}
                        </p>
                        <h2 className="font-serif mt-1 text-xl font-normal tracking-tight text-ed-ink">
                          {item.packageName ?? 'Paket kelas'}
                        </h2>
                        <p className="mt-1 text-sm text-ed-muted">
                          {item.classTypeName ?? 'Kelas Daily Dose'}
                        </p>
                        {item.isShareable && (
                          <div className="mt-1 flex items-center gap-1.5">
                            {item.customer?.id && currentUserId && item.customer.id !== currentUserId ? (
                              <span className="text-xs font-semibold text-ed-forest">
                                Paket bersama milik {item.customer.displayName}
                              </span>
                            ) : (
                              <span className="text-xs font-semibold text-ed-forest">
                                Paket Bersama (Family / Duet)
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    <StatusBadge
                      tone={
                        expired
                          ? 'neutral'
                          : item.status === 'ACTIVE'
                            ? 'success'
                            : 'warning'
                      }
                    >
                      {expired
                        ? 'Kedaluwarsa'
                        : item.status === 'ACTIVE'
                          ? 'Aktif'
                          : 'Tidak aktif'}
                    </StatusBadge>
                  </div>
                  <dl className="mt-5 grid grid-cols-3 gap-2">
                    <div className="rounded-none border border-ed-line/70 bg-ed-tint/40 p-3">
                      <dt
                        className={`text-[13px] ${ expired && item.available > 0 ?'text-rose-800 font-semibold'
                            : 'text-ed-muted'
                        }`}
                      >
                        {expired ? (item.available > 0 ? 'Hangus' : 'Habis') : 'Tersedia'}
                      </dt>
                      <dd
                        className={`mt-1 font-serif text-xl font-normal ${
                          expired && item.available > 0 ? 'text-rose-800' : 'text-ed-forest'
                        }`}
                      >
                        {item.available}
                      </dd>
                    </div>
                    <div className="rounded-none border border-ed-line/70 bg-ed-tint/40 p-3">
                      <dt className="text-[13px] text-ed-muted">Dipesan</dt>
                      <dd className="mt-1 font-serif text-xl font-normal text-ed-ink">{item.reserved}</dd>
                    </div>
                    <div className="rounded-none border border-ed-line/70 bg-ed-tint/40 p-3">
                      <dt className="text-[13px] text-ed-muted">Total</dt>
                      <dd className="mt-1 font-serif text-xl font-normal text-ed-ink">{item.ledgerBalance}</dd>
                    </div>
                  </dl>
                  <p className="mt-4 text-xs leading-relaxed text-ed-muted">
                    {expired
                      ? `Kedaluwarsa pada ${new Date(item.expiryAt).toLocaleDateString('id-ID')}`
                      : `Berlaku sampai ${new Date(item.expiryAt).toLocaleDateString('id-ID')}`}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {!expired && item.status === 'ACTIVE' ? (
                      <ButtonLink
                        href={`/classes?branch=${encodeURIComponent(item.branchId)}#schedule`}
                      >
                        Booking kelas
                      </ButtonLink>
                    ) : expired ? (
                      <ButtonLink
                        variant="secondary"
                        href="/packages"
                      >
                        Beli paket baru
                      </ButtonLink>
                    ) : null}
                    {item.isShareable && (
                      <Button
                        variant="secondary"
                        onClick={() => setSelectedPackageForMembers(item)}
                      >
                        {item.customer?.id === currentUserId || !item.customer?.id
                          ? `Kelola Anggota (${item.sharedMembers?.length ?? 0})`
                          : 'Lihat Anggota Bersama'}
                      </Button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          <Pagination
            hasPrevious={cursorHistory.length > 0 && !loading}
            hasNext={Boolean(nextCursor) && !loading}
            totalLabel={
              total <= displayedItems.length
                ? `${displayedItems.length.toLocaleString('id-ID')} paket`
                : `${displayedItems.length.toLocaleString('id-ID')} dari ${total.toLocaleString('id-ID')} paket`
            }
            currentPage={cursorHistory.length + 1}
            onPrevious={() => {
              const previous = cursorHistory.at(-1) ?? '';
              void loadPage(previous || undefined).then((loaded) => {
                if (loaded) setCursorHistory((current) => current.slice(0, -1));
              });
            }}
            onNext={() => {
              if (!nextCursor) return;
              void loadPage(nextCursor).then((loaded) => {
                if (loaded) setCursorHistory((current) => [...current, cursor ?? '']);
              });
            }}
          />
        </>
      )}

      {selectedPackageForMembers && (
        <SharedPackageMembersDialog
          open={Boolean(selectedPackageForMembers)}
          onClose={() => setSelectedPackageForMembers(null)}
          customerPackageId={selectedPackageForMembers.id}
          packageName={selectedPackageForMembers.packageName}
          canManage={
            selectedPackageForMembers.customer?.id === currentUserId ||
            !selectedPackageForMembers.customer?.id
          }
          onChanged={() => void loadPage(cursor)}
        />
      )}
    </main>
  );
}
