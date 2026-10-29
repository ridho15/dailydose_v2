'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronDown,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRoundCog,
  X,
} from 'lucide-react';
import {
  accessFailureCode,
  browserAccessClient,
  type AccessClient,
  type AccessRole,
  type CapabilityDefinition,
  type UserAccess,
} from '@/api-clients/access-client';
import { AlertBanner, useAppFeedback } from '../../components/app-feedback';
import { Button, ButtonLink } from '../../components/actions';
import { SearchInput, SearchSelect, SelectInput } from '../../components/forms';
import { Panel, Tabs } from '../../components/admin/admin-ui';
import {
  browserIdentityClient,
  type IdentityClient,
  type LookupOption,
} from '@/api-clients/identity-client';
import { browserMasterClient, type MasterClient } from '@/api-clients/master-client';
import { EmptyState, Feedback, Skeleton, StatusBadge } from '../../ui';
import { AdminPageHeader } from '../../components/admin/admin-page-header';

type RoleDraft = {
  code: string;
  displayName: string;
  description: string;
  scope: 'GLOBAL' | 'BRANCH';
  capabilityKeys: string[];
};

type RoleAssignmentDraft = { roleId: string; branchId: string | null };
type WorkspaceTab = 'roles' | 'users';
type RoleCatalogFilter = 'ACTIVE' | 'INACTIVE' | 'SYSTEM' | 'CUSTOM';

const idempotencyKey = () => crypto.randomUUID();

const CATEGORY_LABELS: Record<string, string> = {
  ACCESS: 'Akses dan hak akses',
  ASSIGNMENT: 'Penugasan',
  ATTENDANCE: 'Kehadiran',
  AUDIT: 'Audit',
  BOOKING: 'Booking',
  BRANCH: 'Cabang',
  CLASS: 'Kelas',
  CUSTOMER: 'Pelanggan',
  DASHBOARD: 'Dashboard',
  FINANCE: 'Finance',
  IDENTITY: 'Verifikasi identitas',
  LEDGER: 'Ledger dan sesi',
  MASTER: 'Master Data',
  OPERATIONS: 'Operasional sistem',
  PACKAGE: 'Paket dan promo',
  PAYMENT: 'Pembayaran',
  RESCHEDULE: 'Reschedule',
  SECURITY: 'Keamanan',
  USER: 'Pengguna',
  VOUCHER: 'Voucher',
};

function categoryLabel(value: string) {
  return CATEGORY_LABELS[value] ?? value.replaceAll('_', ' ').toLowerCase();
}

function initialUrlState() {
  if (typeof window === 'undefined')
    return { tab: 'roles' as WorkspaceTab, role: '', user: '', roleFilter: 'ACTIVE' as const };
  const params = new URLSearchParams(window.location.search);
  return {
    tab: params.get('tab') === 'users' ? ('users' as const) : ('roles' as const),
    role: params.get('role') ?? '',
    user: params.get('user') ?? '',
    roleFilter: (['ACTIVE', 'INACTIVE', 'SYSTEM', 'CUSTOM'].includes(params.get('roleFilter') ?? '')
      ? params.get('roleFilter')
      : 'ACTIVE') as RoleCatalogFilter,
  };
}

function errorMessage(code: string) {
  const messages: Record<string, string> = {
    FORBIDDEN: 'Hanya Super Owner dengan izin pengelolaan role yang dapat membuka halaman ini.',
    CONFIGURATION_REQUIRED:
      'Management RBAC belum diaktifkan. Set RBAC_POLICY_SOURCE=database dan RBAC_MANAGEMENT_ENABLED=true.',
    ROLE_CODE_CONFLICT: 'Kode role sudah digunakan.',
    ROLE_IN_USE: 'Role masih digunakan user aktif dan tidak dapat dinonaktifkan.',
    PROTECTED_ROLE_CHANGE: 'Perubahan ini melanggar proteksi system role.',
    PROTECTED_CAPABILITY: 'Izin inti hanya dapat dimiliki SUPER_OWNER.',
    LAST_SUPER_OWNER: 'Perubahan ditolak karena akan menghilangkan Super Owner aktif terakhir.',
    SELF_ACCESS_CHANGE_FORBIDDEN: 'Super Owner tidak boleh mengubah akses akunnya sendiri.',
    PERMISSION_OVERRIDE_EXISTS: 'Override aktif untuk user, izin, dan cakupan itu sudah ada.',
    STALE_VERSION: 'Data telah berubah. Muat ulang sebelum menyimpan kembali.',
    IDEMPOTENCY_KEY_REUSED: 'Intent penyimpanan telah berubah. Ulangi dari data terbaru.',
  };
  return messages[code] ?? `Perubahan gagal (${code}).`;
}

function capabilityMatches(item: CapabilityDefinition, search: string, category: string) {
  const query = search.trim().toLowerCase();
  return (
    (!category || item.category === category) &&
    (!query ||
      item.key.toLowerCase().includes(query) ||
      item.label.toLowerCase().includes(query) ||
      item.description.toLowerCase().includes(query))
  );
}

export function RolePermissionsView({
  accessClient = browserAccessClient,
  identityClient,
  client,
  masterClient = browserMasterClient,
}: {
  accessClient?: AccessClient;
  identityClient?: IdentityClient;
  /** Compatibility alias retained for existing callers during the RBAC UI migration. */
  client?: IdentityClient;
  masterClient?: MasterClient;
}) {
  const resolvedIdentityClient = identityClient ?? client ?? browserIdentityClient;
  const feedback = useAppFeedback();
  const [urlState, setUrlState] = useState(initialUrlState);
  const [roles, setRoles] = useState<AccessRole[]>([]);
  const [capabilities, setCapabilities] = useState<CapabilityDefinition[]>([]);
  const [branches, setBranches] = useState<
    Array<{ id: string; code: string; name: string; active: boolean }>
  >([]);
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [roleDraft, setRoleDraft] = useState<RoleDraft | null>(null);
  const [roleSearch, setRoleSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleCatalogFilter>(urlState.roleFilter);
  const [capabilitySearch, setCapabilitySearch] = useState('');
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState('');

  const [userSearch, setUserSearch] = useState('');
  const [userOptions, setUserOptions] = useState<LookupOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [userAccess, setUserAccess] = useState<UserAccess | null>(null);
  const [roleAssignments, setRoleAssignments] = useState<RoleAssignmentDraft[]>([]);

  const selectedRole = roles.find(({ id }) => id === selectedRoleId) ?? null;
  const categories = useMemo(
    () => [...new Set(capabilities.map(({ category }) => category))].sort(),
    [capabilities],
  );
  const visibleCapabilities = capabilities.filter((item) =>
    capabilityMatches(item, capabilitySearch, category),
  );
  const assignableRoles = roles.filter(
    (role) =>
      role.active &&
      (!role.systemRole ||
        ['ADMIN', 'MANAGER', 'FINANCE', 'SUPER_OWNER'].includes(role.systemRole)),
  );
  const visibleRoles = useMemo(() => {
    const query = roleSearch.trim().toLowerCase();
    return roles.filter((role) => {
      const matchesQuery =
        !query ||
        role.displayName.toLowerCase().includes(query) ||
        role.code.toLowerCase().includes(query) ||
        role.description.toLowerCase().includes(query);
      const matchesFilter =
        roleFilter === 'ACTIVE'
          ? role.active
          : roleFilter === 'INACTIVE'
            ? !role.active
            : roleFilter === 'SYSTEM'
              ? role.system && role.active
              : !role.system && role.active;
      return matchesQuery && matchesFilter;
    });
  }, [roleFilter, roleSearch, roles]);
  const selectedCapabilityKeys = useMemo(
    () => new Set(selectedRole?.capabilities.map(({ key }) => key) ?? []),
    [selectedRole],
  );
  const capabilityGroups = useMemo(() => {
    const groups = new Map<string, CapabilityDefinition[]>();
    visibleCapabilities
      .filter((capability) => selectedCapabilityKeys.has(capability.key))
      .forEach((capability) => {
        const items = groups.get(capability.category) ?? [];
        items.push(capability);
        groups.set(capability.category, items);
      });
    return [...groups.entries()].sort(([left], [right]) =>
      categoryLabel(left).localeCompare(categoryLabel(right), 'id-ID'),
    );
  }, [selectedCapabilityKeys, visibleCapabilities]);

  function updateUrl(next: Partial<typeof urlState>, replace = false) {
    const merged = { ...urlState, ...next };
    setUrlState(merged);
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (merged.tab === 'roles') params.delete('tab');
    else params.set('tab', merged.tab);
    if (merged.role) params.set('role', merged.role);
    else params.delete('role');
    if (merged.user) params.set('user', merged.user);
    else params.delete('user');
    if (merged.roleFilter === 'ACTIVE') params.delete('roleFilter');
    else params.set('roleFilter', merged.roleFilter);
    const href = `${window.location.pathname}${params.size ? `?${params}` : ''}`;
    window.history[replace ? 'replaceState' : 'pushState']({}, '', href);
  }

  function beginRole(role: AccessRole) {
    setSelectedRoleId(role.id);
    setRoleDraft({
      code: role.code,
      displayName: role.displayName,
      description: role.description,
      scope: role.scope,
      capabilityKeys: role.capabilities.map(({ key }) => key),
    });
    updateUrl({ role: role.id });
  }

  async function loadActiveBranches() {
    const items: Awaited<ReturnType<MasterClient['listBranches']>>['items'] = [];
    let cursor: string | undefined;
    do {
      const page = await masterClient.listBranches({ status: 'ACTIVE', cursor, limit: 50 });
      items.push(...page.items);
      cursor = page.page.nextCursor ?? undefined;
    } while (cursor);
    return items;
  }

  async function load() {
    setLoading(true);
    setFailure('');
    try {
      const [nextRoles, nextCapabilities, nextBranches] = await Promise.all([
        accessClient.listRoles(),
        accessClient.listCapabilities({ active: true }),
        loadActiveBranches(),
      ]);
      setRoles(nextRoles);
      setCapabilities(nextCapabilities);
      setBranches(nextBranches.filter(({ active }) => active));
      const selected =
        nextRoles.find(({ id }) => id === selectedRoleId || id === urlState.role) ??
        nextRoles.find(({ active }) => active) ??
        nextRoles[0];
      if (selected) {
        setSelectedRoleId(selected.id);
        setRoleDraft({
          code: selected.code,
          displayName: selected.displayName,
          description: selected.description,
          scope: selected.scope,
          capabilityKeys: selected.capabilities.map(({ key }) => key),
        });
        updateUrl({ role: selected.id }, true);
      }
      if (urlState.user) await loadUser(urlState.user);
    } catch (error) {
      setFailure(accessFailureCode(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const restore = () => {
      const next = initialUrlState();
      setUrlState(next);
      setRoleFilter(next.roleFilter);
      if (next.role && roles.some(({ id }) => id === next.role)) setSelectedRoleId(next.role);
      if (next.user && next.user !== selectedUserId) void loadUser(next.user);
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [roles, selectedUserId]);

  async function searchUsers() {
    setFailure('');
    try {
      const result = await resolvedIdentityClient.lookupUsers({ q: userSearch, limit: 12 });
      setUserOptions(result.items);
    } catch (error) {
      setFailure(accessFailureCode(error));
    }
  }

  async function loadUser(userId: string) {
    setSelectedUserId(userId);
    updateUrl({ tab: 'users', user: userId });
    setFailure('');
    try {
      const result = await accessClient.getUserAccess(userId);
      setUserAccess(result);
      setRoleAssignments(
        result.roleAssignments
          .filter(({ source, roleId }) => source === 'DIRECT' && roleId)
          .map(({ roleId, branchId }) => ({ roleId: roleId!, branchId })),
      );
    } catch (error) {
      setFailure(accessFailureCode(error));
    }
  }

  function toggleAssignment(role: AccessRole, enabled: boolean, branchId: string | null = null) {
    setRoleAssignments((current) => {
      const matches = (item: RoleAssignmentDraft) =>
        item.roleId === role.id && item.branchId === branchId;
      return enabled
        ? current.some(matches)
          ? current
          : [...current, { roleId: role.id, branchId }]
        : current.filter((item) => !matches(item));
    });
  }

  async function saveUserRoles() {
    if (!userAccess) return;
    const accepted = await feedback.confirm({
      tone: 'warning',
      title: 'Ganti role langsung user?',
      message: `Role langsung ${userAccess.user.displayName} akan diganti dan seluruh session aktifnya dicabut. Role lifecycle/penugasan tidak berubah.`,
      confirmLabel: 'Ganti role',
    });
    if (!accepted) return;
    try {
      await accessClient.replaceUserRoles(
        userAccess.user.id,
        {
          roles: roleAssignments,
          expectedVersion: userAccess.user.version,
          reasonCode: 'ROLE_REPLACEMENT',
        },
        idempotencyKey(),
      );
      await loadUser(userAccess.user.id);
      feedback.showToast({
        tone: 'success',
        title: 'Role user diperbarui',
        message: 'User wajib login ulang agar akses baru digunakan.',
      });
    } catch (error) {
      setFailure(accessFailureCode(error));
    }
  }

  return (
    <section className="space-y-5" aria-labelledby="roles-permissions-title">
      <AdminPageHeader
        title="Peran & Hak Akses"
        titleId="roles-permissions-title"
        description="Katalog peran bawaan sistem beserta izinnya, dan akses efektif pengguna. Peran dan izin ditetapkan sistem (hanya baca); membuat peran khusus dan pengecualian izin belum tersedia. Mengganti peran langsung pengguna mencabut sesi aktifnya."
        actions={
          <div className="grid justify-items-start gap-3 sm:justify-items-end">
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone="info">Peran bawaan sistem (hanya baca)</StatusBadge>
              <StatusBadge tone="info">Khusus Super Owner</StatusBadge>
            </div>
            <div className="flex flex-wrap gap-2">
              <ButtonLink
                href="/users"
                variant="secondary"
                trailingIcon={<ArrowRight className="size-4" aria-hidden="true" />}
              >
                Daftar pengguna
              </ButtonLink>
              <ButtonLink
                href="/audit"
                variant="secondary"
                trailingIcon={<ArrowRight className="size-4" aria-hidden="true" />}
              >
                Audit akses
              </ButtonLink>
            </div>
          </div>
        }
      />

      <Tabs
        value={urlState.tab}
        items={[
          {
            value: 'roles',
            label: 'Role & Izin',
            count: roles.filter((role) => role.active).length,
          },
          { value: 'users', label: 'Akses Pengguna' },
        ]}
        onChange={(value) => updateUrl({ tab: value as WorkspaceTab })}
      />

      {failure && <Feedback kind="error">{errorMessage(failure)}</Feedback>}
      {loading ? (
        <Skeleton label="Memuat role dan izin" />
      ) : failure === 'FORBIDDEN' ? null : (
        <>
          {urlState.tab === 'roles' && (
            <section className="grid items-start gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
              <aside className="self-start rounded-dd-xl border border-dd-line bg-white p-4 xl:sticky xl:top-24">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-semibold">Katalog role</h2>
                    <p className="mt-1 text-xs text-dd-muted">
                      {visibleRoles.length} role ditampilkan
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid gap-3">
                  <SearchInput
                    label="Cari role"
                    compact
                    placeholder="Nama atau kode role"
                    value={roleSearch}
                    leadingIcon={<Search className="size-4" aria-hidden="true" />}
                    onChange={(event) => setRoleSearch(event.target.value)}
                  />
                  <SelectInput
                    label="Tampilkan"
                    compact
                    value={roleFilter}
                    onChange={(event) => {
                      const value = event.target.value as RoleCatalogFilter;
                      setRoleFilter(value);
                      updateUrl({ roleFilter: value });
                    }}
                  >
                    <option value="ACTIVE">Role aktif</option>
                    <option value="SYSTEM">System role</option>
                    <option value="CUSTOM">Custom role</option>
                    <option value="INACTIVE">Role nonaktif</option>
                  </SelectInput>
                </div>
                <SearchSelect
                  wrapperClassName="mt-4 xl:hidden"
                  label="Role terpilih"
                  value={
                    visibleRoles.some((role) => role.id === selectedRoleId) ? selectedRoleId : ''
                  }
                  placeholder="Pilih role"
                  options={visibleRoles.map((role) => ({
                    id: role.id,
                    label: role.displayName,
                    description: role.scope === 'GLOBAL' ? 'Cakupan global' : 'Cakupan per cabang',
                  }))}
                  onChange={(value) => {
                    const role = visibleRoles.find((item) => item.id === value);
                    if (role) beginRole(role);
                  }}
                />
                <div className="mt-4 hidden max-h-[calc(100dvh-22rem)] gap-2 overflow-y-auto pr-1 xl:grid">
                  {visibleRoles.map((role) => (
                    <button
                      key={role.id}
                      type="button"
                      aria-pressed={role.id === selectedRoleId}
                      className={`rounded-dd-lg border p-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dd-forest ${
                        role.id === selectedRoleId
                          ? 'border-dd-forest bg-dd-surface-muted ring-1 ring-dd-forest/15'
                          : 'border-dd-line bg-white hover:border-dd-forest/40'
                      }`}
                      onClick={() => beginRole(role)}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <strong className="text-sm">{role.displayName}</strong>
                        <span className="flex items-center gap-2">
                          {!role.active && <StatusBadge tone="neutral">Nonaktif</StatusBadge>}
                          {role.protected && <LockKeyhole className="size-4 text-dd-muted" />}
                        </span>
                      </span>
                      <span className="mt-1 block text-xs text-dd-muted">
                        {role.scope === 'GLOBAL' ? 'Cakupan global' : 'Cakupan per cabang'} ·{' '}
                        {role.affectedUsers} pengguna
                      </span>
                      <span className="mt-2 block font-mono text-[11px] text-dd-muted/80">
                        {role.code}
                      </span>
                    </button>
                  ))}
                  {visibleRoles.length === 0 && (
                    <p className="rounded-dd-lg border border-dashed border-dd-line p-4 text-sm text-dd-muted">
                      Tidak ada role yang sesuai dengan filter.
                    </p>
                  )}
                </div>
              </aside>

              {selectedRole && roleDraft ? (
                <div className="space-y-5">
                  <section className="rounded-dd-xl border border-dd-line bg-white p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-[13px] font-bold text-dd-forest">
                          Konfigurasi role
                        </p>
                        <h2>{selectedRole?.displayName}</h2>
                        {selectedRole?.description && (
                          <p className="mt-2 max-w-2xl text-sm leading-6 text-dd-muted">
                            {selectedRole.description}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <StatusBadge tone={selectedRole?.system ? 'info' : 'neutral'}>
                          {selectedRole?.system ? 'System role' : 'Custom role'}
                        </StatusBadge>
                        {selectedRole && !selectedRole.active && (
                          <StatusBadge tone="neutral">Nonaktif</StatusBadge>
                        )}
                      </div>
                    </div>
                    <dl className="mt-5 grid gap-3 sm:grid-cols-3">
                        <Metadata label="Kode role" value={roleDraft.code} mono />
                        <Metadata
                          label="Cakupan"
                          value={roleDraft.scope === 'GLOBAL' ? 'Global' : 'Per cabang'}
                        />
                        <Metadata
                          label="Pengguna aktif"
                          value={`${selectedRole?.affectedUsers ?? 0} pengguna`}
                        />
                      </dl>
                  </section>

                  <section className="rounded-dd-xl border border-dd-line bg-white p-5">
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="min-w-64 flex-1">
                        <SearchInput
                          id="capability-search"
                          label="Cari izin"
                          description="Cari key, label, atau deskripsi."
                          placeholder="Contoh: ledger:adjust"
                          value={capabilitySearch}
                          leadingIcon={<Search className="size-4" />}
                          onChange={(event) => setCapabilitySearch(event.target.value)}
                        />
                      </div>
                      <SearchSelect
                        wrapperClassName="min-w-48"
                        label="Kategori"
                        value={category}
                        placeholder="Semua kategori"
                        options={categories.map((value) => ({
                          id: value,
                          label: categoryLabel(value),
                        }))}
                        onChange={setCategory}
                      />
                      {(category || capabilitySearch) && (
                        <Button
                          variant="ghost"
                          leadingIcon={<X className="size-4" aria-hidden="true" />}
                          onClick={() => {
                            setCategory('');
                            setCapabilitySearch('');
                          }}
                        >
                          Bersihkan
                        </Button>
                      )}
                    </div>
                    <p className="mt-4 text-sm text-dd-muted">
                      {visibleCapabilities.length} dari {capabilities.length} capability ·{' '}
                      {roleDraft.capabilityKeys.length} dipilih
                    </p>
                    <div className="mt-4">
                      <AlertBanner
                        tone="info"
                        title="Izin peran bersifat tetap"
                        message="Matriks ini hanya dapat dibaca. Kelola siapa yang memperoleh peran dan cakupannya melalui tab Akses Pengguna."
                      />
                    </div>
                    <div className="mt-4 grid gap-3">
                        {capabilityGroups.map(([group, items], index) => (
                          <details
                            key={group}
                            open={Boolean(category || capabilitySearch || index === 0)}
                            className="group rounded-dd-lg border border-dd-line"
                          >
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dd-forest">
                              <span>
                                <strong className="text-sm">{categoryLabel(group)}</strong>
                                <span className="ml-2 text-xs text-dd-muted">
                                  {items.length} capability aktif
                                </span>
                              </span>
                              <ChevronDown
                                className="size-4 text-dd-muted transition group-open:rotate-180"
                                aria-hidden="true"
                              />
                            </summary>
                            <div className="grid gap-2 border-t border-dd-line p-3 sm:grid-cols-2">
                              {items.map((capability) => (
                                <article
                                  key={capability.key}
                                  className="flex gap-3 rounded-dd-md bg-dd-surface-muted p-3"
                                >
                                  <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-dd-success-soft text-dd-success">
                                    <Check className="size-3.5" aria-hidden="true" />
                                  </span>
                                  <span className="min-w-0">
                                    <span className="flex flex-wrap items-center gap-2">
                                      <strong className="text-sm">{capability.label}</strong>
                                      {capability.sensitive && (
                                        <StatusBadge tone="warning">Sensitif</StatusBadge>
                                      )}
                                      {capability.globalOnly && (
                                        <StatusBadge tone="info">Hanya global</StatusBadge>
                                      )}
                                    </span>
                                    <span className="mt-1 block text-xs leading-5 text-dd-muted">
                                      {capability.description}
                                    </span>
                                    <code className="mt-2 block break-all text-[11px] text-dd-muted/80">
                                      {capability.key}
                                    </code>
                                  </span>
                                </article>
                              ))}
                            </div>
                          </details>
                        ))}
                        {capabilityGroups.length === 0 && (
                          <EmptyState
                            title="Izin tidak ditemukan"
                            description="Ubah pencarian atau kategori untuk melihat izin role ini."
                          />
                        )}
                      </div>
                  </section>
                </div>
              ) : (
                <EmptyState
                  title="Pilih atau buat role"
                  description="Pilih role untuk melihat metadata dan izin."
                />
              )}
            </section>
          )}

          {urlState.tab === 'users' && (
            <section className="rounded-dd-xl border border-dd-line bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[13px] font-bold text-dd-forest">Akses efektif pengguna</p>
                  <h2>Penugasan dan override</h2>
                  <p className="mt-1 text-sm text-dd-muted">
                    Penolakan akses lebih kuat daripada pemberian role. Override tetap aktif sampai
                    dicabut.
                  </p>
                </div>
                <UserRoundCog className="size-6 text-dd-forest" />
              </div>
              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <SearchInput
                    id="access-user-search"
                    label="Cari pengguna"
                    description="Cari nama, email, atau nomor telepon."
                    placeholder="Nama pelanggan atau staf"
                    value={userSearch}
                    onChange={(event) => setUserSearch(event.target.value)}
                  />
                </div>
                <Button
                  leadingIcon={<Search className="size-4" aria-hidden="true" />}
                  onClick={() => void searchUsers()}
                >
                  Cari pengguna
                </Button>
              </div>
              {userOptions.length > 0 && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {userOptions.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      className={`rounded-dd-lg border p-3 text-left ${
                        selectedUserId === user.id ? 'border-dd-forest' : 'border-dd-line'
                      }`}
                      onClick={() => void loadUser(user.id)}
                    >
                      <strong className="block text-sm">{user.label}</strong>
                      <span className="block text-xs text-dd-muted">{user.description}</span>
                    </button>
                  ))}
                </div>
              )}

              {!userAccess && (
                <div className="mt-6">
                  <EmptyState
                    title="Pilih pengguna"
                    description="Cari dan pilih pengguna untuk melihat role, cakupan, serta hak akses efektif."
                  />
                </div>
              )}
              {userAccess && (
                <div className="mt-6 grid gap-5 xl:grid-cols-2">
                  <section className="rounded-dd-lg border border-dd-line p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3>{userAccess.user.displayName}</h3>
                        <p className="text-xs text-dd-muted">
                          {userAccess.user.status === 'ACTIVE'
                            ? 'Aktif'
                            : userAccess.user.status === 'INACTIVE'
                              ? 'Nonaktif'
                              : 'Menunggu aktivasi'}{' '}
                          · Versi {userAccess.user.version}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        leadingIcon={<RefreshCw className="size-4" aria-hidden="true" />}
                        type="button"
                        onClick={() => void loadUser(userAccess.user.id)}
                      >
                        Segarkan
                      </Button>
                    </div>
                    <h4 className="mt-5 text-sm">Role langsung</h4>
                    <div className="mt-2 grid gap-2">
                      {assignableRoles.map((role) => {
                        const assignments = roleAssignments.filter(
                          ({ roleId }) => roleId === role.id,
                        );
                        return (
                          <div
                            key={role.id}
                            className="rounded-dd-lg border border-dd-line p-3 text-sm"
                          >
                            <div className="flex items-center gap-3 font-bold">
                              {role.scope === 'GLOBAL' && (
                                <input
                                  type="checkbox"
                                  className="size-4"
                                  aria-label={`${role.displayName} ${role.code}`}
                                  checked={assignments.some(({ branchId }) => branchId === null)}
                                  onChange={(event) =>
                                    toggleAssignment(role, event.target.checked, null)
                                  }
                                />
                              )}
                              {role.displayName}
                              <span className="font-mono text-xs text-dd-muted">{role.code}</span>
                            </div>
                            {role.scope === 'BRANCH' && (
                              <fieldset className="mt-3 grid gap-2">
                                <legend className="text-xs font-bold">Cabang</legend>
                                {branches.map((branch) => (
                                  <label
                                    key={branch.id}
                                    className="flex items-center gap-2 text-xs"
                                  >
                                    <input
                                      type="checkbox"
                                      className="size-4"
                                      aria-label={`${role.displayName} · ${branch.code}`}
                                      checked={assignments.some(
                                        ({ branchId }) => branchId === branch.id,
                                      )}
                                      onChange={(event) =>
                                        toggleAssignment(role, event.target.checked, branch.id)
                                      }
                                    />
                                    {branch.code} — {branch.name}
                                  </label>
                                ))}
                              </fieldset>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {userAccess.roleAssignments.some(({ source }) => source === 'ASSIGNMENT') && (
                      <div className="mt-4 rounded-dd-lg bg-dd-surface-muted p-3 text-sm">
                        <strong>Role dari lifecycle/penugasan</strong>
                        <ul className="mt-2 list-disc pl-5 text-dd-muted">
                          {userAccess.roleAssignments
                            .filter(({ source }) => source === 'ASSIGNMENT')
                            .map((item) => (
                              <li key={item.id}>
                                {item.displayName} · {item.branch?.name ?? 'Global'}
                              </li>
                            ))}
                        </ul>
                      </div>
                    )}
                    <Button
                      className="mt-4"
                      leadingIcon={<ShieldCheck className="size-4" aria-hidden="true" />}
                      disabled={roleAssignments.some(
                        ({ roleId, branchId }) =>
                          roles.find((role) => role.id === roleId)?.scope === 'BRANCH' && !branchId,
                      )}
                      onClick={() => void saveUserRoles()}
                    >
                      Review perubahan role
                    </Button>
                  </section>

                  <section className="rounded-dd-lg border border-dd-line p-4">
                      <h3>Hak akses override</h3>
                      <p className="mt-2 text-sm text-dd-muted">
                        Pengecualian izin per pengguna belum tersedia: izin ditetapkan sistem per
                        peran. Bila seseorang perlu izin berbeda, ganti peran langsungnya.
                      </p>
                    </section>

                  <section className="rounded-dd-lg border border-dd-line p-4 xl:col-span-2">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h3>Hak akses efektif</h3>
                      <ButtonLink
                        variant="secondary"
                        size="sm"
                        href={`/audit?targetUserId=${userAccess.user.id}`}
                        trailingIcon={<ArrowRight className="size-4" aria-hidden="true" />}
                      >
                        Lihat audit pengguna
                      </ButtonLink>
                    </div>
                    <p className="mt-1 text-xs text-dd-muted">
                      Hasil per izin dan cabang. Penolakan selalu mengalahkan role maupun pemberian
                      akses.
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {[
                        ...new Map(
                          userAccess.effective.grants.map((grant) => [
                            `${grant.capability}:${grant.branchId ?? 'GLOBAL'}`,
                            grant,
                          ]),
                        ).values(),
                      ].map((grant) => {
                        const denied = userAccess.effective.denials.some(
                          (item) =>
                            item.capability === grant.capability &&
                            (item.branchId === null || item.branchId === grant.branchId),
                        );
                        const branch =
                          branches.find(({ id }) => id === grant.branchId)?.code ?? 'GLOBAL';
                        return (
                          <article
                            key={`${grant.capability}:${grant.branchId ?? 'GLOBAL'}`}
                            className="rounded-dd-lg border border-dd-line p-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <strong className="font-mono text-xs">{grant.capability}</strong>
                              <StatusBadge tone={denied ? 'danger' : 'success'}>
                                {denied ? 'Ditolak' : 'Diberikan'}
                              </StatusBadge>
                            </div>
                            <p className="mt-2 text-xs text-dd-muted">
                              {branch} ·{' '}
                              {grant.source === 'SYSTEM_ROLE'
                                ? 'System role'
                                : grant.source === 'CUSTOM_ROLE'
                                  ? 'Custom role'
                                  : 'Hak akses override'}
                            </p>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </section>
  );
}

function Metadata({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-dd-lg bg-dd-surface-muted p-4">
      <dt className="text-[13px] font-bold text-dd-muted">{label}</dt>
      <dd className={`mt-2 text-sm font-semibold text-dd-ink ${mono ? 'font-mono' : ''}`}>
        {value}
      </dd>
    </div>
  );
}
