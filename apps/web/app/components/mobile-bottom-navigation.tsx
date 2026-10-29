'use client';

import {
  BookOpenCheck,
  CalendarClock,
  CalendarDays,
  CreditCard,
  HandCoins,
  House,
  Landmark,
  LayoutDashboard,
  ListChecks,
  LockKeyhole,
  Menu,
  UserRound,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { frontendPages } from '@/lib/frontend-pages';
import { isInstructorOnlySession } from '@/lib/session-audience';
import { useSessionContext } from '../session-context';
import { useCustomerBadges } from './customer/use-customer-badges';
import { isCustomerTabActive } from './customer/customer-navigation';

/** Urutan prioritas tab staf; hanya halaman yang boleh dibuka akun yang tampil (maks. 4). */
const MAX_STAFF_TABS = 4;
const staffTabCandidates = [
  { href: '/workspace', label: 'Beranda', icon: LayoutDashboard, badgeColor: 'bg-dd-forest' },
  {
    href: '/workspace/bookings',
    label: 'Booking',
    icon: BookOpenCheck,
    badgeColor: 'bg-dd-forest',
  },
  { href: '/workspace/payments', label: 'Pembayaran', icon: CreditCard, badgeColor: 'bg-dd-brass' },
  { href: '/workspace/classes', label: 'Kelas', icon: CalendarDays, badgeColor: 'bg-dd-forest' },
  { href: '/finance', label: 'Keuangan', icon: Landmark, badgeColor: 'bg-dd-brass' },
  {
    href: '/ledger/adjustments',
    label: 'Penyesuaian',
    icon: ListChecks,
    badgeColor: 'bg-dd-brass',
  },
];

export interface MobileBottomNavigationProps {
  customerOnly: boolean;
  approved?: boolean;
  onOpenMenu?(): void;
  queueCounts?: Record<string, number>;
}

export function MobileBottomNavigation({
  customerOnly,
  approved = true,
  onOpenMenu,
  queueCounts = {},
}: MobileBottomNavigationProps) {
  const pathname = usePathname();
  const customerBadges = useCustomerBadges();
  const context = useSessionContext();

  if (customerOnly) {
    const tabs = [
      { href: '/account', label: 'Beranda', icon: House },
      { href: '/classes', label: 'Jadwal', icon: CalendarDays },
      {
        href: '/bookings',
        label: 'Booking',
        icon: BookOpenCheck,
        badge: customerBadges.upcomingBookingsCount,
        badgeColor: 'bg-dd-forest',
      },
      { href: '/packages', label: 'Paket', icon: ListChecks },
      {
        href: '/account/profile',
        label: 'Akun',
        icon: UserRound,
        badge: customerBadges.actionableOrdersCount,
        badgeColor: 'bg-dd-brass',
        dot: customerBadges.verificationActionRequired,
      },
    ];

    return (
      <nav
        aria-label="Navigasi Bawah Mobile"
        className="fixed bottom-0 inset-x-0 z-40 lg:hidden border-t border-dd-line/80 bg-white/95 backdrop-blur-xl shadow-[0_-4px_20px_rgba(0,0,0,0.06)] pb-[env(safe-area-inset-bottom)]"
      >
        <div className="grid grid-cols-5 items-stretch h-[68px] max-w-lg mx-auto px-1">
          {tabs.map((tab) => {
            const active = isCustomerTabActive(pathname, tab.href);
            const href = tab.href;
            const Icon = tab.icon;

            return (
              <Link
                key={tab.href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`relative flex flex-col items-center justify-center h-full py-1 px-0.5 text-[12px] font-semibold transition-all select-none ${
                  active
                    ? 'text-[#396552]'
                    : 'text-dd-muted hover:text-[#396552] hover:bg-dd-surface-muted/50'
                }`}
              >
                {/* Indikator garis atas 3 px saat aktif */}
                <span
                  className={`absolute top-0 inset-x-2 h-[3px] rounded-full transition-colors ${
                    active ? 'bg-[#396552]' : 'bg-transparent'
                  }`}
                  aria-hidden="true"
                />
                <div className="relative shrink-0 mb-1">
                  <Icon
                    className={`size-5 transition-transform ${active ? 'scale-105 stroke-[2.2]' : 'stroke-[1.8]'}`}
                    aria-hidden="true"
                  />
                  {tab.badge && tab.badge > 0 ? (
                    <span
                      className={`absolute -top-1.5 -right-2.5 grid min-h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-bold text-white leading-none shadow-xs ${tab.badgeColor}`}
                    >
                      {tab.badge > 99 ? '99+' : tab.badge}
                    </span>
                  ) : tab.dot ? (
                    <span
                      className="absolute -top-0.5 -right-1 size-2 rounded-full bg-dd-brass ring-1 ring-white"
                      aria-label="Perlu tindakan"
                    />
                  ) : null}
                </div>
                <span className="truncate max-w-full tracking-tight text-center leading-none text-[12px]">
                  {tab.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    );
  }

  // Navigasi Bawah Instruktur: sama dengan menu samping. QR ada di atas beranda, akun di menu profil.
  if (isInstructorOnlySession(context?.session)) {
    const instructorTabs = [
      { href: '/workspace', label: 'Hari Ini', icon: House },
      { href: '/workspace/classes', label: 'Jadwal Saya', icon: CalendarDays },
      { href: '/workspace/availability', label: 'Ketersediaan', icon: CalendarClock },
      { href: '/workspace/payroll', label: 'Payroll', icon: HandCoins },
    ];

    const isTabActive = (href: string) => {
      if (href === '/workspace') {
        return pathname === '/workspace';
      }
      return pathname === href || pathname.startsWith(`${href}/`);
    };

    return (
      <nav
        aria-label="Navigasi Bawah Instruktur"
        className="fixed bottom-0 inset-x-0 z-40 lg:hidden border-t border-dd-line/80 bg-white/95 backdrop-blur-xl shadow-[0_-4px_20px_rgba(0,0,0,0.06)] pb-[env(safe-area-inset-bottom)]"
      >
        <div className="grid grid-cols-4 items-stretch h-[68px] max-w-lg mx-auto px-1">
          {instructorTabs.map((tab) => {
            const active = isTabActive(tab.href);
            const href = tab.href;
            const Icon = tab.icon;

            return (
              <Link
                key={tab.href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`relative flex flex-col items-center justify-center h-full py-1 px-0.5 text-[12px] font-semibold transition-all select-none ${
                  active
                    ? 'text-[#396552]'
                    : 'text-dd-muted hover:text-[#396552] hover:bg-dd-surface-muted/50'
                }`}
              >
                {/* Indikator garis atas 3 px saat aktif */}
                <span
                  className={`absolute top-0 inset-x-2 h-[3px] rounded-full transition-colors ${
                    active ? 'bg-[#396552]' : 'bg-transparent'
                  }`}
                  aria-hidden="true"
                />
                <div className="relative shrink-0 mb-1">
                  <Icon
                    className={`size-5 transition-transform ${active ? 'scale-105 stroke-[2.2]' : 'stroke-[1.8]'}`}
                    aria-hidden="true"
                  />
                </div>
                <span className="truncate max-w-full tracking-tight text-center leading-none text-[12px]">
                  {tab.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    );
  }

  // Workspace / Staff Mobile Navigation: tab mengikuti hak akses akun, bukan daftar tetap.
  const allowed = (href: string) => {
    const page = frontendPages.find((item) => item.href === href);
    return Boolean(
      page && (page.capabilities.length === 0 || context?.hasCapability(...page.capabilities)),
    );
  };
  const badgeFor = (href: string) => {
    const source = frontendPages.find((item) => item.href === href)?.queueBadgeSource;
    return source ? (queueCounts[source] ?? 0) : 0;
  };
  const staffTabs = staffTabCandidates
    .filter((tab) => allowed(tab.href))
    .slice(0, MAX_STAFF_TABS)
    .map((tab) => ({ ...tab, badge: badgeFor(tab.href) }));
  const tabHrefs = new Set(staffTabs.map((tab) => tab.href));
  const hasAnyOtherQueue = frontendPages.some(
    (page) =>
      page.queueBadgeSource &&
      !tabHrefs.has(page.href) &&
      allowed(page.href) &&
      (queueCounts[page.queueBadgeSource] ?? 0) > 0,
  );

  return (
    <nav
      aria-label="Navigasi Bawah Workspace"
      className="fixed bottom-0 inset-x-0 z-40 lg:hidden border-t border-dd-line/80 bg-white/95 backdrop-blur-xl shadow-[0_-4px_20px_rgba(0,0,0,0.06)] pb-[max(0.6rem,env(safe-area-inset-bottom))] pt-1.5 px-2"
    >
      <div
        className="grid items-center justify-around gap-1 max-w-lg mx-auto"
        style={{ gridTemplateColumns: `repeat(${staffTabs.length + 1}, minmax(0, 1fr))` }}
      >
        {staffTabs.map((tab) => {
          const active =
            pathname === tab.href ||
            (tab.href !== '/workspace' && pathname.startsWith(`${tab.href}/`));
          const Icon = tab.icon;

          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-col items-center justify-center min-h-[48px] py-1 px-1 rounded-dd-md text-[13px] font-semibold transition-all select-none focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#09371f] ${
                active
                  ? 'text-dd-forest font-bold bg-dd-forest/8'
                  : 'text-dd-muted hover:text-dd-forest hover:bg-dd-surface-muted/60'
              }`}
            >
              <div className="relative shrink-0 mb-0.5">
                <Icon
                  className={`size-5 transition-transform ${active ? 'scale-110 stroke-[2.2]' : 'stroke-[1.8]'}`}
                  aria-hidden="true"
                />
                {tab.badge > 0 ? (
                  <span
                    aria-label={`${tab.badge} antrean`}
                    className={`absolute -top-1.5 -right-2.5 grid min-h-4 min-w-4 place-items-center rounded-full px-1 text-[13px] font-bold text-white leading-none shadow-xs ${tab.badgeColor}`}
                  >
                    {tab.badge > 99 ? '99+' : tab.badge}
                  </span>
                ) : null}
              </div>
              <span className="truncate max-w-[64px] tracking-tight">{tab.label}</span>
              {active && (
                <span className="w-4 h-0.5 mt-0.5 rounded-full bg-dd-forest" aria-hidden="true" />
              )}
            </Link>
          );
        })}

        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Buka semua menu navigasi"
          className="flex flex-col items-center justify-center min-h-[48px] py-1 px-1 rounded-dd-md text-[13px] font-semibold text-dd-muted hover:text-dd-forest hover:bg-dd-surface-muted/60 transition-all select-none focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#09371f]"
        >
          <div className="relative shrink-0 mb-0.5">
            <Menu className="size-5 stroke-[1.8]" aria-hidden="true" />
            {hasAnyOtherQueue && (
              <span
                className="absolute -top-1 -right-1 size-2 rounded-full bg-dd-brass ring-2 ring-white"
                aria-label="Ada antrean baru di menu lain"
              />
            )}
          </div>
          <span className="truncate max-w-[64px] tracking-tight">Menu</span>
        </button>
      </div>
    </nav>
  );
}
