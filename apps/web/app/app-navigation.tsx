'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  BookOpenCheck,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  CreditCard,
  ListChecks,
  ShieldCheck,
  Sliders,
  Users,
  X,
} from 'lucide-react';
import { frontendPageGroups, frontendPages } from '@/lib/frontend-pages';
import { PreviewTag } from './components/admin/preview-tag';
import {
  isCustomerOnlySession,
  isFrontDeskOnlySession,
  isInstructorOnlySession,
} from '@/lib/session-audience';
import { useSessionContext } from './session-context';
import { BrandMark } from './components/public/brand-mark';
import { useOverlayInteraction, type OverlayPhase } from './components/app-feedback';
import { IconButton } from './components/actions';
import { iconForPage } from './lib/page-icons';
import { roleLabel } from './lib/role-labels';
import type { QueueCounts } from './components/use-queue-counts';

/** Instruktur cukup melihat empat menu ini; halaman lain tetap tertutup oleh izinnya masing-masing. */
export const MENU_INSTRUKTUR = [
  '/workspace',
  '/workspace/classes',
  '/workspace/availability',
  '/workspace/payroll',
];

/** Label badge di samping logo: peran tertinggi akun, bukan sekadar "Staf". */
export function badgePeran(roles: readonly string[] | undefined, instructorOnly: boolean): string {
  if (instructorOnly) return 'Instruktur';
  if (roles?.includes('SUPER_OWNER')) return 'Super Owner';
  if (roles?.includes('OWNER')) return 'Owner';
  if (roles?.includes('MANAGER')) return 'Manager';
  if (roles?.includes('FINANCE')) return 'Finance';
  return 'Staf';
}

export function AppNavigation({
  mobileOpen = false,
  mobileRendered = false,
  mobilePhase = 'exiting',
  collapsed = false,
  queueCounts = {},
  onClose,
  onCollapse,
}: {
  mobileOpen?: boolean;
  mobileRendered?: boolean;
  mobilePhase?: OverlayPhase;
  collapsed?: boolean;
  queueCounts?: QueueCounts;
  onClose?(): void;
  onCollapse?(): void;
}) {
  const pathname = usePathname();
  const context = useSessionContext();
  const session = context?.session;
  const activeHref = [...frontendPages]
    .sort((left, right) => right.href.length - left.href.length)
    .find(
      (item) =>
        pathname === item.href ||
        (item.href !== '/workspace' && Boolean(pathname?.startsWith(`${item.href}/`))),
    )?.href;
  const [mobileViewport, setMobileViewport] = useState<boolean | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const customerOnly = isCustomerOnlySession(session);
  const instructorOnly = !customerOnly && isInstructorOnlySession(session);
  const advancedPages = frontendPages
    .filter((item) => item.isAdvanced && !item.isDormant && !item.hideFromNav && !instructorOnly)
    .filter(
      (item) => item.capabilities.length === 0 || context?.hasCapability(...item.capabilities),
    )
    .sort((a, b) => a.priority - b.priority);

  const isCurrentInAdvanced = advancedPages.some((item) => item.href === activeHref);
  const showAdvanced = advancedOpen || isCurrentInAdvanced;

  // Beranda staf: meja depan dan instruktur melihat "Hari ini", Owner melihat ringkasan bulanannya.
  const berandaLabel =
    instructorOnly || isFrontDeskOnlySession(session)
      ? 'Hari ini'
      : session?.roles.some((role) => role === 'SUPER_OWNER' || role === 'OWNER')
        ? 'Beranda'
        : 'Dashboard';
  const customerLinks = [
    { href: '/classes', label: 'Jadwal', icon: CalendarDays },
    ...(session?.identityVerificationStatus === 'APPROVED'
      ? [{ href: '/bookings', label: 'Booking Saya', icon: BookOpenCheck }]
      : []),
    { href: '/packages', label: 'Paket', icon: ListChecks },
    ...(session?.identityVerificationStatus === 'APPROVED'
      ? [
          { href: '/orders', label: 'Pesanan', icon: CreditCard },
          { href: '/account/packages', label: 'Paket Saya', icon: CircleDollarSign },
        ]
      : []),
    { href: '/account/verification', label: 'Verifikasi', icon: ShieldCheck },
    { href: '/account/profile', label: 'Profil Saya', icon: Users },
    { href: '/account', label: 'Akun Saya', icon: Users },
  ];
  const navigationRef = useRef<HTMLElement>(null);
  const mobileVisible = mobilePhase === 'open';
  const mobileClosed = mobileViewport === true && !mobileRendered;
  const navClass = `fixed inset-y-0 left-0 z-50 flex w-[min(320px,88vw)] flex-col border-r border-dd-line bg-white text-dd-ink shadow-dd-float transition-transform duration-[220ms] ease-out motion-reduce:transform-none motion-reduce:duration-75 lg:sticky lg:top-0 lg:shadow-none lg:h-dvh lg:translate-x-0 lg:visible lg:pointer-events-auto ${mobileVisible ? 'translate-x-0 visible' : '-translate-x-full'} ${mobileRendered ? 'pointer-events-auto' : 'invisible pointer-events-none'} ${!customerOnly && collapsed ? 'lg:w-[84px]' : 'lg:w-[260px]'}`;

  useOverlayInteraction({
    open: mobileOpen,
    onClose: () => onClose?.(),
    panelRef: navigationRef,
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      setMobileViewport(false);
      return;
    }
    const query = window.matchMedia('(max-width: 1023px)');
    const update = () => setMobileViewport(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const linkClass = (active: boolean) =>
    `group flex min-h-11 items-center gap-2.5 rounded-dd-sm px-2.5 text-[15px] transition [&_svg]:shrink-0 ${
      active
        ? 'bg-dd-success-soft font-bold text-dd-forest'
        : 'font-medium text-dd-ink hover:bg-black/5 [&_svg]:text-dd-muted'
    }`;

  return (
    <>
      {mobileRendered && (
        <div
          aria-hidden="true"
          className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-[160ms] ease-out motion-reduce:duration-75 lg:hidden ${mobileVisible ? 'opacity-100' : 'opacity-0'}`}
          onMouseDown={() => onClose?.()}
        />
      )}
      <nav
        ref={navigationRef}
        id={customerOnly ? 'customer-navigation' : 'workspace-navigation'}
        className={navClass}
        aria-label="Navigasi utama"
        aria-hidden={mobileClosed || undefined}
        aria-modal={mobileViewport === true && mobileRendered ? 'true' : undefined}
        role={mobileViewport === true && mobileRendered ? 'dialog' : undefined}
        inert={mobileClosed || undefined}
        data-overlay-phase={mobileRendered ? mobilePhase : undefined}
      >
        <div
          className={`flex items-center gap-2.5 pl-[max(1.5rem,env(safe-area-inset-left))] pr-4 pb-2 pt-[max(1.25rem,env(safe-area-inset-top))] ${collapsed ? 'lg:justify-center lg:px-2' : 'justify-between'}`}
        >
          <div className={`flex min-w-0 items-center gap-2.5 ${collapsed ? 'lg:w-10 lg:overflow-hidden' : ''}`}>
            <BrandMark
              ariaLabel={`Daily Dose Pilates — ${customerOnly ? 'Dashboard Saya' : 'Dashboard'}`}
              tone="default"
              className="h-auto w-[118px] shrink-0"
              href={customerOnly ? '/account' : '/workspace'}
              priority
            />
            {!collapsed && !customerOnly && (
              <span className="shrink-0 rounded-[5px] bg-dd-ink px-2 py-[3px] text-xs font-bold text-white">
                {badgePeran(session?.roles, instructorOnly)}
              </span>
            )}
          </div>
          <IconButton
            label="Tutup navigasi"
            variant="ghost"
            onClick={onClose}
            className="rounded-full border-dd-line bg-transparent text-dd-ink hover:bg-black/5 lg:hidden"
          >
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="workspace-navigation-scroll min-h-0 flex-1 space-y-[22px] overflow-x-hidden overflow-y-auto px-4 pb-5 pt-4">
          {customerOnly ? (
            <section className="space-y-1" aria-labelledby="nav-customer">
              <h2 id="nav-customer" className="mb-1 px-2 text-[13px] font-bold text-dd-muted">
                Akun Saya
              </h2>
              {customerLinks.map((item) => {
                const active =
                  pathname === item.href ||
                  (item.href !== '/account' && Boolean(pathname?.startsWith(`${item.href}/`)));
                const Icon = item.icon;
                return (
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    key={item.href}
                    onClick={onClose}
                    className={linkClass(active)}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </section>
          ) : (
            <>
              {!customerOnly && session && session.branches.length > 1 && !collapsed && (
                <div className="mb-3 rounded-dd-md border border-dd-line/80 bg-dd-surface p-2.5 lg:hidden">
                  <label
                    htmlFor="mobile-nav-branch"
                    className="mb-1 block text-xs font-bold text-dd-muted uppercase tracking-wider"
                  >
                    Cabang Bertugas
                  </label>
                  <select
                    id="mobile-nav-branch"
                    aria-label="Pilih cabang bertugas"
                    value={context?.activeBranchId ?? ''}
                    onChange={(e) => {
                      context?.setActiveBranchId(e.target.value);
                      onClose?.();
                    }}
                    className="w-full min-h-10 rounded-dd-sm border border-dd-line bg-white px-2.5 py-1 text-sm font-semibold text-dd-ink shadow-2xs focus:border-dd-forest focus:outline-none"
                  >
                    <option value="">-- Pilih Cabang --</option>
                    {session.branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {frontendPageGroups.map((group) => {
                const pagesInGroup = frontendPages
                  .filter((item) => item.group === group)
                  .filter((item) => !item.isDormant && !item.isAdvanced && !item.hideFromNav)
                  .filter((item) => !instructorOnly || MENU_INSTRUKTUR.includes(item.href))
                  .filter(
                    (item) =>
                      item.capabilities.length === 0 ||
                      context?.hasCapability(...item.capabilities),
                  )
                  .sort((a, b) => a.priority - b.priority);

                if (pagesInGroup.length === 0) return null;

                return (
                  <section
                    className="space-y-1"
                    aria-labelledby={`nav-${group}`}
                    key={group}
                  >
                    {!collapsed && (
                      <h2
                        id={`nav-${group}`}
                        className="mb-1 px-2 text-[13px] font-bold text-dd-muted"
                      >
                        {group}
                      </h2>
                    )}
                    {pagesInGroup.map((item) => {
                      const active = item.href === activeHref;
                      const Icon = iconForPage(item.href);
                      const displayLabel =
                        item.href === '/workspace'
                          ? berandaLabel
                          : instructorOnly && item.href === '/workspace/classes'
                            ? 'Jadwal Saya'
                            : item.shortLabel;
                      return (
                        <Link
                          href={item.href}
                          aria-current={active ? 'page' : undefined}
                          key={item.href}
                          title={
                            collapsed
                              ? `${displayLabel}${item.queueBadgeSource && (queueCounts[item.queueBadgeSource] ?? 0) > 0 ? ` (${queueCounts[item.queueBadgeSource]})` : ''}`
                              : undefined
                          }
                          onClick={onClose}
                          className={linkClass(active)}
                        >
                          <div className="relative shrink-0">
                            <Icon className="size-[18px]" aria-hidden="true" />
                            {collapsed &&
                              item.queueBadgeSource &&
                              (queueCounts[item.queueBadgeSource] ?? 0) > 0 && (
                                <span
                                  aria-label={`${queueCounts[item.queueBadgeSource]} antrean`}
                                  className="absolute -top-1 -right-1 size-2.5 rounded-full bg-dd-danger ring-2 ring-white"
                                />
                              )}
                          </div>
                          {!collapsed && <span className="truncate">{displayLabel}</span>}
                          {!collapsed && item.maturity === 'preview' && <PreviewTag tone="light" />}
                          {!collapsed &&
                            item.queueBadgeSource &&
                            (queueCounts[item.queueBadgeSource] ?? 0) > 0 && (
                              <span className="ml-auto rounded-full bg-dd-danger px-2 py-0.5 text-[13px] font-bold text-white">
                                {queueCounts[item.queueBadgeSource]}
                              </span>
                            )}
                        </Link>
                      );
                    })}
                  </section>
                );
              })}

              {advancedPages.length > 0 && (
                <section
                  className="pt-3 border-t border-dd-line/60 space-y-1"
                  aria-label="Alat dan sistem lanjutan"
                >
                  {!collapsed ? (
                    <button
                      type="button"
                      onClick={() => setAdvancedOpen((prev) => !prev)}
                      className="flex min-h-[44px] w-full items-center justify-between px-3 py-2 text-[13px] font-bold text-[#4b5563] hover:text-dd-ink transition cursor-pointer"
                      aria-expanded={showAdvanced}
                    >
                      <span className="flex items-center gap-2">
                        <Sliders className="size-3.5" />
                        <span>Alat & Sistem Lanjutan</span>
                      </span>
                      <ChevronDown
                        className={`size-3.5 transition-transform duration-200 ${showAdvanced ? 'rotate-180' : ''}`}
                      />
                    </button>
                  ) : (
                    <div className="my-1 border-t border-dd-line/60" />
                  )}

                  {(collapsed || showAdvanced) && (
                    <div className="space-y-1">
                      {advancedPages.map((item) => {
                        const active = item.href === activeHref;
                        const Icon = iconForPage(item.href);
                        return (
                          <Link
                            href={item.href}
                            aria-current={active ? 'page' : undefined}
                            key={item.href}
                            title={
                              collapsed
                                ? `${item.shortLabel}${item.queueBadgeSource && (queueCounts[item.queueBadgeSource] ?? 0) > 0 ? ` (${queueCounts[item.queueBadgeSource]})` : ''}`
                                : undefined
                            }
                            onClick={onClose}
                            className={linkClass(active)}
                          >
                            <div className="relative shrink-0">
                              <Icon className="size-[18px]" aria-hidden="true" />
                              {collapsed &&
                                item.queueBadgeSource &&
                                (queueCounts[item.queueBadgeSource] ?? 0) > 0 && (
                                  <span
                                    aria-label={`${queueCounts[item.queueBadgeSource]} antrean`}
                                    className="absolute -top-1 -right-1 size-2.5 rounded-full bg-dd-danger ring-2 ring-white"
                                  />
                                )}
                            </div>
                            {!collapsed && <span className="truncate">{item.shortLabel}</span>}
                            {!collapsed && item.maturity === 'preview' && (
                              <PreviewTag tone="light" />
                            )}
                            {!collapsed &&
                              item.queueBadgeSource &&
                              (queueCounts[item.queueBadgeSource] ?? 0) > 0 && (
                                <span className="ml-auto rounded-full bg-dd-danger px-2 py-0.5 text-[13px] font-bold text-white">
                                  {queueCounts[item.queueBadgeSource]}
                                </span>
                              )}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </section>
              )}
            </>
          )}
        </div>
        {!customerOnly && session && (
          <div className="mx-4 mb-[max(1.25rem,env(safe-area-inset-bottom))] flex items-center gap-2.5 border-t border-dd-line pt-3.5">
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-dd-sm bg-dd-success-soft text-sm font-bold text-dd-forest"
            >
              {initials(session.displayName)}
            </span>
            {!collapsed && (
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-bold text-dd-ink">
                  {session.displayName}
                </span>
                <span className="block truncate text-[13px] text-dd-muted">
                  {roleLabel(session.roles[0])} ·{' '}
                  {instructorOnly && session.branches.length > 1
                    ? `${session.branches.length} cabang`
                    : (context?.activeBranch?.name ?? 'semua cabang')}
                </span>
              </span>
            )}
          </div>
        )}
      </nav>
    </>
  );
}

/** Dua huruf awal nama untuk kartu pengguna; satu huruf bila namanya satu kata. */
function initials(nama: string) {
  const kata = nama.trim().split(/\s+/).filter(Boolean);
  const huruf = kata.length > 1 ? `${kata[0]![0]}${kata[kata.length - 1]![0]}` : (kata[0] ?? '?').slice(0, 2);
  return huruf.toUpperCase();
}
