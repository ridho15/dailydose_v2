'use client';

import { useEffect, useState } from 'react';
import { Pencil, Plus, TicketPercent } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { browserVoucherClient, type VoucherRecord } from '@/api-clients/voucher-client';
import { useSessionContext } from '../session-context';
import { Button } from '../components/actions';
import {
  AsyncMultiSearchSelect,
  SearchSelect,
  Textarea,
  TextInput,
  SelectInput,
} from '../components/forms';
import { AlertBanner, Drawer, useAppFeedback } from '../components/app-feedback';
import { DataTable, Badge, Pagination, Panel, StatCard, TableActionMenu } from '../components/admin/admin-ui';
import { EmptyState, Skeleton } from '../ui';
import { useTrackedRouter } from '../components/app-loading';
import { browserPackagePromotionClient } from '@/api-clients/package-promotion-client';
import { browserMasterClient } from '@/api-clients/master-client';
import { ADMIN_PAGE_SIZE, pageOffset } from '../lib/pagination';
import { useVoucherLifecycle } from './use-voucher-lifecycle';

const labels: Record<string, string> = {
  DRAFT: 'Draft',
  ACTIVE: 'Aktif',
  PAUSED: 'Dijeda',
  EXPIRED: 'Kedaluwarsa',
  EXHAUSTED: 'Kuota habis',
  ARCHIVED: 'Diarsipkan',
};

export function VouchersView() {
  const session = useSessionContext();
  const router = useTrackedRouter();
  const pathname = usePathname() ?? '/workspace/vouchers';
  const feedback = useAppFeedback();
  const canRead = session?.status === 'authenticated' && session.hasCapability('voucher:read');
  const canManage = session?.status === 'authenticated' && session.hasCapability('voucher:manage');
  const [items, setItems] = useState<VoucherRecord[]>([]);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createDirty, setCreateDirty] = useState(false);
  const [editingVoucher, setEditingVoucher] = useState<VoucherRecord | null>(null);
  const [summary, setSummary] = useState<Partial<Record<VoucherRecord['status'], number>>>({});
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string>();
  const [cursorHistory, setCursorHistory] = useState<Array<string | undefined>>([]);
  const [classTypes, setClassTypes] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedPackageIds, setSelectedPackageIds] = useState<string[]>([]);
  const [form, setForm] = useState({
    code: '',
    name: '',
    description: '',
    discountType: 'PERCENTAGE',
    discountValue: '10',
    maxDiscountRp: '',
    minimumPurchaseRp: '0',
    activeFrom: new Date().toISOString().slice(0, 16),
    activeUntil: '',
    totalUsageLimit: '',
    perCustomerUsageLimit: '',
    branchId: '',
    classTypeId: '',
    reason: '',
  });
  const confirmDiscardCreate = () =>
    feedback.confirm({
      tone: 'warning',
      title: 'Batalkan pembuatan voucher?',
      message: 'Input voucher yang belum disimpan akan hilang.',
      confirmLabel: 'Buang input',
    });
  const closeCreate = async () => {
    if (!createDirty || (await confirmDiscardCreate())) {
      setCreateDirty(false);
      setCreateOpen(false);
    }
  };
  const load = async (pageNumber = page) => {
    if (!canRead) return;
    setBusy(true);
    setError('');
    try {
      const result = await browserVoucherClient.list({ q, status, page: pageNumber, pageSize: ADMIN_PAGE_SIZE });
      setItems(result.items);
      setSummary(result.summary ?? {});
      setTotalPages(result.totalPages ?? result.page?.totalPages ?? 1);
      setTotalItems(result.total ?? result.page?.total ?? result.items.length);
      setNextCursor(result.page?.nextCursor ?? null);
    } catch {
      setError('Voucher belum dapat dimuat. Coba lagi.');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load(page);
  }, [canRead, page, q, status]);

  const lifecycle = useVoucherLifecycle(() => load(page));

  if (!session || session.status === 'loading') return <Skeleton label="Memuat voucher" />;
  if (!canRead)
    return (
      <AlertBanner
        tone="danger"
        title="Akses terbatas"
        message="Anda tidak memiliki akses melihat voucher."
      />
    );

  return (
    <section className="grid gap-5" aria-labelledby="voucher-title">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-dd-line pb-5">
        <div>
          <p className="text-[13px] font-bold text-dd-forest">
            Administrasi
          </p>
          <h1 id="voucher-title" className="mt-1 text-3xl font-semibold">
            Voucher & promo
          </h1>
          <p className="mt-2 text-sm text-dd-muted">
            Kelola promo dengan periode, cakupan paket, dan kuota yang dapat diaudit.
          </p>
        </div>
        {canManage && (
          <Button
            leadingIcon={<Plus className="size-4" aria-hidden="true" />}
            onClick={() => setCreateOpen(true)}
          >
            Buat voucher
          </Button>
        )}
      </header>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(['ACTIVE', 'PAUSED', 'EXPIRED', 'EXHAUSTED'] as const).map((value) => (
          <button
            key={value}
            type="button"
            className="text-left"
            onClick={() => {
              setStatus(status === value ? '' : value);
              setCursor(undefined);
              setCursorHistory([]);
            }}
          >
            <StatCard
              label={labels[value] ?? value}
              value={String(summary[value] ?? 0)}
              tone={value === 'ACTIVE' ? 'success' : 'neutral'}
            />
          </button>
        ))}
      </div>
      <Panel className="grid gap-3 p-4 sm:grid-cols-[1fr_220px]">
        <TextInput
          label="Cari voucher"
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
            setPage(1);
            setCursor(undefined);
            setCursorHistory([]);
          }}
          placeholder="Kode atau nama voucher"
        />
        <SelectInput
          label="Status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
            setCursor(undefined);
            setCursorHistory([]);
          }}
        >
          <option value="">Semua status</option>
          {Object.entries(labels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectInput>
      </Panel>
      {error && <AlertBanner tone="danger" title="Gagal memuat voucher" message={error} />}
      {busy && items.length === 0 ? (
        <Skeleton label="Memuat daftar voucher" />
      ) : items.length === 0 ? (
        <EmptyState
          title="Belum ada voucher"
          description="Buat voucher pertama untuk katalog paket."
        />
      ) : (
        <DataTable
          rowNumberOffset={pageOffset(page - 1)}
          items={items}
          rowKey={(item) => item.id}
          columns={[
            {
              id: 'code',
              header: 'Voucher',
              cell: (item) => (
                <div>
                  <strong className="block">{item.code}</strong>
                  <span className="text-xs text-dd-muted">{item.name}</span>
                </div>
              ),
            },
            {
              id: 'discount',
              header: 'Diskon',
              cell: (item) => {
                const isPercent =
                  String(item.discountType).toUpperCase() === 'PERCENTAGE' ||
                  String(item.discountType).toUpperCase() === 'PERCENT' ||
                  String(item.discountType) === '%';
                return isPercent
                  ? `${item.discountValue ?? 0}%`
                  : `Rp ${(item.discountValue ?? 0).toLocaleString('id-ID')}`;
              },
            },
            { id: 'scope', header: 'Cakupan', cell: (item) => item.branch?.name ?? 'Semua cabang' },
            {
              id: 'period',
              header: 'Periode',
              cell: (item) =>
                `${new Date(item.activeFrom).toLocaleDateString('id-ID')} – ${item.activeUntil ? new Date(item.activeUntil).toLocaleDateString('id-ID') : 'tanpa batas'}`,
            },
            {
              id: 'status',
              header: 'Status',
              cell: (item) => (
                <Badge
                  tone={
                    item.status === 'ACTIVE'
                      ? 'success'
                      : item.status === 'EXPIRED' || item.status === 'EXHAUSTED'
                        ? 'danger'
                        : 'warning'
                  }
                >
                  {labels[item.status]}
                </Badge>
              ),
            },
            {
              id: 'usage',
              header: 'Penggunaan',
              cell: (item) =>
                `${item.redeemedCount}${item.totalUsageLimit ? ` / ${item.totalUsageLimit}` : ''}`,
            },
            {
              id: 'actions',
              header: 'Tindakan',
              cell: (item) => (
                <div
                  className="flex items-center gap-1.5"
                  onClick={(event) => event.stopPropagation()}
                >
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      router.push(`/workspace/vouchers/${item.id}`);
                    }}
                  >
                    Lihat detail
                  </Button>
                  {canManage && (
                    <TableActionMenu
                      ariaLabel={`Aksi voucher ${item.code}`}
                      disabled={busy}
                      items={[
                        ...(item.status !== 'ARCHIVED'
                          ? [
                              {
                                id: 'edit',
                                label: 'Edit',
                                icon: <Pencil className="size-3.5" aria-hidden="true" />,
                                onClick: () => setEditingVoucher(item),
                              },
                            ]
                          : []),
                        ...lifecycle.items(item),
                      ]}
                    />
                  )}
                </div>
              ),
            },
          ]}
          mobileCard={(item) => (
            <div className="grid gap-2">
              <div className="flex justify-between">
                <strong>{item.code}</strong>
                <Badge tone={item.status === 'ACTIVE' ? 'success' : 'warning'}>
                  {labels[item.status]}
                </Badge>
              </div>
              <span className="text-sm text-dd-muted">{item.name}</span>
              <span className="text-sm">
                {(String(item.discountType).toUpperCase() === 'PERCENTAGE' ||
                String(item.discountType).toUpperCase() === 'PERCENT' ||
                String(item.discountType) === '%')
                  ? `${item.discountValue}%`
                  : `Rp ${item.discountValue.toLocaleString('id-ID')}`}{' '}
                · {item.branch?.name ?? 'Semua cabang'}
              </span>
              <div
                className="mt-2 flex flex-wrap gap-2 border-t border-dd-line/50 pt-2"
                onClick={(event) => event.stopPropagation()}
              >
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={(event) => {
                    event.stopPropagation();
                    router.push(`/workspace/vouchers/${item.id}`);
                  }}
                >
                  Lihat detail
                </Button>
                {canManage && (
                  <TableActionMenu
                    ariaLabel={`Aksi voucher ${item.code}`}
                    disabled={busy}
                    items={[
                      ...(item.status !== 'ARCHIVED'
                        ? [
                            {
                              id: 'edit',
                              label: 'Edit',
                              icon: <Pencil className="size-3.5" aria-hidden="true" />,
                              onClick: () => setEditingVoucher(item),
                            },
                          ]
                        : []),
                      ...lifecycle.items(item),
                    ]}
                  />
                )}
              </div>
            </div>
          )}
          onRowClick={(item) => router.push(`/workspace/vouchers/${item.id}`)}
          rowDescription={(item) => `Buka detail voucher ${item.code}`}
        />
      )}
      <Pagination
        currentPage={page}
        totalPages={totalPages}
        totalItems={totalItems}
        pageSize={ADMIN_PAGE_SIZE}
        hasPrevious={page > 1 && !busy}
        hasNext={page < totalPages && !busy}
        showPageNumbers
        totalLabel={`${totalItems.toLocaleString('id-ID')} voucher`}
        onPageChange={(target) => setPage(target)}
        onPrevious={() => setPage((p) => Math.max(1, p - 1))}
        onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
      />
      <Drawer
        open={createOpen}
        className="max-w-2xl"
        title="Buat voucher"
        description="Voucher promo diskon sesi pilates dengan batas kuota dan cakupan yang dapat diaudit."
        onClose={() => {
          setCreateDirty(false);
          setCreateOpen(false);
        }}
        busy={busy}
        dirty={createDirty}
        onDirtyClose={confirmDiscardCreate}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => void closeCreate()}
              disabled={busy}
            >
              Batal
            </Button>
            <Button
              type="submit"
              form="voucher-create-form"
              leadingIcon={<TicketPercent className="size-4" aria-hidden="true" />}
              loading={busy}
            >
              Simpan voucher
            </Button>
          </div>
        }
      >
        <form
          id="voucher-create-form"
          className="grid gap-4"
          onChange={() => setCreateDirty(true)}
          onSubmit={async (event) => {
            event.preventDefault();
            const accepted = await feedback.confirm({
              tone: 'warning',
              title: 'Buat voucher baru?',
              message:
                'Voucher disimpan sebagai draft. Cakupan cabang, class type, dan paket akan menentukan siapa yang dapat menggunakannya.',
              confirmLabel: 'Buat voucher',
            });
            if (!accepted) return;
            setBusy(true);
            try {
              await browserVoucherClient.create({
                code: form.code,
                name: form.name,
                description: form.description,
                discountType: form.discountType,
                discountValue: Number(form.discountValue),
                maxDiscountRp: form.maxDiscountRp ? Number(form.maxDiscountRp) : null,
                minimumPurchaseRp: Number(form.minimumPurchaseRp || 0),
                activeFrom: new Date(form.activeFrom).toISOString(),
                activeUntil: form.activeUntil ? new Date(form.activeUntil).toISOString() : null,
                totalUsageLimit: form.totalUsageLimit ? Number(form.totalUsageLimit) : null,
                perCustomerUsageLimit: form.perCustomerUsageLimit
                  ? Number(form.perCustomerUsageLimit)
                  : null,
                branchId: form.branchId || null,
                classTypeId: form.classTypeId || null,
                packageIds: selectedPackageIds,
                reason: form.reason,
              });
              setCreateDirty(false);
              setCreateOpen(false);
              feedback.showToast({
                tone: 'success',
                title: 'Voucher dibuat',
                message: 'Voucher disimpan sebagai draft dan belum dapat digunakan pelanggan.',
              });
              await load();
            } catch {
              const msg = 'Voucher belum berhasil dibuat. Periksa input dan coba lagi.';
              setError(msg);
              feedback.showToast({
                tone: 'danger',
                title: 'Gagal membuat voucher',
                message: msg,
              });
            } finally {
              setBusy(false);
            }
          }}
        >
          {error && <AlertBanner tone="danger" title="Voucher belum tersimpan" message={error} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              label="Kode voucher"
              placeholder="Contoh: NEWYEAR2026"
              required
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
            />
            <TextInput
              label="Nama voucher"
              placeholder="Contoh: Promo Awal Tahun"
              required
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </div>
          <Textarea
            label="Deskripsi"
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            placeholder="Keterangan promosi untuk tim operasional..."
            description="Penjelasan internal yang aman dan tidak memuat data pelanggan."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectInput
              label="Tipe diskon"
              value={form.discountType}
              onChange={(event) => setForm({ ...form, discountType: event.target.value })}
            >
              <option value="PERCENTAGE">Persentase (%)</option>
              <option value="FIXED_AMOUNT">Nominal tetap (Rp)</option>
            </SelectInput>
            <TextInput
              label="Nilai diskon"
              type="number"
              min={1}
              required
              value={form.discountValue}
              onChange={(event) => setForm({ ...form, discountValue: event.target.value })}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              label="Batas maksimum diskon"
              type="number"
              min={0}
              value={form.maxDiscountRp}
              onChange={(event) => setForm({ ...form, maxDiscountRp: event.target.value })}
              placeholder="Kosongkan jika tanpa batas"
              description="Opsional untuk diskon persentase."
            />
            <TextInput
              label="Minimum pembelian"
              type="number"
              min={0}
              value={form.minimumPurchaseRp}
              onChange={(event) => setForm({ ...form, minimumPurchaseRp: event.target.value })}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              label="Mulai aktif"
              type="datetime-local"
              required
              value={form.activeFrom}
              onChange={(event) => setForm({ ...form, activeFrom: event.target.value })}
            />
            <TextInput
              label="Berakhir"
              type="datetime-local"
              value={form.activeUntil}
              onChange={(event) => setForm({ ...form, activeUntil: event.target.value })}
              description="Kosongkan jika tidak memiliki batas akhir."
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <SearchSelect
              label="Cakupan cabang"
              value={form.branchId}
              placeholder="Semua cabang"
              options={(session.session?.branches ?? []).map((branch) => ({
                id: branch.id,
                label: branch.name,
                description: branch.code,
              }))}
              onChange={(branchId) => {
                void (async () => {
                  if (
                    selectedPackageIds.length > 0 &&
                    !(await feedback.confirm({
                      tone: 'warning',
                      title: 'Ganti cakupan cabang?',
                      message: 'Pilihan paket yang sudah dipilih akan dikosongkan.',
                      confirmLabel: 'Ganti cabang',
                    }))
                  )
                    return;
                  setForm({ ...form, branchId, classTypeId: '' });
                  setSelectedPackageIds([]);
                  void (branchId
                    ? browserMasterClient.listClassTypes(branchId).then(setClassTypes)
                    : Promise.resolve(setClassTypes([])));
                })();
              }}
            />
            <SearchSelect
              label="Cakupan tipe kelas"
              value={form.classTypeId}
              placeholder="Semua tipe kelas"
              options={classTypes.map((item) => ({ id: item.id, label: item.name }))}
              onChange={(classTypeId) => {
                void (async () => {
                  if (
                    selectedPackageIds.length > 0 &&
                    !(await feedback.confirm({
                      tone: 'warning',
                      title: 'Ganti cakupan tipe kelas?',
                      message: 'Pilihan paket yang sudah dipilih akan dikosongkan.',
                      confirmLabel: 'Ganti tipe kelas',
                    }))
                  )
                    return;
                  setForm({ ...form, classTypeId });
                  setSelectedPackageIds([]);
                })();
              }}
              description="Opsional. Kosong berarti seluruh tipe kelas."
            />
          </div>
          <AsyncMultiSearchSelect
            label="Cakupan paket"
            description="Tanpa pilihan berarti voucher berlaku untuk semua paket dalam cakupan."
            placeholder="Cari dan pilih paket"
            value={selectedPackageIds}
            loadOptions={async (query, cursor) => {
              const page = await browserPackagePromotionClient.packages({
                branchId: form.branchId || undefined,
                classTypeId: form.classTypeId || undefined,
                status: 'ACTIVE',
                q: query.trim() || undefined,
                cursor,
              });
              return {
                items: page.items.map((item) => ({
                  id: item.id,
                  label: item.name,
                  description: item.branch?.name,
                })),
                nextCursor: page.page.nextCursor ?? undefined,
              };
            }}
            onChange={(ids) => setSelectedPackageIds(ids)}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              label="Kuota total"
              type="number"
              min={0}
              placeholder="Kosongkan jika tanpa batas"
              value={form.totalUsageLimit}
              onChange={(event) => setForm({ ...form, totalUsageLimit: event.target.value })}
            />
            <TextInput
              label="Batas per pelanggan"
              type="number"
              min={0}
              placeholder="Kosongkan jika tanpa batas"
              value={form.perCustomerUsageLimit}
              onChange={(event) => setForm({ ...form, perCustomerUsageLimit: event.target.value })}
            />
          </div>
          <TextInput
            label="Alasan pembuatan"
            minLength={3}
            required
            placeholder="Contoh: Rilis promo kampanye tahun baru"
            value={form.reason}
            onChange={(event) => setForm({ ...form, reason: event.target.value })}
          />
        </form>
      </Drawer>

      <EditVoucherModal
        voucher={editingVoucher}
        open={Boolean(editingVoucher)}
        onClose={() => setEditingVoucher(null)}
        onSaved={load}
      />
      {lifecycle.dialog}
    </section>
  );
}

function EditVoucherModal({
  voucher,
  open,
  onClose,
  onSaved,
}: {
  voucher: VoucherRecord | null;
  open: boolean;
  onClose(): void;
  onSaved(): Promise<void>;
}) {
  const feedback = useAppFeedback();
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');

  if (!voucher) return null;

  const hasRedemptions = (voucher.redeemedCount ?? 0) > 0;

  const confirmDiscard = () =>
    feedback.confirm({
      tone: 'warning',
      title: 'Batalkan perubahan voucher?',
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

  const toInputDate = (isoStr?: string | null) => {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 16);
  };

  return (
    <Drawer
      open={open}
      className="max-w-2xl"
      title={`Ubah Voucher: ${voucher.code}`}
      description="Perbarui parameter diskon, kuota penggunaan, periode aktif, atau informasi voucher."
      busy={busy}
      dirty={dirty}
      onDirtyClose={confirmDiscard}
      onClose={() => void handleClose()}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => void handleClose()} disabled={busy}>
            Batal
          </Button>
          <Button type="submit" form="voucher-edit-form" loading={busy}>
            Simpan perubahan
          </Button>
        </div>
      }
    >
      <form
        id="voucher-edit-form"
        className="grid gap-4"
        onChange={() => setDirty(true)}
        onSubmit={async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const name = String(data.get('name') || '').trim();
          const description = String(data.get('description') || '').trim() || null;
          const discountType = String(data.get('discountType') || 'PERCENTAGE');
          const discountValue = Number(data.get('discountValue'));
          const maxDiscountRp = data.get('maxDiscountRp') ? Number(data.get('maxDiscountRp')) : null;
          const minimumPurchaseRp = Number(data.get('minimumPurchaseRp') || 0);
          const activeFromStr = String(data.get('activeFrom') || '');
          const activeUntilStr = data.get('activeUntil') ? String(data.get('activeUntil')) : null;
          const totalUsageLimit = data.get('totalUsageLimit') ? Number(data.get('totalUsageLimit')) : null;
          const perCustomerUsageLimit = data.get('perCustomerUsageLimit')
            ? Number(data.get('perCustomerUsageLimit'))
            : null;
          const reason = String(data.get('reason') || '').trim();

          const accepted = await feedback.confirm({
            tone: 'warning',
            title: 'Simpan perubahan voucher?',
            message: `Parameter baru untuk voucher ${voucher.code} akan langsung berlaku untuk transaksi checkout berikutnya.`,
            confirmLabel: 'Simpan perubahan',
          });
          if (!accepted) return;

          setBusy(true);
          setError('');
          try {
            await browserVoucherClient.update(voucher.id, {
              name,
              description,
              discountType,
              discountValue,
              maxDiscountRp,
              minimumPurchaseRp,
              activeFrom: new Date(activeFromStr).toISOString(),
              activeUntil: activeUntilStr ? new Date(activeUntilStr).toISOString() : null,
              totalUsageLimit,
              perCustomerUsageLimit,
              expectedVersion: voucher.version,
              reason,
            });
            feedback.showToast({
              tone: 'success',
              title: 'Voucher diperbarui',
              message: `Voucher ${voucher.code} berhasil diperbarui.`,
            });
            setDirty(false);
            onClose();
            await onSaved();
          } catch {
            setError('Gagal memperbarui voucher. Data mungkin telah berubah atau input tidak valid.');
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <AlertBanner tone="danger" title="Perubahan belum tersimpan" message={error} />}

        <div className="rounded-dd-md border border-dd-line bg-dd-surface-muted/50 p-3 text-xs text-dd-muted">
          Kode Voucher: <strong className="font-mono font-semibold text-dd-ink">{voucher.code}</strong> · Penggunaan:{' '}
          <strong className="text-dd-ink">{voucher.redeemedCount} kali</strong>.
          {hasRedemptions && (
            <p className="mt-1">
              Catatan: Voucher ini telah digunakan pelanggan. Kode unik voucher terkunci untuk menjaga integritas data histori transaksi.
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput
            name="code"
            label="Kode voucher"
            defaultValue={voucher.code}
            disabled
          />
          <TextInput
            name="name"
            label="Nama voucher"
            defaultValue={voucher.name}
            required
          />
        </div>

        <Textarea
          name="description"
          label="Deskripsi voucher"
          defaultValue={voucher.description ?? ''}
          placeholder="Keterangan promosi..."
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectInput
            name="discountType"
            label="Tipe diskon"
            defaultValue={voucher.discountType}
          >
            <option value="PERCENTAGE">Persentase (%)</option>
            <option value="FIXED_AMOUNT">Nominal Tetap (Rp)</option>
          </SelectInput>
          <TextInput
            name="discountValue"
            label="Nilai diskon"
            type="number"
            min={1}
            defaultValue={voucher.discountValue}
            required
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput
            name="maxDiscountRp"
            label="Batas maksimum diskon"
            type="number"
            min={0}
            defaultValue={voucher.maxDiscountRp ?? ''}
            placeholder="Opsional untuk diskon persentase"
          />
          <TextInput
            name="minimumPurchaseRp"
            label="Minimum pembelian"
            type="number"
            min={0}
            defaultValue={voucher.minimumPurchaseRp}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput
            name="activeFrom"
            label="Mulai aktif"
            type="datetime-local"
            defaultValue={toInputDate(voucher.activeFrom)}
            required
          />
          <TextInput
            name="activeUntil"
            label="Berakhir"
            type="datetime-local"
            defaultValue={toInputDate(voucher.activeUntil)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput
            name="totalUsageLimit"
            label="Kuota total"
            type="number"
            min={0}
            defaultValue={voucher.totalUsageLimit ?? ''}
            placeholder="Kosongkan jika tanpa batas"
          />
          <TextInput
            name="perCustomerUsageLimit"
            label="Batas per pelanggan"
            type="number"
            min={0}
            defaultValue={voucher.perCustomerUsageLimit ?? ''}
            placeholder="Kosongkan jika tanpa batas"
          />
        </div>

        <TextInput
          name="reason"
          label="Alasan pembaruan"
          minLength={3}
          placeholder="Contoh: Penyesuaian kuota promo liburan"
          required
        />
      </form>
    </Drawer>
  );
}
