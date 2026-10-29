'use client';

import Link from 'next/link';
import { ArrowLeft, Eye, KeyRound, RefreshCw, ShieldCheck, Trash2, Upload, UserRoundCog } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  browserIdentityClient,
  failureCode,
  type AuditSummary,
  type IdentityClient,
  type RoleCatalogItem,
  type UiFailure,
  type UserSummary,
} from '@/api-clients/identity-client';
import type { IdentityVerificationReviewCase } from '@/api-clients/identity-verification-client';
import {
  browserLedgerClient,
  ledgerFailure,
  type LedgerBalance,
  type LedgerClient,
} from '@/api-clients/ledger-client';
import { Button, ButtonLink } from '../../components/actions';
import { LifecycleDialog } from '../../components/admin/lifecycle-dialog';
import { AdminPageState, Badge, Panel } from '../../components/admin/admin-ui';
import { EmptyState, Feedback, Skeleton, StatusBadge } from '../../ui';
import { AdminPageHeader } from '../../components/admin/admin-page-header';
import { useSessionContext } from '../../session-context';
import { roleSummary, statusLabels } from '../user-admin-controls';
import { PasswordDialog, ProfileDialog, RoleDialog, StatusDialog } from './user-detail-dialogs';
import { auditActionLabel } from '../../lib/audit-labels';

type DetailAction = 'profile' | 'roles' | 'password' | 'status' | null;

const failureCopy: Record<UiFailure, string> = {
  AUTHENTICATION_REQUIRED: 'Sesi berakhir. Silakan masuk kembali.',
  CONFIGURATION_REQUIRED: 'Layanan identitas belum dapat dihubungi.',
  INTERNAL_ERROR: 'Layanan identitas mengalami gangguan internal.',
  RATE_LIMITED: 'Terlalu banyak permintaan. Coba kembali nanti.',
  SERVICE_UNAVAILABLE: 'Layanan identitas tidak dapat dihubungi.',
  FORBIDDEN: 'Anda tidak memiliki izin untuk membuka pengguna ini.',
  IDENTITY_CONFLICT: 'Data pengguna berubah atau tindakan tidak dapat diterapkan.',
  STALE_VERSION: 'Data pengguna telah berubah. Muat ulang detail sebelum mencoba kembali.',
  SESSION_REVOKED: 'Sesi berakhir. Silakan masuk kembali.',
  NOT_IMPLEMENTED: 'Pengiriman tautan setup password belum tersedia. Minta pengguna memakai "Lupa kata sandi" di halaman masuk.',
};

function initialAction(): DetailAction {
  if (typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get('action');
  return ['profile', 'roles', 'password', 'status'].includes(value ?? '')
    ? (value as DetailAction)
    : null;
}

function maskPhone(value: string | null) {
  if (!value) return 'Belum tersedia';
  if (value.length <= 6) return '••••••';
  return `${value.slice(0, 3)}••••${value.slice(-3)}`;
}

export function UserDetailView({
  id,
  client = browserIdentityClient,
  ledgerClient = browserLedgerClient,
  capabilitiesOverride,
}: {
  id: string;
  client?: IdentityClient;
  ledgerClient?: LedgerClient;
  capabilitiesOverride?: readonly string[];
}) {
  const context = useSessionContext();
  const capabilities = capabilitiesOverride ?? context?.session?.capabilities ?? [];
  const sessionReady = Boolean(capabilitiesOverride || context?.session);
  const canAdmin = sessionReady && capabilities.includes('user:admin');
  // Hapus akun hanya untuk Super Owner (server juga menegakkannya).
  const canDelete = Boolean(context?.session?.roles?.includes('SUPER_OWNER'));
  const [removing, setRemoving] = useState(false);
  const [removed, setRemoved] = useState(false);
  const canAudit = sessionReady && capabilities.includes('audit:read');
  const canReadLedger = sessionReady && capabilities.includes('ledger:read');
  const globalCapabilities =
    capabilitiesOverride ??
    context?.session?.globalCapabilities ??
    (capabilities.includes('branch:all') ? capabilities : []);
  const canReadIdentity = sessionReady && globalCapabilities.includes('identity-verification:read');
  const branches = context?.session?.branches ?? [];
  const [user, setUser] = useState<UserSummary>();
  const [catalog, setCatalog] = useState<RoleCatalogItem[]>([]);
  const [audit, setAudit] = useState<AuditSummary[]>([]);
  const [verification, setVerification] = useState<IdentityVerificationReviewCase>();
  const [sessionPackages, setSessionPackages] = useState<LedgerBalance[]>([]);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<UiFailure>();
  const [notFound, setNotFound] = useState(false);
  const [message, setMessage] = useState<string>();
  const [action, setAction] = useState<DetailAction>(initialAction);

  const load = useCallback(async () => {
    setLoading(true);
    setFailure(undefined);
    setNotFound(false);
    try {
      const nextUser = await client.getUser(id);
      if (nextUser.audience === 'CUSTOMER' && canReadLedger) {
        setSessionLoading(true);
        setSessionError('');
        void ledgerClient
          .list(undefined, undefined, undefined, undefined, id)
          .then((result) => setSessionPackages(result.items))
          .catch(async (cause) => setSessionError(await ledgerFailure(cause)))
          .finally(() => setSessionLoading(false));
      } else {
        setSessionPackages([]);
        setSessionError('');
      }
      const [roles, nextAudit, nextVerification] = await Promise.all([
        client.roleCatalog(),
        canAudit ? client.listAudit(id) : Promise.resolve([]),
        nextUser.audience === 'CUSTOMER' && canReadIdentity
          ? client.getUserIdentityVerification(id).catch(() => undefined)
          : Promise.resolve(undefined),
      ]);
      setUser(nextUser);
      setCatalog(roles);
      setAudit(nextAudit);
      setVerification(nextVerification);
    } catch (error) {
      if ((error as { response?: { status?: number } })?.response?.status === 404)
        setNotFound(true);
      else setFailure(failureCode(error));
    } finally {
      setLoading(false);
    }
  }, [canAudit, canReadIdentity, canReadLedger, client, id, ledgerClient]);

  useEffect(() => void load(), [load]);

  const closeAction = () => {
    setAction(null);
    if (typeof window !== 'undefined')
      window.history.replaceState(window.history.state, '', `/users/${id}`);
  };
  const runMutation = async (operation: () => Promise<void>, success: string) => {
    setSubmitting(true);
    setFailure(undefined);
    try {
      await operation();
      setMessage(success);
      closeAction();
      await load();
    } catch (error) {
      setFailure(failureCode(error));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !user) return <Skeleton label="Memuat detail pengguna" />;
  if (notFound)
    return (
      <AdminPageState
        kind="error"
        title="Pengguna tidak ditemukan"
        description="Pengguna tidak tersedia atau berada di luar cakupan cabang Anda."
        action={
          <ButtonLink href="/users">Kembali ke Pengguna</ButtonLink>
        }
      />
    );
  if (failure && !user)
    return (
      <AdminPageState
        kind={failure === 'FORBIDDEN' ? 'forbidden' : 'error'}
        description={failureCopy[failure]}
        action={<Button onClick={() => void load()}>Coba lagi</Button>}
      />
    );
  if (!user) return null;
  if (removed)
    return (
      <EmptyState
        title="Akun telah dihapus"
        description={`Akun ${user.displayName} dihapus permanen. Salinan datanya tersimpan di catatan audit.`}
        action={<ButtonLink href="/users">Kembali ke Pengguna</ButtonLink>}
      />
    );

  const directRoles = user.directRoles;
  const assignmentRoles = user.assignmentRoles;
  const canManageUser = canAdmin;
  return (
    <section className="space-y-6" aria-labelledby="user-detail-title">
      <Link
        href="/users"
        className="inline-flex items-center gap-2 text-sm font-bold text-dd-forest no-underline hover:underline"
      >
        <ArrowLeft className="size-4" /> Kembali ke Pengguna
      </Link>
        <AdminPageHeader
          title={user.displayName}
          titleId="user-detail-title"
          description="Profil, role, penugasan, keamanan akun, dan aktivitas audit dalam satu halaman."
          badges={
            <>
              <StatusBadge
                tone={
                  user.status === 'ACTIVE'
                    ? 'success'
                    : user.status === 'INACTIVE'
                      ? 'neutral'
                      : 'warning'
                }
              >
                {statusLabels[user.status]}
              </StatusBadge>
              <StatusBadge tone={canAdmin ? 'info' : 'neutral'}>
                {canAdmin ? 'Dapat mengelola' : 'Hanya lihat'}
              </StatusBadge>
            </>
          }
          actions={
            <>
          <Button
            variant="secondary"
            leadingIcon={<RefreshCw className="size-4" aria-hidden="true" />}
            onClick={() => void load()}
          >
            Segarkan
          </Button>
          {canManageUser && (
            <Button onClick={() => setAction('profile')}>
              <UserRoundCog className="size-4" /> Edit profil
            </Button>
          )}
          {canManageUser && (
            <Button variant="secondary" onClick={() => setAction('roles')}>
              <ShieldCheck className="size-4" /> Kelola role
            </Button>
          )}
          {canManageUser && user.status === 'ACTIVE' && (
            <Button variant="secondary" onClick={() => setAction('password')}>
              <KeyRound className="size-4" /> Reset kata sandi
            </Button>
          )}
          {canManageUser && user.status !== 'PENDING_ACTIVATION' && (
            <Button
              variant={user.status === 'ACTIVE' ? 'danger' : 'secondary'}
              onClick={() => setAction('status')}
            >
              {user.status === 'ACTIVE' ? 'Nonaktifkan' : 'Aktifkan kembali'}
            </Button>
          )}
          {canDelete && (
            <Button variant="danger" onClick={() => setRemoving(true)}>
              <Trash2 className="size-4" aria-hidden="true" /> Hapus akun
            </Button>
          )}
          {user.audience === 'CUSTOMER' && (
            <ButtonLink
              variant="secondary"
              href={`/customers/${encodeURIComponent(user.id)}`}
              leadingIcon={<Upload className="size-4" aria-hidden="true" />}
            >
              Profil Pelanggan
            </ButtonLink>
          )}
            </>
          }
        />

      {message && <Feedback kind="status">{message}</Feedback>}
      {failure && <Feedback kind="error">{failureCopy[failure]}</Feedback>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.42fr)]">
        <div className="grid gap-6">
          <Panel className="p-5 sm:p-6" aria-labelledby="overview-heading">
            <h2 id="overview-heading" className="text-lg font-bold text-dd-ink">
              Ringkasan
            </h2>
            <dl className="mt-5 grid gap-4 sm:grid-cols-2">
              <DetailItem label="Nama tampilan" value={user.displayName} />
              <DetailItem label="Username (ID Login)" value={user.username ? `@${user.username}` : '-'} />
              <DetailItem label="Kontak" value={maskPhone(user.phoneE164)} />
              <DetailItem label="Status" value={statusLabels[user.status]} />
              <DetailItem label="Revisi data" value={`v${user.version}`} />
              <DetailItem label="Dibuat" value={new Date(user.createdAt).toLocaleString('id-ID')} />
              <DetailItem
                label="Diperbarui"
                value={new Date(user.updatedAt).toLocaleString('id-ID')}
              />
            </dl>
          </Panel>

          <Panel className="p-5 sm:p-6" aria-labelledby="roles-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="roles-heading" className="text-lg font-bold text-dd-ink">
                  Peran &amp; Cabang
                </h2>
                <p className="mt-1 text-sm text-dd-muted">
                  Peran utama dapat diubah langsung; penugasan operasional mengikuti jadwal cabang.
                </p>
              </div>
              <ButtonLink variant="secondary" size="sm" href="/users/roles-permissions">
                Lihat matriks hak akses
              </ButtonLink>
            </div>
            <RoleList title="Role langsung" roles={directRoles} empty="Belum ada role langsung." />
            <RoleList
              title="Role dari penugasan"
              roles={assignmentRoles}
              empty="Tidak ada role berbasis penugasan."
            />
            {assignmentRoles.length > 0 && (
              <Link
                className="mt-4 inline-flex text-sm font-bold text-dd-forest"
                href="/assignments"
              >
                Kelola melalui halaman Penugasan
              </Link>
            )}
          </Panel>

          {user.audience === 'CUSTOMER' && canReadLedger && (
            <Panel className="p-5 sm:p-6" aria-labelledby="customer-sessions-heading">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 id="customer-sessions-heading" className="text-lg font-bold text-dd-ink">
                    Paket &amp; Sesi
                  </h2>
                  <p className="mt-1 text-sm text-dd-muted">
                    Saldo berasal dari ledger dan reservation aktif, bukan perhitungan browser.
                  </p>
                </div>
                <ButtonLink
                  variant="secondary"
                  href={`/ledger?customerUserId=${encodeURIComponent(user.id)}`}
                >
                  Lihat seluruh paket pelanggan
                </ButtonLink>
              </div>
              {sessionLoading ? (
                <div className="mt-5">
                  <Skeleton label="Memuat paket dan sesi pelanggan" />
                </div>
              ) : sessionError ? (
                <div className="mt-5">
                  <Feedback kind="error">{sessionError}</Feedback>
                  <Button className="mt-3" variant="secondary" onClick={() => void load()}>
                    Coba lagi
                  </Button>
                </div>
              ) : sessionPackages.length === 0 ? (
                <p className="mt-5 rounded-dd-md bg-dd-surface-muted p-4 text-sm text-dd-muted">
                  Pelanggan belum memiliki paket yang dapat ditampilkan.
                </p>
              ) : (
                <ul className="mt-5 grid gap-3">
                  {sessionPackages.map((item) => (
                    <li key={item.id} className="rounded-dd-md border border-dd-line p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <strong className="text-dd-ink">
                            {item.packageName ?? 'Paket pelanggan'}
                          </strong>
                          <p className="mt-1 text-xs text-dd-muted">
                            {item.branchName ?? 'Cabang'} · {item.classTypeName ?? 'Tipe kelas'} ·
                            berakhir {new Date(item.expiryAt).toLocaleDateString('id-ID')}
                          </p>
                        </div>
                        <Badge tone={item.status === 'ACTIVE' ? 'success' : 'neutral'}>
                          {item.status === 'ACTIVE'
                            ? 'Aktif'
                            : item.status === 'EXPIRED'
                              ? 'Berakhir'
                              : 'Tidak aktif'}
                        </Badge>
                      </div>
                      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <SessionValue
                          label="Sesi awal"
                          value={item.usage?.initialSessions ?? item.sessionCountSnapshot ?? 0}
                        />
                        <SessionValue label="Terpakai" value={item.usage?.usedSessions ?? 0} />
                        <SessionValue label="Tertahan" value={item.reserved} />
                        <SessionValue label="Tersedia" value={item.available} highlight />
                      </dl>
                      <ButtonLink className="mt-4" variant="ghost" href={`/ledger/${item.id}`}>
                        Lihat detail
                      </ButtonLink>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}

          {user.audience === 'CUSTOMER' && (
            <Panel className="p-5 sm:p-6" aria-labelledby="identity-verification-heading">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 id="identity-verification-heading" className="text-lg font-bold text-dd-ink">
                    Verifikasi Identitas
                  </h2>
                  <p className="mt-1 text-sm text-dd-muted">
                    Status foto selfie pengguna (tanpa KTP). Akses review penuh dan pratinjau berkas tersedia melalui antrean verifikasi.
                  </p>
                </div>
                {verification && (
                  <StatusBadge
                    tone={
                      verification.verificationStatus === 'APPROVED'
                        ? 'success'
                        : verification.verificationStatus === 'ACTION_REQUIRED'
                          ? 'warning'
                          : 'neutral'
                    }
                  >
                    {verification.verificationStatus === 'APPROVED'
                      ? 'Terverifikasi'
                      : verification.verificationStatus === 'ACTION_REQUIRED'
                        ? 'Perlu perbaikan'
                        : 'Menunggu pemeriksaan'}
                  </StatusBadge>
                )}
              </div>
              {!canReadIdentity ? (
                <div className="mt-4 space-y-3">
                  <p className="text-sm text-dd-muted">
                    Hak akses global verifikasi identitas diperlukan untuk memeriksa riwayat review. Anda dapat mengunggah dan mengelola dokumen langsung melalui profil pelanggan.
                  </p>
                  <ButtonLink
                    href={`/customers/${encodeURIComponent(user.id)}`}
                    leadingIcon={<Upload className="size-4" aria-hidden="true" />}
                  >
                    Kelola Dokumen di Profil Pelanggan
                  </ButtonLink>
                </div>
              ) : !verification ? (
                <div className="mt-4 space-y-3">
                  <p className="text-sm text-dd-muted">
                    Dokumen verifikasi belum tersedia atau fitur review belum diaktifkan. Foto selfie dapat diunggah di profil pelanggan.
                  </p>
                  <ButtonLink
                    href={`/customers/${encodeURIComponent(user.id)}`}
                    leadingIcon={<Upload className="size-4" aria-hidden="true" />}
                  >
                    Unggah Dokumen Pelanggan
                  </ButtonLink>
                </div>
              ) : (
                <>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    {(['SELFIE', 'KTP_FRONT'] as const).map((kind) => {
                      const document = verification.documents.find((item) => item.kind === kind);
                      return (
                        <div key={kind} className="rounded-dd-md border border-dd-line p-4">
                          <strong>{kind === 'SELFIE' ? 'Selfie' : 'KTP depan'}</strong>
                          <p className="mt-2 text-sm text-dd-muted">
                            {document
                              ? `${document.status} · ${document.uploadStatus} · ${document.scanStatus}`
                              : 'Belum tersedia'}
                          </p>
                          {document?.rejectionReasonCode && (
                            <p className="mt-1 text-xs text-dd-warning">
                              Alasan: {document.rejectionReasonCode}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <ButtonLink
                      href={`/identity-verifications?customerUserId=${encodeURIComponent(user.id)}`}
                      leadingIcon={<Eye className="size-4" aria-hidden="true" />}
                    >
                      Periksa dokumen
                    </ButtonLink>
                    <ButtonLink
                      variant="ghost"
                      href={`/customers/${encodeURIComponent(user.id)}`}
                      leadingIcon={<Upload className="size-4" aria-hidden="true" />}
                    >
                      Kelola Dokumen Pelanggan
                    </ButtonLink>
                  </div>
                </>
              )}
            </Panel>
          )}

          <Panel className="p-5 sm:p-6" aria-labelledby="security-heading">
            <h2 id="security-heading" className="text-lg font-bold text-dd-ink">
              Keamanan akun
            </h2>
            <p className="mt-2 text-sm leading-6 text-dd-muted">
              Perubahan role dan deaktivasi mencabut sesi aktif. Reset kata sandi langsung
              mengganti kata sandi pengguna; sampaikan kata sandi baru kepada pengguna secara aman.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge tone={user.status === 'ACTIVE' ? 'success' : 'neutral'}>
                {user.status === 'ACTIVE' ? 'Login diizinkan' : 'Login tidak aktif'}
              </Badge>
              <Badge tone="info">Revisi data v{user.version}</Badge>
            </div>
          </Panel>
        </div>

        <Panel className="self-start p-5 sm:p-6" aria-labelledby="audit-heading">
          <h2 id="audit-heading" className="text-lg font-bold text-dd-ink">
            Aktivitas Audit
          </h2>
          {!canAudit ? (
            <p className="mt-3 text-sm text-dd-muted">
              Izin audit diperlukan untuk melihat aktivitas.
            </p>
          ) : audit.length === 0 ? (
            <p className="mt-3 text-sm text-dd-muted">
              Belum ada aktivitas yang dapat ditampilkan.
            </p>
          ) : (
            <ol className="mt-5 grid gap-4">
              {audit.map((item) => (
                <li key={item.id} className="border-l-2 border-dd-brass pl-4">
                  <strong className="block text-sm text-dd-ink">{auditActionLabel(item.action)}</strong>
                  <span className="mt-1 block text-xs text-dd-muted">
                    {new Date(item.occurredAt).toLocaleString('id-ID')}
                  </span>
                  <small className="mt-1 block break-all text-xs text-dd-muted">
                    Referensi: {item.correlationId}
                  </small>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>

      <ProfileDialog
        open={action === 'profile' && canManageUser}
        user={user}
        submitting={submitting}
        onClose={closeAction}
        onSubmit={(input) =>
          runMutation(async () => {
            await client.updateProfile(user.id, { ...input, expectedVersion: user.version });
          }, 'Profil pengguna berhasil diperbarui.')
        }
      />
      <RoleDialog
        open={action === 'roles' && canManageUser}
        user={user}
        catalog={catalog.filter((item) => item.assignable)}
        branches={branches}
        submitting={submitting}
        onClose={closeAction}
        onSubmit={(roles, reason) =>
          runMutation(async () => {
            await client.updateRoles(user.id, roles, user.version, reason);
          }, 'Role dan cakupan berhasil diperbarui. Seluruh sesi pengguna telah dicabut.')
        }
      />
      <PasswordDialog
        open={action === 'password' && canManageUser}
        submitting={submitting}
        onClose={closeAction}
        onSubmit={(newPassword) =>
          runMutation(
            () => client.resetPasswordDirect(user.id, newPassword),
            'Kata sandi pengguna berhasil diperbarui.',
          )
        }
      />
      <StatusDialog
        open={action === 'status' && canManageUser}
        user={user}
        submitting={submitting}
        onClose={closeAction}
        onSubmit={(reason) =>
          runMutation(
            () =>
              user.status === 'ACTIVE'
                ? client.deactivate(user.id, user.version, reason)
                : client.reactivate(user.id, user.version),
            user.status === 'ACTIVE'
              ? 'Pengguna dinonaktifkan dan seluruh sesi dicabut.'
              : 'Pengguna berhasil diaktifkan kembali.',
          )
        }
      />
      <LifecycleDialog
        request={removing ? { kind: 'user', id: user.id, name: user.displayName, action: 'delete' } : null}
        onClose={() => setRemoving(false)}
        onDone={() => {
          setRemoving(false);
          setRemoved(true);
        }}
      />
    </section>
  );
}

function SessionValue({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-dd-sm bg-dd-surface-muted p-3">
      <dt className="text-xs text-dd-muted">{label}</dt>
      <dd className={`mt-1 text-lg font-bold ${highlight ? 'text-dd-success' : 'text-dd-ink'}`}>
        {value}
      </dd>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-dd-md bg-dd-surface-muted p-4">
      <dt className="text-[13px] font-bold text-dd-muted">{label}</dt>
      <dd className="mt-2 break-words text-sm font-semibold text-dd-ink">{value}</dd>
    </div>
  );
}

function RoleList({
  title,
  roles,
  empty,
}: {
  title: string;
  roles: UserSummary['roles'];
  empty: string;
}) {
  return (
    <section className="mt-5">
      <h3 className="text-sm font-bold text-dd-ink">{title}</h3>
      {roles.length === 0 ? (
        <p className="mt-2 text-sm text-dd-muted">{empty}</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {roleSummary(roles).map((label) => (
            <Badge key={label} tone="info">
              {label}
            </Badge>
          ))}
        </div>
      )}
    </section>
  );
}
