'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Badge, DataTable, Pagination, Panel, StatCard, TableActionMenu } from '../components/admin/admin-ui';
import { AlertBanner, Drawer, useAppFeedback } from '../components/app-feedback';
import { Button } from '../components/actions';
import { SearchInput, SelectInput, TextInput } from '../components/forms';
import { Skeleton } from '../ui';
import { useSessionContext } from '../session-context';
import {
  browserPackagePromotionClient,
  promotionFailure,
  type InternalPackageRecord,
  type PackageManagementPage,
} from '@/api-clients/package-promotion-client';
import { useTrackedRouter } from '../components/app-loading';
import { LifecycleDialog, type LifecycleAction } from '../components/admin/lifecycle-dialog';
import { browserMasterClient } from '@/api-clients/master-client';
import { formatRupiah } from '../lib/formatters';
import { ADMIN_PAGE_SIZE, pageOffset } from '../lib/pagination';

const stateLabels = {
  ACTIVE: 'Aktif',
  SCHEDULED: 'Terjadwal',
  EXPIRED: 'Berakhir',
  INACTIVE: 'Tidak aktif',
} as const;

export type PackageFormValues = {
  name?: string;
  businessKey?: string;
  sessionCount?: number;
  durationDays?: number;
  priceRp?: number;
  effectiveFrom?: string;
  effectiveUntil?: string | null;
  isMultiBranch?: boolean;
  isShareable?: boolean;
  selectedBranches?: string[];
  selectedClassTypes?: string[];
  reason?: string;
};

export function PackagesManagementView() {
  const session = useSessionContext();
  const router = useTrackedRouter();
  const pathname = usePathname() ?? '/workspace/packages';
  const searchParams = useSearchParams();
  const feedback = useAppFeedback();
  const [page, setPage] = useState<PackageManagementPage>({
    items: [],
    summary: {},
    page: { hasMore: false, nextCursor: null },
  });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createDirty, setCreateDirty] = useState(false);
  const [editingPackage, setEditingPackage] = useState<InternalPackageRecord | null>(null);
  const [duplicateTemplate, setDuplicateTemplate] = useState<PackageFormValues | null>(null);
  const [lifecycle, setLifecycle] = useState<{ item: InternalPackageRecord; action: LifecycleAction } | null>(null);
  const [classTypes, setClassTypes] = useState<
    Array<{
      id: string;
      name: string;
      branchScopes: Array<{ branchId: string; active: boolean }>;
    }>
  >([]);
  const canRead =
    session?.status === 'authenticated' &&
    session.hasCapability('package-promotion:read', 'package-promotion:manage');
  const canManage = session?.status === 'authenticated' && session.hasCapability('master:manage');
  const confirmDiscardCreate = () =>
    feedback.confirm({
      tone: 'warning',
      title: duplicateTemplate ? 'Batalkan duplikasi paket?' : 'Batalkan pembuatan paket?',
      message: 'Input paket yang belum disimpan akan hilang.',
      confirmLabel: 'Buang input',
    });
  const closeCreate = async () => {
    if (!createDirty || (await confirmDiscardCreate())) {
      setCreateDirty(false);
      setCreateOpen(false);
      setDuplicateTemplate(null);
    }
  };
  const filters = {
    q: searchParams.get('q') ?? '',
    effectiveState: searchParams.get('state') ?? '',
    branchId: session?.activeBranchId ?? '',
    cursor: searchParams.get('cursor') ?? '',
  };
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const replaceFilter = (key: 'q' | 'state' | 'branch' | 'cursor', value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'cursor') {
      next.delete('cursor');
      setCursorHistory([]);
    }
    router.replace(`${pathname}${next.size ? `?${next}` : ''}`);
  };
  const movePage = (direction: 'previous' | 'next') => {
    const next = new URLSearchParams(searchParams.toString());
    if (direction === 'next') {
      if (!page.page.nextCursor) return;
      setCursorHistory((prev) => [...prev, filters.cursor]);
      next.set('cursor', page.page.nextCursor);
    } else {
      const previous = cursorHistory.at(-1) ?? '';
      setCursorHistory((prev) => prev.slice(0, -1));
      if (!previous) next.delete('cursor');
      else next.set('cursor', previous);
    }
    router.replace(`${pathname}${next.size ? `?${next}` : ''}`);
  };
  const totalPackages = useMemo(() => {
    if (filters.effectiveState && page.summary[filters.effectiveState as keyof typeof page.summary] != null) {
      return page.summary[filters.effectiveState as keyof typeof page.summary] ?? page.items.length;
    }
    const sum = Object.values(page.summary).reduce((acc, val) => (acc ?? 0) + (val ?? 0), 0);
    return sum > 0 ? sum : page.items.length;
  }, [filters.effectiveState, page.summary, page.items.length]);
  const load = useCallback(async () => {
    if (!canRead) return;
    setBusy(true);
    setError('');
    try {
      const result = await browserPackagePromotionClient.packages({
        q: filters.q || undefined,
        effectiveState: filters.effectiveState || undefined,
        branchId: filters.branchId || undefined,
        cursor: filters.cursor || undefined,
      });
      if (result.items.length === 0 && cursorHistory.length > 0) {
        movePage('previous');
        return;
      }
      setPage({
        items: result.items ?? [],
        summary: result.summary ?? {},
        page: result.page ?? { hasMore: false, nextCursor: null },
      });
    } catch {
      setError('Daftar paket belum dapat dimuat. Periksa cakupan atau coba lagi.');
    } finally {
      setBusy(false);
    }
  }, [canRead, filters.branchId, filters.cursor, filters.effectiveState, filters.q]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (createOpen)
      void browserMasterClient
        .listClassTypes()
        .then((items) =>
          setClassTypes(items.map(({ id, name, branchScopes }) => ({ id, name, branchScopes }))),
        );
  }, [createOpen]);

  const duplicatePackage = (source: InternalPackageRecord) => {
    const today = new Date().toISOString().slice(0, 10);
    const effectiveUntil = source.effectiveUntil
      ? new Date(source.effectiveUntil).toISOString().slice(0, 10)
      : '';
    const branchIds =
      source.branchScopes && source.branchScopes.length > 0
        ? (source.branchScopes.map((s) => s.branchId || s.branch?.id).filter(Boolean) as string[])
        : source.branchId
          ? [source.branchId]
          : source.branch?.id
            ? [source.branch.id]
            : [];
    const classTypeIds =
      source.classTypeScopes && source.classTypeScopes.length > 0
        ? (source.classTypeScopes
            .map((s) => s.classTypeId || s.classType?.id)
            .filter(Boolean) as string[])
        : source.classTypeId
          ? [source.classTypeId]
          : source.classType?.id
            ? [source.classType.id]
            : [];

    setDuplicateTemplate({
      name: `${source.name} (Salinan)`,
      businessKey: `${source.businessKey}-copy`,
      sessionCount: source.sessionCount,
      durationDays: source.durationDays,
      priceRp: source.priceRp,
      effectiveFrom: today,
      effectiveUntil,
      isMultiBranch: Boolean(source.isMultiBranch),
      isShareable: Boolean(source.isShareable),
      selectedBranches: branchIds,
      selectedClassTypes: classTypeIds,
      reason: `Duplikasi dari paket ${source.name}`,
    });
    setCreateOpen(true);
  };

  const togglePackageState = async (item: InternalPackageRecord) => {
    const isActive = item.effectiveState === 'ACTIVE' || item.status === 'ACTIVE';
    if (isActive) {
      setLifecycle({ item, action: 'deactivate' });
      return;
    }
    const accepted = await feedback.confirm({
      tone: 'warning',
      title: 'Aktifkan kembali paket?',
      message: `Paket "${item.name}" akan kembali tersedia untuk dibeli pelanggan.`,
      confirmLabel: 'Aktifkan kembali',
    });
    if (!accepted) return;
    setBusy(true);
    try {
      await browserPackagePromotionClient.transitionPackage(item.id, 'reactivate', item.version);
      feedback.showToast({
        tone: 'success',
        title: 'Paket diaktifkan kembali',
        message: `Paket "${item.name}" berhasil diaktifkan kembali.`,
      });
      await load();
    } catch (error) {
      feedback.showAlert({
        tone: 'danger',
        title: 'Gagal mengubah status paket',
        message: await promotionFailure(error, 'Periksa koneksi atau versi paket, lalu coba kembali.'),
      });
    } finally {
      setBusy(false);
    }
  };

  const deletePackage = (item: InternalPackageRecord) => setLifecycle({ item, action: 'delete' });
  if (!session || session.status === 'loading') return <Skeleton label="Memuat paket" />;
  if (!canRead)
    return (
      <AlertBanner
        tone="danger"
        title="Akses terbatas"
        message="Anda tidak memiliki akses membaca paket dan promo."
      />
    );
  return (
    <section className="grid gap-5" aria-labelledby="packages-management-title">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-dd-line pb-5">
        <div>
          <p className="text-[13px] font-bold text-dd-forest">
            Master data
          </p>
          <h1 id="packages-management-title" className="mt-1 text-3xl font-semibold">
            Paket & promo harga
          </h1>
          <p className="mt-2 text-sm text-dd-muted">
            Kelola paket aktif, revisi harga, histori periode, dan promo tanpa mengubah order lama.
          </p>
        </div>
        {canManage && (
          <Button
            leadingIcon={<Plus className="size-4" aria-hidden="true" />}
            onClick={() => {
              setDuplicateTemplate(null);
              setCreateOpen(true);
            }}
          >
            Buat paket
          </Button>
        )}
      </header>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(Object.keys(stateLabels) as Array<keyof typeof stateLabels>).map((state) => (
          <button
            key={state}
            type="button"
            className="text-left"
            onClick={() => replaceFilter('state', filters.effectiveState === state ? '' : state)}
          >
            <StatCard
              label={stateLabels[state]}
              value={String((page.summary ?? {})[state] ?? 0)}
              tone={state === 'ACTIVE' ? 'success' : 'neutral'}
            />
          </button>
        ))}
      </div>
      <Panel className="grid gap-3 p-4 md:grid-cols-[1fr_220px_220px]">
        <SearchInput
          label="Cari paket"
          value={filters.q}
          onChange={(event) => replaceFilter('q', event.target.value)}
          placeholder="Nama atau business key"
        />
        <SelectInput
          label="Status efektif"
          value={filters.effectiveState}
          onChange={(event) => replaceFilter('state', event.target.value)}
        >
          <option value="">Semua status</option>
          {Object.entries(stateLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectInput>
      </Panel>
      {error && <AlertBanner tone="danger" title="Paket tidak tersedia" message={error} />}
      <Panel className="p-0">
        <DataTable
          items={page.items}
          loading={busy}
          rowNumberOffset={pageOffset(cursorHistory.length)}
          rowKey={(item) => item.id}
          onRowClick={(item) => router.push(`/workspace/packages/${item.id}`)}
          rowDescription={(item) => `Buka detail ${item.name}`}
          emptyTitle="Paket tidak ditemukan"
          emptyDescription="Ubah filter atau buat paket baru pada cabang yang sesuai."
          columns={[
            {
              id: 'package',
              header: 'Paket',
              cell: (item) => (
                <div>
                  <div className="flex items-center gap-1.5">
                    <strong>{item.name}</strong>
                    {item.isShareable && <Badge tone="success">Duet / Family</Badge>}
                  </div>
                  <p className="text-xs text-dd-muted">
                    {item.sessionCount} sesi · {item.durationDays} hari
                  </p>
                </div>
              ),
            },
            {
              id: 'branch',
              header: 'Cakupan Studio/Cabang',
              cell: (item) => (
                <div>
                  {item.isMultiBranch ? (
                    <Badge tone="success">Semua Cabang (Multi-Branch)</Badge>
                  ) : (
                    <Badge tone="neutral">
                      {(item.branch?.name ??
                        item.branchScopes
                          ?.map((scope) => scope.branch?.name ?? scope.branchId.slice(0, 8))
                          .join(', ')) || 'Single-Branch'}
                    </Badge>
                  )}
                </div>
              ),
            },
            { id: 'price', header: 'Harga normal', cell: (item) => formatRupiah(item.priceRp) },
            {
              id: 'period',
              header: 'Periode',
              cell: (item) => (
                <span className="text-xs">
                  {new Date(item.effectiveFrom).toLocaleDateString('id-ID')} –{' '}
                  {item.effectiveUntil
                    ? new Date(item.effectiveUntil).toLocaleDateString('id-ID')
                    : 'tanpa batas'}
                </span>
              ),
            },
            {
              id: 'status',
              header: 'Status',
              cell: (item) => (
                <div className="flex flex-wrap gap-1">
                  <Badge tone={item.effectiveState === 'ACTIVE' ? 'success' : 'neutral'}>
                    {stateLabels[item.effectiveState ?? 'INACTIVE']}
                  </Badge>
                  {item.livePromotion && <Badge tone="warning">Promo live</Badge>}
                </div>
              ),
            },
            {
              id: 'action',
              header: 'Tindakan',
              className: 'whitespace-nowrap',
              cell: (item) => {
                const isActive = item.effectiveState === 'ACTIVE' || item.status === 'ACTIVE';
                return (
                  <div
                    className="flex items-center gap-1.5"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => router.push(`/workspace/packages/${item.id}`)}
                    >
                      Lihat detail
                    </Button>
                    {canManage && (
                      <TableActionMenu
                        label={`Pilihan tindakan untuk ${item.name}`}
                        items={[
                          {
                            id: 'edit',
                            label: 'Edit paket',
                            icon: <Pencil className="size-4" />,
                            onClick: () => setEditingPackage(item),
                          },
                          {
                            id: 'duplicate',
                            label: 'Duplikasi konfigurasi',
                            icon: <Copy className="size-4" />,
                            onClick: () => duplicatePackage(item),
                          },
                          {
                            id: 'toggle',
                            label: isActive ? 'Nonaktifkan' : 'Aktifkan kembali',
                            tone: isActive ? 'warning' : 'success',
                            disabled: busy,
                            onClick: () => void togglePackageState(item),
                          },
                          {
                            id: 'delete',
                            label: 'Hapus paket',
                            icon: <Trash2 className="size-4" />,
                            tone: 'danger',
                            disabled: busy,
                            divider: true,
                            onClick: () => deletePackage(item),
                          },
                        ]}
                      />
                    )}
                  </div>
                );
              },
            },
          ]}
          mobileCard={(item) => {
            const isActive = item.effectiveState === 'ACTIVE' || item.status === 'ACTIVE';
            return (
              <div className="grid gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <strong>{item.name}</strong>
                    {item.isShareable && (
                      <div className="mt-0.5">
                        <Badge tone="success">Duet / Family</Badge>
                      </div>
                    )}
                  </div>
                  <Badge tone={item.effectiveState === 'ACTIVE' ? 'success' : 'neutral'}>
                    {stateLabels[item.effectiveState ?? 'INACTIVE']}
                  </Badge>
                </div>
                <div>
                  {item.isMultiBranch ? (
                    <Badge tone="success">Semua Cabang (Multi-Branch)</Badge>
                  ) : (
                    <span className="text-sm text-dd-muted">
                      {item.branch?.name ||
                        item.branchScopes
                          ?.map((scope) => scope.branch?.name)
                          .filter(Boolean)
                          .join(', ') || 'Single-Branch'}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className="font-semibold">{formatRupiah(item.priceRp)}</span>
                  <div
                    className="flex items-center gap-1.5"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => router.push(`/workspace/packages/${item.id}`)}
                    >
                      Detail
                    </Button>
                    {canManage && (
                      <TableActionMenu
                        label={`Pilihan tindakan untuk ${item.name}`}
                        items={[
                          {
                            id: 'edit',
                            label: 'Edit paket',
                            icon: <Pencil className="size-4" />,
                            onClick: () => setEditingPackage(item),
                          },
                          {
                            id: 'duplicate',
                            label: 'Duplikasi konfigurasi',
                            icon: <Copy className="size-4" />,
                            onClick: () => duplicatePackage(item),
                          },
                          {
                            id: 'toggle',
                            label: isActive ? 'Nonaktifkan' : 'Aktifkan kembali',
                            tone: isActive ? 'warning' : 'success',
                            disabled: busy,
                            onClick: () => void togglePackageState(item),
                          },
                          {
                            id: 'delete',
                            label: 'Hapus paket',
                            icon: <Trash2 className="size-4" />,
                            tone: 'danger',
                            disabled: busy,
                            divider: true,
                            onClick: () => deletePackage(item),
                          },
                        ]}
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          }}
        />
      </Panel>
      <Pagination
        currentPage={cursorHistory.length + 1}
        totalPages={Math.ceil(totalPackages / ADMIN_PAGE_SIZE) || 1}
        totalItems={totalPackages}
        pageSize={ADMIN_PAGE_SIZE}
        hasPrevious={cursorHistory.length > 0}
        hasNext={Boolean(page.page.nextCursor)}
        totalLabel={`${page.items.length.toLocaleString('id-ID')} dari ${totalPackages.toLocaleString('id-ID')} paket`}
        onPrevious={() => movePage('previous')}
        onNext={() => movePage('next')}
      />
      <Drawer
        open={createOpen}
        className="max-w-2xl"
        title={duplicateTemplate ? 'Duplikasi paket' : 'Buat paket'}
        description={
          duplicateTemplate
            ? `Duplikasi konfigurasi dari "${duplicateTemplate.name?.replace(' (Salinan)', '')}". Sesuaikan parameter lalu simpan sebagai paket baru.`
            : 'Paket adalah katalog global dengan cakupan Studio/Cabang dan tipe kelas yang eksplisit.'
        }
        busy={busy}
        dirty={createDirty}
        onDirtyClose={confirmDiscardCreate}
        onClose={() => {
          setCreateDirty(false);
          setCreateOpen(false);
          setDuplicateTemplate(null);
        }}
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => void closeCreate()} disabled={busy}>
              Batal
            </Button>
            <Button type="submit" form="package-create-form" loading={busy}>
              {duplicateTemplate ? 'Simpan duplikasi paket' : 'Simpan paket'}
            </Button>
          </div>
        }
      >
        <PackageCreateForm
          key={
            duplicateTemplate
              ? `${duplicateTemplate.businessKey}-${duplicateTemplate.name}`
              : 'new-package'
          }
          branches={session.session?.branches ?? []}
          classTypes={classTypes}
          initialValues={duplicateTemplate}
          onDirty={() => setCreateDirty(true)}
          onSubmit={async (command) => {
            const isDuplicate = Boolean(duplicateTemplate);
            const accepted = await feedback.confirm({
              tone: 'warning',
              title: isDuplicate ? 'Buat paket hasil duplikasi?' : 'Buat paket baru?',
              message: isDuplicate
                ? 'Paket baru hasil duplikasi akan tersimpan sebagai konfigurasi aktif pada periode yang dipilih.'
                : 'Paket akan tersimpan sebagai konfigurasi aktif pada periode yang dipilih.',
              confirmLabel: isDuplicate ? 'Duplikasi paket' : 'Buat paket',
            });
            if (!accepted) return;
            setBusy(true);
            try {
              const created = await browserPackagePromotionClient.createPackage(command);
              setCreateDirty(false);
              setCreateOpen(false);
              setDuplicateTemplate(null);
              feedback.showToast({
                tone: 'success',
                title: isDuplicate ? 'Paket berhasil diduplikasi' : 'Paket dibuat',
                message: `${created.name} berhasil ditambahkan.`,
              });
              router.push(`/workspace/packages/${created.id}`);
            } catch (error) {
              const message = await promotionFailure(
                error,
                'Gagal membuat paket. Periksa kelengkapan data, koneksi, atau wewenang akun lalu coba kembali.',
              );
              feedback.showAlert({
                tone: 'danger',
                title: isDuplicate ? 'Duplikasi paket belum berhasil' : 'Paket belum dibuat',
                message,
              });
            } finally {
              setBusy(false);
            }
          }}
        />
      </Drawer>

      <EditPackageModal
        pkg={editingPackage}
        open={Boolean(editingPackage)}
        onClose={() => setEditingPackage(null)}
        onSaved={load}
      />
      <LifecycleDialog
        request={
          lifecycle
            ? { kind: 'package', id: lifecycle.item.id, name: lifecycle.item.name, action: lifecycle.action }
            : null
        }
        deactivate={(reason) =>
          browserPackagePromotionClient.transitionPackage(
            lifecycle!.item.id,
            'deactivate',
            lifecycle!.item.version,
            reason,
          )
        }
        onClose={() => setLifecycle(null)}
        onDone={async (message) => {
          setLifecycle(null);
          feedback.showToast({ tone: 'success', title: 'Paket diperbarui', message });
          await load();
        }}
      />
    </section>
  );
}

function PackageCreateForm({
  branches,
  classTypes,
  initialValues,
  onDirty,
  onSubmit,
}: {
  branches: Array<{ id: string; name: string }>;
  classTypes: Array<{
    id: string;
    name: string;
    branchScopes: Array<{ branchId: string; active: boolean }>;
  }>;
  initialValues?: PackageFormValues | null;
  onDirty(): void;
  onSubmit(command: Record<string, unknown>): Promise<void>;
}) {
  const [isMultiBranch, setIsMultiBranch] = useState(
    initialValues?.isMultiBranch !== undefined ? initialValues.isMultiBranch : true,
  );
  const [isShareable, setIsShareable] = useState(
    initialValues?.isShareable !== undefined ? initialValues.isShareable : false,
  );
  const [selectedBranches, setSelectedBranches] = useState<string[]>(
    initialValues?.selectedBranches ?? [],
  );
  const [selectedClassTypes, setSelectedClassTypes] = useState<string[]>(
    initialValues?.selectedClassTypes ?? [],
  );

  const availableClassTypes = isMultiBranch
    ? classTypes.filter((classType) =>
        classType.branchScopes?.some((scope) => scope.active),
      )
    : classTypes.filter((classType) =>
        selectedBranches.length > 0 &&
        selectedBranches.every((branchId) =>
          classType.branchScopes?.some((scope) => scope.branchId === branchId && scope.active),
        ),
      );

  return (
    <form
      id="package-create-form"
      className="grid gap-4"
      onChange={onDirty}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const branchIds = isMultiBranch
          ? branches.map((b) => b.id)
          : selectedBranches;
        const branchId = isMultiBranch ? null : (selectedBranches[0] || null);

        void onSubmit({
          isMultiBranch,
          isShareable,
          branchIds,
          branchId,
          classTypeIds: selectedClassTypes,
          businessKey: String(data.get('businessKey')),
          name: String(data.get('name')),
          sessionCount: Number(data.get('sessionCount')),
          durationDays: Number(data.get('durationDays')),
          priceRp: Number(data.get('priceRp')),
          effectiveFrom: String(data.get('effectiveFrom')),
          effectiveUntil: data.get('effectiveUntil') || null,
          reason: String(data.get('reason')),
        });
      }}
    >
      {initialValues && (
        <div className="rounded-dd-sm border border-dd-forest/20 bg-dd-forest/5 p-3 text-xs text-dd-forest">
          <strong>Mode Duplikasi:</strong> Parameter konfigurasi disalin dari paket sebelumnya. Silakan sesuaikan Business Key, nama, masa berlaku, atau harga sebelum menyimpan.
        </div>
      )}
      <fieldset className="grid gap-3 rounded-dd-md border border-dd-line p-3">
        <legend className="px-1 text-sm font-semibold">Tipe Akses Studio / Cabang</legend>
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input
            type="radio"
            name="scopeRadio"
            checked={isMultiBranch}
            onChange={() => {
              setIsMultiBranch(true);
              setSelectedBranches([]);
            }}
            className="mt-1 accent-dd-forest cursor-pointer size-4 shrink-0"
          />
          <div>
            <span className="font-semibold text-dd-forest">Semua Cabang (Multi-Branch)</span>
            <p className="text-xs text-dd-muted">
              Member dapat booking dan latihan di seluruh studio/cabang Daily Dose Pilates.
            </p>
          </div>
        </label>

        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input
            type="radio"
            name="scopeRadio"
            checked={!isMultiBranch}
            onChange={() => {
              setIsMultiBranch(false);
              if (branches[0] && selectedBranches.length === 0) {
                setSelectedBranches([branches[0].id]);
              }
            }}
            className="mt-1 accent-dd-forest cursor-pointer size-4 shrink-0"
          />
          <div>
            <span className="font-semibold text-dd-forest">Cabang Tertentu (Single-Branch)</span>
            <p className="text-xs text-dd-muted">
              Member hanya dapat booking dan latihan di cabang tertentu yang dipilih di bawah.
            </p>
          </div>
        </label>

        {!isMultiBranch && (
          <div className="mt-2 grid gap-2 border-t border-dd-line pt-2">
            <p className="text-[13px] font-bold text-dd-muted">Pilih Cabang:</p>
            {branches.map((branch) => (
              <label className="flex items-center gap-2 text-sm cursor-pointer" key={branch.id}>
                <input
                  type="radio"
                  name="singleBranchSelect"
                  value={branch.id}
                  checked={selectedBranches[0] === branch.id}
                  onChange={() => setSelectedBranches([branch.id])}
                  className="accent-dd-forest cursor-pointer size-4"
                />
                {branch.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="grid gap-2 rounded-dd-md border border-dd-line p-3">
        <legend className="px-1 text-sm font-semibold">Cakupan Tipe Kelas</legend>
        {!isMultiBranch && selectedBranches.length === 0 ? (
          <p className="text-sm text-dd-muted">Pilih Studio/Cabang terlebih dahulu.</p>
        ) : availableClassTypes.length === 0 ? (
          <p className="text-sm text-dd-danger">
            Tidak ada tipe kelas yang tersedia untuk studio terpilih.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {availableClassTypes.map((item) => (
              <label className="flex items-center gap-2 text-sm cursor-pointer" key={item.id}>
                <input
                  type="checkbox"
                  name="classTypeIds"
                  value={item.id}
                  checked={selectedClassTypes.includes(item.id)}
                  required={selectedClassTypes.length === 0}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setSelectedClassTypes((current) =>
                      checked
                        ? [...new Set([...current, item.id])]
                        : current.filter((id) => id !== item.id),
                    );
                  }}
                  className="accent-dd-forest cursor-pointer size-4 rounded"
                />
                <span>{item.name}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <fieldset className="grid gap-2 rounded-dd-md border border-dd-line p-3">
        <legend className="px-1 text-sm font-semibold">Tipe Penggunaan Paket</legend>
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            name="isShareable"
            checked={isShareable}
            onChange={(e) => setIsShareable(e.target.checked)}
            className="mt-1 accent-dd-forest cursor-pointer size-4 shrink-0 rounded"
          />
          <div>
            <span className="font-semibold text-dd-forest">Bisa Dipakai Bersama (Family / Duet Package)</span>
            <p className="text-xs text-dd-muted">
              Jika dicentang, pembeli paket dapat mendaftarkan teman atau anggota keluarga untuk ikut memakai sisa sesi dari paket ini.
            </p>
          </div>
        </label>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput
          name="businessKey"
          label="Business key"
          placeholder="Contoh: PKG-10X-GROUP"
          defaultValue={initialValues?.businessKey ?? ''}
          maxLength={32}
          required
        />
        <TextInput
          name="name"
          label="Nama paket"
          placeholder="Contoh: 10 Sessions Starter"
          defaultValue={initialValues?.name ?? ''}
          required
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <TextInput
          name="sessionCount"
          label="Jumlah sesi"
          type="number"
          min={1}
          placeholder="Contoh: 10"
          defaultValue={initialValues?.sessionCount ?? ''}
          required
        />
        <TextInput
          name="durationDays"
          label="Masa berlaku (hari)"
          type="number"
          min={1}
          placeholder="Contoh: 60"
          defaultValue={initialValues?.durationDays ?? ''}
          required
        />
        <TextInput
          name="priceRp"
          label="Harga normal"
          type="number"
          min={1}
          placeholder="Contoh: 2500000"
          defaultValue={initialValues?.priceRp ?? ''}
          required
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput
          name="effectiveFrom"
          label="Mulai berlaku"
          type="date"
          defaultValue={initialValues?.effectiveFrom ?? ''}
          required
        />
        <TextInput
          name="effectiveUntil"
          label="Berakhir (opsional)"
          type="date"
          defaultValue={initialValues?.effectiveUntil ?? ''}
        />
      </div>
      <TextInput
        name="reason"
        label="Alasan"
        placeholder="Alasan pembuatan / audit log"
        minLength={3}
        defaultValue={initialValues?.reason ?? ''}
        required
      />
    </form>
  );
}

function EditPackageModal({
  pkg,
  open,
  onClose,
  onSaved,
}: {
  pkg: InternalPackageRecord | null;
  open: boolean;
  onClose(): void;
  onSaved(): Promise<void>;
}) {
  const feedback = useAppFeedback();
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [isShareable, setIsShareable] = useState(Boolean(pkg?.isShareable));

  useEffect(() => {
    if (pkg) setIsShareable(Boolean(pkg.isShareable));
  }, [pkg]);

  if (!pkg) return null;

  const canEditCommercialInPlace =
    (pkg._count?.purchases ?? 0) === 0 &&
    (pkg._count?.customerPackages ?? 0) === 0 &&
    new Date(pkg.effectiveFrom).getTime() > Date.now();

  const confirmDiscard = () =>
    feedback.confirm({
      tone: 'warning',
      title: 'Batalkan perubahan paket?',
      message: 'Perubahan yang belum disimpan akan hilang.',
      confirmLabel: 'Buang perubahan',
    });

  const handleClose = async () => {
    if (!dirty || (await confirmDiscard())) {
      setDirty(false);
      setError('');
      onClose();
    }
  };

  return (
    <Drawer
      open={open}
      className="max-w-2xl"
      title={`Ubah Paket: ${pkg.name}`}
      description="Perbarui informasi nama, masa berlaku, kuota sesi, atau harga paket."
      busy={busy}
      dirty={dirty}
      onDirtyClose={confirmDiscard}
      onClose={() => void handleClose()}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => void handleClose()} disabled={busy}>
            Batal
          </Button>
          <Button type="submit" form="package-edit-form" loading={busy}>
            Simpan perubahan
          </Button>
        </div>
      }
    >
      <form
        id="package-edit-form"
        className="grid gap-4"
        onChange={() => setDirty(true)}
        onSubmit={async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const name = String(data.get('name') || '').trim();
          const sessionCount = Number(data.get('sessionCount'));
          const durationDays = Number(data.get('durationDays'));
          const priceRp = Number(data.get('priceRp'));
          const effectiveUntil = data.get('effectiveUntil') ? String(data.get('effectiveUntil')) : null;
          const reason = String(data.get('reason') || '').trim();

          const commercialChanged =
            sessionCount !== pkg.sessionCount ||
            durationDays !== pkg.durationDays ||
            priceRp !== pkg.priceRp;

          const accepted = await feedback.confirm({
            tone: 'warning',
            title: 'Simpan perubahan paket?',
            message:
              commercialChanged && !canEditCommercialInPlace
                ? 'Perubahan harga/sesi akan dicatat sebagai revisi paket baru secara otomatis. Order lama tidak terpengaruh.'
                : 'Perubahan metadata paket akan langsung disimpan pada katalog aktif.',
            confirmLabel: 'Simpan perubahan',
          });
          if (!accepted) return;

          setBusy(true);
          setError('');
          try {
            if (commercialChanged && !canEditCommercialInPlace) {
              await browserPackagePromotionClient.revisePackage(pkg.id, {
                expectedVersion: pkg.version,
                name,
                sessionCount,
                durationDays,
                priceRp,
                effectiveFrom: new Date().toISOString().slice(0, 10),
                effectiveUntil,
                isShareable,
                reason,
              });
            } else {
              await browserPackagePromotionClient.updatePackage(pkg.id, {
                expectedVersion: pkg.version,
                name,
                isShareable,
                ...(canEditCommercialInPlace
                  ? { sessionCount, durationDays, priceRp, effectiveUntil }
                  : {}),
                reason,
              });
            }
            feedback.showToast({
              tone: 'success',
              title: 'Paket diperbarui',
              message: `Perubahan paket ${name} berhasil disimpan.`,
            });
            setDirty(false);
            onClose();
            await onSaved();
          } catch {
            setError('Gagal memperbarui paket. Data mungkin telah berubah atau input tidak valid.');
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <AlertBanner tone="danger" title="Perubahan belum tersimpan" message={error} />}

        <div className="rounded-dd-md border border-dd-line bg-dd-surface-muted/50 p-3 text-xs text-dd-muted">
          Business Key:{' '}
          <code className="font-mono font-semibold text-dd-ink">{pkg.businessKey}</code> · Status:{' '}
          <strong className="font-semibold text-dd-forest">{stateLabels[pkg.effectiveState ?? 'INACTIVE']}</strong>.
          {!canEditCommercialInPlace && (
            <p className="mt-1">
              Catatan: Paket ini sudah aktif. Jika mengubah harga, kuota sesi, atau masa berlaku, sistem akan mencatatnya sebagai <strong>revisi baru</strong> yang aman bagi member aktif.
            </p>
          )}
        </div>

        <fieldset className="grid gap-2 rounded-dd-md border border-dd-line p-3">
          <legend className="px-1 text-sm font-semibold">Tipe Penggunaan Paket</legend>
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              name="isShareable"
              checked={isShareable}
              onChange={(e) => {
                setDirty(true);
                setIsShareable(e.target.checked);
              }}
              className="mt-1 accent-dd-forest cursor-pointer size-4 shrink-0 rounded"
            />
            <div>
              <span className="font-semibold text-dd-forest">Bisa Dipakai Bersama (Family / Duet Package)</span>
              <p className="text-xs text-dd-muted">
                Dapat didaftarkan anggota keluarga atau teman untuk memakai kuota sesi bersama.
              </p>
            </div>
          </label>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput
            name="name"
            label="Nama paket"
            defaultValue={pkg.name}
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
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
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
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput
            name="effectiveFrom"
            label="Mulai berlaku"
            type="date"
            defaultValue={pkg.effectiveFrom.slice(0, 10)}
            disabled
          />
          <TextInput
            name="effectiveUntil"
            label="Berakhir (opsional)"
            type="date"
            defaultValue={pkg.effectiveUntil ? pkg.effectiveUntil.slice(0, 10) : ''}
          />
        </div>

        <TextInput
          name="reason"
          label="Alasan perubahan (Audit Log)"
          minLength={3}
          placeholder="Contoh: Pembaruan tarif sesi kuartal baru"
          required
        />
      </form>
    </Drawer>
  );
}
