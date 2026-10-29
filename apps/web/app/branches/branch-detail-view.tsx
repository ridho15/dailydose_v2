'use client';

import {
  ArrowLeft,
  Camera,
  ExternalLink,
  MapPin,
  Pencil,
  Plus,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTrackedRouter } from '../components/app-loading';
import { Button, ButtonLink } from '../components/actions';
import { Drawer, useAppFeedback } from '../components/app-feedback';
import { Badge, Panel, StatCard, TableActionMenu } from '../components/admin/admin-ui';
import { TextInput } from '../components/forms';
import { LocationMapPicker } from '../components/forms/location-map-picker';
import { useSessionContext } from '../session-context';
import { browserBranchClient, type BranchManagementDetail } from '@/api-clients/branch-client';
import { Skeleton } from '../ui';
import { AdminPageHeader } from '../components/admin/admin-page-header';
import { resolvePublicImageUrl } from '../lib/public-image-url';
import { PaymentAccountsView } from '../master/payment-accounts-view';
import { StudioVenueList } from '../master/studio-venue-list';
import { BranchPublicProfileDrawer } from './branch-public-profile-drawer';
import { useBranchLifecycle } from './use-branch-lifecycle';

const auditLabels: Record<string, string> = {
  'master.branch_created': 'Cabang dibuat',
  'master.branch_updated': 'Informasi cabang diperbarui',
  'master.branch_deactivated': 'Cabang dinonaktifkan',
  'master.branch_reactivated': 'Cabang diaktifkan kembali',
  'master.branch_activated': 'Cabang diaktifkan kembali',
  'lifecycle.branch_archived': 'Cabang diarsipkan',
  'lifecycle.branch_deleted': 'Cabang dihapus',
  'master.public_branch_profile_updated': 'Profil publik diperbarui',
};

export function BranchDetailView({ id }: { id: string }) {
  const session = useSessionContext();
  const router = useTrackedRouter();
  const feedback = useAppFeedback();
  const [branch, setBranch] = useState<BranchManagementDetail | null>(null);
  const [failure, setFailure] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [publicProfileOpen, setPublicProfileOpen] = useState(false);
  const [editDirty, setEditDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const canRead =
    session?.status === 'authenticated' && session.hasCapability('master:read', 'master:manage');
  const canManage = session?.status === 'authenticated' && session.hasCapability('master:manage');
  const confirmDiscardEdit = () =>
    feedback.confirm({
      tone: 'warning',
      title: 'Batalkan perubahan cabang?',
      message: 'Perubahan yang belum disimpan akan hilang.',
      confirmLabel: 'Buang perubahan',
    });
  const closeEdit = async () => {
    if (!editDirty || (await confirmDiscardEdit())) {
      setEditDirty(false);
      setEditorOpen(false);
    }
  };
  const load = () =>
    browserBranchClient
      .detail(id)
      .then(setBranch)
      .catch(() => setFailure('Detail cabang tidak dapat dimuat atau berada di luar cakupan Anda.'));

  const lifecycle = useBranchLifecycle((action) => {
    if (action === 'delete') router.push('/workspace/branches');
    else return load();
  });

  useEffect(() => {
    if (canRead) void load();
  }, [canRead, id]);
  if (!session || session.status === 'loading') return <Skeleton label="Memuat detail cabang" />;
  if (!canRead)
    return (
      <div className="rounded-dd-lg border border-dd-danger/30 bg-dd-danger-soft p-4 text-dd-danger">
        <strong className="block font-semibold">Akses cabang tidak tersedia</strong>
        <p className="text-sm">Akun Anda tidak memiliki izin untuk membaca Branch Management.</p>
      </div>
    );
  if (failure) return <div className="rounded-dd-lg border border-dd-danger/30 bg-dd-danger-soft p-4 text-dd-danger">{failure}</div>;
  if (!branch) return <Skeleton label="Memuat detail cabang" />;

  const heroImageKey = branch.heroImageKey || branch.publicProfile?.heroImageKey;
  const heroImageUrl = heroImageKey ? resolvePublicImageUrl(heroImageKey) : null;

  return (
    <section className="grid gap-5" aria-labelledby="branch-title">
      <ButtonLink
        href="/workspace/branches"
        variant="ghost"
        size="sm"
        leadingIcon={<ArrowLeft className="size-4" aria-hidden="true" />}
        className="w-fit"
      >
        Kembali ke cabang
      </ButtonLink>

      {/* Hero Visual Banner */}
      {heroImageUrl && (
        <div className="relative h-56 sm:h-72 w-full overflow-hidden rounded-dd-xl border border-dd-line/80 bg-dd-surface-muted group">
          <img
            src={heroImageUrl}
            alt={`Foto Cabang ${branch.name}`}
            className="size-full object-cover object-center transition-transform duration-700 group-hover:scale-105"
            onError={(e) => {
              const parent = (e.currentTarget as HTMLElement).parentElement;
              if (parent) parent.style.display = 'none';
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-black/10" />
          <div className="absolute bottom-5 left-5 right-5 flex flex-wrap items-end justify-between gap-4 text-white">
            <div className="max-w-2xl">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold backdrop-blur-md">
                <MapPin className="size-3.5" />
                {branch.publicProfile ? `${branch.publicProfile.area}, ${branch.publicProfile.city}` : branch.code}
              </span>
              <h1 id="branch-title" className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight text-white drop-shadow-sm">
                {branch.name}
              </h1>
              <p className="mt-1 text-xs sm:text-sm text-white/80 line-clamp-2">
                {branch.address || branch.publicProfile?.address || `${branch.code} · ${branch.timezone}`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={branch.active ? 'success' : 'neutral'}>
                {branch.archivedAt ? 'Diarsipkan' : branch.active ? 'Cabang Aktif' : 'Tidak aktif'}
              </Badge>
              {canManage && (
                <>
                  {/* Foto ini sama dengan foto cabang di halaman Lokasi publik. */}
                  <Button
                    variant="secondary"
                    size="sm"
                    leadingIcon={<Camera className="size-4" aria-hidden="true" />}
                    className="bg-white/90 text-dd-ink hover:bg-white backdrop-blur-md"
                    onClick={() => setPublicProfileOpen(true)}
                  >
                    Ganti foto
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    leadingIcon={<Pencil className="size-4" aria-hidden="true" />}
                    className="bg-white/90 text-dd-ink hover:bg-white backdrop-blur-md"
                    onClick={() => setEditorOpen(true)}
                  >
                    Edit cabang
                  </Button>
                  <TableActionMenu
                    ariaLabel={`Status cabang ${branch.name}`}
                    label="Status & penghapusan"
                    items={lifecycle.items(branch)}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {!heroImageUrl && (
        <AdminPageHeader
          title={branch.name}
          titleId="branch-title"
          description={`${branch.code} · ${branch.timezone}`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={branch.active ? 'success' : 'neutral'}>
                {branch.archivedAt ? 'Diarsipkan' : branch.active ? 'Aktif' : 'Tidak aktif'}
              </Badge>
              {canManage && (
                <>
                  <Button
                    variant="secondary"
                    leadingIcon={<Camera className="size-4" aria-hidden="true" />}
                    onClick={() => setPublicProfileOpen(true)}
                  >
                    Tambah foto
                  </Button>
                  <Button
                    variant="secondary"
                    leadingIcon={<Pencil className="size-4" aria-hidden="true" />}
                    onClick={() => setEditorOpen(true)}
                  >
                    Edit cabang
                  </Button>
                  <TableActionMenu
                    ariaLabel={`Status cabang ${branch.name}`}
                    label="Status & penghapusan"
                    items={lifecycle.items(branch)}
                  />
                </>
              )}
            </div>
          }
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Staf aktif" value={String(branch.dependencies.staff)} />
        <StatCard label="Kelas mendatang" value={String(branch.dependencies.futureClasses)} />
        <StatCard label="Paket aktif" value={String(branch.dependencies.packages)} />
        <StatCard label="Rekening aktif" value={String(branch.dependencies.paymentAccounts)} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel className="p-5">
          <h2 className="text-lg font-semibold text-dd-ink">Identitas &amp; Alamat Cabang</h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <Info label="Kode cabang" value={branch.code} />
            <Info label="Zona waktu" value={branch.timezone} />
            <Info label="WhatsApp support" value={branch.supportWhatsappE164 ?? 'Belum diatur'} />
            <Info label="Status operasional" value={branch.active ? 'Aktif Beroperasi' : 'Nonaktif'} />
            <div className="sm:col-span-2 border-t border-dd-line/60 pt-3">
              <dt className="text-xs font-semibold text-dd-muted">Alamat Fisik Cabang</dt>
              <dd className="mt-1 text-sm leading-relaxed text-dd-ink font-medium">
                {branch.address || branch.publicProfile?.address || 'Alamat fisik belum dicatat.'}
              </dd>
            </div>
            <div className="sm:col-span-2 border-t border-dd-line/60 pt-3">
              <div className="flex items-center justify-between">
                <dt className="text-xs font-semibold text-dd-muted">Area Geofence Presensi</dt>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => setEditorOpen(true)}
                    className="text-xs font-medium text-dd-forest hover:underline"
                  >
                    Ubah Titik &amp; Radius
                  </button>
                )}
              </div>
              <dd className="mt-1.5 flex flex-wrap items-center gap-2">
                {branch.latitude !== null &&
                branch.latitude !== undefined &&
                branch.longitude !== null &&
                branch.longitude !== undefined ? (
                  <>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-600/20">
                      <ShieldCheck className="size-3.5" />
                      Aktif ({branch.geofenceRadiusMeters ?? 100}m)
                    </span>
                    <span className="font-mono text-xs text-dd-muted">
                      {Number(branch.latitude).toFixed(6)}, {Number(branch.longitude).toFixed(6)}
                    </span>
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-amber-600/20">
                    <ShieldAlert className="size-3.5" />
                    Bypass GPS (Belum dikonfigurasi)
                  </span>
                )}
              </dd>
            </div>
          </dl>
        </Panel>

        <Panel className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-dd-ink">Profil Publik Website</h2>
            {canManage && (
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<Pencil className="size-3.5" aria-hidden="true" />}
                onClick={() => setPublicProfileOpen(true)}
              >
                Ubah profil
              </Button>
            )}
          </div>
          {branch.publicProfile ? (
            <div className="mt-4 grid gap-3">
              <p className="text-sm">
                <strong className="text-dd-ink">
                  {branch.publicProfile.area}, {branch.publicProfile.city}
                </strong>
              </p>
              <p className="text-sm leading-6 text-dd-muted">{branch.publicProfile.address}</p>
              
              {branch.publicProfile.openingHours?.length ? (
                <div className="text-xs text-dd-muted">
                  <span className="font-semibold text-dd-ink">Jam Buka: </span>
                  {branch.publicProfile.openingHours.join(' · ')}
                </div>
              ) : null}

              {branch.publicProfile.amenities?.length ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {branch.publicProfile.amenities.map((a) => (
                    <span key={a} className="rounded bg-dd-forest/10 px-2 py-0.5 text-[13px] font-medium text-dd-forest">
                      {a}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="grid gap-1.5 border-t border-dd-line/60 pt-2 text-xs text-dd-muted">
                {branch.publicProfile.operationalEmail && (
                  <p>
                    <span className="font-semibold text-dd-ink">Email: </span>
                    <a
                      href={`mailto:${branch.publicProfile.operationalEmail}`}
                      className="text-dd-forest hover:underline"
                    >
                      {branch.publicProfile.operationalEmail}
                    </a>
                  </p>
                )}
                {branch.publicProfile.mapUrl && (
                  <p>
                    <span className="font-semibold text-dd-ink">Peta: </span>
                    <a
                      href={branch.publicProfile.mapUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-dd-forest hover:underline"
                    >
                      Buka di Google Maps
                      <ExternalLink className="size-3" aria-hidden="true" />
                    </a>
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-4">
              <p className="text-sm text-dd-muted">Profil publik cabang belum dilengkapi.</p>
              {canManage && (
                <Button
                  variant="secondary"
                  size="sm"
                  leadingIcon={<Plus className="size-4" aria-hidden="true" />}
                  className="mt-3 w-fit"
                  onClick={() => setPublicProfileOpen(true)}
                >
                  Lengkapi profil publik
                </Button>
              )}
            </div>
          )}
        </Panel>
      </div>

      <PaymentAccountsView
        branchId={branch.id}
        canManage={Boolean(canManage)}
        onAccountsChange={(count) =>
          setBranch((current) =>
            current
              ? {
                  ...current,
                  dependencies: { ...current.dependencies, paymentAccounts: count },
                }
              : null,
          )
        }
      />

      <Panel className="p-5">
        <StudioVenueList
          branchId={branch.id}
          canManage={Boolean(canManage)}
          allowCreate
        />
      </Panel>
      <Panel className="p-5">
        <h2 className="text-lg font-semibold">Dependency operasional</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Info label="Penugasan aktif" value={String(branch.dependencies.assignments)} />
          <Info label="Tipe kelas aktif" value={String(branch.dependencies.classTypes)} />
          <Info label="Kelas mendatang" value={String(branch.dependencies.futureClasses)} />
          <Info label="Paket aktif" value={String(branch.dependencies.packages)} />
          <Info label="Rekening aktif" value={String(branch.dependencies.paymentAccounts)} />
          <Info label="Staf terhubung" value={String(branch.dependencies.staff)} />
        </dl>
      </Panel>
      <Panel className="overflow-hidden p-0">
        <div className="border-b border-dd-line px-5 py-4">
          <h2 className="text-lg font-semibold">Aktivitas audit</h2>
        </div>
        {branch.auditActivity.length ? (
          <ul className="divide-y divide-dd-line">
            {branch.auditActivity.map((item) => (
              <li key={item.id} className="flex flex-wrap justify-between gap-2 px-5 py-3 text-sm">
                <span>{auditLabels[item.action] ?? 'Konfigurasi cabang diperbarui'}</span>
                <time className="text-dd-muted">
                  {new Date(item.occurredAt).toLocaleString('id-ID')}
                </time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-5 text-sm text-dd-muted">Belum ada aktivitas cabang.</p>
        )}
      </Panel>
      <Drawer
        open={editorOpen}
        title="Edit cabang"
        description="Kode cabang bersifat tetap agar seluruh histori dan relasi tetap konsisten."
        busy={busy}
        dirty={editDirty}
        onDirtyClose={confirmDiscardEdit}
        onClose={() => {
          setEditDirty(false);
          setEditorOpen(false);
        }}
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="secondary" disabled={busy} onClick={() => void closeEdit()}>
              Batal
            </Button>
            <Button type="submit" form="branch-edit-form" loading={busy}>
              Simpan perubahan
            </Button>
          </div>
        }
      >
        <form
          id="branch-edit-form"
          className="grid gap-4"
          onChange={() => setEditDirty(true)}
          onSubmit={async (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const latRaw = data.get('latitude');
            const lngRaw = data.get('longitude');
            const radRaw = data.get('geofenceRadiusMeters');

            const input = {
              name: String(data.get('name')).trim(),
              timezone: String(data.get('timezone')).trim(),
              supportWhatsappE164: String(data.get('supportWhatsappE164')).trim() || null,
              latitude: latRaw !== null && latRaw !== '' ? Number(latRaw) : null,
              longitude: lngRaw !== null && lngRaw !== '' ? Number(lngRaw) : null,
              geofenceRadiusMeters: radRaw !== null && radRaw !== '' ? Number(radRaw) : 100,
              expectedVersion: branch.version,
            };
            setBusy(true);
            try {
              await browserBranchClient.update(branch.id, input);
              setEditDirty(false);
              setEditorOpen(false);
              await load();
              feedback.showToast({
                tone: 'success',
                title: 'Cabang diperbarui',
                message: 'Informasi cabang dan area geofence berhasil disimpan.',
              });
            } catch {
              feedback.showAlert({
                tone: 'danger',
                title: 'Perubahan belum disimpan',
                message: 'Periksa koordinat geofence, timezone, nomor WhatsApp, atau muat ulang versi terbaru.',
              });
            } finally {
              setBusy(false);
            }
          }}
        >
          <TextInput label="Kode cabang" value={branch.code} disabled />
          <TextInput name="name" label="Nama cabang" defaultValue={branch.name} required />
          <TextInput name="timezone" label="Zona waktu" defaultValue={branch.timezone} required />
          <TextInput
            name="supportWhatsappE164"
            label="WhatsApp support"
            defaultValue={branch.supportWhatsappE164 ?? ''}
            description="Gunakan format E.164."
          />
          <LocationMapPicker
            key={`${branch.id}-${editorOpen}`}
            initialLatitude={branch.latitude}
            initialLongitude={branch.longitude}
            initialRadius={branch.geofenceRadiusMeters ?? 100}
            branchName={branch.name}
            onChange={() => setEditDirty(true)}
          />
        </form>
      </Drawer>

      <BranchPublicProfileDrawer
        branchId={branch.id}
        branchName={branch.name}
        open={publicProfileOpen}
        onClose={() => setPublicProfileOpen(false)}
        onSaved={() => void load()}
      />
      {lifecycle.dialog}
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-dd-muted">{label}</dt>
      <dd className="mt-1 font-semibold text-dd-ink">{value}</dd>
    </div>
  );
}
