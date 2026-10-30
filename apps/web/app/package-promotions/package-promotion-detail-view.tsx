'use client';

import Link from 'next/link';
import { ArrowLeft, History, Pencil, Plus, Power, PowerOff, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../components/actions';
import { Badge, DataTable, Pagination, Panel } from '../components/admin/admin-ui';
import { AlertBanner, Drawer, useAppFeedback } from '../components/app-feedback';
import { useTrackedRouter } from '../components/app-loading';
import { LifecycleDialog, type LifecycleAction } from '../components/admin/lifecycle-dialog';
import { DateInput, SelectInput, TextInput } from '../components/forms';
import { Skeleton } from '../ui';
import { useSessionContext } from '../session-context';
import {
  browserPackagePromotionClient,
  promotionFailure,
  type InternalPackageRecord,
  type PackagePromotionRecord,
  type PackagePromotionPage,
  type PromotionOrderPage,
} from '@/api-clients/package-promotion-client';
import { browserMasterClient } from '@/api-clients/master-client';
import { formatRupiah } from '../lib/formatters';
import { pageOffset } from '../lib/pagination';
const stateLabels: Record<string, string> = {
  DRAFT: 'Draft',
  ACTIVE: 'Aktif',
  PAUSED: 'Dijeda',
  ARCHIVED: 'Diarsipkan',
  SCHEDULED: 'Terjadwal',
  LIVE: 'Sedang berlangsung',
  EXPIRED: 'Berakhir',
};

type PackageRevision = NonNullable<InternalPackageRecord['revisions']>[number];

function revisionState(item: PackageRevision) {
  const now = Date.now();
  if (new Date(item.effectiveFrom).getTime() > now) return 'SCHEDULED';
  if (item.effectiveUntil && new Date(item.effectiveUntil).getTime() <= now) return 'EXPIRED';
  return 'ACTIVE';
}

function hasRevisionOverlap(items: PackageRevision[]) {
  return items.some((left, index) =>
    items.slice(index + 1).some((right) => {
      const leftStart = new Date(left.effectiveFrom).getTime();
      const leftEnd = left.effectiveUntil
        ? new Date(left.effectiveUntil).getTime()
        : Number.POSITIVE_INFINITY;
      const rightStart = new Date(right.effectiveFrom).getTime();
      const rightEnd = right.effectiveUntil
        ? new Date(right.effectiveUntil).getTime()
        : Number.POSITIVE_INFINITY;
      return leftStart < rightEnd && rightStart < leftEnd;
    }),
  );
}

export function PackagePromotionDetailView({ id }: { id: string }) {
  const session = useSessionContext();
  const feedback = useAppFeedback();
  const router = useTrackedRouter();
  const [pkg, setPackage] = useState<InternalPackageRecord | null>(null);
  const [packageDelete, setPackageDelete] = useState(false);
  const [promoLifecycle, setPromoLifecycle] = useState<{
    promotion: PackagePromotionRecord;
    action: LifecycleAction;
  } | null>(null);
  const [promotionPage, setPromotionPage] = useState<PackagePromotionPage | null>(null);
  const [promotionCursor, setPromotionCursor] = useState<string>();
  const [promotionHistory, setPromotionHistory] = useState<Array<string | undefined>>([]);
  const [orders, setOrders] = useState<Record<string, PromotionOrderPage>>({});
  const [orderCursors, setOrderCursors] = useState<Record<string, string | undefined>>({});
  const [orderHistory, setOrderHistory] = useState<Record<string, Array<string | undefined>>>({});
  const [selectedOrderPromotionId, setSelectedOrderPromotionId] = useState<string>();
  const [editor, setEditor] = useState<PackagePromotionRecord | 'new' | null>(null);
  const [packageEditor, setPackageEditor] = useState<
    'metadata' | 'revision' | 'scopes' | 'lifecycle' | null
  >(null);
  const [globalClassTypes, setGlobalClassTypes] = useState<
    Array<{ id: string; name: string; branchScopes: Array<{ branchId: string; active: boolean }> }>
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canManage =
    session?.status === 'authenticated' && session.hasCapability('package-promotion:manage');
  const canManagePackage =
    session?.status === 'authenticated' && session.hasCapability('master:manage');
  const load = () =>
    browserPackagePromotionClient
      .detail(id)
      .then(setPackage)
      .catch(() => setError('Detail paket tidak dapat dimuat.'));
  useEffect(() => void load(), [id]);
  useEffect(() => {
    void browserPackagePromotionClient
      .promotions(id, promotionCursor)
      .then(setPromotionPage)
      .catch(() => setError('Histori promo tidak dapat dimuat.'));
  }, [id, promotionCursor]);
  useEffect(() => {
    if (packageEditor === 'scopes')
      void browserMasterClient.listClassTypes().then((items) => setGlobalClassTypes(items));
  }, [packageEditor]);
  if (!session || session.status === 'loading') return <Skeleton label="Memuat detail paket" />;
  if (error) return <AlertBanner tone="danger" title="Paket tidak tersedia" message={error} />;
  if (!pkg) return <Skeleton label="Memuat detail paket" />;

  const activate = async (promotion: PackagePromotionRecord) => {
    const accepted = await feedback.confirm({
      tone: 'warning',
      title: 'Aktifkan promo?',
      message: `${promotion.name} untuk ${pkg.name}. Harga order lama tidak akan berubah.`,
      confirmLabel: 'Aktifkan',
    });
    if (!accepted) return;
    setBusy(true);
    try {
      await browserPackagePromotionClient.transition(promotion.id, 'activate', promotion.version);
      await load();
      feedback.showToast({
        tone: 'success',
        title: 'Status promo diperbarui',
        message: 'Perubahan tercatat pada audit trail.',
      });
    } catch (cause) {
      feedback.showAlert({
        tone: 'danger',
        title: 'Perubahan belum tersimpan',
        message: await promotionFailure(cause, 'Muat ulang detail promo lalu coba kembali.'),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="grid gap-5" aria-labelledby="package-promotion-title">
      <Link
        href="/workspace/packages"
        className="inline-flex items-center gap-2 text-sm font-semibold text-dd-forest no-underline"
      >
        <ArrowLeft className="size-4" /> Kembali ke paket
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-dd-line pb-5">
        <div>
          <p className="text-[13px] font-bold text-dd-forest">
            Paket & promo harga
          </p>
          <h1 id="package-promotion-title" className="mt-1 text-3xl font-semibold">
            {pkg.name}
          </h1>
          <p className="mt-2 text-sm text-dd-muted">
            {pkg.isMultiBranch
              ? 'Semua Cabang (Multi-Branch)'
              : (pkg.branchScopes ?? [])
                  .map((scope) => scope.branch?.name)
                  .filter(Boolean)
                  .join(', ') || pkg.branch?.name || '—'}{' '}
            · {pkg.sessionCount} sesi · {pkg.durationDays} hari
          </p>
        </div>
        {canManage && (
          <Button
            leadingIcon={<Plus className="size-4" aria-hidden="true" />}
            onClick={() => setEditor('new')}
          >
            Buat promo
          </Button>
        )}
      </header>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel className="p-5">
          <h2 className="text-lg font-semibold">Identitas paket</h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <PackageInfo label="Nama paket" value={pkg.name} />
            <PackageInfo label="Business key" value={pkg.businessKey} />
            <PackageInfo
              label="Cakupan Studio/Cabang"
              value={
                pkg.isMultiBranch
                  ? 'Semua Cabang (Multi-Branch)'
                  : (pkg.branchScopes ?? [])
                      .map((scope) => scope.branch?.name)
                      .filter(Boolean)
                      .join(', ') || pkg.branch?.name || '—'
              }
            />
            <PackageInfo
              label="Cakupan tipe kelas"
              value={
                pkg.classTypeScopes
                  ?.map((scope) => scope.classType?.name)
                  .filter(Boolean)
                  .join(', ') || '—'
              }
            />
            <PackageInfo
              label="Tipe Penggunaan"
              value={
                pkg.isShareable
                  ? 'Bisa Dipakai Bersama (Family / Duet)'
                  : 'Individu (Single User)'
              }
            />
          </dl>
          <p className="mt-4 text-xs leading-5 text-dd-muted">
            Business key adalah identitas global. Ketersediaan paket ditentukan oleh cakupan
            Studio/Cabang dan tipe kelas yang eksplisit.
          </p>
        </Panel>
        <Panel className="p-5">
          <h2 className="text-lg font-semibold">Konfigurasi komersial</h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <PackageInfo label="Harga normal" value={formatRupiah(pkg.priceRp)} />
            <PackageInfo label="Jumlah sesi" value={`${pkg.sessionCount} sesi`} />
            <PackageInfo label="Masa berlaku" value={`${pkg.durationDays} hari`} />
            <PackageInfo
              label="Periode"
              value={`${new Date(pkg.effectiveFrom).toLocaleDateString('id-ID')} – ${
                pkg.effectiveUntil
                  ? new Date(pkg.effectiveUntil).toLocaleDateString('id-ID')
                  : 'tanpa batas'
              }`}
            />
          </dl>
        </Panel>
      </div>
      <Panel className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <h2 className="text-lg font-semibold">Status & lifecycle</h2>
          <p className="mt-1 text-sm text-dd-muted">
            {pkg.status === 'ACTIVE'
              ? 'Paket tersedia sesuai periode efektif.'
              : 'Paket tidak aktif.'}
          </p>
        </div>
        <Badge tone={pkg.status === 'ACTIVE' ? 'success' : 'neutral'}>
          {pkg.status === 'ACTIVE' ? 'Aktif' : 'Tidak aktif'}
        </Badge>
      </Panel>
      {canManagePackage && (
        <div className="flex flex-wrap gap-2">
          <Button
            leadingIcon={<Pencil className="size-4" aria-hidden="true" />}
            onClick={() => setPackageEditor('metadata')}
          >
            Edit paket
          </Button>
          <Button
            variant="secondary"
            leadingIcon={<History className="size-4" aria-hidden="true" />}
            onClick={() => setPackageEditor('revision')}
          >
            Buat revisi paket
          </Button>
          <Button variant="secondary" onClick={() => setPackageEditor('scopes')}>
            Atur cakupan paket
          </Button>
          <Button
            variant={pkg.status === 'ACTIVE' ? 'danger' : 'primary'}
            leadingIcon={
              pkg.status === 'ACTIVE' ? (
                <PowerOff className="size-4" aria-hidden="true" />
              ) : (
                <Power className="size-4" aria-hidden="true" />
              )
            }
            onClick={() => setPackageEditor('lifecycle')}
          >
            {pkg.status === 'ACTIVE' ? 'Nonaktifkan paket' : 'Aktifkan kembali'}
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            leadingIcon={<Trash2 className="size-4" aria-hidden="true" />}
            onClick={() => setPackageDelete(true)}
          >
            Hapus paket
          </Button>
        </div>
      )}
      <Panel className="overflow-hidden p-0">
        <div className="border-b border-dd-line px-5 py-4">
          <h2 className="text-lg font-semibold">Riwayat revisi paket</h2>
          <p className="mt-1 text-sm text-dd-muted">
            Harga dan sesi lama dipertahankan untuk order yang sudah dibuat.
          </p>
        </div>
        {hasRevisionOverlap(pkg.revisions ?? []) && (
          <div className="px-5 pt-4">
            <AlertBanner
              tone="danger"
              title="Periode revisi bertumpang tindih"
              message="Jalankan pemeriksaan integritas paket sebelum mengaktifkan atau membuat revisi baru."
            />
          </div>
        )}
        <DataTable
          items={pkg.revisions ?? []}
          rowKey={(item) => item.id ?? `rev-${item.revisionNumber}`}
          emptyTitle="Belum ada revisi"
          columns={[
            {
              id: 'name',
              header: 'Revisi',
              cell: (item) => `Revisi ${item.revisionNumber}`,
            },
            {
              id: 'price',
              header: 'Harga',
              cell: (item) => formatRupiah(item.priceRp),
            },
            {
              id: 'sessions',
              header: 'Sesi',
              cell: (item) => `${item.sessionCount} sesi · ${item.durationDays} hari`,
            },
            {
              id: 'period',
              header: 'Periode',
              cell: (item) =>
                `${new Date(item.effectiveFrom).toLocaleDateString('id-ID')} – ${
                  item.effectiveUntil
                    ? new Date(item.effectiveUntil).toLocaleDateString('id-ID')
                    : 'tanpa batas'
                }`,
            },
            {
              id: 'status',
              header: 'Status',
              cell: (item) => {
                const state = revisionState(item);
                return (
                  <Badge
                    tone={
                      state === 'ACTIVE' ? 'success' : state === 'SCHEDULED' ? 'warning' : 'neutral'
                    }
                  >
                    {stateLabels[state] ?? 'Tidak aktif'}
                  </Badge>
                );
              },
            },
          ]}
          mobileCard={(item) => (
            <div className="grid gap-1">
              <strong>Revisi {item.revisionNumber}</strong>
              <span>{formatRupiah(item.priceRp)}</span>
              <span className="text-xs text-dd-muted">
                {item.sessionCount} sesi · {item.durationDays} hari
              </span>
            </div>
          )}
        />
      </Panel>
      <Panel className="overflow-hidden p-0">
        <div className="border-b border-dd-line px-5 py-4">
          <h2 className="text-lg font-semibold">Histori promo</h2>
          <p className="mt-1 text-sm text-dd-muted">
            Hanya satu promo dapat efektif pada waktu yang sama.
          </p>
        </div>
        <DataTable
          items={promotionPage?.items ?? []}
          rowNumberOffset={pageOffset(promotionHistory.length)}
          rowKey={(item) => item.id}
          emptyTitle="Belum ada promo harga"
          emptyDescription="Buat promo untuk menampilkan harga asli dicoret pada katalog."
          columns={[
            {
              id: 'promotion',
              header: 'Promo',
              cell: (item) => (
                <div>
                  <strong>{item.name}</strong>
                  <p className="text-xs text-dd-muted">{item.label}</p>
                </div>
              ),
            },
            {
              id: 'price',
              header: 'Harga promo',
              cell: (item) => (
                <div>
                  <del className="text-xs text-dd-muted">{formatRupiah(pkg.priceRp)}</del>
                  <strong className="block text-dd-forest">
                    {formatRupiah(item.promotionalPriceRp)}
                  </strong>
                </div>
              ),
            },
            {
              id: 'period',
              header: 'Periode',
              cell: (item) => (
                <span className="text-xs">
                  {new Date(item.activeFrom).toLocaleString('id-ID')} –{' '}
                  {new Date(item.activeUntil).toLocaleString('id-ID')}
                </span>
              ),
            },
            {
              id: 'state',
              header: 'Status',
              cell: (item) => (
                <Badge tone={item.effectiveState === 'LIVE' ? 'success' : 'neutral'}>
                  {stateLabels[item.effectiveState] ?? item.effectiveState}
                </Badge>
              ),
            },
            {
              id: 'actions',
              header: 'Tindakan',
              cell: (item) => (
                <div className="flex flex-wrap gap-2">
                  {canManage && item.status !== 'ARCHIVED' && (
                    <Button size="sm" variant="secondary" onClick={() => setEditor(item)}>
                      Edit
                    </Button>
                  )}
                  {canManage && item.status !== 'ACTIVE' && item.status !== 'ARCHIVED' && (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => void activate(item)}
                    >
                      Aktifkan
                    </Button>
                  )}
                  {canManage && item.status === 'ACTIVE' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => setPromoLifecycle({ promotion: item, action: 'deactivate' })}
                    >
                      Jeda
                    </Button>
                  )}
                  {canManage && item.status !== 'ARCHIVED' && (
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy}
                      onClick={() => setPromoLifecycle({ promotion: item, action: 'archive' })}
                    >
                      Arsipkan
                    </Button>
                  )}
                  {canManage && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-dd-danger hover:text-dd-danger"
                      disabled={busy}
                      aria-label={`Hapus promo ${item.name}`}
                      onClick={() => setPromoLifecycle({ promotion: item, action: 'delete' })}
                    >
                      Hapus
                    </Button>
                  )}
                  {(item.usageCount ?? 0) > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void (async () => {
                          const page = await browserPackagePromotionClient.orders(
                            item.id,
                            orderCursors[item.id],
                          );
                          setOrders((current) => ({ ...current, [item.id]: page }));
                          setSelectedOrderPromotionId(item.id);
                        })()
                      }
                    >
                      {orders[item.id]
                        ? `${orders[item.id]!.items.length} pesanan`
                        : 'Lihat pesanan'}
                    </Button>
                  )}
                </div>
              ),
            },
          ]}
          mobileCard={(item) => (
            <div className="grid gap-2">
              <div className="flex items-start justify-between gap-2">
                <strong>{item.name}</strong>
                <Badge>{stateLabels[item.effectiveState] ?? item.effectiveState}</Badge>
              </div>
              <span className="text-sm text-dd-muted">{item.label}</span>
              <strong className="text-dd-forest">{formatRupiah(item.promotionalPriceRp)}</strong>
            </div>
          )}
        />
        <div className="border-t border-dd-line p-4">
          <Pagination
            currentPage={promotionHistory.length + 1}
            hasPrevious={promotionHistory.length > 0}
            hasNext={Boolean(promotionPage?.page?.hasMore && promotionPage.page.nextCursor)}
            totalLabel={`${(promotionPage?.items.length ?? 0).toLocaleString('id-ID')} promo`}
            onPrevious={() => {
              const previous = promotionHistory.at(-1);
              setPromotionHistory((current) => current.slice(0, -1));
              setPromotionCursor(previous);
            }}
            onNext={() => {
              const next = promotionPage?.page.nextCursor;
              if (!next) return;
              setPromotionHistory((current) => [...current, promotionCursor]);
              setPromotionCursor(next);
            }}
          />
        </div>
      </Panel>
      {selectedOrderPromotionId && orders[selectedOrderPromotionId] && (
        <Panel className="overflow-hidden p-0">
          <div className="border-b border-dd-line px-5 py-4">
            <h2 className="text-lg font-semibold">Pesanan yang memakai promo</h2>
            <p className="mt-1 text-sm text-dd-muted">
              Histori menggunakan snapshot harga pada saat pesanan dibuat.
            </p>
          </div>
          <DataTable
            items={orders[selectedOrderPromotionId]!.items}
            rowNumberOffset={pageOffset(orderHistory[selectedOrderPromotionId]?.length ?? 0)}
            rowKey={(item) => item.id}
            emptyTitle="Belum ada pesanan"
            emptyDescription="Promo ini belum digunakan pada pesanan."
            columns={[
              {
                id: 'customer',
                header: 'Pelanggan',
                cell: (item) => (
                  <div>
                    <strong>{item.user.displayName}</strong>
                    <p className="text-xs text-dd-muted">{item.branch.name}</p>
                  </div>
                ),
              },
              {
                id: 'status',
                header: 'Status',
                cell: (item) => <Badge>{item.status}</Badge>,
              },
              {
                id: 'discount',
                header: 'Diskon promo',
                cell: (item) => formatRupiah(item.packagePromotionDiscountRpSnapshot ?? 0),
              },
              {
                id: 'submitted',
                header: 'Dibuat',
                cell: (item) => new Date(item.submittedAt).toLocaleString('id-ID'),
              },
            ]}
            mobileCard={(item) => (
              <div className="grid gap-1">
                <strong>{item.user.displayName}</strong>
                <span className="text-sm text-dd-muted">{item.branch.name}</span>
                <span>{formatRupiah(item.packagePromotionDiscountRpSnapshot ?? 0)}</span>
              </div>
            )}
          />
          <div className="border-t border-dd-line p-4">
            <Pagination
              currentPage={(orderHistory[selectedOrderPromotionId]?.length ?? 0) + 1}
              hasPrevious={(orderHistory[selectedOrderPromotionId]?.length ?? 0) > 0}
              hasNext={Boolean(
                orders[selectedOrderPromotionId]?.page?.hasMore &&
                orders[selectedOrderPromotionId]?.page?.nextCursor,
              )}
              totalLabel={`${(orders[selectedOrderPromotionId]?.items.length ?? 0).toLocaleString('id-ID')} pesanan`}
              onPrevious={() => {
                const history = orderHistory[selectedOrderPromotionId] ?? [];
                const previous = history.at(-1);
                setOrderHistory((current) => ({
                  ...current,
                  [selectedOrderPromotionId]: history.slice(0, -1),
                }));
                setOrderCursors((current) => ({
                  ...current,
                  [selectedOrderPromotionId]: previous,
                }));
                void browserPackagePromotionClient
                  .orders(selectedOrderPromotionId, previous)
                  .then((page) =>
                    setOrders((current) => ({
                      ...current,
                      [selectedOrderPromotionId]: page,
                    })),
                  );
              }}
              onNext={() => {
                const next = orders[selectedOrderPromotionId]!.page.nextCursor;
                if (!next) return;
                const currentCursor = orderCursors[selectedOrderPromotionId];
                setOrderHistory((current) => ({
                  ...current,
                  [selectedOrderPromotionId]: [
                    ...(current[selectedOrderPromotionId] ?? []),
                    currentCursor,
                  ],
                }));
                setOrderCursors((current) => ({
                  ...current,
                  [selectedOrderPromotionId]: next,
                }));
                void browserPackagePromotionClient
                  .orders(selectedOrderPromotionId, next)
                  .then((page) =>
                    setOrders((current) => ({
                      ...current,
                      [selectedOrderPromotionId]: page,
                    })),
                  );
              }}
            />
          </div>
        </Panel>
      )}
      <Panel className="p-5">
        <h2 className="text-lg font-semibold">Aktivitas audit</h2>
        {!pkg.auditActivity?.length ? (
          <p className="mt-3 text-sm text-dd-muted">Belum ada aktivitas paket.</p>
        ) : (
          <ol className="mt-3 grid gap-2">
            {pkg.auditActivity.map((item) => (
              <li key={item.id} className="flex justify-between gap-3 border-b border-dd-line py-2">
                <span className="text-sm font-medium">
                  {item.action
                    .replaceAll('_', ' ')
                    .toLowerCase()
                    .replace(/^./u, (value) => value.toUpperCase())}
                </span>
                <time className="text-xs text-dd-muted">
                  {new Date(item.occurredAt).toLocaleString('id-ID')}
                </time>
              </li>
            ))}
          </ol>
        )}
      </Panel>
      <PromotionEditor
        pkg={pkg}
        value={editor}
        onClose={() => setEditor(null)}
        onSaved={async () => {
          setEditor(null);
          await load();
          feedback.showToast({
            tone: 'success',
            title: 'Promo tersimpan',
            message: 'Promo siap ditinjau dan diaktifkan.',
          });
        }}
      />
      <PackageLifecycleEditor
        pkg={pkg}
        mode={packageEditor}
        branches={session.session?.branches ?? []}
        classTypes={globalClassTypes}
        onClose={() => setPackageEditor(null)}
        onSaved={async (updated) => {
          setPackageEditor(null);
          if (updated.id !== pkg.id) {
            window.location.assign(`/workspace/packages/${updated.id}`);
            return;
          }
          await load();
          feedback.showToast({
            tone: 'success',
            title: 'Paket diperbarui',
            message: 'Perubahan tersimpan dan tercatat pada audit trail.',
          });
        }}
      />
      <LifecycleDialog
        request={packageDelete ? { kind: 'package', id: pkg.id, name: pkg.name, action: 'delete' } : null}
        onClose={() => setPackageDelete(false)}
        onDone={(message) => {
          setPackageDelete(false);
          feedback.showToast({ tone: 'success', title: 'Paket dihapus', message });
          router.push('/workspace/packages');
        }}
      />
      <LifecycleDialog
        request={
          promoLifecycle
            ? {
                kind: 'promotion',
                id: promoLifecycle.promotion.id,
                name: promoLifecycle.promotion.name,
                action: promoLifecycle.action,
              }
            : null
        }
        deactivate={(reason) =>
          browserPackagePromotionClient.transition(
            promoLifecycle!.promotion.id,
            'pause',
            promoLifecycle!.promotion.version,
            reason,
          )
        }
        archive={(reason) =>
          browserPackagePromotionClient.transition(
            promoLifecycle!.promotion.id,
            'archive',
            promoLifecycle!.promotion.version,
            reason,
          )
        }
        onClose={() => setPromoLifecycle(null)}
        onDone={async (message) => {
          setPromoLifecycle(null);
          feedback.showToast({ tone: 'success', title: 'Promo diperbarui', message });
          await load();
          await browserPackagePromotionClient.promotions(id, promotionCursor).then(setPromotionPage);
        }}
      />
    </section>
  );
}

function PackageInfo({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-dd-muted">{label}</dt>
      <dd className="mt-1 font-semibold text-dd-ink">{value}</dd>
    </div>
  );
}

function PackageLifecycleEditor({
  pkg,
  mode,
  branches,
  classTypes,
  onClose,
  onSaved,
}: {
  pkg: InternalPackageRecord;
  mode: 'metadata' | 'revision' | 'scopes' | 'lifecycle' | null;
  branches: Array<{ id: string; name: string }>;
  classTypes: Array<{
    id: string;
    name: string;
    branchScopes: Array<{ branchId: string; active: boolean }>;
  }>;
  onClose(): void;
  onSaved(updated: InternalPackageRecord): Promise<void>;
}) {
  const feedback = useAppFeedback();
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [failure, setFailure] = useState('');
  const [scopeIsMulti, setScopeIsMulti] = useState<boolean>(
    pkg.isMultiBranch ?? (pkg.branchScopes?.length !== 1),
  );
  const [scopeBranchId, setScopeBranchId] = useState<string>(
    pkg.branchId ?? pkg.branchScopes?.[0]?.branchId ?? (branches[0]?.id || ''),
  );

  useEffect(() => {
    if (!mode) return;
    setDirty(false);
    setFailure('');
    setScopeIsMulti(pkg.isMultiBranch ?? (pkg.branchScopes?.length !== 1));
    setScopeBranchId(pkg.branchId ?? pkg.branchScopes?.[0]?.branchId ?? (branches[0]?.id || ''));
  }, [mode, pkg, branches]);
  const confirmDiscard = () =>
    feedback.confirm({
      tone: 'warning',
      title: 'Batalkan perubahan paket?',
      message: 'Perubahan yang belum disimpan akan hilang.',
      confirmLabel: 'Buang perubahan',
    });
  const cancel = async () => {
    if (!dirty || (await confirmDiscard())) onClose();
  };
  const canEditCommercialInPlace =
    (pkg._count?.purchases ?? 0) === 0 &&
    (pkg._count?.customerPackages ?? 0) === 0 &&
    new Date(pkg.effectiveFrom).getTime() > Date.now();
  return (
    <Drawer
      open={Boolean(mode)}
      title={
        mode === 'revision'
          ? 'Buat revisi paket'
          : mode === 'scopes'
            ? 'Atur cakupan paket'
            : mode === 'lifecycle'
              ? pkg.status === 'ACTIVE'
                ? 'Nonaktifkan paket'
                : 'Aktifkan kembali paket'
              : 'Edit paket'
      }
      onClose={onClose}
      busy={busy}
      dirty={dirty}
      onDirtyClose={confirmDiscard}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => void cancel()} disabled={busy}>
            Batal
          </Button>
          <Button type="submit" form="package-lifecycle-form" loading={busy}>
            Simpan perubahan
          </Button>
        </div>
      }
    >
      <form
        id="package-lifecycle-form"
        className="grid gap-4"
        onChange={() => setDirty(true)}
        onSubmit={async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const reason = String(data.get('reason'));
          const action =
            mode === 'revision'
              ? 'membuat revisi komersial baru'
              : mode === 'scopes'
                ? 'mengganti cakupan paket'
                : mode === 'lifecycle'
                  ? pkg.status === 'ACTIVE'
                    ? 'menonaktifkan paket'
                    : 'mengaktifkan kembali paket'
                  : 'memperbarui paket';
          const accepted = await feedback.confirm({
            tone: mode === 'lifecycle' && pkg.status === 'ACTIVE' ? 'danger' : 'warning',
            title: `Konfirmasi ${action}`,
            message:
              mode === 'revision'
                ? 'Order lama tetap memakai snapshot harga sebelumnya. Periode paket saat ini akan ditutup pada tanggal revisi.'
                : canEditCommercialInPlace
                  ? 'Paket belum efektif dan belum digunakan, sehingga konfigurasi komersial dapat diperbarui langsung.'
                  : 'Paket aktif atau terpakai hanya dapat mengubah metadata nama. Gunakan revisi untuk perubahan komersial.',
            confirmLabel: 'Lanjutkan',
          });
          if (!accepted) return;
          setBusy(true);
          setFailure('');
          try {
            const updated =
              mode === 'revision'
                ? await browserPackagePromotionClient.revisePackage(pkg.id, {
                    expectedVersion: pkg.version,
                    name: String(data.get('name')),
                    sessionCount: Number(data.get('sessionCount')),
                    durationDays: Number(data.get('durationDays')),
                    priceRp: Number(data.get('priceRp')),
                    effectiveFrom: String(data.get('effectiveFrom')),
                    effectiveUntil: data.get('effectiveUntil') || null,
                    reason,
                  })
                : mode === 'scopes'
                  ? await browserPackagePromotionClient.replacePackageScopes(pkg.id, {
                      isMultiBranch: scopeIsMulti,
                      branchIds: scopeIsMulti ? branches.map((b) => b.id) : [scopeBranchId],
                      branchId: scopeIsMulti ? null : scopeBranchId,
                      classTypeIds: data.getAll('classTypeIds').map(String),
                      expectedVersion: pkg.version,
                      reason,
                    })
                  : mode === 'lifecycle'
                    ? await browserPackagePromotionClient.transitionPackage(
                        pkg.id,
                        pkg.status === 'ACTIVE' ? 'deactivate' : 'reactivate',
                        pkg.version,
                        reason,
                      )
                    : await browserPackagePromotionClient.updatePackage(pkg.id, {
                        expectedVersion: pkg.version,
                        name: String(data.get('name')),
                        isShareable: data.get('isShareable') === 'on',
                        ...(canEditCommercialInPlace
                          ? {
                              sessionCount: Number(data.get('sessionCount')),
                              durationDays: Number(data.get('durationDays')),
                              priceRp: Number(data.get('priceRp')),
                              effectiveFrom: String(data.get('effectiveFrom')),
                              effectiveUntil: data.get('effectiveUntil') || null,
                            }
                          : {}),
                        reason,
                      });
            setDirty(false);
            await onSaved(updated);
          } catch {
            setFailure(
              'Data mungkin telah berubah atau periode bertabrakan. Muat ulang dan coba kembali.',
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {failure && (
          <AlertBanner tone="danger" title="Perubahan belum tersimpan" message={failure} />
        )}
        {mode !== 'lifecycle' && mode !== 'scopes' && (
          <TextInput name="name" label="Nama paket" defaultValue={pkg.name} required />
        )}
        {mode === 'metadata' && (
          <>
            <AlertBanner
              tone="info"
              title={
                canEditCommercialInPlace
                  ? 'Paket belum digunakan'
                  : 'Konfigurasi komersial dilindungi'
              }
              message={
                canEditCommercialInPlace
                  ? 'Harga, sesi, masa berlaku, dan periode dapat diubah sebelum paket mulai efektif.'
                  : 'Cabang, tipe kelas, business key, harga, sesi, masa berlaku, dan periode tidak dapat diubah langsung. Gunakan revisi paket.'
              }
            />
            <TextInput
              label="Cabang / studio"
              value={
                pkg.branchScopes
                  ?.map((scope) => scope.branch?.name)
                  .filter(Boolean)
                  .join(', ') || '—'
              }
              disabled
            />
            <TextInput
              label="Tipe kelas"
              value={
                pkg.classTypeScopes
                  ?.map((scope) => scope.classType?.name)
                  .filter(Boolean)
                  .join(', ') || '—'
              }
              disabled
            />
            <TextInput label="Business key" value={pkg.businessKey} disabled />
            <label className="flex items-start gap-2 text-sm cursor-pointer border border-dd-line rounded-dd-md p-3">
              <input
                type="checkbox"
                name="isShareable"
                defaultChecked={pkg.isShareable}
                className="mt-0.5 accent-dd-forest cursor-pointer size-4 shrink-0 rounded"
              />
              <div>
                <span className="font-semibold text-dd-forest">Bisa Dipakai Bersama (Family / Duet Package)</span>
                <p className="text-xs text-dd-muted">
                  Izinkan pemilik paket untuk mendaftarkan anggota keluarga atau rekan untuk menggunakan kuota sesi paket.
                </p>
              </div>
            </label>
            {canEditCommercialInPlace && (
              <>
                <TextInput
                  name="sessionCount"
                  label="Jumlah sesi"
                  type="number"
                  min={1}
                  defaultValue={pkg.sessionCount}
                  required
                />
                <TextInput
                  name="durationDays"
                  label="Masa berlaku (hari)"
                  type="number"
                  min={1}
                  defaultValue={pkg.durationDays}
                  required
                />
                <TextInput
                  name="priceRp"
                  label="Harga normal"
                  type="number"
                  min={1}
                  defaultValue={pkg.priceRp}
                  required
                />
                <DateInput
                  name="effectiveFrom"
                  label="Mulai berlaku"
                  defaultValue={pkg.effectiveFrom.slice(0, 10)}
                  required
                />
                <DateInput
                  name="effectiveUntil"
                  label="Berakhir"
                  defaultValue={pkg.effectiveUntil?.slice(0, 10)}
                />
              </>
            )}
          </>
        )}
        {mode === 'revision' && (
          <>
            <TextInput
              name="sessionCount"
              label="Jumlah sesi"
              type="number"
              min={1}
              defaultValue={pkg.sessionCount}
              required
            />
            <TextInput
              name="durationDays"
              label="Masa berlaku (hari)"
              type="number"
              min={1}
              defaultValue={pkg.durationDays}
              required
            />
            <TextInput
              name="priceRp"
              label="Harga normal baru"
              type="number"
              min={1}
              defaultValue={pkg.priceRp}
              required
            />
            <DateInput name="effectiveFrom" label="Mulai berlaku" required />
            <DateInput name="effectiveUntil" label="Berakhir" />
          </>
        )}
        {mode === 'scopes' && (
          <>
            <fieldset className="grid gap-3 rounded-dd-md border border-dd-line p-3">
              <legend className="px-1 text-sm font-semibold">Tipe Akses Studio / Cabang</legend>
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="editScopeRadio"
                  checked={scopeIsMulti}
                  onChange={() => {
                    setScopeIsMulti(true);
                    setDirty(true);
                  }}
                  className="mt-1"
                />
                <div>
                  <span className="font-semibold text-dd-forest">Semua Cabang (Multi-Branch)</span>
                  <p className="text-xs text-dd-muted">
                    Member dapat memesan dan latihan di seluruh studio/cabang Daily Dose Pilates.
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="editScopeRadio"
                  checked={!scopeIsMulti}
                  onChange={() => {
                    setScopeIsMulti(false);
                    setDirty(true);
                  }}
                  className="mt-1"
                />
                <div>
                  <span className="font-semibold text-dd-forest">Cabang Tertentu (Single-Branch)</span>
                  <p className="text-xs text-dd-muted">
                    Paket terkunci hanya untuk latihan di studio/cabang terpilih.
                  </p>
                </div>
              </label>

              {!scopeIsMulti && (
                <div className="mt-2 grid gap-2 border-t border-dd-line pt-2">
                  <p className="text-[13px] font-bold text-dd-muted">Pilih Cabang:</p>
                  {branches.map((branch) => (
                    <label className="flex items-center gap-2 text-sm cursor-pointer" key={branch.id}>
                      <input
                        type="radio"
                        name="editSingleBranch"
                        value={branch.id}
                        checked={scopeBranchId === branch.id}
                        onChange={() => {
                          setScopeBranchId(branch.id);
                          setDirty(true);
                        }}
                      />
                      {branch.name}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>

            <fieldset className="grid gap-2 rounded-dd-md border border-dd-line p-3">
              <legend className="px-1 text-sm font-semibold">Tipe kelas</legend>
              {classTypes.map((classType) => (
                <label className="flex items-center gap-2 text-sm" key={classType.id}>
                  <input
                    type="checkbox"
                    name="classTypeIds"
                    value={classType.id}
                    defaultChecked={pkg.classTypeScopes?.some(
                      (scope) => scope.classTypeId === classType.id && scope.active,
                    )}
                  />
                  {classType.name}
                </label>
              ))}
            </fieldset>
          </>
        )}
        <TextInput name="reason" label="Alasan perubahan" minLength={3} required />
      </form>
    </Drawer>
  );
}

function PromotionEditor({
  pkg,
  value,
  onClose,
  onSaved,
}: {
  pkg: InternalPackageRecord;
  value: PackagePromotionRecord | 'new' | null;
  onClose(): void;
  onSaved(): Promise<void>;
}) {
  const current = value && value !== 'new' ? value : null;
  const feedback = useAppFeedback();
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [failure, setFailure] = useState('');
  useEffect(() => {
    if (!value) return;
    setDirty(false);
    setFailure('');
  }, [value]);
  const confirmDiscard = () =>
    feedback.confirm({
      tone: 'warning',
      title: 'Batalkan perubahan promo?',
      message: 'Perubahan yang belum disimpan akan hilang.',
      confirmLabel: 'Buang perubahan',
    });
  const cancel = async () => {
    if (!dirty || (await confirmDiscard())) onClose();
  };
  return (
    <Drawer
      open={Boolean(value)}
      title={current ? 'Edit promo paket' : 'Buat promo paket'}
      onClose={onClose}
      busy={busy}
      dirty={dirty}
      onDirtyClose={confirmDiscard}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => void cancel()} disabled={busy}>
            Batal
          </Button>
          <Button type="submit" form="package-promotion-form" loading={busy}>
            Simpan promo
          </Button>
        </div>
      }
    >
      <p className="mb-4 text-sm text-dd-muted">
        Harga normal {formatRupiah(pkg.priceRp)}. Promo harus menyisakan minimal Rp1.
      </p>
      {failure && <AlertBanner tone="danger" title="Promo belum tersimpan" message={failure} />}
      <form
        id="package-promotion-form"
        className="grid gap-4"
        onChange={() => setDirty(true)}
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          const data = new FormData(event.currentTarget);
          const command = {
            name: String(data.get('name')),
            label: String(data.get('label')),
            discountType: String(data.get('discountType')),
            discountValue: Number(data.get('discountValue')),
            activeFrom: new Date(String(data.get('activeFrom'))).toISOString(),
            activeUntil: new Date(String(data.get('activeUntil'))).toISOString(),
            reason: String(data.get('reason')),
            ...(current ? { expectedVersion: current.version } : {}),
          };
          const accepted = await feedback.confirm({
            tone: 'warning',
            title: current ? 'Simpan perubahan promo?' : 'Buat promo paket?',
            message:
              'Harga katalog dan checkout akan mengikuti promo pada periode aktif yang ditetapkan.',
            confirmLabel: current ? 'Simpan perubahan' : 'Buat promo',
          });
          if (!accepted) return;
          setBusy(true);
          setFailure('');
          try {
            if (current) await browserPackagePromotionClient.update(current.id, command);
            else await browserPackagePromotionClient.create(pkg.id, command);
            setDirty(false);
            await onSaved();
          } catch (cause) {
            setFailure(
              await promotionFailure(
                cause,
                'Konfigurasi promo tidak dapat disimpan. Periksa periode dan coba kembali.',
              ),
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <TextInput label="Nama promo" name="name" defaultValue={current?.name} required />
        <TextInput
          label="Label pada kartu"
          name="label"
          defaultValue={current?.label ?? 'Promo spesial'}
          required
        />
        <SelectInput
          label="Jenis diskon"
          name="discountType"
          defaultValue={current?.discountType ?? 'PERCENTAGE'}
        >
          <option value="PERCENTAGE">Persentase</option>
          <option value="FIXED_AMOUNT">Nominal tetap</option>
        </SelectInput>
        <TextInput
          label="Nilai diskon"
          name="discountValue"
          type="number"
          min="1"
          defaultValue={current?.discountValue ?? 10}
          required
        />
        <TextInput
          label="Mulai aktif"
          name="activeFrom"
          type="datetime-local"
          defaultValue={current ? current.activeFrom.slice(0, 16) : ''}
          required
        />
        <TextInput
          label="Berakhir"
          name="activeUntil"
          type="datetime-local"
          defaultValue={current ? current.activeUntil.slice(0, 16) : ''}
          required
        />
        <TextInput
          label="Alasan perubahan"
          name="reason"
          minLength={3}
          placeholder="Contoh: Promo pembukaan periode Agustus"
          required
        />
      </form>
    </Drawer>
  );
}
