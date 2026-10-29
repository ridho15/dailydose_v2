'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Menu, UserRound, X } from 'lucide-react';
import { usePathname } from 'next/navigation';

import { BrandMark } from './brand-mark';
import { publicNavigation, routes } from '@/lib/routes';
import { isCustomerOnlySession } from '@/lib/session-audience';
import { useSessionContext } from '../../session-context';
import { useStudioPreference } from './public-experience';
import { useOverlayInteraction, useOverlayPresence } from '../app-feedback';
import { IconButton } from '../actions';

function isCurrent(pathname: string, hash: string, href: string) {
  if (href === '/classes#schedule')
    return (
      pathname === '/classes' ||
      pathname.startsWith('/classes/') ||
      pathname.startsWith('/schedule/')
    );
  const [target, targetHash = ''] = href.split('#');
  const route = target || '/';
  return (
    (pathname === route || (route !== '/' && pathname.startsWith(`${route}/`))) &&
    (!targetHash || hash === `#${targetHash}`)
  );
}

export type PublicChromeVariant = 'default' | 'editorial';
/** Bahasa kerangka publik. Beranda berbahasa Inggris; halaman publik lain masih Indonesia. */
export type PublicChromeLang = 'id' | 'en';

const navigasiInggris: Record<string, string> = {
  '/#about': 'About',
  '/classes#schedule': 'Classes',
  '/packages': 'Packages',
  '/locations': 'Studios',
  '/contact': 'Contact',
};

const kamusHeader = {
  id: {
    bookingKelas: 'Booking Kelas',
    lihatPaket: 'Lihat Paket',
    lihatJadwal: 'Lihat Jadwal',
    navigasi: 'Navigasi publik',
    navigasiMobile: 'Navigasi publik mobile',
    masukKeAkun: 'Masuk ke akun',
    akunSaya: 'Akun Saya',
    bukaWorkspace: 'Buka workspace',
    masuk: 'Masuk',
    stafPanel: 'Staf Panel',
    dashboardSaya: 'Dashboard Saya',
    bookingSaya: 'Booking Saya',
    paketSaya: 'Paket Saya',
    riwayatPesanan: 'Riwayat Pesanan',
    profilSaya: 'Profil Saya',
    gantiStudio: 'Ganti studio',
    workspace: 'Buka Workspace',
    keluar: 'Keluar',
    daftar: 'Daftar',
    bukaMenu: 'Buka menu navigasi',
    menuNavigasi: 'Menu navigasi',
    tutupMenu: 'Tutup menu navigasi',
    tutup: 'Tutup',
    menu: 'Menu',
  },
  en: {
    bookingKelas: 'Book a Class',
    lihatPaket: 'See Packages',
    lihatJadwal: 'See Schedule',
    navigasi: 'Main navigation',
    navigasiMobile: 'Mobile navigation',
    masukKeAkun: 'Sign in to your account',
    akunSaya: 'My Account',
    bukaWorkspace: 'Open workspace',
    masuk: 'Sign in',
    stafPanel: 'Staff Panel',
    dashboardSaya: 'My Dashboard',
    bookingSaya: 'My Bookings',
    paketSaya: 'My Packages',
    riwayatPesanan: 'Order History',
    profilSaya: 'My Profile',
    gantiStudio: 'Change studio',
    workspace: 'Open Workspace',
    keluar: 'Sign out',
    daftar: 'Sign up',
    bukaMenu: 'Open navigation menu',
    menuNavigasi: 'Navigation menu',
    tutupMenu: 'Close navigation menu',
    tutup: 'Close',
    menu: 'Menu',
  },
} as const;

// Kelas per varian. `default` mempertahankan tampilan lama persis; `editorial` mengikuti
// konsep "Editorial Calm" (datar, persegi, garis tipis, tanpa bayangan/blur).
const headerStyles = {
  default: {
    header:
      'sticky top-0 z-50 border-b border-dd-line/80 bg-dd-paper/95 pt-[env(safe-area-inset-top)] backdrop-blur-xl',
    inner:
      'mx-auto flex min-h-[72px] w-full max-w-[1440px] items-center gap-5 px-4 sm:px-6 lg:min-h-[78px] lg:px-8',
    brand: 'w-[142px] shrink-0 sm:w-40',
    navList: 'ml-auto hidden items-center gap-[clamp(1rem,1.8vw,2rem)] lg:flex',
    navLink:
      'relative inline-flex min-h-11 min-w-11 items-center justify-center whitespace-nowrap py-2 text-sm font-semibold no-underline transition-colors after:absolute after:inset-x-0 after:-bottom-1 after:h-0.5 after:origin-left after:bg-dd-forest after:transition-transform',
    navCurrent: 'text-dd-forest after:scale-x-100',
    navIdle: 'text-dd-ink after:scale-x-0 hover:text-dd-forest hover:after:scale-x-100',
    mobileAccount:
      'grid size-11 place-items-center rounded-full border border-dd-line bg-white text-dd-forest no-underline transition hover:border-dd-forest sm:hidden',
    signIn:
      'hidden min-h-11 items-center justify-center rounded-dd-sm px-3 text-sm font-bold text-dd-forest no-underline hover:bg-white sm:inline-flex',
    accountSummary:
      'flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-dd-sm border border-dd-line bg-white px-3 text-sm font-bold text-dd-forest',
    accountPanel:
      'absolute right-0 mt-2 grid w-56 gap-1 rounded-dd-lg border border-dd-line bg-white p-2 shadow-dd-float',
    menuItem:
      'flex min-h-11 items-center rounded-dd-md px-3 py-2 text-sm font-semibold text-dd-ink no-underline hover:bg-dd-surface-muted',
    menuButton:
      'flex min-h-11 items-center rounded-dd-md border-0 bg-transparent px-3 text-left text-sm font-semibold text-dd-ink hover:bg-dd-surface-muted',
    menuDivider: 'mt-1 border-t border-dd-line pt-1',
    menuLogout:
      'flex min-h-11 w-full items-center rounded-dd-md border-0 bg-transparent px-3 text-left text-sm font-semibold text-dd-danger hover:bg-dd-danger-soft',
    register:
      'hidden min-h-11 items-center justify-center rounded-dd-sm border border-dd-forest/40 bg-white px-3 text-sm font-bold text-dd-forest no-underline hover:border-dd-forest sm:inline-flex',
    primary:
      'hidden min-h-11 items-center justify-center rounded-dd-sm border border-dd-forest bg-dd-forest px-5 text-sm font-bold text-white no-underline shadow-dd-soft transition hover:-translate-y-px hover:bg-dd-forest-dark lg:inline-flex',
    overlay:
      'fixed inset-0 z-[100] bg-dd-ink/45 backdrop-blur-sm transition-opacity duration-[160ms] ease-out motion-reduce:duration-75 lg:hidden',
    panel:
      'ml-auto flex h-dvh w-[min(88vw,380px)] flex-col overflow-y-auto bg-dd-paper pb-[max(1.25rem,env(safe-area-inset-bottom))] pl-5 pr-[max(1.25rem,env(safe-area-inset-right))] pt-[max(1.25rem,env(safe-area-inset-top))] shadow-dd-float transition-transform duration-[220ms] ease-out motion-reduce:transform-none motion-reduce:duration-75',
    drawerHead: 'flex items-center justify-between gap-4 border-b border-dd-line pb-5',
    drawerBrand: 'w-36',
    mobileLink:
      'flex min-h-14 items-center justify-between border-b border-dd-line/75 text-base font-semibold no-underline',
    mobileLinkCurrent: 'text-dd-forest',
    mobileLinkIdle: 'text-dd-ink',
    mobileChevron: 'size-4 text-dd-muted',
    drawerFoot: 'mt-auto grid gap-3 border-t border-dd-line pt-5',
    mobileSecondary:
      'inline-flex min-h-12 items-center justify-center rounded-dd-sm border border-dd-line bg-white px-5 text-sm font-bold text-dd-forest no-underline',
    mobileOutline:
      'inline-flex min-h-12 items-center justify-center rounded-dd-sm border border-dd-forest/40 bg-white px-5 text-sm font-bold text-dd-forest no-underline',
    mobileSecondaryButton:
      'min-h-12 rounded-dd-sm border border-dd-line bg-white px-5 text-sm font-bold text-dd-forest',
    mobilePrimary:
      'inline-flex min-h-12 items-center justify-center rounded-dd-sm border border-dd-forest bg-dd-forest px-5 text-sm font-bold text-white no-underline shadow-dd-soft transition hover:bg-dd-forest-dark',
    mobileOutlineHover:
      'inline-flex min-h-12 items-center justify-center rounded-dd-sm border border-dd-forest/40 bg-white px-5 text-sm font-bold text-dd-forest no-underline transition hover:border-dd-forest',
    mobileLogout:
      'min-h-12 rounded-dd-sm border border-dd-danger/30 bg-white px-5 text-sm font-bold text-dd-danger transition hover:bg-dd-danger-soft',
  },
  editorial: {
    header:
      'ed-scope sticky top-0 z-50 border-b border-ed-line bg-ed-cream pt-[env(safe-area-inset-top)]',
    inner:
      'mx-auto flex min-h-[72px] w-full items-center gap-5 px-5 sm:px-8 lg:min-h-[86px] lg:px-[clamp(20px,4vw,76px)]',
    brand: 'w-[150px] shrink-0 sm:w-[190px] lg:w-[220px]',
    navList: 'ml-auto hidden items-center gap-[clamp(16px,1.8vw,28px)] lg:flex',
    navLink:
      'inline-flex min-h-11 items-center whitespace-nowrap border-b-2 py-2 text-[13px] font-semibold text-ed-ink no-underline transition-colors',
    navCurrent: 'border-ed-green',
    navIdle: 'border-transparent hover:border-ed-green',
    mobileAccount:
      'grid size-12 place-items-center border border-ed-green bg-transparent text-ed-forest no-underline transition hover:bg-ed-tint sm:hidden',
    signIn:
      'hidden min-h-11 items-center border-b-2 border-transparent text-[13px] font-semibold text-ed-ink no-underline hover:border-ed-green sm:inline-flex',
    accountSummary:
      'flex min-h-11 cursor-pointer list-none items-center gap-2 border border-ed-green px-3 text-[13px] font-bold text-ed-forest hover:bg-ed-tint',
    accountPanel: 'absolute right-0 mt-2 grid w-56 border border-ed-line bg-ed-cream p-1',
    menuItem:
      'flex min-h-11 items-center px-3 py-2 text-sm font-semibold text-ed-ink no-underline hover:bg-ed-tint',
    menuButton:
      'flex min-h-11 items-center border-0 bg-transparent px-3 text-left text-sm font-semibold text-ed-ink hover:bg-ed-tint',
    menuDivider: 'mt-1 border-t border-ed-line pt-1',
    menuLogout:
      'flex min-h-11 w-full items-center border-0 bg-transparent px-3 text-left text-sm font-semibold text-dd-danger hover:bg-dd-danger-soft',
    register:
      'hidden min-h-11 items-center border-b-2 border-transparent text-[13px] font-semibold text-ed-ink no-underline hover:border-ed-green sm:inline-flex',
    primary: 'ed-button-compact max-lg:hidden',
    overlay:
      'ed-scope fixed inset-0 z-[100] bg-ed-deep/45 transition-opacity duration-[160ms] ease-out motion-reduce:duration-75 lg:hidden',
    panel:
      'ml-auto flex h-dvh w-[min(88vw,380px)] flex-col overflow-y-auto border-l border-ed-line bg-ed-cream pb-[max(1.25rem,env(safe-area-inset-bottom))] pl-5 pr-[max(1.25rem,env(safe-area-inset-right))] pt-[max(1.25rem,env(safe-area-inset-top))] transition-transform duration-[220ms] ease-out motion-reduce:transform-none motion-reduce:duration-75',
    drawerHead: 'flex items-center justify-between gap-4 border-b border-ed-line pb-5',
    drawerBrand: 'w-[170px]',
    mobileLink:
      'flex min-h-14 items-center justify-between border-b border-ed-line text-lg font-medium tracking-tight no-underline',
    mobileLinkCurrent: 'text-ed-green',
    mobileLinkIdle: 'text-ed-ink',
    mobileChevron: 'size-4 text-ed-muted',
    drawerFoot: 'mt-auto grid gap-3 border-t border-ed-line pt-5',
    mobileSecondary:
      'inline-flex min-h-12 items-center justify-center border border-ed-line bg-transparent px-5 text-sm font-bold text-ed-forest no-underline hover:bg-ed-tint',
    mobileOutline:
      'inline-flex min-h-12 items-center justify-center border border-ed-green bg-transparent px-5 text-sm font-bold text-ed-forest no-underline hover:bg-ed-tint',
    mobileSecondaryButton:
      'min-h-12 border border-ed-line bg-transparent px-5 text-sm font-bold text-ed-forest hover:bg-ed-tint',
    mobilePrimary: 'ed-button',
    mobileOutlineHover:
      'inline-flex min-h-12 items-center justify-center border border-ed-green bg-transparent px-5 text-sm font-bold text-ed-forest no-underline hover:bg-ed-tint',
    mobileLogout:
      'min-h-12 border border-dd-danger/30 bg-transparent px-5 text-sm font-bold text-dd-danger transition hover:bg-dd-danger-soft',
  },
} as const;

export function PublicHeader({
  variant = 'default',
  lang = 'id',
}: { variant?: PublicChromeVariant; lang?: PublicChromeLang } = {}) {
  const editorial = variant === 'editorial';
  const k = kamusHeader[lang];
  const labelNav = (item: { href: string; label: string }) =>
    lang === 'en' ? (navigasiInggris[item.href] ?? item.label) : item.label;
  const t = headerStyles[variant];
  const pathname = usePathname() ?? '/';
  const sessionContext = useSessionContext();
  const session = sessionContext?.session;
  const customerOnly = isCustomerOnlySession(session);
  const studioPreference = useStudioPreference();
  const [open, setOpen] = useState(false);
  const drawer = useOverlayPresence(open, 'drawer');
  const [hash, setHash] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const update = () => setHash(window.location.hash);
    update();
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, [pathname]);

  const close = () => setOpen(false);
  useOverlayInteraction({ open, onClose: close, panelRef: drawerRef });

  const primaryCta = editorial
    ? { href: `${routes.classes}#schedule`, label: k.bookingKelas }
    : { href: routes.packages, label: k.lihatPaket };
  const secondaryCta = editorial
    ? { href: routes.packages, label: k.lihatPaket }
    : { href: `${routes.classes}#schedule`, label: k.lihatJadwal };

  return (
    <>
      <header className={t.header}>
        <div className={t.inner}>
          <BrandMark className={t.brand} priority />

          <nav className={t.navList} aria-label={k.navigasi}>
            {publicNavigation.map((item) => {
              const current = isCurrent(pathname, hash, item.href);
              return (
                <Link
                  className={`${t.navLink} ${current ? t.navCurrent : t.navIdle}`}
                  key={`${item.href}-${item.label}`}
                  href={item.href}
                  aria-current={current ? 'page' : undefined}
                >
                  {labelNav(item)}
                </Link>
              );
            })}
          </nav>

          <div
            className={`ml-auto flex shrink-0 items-center gap-2 lg:ml-2 ${editorial ? 'lg:gap-5' : ''}`}
          >
            {!session ? (
              <Link className={t.mobileAccount} href={routes.signIn} aria-label={k.masukKeAkun}>
                <UserRound className="size-5" aria-hidden="true" />
              </Link>
            ) : (
              <Link
                className={t.mobileAccount}
                href={customerOnly ? routes.account : routes.workspace}
                aria-label={customerOnly ? k.akunSaya : k.bukaWorkspace}
              >
                <UserRound className="size-5" aria-hidden="true" />
              </Link>
            )}
            {!session ? (
              <Link className={t.signIn} href={routes.signIn}>
                {k.masuk}
              </Link>
            ) : (
              <details className="relative hidden sm:block">
                <summary className={t.accountSummary}>
                  <UserRound className="size-4" /> {customerOnly ? k.akunSaya : k.stafPanel}
                </summary>
                <div className={t.accountPanel}>
                  {customerOnly ? (
                    <>
                      <Link href="/account" className={t.menuItem}>
                        {k.dashboardSaya}
                      </Link>
                      <Link href="/bookings" className={t.menuItem}>
                        {k.bookingSaya}
                      </Link>
                      <Link href="/account/packages" className={t.menuItem}>
                        {k.paketSaya}
                      </Link>
                      <Link href="/orders" className={t.menuItem}>
                        {k.riwayatPesanan}
                      </Link>
                      <Link href="/account/profile" className={t.menuItem}>
                        {k.profilSaya}
                      </Link>
                      <button
                        type="button"
                        onClick={() => studioPreference?.openStudioPreference()}
                        className={t.menuButton}
                      >
                        {k.gantiStudio}
                      </button>
                    </>
                  ) : (
                    <>
                      <Link href="/workspace" className={t.menuItem}>
                        {k.workspace}
                      </Link>
                      <Link href="/account/profile" className={t.menuItem}>
                        {k.profilSaya}
                      </Link>
                    </>
                  )}
                  <div className={t.menuDivider}>
                    <button
                      type="button"
                      onClick={() => void sessionContext?.logout()}
                      className={t.menuLogout}
                    >
                      {k.keluar}
                    </button>
                  </div>
                </div>
              </details>
            )}
            {!session && (
              <Link className={t.register} href={routes.register}>
                {k.daftar}
              </Link>
            )}
            <Link className={t.primary} href={primaryCta.href}>
              {primaryCta.label}
            </Link>
            {editorial ? (
              <button
                ref={triggerRef}
                type="button"
                aria-label={k.bukaMenu}
                aria-expanded={open}
                aria-controls="public-mobile-navigation"
                className="min-h-12 min-w-12 border border-ed-green bg-transparent px-3 text-sm font-bold text-ed-forest hover:bg-ed-tint lg:hidden"
                onClick={() => setOpen(true)}
              >
                {k.menu}
              </button>
            ) : (
              <IconButton
                ref={triggerRef}
                label={k.bukaMenu}
                variant="secondary"
                className="rounded-full border-dd-line bg-white text-dd-forest shadow-none lg:hidden"
                aria-expanded={open}
                aria-controls="public-mobile-navigation"
                onClick={() => setOpen(true)}
              >
                <Menu className="size-5" aria-hidden="true" />
              </IconButton>
            )}
          </div>
        </div>
      </header>

      {drawer.rendered && (
        <div
          data-navigation-overlay-phase={drawer.phase}
          className={`${t.overlay} ${drawer.visible ? 'opacity-100' : 'opacity-0'}`}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) close();
          }}
        >
          <div
            ref={drawerRef}
            id="public-mobile-navigation"
            className={`${t.panel} ${drawer.visible ? 'translate-x-0' : 'translate-x-full'}`}
            role="dialog"
            aria-modal="true"
            aria-label={k.menuNavigasi}
          >
            <div className={t.drawerHead}>
              <BrandMark className={t.drawerBrand} />
              {editorial ? (
                <button
                  type="button"
                  aria-label={k.tutupMenu}
                  className="min-h-12 min-w-12 border border-ed-green bg-transparent px-3 text-sm font-bold text-ed-forest hover:bg-ed-tint"
                  onClick={() => {
                    close();
                    triggerRef.current?.focus();
                  }}
                >
                  {k.tutup}
                </button>
              ) : (
                <IconButton
                  label={k.tutupMenu}
                  variant="secondary"
                  className="rounded-full border-dd-line bg-white text-dd-forest shadow-none"
                  onClick={() => {
                    close();
                    triggerRef.current?.focus();
                  }}
                >
                  <X className="size-5" aria-hidden="true" />
                </IconButton>
              )}
            </div>

            <nav className="grid py-6" aria-label={k.navigasiMobile}>
              {publicNavigation.map((item) => {
                const current = isCurrent(pathname, hash, item.href);
                return (
                  <Link
                    className={`${t.mobileLink} ${current ? t.mobileLinkCurrent : t.mobileLinkIdle}`}
                    key={`${item.href}-${item.label}-mobile`}
                    href={item.href}
                    aria-current={current ? 'page' : undefined}
                    onClick={close}
                  >
                    <span>{labelNav(item)}</span>
                    <ChevronRight className={t.mobileChevron} aria-hidden="true" />
                  </Link>
                );
              })}
            </nav>

            <div className={t.drawerFoot}>
              {!session && (
                <>
                  <Link className={t.mobileSecondary} href={routes.signIn} onClick={close}>
                    {k.masuk}
                  </Link>
                  <Link className={t.mobileOutline} href={routes.register} onClick={close}>
                    {k.daftar}
                  </Link>
                </>
              )}
              {session && customerOnly ? (
                <>
                  <Link className={t.mobileSecondary} href="/account" onClick={close}>
                    {k.dashboardSaya}
                  </Link>
                  <Link className={t.mobileSecondary} href="/bookings" onClick={close}>
                    {k.bookingSaya}
                  </Link>
                  <Link className={t.mobileSecondary} href="/account/packages" onClick={close}>
                    {k.paketSaya}
                  </Link>
                  <button
                    type="button"
                    className={t.mobileSecondaryButton}
                    onClick={() => {
                      close();
                      studioPreference?.openStudioPreference();
                    }}
                  >
                    {k.gantiStudio}
                  </button>
                </>
              ) : session ? (
                <Link className={t.mobileSecondary} href="/workspace" onClick={close}>
                  {k.workspace}
                </Link>
              ) : null}
              <Link className={t.mobilePrimary} href={primaryCta.href} onClick={close}>
                {primaryCta.label}
              </Link>
              <Link className={t.mobileOutlineHover} href={secondaryCta.href} onClick={close}>
                {secondaryCta.label}
              </Link>
              {session && (
                <button
                  type="button"
                  className={t.mobileLogout}
                  onClick={() => void sessionContext?.logout()}
                >
                  {k.keluar}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
