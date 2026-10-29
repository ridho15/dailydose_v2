'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  browserMasterClient,
  masterFailureMessage,
  type DampakHapusTarif,
  type MasterClient,
  type MasterKind,
  type MasterSetting,
} from '@/api-clients/master-client';
import { EmptyState, Feedback, StatusBadge } from '../ui';
import { AdminPageHeader } from '../components/admin/admin-page-header';
import { useActiveBranchState, useSessionContext } from '../session-context';
import { browserIdentityClient, type LookupOption } from '@/api-clients/identity-client';
import { Pagination, StatCard, TableActionMenu, Tabs } from '../components/admin/admin-ui';
import { LifecycleDialog, type LifecycleAction } from '../components/admin/lifecycle-dialog';
import { ReasonDialog } from '../components/admin/reason-dialog';
import { ADMIN_PAGE_SIZE } from '../lib/pagination';
import { Button } from '../components/actions';
import {
  AsyncSearchSelect,
  DateInput,
  SearchInput,
  SearchSelect,
  SelectInput,
  TextInput,
} from '../components/forms';
import { Modal, useAppFeedback } from '../components/app-feedback';
import { Archive, Globe, Pencil, Plus, Power, Store, Trash2 } from 'lucide-react';
import { formatRupiah } from '../lib/formatters';

type BranchPage = Awaited<ReturnType<MasterClient['listBranches']>>;
type Branches = BranchPage['items'];
type ClassTypes = Awaited<ReturnType<MasterClient['listClassTypes']>>;
export type MasterTab =
  | 'classTypes'
  | 'capacity'
  | 'fees';

const kindLabels: Record<MasterKind, string> = {
  QUOTA_CAPACITY: 'Kuota & kapasitas kelas',
  INSTRUCTOR_FEE: 'Honor instruktur',
};

const dateValue = (value: Date | string | null) =>
  value
    ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(new Date(value))
    : 'Tanpa batas';

function settingValue(item: MasterSetting) {
  const value = item.value as Record<string, unknown>;
  if (item.kind === 'QUOTA_CAPACITY')
    return `Minimum ${value.minimumQuota ?? '—'} · kapasitas ${value.defaultCapacity ?? '—'}`;
  const amount = Number(item.kind === 'INSTRUCTOR_FEE' ? value.feeRp : value.rateRp);
  return Number.isFinite(amount) ? formatRupiah(amount) : '—';
}

const allTabItems: { id: MasterTab; label: string; kind?: MasterKind }[] = [
  { id: 'classTypes', label: 'Tipe Kelas' },
  { id: 'capacity', label: 'Kuota & Kapasitas', kind: 'QUOTA_CAPACITY' },
  { id: 'fees', label: 'Honor Instruktur', kind: 'INSTRUCTOR_FEE' },
];

const tabToKind = (tab: MasterTab): MasterKind => {
  if (tab === 'fees') return 'INSTRUCTOR_FEE';
  return 'QUOTA_CAPACITY';
};

/** Kalimat konfirmasi hapus tarif; untuk versi yang sudah berlaku menyebut dampaknya pada honor. */
function keteranganHapus(item: MasterSetting, dampak: DampakHapusTarif | null): string {
  const nilai = `${settingValue(item)} yang berlaku mulai ${dateValue(item.effectiveFrom)}`;
  if (item.deletable) return `${nilai} akan dihapus.`;
  if (!dampak) return `${nilai} akan dihapus. Menghitung kelas yang terdampak…`;
  if (dampak.kelasTerdampak === 0)
    return `${nilai} akan dihapus. Tidak ada honor kelas yang berubah${dampak.duplikat ? ' (versi ini duplikat)' : ''}.`;
  return `${nilai} akan dihapus. Honor ${dampak.kelasTerdampak} kelas yang sudah selesai berubah dari ${formatRupiah(dampak.honorSekarangRp)} menjadi ${formatRupiah(dampak.honorSetelahHapusRp)}. Tercatat di audit bersama alasan Anda.`;
}

export function MasterView({
  client = browserMasterClient,
  activeTab = 'classTypes',
  onTabChange,
  access,
  visibleTabs,
}: {
  client?: MasterClient;
  activeTab?: MasterTab;
  onTabChange?: (tab: MasterTab) => void;
  access?: { canManage: boolean; canFinance: boolean; canCorrect?: boolean };
  visibleTabs?: MasterTab[];
}) {
  const tabItems = visibleTabs
    ? allTabItems.filter((item) => visibleTabs.includes(item.id))
    : allTabItems;
  const [branchId, setBranchId] = useActiveBranchState();
  const [selectedTab, setSelectedTab] = useState<MasterTab>(activeTab);
  const [kind, setKind] = useState<MasterKind>(() => tabToKind(activeTab));
  useEffect(() => {
    setSelectedTab(activeTab);
    setKind(tabToKind(activeTab));
  }, [activeTab]);
  const sessionContext = useSessionContext();
  const testAccess = process.env.NODE_ENV === 'test' ? access : undefined;
  const canManage =
    testAccess?.canManage ??
    (sessionContext?.status === 'authenticated' && sessionContext.hasCapability('master:manage'));
  const canFinance =
    testAccess?.canFinance ??
    (sessionContext?.status === 'authenticated' && sessionContext.hasCapability('finance:manage'));
  // Hanya Super Owner: hapus versi tarif yang sudah berlaku karena salah input.
  const canCorrect = testAccess
    ? Boolean(testAccess.canCorrect)
    : sessionContext?.status === 'authenticated' &&
      sessionContext.hasCapability('instructor-fee:correct');
  const [classTypeId, setClassTypeId] = useState('');
  const [dampakHapus, setDampakHapus] = useState<DampakHapusTarif | null>(null);
  const [branches, setBranches] = useState<Branches>([]);
  const [classTypes, setClassTypes] = useState<ClassTypes>([]);
  const [settings, setSettings] = useState<MasterSetting[]>([]);
  const [message, setMessage] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [settingSubmitting, setSettingSubmitting] = useState(false);
  const [editingClassType, setEditingClassType] = useState<ClassTypes[number]>();
  const [classTypeName, setClassTypeName] = useState('');
  const [classTypeReason, setClassTypeReason] = useState('');
  const feedback = useAppFeedback();
  const [instructor, setInstructor] = useState<LookupOption>();
  const [classTypeSearch, setClassTypeSearch] = useState('');
  const [classTypeStatusFilter, setClassTypeStatusFilter] = useState<'' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED'>('');
  const [isCreateClassTypeModalOpen, setIsCreateClassTypeModalOpen] = useState(false);

  // States for Settings (Fees, Quota)
  const [isCreateSettingModalOpen, setIsCreateSettingModalOpen] = useState(false);
  const [editingSetting, setEditingSetting] = useState<MasterSetting | null>(null);
  const [editingSettingValue, setEditingSettingValue] = useState('');
  const [editingSettingCapacity, setEditingSettingCapacity] = useState('');
  const [editingSettingEffectiveDate, setEditingSettingEffectiveDate] = useState('');
  const [editingSettingReason, setEditingSettingReason] = useState('');
  const [settingSearch, setSettingSearch] = useState('');

  const [settingToDelete, setSettingToDelete] = useState<MasterSetting | null>(null);
  const [quotaToDelete, setQuotaToDelete] = useState<MasterSetting | null>(null);
  const [archivedClassTypes, setArchivedClassTypes] = useState<ClassTypes>([]);
  const [classTypeLifecycle, setClassTypeLifecycle] = useState<{
    item: ClassTypes[number];
    action: LifecycleAction;
  } | null>(null);
  const loadArchivedClassTypes = () =>
    client.listClassTypes(undefined, 'ARCHIVED').then(setArchivedClassTypes).catch(() => setArchivedClassTypes([]));
  useEffect(() => {
    if (classTypeStatusFilter === 'ARCHIVED') void loadArchivedClassTypes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classTypeStatusFilter]);

  const filteredClassTypes = (classTypeStatusFilter === 'ARCHIVED' ? archivedClassTypes : classTypes).filter((item) => {
    if (classTypeStatusFilter === 'ACTIVE' && !item.active) return false;
    if (classTypeStatusFilter === 'INACTIVE' && item.active) return false;
    if (classTypeSearch.trim()) {
      const q = classTypeSearch.toLowerCase().trim();
      return item.name.toLowerCase().includes(q) || item.code.toLowerCase().includes(q);
    }
    return true;
  });

  const filteredSettings = useMemo(() => {
    if (!settingSearch.trim()) return settings;
    const q = settingSearch.toLowerCase().trim();
    return settings.filter((s) => {
      const classType = classTypes.find((c) => c.id === s.classTypeId);
      const ctMatch =
        classType?.name.toLowerCase().includes(q) || classType?.code.toLowerCase().includes(q);
      const instMatch = s.instructorName?.toLowerCase().includes(q);
      return Boolean(ctMatch || instMatch);
    });
  }, [settings, settingSearch, classTypes]);

  const [classTypePage, setClassTypePage] = useState(1);
  const [settingPage, setSettingPage] = useState(1);

  useEffect(() => {
    setClassTypePage(1);
  }, [classTypeSearch, classTypeStatusFilter]);

  useEffect(() => {
    setSettingPage(1);
  }, [settingSearch, branchId, selectedTab]);

  const totalClassTypePages = Math.ceil(filteredClassTypes.length / ADMIN_PAGE_SIZE) || 1;
  const pagedClassTypes = useMemo(() => {
    const start = (classTypePage - 1) * ADMIN_PAGE_SIZE;
    return filteredClassTypes.slice(start, start + ADMIN_PAGE_SIZE);
  }, [filteredClassTypes, classTypePage]);

  const totalSettingPages = Math.ceil(filteredSettings.length / ADMIN_PAGE_SIZE) || 1;
  const pagedSettings = useMemo(() => {
    const start = (settingPage - 1) * ADMIN_PAGE_SIZE;
    return filteredSettings.slice(start, start + ADMIN_PAGE_SIZE);
  }, [filteredSettings, settingPage]);

  const handleUpdateSetting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSetting) return;
    const reason = editingSettingReason.trim();
    if (reason.length < 3) {
      setFailure('Alasan perubahan wajib diisi (minimal 3 karakter).');
      return;
    }
    setSettingSubmitting(true);
    void run(async () => {
      try {
        const effDate =
          editingSettingEffectiveDate.trim() || new Date().toISOString().slice(0, 10);
        await client.createSetting({
          kind: editingSetting.kind,
          branchId: editingSetting.branchId || branchId,
          classTypeId: editingSetting.classTypeId,
          instructorUserId: editingSetting.instructorId,
          value: Number(editingSettingValue),
          capacity:
            editingSetting.kind === 'QUOTA_CAPACITY' ? Number(editingSettingCapacity) : undefined,
          effectiveFrom: effDate,
          reason,
        });
        setEditingSetting(null);
        await loadBranchContent(branchId, kind);
      } finally {
        setSettingSubmitting(false);
      }
    }, 'Konfigurasi berhasil diperbarui.');
  };

  // Auto-dismiss alert notification after 4 seconds
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(undefined), 4000);
    return () => window.clearTimeout(timer);
  }, [message]);

  const lookupInstructors = useCallback(
    (q: string) =>
      browserIdentityClient
        .lookupUsers({ q, branchId: branchId || undefined, instructorsOnly: true, limit: 10 })
        .then(({ items }) => items),
    [branchId],
  );

  const run = async (action: () => Promise<void>, success?: string) => {
    setFailure(undefined);
    setMessage(undefined);
    setLoading(true);
    try {
      await action();
      if (success) {
        setMessage(success);
      }
    } catch (error) {
      setFailure(masterFailureMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const deleteSetting = (item: MasterSetting) => {
    if (item.kind === 'QUOTA_CAPACITY') return;
    setDampakHapus(null);
    setSettingToDelete(item);
    // Versi yang sudah berlaku: tampilkan dulu kelas dan honor yang berubah bila dihapus.
    if (!item.deletable && client.dampakHapusTarif)
      void client
        .dampakHapusTarif(item.id)
        .then(setDampakHapus)
        .catch(() => setDampakHapus(null));
  };

  /** Form tarif baru selalu mulai kosong; tipe kelas dan instruktur sebelumnya tidak terbawa. */
  const bukaFormTarifBaru = () => {
    setClassTypeId('');
    setInstructor(undefined);
    setIsCreateSettingModalOpen(true);
  };

  const loadBranchContent = async (selectedBranchId: string, selectedKind = kind) => {
    try {
      const nextClassTypes = await client.listClassTypes(selectedBranchId || undefined, 'ALL');
      setClassTypes(nextClassTypes);
      setClassTypeId((current) =>
        nextClassTypes.some((item) => item.id === current && item.active)
          ? current
          : (nextClassTypes.find((item) => item.active)?.id ?? ''),
      );
    } catch {
      // Tetap lanjutkan jika catalog global sedang offline
    }

    if (!selectedBranchId) {
      setSettings([]);
      return;
    }
    const nextSettings = await client.listSettings(selectedKind, selectedBranchId);
    setSettings(nextSettings);
  };

  const loadBranches = async () => {
    const page = await client.listBranches({
      status: 'ACTIVE',
      limit: 100,
    });
    setBranches(page.items);
    return page;
  };

  const load = async (isManual = false) => {
    setFailure(undefined);
    if (isManual || testAccess) setMessage(undefined);
    setLoading(true);
    try {
      const page = await loadBranches();
      const nextBranches = page.items;
      const selectedBranchId =
        nextBranches.find((item) => item.id === branchId && item.active)?.id ??
        (branchId || undefined) ??
        nextBranches.find((item) => item.active)?.id ??
        '';
      setBranchId(selectedBranchId);
      await loadBranchContent(selectedBranchId, tabToKind(selectedTab));
      if (isManual || testAccess) {
        setMessage('Master data berhasil dimuat.');
      }
    } catch (error) {
      setFailure(masterFailureMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (sessionContext) {
      void load(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (sessionContext && branchId) {
      void loadBranchContent(branchId).catch((err) => setFailure(masterFailureMessage(err)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  return (
    <div className="space-y-6" aria-labelledby="master-title">
      {/* Top-Level Modern PageHeader */}
      <AdminPageHeader
        title="Data Master"
        titleId="master-title"
        description="Kelola katalog tipe kelas global serta konfigurasi kuota kapasitas dan honor instruktur."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={canManage ? 'success' : 'neutral'}>
              {canManage ? 'Dapat mengelola' : 'Akses baca'}
            </StatusBadge>
            <StatusBadge tone="success">Hak akses terverifikasi</StatusBadge>
            {sessionContext && (
              <div className="rounded-dd-sm border border-dd-line bg-dd-surface px-3 py-1.5 text-xs text-dd-muted">
                Konteks:{' '}
                <strong className="font-semibold text-dd-ink">
                  {sessionContext.activeBranch?.name ?? 'Pilih cabang dari topbar'}
                </strong>
              </div>
            )}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void load(true)}
              disabled={loading}
            >
              {loading ? 'Memuat…' : testAccess ? 'Muat master data' : 'Segarkan data master'}
            </Button>
          </div>
        }
      />

      {/* Summary Metric Cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Tipe kelas aktif"
          value={String(classTypes.filter((item) => item.active).length)}
        />
        <StatCard
          label="Cabang aktif"
          value={String(branches.filter((item) => item.active).length)}
        />
        <StatCard
          label="Konfigurasi aktif"
          value={String(settings.length)}
          tone="success"
        />
      </div>

      {/* Navigation Tabs Bar */}
      <div className="rounded-dd-lg border border-dd-line bg-dd-surface p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="w-full overflow-x-auto pb-1 no-scrollbar lg:w-auto">
            <Tabs
              wrap={false}
              items={tabItems.map((tab) => ({ value: tab.id, label: tab.label }))}
              value={selectedTab}
              onChange={(value) => {
                const tab = tabItems.find((item) => item.id === value);
                if (!tab) return;
                setSelectedTab(tab.id);
                onTabChange?.(tab.id);
                if (tab.kind) {
                  setKind(tab.kind);
                  const effectiveBranch = branchId || branches.find((b) => b.active)?.id || '';
                  if (effectiveBranch) {
                    if (!branchId) setBranchId(effectiveBranch);
                    void client
                      .listSettings(tab.kind, effectiveBranch)
                      .then(setSettings)
                      .catch((err) => setFailure(masterFailureMessage(err)));
                  }
                  if (!classTypes.length) {
                    void client
                      .listClassTypes(effectiveBranch || undefined, 'ALL')
                      .then(setClassTypes)
                      .catch(() => {});
                  }
                } else if (tab.id === 'classTypes') {
                  void client
                    .listClassTypes(undefined, 'ALL')
                    .then(setClassTypes)
                    .catch((err) => setFailure(masterFailureMessage(err)));
                }
              }}
            />
          </div>

          {testAccess && !sessionContext && (
            <div className="min-w-[240px]">
              <AsyncSearchSelect
                label="Cabang aktif"
                wrapperClassName="w-full"
                value={branchId}
                placeholder="Pilih cabang"
                selectedOption={
                  branches.find((item) => item.id === branchId)
                    ? {
                        id: branchId,
                        label: branches.find((item) => item.id === branchId)!.name,
                        description: branches.find((item) => item.id === branchId)!.code,
                      }
                    : undefined
                }
                loadOptions={async (q, cursor) => {
                  const page = await client.listBranches({
                    q: q.trim() || undefined,
                    status: 'ACTIVE',
                    cursor,
                    limit: 20,
                  });
                  return {
                    items: page.items.map((item) => ({
                      id: item.id,
                      label: item.name,
                      description: item.code,
                    })),
                    nextCursor: page.page.nextCursor ?? undefined,
                  };
                }}
                onChange={(selected) => {
                  setBranchId(selected);
                  void loadBranchContent(selected).catch((err) => setFailure(masterFailureMessage(err)));
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Dismissible Feedback Alerts */}
      {message && (
        <div className="relative">
          <Feedback kind="status">{message}</Feedback>
          <button
            className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-dd-success hover:text-dd-forest-dark"
            type="button"
            onClick={() => setMessage(undefined)}
            aria-label="Tutup notifikasi"
          >
            ✕
          </button>
        </div>
      )}
      {failure && (
        <div className="relative">
          <Feedback kind="error">{failure}</Feedback>
          <button
            className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-dd-danger hover:text-dd-ink"
            type="button"
            onClick={() => setFailure(undefined)}
            aria-label="Tutup pesan kesalahan"
          >
            ✕
          </button>
        </div>
      )}

      {/* Tab: Class Types (Standard 1-Pintu Full-Width CRUD Table) */}
      {selectedTab === 'classTypes' && (
        <div className="space-y-4">
          <section
            className="rounded-dd-lg border border-dd-line bg-dd-surface p-6"
            aria-labelledby="class-list-title"
          >
            {/* Header: Title, Total Badge, and [+ Tambah Tipe Kelas] */}
            <div className="flex flex-col gap-4 border-b border-dd-line pb-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2.5">
                  <h2 id="class-list-title" className="text-base font-semibold text-dd-ink">
                    Tipe kelas
                  </h2>
                  <StatusBadge tone="info">{classTypes.length} tipe kelas</StatusBadge>
                </div>
                <p className="mt-1 text-xs text-dd-muted">
                  Katalog tipe kelas global yang digunakan pada jadwal kelas di seluruh cabang studio
                </p>
              </div>
              <Button
                type="button"
                variant="primary"
                disabled={!canManage || loading}
                onClick={() => setIsCreateClassTypeModalOpen(true)}
              >
                <Plus className="mr-1.5 size-4" />
                Tambah tipe kelas
              </Button>
            </div>

            {/* Instant Search & Status Filter */}
            <div className="my-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
              <SearchInput
                label="Cari tipe kelas"
                value={classTypeSearch}
                placeholder="Cari kode atau nama kelas..."
                onChange={(event) => setClassTypeSearch(event.currentTarget.value)}
              />
              <SelectInput
                label="Status tipe kelas"
                value={classTypeStatusFilter}
                onChange={(event) =>
                  setClassTypeStatusFilter(event.currentTarget.value as '' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED')
                }
              >
                <option value="">Semua status</option>
                <option value="ACTIVE">Aktif</option>
                <option value="INACTIVE">Nonaktif</option>
                <option value="ARCHIVED">Diarsipkan</option>
              </SelectInput>
            </div>

            {/* Full-Width CRUD Data Table */}
            {filteredClassTypes.length ? (
              <div className="space-y-4">
                <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-dd-line text-[13px] text-dd-muted">
                    <tr>
                      <th className="w-12 pb-3 pt-2 font-semibold">No</th>
                      <th className="pb-3 pt-2 font-semibold">Kode Kelas</th>
                      <th className="pb-3 pt-2 font-semibold">Nama Tipe Kelas</th>
                      <th className="pb-3 pt-2 font-semibold">Cakupan Cabang</th>
                      <th className="w-24 pb-3 pt-2 font-semibold">Status</th>
                      <th className="w-64 pb-3 pt-2 text-right font-semibold">
                        <span className="sr-only">Aksi</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dd-line">
                    {pagedClassTypes.map((item, idx) => (
                      <tr key={item.id} className="hover:bg-dd-surface-muted/50">
                        <td className="py-3.5 text-xs text-dd-muted">
                          {(classTypePage - 1) * ADMIN_PAGE_SIZE + idx + 1}
                        </td>
                        <td className="py-3.5 font-mono text-xs font-semibold text-dd-ink">
                          {item.code}
                        </td>
                        <td className="py-3.5 font-medium text-dd-ink">{item.name}</td>
                        <td className="py-3.5 text-xs">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-dd-teal/10 px-2.5 py-0.5 text-xs font-medium text-dd-forest">
                            <Globe className="size-3" aria-hidden="true" />
                            Semua Cabang (Global)
                          </span>
                        </td>
                        <td className="py-3.5">
                          <StatusBadge tone={item.active ? 'success' : 'neutral'}>
                            {item.archivedAt ? 'Diarsipkan' : item.active ? 'Aktif' : 'Nonaktif'}
                          </StatusBadge>
                        </td>
                        <td className="py-3.5 text-right">
                          <TableActionMenu
                            ariaLabel={`Aksi tipe kelas ${item.name}`}
                            disabled={!canManage || loading}
                            items={[
                              {
                                key: 'edit',
                                label: 'Edit',
                                icon: <Pencil className="size-4" aria-hidden="true" />,
                                hidden: !item.active,
                                onClick: () => {
                                  setEditingClassType(item);
                                  setClassTypeName(item.name);
                                  setClassTypeReason('');
                                },
                              },
                              item.active
                                ? {
                                    key: 'deactivate',
                                    label: 'Nonaktifkan',
                                    icon: <Power className="size-4" aria-hidden="true" />,
                                    onClick: () => setClassTypeLifecycle({ item, action: 'deactivate' }),
                                  }
                                : {
                                    key: 'reactivate',
                                    label: item.archivedAt ? 'Buka arsip & aktifkan' : 'Aktifkan kembali',
                                    icon: <Power className="size-4" aria-hidden="true" />,
                                    onClick: () =>
                                      void (async () => {
                                        const confirmed = await feedback.confirm({
                                          title: item.archivedAt
                                            ? 'Buka arsip dan aktifkan tipe kelas?'
                                            : 'Aktifkan kembali tipe kelas?',
                                          message: `${item.name} kembali tersedia untuk konfigurasi dan kelas baru.`,
                                          confirmLabel: 'Aktifkan kembali',
                                        });
                                        if (!confirmed) return;
                                        await run(async () => {
                                          await client.reactivateClassType(item.id, {
                                            expectedVersion: item.version,
                                          });
                                          await loadBranchContent(branchId);
                                          if (classTypeStatusFilter === 'ARCHIVED') await loadArchivedClassTypes();
                                        }, 'Tipe kelas berhasil diaktifkan kembali.');
                                      })(),
                                  },
                              {
                                key: 'archive',
                                label: 'Arsipkan',
                                icon: <Archive className="size-4" aria-hidden="true" />,
                                hidden: Boolean(item.archivedAt),
                                onClick: () => setClassTypeLifecycle({ item, action: 'archive' }),
                              },
                              {
                                key: 'delete',
                                label: 'Hapus',
                                icon: <Trash2 className="size-4" aria-hidden="true" />,
                                tone: 'danger',
                                divider: true,
                                onClick: () => setClassTypeLifecycle({ item, action: 'delete' }),
                              },
                            ]}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                currentPage={classTypePage}
                totalPages={totalClassTypePages}
                totalItems={filteredClassTypes.length}
                pageSize={ADMIN_PAGE_SIZE}
                hasPrevious={classTypePage > 1}
                hasNext={classTypePage < totalClassTypePages}
                showPageNumbers
                totalLabel={`${filteredClassTypes.length.toLocaleString('id-ID')} tipe kelas`}
                onPageChange={(target) => setClassTypePage(target)}
                onPrevious={() => setClassTypePage((p) => Math.max(1, p - 1))}
                onNext={() => setClassTypePage((p) => Math.min(totalClassTypePages, p + 1))}
              />
            </div>
            ) : (
              <div className="mt-4">
                <EmptyState
                  title={
                    classTypeSearch || classTypeStatusFilter
                      ? 'Tipe kelas tidak ditemukan'
                      : 'Belum ada tipe kelas'
                  }
                  description={
                    classTypeSearch || classTypeStatusFilter
                      ? 'Coba ubah kata kunci pencarian atau filter status tipe kelas.'
                      : 'Tambahkan satu tipe kelas global, lalu tentukan cakupan Studio/Cabang.'
                  }
                />
              </div>
            )}
          </section>

          {/* Modal Dialog: Tambah Tipe Kelas */}
          <Modal
            open={isCreateClassTypeModalOpen}
            title="Tambah tipe kelas"
            description="Tipe kelas merupakan katalog global studio yang dapat langsung digunakan dan dijadwalkan di seluruh studio dan cabang."
            busy={loading}
            onClose={() => setIsCreateClassTypeModalOpen(false)}
            footer={
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={loading}
                  onClick={() => setIsCreateClassTypeModalOpen(false)}
                >
                  Batal
                </Button>
                <Button
                  type="submit"
                  form="create-class-type-form"
                  disabled={!canManage || loading}
                >
                  Simpan tipe kelas
                </Button>
              </div>
            }
          >
            <form
              id="create-class-type-form"
              aria-label="Buat class type"
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const data = new FormData(form);
                void run(async () => {
                  await client.createClassType({
                    code: String(data.get('code')).trim().toUpperCase(),
                    name: String(data.get('name')).trim(),
                    description: String(data.get('description')).trim() || undefined,
                  });
                  form.reset();
                  setIsCreateClassTypeModalOpen(false);
                  setClassTypes(await client.listClassTypes(undefined, 'ALL'));
                }, 'Tipe kelas berhasil dibuat.');
              }}
            >
              <div className="flex items-center gap-2.5 rounded-dd-sm border border-dd-teal/30 bg-dd-teal/5 p-3 text-xs text-dd-forest">
                <Globe className="size-4 shrink-0" aria-hidden="true" />
                <span>
                  <strong>Katalog Global:</strong> Tipe kelas ini otomatis tersedia dan dapat dijadwalkan di seluruh studio dan cabang Daily Dose.
                </span>
              </div>
              <TextInput label="Kode kelas" name="code" placeholder="Contoh: REFORMER" required />
              <TextInput label="Nama kelas" name="name" placeholder="Reformer Pilates" required />
              <TextInput
                label="Deskripsi (opsional)"
                name="description"
                placeholder="Contoh: Latihan pilates reformer untuk fleksibilitas dan kekuatan inti"
              />
            </form>
          </Modal>
        </div>
      )}


      {/* Tab: Capacity & Fees (Operational Settings) */}
      {['capacity', 'fees'].includes(selectedTab) && (
        <div className="space-y-6">
          {/* Pemilih Cabang Operasional Mandiri */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-dd-lg border border-dd-line bg-dd-surface p-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-dd-sm bg-dd-sand/40 text-dd-forest">
                <Store className="size-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-dd-ink">Cabang Operasional</p>
                <p className="text-xs text-dd-muted">
                  Kelola {kindLabels[kind].toLowerCase()} khusus untuk studio/cabang terpilih.
                </p>
              </div>
            </div>
            {branches.length > 0 && (
              <div className="w-full sm:w-72">
                <SelectInput
                  aria-label="Pilih cabang operasional"
                  value={branchId}
                  onChange={(e) => {
                    const newId = e.target.value;
                    setBranchId(newId);
                    void loadBranchContent(newId, kind);
                  }}
                >
                  {branches.filter((b) => b.active).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </option>
                  ))}
                </SelectInput>
              </div>
            )}
          </div>

          {/* Tabel Penuh CRUD Standar Konfigurasi */}
          <section
            className="rounded-dd-lg border border-dd-line bg-dd-surface p-6"
            aria-labelledby="setting-list-title"
          >
            {/* Header: Judul, Search Filter & Tombol Tambah */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-dd-line pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 id="setting-list-title" className="text-base font-semibold text-dd-ink">
                    {kindLabels[kind]}
                  </h2>
                  <StatusBadge tone="info">
                    {settings.length} versi
                  </StatusBadge>
                </div>
                <p className="mt-1 text-xs text-dd-muted">
                  Daftar tarif dan kuota operasional yang berlaku di cabang{' '}
                  <strong className="text-dd-ink">
                    {branches.find((b) => b.id === branchId)?.name ?? 'terpilih'}
                  </strong>
                  .
                  {kind !== 'QUOTA_CAPACITY' &&
                    ' Untuk mengubah nilai, buat versi baru. Versi yang keliru (salah tipe kelas atau duplikat) dapat dihapus oleh Super Owner.'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="w-64">
                  <TextInput
                    placeholder="Cari tipe kelas / instruktur…"
                    value={settingSearch}
                    onChange={(e) => setSettingSearch(e.target.value)}
                    aria-label="Cari konfigurasi"
                  />
                </div>
                <Button
                  onClick={bukaFormTarifBaru}
                  disabled={!canManage || (kind === 'INSTRUCTOR_FEE' && !canFinance)}
                >
                  {kind === 'INSTRUCTOR_FEE' ? '+ Atur honor baru' : '+ Atur kuota baru'}
                </Button>
              </div>
            </div>

            {/* List Data / Tabel */}
            {filteredSettings.length ? (
              <div className="mt-4 space-y-4">
                <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-dd-line text-[13px] text-dd-muted">
                    <tr>
                      <th className="w-12 pb-3 pt-2 text-center font-semibold">No</th>
                      <th className="pb-3 pt-2 font-semibold">Tipe kelas</th>
                      {kind === 'INSTRUCTOR_FEE' && (
                        <th className="pb-3 pt-2 font-semibold">Instruktur</th>
                      )}
                      <th className="pb-3 pt-2 font-semibold">
                        {kind === 'QUOTA_CAPACITY' ? 'Kuota & Kapasitas' : 'Nilai'}
                      </th>
                      <th className="pb-3 pt-2 font-semibold">Berlaku mulai</th>
                      <th className="pb-3 pt-2 font-semibold">Status</th>
                      <th className="pb-3 pt-2 text-right font-semibold">Tindakan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dd-line">
                    {pagedSettings.map((item, index) => {
                      const classType = classTypes.find((type) => type.id === item.classTypeId);
                      return (
                        <tr key={item.id} className="transition-colors hover:bg-dd-surface-muted/50">
                          <td className="py-3 text-center text-xs text-dd-muted">
                            {(settingPage - 1) * ADMIN_PAGE_SIZE + index + 1}
                          </td>
                          <td className="py-3 font-medium text-dd-ink">
                            <span>{classType?.name ?? item.classTypeId}</span>
                            {classType?.code && (
                              <span className="ml-2 rounded bg-dd-surface-muted px-1.5 py-0.5 text-[11px] font-normal text-dd-muted">
                                {classType.code}
                              </span>
                            )}
                          </td>
                          {kind === 'INSTRUCTOR_FEE' && (
                            <td className="py-3 text-dd-ink">
                              {item.instructorName ? (
                                <span className="font-medium">{item.instructorName}</span>
                              ) : (
                                <span className="text-dd-muted italic">—</span>
                              )}
                            </td>
                          )}
                          <td className="py-3 font-semibold text-dd-ink">{settingValue(item)}</td>
                          <td className="py-3 text-dd-muted">{dateValue(item.effectiveFrom)}</td>
                          <td className="py-3">
                            {item.kind === 'QUOTA_CAPACITY' ? (
                              <StatusBadge tone="success">Berlaku</StatusBadge>
                            ) : item.deletable ? (
                              <StatusBadge tone="info">Akan berlaku</StatusBadge>
                            ) : (
                              <StatusBadge tone="neutral">Sudah berlaku</StatusBadge>
                            )}
                            {item.duplikat && (
                              <span className="ml-1.5">
                                <StatusBadge tone="warning">Duplikat</StatusBadge>
                              </span>
                            )}
                          </td>
                          <td className="py-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={!canManage || (kind === 'INSTRUCTOR_FEE' && !canFinance)}
                                onClick={() => {
                                  setEditingSetting(item);
                                  const val = item.value as Record<string, unknown>;
                                  if (item.kind === 'INSTRUCTOR_FEE') {
                                    setEditingSettingValue(String(val.feeRp ?? ''));
                                  } else {
                                    setEditingSettingValue(String(val.minimumQuota ?? '1'));
                                    setEditingSettingCapacity(
                                      String(val.defaultCapacity ?? val.capacity ?? '10'),
                                    );
                                  }
                                  setEditingSettingEffectiveDate(
                                    new Date().toISOString().slice(0, 10),
                                  );
                                  setEditingSettingReason('');
                                }}
                              >
                                Versi baru
                              </Button>
                              {kind === 'QUOTA_CAPACITY' && canManage && (
                                <Button
                                  size="sm"
                                  variant="danger"
                                  disabled={loading}
                                  aria-label={`Hapus pengaturan kuota ${classTypes.find((c) => c.id === item.classTypeId)?.name ?? ''}`.trim()}
                                  onClick={() => setQuotaToDelete(item)}
                                >
                                  Hapus
                                </Button>
                              )}
                              {kind !== 'QUOTA_CAPACITY' &&
                                canFinance &&
                                (item.deletable || canCorrect) && (
                                  <Button
                                    size="sm"
                                    variant="danger"
                                    disabled={loading}
                                    onClick={() => void deleteSetting(item)}
                                  >
                                    {item.deletable ? 'Hapus' : 'Hapus salah input'}
                                  </Button>
                                )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination
                currentPage={settingPage}
                totalPages={totalSettingPages}
                totalItems={filteredSettings.length}
                pageSize={ADMIN_PAGE_SIZE}
                hasPrevious={settingPage > 1}
                hasNext={settingPage < totalSettingPages}
                showPageNumbers
                totalLabel={`${filteredSettings.length.toLocaleString('id-ID')} konfigurasi`}
                onPageChange={(target) => setSettingPage(target)}
                onPrevious={() => setSettingPage((p) => Math.max(1, p - 1))}
                onNext={() => setSettingPage((p) => Math.min(totalSettingPages, p + 1))}
              />
            </div>
            ) : settings.length ? (
              <div className="mt-4 flex flex-col items-center gap-3">
                <EmptyState
                  title="Tidak ada hasil yang cocok"
                  description={`Tidak ditemukan konfigurasi dengan kata kunci "${settingSearch}".`}
                />
                <Button variant="secondary" size="sm" onClick={() => setSettingSearch('')}>
                  Hapus filter pencarian
                </Button>
              </div>
            ) : (
              <div className="mt-4 flex flex-col items-center gap-3">
                <EmptyState
                  title="Belum ada konfigurasi"
                  description="Pilih cabang lalu tambahkan konfigurasi efektif pertama."
                />
                <Button
                  onClick={bukaFormTarifBaru}
                  disabled={!canManage || (kind === 'INSTRUCTOR_FEE' && !canFinance)}
                >
                  {kind === 'INSTRUCTOR_FEE'
                    ? '+ Atur honor pertama'
                    : '+ Atur kuota pertama'}
                </Button>
              </div>
            )}
          </section>

          {/* Modal 1: Tambah / Atur Konfigurasi Baru */}
          <Modal
            open={isCreateSettingModalOpen}
            onClose={() => setIsCreateSettingModalOpen(false)}
            title={`Atur ${kindLabels[kind]} Baru`}
          >
            <form
              className="flex flex-col gap-4"
              aria-label="Buat effective setting"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const data = new FormData(form);
                setSettingSubmitting(true);
                void run(async () => {
                  try {
                    const effectiveDate =
                      String(data.get('effectiveFrom') || '').trim() ||
                      new Date().toISOString().slice(0, 10);
                    const auditReason = String(data.get('reason') || '').trim() || undefined;
                    await client.createSetting({
                      kind,
                      branchId,
                      classTypeId,
                      instructorUserId: instructor?.id,
                      value: Number(data.get('value')),
                      capacity: data.get('capacity') ? Number(data.get('capacity')) : undefined,
                      effectiveFrom: effectiveDate,
                      reason: auditReason,
                    });
                    form.reset();
                    setInstructor(undefined);
                    setIsCreateSettingModalOpen(false);
                    await loadBranchContent(branchId, kind);
                  } finally {
                    setSettingSubmitting(false);
                  }
                }, 'Konfigurasi efektif berhasil dibuat.');
              }}
            >
              <div className="rounded-dd-md border border-dd-line bg-dd-surface-muted/50 p-3 text-xs text-dd-muted">
                Cabang Aktif:{' '}
                <strong className="font-semibold text-dd-ink">
                  {branches.find((b) => b.id === branchId)?.name ?? 'Studio terpilih'}
                </strong>
                . Tarif atau kuota baru langsung berlaku saat disimpan.
              </div>

              {!branchId && (
                <div className="rounded-dd-md border border-dd-warning/40 bg-dd-warning-soft p-3 text-xs font-medium text-dd-warning">
                  Pilih Studio/Cabang aktif pada pemilih cabang di atas terlebih dahulu.
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <SelectInput
                  label="Jenis konfigurasi"
                  name="kind"
                  value={kind}
                  onChange={(event) => {
                    const selected = event.target.value as MasterKind;
                    setKind(selected);
                    void client
                      .listSettings(selected, branchId)
                      .then(setSettings)
                      .catch((err) => setFailure(masterFailureMessage(err)));
                  }}
                >
                  {Object.entries(kindLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </SelectInput>
                <SearchSelect
                  label="Tipe kelas"
                  value={classTypeId}
                  placeholder="Pilih tipe kelas"
                  options={classTypes
                    .filter((item) => item.active)
                    .map((item) => ({
                      id: item.id,
                      label: item.name,
                      description: item.code,
                    }))}
                  onChange={setClassTypeId}
                  required
                />
              </div>

              {kind === 'INSTRUCTOR_FEE' && (
                <AsyncSearchSelect
                  label="Instruktur aktif"
                  value={instructor?.id ?? ''}
                  selectedOption={instructor}
                  loadOptions={lookupInstructors}
                  onChange={(_id, option) => setInstructor(option as LookupOption | undefined)}
                  placeholder="Cari nama instruktur"
                  required
                />
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <TextInput
                  label={kind === 'QUOTA_CAPACITY' ? 'Minimum peserta' : 'Nilai rupiah'}
                  name="value"
                  type="number"
                  min={kind === 'QUOTA_CAPACITY' ? 1 : 0}
                  placeholder={kind === 'QUOTA_CAPACITY' ? 'Contoh: 3' : 'Contoh: 150000'}
                  required
                />
                {kind === 'QUOTA_CAPACITY' && (
                  <TextInput
                    label="Kapasitas maksimum"
                    name="capacity"
                    type="number"
                    min="1"
                    placeholder="Contoh: 10"
                    required
                  />
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <DateInput
                  label="Efektif mulai"
                  name="effectiveFrom"
                />
                <TextInput
                  label="Alasan perubahan"
                  name="reason"
                  placeholder="Jelaskan kebutuhan bisnis (opsional)"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-dd-line">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setIsCreateSettingModalOpen(false)}
                >
                  Batal
                </Button>
                <Button
                  type="submit"
                  disabled={
                    !branchId ||
                    !classTypeId ||
                    (kind === 'INSTRUCTOR_FEE' && !instructor) ||
                    !canManage ||
                    (kind === 'INSTRUCTOR_FEE' && !canFinance) ||
                    settingSubmitting
                  }
                >
                  {settingSubmitting ? 'Menyimpan…' : 'Simpan konfigurasi'}
                </Button>
              </div>
            </form>
          </Modal>

          {/* Modal 2: Edit Nilai / Honor / Kuota Baris Data */}
          <Modal
            open={Boolean(editingSetting)}
            onClose={() => setEditingSetting(null)}
            title={`Versi baru ${
              editingSetting?.kind === 'INSTRUCTOR_FEE'
                ? 'Honor Instruktur'
                : 'Kuota & Kapasitas'
            }`}
            description="Nilai lama tetap tersimpan sebagai riwayat dan berhenti berlaku pada tanggal efektif versi baru."
          >
            {editingSetting && (
              <form className="flex flex-col gap-4" onSubmit={handleUpdateSetting}>
                <div className="rounded-dd-md border border-dd-line bg-dd-surface-muted/50 p-3 text-xs space-y-1">
                  <div>
                    <span className="text-dd-muted">Cabang:</span>{' '}
                    <strong className="text-dd-ink">
                      {branches.find((b) => b.id === (editingSetting.branchId || branchId))?.name ??
                        'Cabang'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-dd-muted">Tipe Kelas:</span>{' '}
                    <strong className="text-dd-ink">
                      {classTypes.find((c) => c.id === editingSetting.classTypeId)?.name ??
                        editingSetting.classTypeId}
                    </strong>
                  </div>
                  {editingSetting.instructorName && (
                    <div>
                      <span className="text-dd-muted">Instruktur:</span>{' '}
                      <strong className="text-dd-ink">{editingSetting.instructorName}</strong>
                    </div>
                  )}
                </div>

                {editingSetting.kind === 'QUOTA_CAPACITY' ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextInput
                      label="Minimum peserta"
                      type="number"
                      min={1}
                      value={editingSettingValue}
                      onChange={(e) => setEditingSettingValue(e.target.value)}
                      required
                    />
                    <TextInput
                      label="Kapasitas maksimum"
                      type="number"
                      min={1}
                      value={editingSettingCapacity}
                      onChange={(e) => setEditingSettingCapacity(e.target.value)}
                      required
                    />
                  </div>
                ) : (
                  <TextInput
                    label="Honor per sesi (Rp)"
                    type="number"
                    min={0}
                    value={editingSettingValue}
                    onChange={(e) => setEditingSettingValue(e.target.value)}
                    required
                  />
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <DateInput
                    label="Efektif mulai"
                    value={editingSettingEffectiveDate}
                    onChange={(e) => setEditingSettingEffectiveDate(e.target.value)}
                    required
                  />
                  <TextInput
                    label="Alasan perubahan"
                    value={editingSettingReason}
                    onChange={(e) => setEditingSettingReason(e.target.value)}
                    placeholder="Tulis alasan perubahan (minimal 3 karakter)"
                    minLength={3}
                    maxLength={500}
                    required
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-dd-line">
                  <Button type="button" variant="ghost" onClick={() => setEditingSetting(null)}>
                    Batal
                  </Button>
                  <Button type="submit" disabled={settingSubmitting}>
                    {settingSubmitting ? 'Menyimpan…' : 'Simpan versi baru'}
                  </Button>
                </div>
              </form>
            )}
          </Modal>
        </div>
      )}




      {/* Class Type Edit Modal */}
      <Modal
        open={Boolean(editingClassType)}
        title="Ubah tipe kelas"
        description="Nama tipe kelas dapat diperbarui. Kode kelas bersifat tetap untuk menjaga konsistensi histori jadwal."
        busy={loading}
        dirty={Boolean(
          editingClassType &&
          (classTypeName.trim() !== editingClassType.name || classTypeReason.trim()),
        )}
        onClose={() => {
          setEditingClassType(undefined);
          setClassTypeName('');
          setClassTypeReason('');
        }}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={loading}
              onClick={() => {
                setEditingClassType(undefined);
                setClassTypeName('');
                setClassTypeReason('');
              }}
            >
              Batal
            </Button>
            <Button
              type="button"
              disabled={
                loading ||
                !editingClassType ||
                classTypeName.trim().length < 2
              }
              onClick={() =>
                void (async () => {
                  if (!editingClassType) return;
                  const confirmed = await feedback.confirm({
                    title: 'Simpan perubahan tipe kelas?',
                    message: `Nama ${editingClassType.code} akan diperbarui tanpa mengubah kode atau cabang.`,
                    confirmLabel: 'Simpan perubahan',
                  });
                  if (!confirmed) return;
                  await run(async () => {
                    await client.updateClassType(editingClassType.id, {
                      name: classTypeName.trim(),
                      expectedVersion: editingClassType.version,
                      reason: classTypeReason.trim() || undefined,
                    });
                    setEditingClassType(undefined);
                    setClassTypeName('');
                    setClassTypeReason('');
                    await loadBranchContent(branchId);
                  }, 'Tipe kelas berhasil diperbarui.');
                })()
              }
            >
              Simpan perubahan
            </Button>
          </div>
        }
      >
        {editingClassType && (
          <div className="grid gap-4">
            <TextInput label="Kode kelas" value={editingClassType.code} disabled />
            <TextInput
              label="Nama kelas"
              value={classTypeName}
              onChange={(event) => setClassTypeName(event.target.value)}
              required
            />
            <TextInput
              label="Alasan perubahan (opsional)"
              placeholder="Contoh: Penyesuaian nama kelas studio"
              value={classTypeReason}
              onChange={(event) => setClassTypeReason(event.target.value)}
            />
          </div>
        )}
      </Modal>
      <LifecycleDialog
        request={
          classTypeLifecycle
            ? {
                kind: 'class-type',
                id: classTypeLifecycle.item.id,
                name: classTypeLifecycle.item.name,
                action: classTypeLifecycle.action,
              }
            : null
        }
        deactivate={(reason) =>
          client.deactivateClassType(classTypeLifecycle!.item.id, classTypeLifecycle!.item.version, reason)
        }
        onClose={() => setClassTypeLifecycle(null)}
        onDone={async (done) => {
          setClassTypeLifecycle(null);
          setFailure(undefined);
          setMessage(done);
          await loadBranchContent(branchId);
          if (classTypeStatusFilter === 'ARCHIVED') await loadArchivedClassTypes();
        }}
      />
      <ReasonDialog
        open={Boolean(settingToDelete)}
        title={
          settingToDelete?.deletable
            ? 'Hapus tarif yang belum berlaku?'
            : 'Hapus versi tarif yang salah input?'
        }
        description={settingToDelete ? keteranganHapus(settingToDelete, dampakHapus) : undefined}
        confirmLabel={settingToDelete?.deletable ? 'Hapus tarif' : 'Hapus versi keliru'}
        tone="danger"
        minLength={settingToDelete?.deletable ? 3 : 10}
        maxLength={500}
        busy={loading}
        onCancel={() => setSettingToDelete(null)}
        onConfirm={(reason) => {
          const item = settingToDelete;
          if (!item) return;
          setSettingToDelete(null);
          void run(async () => {
            if (item.deletable) await client.deleteSetting('INSTRUCTOR_FEE', item.id, reason);
            else await client.deleteSetting('INSTRUCTOR_FEE', item.id, reason, true);
            await loadBranchContent(branchId, kind);
          }, 'Tarif dihapus.');
        }}
      />
      <LifecycleDialog
        request={
          quotaToDelete
            ? {
                kind: 'min-quota',
                id: quotaToDelete.id,
                name: classTypes.find((c) => c.id === quotaToDelete.classTypeId)?.name ?? 'pengaturan kuota',
                action: 'delete',
              }
            : null
        }
        onClose={() => setQuotaToDelete(null)}
        onDone={async (done) => {
          setQuotaToDelete(null);
          setFailure(undefined);
          setMessage(done);
          await loadBranchContent(branchId, kind);
        }}
      />
    </div>
  );
}
