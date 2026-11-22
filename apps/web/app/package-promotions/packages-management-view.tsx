'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Badge, DataTable, Pagination, Panel, StatCard, TableActionMenu } from '../components/admin/admin-ui';
import { AlertBanner, Drawer, Modal, useAppFeedback } from '../components/app-feedback';
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
import { BarAksiMassal, DialogMaksTemanMassal, type PaketTerpilih } from './maks-teman-massal';

const stateLabels = {
  ACTIVE: 'Aktif',
  SCHEDULED: 'Terjadwal',
  EXPIRED: 'Berakhir',
  INACTIVE: 'Tidak aktif',
} as const;

const isLiveOrActiveState = (state?: string) => state === 'ACTIVE' || state === 'LIVE';
const packageStateLabel = (state?: string) =>
  state === 'LIVE' ? stateLabels.ACTIVE : (stateLabels[state as keyof typeof stateLabels] ?? stateLabels.INACTIVE);

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
  bawaTeman?: boolean;
  maksTeman?: number;
  perpanjanganMasaAktif?: boolean;
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
  const [pricingPackage, setPricingPackage] = useState<InternalPackageRecord | null>(null);
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
    (session.hasCapability('package-promotion:read', 'package-promotion:manage') ||
      session.hasCapability('master:manage', 'package:read'));
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
    shareable: searchParams.get('shareable') ?? '',
    classTypeId: searchParams.get('classType') ?? '',
    branchId: session?.activeBranchId ?? '',
    cursor: searchParams.get('cursor') ?? '',
  };
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  // Pilihan untuk edit massal; bisa lintas halaman, dikosongkan saat filter berubah.
  const [terpilih, setTerpilih] = useState<Map<string, PaketTerpilih>>(new Map());
  const [massalOpen, setMassalOpen] = useState(false);
  const [memilihSemua, setMemilihSemua] = useState(false);
  const replaceFilter = (key: 'q' | 'state' | 'branch' | 'cursor' | 'shareable' | 'classType', value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'cursor') {
      next.delete('cursor');
      setCursorHistory([]);
      setTerpilih(new Map());
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
        shareable: filters.shareable || undefined,
        classTypeId: filters.classTypeId || undefined,
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
  }, [canRead, filters.branchId, filters.cursor, filters.effectiveState, filters.q, filters.shareable, filters.classTypeId]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    // Tipe kelas dipakai filter daftar dan form paket.
    if (canRead && classTypes.length === 0)
      void browserMasterClient
        .listClassTypes()
        .then((items) =>
          setClassTypes(items.map(({ id, name, branchScopes }) => ({ id, name, branchScopes }))),
        )
        .catch(() => undefined);
  }, [canRead, classTypes.length]);

  const keTerpilih = (item: InternalPackageRecord): PaketTerpilih => ({
    id: item.id,
    name: item.name,
    maksTeman: jumlahTeman(item),
    effectiveState: item.effectiveState ?? item.status ?? '',
    effectiveUntil: item.effectiveUntil ?? null,
    perpanjanganMasaAktif: Boolean(item.perpanjanganMasaAktif),
  });
  const semuaHalamanTerpilih = page.items.length > 0 && page.items.every((item) => terpilih.has(item.id));
  const pilihHalaman = (pilih: boolean) =>
    setTerpilih((prev) => {
      const next = new Map(prev);
      for (const item of page.items) {
        if (pilih) next.set(item.id, keTerpilih(item));
        else next.delete(item.id);
      }
      return next;
    });
  const pilihSatu = (item: InternalPackageRecord, pilih: boolean) =>
    setTerpilih((prev) => {
      const next = new Map(prev);
      if (pilih) next.set(item.id, keTerpilih(item));
      else next.delete(item.id);
      return next;
    });
  const pilihSemuaHasilFilter = async () => {
    setMemilihSemua(true);
    try {
      const { items } = await browserPackagePromotionClient.maksTemanKandidat({
        q: filters.q || undefined,
        effectiveState: filters.effectiveState || undefined,
        shareable: filters.shareable || undefined,
        classTypeId: filters.classTypeId || undefined,
        branchId: filters.branchId || undefined,
      });
      setTerpilih(new Map(items.map((item) => [item.id, item])));
    } catch (error) {
      feedback.showAlert({
        tone: 'danger',
        title: 'Belum bisa memilih semua paket',
        message: await promotionFailure(error, 'Daftar paket hasil filter belum dapat dimuat. Coba lagi.'),
      });
    } finally {
      setMemilihSemua(false);
    }
  };

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
      bawaTeman: Boolean(source.bawaTeman),
      maksTeman: jumlahTeman(source),
      perpanjanganMasaAktif: Boolean(source.perpanjanganMasaAktif),
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
      <Panel className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-[1fr_200px_200px_200px]">
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
        <SelectInput
          label="Tipe penggunaan"
          value={filters.shareable}
          onChange={(event) => replaceFilter('shareable', event.target.value)}
        >
          <option value="">Semua tipe</option>
          <option value="true">Bisa Dipakai Bersama</option>
          <option value="false">Biasa</option>
        </SelectInput>
        <SelectInput
          label="Tipe kelas"
          value={filters.classTypeId}
          onChange={(event) => replaceFilter('classType', event.target.value)}
        >
          <option value="">Semua tipe kelas</option>
          {classTypes.map((ct) => (
            <option key={ct.id} value={ct.id}>
              {ct.name}
            </option>
          ))}
        </SelectInput>
      </Panel>
      {canManage && semuaHalamanTerpilih && totalPackages > page.items.length && terpilih.size < totalPackages && (
        <div className="flex flex-wrap items-center gap-3 rounded-dd-md border border-dd-line bg-dd-surface-muted px-4 py-2 text-sm">
          <span>{page.items.length} paket di halaman ini terpilih.</span>
          <Button size="sm" variant="secondary" loading={memilihSemua} onClick={() => void pilihSemuaHasilFilter()}>
            Pilih semua hasil filter ({totalPackages} paket)
          </Button>
        </div>
      )}
      {error && <AlertBanner tone="danger" title="Paket tidak tersedia" message={error} onDismiss={() => setError('')} />}
      {canManage && page.items.length > 0 && (
        <label className="flex min-h-11 cursor-pointer items-center gap-3 px-1 text-sm font-medium md:hidden">
          <input
            type="checkbox"
            className="accent-dd-forest size-5 cursor-pointer"
            checked={semuaHalamanTerpilih}
            onChange={(event) => pilihHalaman(event.target.checked)}
          />
          Pilih semua di halaman ini
        </label>
      )}
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
            ...(canManage
              ? [
                  {
                    id: 'select',
                    className: 'w-12',
                    header: (
                      <label className="-m-2 inline-flex size-11 cursor-pointer items-center justify-center">
                        <input
                          type="checkbox"
                          className="accent-dd-forest size-5 cursor-pointer"
                          aria-label="Pilih semua paket di halaman ini"
                          checked={semuaHalamanTerpilih}
                          onChange={(event) => pilihHalaman(event.target.checked)}
                        />
                      </label>
                    ),
                    cell: (item: InternalPackageRecord) => (
                      <label
                        className="-m-2 inline-flex size-11 cursor-pointer items-center justify-center"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          className="accent-dd-forest size-5 cursor-pointer"
                          aria-label={`Pilih ${item.name}`}
                          checked={terpilih.has(item.id)}
                          onChange={(event) => pilihSatu(item, event.target.checked)}
                        />
                      </label>
                    ),
                  },
                ]
              : []),
            {
              id: 'package',
              header: 'Paket',
              cell: (item) => (
                <div>
                  <div className="flex items-center gap-1.5">
                    <strong>{item.name}</strong>
                    {item.isShareable && <Badge tone="success">Duet / Family</Badge>}
                    {item.perpanjanganMasaAktif && <Badge tone="warning">Perpanjangan masa aktif</Badge>}
                  </div>
                  <p className="text-xs text-dd-muted">
                    {item.perpanjanganMasaAktif
                      ? 'Tanpa sesi · tambah masa aktif 30 hari'
                      : `${item.sessionCount} sesi · ${item.durationDays} hari`}
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
            {
              id: 'price',
              header: 'Harga normal',
              cell: (item) => (
                <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
                  <span>{formatRupiah(item.priceRp)}</span>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Ubah harga ${item.name}`}
                      leadingIcon={<Pencil className="size-4" aria-hidden="true" />}
                      onClick={() => setPricingPackage(item)}
                    >
                      Ubah
                    </Button>
                  )}
                </div>
              ),
            },
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
                  <Badge tone={isLiveOrActiveState(item.effectiveState) ? 'success' : 'neutral'}>
                    {packageStateLabel(item.effectiveState)}
                  </Badge>
                  {item.livePromotion && <Badge tone="warning">Promo live</Badge>}
                  {jumlahTeman(item) > 0 && (
                    <Badge tone="neutral">
                      {jumlahTeman(item) === 1 ? 'Bawa teman' : `Bawa ${jumlahTeman(item)} teman`}
                    </Badge>
                  )}
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
                  {canManage && (
                    <label
                      className="-m-2 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        className="accent-dd-forest size-5 cursor-pointer"
                        aria-label={`Pilih ${item.name}`}
                        checked={terpilih.has(item.id)}
                        onChange={(event) => pilihSatu(item, event.target.checked)}
                      />
                    </label>
                  )}
                  <div className="min-w-0 flex-1">
                    <strong>{item.name}</strong>
                    {item.isShareable && (
                      <div className="mt-0.5">
                        <Badge tone="success">Duet / Family</Badge>
                      </div>
                    )}
                  </div>
                  <Badge tone={isLiveOrActiveState(item.effectiveState) ? 'success' : 'neutral'}>
                    {packageStateLabel(item.effectiveState)}
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
                    {canManage && (
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={`Ubah harga ${item.name}`}
                        onClick={() => setPricingPackage(item)}
                      >
                        Ubah harga
                      </Button>
                    )}
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

      <BarAksiMassal
        jumlah={canManage ? terpilih.size : 0}
        onUbah={() => setMassalOpen(true)}
        onBatal={() => setTerpilih(new Map())}
      />
      <DialogMaksTemanMassal
        open={massalOpen}
        paket={[...terpilih.values()]}
        onClose={() => setMassalOpen(false)}
        onKeluarkan={(ids) =>
          setTerpilih((prev) => {
            const next = new Map(prev);
            for (const id of ids) next.delete(id);
            return next;
          })
        }
        onSaved={async (jumlah) => {
          setMassalOpen(false);
          setTerpilih(new Map());
          feedback.showToast({
            tone: 'success',
            title: 'Maksimal teman tersimpan',
            message: `${jumlah} paket diperbarui. Booking berikutnya langsung memakai angka baru.`,
          });
          await load();
        }}
      />
      <UbahHargaModal pkg={pricingPackage} onClose={() => setPricingPackage(null)} onSaved={load} />
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
  const [perpanjangan, setPerpanjangan] = useState(Boolean(initialValues?.perpanjanganMasaAktif));
  const [selectedBranches, setSelectedBranches] = useState<string[]>(
    initialValues?.selectedBranches ?? [],
  );
  const [selectedClassTypes, setSelectedClassTypes] = useState<string[]>(
    initialValues?.selectedClassTypes ?? [],
  );
  const [businessKey, setBusinessKey] = useState(initialValues?.businessKey ?? '');

  useEffect(() => {
    if (initialValues?.businessKey !== undefined) {
      setBusinessKey(initialValues.businessKey);
    }
  }, [initialValues?.businessKey]);

  const generateBusinessKey = () => {
    const monthYear = new Intl.DateTimeFormat('id-ID', { month: 'short', year: '2-digit' })
      .format(new Date())
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase();
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    const generated = `PKG-${monthYear}-${rand}`;
    setBusinessKey(generated);
    onDirty();
  };

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
          businessKey: String(data.get('businessKey') || businessKey),
          name: String(data.get('name')),
          sessionCount: Number(data.get('sessionCount')),
          durationDays: Number(data.get('durationDays')),
          priceRp: Number(data.get('priceRp')),
          effectiveFrom: String(data.get('effectiveFrom')),
          effectiveUntil: data.get('effectiveUntil') || null,
          maksTeman: Number(data.get('maksTeman') || 0),
          perpanjanganMasaAktif: perpanjangan,
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
                  required={!perpanjangan && selectedClassTypes.length === 0}
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
        <PerpanjanganCheckbox
          checked={perpanjangan}
          onChange={(checked) => {
            setPerpanjangan(checked);
            onDirty();
          }}
        />
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="input-businessKey" className="text-sm font-semibold text-dd-ink">
              Business key
            </label>
            <button
              type="button"
              onClick={generateBusinessKey}
              className="inline-flex items-center gap-1 text-xs font-semibold text-dd-forest hover:text-dd-forest/80 cursor-pointer"
            >
              <Sparkles className="size-3" />
              <span>Generate Otomatis</span>
            </button>
          </div>
          <TextInput
            id="input-businessKey"
            name="businessKey"
            placeholder="Contoh: PKG-10X-GROUP"
            value={businessKey}
            onChange={(e) => {
              setBusinessKey(e.target.value);
              onDirty();
            }}
            maxLength={32}
            required
          />
        </div>
        <TextInput
          name="name"
          label="Nama paket"
          placeholder="Contoh: 10 Sessions Starter"
          defaultValue={initialValues?.name ?? ''}
          required
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {perpanjangan ? (
          <TextInput
            key="sessionCount-perpanjangan"
            name="sessionCount"
            label="Jumlah sesi"
            type="number"
            value={0}
            readOnly
            description="Paket perpanjangan selalu 0 sesi."
          />
        ) : (
          <TextInput
            key="sessionCount-biasa"
            name="sessionCount"
            label="Jumlah sesi"
            type="number"
            min={1}
            placeholder="Contoh: 10"
            defaultValue={initialValues?.sessionCount || ''}
            required
          />
        )}
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
      <MaksTemanInput defaultValue={initialValues ? jumlahTeman(initialValues) : 0} />
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

/** Paket yang belum pernah dibeli dan belum berlaku boleh diubah harganya di tempat. */
export function bisaUbahKomersialDiTempat(pkg: InternalPackageRecord, now = Date.now()) {
  return (
    (pkg._count?.purchases ?? 0) === 0 &&
    (pkg._count?.customerPackages ?? 0) === 0 &&
    new Date(pkg.effectiveFrom).getTime() > now
  );
}

/**
 * Menyimpan perubahan paket. Harga/sesi/masa berlaku paket yang sudah berlaku atau sudah dibeli
 * dicatat sebagai revisi baru (mulai hari ini) supaya pembelian lama tidak berubah.
 */
export async function simpanPerubahanPaket(
  pkg: InternalPackageRecord,
  ubah: {
    name: string;
    sessionCount: number;
    durationDays: number;
    priceRp: number;
    effectiveUntil: string | null;
    maksTeman: number;
    isShareable: boolean;
    perpanjanganMasaAktif: boolean;
    reason: string;
  },
) {
  const diTempat = bisaUbahKomersialDiTempat(pkg);
  const komersialBerubah =
    ubah.sessionCount !== pkg.sessionCount ||
    ubah.durationDays !== pkg.durationDays ||
    ubah.priceRp !== pkg.priceRp;
  if (komersialBerubah && !diTempat) {
    await browserPackagePromotionClient.revisePackage(pkg.id, {
      expectedVersion: pkg.version,
      ...ubah,
      effectiveFrom: new Date().toISOString().slice(0, 10),
    });
    return;
  }
  await browserPackagePromotionClient.updatePackage(pkg.id, {
    expectedVersion: pkg.version,
    name: ubah.name,
    isShareable: ubah.isShareable,
    effectiveUntil: ubah.effectiveUntil,
    ...(diTempat
      ? { sessionCount: ubah.sessionCount, durationDays: ubah.durationDays, priceRp: ubah.priceRp }
      : {}),
    maksTeman: ubah.maksTeman,
    perpanjanganMasaAktif: ubah.perpanjanganMasaAktif,
    reason: ubah.reason,
  });
}

/** Alasan perubahan harga yang paling sering; tetap bisa ditulis sendiri. */
export const ALASAN_UBAH_HARGA = [
  'Penyesuaian harga berkala',
  'Koreksi salah input harga',
  'Menyamakan harga antarcabang',
] as const;

/**
 * Ubah harga dari baris daftar paket: satu isian harga dan alasan (chip atau tulis sendiri).
 * Isian lain paket tidak berubah. Alasan tetap wajib karena tercatat di audit (Rules 3.11).
 */
export function UbahHargaModal({
  pkg,
  onClose,
  onSaved,
}: {
  pkg: InternalPackageRecord | null;
  onClose(): void;
  onSaved(): Promise<void>;
}) {
  const feedback = useAppFeedback();
  const [harga, setHarga] = useState('');
  const [alasan, setAlasan] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setHarga(pkg ? String(pkg.priceRp) : '');
    setAlasan('');
    setError('');
  }, [pkg]);

  if (!pkg) return null;
  const nilai = Number(harga.replace(/\D/g, ''));
  const siap = nilai > 0 && nilai !== pkg.priceRp && alasan.trim().length >= 3;

  const simpan = async () => {
    if (!siap) return;
    setBusy(true);
    setError('');
    try {
      await simpanPerubahanPaket(pkg, {
        name: pkg.name,
        sessionCount: pkg.sessionCount,
        durationDays: pkg.durationDays,
        priceRp: nilai,
        effectiveUntil: pkg.effectiveUntil ? pkg.effectiveUntil.slice(0, 10) : null,
        maksTeman: jumlahTeman(pkg),
        isShareable: Boolean(pkg.isShareable),
        perpanjanganMasaAktif: Boolean(pkg.perpanjanganMasaAktif),
        reason: alasan.trim(),
      });
      feedback.showToast({
        tone: 'success',
        title: 'Harga paket diperbarui',
        message: `${pkg.name} kini ${formatRupiah(nilai)}.`,
      });
      onClose();
      await onSaved();
    } catch (cause) {
      setError(await promotionFailure(cause, 'Harga belum tersimpan. Data mungkin berubah; muat ulang lalu coba lagi.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={Boolean(pkg)}
      title={`Ubah harga ${pkg.name}`}
      description={
        bisaUbahKomersialDiTempat(pkg)
          ? 'Paket belum berlaku, jadi harganya langsung diganti.'
          : 'Harga baru berlaku mulai hari ini sebagai revisi paket. Member yang sudah membeli tidak terpengaruh.'
      }
      busy={busy}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Batal
          </Button>
          <Button loading={busy} disabled={!siap} onClick={() => void simpan()}>
            Simpan harga
          </Button>
        </div>
      }
    >
      <div className="grid gap-3">
        {error && <AlertBanner tone="danger" title="Harga belum tersimpan" message={error} onDismiss={() => setError('')} />}
        <TextInput
          label="Harga normal (Rp)"
          inputMode="numeric"
          value={harga}
          onChange={(event) => setHarga(event.target.value)}
          description={`Sekarang ${formatRupiah(pkg.priceRp)}`}
        />
        <div className="flex flex-wrap gap-2" role="group" aria-label="Pilihan cepat alasan">
          {ALASAN_UBAH_HARGA.map((teks) => (
            <button
              key={teks}
              type="button"
              aria-pressed={alasan === teks}
              onClick={() => setAlasan(teks)}
              className={`min-h-11 rounded-dd-md border px-3 text-left text-sm ${
                alasan === teks
                  ? 'border-dd-forest bg-dd-success-soft font-semibold text-dd-forest'
                  : 'border-dd-border-interactive bg-white text-dd-ink hover:border-dd-forest'
              }`}
            >
              {teks}
            </button>
          ))}
        </div>
        <TextInput
          label="Alasan perubahan"
          value={alasan}
          minLength={3}
          onChange={(event) => setAlasan(event.target.value)}
          description="Tercatat di riwayat harga paket."
        />
      </div>
    </Modal>
  );
}

export function EditPackageModal({
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
  const [perpanjangan, setPerpanjangan] = useState(Boolean(pkg?.perpanjanganMasaAktif));

  useEffect(() => {
    if (pkg) {
      setIsShareable(Boolean(pkg.isShareable));
      setPerpanjangan(Boolean(pkg.perpanjanganMasaAktif));
    }
  }, [pkg]);

  if (!pkg) return null;

  const canEditCommercialInPlace = bisaUbahKomersialDiTempat(pkg);

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
          const maksTeman = Number(data.get('maksTeman') || 0);

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
            await simpanPerubahanPaket(pkg, {
              name,
              sessionCount,
              durationDays,
              priceRp,
              effectiveUntil,
              maksTeman,
              isShareable,
              perpanjanganMasaAktif: perpanjangan,
              reason,
            });
            feedback.showToast({
              tone: 'success',
              title: 'Paket diperbarui',
              message: `Perubahan paket ${name} berhasil disimpan.`,
            });
            setDirty(false);
            onClose();
            await onSaved();
          } catch (cause) {
            setError(
              await promotionFailure(
                cause,
                'Gagal memperbarui paket. Data mungkin telah berubah atau input tidak valid.',
              ),
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <AlertBanner tone="danger" title="Perubahan belum tersimpan" message={error} onDismiss={() => setError('')} />}

        <div className="rounded-dd-md border border-dd-line bg-dd-surface-muted/50 p-3 text-xs text-dd-muted">
          Business Key:{' '}
          <code className="font-mono font-semibold text-dd-ink">{pkg.businessKey}</code> · Status:{' '}
          <strong className="font-semibold text-dd-forest">{packageStateLabel(pkg.effectiveState)}</strong>.
          {!canEditCommercialInPlace && (
            <p className="mt-1">
              Catatan:{' '}
              {isLiveOrActiveState(pkg.effectiveState)
                ? 'Paket ini sudah aktif'
                : 'Paket ini sudah melewati tanggal mulai atau memiliki transaksi'}
              . Jika mengubah harga, kuota sesi, atau masa berlaku, sistem akan mencatatnya sebagai{' '}
              <strong>revisi baru</strong> yang aman bagi member aktif.
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
          <PerpanjanganCheckbox
            checked={perpanjangan}
            onChange={(checked) => {
              setDirty(true);
              setPerpanjangan(checked);
            }}
          />
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
          {perpanjangan ? (
            <TextInput
              key="sessionCount-perpanjangan"
              name="sessionCount"
              label="Jumlah sesi"
              type="number"
              value={0}
              readOnly
              description="Paket perpanjangan selalu 0 sesi."
            />
          ) : (
            <TextInput
              key="sessionCount-biasa"
              name="sessionCount"
              label="Jumlah sesi"
              type="number"
              min={1}
              defaultValue={pkg.sessionCount || ''}
              required
            />
          )}
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

        <MaksTemanInput defaultValue={jumlahTeman(pkg)} />
        <TextInput
          name="reason"
          label="Alasan perubahan (Audit Log)"
          minLength={3}
          placeholder="Contoh: Pembaruan tarif sesi kuartal baru"
          list="alasan-ubah-paket"
          required
        />
        <datalist id="alasan-ubah-paket">
          {ALASAN_UBAH_HARGA.map((teks) => (
            <option key={teks} value={teks} />
          ))}
        </datalist>
      </form>
    </Drawer>
  );
}

/** Centang jenis paket "Perpanjangan masa aktif" (dipakai form buat dan ubah paket). */
function PerpanjanganCheckbox({ checked, onChange }: { checked: boolean; onChange(checked: boolean): void }) {
  return (
    <label className="flex min-h-[44px] items-start gap-2 text-sm cursor-pointer">
      <input
        type="checkbox"
        name="perpanjanganMasaAktif"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 accent-dd-forest cursor-pointer size-4 shrink-0 rounded"
      />
      <div>
        <span className="font-semibold text-dd-forest">Perpanjangan masa aktif</span>
        <p className="text-xs text-dd-muted">
          Paket tanpa sesi (jumlah sesi otomatis 0). Setelah lunas, masa aktif satu paket member yang
          masih aktif bertambah 30 hari, paling banyak 3 kali per paket. Pembeli memilih paket yang
          diperpanjang saat membeli.
        </p>
      </div>
    </label>
  );
}

/** Kursi teman per kelas sebuah paket; data lama hanya punya centang `bawaTeman` (= 1 teman). */
export function jumlahTeman(item: { bawaTeman?: boolean; maksTeman?: number }): number {
  if (typeof item.maksTeman === 'number') return item.maksTeman;
  return item.bawaTeman ? 1 : 0;
}

/** Isian jumlah teman per kelas; 0 berarti paket tidak boleh bawa teman. */
function MaksTemanInput({ defaultValue }: { defaultValue: number }) {
  return (
    <TextInput
      name="maksTeman"
      label="Maksimal teman per kelas"
      type="number"
      min={0}
      max={5}
      step={1}
      inputMode="numeric"
      defaultValue={String(defaultValue)}
      description="Isi 0 bila paket tidak boleh bawa teman. Isi 2 supaya pemilik paket bisa datang bertiga. Setiap kursi teman memakai 1 sesi paket ini dan bisa ditambahkan admin dari roster atau oleh member saat booking."
      required
    />
  );
}
