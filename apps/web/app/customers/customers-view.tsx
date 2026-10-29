'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, ButtonLink } from '../components/actions';
import { SearchInput, SearchSelect, SelectInput, TextInput } from '../components/forms';
import { DataTable, Pagination, TableActionMenu } from '../components/admin/admin-ui';
import { Drawer, Modal, useOptionalAppFeedback } from '../components/app-feedback';
import { Feedback, StatusBadge } from '../ui';
import { AdminPageHeader } from '../components/admin/admin-page-header';
import { useSessionContext } from '../session-context';
import { customerClient, type CustomerSummary } from './customer-client';
import { ADMIN_PAGE_SIZE, pageOffset } from '../lib/pagination';
import { statusLabel } from '../lib/status-labels';
import { AssistedSaleDrawer } from '../purchases/assisted-sale-drawer';
import { setSessionHint } from '../api-clients/session-client';
import { Edit3, Eye, EyeOff, KeyRound, LogIn, RefreshCw, ShoppingCart } from 'lucide-react';

export const customerStatusLabels: Record<string, string> = {
  ACTIVE: 'Aktif',
  INACTIVE: 'Nonaktif',
  PENDING_ACTIVATION: 'Menunggu aktivasi',
};

export const verificationStatusLabels: Record<string, string> = {
  APPROVED: 'Selfie ada',
  ACTION_REQUIRED: 'Belum ada selfie',
  REJECTED: 'Selfie perlu diulang',
  PENDING: 'Menunggu',
};

function MaskedHint() {
  return (
    <span
      className="mt-0.5 block text-xs text-dd-muted"
      title="Pelanggan ini belum berkaitan dengan cabang Anda, jadi kontaknya disamarkan."
    >
      Kontak disamarkan
    </span>
  );
}

export function CustomersView() {
  const sessionContext = useSessionContext();
  const session = sessionContext?.session;
  const feedback = useOptionalAppFeedback();
  const canCreate =
    session?.globalCapabilities?.includes('customer:credential:initialize') ?? false;
  const canWrite = Boolean(
    sessionContext?.hasCapability?.('customer:write') ||
    sessionContext?.hasCapability?.('customer:manage') ||
    session?.capabilities?.includes('customer:write') ||
    session?.capabilities?.includes('customer:manage') ||
    session?.globalCapabilities?.includes('customer:write') ||
    session?.globalCapabilities?.includes('customer:manage'),
  );
  const canSell = Boolean(
    sessionContext?.hasCapability?.('purchase:record') ||
    session?.capabilities?.includes('purchase:record') ||
    session?.globalCapabilities?.includes('purchase:record'),
  );
  const canImpersonate = Boolean(
    session?.roles?.includes('SUPER_OWNER') ||
    session?.globalCapabilities?.includes('customer:impersonate'),
  );
  const saleBranch = sessionContext?.activeBranch ?? (session?.branches?.[0] ? { id: session.branches[0].id, name: session.branches[0].name } : null);
  const saleBranches = (session?.branches ?? []).map((item) => ({ id: item.id, name: item.name }));

  const [selectedForSale, setSelectedForSale] = useState<CustomerSummary | null>(null);
  const [selectedForEdit, setSelectedForEdit] = useState<CustomerSummary | null>(null);
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickError, setQuickError] = useState('');

  const [selectedForPassword, setSelectedForPassword] = useState<CustomerSummary | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  const [selectedForImpersonate, setSelectedForImpersonate] = useState<CustomerSummary | null>(null);
  const [impersonateBusy, setImpersonateBusy] = useState(false);
  const [impersonateError, setImpersonateError] = useState('');

  const [items, setItems] = useState<CustomerSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [verificationStatus, setVerificationStatus] = useState('');
  const [cursor, setCursor] = useState<string>();
  const [history, setHistory] = useState<Array<string | undefined>>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refreshIndex, setRefreshIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function execute() {
      setLoading(true);
      try {
        const result = await customerClient.list({
          q: q || undefined,
          status: status || undefined,
          verificationStatus: verificationStatus || undefined,
          page: String(page),
          pageSize: String(ADMIN_PAGE_SIZE),
        });
        if (!cancelled) {
          setItems(result.items);
          setTotal(result.total ?? result.summary.total);
          setNextCursor(result.page?.nextCursor ?? null);
          setError('');
        }
      } catch {
        if (!cancelled) {
          setError('Data pelanggan belum dapat dimuat. Data halaman sebelumnya tetap dipertahankan.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void execute();
    return () => {
      cancelled = true;
    };
  }, [page, q, status, verificationStatus, refreshIndex]);

  const reset = () => {
    setPage(1);
    setCursor(undefined);
    setHistory([]);
  };

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSubmitting(true);
    setCreateError('');
    const password = String(data.get('password') || '').trim();
    const passwordConfirmation = String(data.get('passwordConfirmation') || '').trim();
    const email = String(data.get('email') || '').trim();
    try {
      await customerClient.create(
        {
          displayName: data.get('displayName'),
          email: email || undefined,
          phoneE164: data.get('phoneE164'),
          preferredBranchId: data.get('preferredBranchId') || null,
          password: password || undefined,
          passwordConfirmation: passwordConfirmation || (password ? undefined : undefined),
          reason: String(data.get('reason') || '').trim() || undefined,
        },
        { idempotencyKey: crypto.randomUUID() },
      );
      event.currentTarget.reset();
      setShowCreate(false);
      reset();
      setRefreshIndex((prev) => prev + 1);
    } catch (failure) {
      const code = (failure as { code?: string }).code;
      setCreateError(
        code === 'IDENTITY_CONFLICT'
          ? 'Email atau nomor telepon sudah terdaftar atas nama pelanggan lain. Gunakan data berbeda atau cari akun pelanggan di tabel.'
          : code === 'MFA_REQUIRED'
            ? 'Verifikasi MFA Super Owner diperlukan untuk membuat pelanggan.'
            : 'Pelanggan belum dapat dibuat. Pastikan format nomor telepon benar (+62... atau 08...).',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="space-y-6" aria-labelledby="customers-title">
      <AdminPageHeader
        title="Data Pelanggan"
        titleId="customers-title"
        description="Cari pelanggan dan lihat profil terpadu tanpa mengubah saldo atau transaksi di luar alur resmi."
        actions={
          canCreate ? (
            <Button
              onClick={() => {
                setCreateError('');
                setShowCreate(true);
              }}
            >
              Buat pelanggan aktif
            </Button>
          ) : undefined
        }
      />
      {error && <Feedback kind="error" onDismiss={() => setError('')}>{error}</Feedback>}

      <Drawer
        open={showCreate}
        onClose={() => {
          setCreateError('');
          setShowCreate(false);
        }}
        title="Pendaftaran Pelanggan Baru"
        description="Pendaftaran cepat member walk-in atau member baru studio."
        className="max-w-xl"
      >
        <form
          onSubmit={create}
          className="space-y-4 py-2"
        >
          <div className="rounded-dd-md bg-dd-surface-muted/40 border border-dd-line/60 p-3 text-xs text-dd-ink">
            <span className="font-bold text-dd-forest">⚡ Pendaftaran Cepat Member Walk-in:</span> Cukup isi Nama dan Nomor WhatsApp. Password dan akun langsung aktif otomatis.
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput required label="Nama" name="displayName" autoComplete="off" placeholder="Nama lengkap member" />
            <TextInput label="Email" name="email" type="email" autoComplete="off" placeholder="opsional@email.com" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput required label="Telepon" name="phoneE164" placeholder="0812 3456 7890 atau +62..." />
            <SearchSelect
              label="Studio/Cabang pilihan"
              name="preferredBranchId"
              placeholder="Belum ditentukan"
              options={(session?.branches ?? []).map((branch) => ({
                id: branch.id,
                label: branch.name,
              }))}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput
              type="password"
              label="Password awal"
              name="password"
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
              placeholder="Kosongkan untuk dibuatkan otomatis"
            />
            <TextInput
              type="password"
              label="Ulangi password"
              name="passwordConfirmation"
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
              placeholder="Kosongkan jika otomatis"
            />
          </div>
          <TextInput label="Catatan (opsional)" name="reason" maxLength={500} placeholder="Catatan member baru" />
          <Feedback kind="info">
            Pelanggan langsung aktif. Sistem otomatis mengirimkan notifikasi aktivasi ke WhatsApp member.
          </Feedback>
          {createError && (
            <Feedback kind="error" onDismiss={() => setCreateError('')}>
              {createError}
            </Feedback>
          )}
          <div className="flex justify-end gap-2 pt-3 border-t border-dd-line">
            <Button
              type="button"
              variant="secondary"
              disabled={submitting}
              onClick={() => {
                setCreateError('');
                setShowCreate(false);
              }}
            >
              Batal
            </Button>
            <Button type="submit" loading={submitting}>
              Simpan pelanggan
            </Button>
          </div>
        </form>
      </Drawer>
      <div className="grid gap-3 rounded-dd-lg border border-dd-line bg-white p-4 sm:grid-cols-3">
        <SearchInput
          label="Cari pelanggan"
          compact
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
            reset();
          }}
          placeholder="Nama, email, telepon, barcode, ID"
        />
        <SelectInput
          label="Status akun"
          compact
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            reset();
          }}
        >
          <option value="">Semua status akun</option>
          <option value="ACTIVE">Aktif</option>
          <option value="INACTIVE">Nonaktif</option>
          <option value="PENDING_ACTIVATION">Menunggu</option>
        </SelectInput>
        <SelectInput
          label="Status verifikasi"
          compact
          value={verificationStatus}
          onChange={(event) => {
            setVerificationStatus(event.target.value);
            reset();
          }}
        >
          <option value="">Semua verifikasi</option>
          <option value="APPROVED">Disetujui</option>
          <option value="ACTION_REQUIRED">Perlu perbaikan</option>
          <option value="PENDING">Menunggu</option>
        </SelectInput>
      </div>
      <DataTable
        rowNumberOffset={(page - 1) * ADMIN_PAGE_SIZE}
        items={items}
        loading={loading && !items.length}
        rowKey={(item) => item.id}
        emptyTitle="Tidak ada pelanggan yang cocok"
        emptyDescription="Ubah kata kunci atau filter untuk melihat pelanggan lain."
        columns={[
          {
            id: 'customer',
            header: 'Pelanggan',
            cell: (item) => (
              <>
                <strong>{item.displayName}</strong>
                <div className="text-dd-muted">{item.email || item.phoneE164 || item.id}</div>
                {item.contactMasked && <MaskedHint />}
              </>
            ),
          },
          {
            id: 'status',
            header: 'Status',
            cell: (item) => (
              <>
                <StatusBadge tone={item.status === 'ACTIVE' ? 'success' : 'warning'}>
                  {customerStatusLabels[item.status] ?? statusLabel(item.status)}
                </StatusBadge>
                <div className="mt-1 text-xs text-dd-muted">
                  {verificationStatusLabels[item.verificationStatus] ??
                    statusLabel(item.verificationStatus)}
                </div>
              </>
            ),
          },
          {
            id: 'packages',
            header: 'Paket',
            cell: (item) => `${item.activePackageCount} paket aktif · ${item._count?.purchases ?? 0} order`,
          },
          {
            id: 'activity',
            header: 'Aktivitas',
            cell: (item) =>
              `${item._count?.purchases ?? 0} order · ${item._count?.customerBookings ?? 0} booking`,
          },
          {
            id: 'action',
            header: <span className="sr-only">Tindakan</span>,
            cell: (item) => (
              <div className="flex items-center justify-end gap-1.5">
                <ButtonLink variant="secondary" size="sm" href={`/customers/${item.id}`}>
                  Lihat detail
                </ButtonLink>
                {canSell && saleBranches.length > 0 && item.status === 'ACTIVE' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Jual paket langsung untuk pelanggan ini"
                    onClick={() => setSelectedForSale(item)}
                  >
                    <ShoppingCart className="size-3.5 text-dd-forest" />
                    <span className="hidden xl:inline">Jual paket</span>
                  </Button>
                )}
                {!item.contactMasked && (canWrite || (canImpersonate && item.status === 'ACTIVE')) && (
                  <TableActionMenu
                    ariaLabel={`Aksi pelanggan ${item.displayName}`}
                    items={[
                      ...(canWrite && !item.contactMasked
                        ? [
                            {
                              id: 'edit',
                              label: 'Edit profil',
                              icon: <Edit3 className="size-3.5 text-dd-muted" aria-hidden="true" />,
                              onClick: () => setSelectedForEdit(item),
                            },
                            {
                              id: 'password',
                              label: 'Reset kata sandi',
                              icon: <KeyRound className="size-3.5 text-dd-muted" aria-hidden="true" />,
                              onClick: () => {
                                setSelectedForPassword(item);
                                setNewPassword('');
                                setPasswordError('');
                              },
                            },
                          ]
                        : []),
                      ...(canImpersonate && item.status === 'ACTIVE'
                        ? [
                            {
                              id: 'impersonate',
                              label: 'Login sebagai Pelanggan',
                              icon: <LogIn className="size-3.5 text-dd-forest" aria-hidden="true" />,
                              onClick: () => {
                                setSelectedForImpersonate(item);
                                setImpersonateError('');
                              },
                            },
                          ]
                        : []),
                    ]}
                  />
                )}
              </div>
            ),
          },
        ]}
        mobileCard={(item) => (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <strong className="block truncate">{item.displayName}</strong>
                <span className="text-sm text-dd-muted">
                  {item.email || item.phoneE164 || item.id}
                </span>
                {item.contactMasked && <MaskedHint />}
              </div>
              <StatusBadge tone={item.status === 'ACTIVE' ? 'success' : 'warning'}>
                {customerStatusLabels[item.status] ?? statusLabel(item.status)}
              </StatusBadge>
            </div>
            <p className="text-xs text-dd-muted">
              {verificationStatusLabels[item.verificationStatus] ??
                statusLabel(item.verificationStatus)}{' '}
              · {item.activePackageCount} paket aktif · {item._count?.purchases ?? 0} order ·{' '}
              {item._count?.customerBookings ?? 0} booking
            </p>
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <ButtonLink variant="secondary" size="sm" href={`/customers/${item.id}`}>
                Lihat detail
              </ButtonLink>
              {canSell && saleBranches.length > 0 && item.status === 'ACTIVE' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedForSale(item)}
                >
                  <ShoppingCart className="size-3.5 text-dd-forest" /> Jual paket
                </Button>
              )}
              {!item.contactMasked && (canWrite || (canImpersonate && item.status === 'ACTIVE')) && (
                <TableActionMenu
                  ariaLabel={`Aksi pelanggan ${item.displayName}`}
                  items={[
                    ...(canWrite && !item.contactMasked
                      ? [
                          {
                            id: 'edit',
                            label: 'Edit profil',
                            icon: <Edit3 className="size-3.5" aria-hidden="true" />,
                            onClick: () => setSelectedForEdit(item),
                          },
                          {
                            id: 'password',
                            label: 'Reset kata sandi',
                            icon: <KeyRound className="size-3.5" aria-hidden="true" />,
                            onClick: () => {
                              setSelectedForPassword(item);
                              setNewPassword('');
                              setPasswordError('');
                            },
                          },
                        ]
                      : []),
                    ...(canImpersonate && item.status === 'ACTIVE'
                      ? [
                          {
                            id: 'impersonate',
                            label: 'Login sebagai Pelanggan',
                            icon: <LogIn className="size-3.5 text-dd-forest" aria-hidden="true" />,
                            onClick: () => {
                              setSelectedForImpersonate(item);
                              setImpersonateError('');
                            },
                          },
                        ]
                      : []),
                  ]}
                />
              )}
            </div>
          </div>
        )}
      />
      <Pagination
        currentPage={page}
        totalPages={Math.ceil(total / ADMIN_PAGE_SIZE) || 1}
        totalItems={total}
        pageSize={ADMIN_PAGE_SIZE}
        hasPrevious={page > 1 && !loading}
        hasNext={page < (Math.ceil(total / ADMIN_PAGE_SIZE) || 1) && !loading}
        showPageNumbers
        totalLabel={`${total.toLocaleString('id-ID')} pelanggan`}
        onPageChange={(target) => setPage(target)}
        onPrevious={() => setPage((p) => Math.max(1, p - 1))}
        onNext={() => setPage((p) => Math.min(Math.ceil(total / ADMIN_PAGE_SIZE) || 1, p + 1))}
      />

      {/* Assisted Sale Drawer */}
      {canSell && saleBranches.length > 0 && selectedForSale && (
        <AssistedSaleDrawer
          open={Boolean(selectedForSale)}
          branch={saleBranch}
          branches={saleBranches}
          customer={{ id: selectedForSale.id, name: selectedForSale.displayName }}
          onClose={() => setSelectedForSale(null)}
          onRecorded={() => {
            const customerName = selectedForSale.displayName;
            setSelectedForSale(null);
            feedback?.showToast({
              tone: 'success',
              title: 'Penjualan berhasil dicatat',
              message: `Paket untuk ${customerName} berhasil diproses.`,
            });
            setRefreshIndex((prev) => prev + 1);
          }}
        />
      )}

      {/* Quick Edit Customer Modal */}
      {selectedForEdit && (
        <Modal
          open={Boolean(selectedForEdit)}
          title={`Edit Cepat: ${selectedForEdit.displayName}`}
          description="Perbarui informasi kontak dan cabang pilihan member."
          onClose={() => setSelectedForEdit(null)}
        >
          <form
            className="space-y-4 py-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              setQuickBusy(true);
              setQuickError('');
              try {
                await customerClient.updateProfile(
                  selectedForEdit.id,
                  {
                    displayName: String(formData.get('displayName')),
                    email: formData.get('email') ? String(formData.get('email')) : null,
                    phoneE164: String(formData.get('phoneE164')),
                    preferredBranchId: formData.get('preferredBranchId') ? String(formData.get('preferredBranchId')) : null,
                    expectedVersion: selectedForEdit.version,
                    reason: 'Pembaruan cepat dari tabel pelanggan',
                  },
                  { idempotencyKey: crypto.randomUUID() },
                );
                feedback?.showToast({
                  tone: 'success',
                  title: 'Data pelanggan diperbarui',
                  message: `Profil ${formData.get('displayName')} berhasil disimpan.`,
                });
                setSelectedForEdit(null);
                setRefreshIndex((prev) => prev + 1);
              } catch (cause: any) {
                setQuickError(cause?.message || 'Gagal memperbarui profil pelanggan.');
              } finally {
                setQuickBusy(false);
              }
            }}
          >
            {quickError && <Feedback kind="error">{quickError}</Feedback>}
            <TextInput
              required
              label="Nama Lengkap"
              name="displayName"
              defaultValue={selectedForEdit.displayName}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput
                required
                label="Nomor WhatsApp / Telepon"
                name="phoneE164"
                defaultValue={selectedForEdit.phoneE164 ?? ''}
              />
              <TextInput
                label="Email (opsional)"
                name="email"
                type="email"
                defaultValue={selectedForEdit.email ?? ''}
              />
            </div>
            <SearchSelect
              label="Studio/Cabang Pilihan"
              name="preferredBranchId"
              defaultValue={selectedForEdit.preferredBranch?.id ?? ''}
              placeholder="Pilih studio"
              options={(session?.branches ?? []).map((branch) => ({
                id: branch.id,
                label: branch.name,
              }))}
            />
            <div className="flex justify-end gap-2 pt-3 border-t border-dd-line">
              <Button
                type="button"
                variant="secondary"
                disabled={quickBusy}
                onClick={() => setSelectedForEdit(null)}
              >
                Batal
              </Button>
              <Button type="submit" loading={quickBusy}>
                Simpan Perubahan
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Quick Reset Password Modal */}
      {selectedForPassword && (
        <Modal
          open={Boolean(selectedForPassword)}
          title={`Reset Kata Sandi: ${selectedForPassword.displayName}`}
          description={`Setel kata sandi baru untuk member ${selectedForPassword.displayName}. Member dapat langsung login ke portal member menggunakan kata sandi ini.`}
          onClose={() => {
            setSelectedForPassword(null);
            setNewPassword('');
          }}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newPassword || newPassword.length < 8) return;
              setPasswordBusy(true);
              setPasswordError('');
              try {
                await customerClient.resetPassword(selectedForPassword.id, newPassword);
                feedback?.showToast({
                  tone: 'success',
                  title: 'Kata sandi direset',
                  message: `Kata sandi untuk ${selectedForPassword.displayName} berhasil diperbarui.`,
                });
                setSelectedForPassword(null);
                setNewPassword('');
              } catch (cause: any) {
                setPasswordError(cause?.message || 'Gagal mereset kata sandi.');
              } finally {
                setPasswordBusy(false);
              }
            }}
            className="space-y-4 py-2"
          >
            {passwordError && <Feedback kind="error">{passwordError}</Feedback>}
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-dd-ink" htmlFor="quick-reset-password">
                  Kata Sandi Baru (Min. 8 karakter)
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
                    let generated = '';
                    for (let i = 0; i < 10; i++) {
                      generated += chars.charAt(Math.floor(Math.random() * chars.length));
                    }
                    setNewPassword(generated);
                    setShowPassword(true);
                  }}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-dd-forest hover:underline cursor-pointer"
                >
                  <RefreshCw className="size-3" /> Buat Sandi Acak
                </button>
              </div>
              <div className="relative flex items-center">
                <input
                  id="quick-reset-password"
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Masukkan kata sandi baru atau klik Buat Sandi Acak"
                  minLength={8}
                  required
                  className="w-full rounded-dd-md border border-dd-line bg-white px-3 py-2 pr-10 text-sm text-dd-ink outline-none focus:border-dd-forest focus:ring-2 focus:ring-dd-forest/15"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 text-dd-muted hover:text-dd-ink cursor-pointer"
                  tabIndex={-1}
                  aria-label={showPassword ? 'Sembunyikan password' : 'Lihat password'}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-dd-line">
              <Button
                type="button"
                variant="secondary"
                disabled={passwordBusy}
                onClick={() => {
                  setSelectedForPassword(null);
                  setNewPassword('');
                }}
              >
                Batal
              </Button>
              <Button
                type="submit"
                loading={passwordBusy}
                disabled={!newPassword || newPassword.length < 8}
              >
                Simpan Kata Sandi
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Impersonate Customer Modal */}
      {selectedForImpersonate && (
        <Modal
          open={Boolean(selectedForImpersonate)}
          title={`Masuk sebagai ${selectedForImpersonate.displayName}`}
          description={`Anda akan masuk ke portal pelanggan sebagai ${selectedForImpersonate.displayName} tanpa kata sandi untuk melihat saldo paket, riwayat sesi, dan data lainnya.`}
          onClose={() => {
            if (!impersonateBusy) {
              setSelectedForImpersonate(null);
              setImpersonateError('');
            }
          }}
        >
          <div className="space-y-4 py-2">
            {impersonateError && <Feedback kind="error">{impersonateError}</Feedback>}
            <p className="text-sm text-dd-muted">
              Sesi Super Owner di peramban ini akan dialihkan langsung ke tampilan portal pelanggan (Paket Saya).
            </p>
            <div className="flex justify-end gap-2 pt-3 border-t border-dd-line">
              <Button
                type="button"
                variant="secondary"
                disabled={impersonateBusy}
                onClick={() => {
                  setSelectedForImpersonate(null);
                  setImpersonateError('');
                }}
              >
                Batal
              </Button>
              <Button
                type="button"
                loading={impersonateBusy}
                onClick={async () => {
                  setImpersonateBusy(true);
                  setImpersonateError('');
                  try {
                    await customerClient.impersonate(selectedForImpersonate.id);
                    if (typeof sessionStorage !== 'undefined') {
                      sessionStorage.removeItem('dd_active_branch');
                    }
                    setSessionHint();
                    window.location.href = '/account/packages';
                  } catch (cause: any) {
                    setImpersonateError(cause?.message || 'Gagal masuk sebagai pelanggan.');
                    setImpersonateBusy(false);
                  }
                }}
              >
                Masuk Sekarang
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
