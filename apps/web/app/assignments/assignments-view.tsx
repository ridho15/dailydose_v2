'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, UserRoundCheck } from 'lucide-react';
import {
  assignmentFailure,
  assignmentFailureDetail,
  browserAssignmentClient,
  type AssignmentClient,
  type AssignmentFailure,
  type AssignmentFilters,
  type AssignmentManagementItem,
  type AssignmentManagementSummary,
  type AssignmentStatus,
  type AssignmentType,
} from '@/api-clients/assignment-client';
import { AdminPageHeader } from '../components/admin/admin-page-header';
import { useActiveBranchState, useSessionContext } from '../session-context';
import { Button } from '../components/actions';
import { DestructiveDialog, Drawer, useOptionalAppFeedback } from '../components/app-feedback';
import {
  DataTable,
  FilterBar,
  Pagination,
  Panel,
  StatCard,
  Badge,
  AdminPageState,
} from '../components/admin/admin-ui';
import {
  AsyncSearchSelect,
  DateInput,
  SearchInput,
  SearchSelect,
  SelectInput,
  Textarea,
  TextInput,
} from '../components/forms';
import { pageOffset } from '../lib/pagination';

const emptySummary: AssignmentManagementSummary = { total: 0, active: 0, ended: 0 };

const failureCopy: Record<AssignmentFailure, string> = {
  EFFECTIVE_PERIOD_OVERLAP: 'Periode penugasan bertabrakan dengan penugasan yang sudah ada.',
  STALE_VERSION: 'Penugasan telah berubah. Muat ulang sebelum melanjutkan.',
  RESOURCE_NOT_FOUND: 'Penugasan tidak ditemukan atau berada di luar cakupan cabang Anda.',
  FORBIDDEN: 'Akun ini tidak memiliki izin untuk mengelola penugasan.',
  VALIDATION_ERROR: 'Periksa kembali pengguna, periode, dan alasan tindakan.',
  API_UNAVAILABLE: 'Layanan penugasan belum dapat dijangkau. Silakan coba kembali.',
};

const typeLabel: Record<AssignmentType, string> = {
  OWNER: 'Owner cabang',
  INSTRUCTOR: 'Instruktur',
};

export function AssignmentsView({
  client = browserAssignmentClient,
  branchOptions,
  activeBranchId,
  access,
}: {
  client?: AssignmentClient;
  branchOptions?: { id: string; code: string; name: string }[];
  activeBranchId?: string;
  access?: { canRead: boolean; canManage: boolean };
}) {
  const [contextBranchId] = useActiveBranchState();
  const branchId = activeBranchId ?? contextBranchId;
  const sessionContext = useSessionContext();
  const feedback = useOptionalAppFeedback();
  const branches = branchOptions ?? sessionContext?.session?.branches ?? [];
  const canManage =
    access?.canManage ??
    (sessionContext?.status === 'authenticated' &&
      sessionContext.hasCapability('assignment:manage'));
  const canRead =
    access?.canRead ??
    (sessionContext?.status === 'authenticated' && sessionContext.hasCapability('assignment:read'));
  const [items, setItems] = useState<AssignmentManagementItem[]>([]);
  const [summary, setSummary] = useState(emptySummary);
  const [filters, setFilters] = useState<Omit<AssignmentFilters, 'branchId' | 'cursor'>>({});
  const [cursor, setCursor] = useState<string>();
  const [cursorHistory, setCursorHistory] = useState<(string | undefined)[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<AssignmentFailure>();
  const [failureDetail, setFailureDetail] = useState<string>();
  const [createOpen, setCreateOpen] = useState(false);
  const [ending, setEnding] = useState<AssignmentManagementItem>();
  const [selectedUser, setSelectedUser] = useState<{
    id: string;
    label: string;
    description?: string;
  }>();

  const load = useCallback(async () => {
    if (!canRead) return;
    setLoading(true);
    setFailure(undefined);
    setFailureDetail(undefined);
    try {
      const result = await client.list({ ...filters, branchId: branchId || undefined, cursor });
      setItems(result.items);
      setSummary(result.summary ?? emptySummary);
      setNextCursor(result.page?.nextCursor ?? null);
    } catch (error) {
      setFailure(assignmentFailure(error));
      setFailureDetail(assignmentFailureDetail(error));
    } finally {
      setLoading(false);
    }
  }, [branchId, canRead, client, cursor, filters]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), filters.q ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [load, filters.q]);

  const scopeLabel = branchId
    ? (branches.find((branch) => branch.id === branchId)?.name ?? 'Cabang aktif')
    : 'Semua cabang yang diizinkan';

  const resetPage = (next: Omit<AssignmentFilters, 'branchId' | 'cursor'>) => {
    setFilters(next);
    setCursor(undefined);
    setCursorHistory([]);
  };

  const handleActionFailure = useCallback((error: unknown) => {
    const fail = assignmentFailure(error);
    const detail = assignmentFailureDetail(error);
    setFailure(fail);
    setFailureDetail(detail);
  }, []);

  const columns = useMemo(
    () => [
      {
        id: 'user',
        header: 'Pengguna',
        cell: (item: AssignmentManagementItem) => (
          <div>
            <strong className="block">{item.user.displayName}</strong>
            {item.user.phoneMasked && (
              <span className="text-xs text-dd-muted">{item.user.phoneMasked}</span>
            )}
          </div>
        ),
      },
      {
        id: 'branch',
        header: 'Cabang',
        cell: (item: AssignmentManagementItem) => <span>{item.branch.name}</span>,
      },
      {
        id: 'type',
        header: 'Penugasan',
        cell: (item: AssignmentManagementItem) => typeLabel[item.assignmentType],
      },
      {
        id: 'period',
        header: 'Periode',
        cell: (item: AssignmentManagementItem) => (
          <span className="whitespace-nowrap">
            {formatAssignmentDate(item.activeFrom)} –{' '}
            {item.activeUntil ? formatAssignmentDate(item.activeUntil) : 'Tanpa akhir'}
          </span>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        cell: (item: AssignmentManagementItem) => (
          <Badge tone={item.status === 'ACTIVE' ? 'success' : 'neutral'}>
            {item.status === 'ACTIVE' ? 'Aktif' : 'Berakhir'}
          </Badge>
        ),
      },
      {
        id: 'action',
        header: <span className="sr-only">Tindakan</span>,
        className: 'text-right',
        cell: (item: AssignmentManagementItem) =>
          item.status === 'ACTIVE' && canManage ? (
            <Button
              type="button"
              variant="ghost"
              onClick={(event) => {
                event.stopPropagation();
                setEnding(item);
              }}
            >
              Akhiri
            </Button>
          ) : null,
      },
    ],
    [canManage],
  );

  if (sessionContext && sessionContext.status === 'loading')
    return (
      <AdminPageState
        kind="error"
        title="Memuat konteks akses"
        description="Izin dan cakupan cabang sedang diperiksa."
      />
    );
  if (!canRead) return <AdminPageState kind="forbidden" />;

  return (
    <div className="grid gap-5">
      <AdminPageHeader
        title="Penugasan"
        titleId="assignment-title"
        description="Kelola periode Owner dan Instruktur. Pembacaan dan pembuatan penugasan dapat dilakukan untuk cabang spesifik secara mandiri atau mengikuti filter topbar."
        actions={
          <>
            <Button
              type="button"
              variant="secondary"
              leadingIcon={<RefreshCw className="size-4" aria-hidden="true" />}
              onClick={() => void load()}
              disabled={loading}
            >
              Segarkan
            </Button>
            <Button
              type="button"
              leadingIcon={<Plus className="size-4" aria-hidden="true" />}
              onClick={() => setCreateOpen(true)}
              disabled={!canManage || (!branchId && branches.length === 0)}
              title={!canManage ? 'Akun ini tidak memiliki izin untuk mengelola penugasan' : undefined}
            >
              Buat penugasan
            </Button>
          </>
        }
      />

      {!branchId && canManage && (
        <Panel className="border-dd-brass/40 bg-dd-brass-soft/35 p-4 text-sm text-dd-warning">
          Mode semua cabang menampilkan data seluruh lokasi. Untuk membuat penugasan baru, klik 'Buat penugasan' dan tentukan cabang target langsung di dalam formulir.
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Total penugasan" value={summary.total.toLocaleString('id-ID')} />
        <StatCard label="Aktif" value={summary.active.toLocaleString('id-ID')} tone="success" />
        <StatCard label="Berakhir" value={summary.ended.toLocaleString('id-ID')} />
      </div>

      <FilterBar>
        <SearchInput
          label="Cari pengguna atau cabang"
          placeholder="Nama, telepon, atau cabang"
          value={filters.q ?? ''}
          onChange={(event) => resetPage({ ...filters, q: event.target.value || undefined })}
          wrapperClassName="min-w-64 flex-1"
        />
        <SelectInput
          label="Tipe penugasan"
          value={filters.type ?? ''}
          onChange={(event) =>
            resetPage({
              ...filters,
              type: (event.target.value || undefined) as AssignmentType | undefined,
            })
          }
          wrapperClassName="min-w-44"
        >
          <option value="">Semua tipe</option>
          <option value="OWNER">Owner cabang</option>
          <option value="INSTRUCTOR">Instruktur</option>
        </SelectInput>
        <SelectInput
          label="Status"
          value={filters.status ?? ''}
          onChange={(event) =>
            resetPage({
              ...filters,
              status: (event.target.value || undefined) as AssignmentStatus | undefined,
            })
          }
          wrapperClassName="min-w-40"
        >
          <option value="">Semua status</option>
          <option value="ACTIVE">Aktif</option>
          <option value="ENDED">Berakhir</option>
        </SelectInput>
        {(filters.q || filters.type || filters.status) && (
          <Button type="button" variant="ghost" onClick={() => resetPage({})}>
            Reset filter
          </Button>
        )}
      </FilterBar>

      {failure ? (
        <AdminPageState
          kind={
            failure === 'FORBIDDEN' ? 'forbidden' : failure === 'STALE_VERSION' ? 'stale' : 'error'
          }
          description={
            failureDetail ? `${failureCopy[failure]} (${failureDetail})` : failureCopy[failure]
          }
          action={<Button onClick={() => void load()}>Coba lagi</Button>}
        />
      ) : (
        <>
          <DataTable
            rowNumberOffset={pageOffset(cursorHistory.length)}
            items={items}
            columns={columns}
            rowKey={(item) => item.id}
            loading={loading}
            emptyTitle="Belum ada penugasan"
            emptyDescription="Tidak ada penugasan yang sesuai dengan cakupan dan filter saat ini."
            mobileCard={(item) => (
              <div className="grid gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <strong className="block">{item.user.displayName}</strong>
                    <span className="text-sm text-dd-muted">{item.branch.name}</span>
                  </div>
                  <Badge tone={item.status === 'ACTIVE' ? 'success' : 'neutral'}>
                    {item.status === 'ACTIVE' ? 'Aktif' : 'Berakhir'}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <span>
                    <span className="block text-xs text-dd-muted">Tipe</span>
                    {typeLabel[item.assignmentType]}
                  </span>
                  <span>
                    <span className="block text-xs text-dd-muted">Periode</span>
                    {formatAssignmentDate(item.activeFrom)} –{' '}
                    {item.activeUntil ? formatAssignmentDate(item.activeUntil) : 'Tanpa akhir'}
                  </span>
                </div>
                {item.status === 'ACTIVE' && canManage && (
                  <Button type="button" variant="secondary" onClick={() => setEnding(item)}>
                    Akhiri penugasan
                  </Button>
                )}
              </div>
            )}
          />
          <Pagination
            hasPrevious={cursorHistory.length > 0}
            hasNext={Boolean(nextCursor)}
            totalLabel={`${summary.total.toLocaleString('id-ID')} penugasan`}
            currentPage={cursorHistory.length + 1}
            onPrevious={() => {
              const previous = cursorHistory.at(-1);
              setCursorHistory((current) => current.slice(0, -1));
              setCursor(previous);
            }}
            onNext={() => {
              if (!nextCursor) return;
              setCursorHistory((current) => [...current, cursor]);
              setCursor(nextCursor);
            }}
          />
        </>
      )}

      <CreateAssignmentDrawer
        open={createOpen}
        branchId={branchId}
        branchName={scopeLabel}
        branches={branches}
        client={client}
        selectedUser={selectedUser}
        onSelectedUser={setSelectedUser}
        onClose={() => {
          setCreateOpen(false);
          setSelectedUser(undefined);
        }}
        onCreated={async () => {
          setCreateOpen(false);
          setSelectedUser(undefined);
          feedback?.showToast({
            tone: 'success',
            title: 'Penugasan dibuat',
            message: 'Penugasan baru telah dicatat dan diaudit.',
          });
          await load();
        }}
        onFailure={handleActionFailure}
      />

      <EndAssignmentDialog
        item={ending}
        client={client}
        feedback={feedback}
        onClose={() => setEnding(undefined)}
        onEnded={async () => {
          setEnding(undefined);
          feedback?.showToast({
            tone: 'success',
            title: 'Penugasan diakhiri',
            message: 'Perubahan periode telah dicatat dalam audit.',
          });
          await load();
        }}
        onFailure={handleActionFailure}
      />
    </div>
  );
}

function CreateAssignmentDrawer({
  open,
  branchId,
  branchName,
  branches = [],
  client,
  selectedUser,
  onSelectedUser,
  onClose,
  onCreated,
  onFailure,
}: {
  open: boolean;
  branchId?: string;
  branchName: string;
  branches?: { id: string; code: string; name: string }[];
  client: AssignmentClient;
  selectedUser?: { id: string; label: string; description?: string };
  onSelectedUser(value?: { id: string; label: string; description?: string }): void;
  onClose(): void;
  onCreated(): Promise<void>;
  onFailure(error: unknown): void;
}) {
  const feedback = useOptionalAppFeedback();
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [selectedBranchId, setSelectedBranchId] = useState<string>(
    branchId || branches[0]?.id || '',
  );

  useEffect(() => {
    if (open) {
      setSelectedBranchId(branchId || branches[0]?.id || '');
    }
  }, [open, branchId, branches]);

  const effectiveBranchId = selectedBranchId || branchId || '';
  const targetBranch = branches.find((b) => b.id === effectiveBranchId);
  const targetBranchName = targetBranch?.name ?? branchName;

  const hasChanges = dirty || Boolean(selectedUser);
  const confirmDiscard = () =>
    feedback?.confirm({
      tone: 'warning',
      title: 'Batalkan penugasan?',
      message: 'Pengguna dan periode yang dipilih akan dikosongkan.',
      confirmLabel: 'Buang input',
    }) ?? Promise.resolve(true);
  const cancel = async () => {
    if (!hasChanges || (await confirmDiscard())) {
      setDirty(false);
      onSelectedUser(undefined);
      onClose();
    }
  };
  const lookup = useCallback(
    async (query: string) =>
      (await client.listUsers(effectiveBranchId || undefined, query)).map((user) => ({
        id: user.id,
        label: user.displayName,
        description: user.phoneMasked ?? undefined,
      })),
    [client, effectiveBranchId],
  );
  return (
    <Drawer
      open={open}
      title="Buat penugasan"
      busy={busy}
      dirty={hasChanges}
      onDirtyClose={confirmDiscard}
      onClose={() => {
        setDirty(false);
        onSelectedUser(undefined);
        onClose();
      }}
      footer={
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void cancel()}>
            Batal
          </Button>
          <Button
            type="submit"
            form="assignment-create-form"
            loading={busy}
            leadingIcon={<UserRoundCheck className="size-4" aria-hidden="true" />}
            disabled={!selectedUser || !effectiveBranchId}
          >
            Buat penugasan
          </Button>
        </div>
      }
    >
      <form
        id="assignment-create-form"
        className="grid gap-4"
        onChange={() => setDirty(true)}
        onSubmit={async (event) => {
          event.preventDefault();
          if (!selectedUser || !effectiveBranchId) return;
          const data = new FormData(event.currentTarget);
          const assignmentType = String(data.get('assignmentType')) as AssignmentType;
          const confirmed =
            (await feedback?.confirm({
              title: 'Buat penugasan?',
              message: `${selectedUser.label} akan memperoleh penugasan ${typeLabel[assignmentType]} pada ${targetBranchName}.`,
              confirmLabel: 'Buat penugasan',
            })) ?? true;
          if (!confirmed) return;
          setBusy(true);
          try {
            await client.create({
              userId: selectedUser.id,
              branchId: effectiveBranchId,
              assignmentType,
              activeFrom: String(data.get('activeFrom')),
              activeUntil: String(data.get('activeUntil')) || null,
              reason: String(data.get('reason')),
            });
            setDirty(false);
            onSelectedUser(undefined);
            await onCreated();
          } catch (error) {
            onFailure(error);
          } finally {
            setBusy(false);
          }
        }}
      >
        {branches.length > 0 ? (
          <SearchSelect
            label="Cabang Penugasan"
            name="branchId"
            required
            clearable={false}
            value={effectiveBranchId}
            placeholder="Pilih cabang penugasan"
            options={branches.map((b) => ({
              id: b.id,
              label: b.name,
              description: b.code,
            }))}
            onChange={(val) => {
              setSelectedBranchId(val);
              setDirty(true);
            }}
          />
        ) : (
          <Panel className="bg-dd-surface-muted p-4 text-sm text-dd-muted">
            Cakupan cabang: <strong className="text-dd-ink">{targetBranchName}</strong>
          </Panel>
        )}
        <AsyncSearchSelect
          label="Pengguna"
          value={selectedUser?.id ?? ''}
          selectedOption={selectedUser}
          loadOptions={lookup}
          onChange={(_id, option) => onSelectedUser(option)}
          placeholder="Ketik minimal 2 karakter"
        />
        <SelectInput label="Tipe penugasan" name="assignmentType" defaultValue="INSTRUCTOR">
          <option value="INSTRUCTOR">Instruktur</option>
          <option value="OWNER">Owner cabang</option>
        </SelectInput>
        <DateInput label="Aktif mulai" name="activeFrom" required />
        <DateInput
          label="Aktif sampai"
          description="Opsional. Tanggal akhir bersifat eksklusif."
          name="activeUntil"
        />
        <Textarea label="Alasan" name="reason" minLength={3} maxLength={500} required />
      </form>
    </Drawer>
  );
}

function EndAssignmentDialog({
  item,
  client,
  feedback,
  onClose,
  onEnded,
  onFailure,
}: {
  item?: AssignmentManagementItem;
  client: AssignmentClient;
  feedback: ReturnType<typeof useOptionalAppFeedback>;
  onClose(): void;
  onEnded(): Promise<void>;
  onFailure(error: unknown): void;
}) {
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const confirmDiscard = () =>
    feedback?.confirm({
      tone: 'warning',
      title: 'Batalkan akhir penugasan?',
      message: 'Waktu efektif dan alasan yang belum diproses akan hilang.',
      confirmLabel: 'Buang perubahan',
    }) ?? Promise.resolve(true);
  const cancel = async () => {
    if (!dirty || (await confirmDiscard())) {
      setDirty(false);
      onClose();
    }
  };
  return (
    <DestructiveDialog
      open={Boolean(item)}
      title="Akhiri penugasan"
      impact={`Akses ${item ? typeLabel[item.assignmentType] : ''} berhenti pada awal tanggal efektif.`}
      scope={item?.branch.name}
      busy={busy}
      dirty={dirty}
      onDirtyClose={confirmDiscard}
      onClose={() => {
        setDirty(false);
        onClose();
      }}
      footer={
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void cancel()}>
            Batal
          </Button>
          <Button type="submit" form="assignment-end-form" variant="danger" loading={busy}>
            Akhiri penugasan
          </Button>
        </div>
      }
    >
      <form
        id="assignment-end-form"
        className="grid gap-4"
        onChange={() => setDirty(true)}
        onSubmit={async (event) => {
          event.preventDefault();
          if (!item) return;
          const data = new FormData(event.currentTarget);
          const confirmed =
            (await feedback?.confirm({
              tone: 'danger',
              title: 'Konfirmasi akhir penugasan',
              message: `Penugasan ${item.user.displayName} pada ${item.branch.name} akan diakhiri dan dicatat dalam audit.`,
              confirmLabel: 'Akhiri penugasan',
            })) ?? true;
          if (!confirmed) return;
          setBusy(true);
          try {
            await client.end(
              item.id,
              String(data.get('effectiveAt')),
              item.version,
              String(data.get('reason')),
            );
            setDirty(false);
            await onEnded();
          } catch (error) {
            onFailure(error);
          } finally {
            setBusy(false);
          }
        }}
      >
        <TextInput label="Efektif berakhir" name="effectiveAt" type="datetime-local" required />
        <Textarea label="Alasan" name="reason" minLength={3} maxLength={500} required />
      </form>
    </DestructiveDialog>
  );
}

export function formatAssignmentDate(value?: string | null) {
  if (!value) return 'Tanggal tidak tersedia';
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/u.test(value) ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return 'Tanggal tidak tersedia';
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}
