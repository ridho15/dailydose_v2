'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  Calendar,
  CreditCard,
  FileText,
  Loader2,
  MapPin,
  Package,
  Phone,
  ShieldCheck,
  User,
  X,
  ZoomIn,
  AlertCircle,
  Clock,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  RefreshCw,
  Upload,
  Edit3,
  LogIn,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ActionGroup, Button, ButtonLink } from '../../components/actions';
import { setSessionHint } from '../../api-clients/session-client';
import { Drawer, Modal, PreviewModal } from '../../components/app-feedback';
import { SearchSelect, TextInput } from '../../components/forms';
import { useSessionContext } from '../../session-context';
import { Feedback, Skeleton, StatusBadge } from '../../ui';
import { AdminPageHeader } from '../../components/admin/admin-page-header';
import { KirimQrWhatsApp } from '../../components/kirim-qr-whatsapp';
import { AssistedSaleDrawer } from '../../purchases/assisted-sale-drawer';
import { DataTable } from '../../components/admin/admin-ui';
import { statusLabel } from '../../lib/status-labels';
import { customerStatusLabels, verificationStatusLabels } from '../customers-view';
import { customerClient, type CustomerDetail, type CustomerDetailDocument } from '../customer-client';
import { verificationClient } from '../../api-clients/identity-verification-client';

function CustomerDocumentCard({
  title,
  kind,
  doc,
  onZoom,
  onUpload,
  onError,
  uploading,
  canWrite,
  refreshKey,
}: {
  title: string;
  kind: 'KTP_FRONT' | 'SELFIE';
  doc?: CustomerDetailDocument;
  onZoom: (title: string, blobUrl: string) => void;
  onUpload?: (kind: 'KTP_FRONT' | 'SELFIE', base64: string, fileName: string) => Promise<void>;
  onError?: (msg: string) => void;
  uploading?: boolean;
  canWrite?: boolean;
  refreshKey?: number;
}) {
  const [blobUrl, setBlobUrl] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [cardSuccess, setCardSuccess] = useState<string>('');

  useEffect(() => {
    if (!cardSuccess) return;
    const timer = setTimeout(() => setCardSuccess(''), 4000);
    return () => clearTimeout(timer);
  }, [cardSuccess]);

  useEffect(() => {
    if (!doc?.id) {
      setBlobUrl('');
      return;
    }
    let active = true;
    let createdUrl = '';
    setLoading(true);
    setError(false);
    verificationClient
      .authorizeView(doc.id)
      .then(({ url }) => verificationClient.readPrivateFile(url))
      .then((blob) => {
        if (!active) return;
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [doc?.id, doc?.uploadedAt, refreshKey]);

  return (
    <div className="flex flex-col overflow-hidden rounded-dd-lg border border-dd-line bg-white transition hover:">
      <div className="flex items-center justify-between border-b border-dd-line/80 px-4 py-3 bg-dd-surface-muted/30">
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-dd-forest" />
          <strong className="text-sm font-semibold text-dd-ink">{title}</strong>
        </div>
        <div>
          {cardSuccess ? (
            <StatusBadge tone="success">✓ Berhasil Diperbarui</StatusBadge>
          ) : doc || blobUrl ? (
            <StatusBadge tone="success">Tersedia</StatusBadge>
          ) : (
            <StatusBadge tone="neutral">Belum Diunggah</StatusBadge>
          )}
        </div>
      </div>
      <div className="relative flex aspect-[16/10] w-full items-center justify-center bg-dd-surface-muted/40 p-2">
        {uploading && blobUrl && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/40 backdrop-blur-xs text-white rounded-dd-md">
            <Loader2 className="size-6 animate-spin text-white" />
            <span className="mt-1 text-xs font-semibold">Mengunggah &amp; memproses…</span>
          </div>
        )}
        {loading && !blobUrl ? (
          <div className="flex flex-col items-center gap-2 text-xs text-dd-muted animate-pulse">
            <Loader2 className="size-6 animate-spin text-dd-forest" />
            <span>Memuat pratinjau aman…</span>
          </div>
        ) : blobUrl ? (
          <div className="group relative h-full w-full overflow-hidden rounded-dd-md">
            <img
              src={blobUrl}
              alt={title}
              className="h-full w-full object-contain transition group-hover:scale-102"
            />
            <button
              type="button"
              onClick={() => onZoom(title, blobUrl)}
              className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 backdrop-blur-xs transition group-hover:opacity-100 text-white font-medium text-xs gap-1.5 cursor-pointer"
            >
              <ZoomIn className="size-4" /> Perbesar Dokumen
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5 p-4 text-center text-xs text-dd-muted">
            <AlertCircle className="size-6 text-dd-muted" />
            <span>{error ? 'Tidak dapat memuat berkas' : 'Dokumen belum tersedia pada akun ini'}</span>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between p-3 text-xs text-dd-muted border-t border-dd-line/60 bg-white">
        <span>Format: {kind === 'KTP_FRONT' ? 'KTP Depan' : 'Foto Selfie'}</span>
        <div className="flex items-center gap-3">
          {cardSuccess && (
            <span className="text-xs font-semibold text-dd-forest inline-flex items-center gap-1">
              <CheckCircle2 className="size-3.5" /> Berhasil diunggah!
            </span>
          )}
          {blobUrl && (
            <button
              type="button"
              onClick={() => onZoom(title, blobUrl)}
              className="font-semibold text-dd-forest hover:underline inline-flex items-center gap-1 cursor-pointer"
            >
              <ZoomIn className="size-3.5" /> Lihat Detail
            </button>
          )}
          {canWrite && (
            <label className="font-semibold text-dd-forest hover:underline inline-flex items-center gap-1 cursor-pointer">
              <Upload className="size-3.5" />
              <span>{doc || blobUrl ? 'Ganti Foto' : 'Unggah Foto'}</span>
              <input
                id={kind === 'KTP_FRONT' ? 'upload-ktp-front' : 'upload-selfie'}
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploading}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file || !onUpload) return;
                  if (file.size > 8 * 1024 * 1024) {
                    onError?.('Ukuran berkas maksimal 8 MB. Silakan pilih foto dengan resolusi lebih rendah.');
                    e.target.value = '';
                    return;
                  }

                  // Tampilkan pratinjau lokal seketika
                  const localPreview = URL.createObjectURL(file);
                  const prevUrl = blobUrl;
                  setBlobUrl(localPreview);
                  setError(false);
                  setCardSuccess('');

                  const reader = new FileReader();
                  reader.onload = async () => {
                    try {
                      const base64 = reader.result as string;
                      await onUpload(kind, base64, file.name);
                      setCardSuccess('Foto berhasil diunggah!');
                    } catch {
                      setBlobUrl(prevUrl);
                      onError?.(`Gagal mengunggah dokumen ${title}. Silakan coba kembali.`);
                    }
                  };
                  reader.readAsDataURL(file);
                  e.target.value = '';
                }}
              />
            </label>
          )}
        </div>
      </div>
    </div>
  );
}

export function CustomerDetailView({ id }: { id: string }) {
  const sessionContext = useSessionContext();
  const session = sessionContext?.session;
  // Ubah profil, nonaktifkan, dan unggah dokumen dicek dengan `customer:write` atau `customer:manage`.
  const canWriteRole = Boolean(
    sessionContext?.hasCapability('customer:write') ||
    sessionContext?.hasCapability('customer:manage'),
  );
  const canImpersonate = Boolean(
    session?.roles?.includes('SUPER_OWNER') ||
    sessionContext?.hasCapability?.('customer:impersonate') ||
    session?.capabilities?.includes('customer:impersonate') ||
    session?.globalCapabilities?.includes('customer:impersonate'),
  );
  const canSell = Boolean(sessionContext?.hasCapability('purchase:record'));
  const saleBranch = sessionContext?.activeBranch ?? null;
  const saleBranches = (session?.branches ?? []).map((item) => ({ id: item.id, name: item.name }));
  const [saleOpen, setSaleOpen] = useState(false);
  const [customer, setCustomer] = useState<CustomerDetail>();
  // Pelanggan di luar cabang staf hanya bisa dilihat (kontak disamarkan); server menolak perubahan terhadapnya.
  const canWrite = canWriteRole && !customer?.contactMasked;
  // Sama dengan izin server: Admin/Manager (inisialisasi kredensial member) atau Super Owner.
  const canResetSandi = Boolean(
    sessionContext?.hasCapability('customer:credential:initialize', 'user:admin'),
  );
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [impersonateModalOpen, setImpersonateModalOpen] = useState(false);
  const [impersonateBusy, setImpersonateBusy] = useState(false);
  const [impersonateError, setImpersonateError] = useState('');
  const [zoomImage, setZoomImage] = useState<{ title: string; src: string } | null>(null);
  const [activeTab, setActiveTab] = useState<'orders' | 'packages' | 'bookings'>('packages');

  // Reset Password State
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);

  // Document Upload State
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);
  const [docRefreshKey, setDocRefreshKey] = useState(0);

  // Edit Profile Drawer & Status Modal State
  const [editDrawerOpen, setEditDrawerOpen] = useState(false);
  const [statusModalOpen, setStatusModalOpen] = useState(false);

  const generateRandomPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
    let res = 'Dose';
    for (let i = 0; i < 8; i++) {
      res += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    res += '!';
    setNewPassword(res);
    setShowPassword(true);
  };

  const handleResetPassword = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!newPassword.trim() || newPassword.length < 8) {
      setError('Kata sandi minimal 8 karakter.');
      return;
    }
    setPasswordBusy(true);
    setError('');
    setSuccess('');
    try {
      await customerClient.resetPassword(id, newPassword.trim());
      setSuccess(`Kata sandi akun ${customer?.displayName ?? 'pelanggan'} berhasil diperbarui.`);
      setPasswordModalOpen(false);
      setNewPassword('');
      setShowPassword(false);
    } catch (cause) {
      setError(customerClient.pesanResetSandi(cause));
    } finally {
      setPasswordBusy(false);
    }
  };

  const handleUploadDocument = async (
    kind: 'KTP_FRONT' | 'SELFIE',
    base64: string,
    fileName: string,
  ) => {
    setUploadingDoc(kind);
    setError('');
    setSuccess('');
    try {
      await customerClient.uploadDocument(id, kind, { base64, fileName });
      setSuccess(`Dokumen ${kind === 'KTP_FRONT' ? 'KTP' : 'Foto Selfie'} berhasil diunggah.`);
      setDocRefreshKey((k) => k + 1);
      await load();
    } catch (err) {
      setError(`Gagal mengunggah dokumen ${kind === 'KTP_FRONT' ? 'KTP' : 'Foto Selfie'}.`);
      throw err;
    } finally {
      setUploadingDoc(null);
    }
  };

  const load = useCallback(async () => {
    try {
      setCustomer(await customerClient.detail(id));
      setError('');
    } catch {
      setError('Profil pelanggan tidak tersedia atau berada di luar hak akses Anda.');
    }
  }, [id]);

  useEffect(() => void load(), [load]);

  async function updateProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customer) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await customerClient.updateProfile(
        id,
        {
          displayName: data.get('displayName'),
          email: data.get('email') || null,
          phoneE164: data.get('phoneE164'),
          preferredBranchId: data.get('preferredBranchId') || null,
          expectedVersion: customer.version,
          profile: {
            // NIK tidak diminta lagi (tanpa KTP); nilai lama dibiarkan apa adanya.
            nik: customer.profile?.nik ?? null,
            genderCode: String(data.get('genderCode') || '').trim() || null,
            birthDate: String(data.get('birthDate') || '').trim() || null,
            address: String(data.get('address') || '').trim() || null,
            emergencyContactName: String(data.get('emergencyContactName') || '').trim() || null,
            emergencyContactPhone: String(data.get('emergencyContactPhone') || '').trim() || null,
          },
          reason: String(data.get('reason') || '').trim() || 'Pembaruan profil pelanggan',
        },
        { idempotencyKey: crypto.randomUUID() },
      );
      setSuccess('Profil pelanggan berhasil diperbarui.');
      setEditDrawerOpen(false);
      await load();
    } catch {
      setError(
        'Perubahan profil belum dapat disimpan. Periksa kelengkapan data.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customer) return;
    const data = new FormData(event.currentTarget);
    const action = customer.status === 'ACTIVE' ? 'deactivate' : 'reactivate';
    // Nonaktifkan wajib beralasan; tidak ada alasan bawaan buatan klien.
    const reason = String(data.get('reason') || '').trim();
    if (action === 'deactivate' && reason.length < 3) {
      setError('Alasan menonaktifkan akun wajib diisi (minimal 3 karakter).');
      return;
    }
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await customerClient.setStatus(
        id,
        action,
        {
          expectedVersion: customer.version,
          ...(reason ? { reason } : {}),
        },
        { idempotencyKey: crypto.randomUUID() },
      );
      setSuccess(
        action === 'deactivate'
          ? 'Akun pelanggan dinonaktifkan.'
          : 'Akun pelanggan diaktifkan kembali.',
      );
      setStatusModalOpen(false);
      await load();
    } catch {
      setError('Status akun pelanggan belum dapat diubah.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleStopped() {
    if (!customer) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      if (customer.stoppedAt) {
        await customerClient.unmarkStopped(id);
        setSuccess('Pelanggan berhasil diaktifkan kembali dan dimasukkan ke antrean reminder.');
      } else {
        await customerClient.markStopped(id, 'Ditandai berhenti oleh Manager');
        setSuccess('Pelanggan ditandai berhenti. Reminder otomatis WhatsApp telah dinonaktifkan.');
      }
      await load();
    } catch {
      setError('Gagal mengubah status berhenti pelanggan. Periksa hak akses Anda.');
    } finally {
      setBusy(false);
    }
  }

  if (!customer)
    return error ? (
      <Feedback kind="error">{error}</Feedback>
    ) : (
      <Skeleton label="Memuat profil pelanggan" />
    );

  const selfieDoc = customer.identityDocuments.find((d) => d.kind === 'SELFIE');

  const nowForPackages = new Date();
  const activePackageCount = customer.customerPackages.filter(
    (cp) =>
      cp.status === 'ACTIVE' &&
      cp.remainingSessions > 0 &&
      (!cp.expiryAt || new Date(cp.expiryAt) >= nowForPackages),
  ).length;

  const cards = [
    { label: 'Total Order', value: customer._count.purchases ?? 0, icon: CreditCard },
    { label: 'Paket Dimiliki', value: customer._count.customerPackages ?? 0, icon: Package },
    { label: 'Total Booking', value: customer._count.customerBookings ?? 0, icon: Calendar },
    { label: 'Voucher Dipakai', value: customer._count.voucherRedemptions ?? 0, icon: CheckCircle2 },
    { label: 'Sesi Dibeli', value: customer.purchasedSessions ?? 0, icon: Clock },
  ];

  return (
    <section className="space-y-6">
      {/* Lightbox Zoom Modal */}
      <PreviewModal
        open={Boolean(zoomImage)}
        title={zoomImage?.title ?? 'Pratinjau Dokumen'}
        description="Dokumen identitas privat pelanggan."
        onClose={() => setZoomImage(null)}
        className="max-w-3xl"
      >
        {zoomImage && (
          <div className="flex items-center justify-center p-2 min-h-64">
            <img
              src={zoomImage.src}
              alt={zoomImage.title}
              className="max-h-[70vh] w-auto rounded-dd-md object-contain shadow-sm"
            />
          </div>
        )}
      </PreviewModal>

      {/* Back Link */}
      <Link
        className="inline-flex items-center gap-1.5 font-semibold text-dd-forest hover:underline text-sm"
        href="/customers"
      >
        <ArrowLeft className="size-4" />
        <span>Kembali ke Data Pelanggan</span>
      </Link>

      {/* Profile Header Banner */}
      <AdminPageHeader
        title={customer.displayName}
        description={`${customer.email ?? 'Email belum tersedia'} · ${customer.phoneE164 ?? 'Telepon belum tersedia'}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canWrite && (
              <Button
                variant="secondary"
                onClick={() => setEditDrawerOpen(true)}
                leadingIcon={<Edit3 className="size-4" />}
              >
                Edit profil
              </Button>
            )}
            {canWrite && canResetSandi && (
              <Button
                variant="secondary"
                onClick={() => {
                  setNewPassword('');
                  setShowPassword(false);
                  setPasswordModalOpen(true);
                }}
                leadingIcon={<KeyRound className="size-4" />}
              >
                Reset kata sandi
              </Button>
            )}
            {customer.status === 'ACTIVE' && (
              <KirimQrWhatsApp
                userId={customer.id}
                nama={customer.displayName}
                punyaNomor={Boolean(customer.phoneE164)}
              />
            )}
            {canSell && customer.status === 'ACTIVE' && (
              <Button disabled={saleBranches.length === 0} onClick={() => setSaleOpen(true)}>
                Jual paket
              </Button>
            )}
            {canImpersonate && customer.status === 'ACTIVE' && (
              <Button
                variant="secondary"
                onClick={() => {
                  setImpersonateError('');
                  setImpersonateModalOpen(true);
                }}
                leadingIcon={<LogIn className="size-4 text-dd-forest" />}
              >
                Login sebagai Pelanggan
              </Button>
            )}
          </div>
        }
        badges={
          <>
            <StatusBadge tone={customer.status === 'ACTIVE' ? 'success' : 'neutral'}>
              Status Akun: {(customerStatusLabels[customer.status] ?? customer.status).toUpperCase()}
            </StatusBadge>
            <StatusBadge
              tone={customer.verificationStatus === 'APPROVED' ? 'success' : 'warning'}
            >
              Verifikasi Identitas:{' '}
              {(
                verificationStatusLabels[customer.verificationStatus] ?? customer.verificationStatus
              ).toUpperCase()}
            </StatusBadge>
            {customer.stoppedAt && (
              <StatusBadge tone="danger">
                Berhenti (pengingat nonaktif)
              </StatusBadge>
            )}
            {customer.preferredBranch && (
              <span className="inline-flex items-center gap-1.5 text-xs text-dd-muted">
                <MapPin className="size-3.5 text-dd-forest" aria-hidden="true" />
                Cabang pilihan:{' '}
                <strong className="text-dd-ink">{customer.preferredBranch.name}</strong> (
                {customer.preferredBranch.code})
              </span>
            )}
          </>
        }
      />

      {error && <Feedback kind="error" onDismiss={() => setError('')}>{error}</Feedback>}
      {success && <Feedback kind="status" onDismiss={() => setSuccess('')}>{success}</Feedback>}
      {customer.passwordCredential?.mustChangePassword && (
        <Feedback kind="warning">
          Pelanggan wajib mengganti password awal sebelum mengakses transaksi bisnis.
        </Feedback>
      )}
      {customer.contactMasked && (
        <Feedback kind="info">
          Pelanggan ini belum berkaitan dengan cabang Anda (bukan cabang pilihannya dan belum pernah
          memesan atau membeli di cabang Anda). Kontak dan data pribadinya disamarkan, dan datanya
          tidak dapat diubah dari akun Anda.
        </Feedback>
      )}
      {!canWriteRole && (
        <Feedback kind="info">
          Akun Anda hanya dapat melihat data pelanggan. Mengubah profil, status akun, dan status
          berhenti memerlukan izin pengelolaan pelanggan.
        </Feedback>
      )}

      {/* 2-Column Studio Split Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: Profil, Dokumen Verifikasi Identitas, Keamanan & Pengingat */}
        <div className="lg:col-span-5 space-y-6">
          {/* Card 1: Profil & Data Demografi */}
          <div className="rounded-dd-lg border border-dd-line bg-white p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-dd-line/80 pb-3">
              <h2 className="text-base font-bold text-dd-ink flex items-center gap-2">
                <User className="size-5 text-dd-forest" />
                Profil &amp; Demografi
              </h2>
              {canWrite && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setEditDrawerOpen(true)}
                  leadingIcon={<Edit3 className="size-3.5" />}
                >
                  Edit profil
                </Button>
              )}
            </div>

            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-dd-md border border-dd-line/70 bg-dd-surface-muted/20 p-3">
                  <span className="text-[13px] font-bold text-dd-muted block">Jenis Kelamin</span>
                  <p className="mt-1 font-semibold text-dd-ink">
                    {customer.profile?.gender === 'FEMALE' || customer.profile?.genderCode === 'F'
                      ? 'Perempuan'
                      : customer.profile?.gender === 'MALE' || customer.profile?.genderCode === 'M'
                        ? 'Laki-laki'
                        : '—'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-dd-md border border-dd-line/70 bg-dd-surface-muted/20 p-3">
                  <span className="text-[13px] font-bold text-dd-muted block">Tanggal Lahir</span>
                  <p className="mt-1 font-semibold text-dd-ink">
                    {customer.profile?.birthDate
                      ? new Date(customer.profile.birthDate).toLocaleDateString('id-ID', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })
                      : '—'}
                  </p>
                </div>
                <div className="rounded-dd-md border border-dd-line/70 bg-dd-surface-muted/20 p-3">
                  <span className="text-[13px] font-bold text-dd-muted block">Cabang Pilihan</span>
                  <p className="mt-1 font-semibold text-dd-ink truncate" title={customer.preferredBranch?.name || '—'}>
                    {customer.preferredBranch?.name || '—'}
                  </p>
                </div>
              </div>

              <div className="rounded-dd-md border border-dd-line/70 bg-dd-surface-muted/20 p-3">
                <span className="text-[13px] font-bold text-dd-muted flex items-center gap-1.5">
                  <MapPin className="size-3.5 text-dd-forest" /> Alamat Domisili
                </span>
                <p className="mt-1 font-semibold text-dd-ink break-words">{customer.profile?.address || '—'}</p>
              </div>

              <div className="rounded-dd-md border border-dd-line/70 bg-dd-surface-muted/20 p-3">
                <span className="text-[13px] font-bold text-dd-muted flex items-center gap-1.5">
                  <Phone className="size-3.5 text-dd-forest" /> Kontak Darurat
                </span>
                <p className="mt-1 font-semibold text-dd-ink">
                  {customer.profile?.emergencyContactName || '—'}
                </p>
                {customer.profile?.emergencyContactPhone && (
                  <p className="text-xs text-dd-forest font-medium mt-0.5">
                    {customer.profile.emergencyContactPhone}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Card 2: Dokumen Verifikasi Identitas */}
          <div className="rounded-dd-lg border border-dd-line bg-white p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dd-line/80 pb-3">
              <div>
                <h2 className="text-base font-bold text-dd-ink flex items-center gap-2">
                  <ShieldCheck className="size-5 text-dd-forest" />
                  Foto selfie
                </h2>
                <p className="mt-0.5 text-xs text-dd-muted">
                  Satu-satunya foto identitas (tanpa KTP). Dipakai staf untuk mengenali member
                  di meja check-in; wajib sebelum membeli paket dan booking.
                </p>
              </div>
              <StatusBadge tone={customer.verificationStatus === 'APPROVED' ? 'success' : 'warning'}>
                {verificationStatusLabels[customer.verificationStatus] ?? customer.verificationStatus}
              </StatusBadge>
            </div>

            <div className="grid max-w-sm gap-4">
              <CustomerDocumentCard
                title="Foto Selfie Pelanggan"
                kind="SELFIE"
                doc={selfieDoc}
                onZoom={(title, src) => setZoomImage({ title, src })}
                onUpload={handleUploadDocument}
                onError={(msg) => setError(msg)}
                uploading={uploadingDoc === 'SELFIE'}
                canWrite={canWrite}
                refreshKey={docRefreshKey}
              />
            </div>
          </div>

          {/* Card 3: Keamanan & Status Akun */}
          <div className="rounded-dd-lg border border-dd-line bg-white p-5 space-y-4">
            <div className="border-b border-dd-line/80 pb-3">
              <h2 className="text-base font-bold text-dd-ink flex items-center gap-2">
                <KeyRound className="size-5 text-dd-forest" />
                Keamanan &amp; Status Akun
              </h2>
            </div>

            {/* Status Akun */}
            <div className="flex items-center justify-between gap-3 p-3 rounded-dd-md border border-dd-line/70 bg-dd-surface-muted/20">
              <div>
                <div className="flex items-center gap-2">
                  <strong className="text-sm font-semibold text-dd-ink">Status Akun</strong>
                  <StatusBadge tone={customer.status === 'ACTIVE' ? 'success' : 'warning'}>
                    {customerStatusLabels[customer.status] ?? customer.status}
                  </StatusBadge>
                </div>
                <p className="text-xs text-dd-muted mt-0.5">
                  {customer.status === 'ACTIVE'
                    ? 'Akun aktif dapat masuk portal dan pesan kelas.'
                    : 'Akun dinonaktifkan dari sesi aktif.'}
                </p>
              </div>
              {canWrite && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setStatusModalOpen(true)}
                >
                  Ubah status
                </Button>
              )}
            </div>

            {/* Reminder WhatsApp (Rule #12 & #13) */}
            <div className="space-y-2 p-3 rounded-dd-md border border-dd-line/70 bg-dd-surface-muted/20">
              <div className="flex items-center justify-between gap-2">
                <strong className="text-sm font-semibold text-dd-ink">Pengingat WhatsApp</strong>
                {customer.stoppedAt ? (
                  <StatusBadge tone="danger">Berhenti</StatusBadge>
                ) : (
                  <StatusBadge tone="success">Aktif</StatusBadge>
                )}
              </div>
              <p className="text-xs text-dd-muted">
                {customer.stoppedAt
                  ? `Pelanggan ditandai berhenti sejak ${new Date(customer.stoppedAt).toLocaleDateString('id-ID')}. Pesan reminder otomatis WhatsApp dinonaktifkan.`
                  : 'Pelanggan aktif dalam antrean reminder berkala normal.'}
              </p>
              {canWrite && (
                <div className="pt-1">
                  <Button
                    type="button"
                    variant={customer.stoppedAt ? 'primary' : 'danger'}
                    size="sm"
                    loading={busy}
                    disabled={!canWrite}
                    onClick={toggleStopped}
                  >
                    {customer.stoppedAt ? 'Aktifkan Kembali ke Reminder' : 'Tandai Pelanggan Berhenti'}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Metrik Saldo & Tabbed Activity Tables */}
        <div className="lg:col-span-7 space-y-6">
          {/* Top Metric Cards */}
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-5">
            {cards.map((c) => {
              const Icon = c.icon;
              return (
                <div key={c.label} className="rounded-dd-lg border border-dd-line bg-white p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-bold text-dd-muted">{c.label}</span>
                    <Icon className="size-4 text-dd-forest/70" />
                  </div>
                  <strong className="mt-1 block text-2xl font-bold text-dd-ink">{c.value}</strong>
                </div>
              );
            })}
          </div>

          {/* Tabbed Tables (Paket Aktif, Riwayat Order, Riwayat Booking Kelas) */}
          <div className="rounded-dd-lg border border-dd-line bg-white overflow-hidden">
            {/* Table Tabs Header */}
            <div className="flex border-b border-dd-line bg-dd-surface-muted/30 px-6 pt-3 gap-2 overflow-x-auto">
              <button
                type="button"
                onClick={() => setActiveTab('packages')}
                className={`pb-3 px-4 font-semibold text-sm border-b-2 transition cursor-pointer flex items-center gap-2 whitespace-nowrap ${
                  activeTab === 'packages'
                    ? 'border-dd-forest text-dd-forest'
                    : 'border-transparent text-dd-muted hover:text-dd-ink'
                }`}
              >
                <Package className="size-4" />
                Paket &amp; Sesi ({activePackageCount} aktif)
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('orders')}
                className={`pb-3 px-4 font-semibold text-sm border-b-2 transition cursor-pointer flex items-center gap-2 whitespace-nowrap ${
                  activeTab === 'orders'
                    ? 'border-dd-forest text-dd-forest'
                    : 'border-transparent text-dd-muted hover:text-dd-ink'
                }`}
              >
                <CreditCard className="size-4" />
                Riwayat Order ({customer.purchases.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('bookings')}
                className={`pb-3 px-4 font-semibold text-sm border-b-2 transition cursor-pointer flex items-center gap-2 whitespace-nowrap ${
                  activeTab === 'bookings'
                    ? 'border-dd-forest text-dd-forest'
                    : 'border-transparent text-dd-muted hover:text-dd-ink'
                }`}
              >
                <Calendar className="size-4" />
                Riwayat Booking Kelas ({customer.customerBookings.length})
              </button>
            </div>

            {/* Tab 1: Paket Aktif & Sisa Sesi */}
            {activeTab === 'packages' && (
              <div className="p-6 space-y-6">
                {(() => {
                  const now = new Date();
                  const activePkgs = customer.customerPackages.filter(
                    (cp) =>
                      cp.status === 'ACTIVE' &&
                      cp.remainingSessions > 0 &&
                      (!cp.expiryAt || new Date(cp.expiryAt) >= now),
                  );
                  const inactivePkgs = customer.customerPackages.filter(
                    (cp) =>
                      cp.status !== 'ACTIVE' ||
                      cp.remainingSessions <= 0 ||
                      (cp.expiryAt && new Date(cp.expiryAt) < now),
                  );

                  return (
                    <>
                      {activePkgs.length === 0 ? (
                        <div className="rounded-dd-md bg-dd-surface-muted/40 p-8 text-center text-sm text-dd-muted">
                          Pelanggan belum memiliki paket aktif saat ini.
                        </div>
                      ) : (
                        <DataTable
                          showRowNumbers={false}
                          items={activePkgs}
                          rowKey={(cp) => cp.id}
                          columns={[
                            {
                              id: 'name',
                              header: 'Nama Paket',
                              cell: (cp) => (
                                <span className="font-semibold text-dd-ink">
                                  {cp.package?.name ?? 'Paket Pilates'}
                                </span>
                              ),
                            },
                            {
                              id: 'total',
                              header: 'Total Sesi',
                              cell: (cp) => {
                                const base = (cp as any).totalSessions ?? cp.sessionCountSnapshot ?? cp.package?.sessionCount ?? 0;
                                return `${Math.max(base, cp.remainingSessions + (cp.usedSessions ?? 0))} Sesi`;
                              },
                            },
                            {
                              id: 'remaining',
                              header: 'Sisa Sesi',
                              cell: (cp) => (
                                <span className="inline-flex rounded-full bg-dd-success-soft px-2.5 py-0.5 text-xs font-bold text-dd-forest">
                                  {cp.remainingSessions} Sesi
                                </span>
                              ),
                            },
                            { id: 'used', header: 'Sesi Digunakan', cell: (cp) => `${cp.usedSessions} Sesi` },
                            {
                              id: 'expiry',
                              header: 'Masa Berlaku',
                              cell: (cp) =>
                                cp.expiryAt
                                  ? `s.d. ${new Date(cp.expiryAt).toLocaleDateString('id-ID')}`
                                  : 'Permanen',
                            },
                            {
                              id: 'status',
                              header: 'Status',
                              cell: (cp) => (
                                <StatusBadge tone="success">
                                  {statusLabel(cp.status)}
                                </StatusBadge>
                              ),
                            },
                            {
                              id: 'manage',
                              header: 'Tindakan',
                              cell: (cp) => (
                                <ButtonLink size="sm" variant="secondary" href={`/ledger/${cp.id}`}>
                                  {sessionContext?.hasCapability('customer-package:manage')
                                    ? 'Kelola'
                                    : 'Riwayat sesi'}
                                </ButtonLink>
                              ),
                            },
                          ]}
                          mobileCard={(cp) => (
                            <div className="space-y-1">
                              <div className="flex items-center justify-between gap-3">
                                <strong className="text-dd-ink">{cp.package?.name ?? 'Paket Pilates'}</strong>
                                <StatusBadge tone="success">
                                  {statusLabel(cp.status)}
                                </StatusBadge>
                              </div>
                              <p className="text-sm text-dd-muted">
                                Sisa {cp.remainingSessions} dari{' '}
                                {Math.max((cp as any).totalSessions ?? cp.sessionCountSnapshot ?? cp.package?.sessionCount ?? 0, cp.remainingSessions + (cp.usedSessions ?? 0))} sesi ·{' '}
                                {cp.expiryAt
                                  ? `s.d. ${new Date(cp.expiryAt).toLocaleDateString('id-ID')}`
                                  : 'Permanen'}
                              </p>
                            </div>
                          )}
                        />
                      )}

                      {inactivePkgs.length > 0 && (
                        <div className="border-t border-dd-line/60 pt-6">
                          <h4 className="text-sm font-semibold text-dd-muted mb-3">
                            Paket Selesai / Habis &amp; Kedaluwarsa ({inactivePkgs.length})
                          </h4>
                          <DataTable
                            showRowNumbers={false}
                            items={inactivePkgs}
                            rowKey={(cp) => cp.id}
                            columns={[
                              {
                                id: 'name',
                                header: 'Nama Paket',
                                cell: (cp) => (
                                  <span className="text-dd-muted">
                                    {cp.package?.name ?? 'Paket Pilates'}
                                  </span>
                                ),
                              },
                              {
                                id: 'total',
                                header: 'Total Sesi',
                                cell: (cp) => {
                                  const base = (cp as any).totalSessions ?? cp.sessionCountSnapshot ?? cp.package?.sessionCount ?? 0;
                                  return `${Math.max(base, cp.remainingSessions + (cp.usedSessions ?? 0))} Sesi`;
                                },
                              },
                              {
                                id: 'remaining',
                                header: 'Sisa Sesi',
                                cell: (cp) => `${cp.remainingSessions} Sesi`,
                              },
                              { id: 'used', header: 'Sesi Digunakan', cell: (cp) => `${cp.usedSessions} Sesi` },
                              {
                                id: 'expiry',
                                header: 'Masa Berlaku',
                                cell: (cp) =>
                                  cp.expiryAt
                                    ? `s.d. ${new Date(cp.expiryAt).toLocaleDateString('id-ID')}`
                                    : 'Permanen',
                              },
                              {
                                id: 'status',
                                header: 'Status',
                                cell: (cp) => (
                                  <StatusBadge tone="warning">
                                    {statusLabel(cp.status)}
                                  </StatusBadge>
                                ),
                              },
                              {
                                id: 'manage',
                                header: 'Tindakan',
                                cell: (cp) => (
                                  <ButtonLink size="sm" variant="secondary" href={`/ledger/${cp.id}`}>
                                    Riwayat sesi
                                  </ButtonLink>
                                ),
                              },
                            ]}
                          />
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}

            {/* Tab 2: Riwayat Order & Pembelian */}
            {activeTab === 'orders' && (
              <div className="p-6">
                {customer.purchases.length === 0 ? (
                  <div className="rounded-dd-md bg-dd-surface-muted/40 p-8 text-center text-sm text-dd-muted">
                    Pelanggan belum memiliki riwayat pembelian paket.
                  </div>
                ) : (
                  <DataTable
                    showRowNumbers={false}
                    items={customer.purchases}
                    rowKey={(p) => p.id}
                    columns={[
                      {
                        id: 'invoice',
                        header: 'Invoice / Tanggal',
                        cell: (p) => (
                          <>
                            <strong className="block text-dd-ink">
                              {p.invoiceNumber ?? p.id.slice(0, 8)}
                            </strong>
                            <span className="text-xs text-dd-muted">
                              {new Date(p.submittedAt).toLocaleDateString('id-ID')}
                            </span>
                          </>
                        ),
                      },
                      {
                        id: 'package',
                        header: 'Paket',
                        cell: (p) => (
                          <span className="font-semibold text-dd-ink">
                            {p.packageNameSnapshot ?? 'Paket Pilates'}
                          </span>
                        ),
                      },
                      { id: 'branch', header: 'Cabang', cell: (p) => p.branchName || '—' },
                      {
                        id: 'amount',
                        header: 'Nominal',
                        cell: (p) => (
                          <span className="font-semibold text-dd-forest">
                            Rp {(p.payableAmountRpSnapshot ?? 0).toLocaleString('id-ID')}
                          </span>
                        ),
                      },
                      { id: 'method', header: 'Metode', cell: (p) => p.paymentMethod ?? 'Transfer' },
                      {
                        id: 'status',
                        header: 'Status',
                        cell: (p) => (
                          <StatusBadge tone={p.status === 'PAID' ? 'success' : 'warning'}>
                            {statusLabel(p.status)}
                          </StatusBadge>
                        ),
                      },
                      {
                        id: 'proof',
                        header: 'Bukti Bayar',
                        cell: (p) =>
                          p.paymentProofUrl ? (
                            <ButtonLink
                              variant="secondary"
                              size="sm"
                              href={`/workspace/payments/${p.id}`}
                            >
                              Lihat bukti
                            </ButtonLink>
                          ) : (
                            <span className="text-dd-muted">—</span>
                          ),
                      },
                    ]}
                    mobileCard={(p) => (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-3">
                          <strong className="text-dd-ink">{p.invoiceNumber ?? p.id.slice(0, 8)}</strong>
                          <StatusBadge tone={p.status === 'PAID' ? 'success' : 'warning'}>
                            {statusLabel(p.status)}
                          </StatusBadge>
                        </div>
                        <p className="text-sm text-dd-muted">
                          {p.packageNameSnapshot ?? 'Paket Pilates'} · Rp{' '}
                          {(p.payableAmountRpSnapshot ?? 0).toLocaleString('id-ID')}
                        </p>
                      </div>
                    )}
                  />
                )}
              </div>
            )}

            {/* Tab 3: Riwayat Booking Kelas */}
            {activeTab === 'bookings' && (
              <div className="p-6">
                {customer.customerBookings.length === 0 ? (
                  <div className="rounded-dd-md bg-dd-surface-muted/40 p-8 text-center text-sm text-dd-muted">
                    Pelanggan belum memiliki riwayat pemesanan kelas.
                  </div>
                ) : (
                  <DataTable
                    showRowNumbers={false}
                    items={customer.customerBookings}
                    rowKey={(b) => b.id}
                    columns={[
                      {
                        id: 'number',
                        header: 'No. Booking',
                        cell: (b) => (
                          <span className="font-semibold text-dd-ink">
                            {b.bookingNumber ?? b.id.slice(0, 8)}
                          </span>
                        ),
                      },
                      {
                        id: 'class',
                        header: 'Tipe Kelas',
                        cell: (b) => b.classTypeName ?? 'Kelas Pilates',
                      },
                      { id: 'instructor', header: 'Instruktur', cell: (b) => b.instructorName ?? '—' },
                      {
                        id: 'time',
                        header: 'Waktu Kelas',
                        cell: (b) =>
                          b.startAt
                            ? `${new Date(b.startAt).toLocaleDateString('id-ID')} (${new Date(b.startAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })})`
                            : '—',
                      },
                      {
                        id: 'status',
                        header: 'Status Booking',
                        cell: (b) => (
                          <StatusBadge tone={b.status === 'BOOKED' ? 'success' : 'neutral'}>
                            {statusLabel(b.status)}
                          </StatusBadge>
                        ),
                      },
                      {
                        id: 'attendance',
                        header: 'Kehadiran',
                        cell: (b) => (
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                              b.attendanceStatus === 'HADIR'
                                ? 'bg-dd-success-soft text-dd-forest'
                                : b.attendanceStatus === 'BATAL'
                                  ? 'bg-dd-danger-soft text-dd-danger'
                                  : 'bg-dd-warning-soft text-dd-warning'
                            }`}
                          >
                            {statusLabel(b.attendanceStatus ?? 'MENUNGGU')}
                          </span>
                        ),
                      },
                    ]}
                    mobileCard={(b) => (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-3">
                          <strong className="text-dd-ink">{b.classTypeName ?? 'Kelas Pilates'}</strong>
                          <StatusBadge tone={b.status === 'BOOKED' ? 'success' : 'neutral'}>
                            {statusLabel(b.status)}
                          </StatusBadge>
                        </div>
                        <p className="text-sm text-dd-muted">
                          {b.bookingNumber ?? b.id.slice(0, 8)} ·{' '}
                          {b.startAt ? new Date(b.startAt).toLocaleDateString('id-ID') : '—'} ·{' '}
                          {statusLabel(b.attendanceStatus ?? 'MENUNGGU')}
                        </p>
                      </div>
                    )}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit Profile Drawer */}
      <Drawer
        open={editDrawerOpen}
        onClose={() => setEditDrawerOpen(false)}
        title="Edit Profil & Data Demografi"
        description="Perbarui identitas pribadi, alamat, cabang utama, dan kontak darurat pelanggan."
        className="max-w-xl"
      >
        <form onSubmit={updateProfile} className="space-y-4 py-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput
              required
              label="Nama Lengkap"
              name="displayName"
              defaultValue={customer.displayName}
            />
            <TextInput
              type="email"
              label="Email (Opsional)"
              name="email"
              defaultValue={customer.email ?? ''}
              placeholder="nama@email.com"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput
              required
              label="Nomor WhatsApp / HP"
              name="phoneE164"
              defaultValue={customer.phoneE164 ?? ''}
            />
            <SearchSelect
              label="Studio/Cabang Pilihan"
              name="preferredBranchId"
              defaultValue={customer.preferredBranch?.id ?? ''}
              placeholder="Belum ditentukan"
              options={(session?.branches ?? []).map((branch) => ({
                id: branch.id,
                label: branch.name,
              }))}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <label className="text-xs font-bold text-dd-ink" htmlFor="gender-select">
                Jenis Kelamin
              </label>
              <select
                id="gender-select"
                name="genderCode"
                defaultValue={customer.profile?.gender ?? customer.profile?.genderCode ?? ''}
                className="w-full rounded-dd-md border border-dd-line bg-white px-3 py-2 text-sm text-dd-ink outline-none focus:border-dd-forest focus:ring-2 focus:ring-dd-forest/15"
              >
                <option value="">Pilih Jenis Kelamin</option>
                <option value="FEMALE">Perempuan</option>
                <option value="MALE">Laki-laki</option>
              </select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput
              type="date"
              label="Tanggal Lahir"
              name="birthDate"
              defaultValue={
                customer.profile?.birthDate
                  ? new Date(customer.profile.birthDate).toISOString().split('T')[0]
                  : ''
              }
            />
            <TextInput
              label="Alamat Domisili"
              name="address"
              defaultValue={customer.profile?.address ?? ''}
              placeholder="Alamat lengkap tempat tinggal"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput
              label="Nama Kontak Darurat"
              name="emergencyContactName"
              defaultValue={customer.profile?.emergencyContactName ?? ''}
              placeholder="Nama keluarga / rekan"
            />
            <TextInput
              label="Nomor Kontak Darurat"
              name="emergencyContactPhone"
              defaultValue={customer.profile?.emergencyContactPhone ?? ''}
              placeholder="08123456789"
            />
          </div>
          <TextInput
            label="Catatan perubahan (opsional)"
            name="reason"
            placeholder="Contoh: Pembaruan data demografi dan kontak"
          />
          <div className="flex justify-end gap-2 pt-3 border-t border-dd-line">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => setEditDrawerOpen(false)}
            >
              Batal
            </Button>
            <Button type="submit" loading={busy} disabled={!canWrite}>
              Simpan Perubahan Profil
            </Button>
          </div>
        </form>
      </Drawer>

      {/* Change Status Modal */}
      <Modal
        open={statusModalOpen}
        onClose={() => setStatusModalOpen(false)}
        title="Ubah Status Akun Pelanggan"
        description="Menonaktifkan akun mencabut seluruh sesi aktif. Tindakan ini tidak mengubah saldo atau riwayat transaksi."
      >
        <form onSubmit={changeStatus} className="space-y-4 py-2">
          <TextInput
            label={customer.status === 'ACTIVE' ? 'Alasan menonaktifkan' : 'Catatan (opsional)'}
            name="reason"
            maxLength={500}
            required={customer.status === 'ACTIVE'}
            minLength={customer.status === 'ACTIVE' ? 3 : undefined}
            placeholder="Contoh: Permintaan member"
          />
          <div className="flex justify-end gap-2 pt-2 border-t border-dd-line">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => setStatusModalOpen(false)}
            >
              Batal
            </Button>
            <Button
              type="submit"
              variant={customer.status === 'ACTIVE' ? 'danger' : 'primary'}
              loading={busy}
              disabled={!canWrite}
            >
              {customer.status === 'ACTIVE' ? 'Nonaktifkan Pelanggan' : 'Aktifkan Pelanggan'}
            </Button>
          </div>
        </form>
      </Modal>
      {canSell && saleBranches.length > 0 && (
        <AssistedSaleDrawer
          open={saleOpen}
          branch={saleBranch}
          branches={saleBranches}
          customer={{ id: customer.id, name: customer.displayName }}
          onClose={() => setSaleOpen(false)}
          onRecorded={() => void load()}
        />
      )}

      {/* Reset Password Modal */}
      <Modal
        open={passwordModalOpen}
        title="Reset Kata Sandi Pelanggan"
        description={`Setel kata sandi baru untuk akun ${customer.displayName}. Pelanggan dapat langsung login ke portal member menggunakan kata sandi ini.`}
        onClose={() => setPasswordModalOpen(false)}
      >
        <form onSubmit={handleResetPassword} className="space-y-4 py-2">
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-dd-ink" htmlFor="new-customer-password">
                Kata Sandi Baru (Min. 8 karakter)
              </label>
              <button
                type="button"
                onClick={generateRandomPassword}
                className="inline-flex items-center gap-1 text-xs font-semibold text-dd-forest hover:underline cursor-pointer"
              >
                <RefreshCw className="size-3" /> Buat Sandi Acak
              </button>
            </div>
            <div className="relative flex items-center">
              <input
                id="new-customer-password"
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
            <p className="text-xs text-dd-muted">
              Setelah disimpan, kata sandi lama tidak lagi berlaku dan member dapat langsung login dengan sandi baru.
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              disabled={passwordBusy}
              onClick={() => setPasswordModalOpen(false)}
            >
              Batal
            </Button>
            <Button type="submit" loading={passwordBusy} disabled={!newPassword || newPassword.length < 8}>
              Simpan Kata Sandi
            </Button>
          </div>
        </form>
      </Modal>

      {/* Impersonate Customer Modal */}
      {impersonateModalOpen && (
        <Modal
          open={impersonateModalOpen}
          title={`Masuk sebagai ${customer.displayName}`}
          description={`Anda akan masuk ke portal pelanggan sebagai ${customer.displayName} tanpa kata sandi untuk melihat saldo paket, riwayat sesi, dan data lainnya.`}
          onClose={() => {
            if (!impersonateBusy) {
              setImpersonateModalOpen(false);
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
                  setImpersonateModalOpen(false);
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
                    await customerClient.impersonate(customer.id);
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
