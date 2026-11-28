'use client';

import Link from 'next/link';
import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  Info,
  Lock,
  Mail,
  MapPin,
  PackageCheck,
  Phone,
  ShieldCheck,
  User,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { accountClient, type MyProfile } from '@/api-clients/account-client';
import { internalStaffRoles, isCustomerOnlySession } from '@/lib/session-audience';
import { useSessionContext } from '../../session-context';
import { WhatsAppOtomatis } from './whatsapp-otomatis';
import { useCustomerBadges } from '../../components/customer/use-customer-badges';
import { messageForApiError, useAppFeedback } from '../../components/app-feedback';
import { Button, ButtonLink } from '../../components/actions';
import { useStudioPreference } from '../../components/public/public-experience';
import { PageHeader, Skeleton, StatusBadge } from '../../ui';

export function ProfileView() {
  const sessionContext = useSessionContext();
  const session = sessionContext?.session;
  const feedback = useAppFeedback();
  const studioPreference = useStudioPreference();
  const badges = useCustomerBadges();
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'error' | 'stale'>('loading');
  const [message, setMessage] = useState('');

  const load = async () => {
    setState('loading');
    try {
      setProfile(await accountClient.profile());
      setState('ready');
    } catch {
      setState('error');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (!profile || state === 'loading') {
    return (
      <main className="space-y-6" aria-labelledby="profile-loading-title">
        <PageHeader
          eyebrow="Pengaturan Akun"
          title="Profil Saya"
          description="Kelola informasi identitas, kontak akun, dan preferensi studio utama Anda."
          titleId="profile-loading-title"
        />
        <section className="rounded-dd-xl border border-dd-line bg-white p-8">
          <Skeleton label="Memuat profil pengguna" />
        </section>
      </main>
    );
  }

  const initials = profile.displayName
    ? profile.displayName
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join('')
    : 'U';

  const isVerified = session?.identityVerificationStatus === 'APPROVED';
  const isReviewer = Boolean(session?.capabilities.includes('identity-verification:read'));
  const kycHref = isReviewer ? '/identity-verifications' : '/account/verification';
  const isInternal = Boolean(
    session &&
      !isCustomerOnlySession(session) &&
      session.roles.some((role) => internalStaffRoles.has(role)),
  );
  const roleBadge = (() => {
    if (session?.roles.includes('SUPER_OWNER')) return { tone: 'success' as const, label: 'Super Owner', detail: 'Akses Penuh Sistem' };
    if (session?.roles.includes('OWNER')) return { tone: 'success' as const, label: 'Owner Cabang', detail: 'Manajemen Cabang' };
    if (session?.roles.includes('HEAD_INSTRUCTOR') || session?.roles.includes('INSTRUCTOR')) return { tone: 'info' as const, label: 'Instruktur', detail: 'Jadwal & Presensi' };
    if (session?.roles.includes('FINANCE')) return { tone: 'info' as const, label: 'Finance', detail: 'Kasir & Pembayaran' };
    if (session?.roles.includes('ADMIN') || session?.roles.includes('MANAGER')) return { tone: 'info' as const, label: 'Operasional', detail: 'Staf Studio' };
    return {
      tone: isVerified ? ('success' as const) : ('neutral' as const),
      label: isVerified ? 'Member Terverifikasi' : 'Member Daily Dose',
      detail: 'Akun Member Pribadi',
    };
  })();

  const bookingsHref = isInternal ? '/workspace/bookings' : '/bookings';

  return (
    <main className="space-y-6" aria-labelledby="profile-heading">
      <PageHeader
        eyebrow="Pengaturan Akun"
        title="Profil Saya"
        description="Kelola informasi identitas, kontak akun, dan preferensi studio utama Anda."
        titleId="profile-heading"
        backHref="/account"
        backLabel="Kembali ke Beranda"
        context={
          <div className="flex flex-wrap items-center gap-2">
            {isInternal && (
              <ButtonLink href="/workspace" variant="primary">
                Buka Workspace
              </ButtonLink>
            )}
            <ButtonLink href="/account/security" variant="secondary">
              Keamanan Akun
            </ButtonLink>
          </div>
        }
      />

      {/* Profile Identity Card */}
      <section className="rounded-dd-xl border border-dd-line bg-white p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex size-16 shrink-0 items-center justify-center rounded-full bg-dd-forest text-xl font-bold tracking-wider text-white shadow-sm">
              {initials}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold text-dd-ink">{profile.displayName}</h2>
                <StatusBadge tone={roleBadge.tone} withDot>
                  {roleBadge.label}
                </StatusBadge>
              </div>
              <p className="mt-1 text-xs text-dd-muted">
                {profile.username ? `@${profile.username} · ` : ''}{profile.emailMasked ?? 'Email akun terdaftar'} · {roleBadge.detail}
              </p>
            </div>
          </div>
        </div>
      </section>

      {session?.roles.includes('ADMIN') && <WhatsAppOtomatis />}

      {/* Main Profile Form */}
      <form
        className="space-y-6 rounded-dd-xl border border-dd-line bg-white p-6"
        onSubmit={async (event) => {
          event.preventDefault();
          if (state === 'saving') return;
          const data = new FormData(event.currentTarget);
          setState('saving');
          setMessage('');
          try {
            const updated = await accountClient.updateProfile({
              displayName: String(data.get('displayName')),
              expectedVersion: profile.version,
            });
            setProfile(updated);
            setState('ready');
            feedback.showToast({
              tone: 'success',
              title: 'Profil diperbarui',
              message: 'Nama tampilan terbaru sudah berhasil disimpan.',
            });
            await sessionContext?.refresh();
          } catch (error) {
            const status = (error as { response?: { status?: number } }).response?.status;
            setState(status === 409 ? 'stale' : 'error');
            setMessage(
              status === 409
                ? 'Profil sudah diperbarui di sesi lain. Muat ulang sebelum mencoba kembali.'
                : 'Profil belum dapat disimpan. Periksa koneksi Anda.',
            );
            if (status !== 409) feedback.showAlert({ tone: 'danger', ...messageForApiError(error) });
          }
        }}
      >
        <div className="border-b border-dd-line/60 pb-4">
          <h3 className="text-base font-semibold text-dd-ink">Informasi Akun</h3>
          <p className="mt-0.5 text-xs text-dd-muted">
            Nama tampilan Anda akan digunakan pada daftar kehadiran instruktur dan jadwal reservasi kelas.
          </p>
        </div>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <span className="flex items-center justify-between text-[13px] font-bold text-dd-forest">
                <span>Username (ID Login)</span>
                <span className="flex items-center gap-1 text-[13px] font-normal text-dd-muted">
                  <Lock className="size-3" /> Akun Terdaftar
                </span>
              </span>
              <div className="relative mt-1.5 flex items-center">
                <input
                  id="username"
                  name="username"
                  value={profile.username ? `@${profile.username}` : 'Belum diatur'}
                  readOnly
                  disabled
                  className="w-full rounded-dd-md border border-dd-line bg-dd-surface-muted px-3.5 py-2.5 text-sm font-medium font-mono text-dd-ink cursor-not-allowed"
                />
              </div>
              <p className="mt-1 text-[12px] text-dd-muted">
                Username resmi Anda untuk masuk ke aplikasi Daily Dose.
              </p>
            </div>

            <div>
              <label htmlFor="displayName" className="block text-[13px] font-bold text-dd-forest">
                Nama Lengkap / Tampilan
              </label>
              <div className="relative mt-1.5">
                <input
                  id="displayName"
                  name="displayName"
                  defaultValue={profile.displayName}
                  minLength={2}
                  maxLength={160}
                  required
                  className="w-full rounded-dd-md border border-dd-line bg-white px-3.5 py-2.5 text-sm text-dd-ink transition focus:border-dd-forest focus:outline-none focus:ring-1 focus:ring-dd-forest"
                  placeholder="Masukkan nama lengkap Anda"
                />
              </div>
              <p className="mt-1 text-[12px] text-dd-muted">
                Nama yang ditampilkan di jadwal instruktur &amp; kartu reservasi kelas.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <span className="flex items-center justify-between text-[13px] font-bold text-dd-forest">
                <span>Email Akun</span>
                <span className="flex items-center gap-1 text-[13px] font-normal text-dd-muted">
                  <Lock className="size-3" /> Terverifikasi
                </span>
              </span>
              <div className="relative mt-1.5 flex items-center">
                <input
                  value={profile.emailMasked ?? 'Belum tersedia'}
                  readOnly
                  disabled
                  className="w-full rounded-dd-md border border-dd-line bg-dd-surface-muted px-3.5 py-2.5 text-sm text-dd-muted cursor-not-allowed"
                />
              </div>
            </div>

            <div>
              <span className="flex items-center justify-between text-[13px] font-bold text-dd-forest">
                <span>Nomor WhatsApp</span>
                {profile.phoneMasked ? (
                  <span className="flex items-center gap-1 text-[13px] font-normal text-dd-muted">
                    <Lock className="size-3" /> Terverifikasi
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[13px] font-semibold text-dd-warning">
                    Belum terdaftar
                  </span>
                )}
              </span>
              <div className="relative mt-1.5 flex items-center">
                <input
                  value={profile.phoneMasked ?? 'Belum terdaftar (Akun Google)'}
                  readOnly
                  disabled
                  className="w-full rounded-dd-md border border-dd-line bg-dd-surface-muted px-3.5 py-2.5 text-sm text-dd-muted cursor-not-allowed"
                />
              </div>
              {!profile.phoneMasked && (
                <p className="mt-1.5 text-[13px] text-dd-warning font-medium">
                  Nomor WhatsApp digunakan untuk pengiriman e-tiket QR check-in studio.
                </p>
              )}
            </div>
          </div>

          <div className="flex items-start gap-2.5 rounded-dd-lg bg-dd-surface-muted p-3.5 text-xs leading-5 text-dd-muted border border-dd-line/50">
            <Info className="size-4 text-dd-forest shrink-0 mt-0.5" />
            <span>
              Untuk alasan keamanan akun, penggantian alamat email atau nomor telepon WhatsApp resmi memerlukan permohonan verifikasi melalui tim Daily Dose Studio.
            </span>
          </div>
        </div>

        {message && (
          <div
            role="status"
            className={`rounded-dd-md p-3.5 text-xs font-medium ${
              state === 'ready'
                ? 'bg-dd-success-soft text-dd-success border border-dd-success/30'
                : 'bg-dd-danger-soft text-dd-danger border border-dd-danger/30'
            }`}
          >
            {message}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button type="submit" loading={state === 'saving'} loadingLabel="Menyimpan perubahan…">
            Simpan Perubahan
          </Button>
          <ButtonLink href="/account/security" variant="secondary">
            Pengaturan Password & Keamanan
          </ButtonLink>
        </div>
      </form>

      {/* Studio Preference Card */}
      <section className="rounded-dd-xl border border-dd-line bg-white p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <MapPin className="size-5 text-dd-forest" />
              <h3 className="text-base font-semibold text-dd-ink">Studio Latihan Utama</h3>
            </div>
            <p className="text-xs leading-5 text-dd-muted max-w-xl">
              Studio utama Anda digunakan sebagai filter bawaan saat melihat jadwal kelas, paket sesi, dan reservasi harian.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="shrink-0"
            onClick={() => studioPreference?.openStudioPreference()}
          >
            Ganti Studio
          </Button>
        </div>

        <div className="mt-4 rounded-dd-lg border border-dd-line/60 bg-dd-surface-muted p-4">
          <div className="flex items-center justify-between">
            <strong className="text-sm font-semibold text-dd-ink">
              {profile.preferredBranch?.name ?? 'Muara Karang, Jakarta Utara'}
            </strong>
            <span className="text-[13px] font-medium text-dd-forest bg-white px-2 py-0.5 rounded border border-dd-line">
              Aktif
            </span>
          </div>
          <p className="mt-1 text-xs text-dd-muted">
            {profile.preferredBranch?.publicProfile?.address ??
              'Pluit Karang Cantik Blok P 3 Timur No. 18, Muara Karang, Jakarta Utara'}
          </p>
        </div>
      </section>

      {/* Quick Navigation Hub */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link
          href={kycHref}
          className="group rounded-dd-xl border border-dd-line bg-white p-5 transition hover:border-dd-forest/40 no-underline"
        >
          <div className="flex items-center justify-between">
            <ShieldCheck className="size-5 text-dd-forest group-hover:scale-105 transition-transform" />
            <StatusBadge tone={isVerified ? 'success' : 'neutral'}>
              {isVerified ? 'Disetujui' : 'Cek Status'}
            </StatusBadge>
          </div>
          <strong className="mt-3 block text-sm font-semibold text-dd-ink">Verifikasi Identitas Akun</strong>
          <p className="mt-1 text-xs text-dd-muted">Dokumen identitas resmi & selfie akun.</p>
        </Link>

        <Link
          href="/orders"
          className="group rounded-dd-xl border border-dd-line bg-white p-5 transition hover:border-dd-forest/40 no-underline"
        >
          <div className="flex items-center justify-between">
            <CreditCard className="size-5 text-dd-forest group-hover:scale-105 transition-transform" />
            {badges.actionableOrdersCount > 0 ? (
              <span className="rounded-full bg-dd-brass px-2 py-0.5 text-[13px] font-bold text-white shadow-xs">
                {badges.actionableOrdersCount} perlu tindakan
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-dd-forest">
                Buka <ChevronRight className="size-3.5" />
              </span>
            )}
          </div>
          <strong className="mt-3 block text-sm font-semibold text-dd-ink">Pesanan Saya</strong>
          <p className="mt-1 text-xs text-dd-muted">Riwayat transaksi & status pembayaran transfer.</p>
        </Link>

        <Link
          href="/packages"
          className="group rounded-dd-xl border border-dd-line bg-white p-5 transition hover:border-dd-forest/40 no-underline"
        >
          <div className="flex items-center justify-between">
            <PackageCheck className="size-5 text-dd-forest group-hover:scale-105 transition-transform" />
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-dd-forest">
              Buka <ChevronRight className="size-3.5" />
            </span>
          </div>
          <strong className="mt-3 block text-sm font-semibold text-dd-ink">Paket & Sesi</strong>
          <p className="mt-1 text-xs text-dd-muted">Beli paket baru atau cek kuota sesi Anda.</p>
        </Link>

        <Link
          href={bookingsHref}
          className="group rounded-dd-xl border border-dd-line bg-white p-5 transition hover:border-dd-forest/40 no-underline"
        >
          <div className="flex items-center justify-between">
            <CalendarDays className="size-5 text-dd-forest group-hover:scale-105 transition-transform" />
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-dd-forest">
              Buka <ChevronRight className="size-3.5" />
            </span>
          </div>
          <strong className="mt-3 block text-sm font-semibold text-dd-ink">Booking Saya</strong>
          <p className="mt-1 text-xs text-dd-muted">Jadwal reservasi & tiket QR check-in.</p>
        </Link>
      </section>
    </main>
  );
}
