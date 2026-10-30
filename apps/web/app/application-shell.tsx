'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  ChevronRight,
  CircleHelp,
  House,
  LockKeyhole,
  MapPin,
  Menu,
  Search,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { AppNavigation } from './app-navigation';
import { isRecognizedProtectedPath, useSessionContext } from './session-context';
import { routes } from '@/lib/routes';
import { roleLabel } from './lib/role-labels';
import { canReadPage, frontendPages, pageForPath } from '@/lib/frontend-pages';
import { PreviewTag } from './components/admin/preview-tag';
import { PageMetaProvider } from './components/admin/page-meta';
import { useStudioPreference } from './components/public/public-experience';
import { NotificationCenter } from './components/notification-center';
import { TOP_BAR_START_ID } from './components/top-bar-slot';
import { SearchSelect } from './components/forms';
import { Modal, useOverlayPresence } from './components/app-feedback';
import { IconButton } from './components/actions';
import {
  CUSTOMER_ACCOUNT_NAVIGATION,
  CUSTOMER_PRIMARY_NAVIGATION,
  CustomerNavigation,
  isCustomerNavigationActive,
} from './components/customer/customer-navigation';
import { useCustomerBadges } from './components/customer/use-customer-badges';
import { MobileBottomNavigation } from './components/mobile-bottom-navigation';
import { useQueueCounts } from './components/use-queue-counts';
import { BrandMark } from './components/public/brand-mark';
import {
  isCustomerCatalogPath,
  isCustomerOnlySession,
  isInstructorOnlySession,
  isPublicExperiencePath,
} from '@/lib/session-audience';
import { formatStudioName } from './lib/system-dictionary';

const accountPageLabels: Record<string, string> = {
  '/account': 'Dashboard',
  '/account/profile': 'Profil Saya',
  '/account/security': 'Keamanan akun',
  '/account/verification': 'Foto selfie',
  '/checkout': 'Checkout',
  '/orders': 'Pesanan',
  '/bookings': 'Booking',
  '/notifications': 'Notifikasi',
};

function accountPageLabelForPath(pathname: string) {
  return Object.entries(accountPageLabels)
    .sort(([left], [right]) => right.length - left.length)
    .find(
      ([href]) => pathname === href || (href !== '/account' && pathname.startsWith(`${href}/`)),
    )?.[1];
}

export function ApplicationShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const context = useSessionContext();
  const studioPreference = useStudioPreference();
  const session = context?.session;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const mobileOverlay = useOverlayPresence(mobileOpen, 'drawer');
  const profileRoot = useRef<HTMLDivElement>(null);
  const profileTrigger = useRef<HTMLButtonElement>(null);
  const currentPage = pageForPath(pathname);
  const currentPageLabel = accountPageLabelForPath(pathname) ?? currentPage?.shortLabel;
  // Halaman lintas cabang: pemilih di topbar dinonaktifkan agar tidak menyesatkan.
  const branchLocked = currentPage?.branchScope === 'global';
  const lockedBranchHint = 'Halaman ini mencakup semua cabang yang diizinkan';
  const isDetailPath = Boolean(
    currentPage && currentPage.href !== '/workspace' && pathname !== currentPage.href,
  );
  const customerOnly = isCustomerOnlySession(session);
  const instructorOnly = Boolean(!customerOnly && isInstructorOnlySession(session));
  // Instruktur hanya memilih cabang saat mengajukan ketersediaan (per cabang). Hari ini, Jadwal saya,
  // dan Payroll sudah mencakup semua cabangnya, jadi pemilih di sana hanya menyesatkan.
  const pemilihCabangInstruktur =
    (session?.branches.length ?? 0) > 1 && pathname.startsWith('/workspace/availability');
  const canViewAllBranches = Boolean(
    !instructorOnly && session?.capabilities.includes('branch:all'),
  );
  const primaryRole = session?.roles.find((role) => role !== 'CUSTOMER');
  const activeScopeLabel = context?.activeBranch
    ? context.activeBranch.name
    : canViewAllBranches
      ? 'Semua cabang'
      : session?.branches.length
        ? 'Cabang assignment'
        : 'Scope belum tersedia';
  const canViewAssignedBranches = Boolean(
    !instructorOnly && !canViewAllBranches && (session?.branches.length ?? 0) > 1,
  );
  const aggregateBranchLabel = canViewAllBranches
    ? 'Semua cabang'
    : canViewAssignedBranches
      ? 'Semua cabang assignment'
      : null;
  const branchOptions = session
    ? [
        ...(aggregateBranchLabel
          ? [
              {
                id: '__ALL_BRANCHES__',
                label: aggregateBranchLabel,
                description: 'Mode baca lintas cabang',
              },
            ]
          : []),
        ...session.branches.map((branch) => ({
          id: branch.id,
          label: branch.name,
          description: `${formatStudioName(branch.code, 'short')} · ${primaryRole ? roleLabel(primaryRole, 'short') : 'Staf'} · ${activeScopeLabel}`,
        })),
      ]
    : [];
  const commandPages = useMemo(
    () =>
      session
        ? frontendPages
            .filter((page) => !page.isDormant && canReadPage(session.capabilities, page))
            .filter((page) =>
              `${page.label} ${page.description}`
                .toLowerCase()
                .includes(commandQuery.toLowerCase()),
            )
        : [],
    [commandQuery, session],
  );
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setMobileOpen(false);
        setProfileOpen(false);
        setNotificationOpen(false);
        setCommandOpen(true);
      }
      if (event.key === 'Escape') {
        setCommandOpen(false);
        setMobileOpen(false);
        setNotificationOpen(false);
        if (profileOpen) profileTrigger.current?.focus();
        setProfileOpen(false);
      }
    };
    const outsideHandler = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!profileRoot.current?.contains(target)) setProfileOpen(false);
    };
    window.addEventListener('keydown', handler);
    window.addEventListener('pointerdown', outsideHandler);
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('pointerdown', outsideHandler);
    };
  }, [profileOpen]);
  const customerBadges = useCustomerBadges();
  const customerCatalog = customerOnly && isCustomerCatalogPath(pathname);
  // Instruktur tidak berhak atas ringkasan antrean (API menjawab 403), jadi tidak diminta.
  const queueCounts = useQueueCounts(
    Boolean(session) &&
      !customerOnly &&
      !isInstructorOnlySession(session) &&
      !isPublicExperiencePath(pathname),
  );
  if (isPublicExperiencePath(pathname) && !customerCatalog) return children;
  // Tamu atau sesi belum terautentikasi: jangan render rangka navigasi internal.
  if (!session) return children;
  if (customerOnly) {
    const approved = session?.identityVerificationStatus === 'APPROVED';
    return (
      <div className="min-h-dvh bg-dd-canvas text-dd-ink" data-customer-shell>
        <a className="skip-link" href="#main-content">
          Langsung ke konten utama
        </a>
        <CustomerNavigation
          open={mobileOpen}
          rendered={mobileOverlay.rendered}
          phase={mobileOverlay.phase}
          approved={approved}
          onClose={() => setMobileOpen(false)}
          onLogout={() => context?.logout()}
        />
        <header
          className="sticky top-0 z-30 border-b border-dd-line/80 bg-dd-surface/95 pt-[env(safe-area-inset-top)] backdrop-blur-xl"
          inert={mobileOverlay.rendered || undefined}
        >
          <div className="mx-auto flex min-h-16 w-full max-w-[1440px] items-center justify-between gap-3 px-4 sm:px-6 lg:min-h-[72px] lg:px-8">
            <div className="flex items-center gap-3">
              <IconButton
                label="Buka navigasi akun"
                variant="secondary"
                aria-controls="customer-navigation"
                onClick={() => {
                  setProfileOpen(false);
                  setNotificationOpen(false);
                  setCommandOpen(false);
                  setMobileOpen(true);
                }}
                className="rounded-dd-md border-dd-line bg-white text-dd-ink shadow-none lg:hidden"
              >
                <Menu className="size-5" />
              </IconButton>
              <BrandMark
                href="/"
                priority
                className="w-32 shrink-0 sm:w-40 xl:w-44"
                ariaLabel="Daily Dose Pilates — Kembali ke situs utama"
              />
              <nav
                aria-label="Navigasi customer"
                className="hidden min-w-0 items-center gap-1 lg:flex xl:ml-3"
              >
                {CUSTOMER_PRIMARY_NAVIGATION.map((item) => {
                  const selected = isCustomerNavigationActive(pathname, item.href);
                  const href = item.href;
                  const showOrderBadge =
                    item.href === '/orders' && customerBadges.actionableOrdersCount > 0;
                  const showBookingBadge =
                    item.href === '/bookings' && customerBadges.upcomingBookingsCount > 0;
                  return (
                    <Link
                      key={item.href}
                      href={href}
                      aria-current={!mobileOpen && selected ? 'page' : undefined}
                      aria-label={item.label}
                      className={`inline-flex min-h-11 items-center gap-1.5 rounded-dd-md px-3 text-xs font-semibold no-underline xl:text-sm ${
                        selected
                          ? 'bg-dd-forest text-white shadow-dd-soft'
                          : 'text-dd-muted hover:bg-dd-surface-muted hover:text-dd-forest'
                      }`}
                    >
                      {item.label}
                      {showOrderBadge && (
                        <span className="rounded-full bg-dd-brass px-1.5 py-0.5 text-[10px] font-bold text-white leading-none">
                          {customerBadges.actionableOrdersCount}
                        </span>
                      )}
                      {showBookingBadge && (
                        <span className="rounded-full bg-dd-success px-1.5 py-0.5 text-[10px] font-bold text-white leading-none">
                          {customerBadges.upcomingBookingsCount}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </nav>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {session?.preferredBranch && (
                <button
                  type="button"
                  onClick={() => studioPreference?.openStudioPreference()}
                  className="hidden min-h-11 max-w-44 items-center gap-1.5 truncate rounded-full border border-dd-line/80 bg-white px-2.5 py-1 text-xs font-semibold text-dd-ink shadow-2xs hover:border-dd-forest/40 md:flex sm:max-w-48 sm:rounded-dd-md sm:px-3 sm:py-2"
                >
                  <MapPin className="size-3.5 shrink-0 text-dd-forest" aria-hidden="true" />
                  <span className="truncate">{session.preferredBranch.name}</span>
                </button>
              )}
              <Link
                href="/contact"
                aria-label="Bantuan customer"
                className="hidden size-10 place-items-center rounded-dd-md border border-dd-line bg-white text-dd-muted no-underline sm:grid"
              >
                <CircleHelp className="size-[18px]" />
              </Link>
              {Boolean(session) && (
                <NotificationCenter
                  compact
                  open={notificationOpen}
                  onOpenChange={(open) => {
                    setNotificationOpen(open);
                    if (open) {
                      setProfileOpen(false);
                      setCommandOpen(false);
                    }
                  }}
                />
              )}
              <span className="hidden max-w-40 truncate text-sm font-semibold text-dd-ink xl:block">
                {session?.displayName}
              </span>
              <div className="relative" ref={profileRoot}>
                <IconButton
                  ref={profileTrigger}
                  label={`Menu profil ${session?.displayName ?? 'customer'}`}
                  variant="secondary"
                  aria-expanded={profileOpen}
                  aria-controls="customer-profile-menu"
                  onClick={() => {
                    setNotificationOpen(false);
                    setCommandOpen(false);
                    setProfileOpen((open) => !open);
                  }}
                  className="rounded-dd-md border-dd-line bg-white text-dd-ink shadow-none"
                >
                  <span className="grid size-8 place-items-center rounded-dd-md bg-dd-ink text-white">
                    <UserRound className="size-4" />
                  </span>
                </IconButton>
                {profileOpen && (
                  <div
                    id="customer-profile-menu"
                    role="region"
                    aria-label="Menu akun customer"
                    className="absolute right-0 z-[90] mt-2 w-[min(16rem,calc(100vw-2rem))] rounded-dd-lg border border-dd-line bg-white p-2 shadow-dd-float"
                  >
                    <div className="mb-2 border-b border-dd-line px-3 py-3">
                      <strong className="block truncate text-sm">
                        {session?.displayName ?? 'Akun customer'}
                      </strong>
                      <span className="mt-1 block text-xs text-dd-muted">
                        Customer · {session?.preferredBranch?.name ?? 'Studio belum dipilih'}
                      </span>
                    </div>
                    {CUSTOMER_ACCOUNT_NAVIGATION.map((item) => {
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setProfileOpen(false)}
                          aria-label={item.label}
                          className="flex min-h-11 items-center gap-2 rounded-dd-md px-3 text-sm font-semibold text-dd-ink no-underline hover:bg-dd-surface-muted"
                        >
                          <Icon className="size-4" aria-hidden="true" />
                          <span className="flex-1">{item.label}</span>
                        </Link>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => {
                        setProfileOpen(false);
                        studioPreference?.openStudioPreference();
                      }}
                      className="flex min-h-11 w-full items-center gap-2 rounded-dd-md border-0 bg-transparent px-3 text-left text-sm font-semibold text-dd-ink hover:bg-dd-surface-muted"
                    >
                      <MapPin className="size-4" aria-hidden="true" />
                      Ganti studio
                    </button>
                    <div className="mt-1 border-t border-dd-line pt-1">
                      <Link
                        href="/"
                        onClick={() => setProfileOpen(false)}
                        className="flex min-h-11 items-center gap-2 rounded-dd-md px-3 text-sm font-semibold text-dd-ink no-underline hover:bg-dd-surface-muted"
                      >
                        <House className="size-4" aria-hidden="true" />
                        Kunjungi situs utama
                      </Link>
                    </div>
                    <button
                      className="mt-1 flex min-h-11 w-full items-center rounded-dd-md border-0 bg-transparent px-3 text-sm font-semibold text-dd-danger hover:bg-dd-danger-soft"
                      onClick={() => void context?.logout()}
                    >
                      Keluar
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
          {session?.preferredBranch && (
            <button
              type="button"
              onClick={() => studioPreference?.openStudioPreference()}
              className="flex min-h-11 w-full items-center gap-1.5 rounded-none border-x-0 border-b-0 border-t border-dd-line bg-transparent px-4 py-2 text-left text-xs text-dd-muted sm:px-6 xl:hidden"
            >
              <MapPin className="size-3.5 shrink-0 text-dd-forest" aria-hidden="true" />
              Studio utama:{' '}
              <strong className="truncate text-dd-ink">{session.preferredBranch.name}</strong>
              <span className="ml-auto font-semibold text-dd-forest">Ganti</span>
            </button>
          )}
        </header>
        <div
          className={
            customerCatalog
              ? 'min-w-0 pb-20 lg:pb-0'
              : 'mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8 pb-24 lg:pb-8'
          }
          id="main-content"
          inert={mobileOverlay.rendered || undefined}
        >
          {children}
        </div>
        <MobileBottomNavigation customerOnly={true} approved={approved} />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-dd-canvas text-dd-ink lg:flex" data-admin-shell>
      <a className="skip-link" href="#main-content">
        Langsung ke konten utama
      </a>
      <AppNavigation
        mobileOpen={mobileOpen}
        mobileRendered={mobileOverlay.rendered}
        mobilePhase={mobileOverlay.phase}
        collapsed={collapsed}
        queueCounts={queueCounts}
        onClose={() => setMobileOpen(false)}
        onCollapse={() => setCollapsed((value) => !value)}
      />
      <div className="min-w-0 flex-1" inert={mobileOverlay.rendered || undefined}>
        {/* Bilah atas mengikuti mockup: nama halaman di kiri, cabang dan zona waktu di kanan.
            Pencarian halaman, notifikasi, dan menu akun tetap ada sebagai tombol ikon kecil karena
            fungsinya dipakai setiap hari, meski mockup tidak menggambarnya. */}
        <header className="sticky top-0 z-30 border-b border-dd-line bg-white pt-[env(safe-area-inset-top)]">
          {/* Bila halaman menaruh kontrolnya di bilah atas (mis. navigasi minggu timetable), chip
              zona waktu disembunyikan seperti di mockup agar kontrol itu tidak terpotong. */}
          <div className="flex min-h-[72px] items-center justify-between gap-3 px-4 py-3.5 sm:px-7 [&:has([data-topbar-override])_[data-zona-waktu]]:!hidden">
            <IconButton
              label="Buka navigasi"
              variant="secondary"
              onClick={() => {
                setProfileOpen(false);
                setNotificationOpen(false);
                setCommandOpen(false);
                setMobileOpen(true);
              }}
              className="rounded-dd-sm border-dd-line bg-white text-dd-ink shadow-none lg:hidden"
            >
              <Menu className="size-5" />
            </IconButton>
            {/* Halaman dapat menaruh kontrolnya sendiri di sini lewat TopBarSlot; nama halaman
                lalu disembunyikan supaya bilah atas tidak memuat dua judul. */}
            <div
              id={TOP_BAR_START_ID}
              className="min-w-0 flex-1 [&:has(>[data-topbar-override])>nav]:hidden"
            >
              <nav className="min-w-0 truncate text-[15px] text-dd-muted" aria-label="Breadcrumb">
                <Link href="/workspace" className="text-dd-muted no-underline hover:text-dd-ink">
                  Daily Dose
                </Link>{' '}
                {isDetailPath ? (
                  <>
                    <Link
                      href={currentPage!.href}
                      className="font-bold text-dd-ink no-underline hover:text-dd-forest"
                    >
                      {currentPageLabel}
                    </Link>
                    <span className="text-dd-muted"> · </span>
                    <span className="font-bold text-dd-ink" aria-current="page">
                      Detail
                    </span>
                  </>
                ) : (
                  <span className="font-bold text-dd-ink" aria-current="page">
                    {currentPageLabel ?? 'Beranda'}
                  </span>
                )}
              </nav>
            </div>
            <div className="flex min-w-0 items-center justify-end gap-2.5">
              {session && (!instructorOnly || pemilihCabangInstruktur) && (
                <div
                  className="!hidden md:!block"
                  title={branchLocked ? lockedBranchHint : undefined}
                >
                  <SearchSelect
                    label="Cabang aktif"
                    compact
                    prefix="Cabang:"
                    disabled={branchLocked}
                    wrapperClassName="w-[clamp(200px,20vw,250px)] [&>label]:sr-only"
                    value={branchLocked ? '' : (context?.activeBranchId ?? '')}
                    placeholder={
                      branchLocked
                        ? (aggregateBranchLabel ?? 'semua')
                        : (aggregateBranchLabel ?? 'pilih')
                    }
                    clearable={false}
                    options={branchOptions}
                    onChange={(branchId) =>
                      context?.setActiveBranchId(branchId === '__ALL_BRANCHES__' ? '' : branchId)
                    }
                  />
                </div>
              )}
              {session && (!instructorOnly || pemilihCabangInstruktur) && session.branches.length > 1 && (
                <button
                  type="button"
                  onClick={() => setMobileOpen(true)}
                  className="inline-flex md:hidden min-h-10 max-w-[130px] items-center gap-1.5 truncate rounded-full border border-dd-line/90 bg-white px-2.5 py-1 text-xs font-semibold text-dd-ink shadow-2xs hover:border-dd-forest active:bg-dd-surface-muted"
                  title="Ganti cabang bertugas"
                >
                  <MapPin className="size-3.5 shrink-0 text-dd-forest" aria-hidden="true" />
                  <span className="truncate">{context?.activeBranch?.name ?? 'Pilih cabang'}</span>
                </button>
              )}
              <span
                data-zona-waktu
                className="hidden min-h-11 items-center rounded-dd-sm border border-dd-line px-3.5 text-[15px] text-dd-muted sm:inline-flex"
              >
                {zonaWaktu(context?.activeBranch?.timezone ?? session?.branches[0]?.timezone)}
              </span>
              <IconButton
                label="Cari halaman"
                variant="ghost"
                onClick={() => {
                  setProfileOpen(false);
                  setNotificationOpen(false);
                  setCommandOpen(true);
                }}
                className="rounded-dd-sm border-transparent bg-transparent text-dd-muted shadow-none hover:bg-black/5"
              >
                <Search className="size-[18px]" />
              </IconButton>
              {session && !isInstructorOnlySession(session) && (
                <Link
                  href="/workspace/guide"
                  aria-label="Panduan operasional (SOP)"
                  title="Panduan operasional (SOP)"
                  className="grid size-11 place-items-center rounded-dd-sm text-dd-muted hover:bg-black/5 hover:text-dd-ink"
                >
                  <CircleHelp className="size-[18px]" aria-hidden="true" />
                </Link>
              )}
              {Boolean(session) && (
                <NotificationCenter
                  quiet
                  open={notificationOpen}
                  onOpenChange={(open) => {
                    setNotificationOpen(open);
                    if (open) {
                      setProfileOpen(false);
                      setCommandOpen(false);
                    }
                  }}
                />
              )}
              <div className="relative" ref={profileRoot}>
                <IconButton
                  ref={profileTrigger}
                  label={`Menu profil ${session?.displayName ?? 'internal'}`}
                  variant="secondary"
                  aria-expanded={profileOpen}
                  aria-controls="workspace-profile-menu"
                  onClick={() => {
                    setNotificationOpen(false);
                    setCommandOpen(false);
                    setProfileOpen((open) => !open);
                  }}
                  className="rounded-dd-sm border-transparent bg-transparent text-dd-muted shadow-none hover:bg-black/5"
                >
                  <UserRound className="size-[18px]" />
                </IconButton>
                {profileOpen && (
                  <div
                    id="workspace-profile-menu"
                    role="region"
                    aria-label="Menu akun internal"
                    className="absolute right-0 z-[90] mt-2 w-[min(16rem,calc(100vw-2rem))] rounded-dd-lg border border-dd-line bg-white p-2 shadow-dd-float"
                  >
                    <div className="border-b border-dd-line px-3 py-3">
                      <strong className="block truncate text-sm">
                        {session?.displayName ?? 'Akun internal'}
                      </strong>
                      <span className="mt-1 block text-xs text-dd-muted">
                        {session?.roles.map((role) => roleLabel(role, 'short')).join(' · ')}
                      </span>
                      <span className="mt-2 inline-flex rounded-full bg-dd-surface-muted px-2.5 py-1 text-[11px] font-semibold text-dd-forest">
                        {context?.activeBranch
                          ? `Operasional cabang · ${context.activeBranch.name}`
                          : canViewAllBranches
                            ? 'Baca global · Semua cabang'
                            : `Scope assignment · ${session?.branches.length ?? 0} cabang`}
                      </span>
                    </div>
                    <Link
                      href="/account/profile"
                      onClick={() => setProfileOpen(false)}
                      className="mt-2 flex items-center gap-2 rounded-dd-md px-3 py-2 text-sm font-semibold text-dd-ink no-underline hover:bg-dd-surface-muted"
                    >
                      <UserRound className="size-4" />
                      Profil Saya
                    </Link>
                    <Link
                      href={routes.security}
                      onClick={() => setProfileOpen(false)}
                      className="flex items-center gap-2 rounded-dd-md px-3 py-2 text-sm font-semibold text-dd-ink no-underline hover:bg-dd-surface-muted"
                    >
                      <ShieldCheck className="size-4" />
                      Keamanan akun
                    </Link>
                    <button
                      className="mt-1 flex min-h-11 w-full items-center rounded-dd-md border-0 bg-transparent px-3 text-sm font-semibold text-dd-danger hover:bg-dd-danger-soft"
                      onClick={() => void context?.logout()}
                    >
                      Keluar
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
          {session && (!instructorOnly || pemilihCabangInstruktur) && (
            <div
              className="border-t border-dd-line px-4 py-2 md:hidden"
              title={branchLocked ? lockedBranchHint : undefined}
            >
              <SearchSelect
                label="Cabang aktif mobile"
                compact
                disabled={branchLocked}
                wrapperClassName="[&>label]:sr-only"
                value={branchLocked ? '' : (context?.activeBranchId ?? '')}
                placeholder={
                  branchLocked
                    ? (aggregateBranchLabel ?? 'Semua cabang')
                    : (aggregateBranchLabel ?? 'Pilih cabang aktif')
                }
                clearable={false}
                options={branchOptions.map((option) => ({
                  ...option,
                  description:
                    option.id === '__ALL_BRANCHES__'
                      ? option.description
                      : session.branches.find((branch) => branch.id === option.id)?.code,
                }))}
                onChange={(branchId) =>
                  context?.setActiveBranchId(branchId === '__ALL_BRANCHES__' ? '' : branchId)
                }
              />
            </div>
          )}
        </header>
        <main
          className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8 pb-24 lg:pb-8"
          id="main-content"
        >
          <PageMetaProvider value={currentPage}>{children}</PageMetaProvider>
        </main>
        <MobileBottomNavigation
          customerOnly={false}
          queueCounts={queueCounts}
          onOpenMenu={() => setMobileOpen(true)}
        />
      </div>
      <Modal
        open={commandOpen}
        title="Pencarian halaman"
        description="Buka halaman yang tersedia sesuai capability akun Anda."
        className="max-w-2xl"
        bodyClassName="p-0 sm:p-0"
        onClose={() => setCommandOpen(false)}
      >
        <label className="flex items-center gap-3 border-b border-dd-line px-4">
          <Search className="size-5 text-dd-muted" aria-hidden="true" />
          <span className="sr-only">Cari halaman</span>
          <input
            autoFocus
            value={commandQuery}
            onChange={(event) => setCommandQuery(event.target.value)}
            placeholder="Cari halaman atau pekerjaan…"
            className="min-h-14 flex-1 border-0 bg-transparent px-0 shadow-none outline-none"
          />
        </label>
        <div className="max-h-[50vh] overflow-y-auto p-2">
          {commandPages.length ? (
            commandPages.map((page) => (
              <Link
                key={page.href}
                href={page.href}
                onClick={() => setCommandOpen(false)}
                className="block rounded-dd-md px-4 py-3 text-dd-ink no-underline hover:bg-dd-surface-muted"
              >
                <strong className="flex items-center gap-2 text-sm">
                  {page.label}
                  {page.maturity === 'preview' && <PreviewTag />}
                </strong>
                <span className="mt-1 block text-xs text-dd-muted">{page.description}</span>
              </Link>
            ))
          ) : (
            <p className="p-8 text-center text-sm text-dd-muted">
              Tidak ada halaman yang cocok atau dapat Anda akses.
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}

/** Label zona waktu cabang untuk bilah atas, mis. "Jakarta · WIB". */
function zonaWaktu(timezone?: string) {
  const peta: Record<string, string> = {
    'Asia/Jakarta': 'Jakarta · WIB',
    'Asia/Makassar': 'Makassar · WITA',
    'Asia/Jayapura': 'Jayapura · WIT',
  };
  return (timezone && peta[timezone]) ?? 'Jakarta · WIB';
}
