'use client';

import {
  BookOpenCheck,
  CalendarDays,
  CreditCard,
  Gauge,
  House,
  ListChecks,
  LockKeyhole,
  LogOut,
  MapPin,
  PackageCheck,
  ShieldCheck,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRef } from 'react';
import { IconButton } from '../actions';
import { useOverlayInteraction, type OverlayPhase } from '../app-feedback';
import { BrandMark } from '../public/brand-mark';
import { useStudioPreference } from '../public/public-experience';

import { useCustomerBadges } from './use-customer-badges';

export type CustomerNavigationItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  requiresApproval?: boolean;
};

export const CUSTOMER_PRIMARY_NAVIGATION: CustomerNavigationItem[] = [
  { href: '/account', label: 'Beranda', icon: House },
  { href: '/classes', label: 'Jadwal', icon: CalendarDays },
  { href: '/bookings', label: 'Booking', icon: BookOpenCheck },
  { href: '/packages', label: 'Paket', icon: ListChecks },
];

export const CUSTOMER_ACCOUNT_NAVIGATION: CustomerNavigationItem[] = [
  { href: '/account/profile', label: 'Profil Saya', icon: UserRound },
  { href: '/account/verification', label: 'Foto selfie', icon: ShieldCheck },
  { href: '/account/security', label: 'Keamanan & Password', icon: LockKeyhole },
  { href: '/orders', label: 'Pesanan Saya', icon: CreditCard },
  { href: '/account/packages', label: 'Paket Saya', icon: PackageCheck },
];

export function isCustomerNavigationActive(pathname: string, href: string) {
  if (href === '/account') return pathname === '/account';
  if (href === '/orders') return pathname === '/checkout' || pathname.startsWith('/orders');
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function isCustomerTabActive(pathname: string, href: string) {
  if (href === '/account') return pathname === '/account';
  if (href === '/account/profile') {
    return (
      pathname === '/account/profile' ||
      (pathname.startsWith('/account/') && pathname !== '/account') ||
      pathname === '/orders' ||
      pathname.startsWith('/orders/') ||
      pathname === '/checkout' ||
      pathname.startsWith('/checkout/') ||
      pathname === '/check-in-pass'
    );
  }
  return isCustomerNavigationActive(pathname, href);
}

function navigationHref(item: CustomerNavigationItem, _approved: boolean) {
  return item.href;
}

export function CustomerNavigation({
  open,
  rendered,
  phase,
  approved,
  onClose,
  onLogout,
}: {
  open: boolean;
  rendered: boolean;
  phase: OverlayPhase;
  approved: boolean;
  onClose(): void;
  onLogout(): void | Promise<void>;
}) {
  const pathname = usePathname();
  const studioPreference = useStudioPreference();
  const badges = useCustomerBadges();
  const panel = useRef<HTMLElement>(null);
  useOverlayInteraction({ open, onClose, panelRef: panel });
  const visible = phase === 'open';

  return (
    <>
      {rendered && (
        <div
          aria-hidden="true"
          className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-xs transition-opacity duration-[160ms] ease-out motion-reduce:duration-75 lg:hidden ${visible ? 'opacity-100' : 'opacity-0'}`}
          onMouseDown={onClose}
        />
      )}
      <nav
        ref={panel}
        id="customer-navigation"
        aria-label="Navigasi akun"
        aria-hidden={!rendered}
        aria-modal={rendered ? 'true' : undefined}
        inert={!rendered}
        role={rendered ? 'dialog' : undefined}
        data-overlay-phase={rendered ? phase : undefined}
        className={`fixed inset-y-0 left-0 z-50 flex w-[min(320px,88vw)] flex-col bg-white border-r border-dd-line pb-[max(1.25rem,env(safe-area-inset-bottom))] pl-[max(1.25rem,env(safe-area-inset-left))] pr-5 pt-[max(1.25rem,env(safe-area-inset-top))] text-dd-ink shadow-dd-float transition-transform duration-[220ms] ease-out motion-reduce:transform-none motion-reduce:duration-75 lg:hidden ${
          visible ? 'translate-x-0 visible' : '-translate-x-full'
        } ${rendered ? 'pointer-events-auto' : 'invisible pointer-events-none'}`}
      >
        <div className="mb-7 flex items-center justify-between">
          <BrandMark
            className="w-36 sm:w-40"
            href="/"
            ariaLabel="Daily Dose Pilates — Kembali ke situs utama"
          />
          <IconButton
            label="Tutup navigasi akun"
            variant="secondary"
            onClick={onClose}
            className="rounded-dd-md border-dd-line bg-white text-dd-ink shadow-none hover:bg-dd-surface-muted"
          >
            <X className="size-5" />
          </IconButton>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto">
          {[
            ['Utama', CUSTOMER_PRIMARY_NAVIGATION],
            ['Akun', CUSTOMER_ACCOUNT_NAVIGATION],
          ].map(([group, items]) => (
            <div key={group as string}>
              <p className="mb-2 px-3 text-[13px] font-bold text-dd-forest/80">
                {group as string}
              </p>
              <div className="space-y-1">
                {(items as CustomerNavigationItem[]).map((item) => {
                  const Icon = item.icon;
                  const selected = isCustomerNavigationActive(pathname, item.href);
                  const locked = Boolean(item.requiresApproval && !approved);
                  const showOrderBadge =
                    item.href === '/orders' && badges.actionableOrdersCount > 0;
                  const showBookingBadge =
                    item.href === '/bookings' && badges.upcomingBookingsCount > 0;
                  const showVerificationDot =
                    item.href === '/account/verification' && badges.verificationActionRequired;
                  const showPackageDot =
                    item.href === '/account/packages' && badges.expiringPackagesCount > 0;

                  return (
                    <Link
                      key={item.href}
                      href={navigationHref(item, approved)}
                      aria-current={open && selected ? 'page' : undefined}
                      aria-label={locked ? `${item.label}, memerlukan verifikasi` : item.label}
                      onClick={onClose}
                      className={`flex min-h-11 items-center gap-3 rounded-dd-md px-3 text-sm font-semibold no-underline transition ${
                        selected
                          ? 'bg-dd-forest text-white shadow-dd-soft'
                          : 'text-dd-ink hover:bg-dd-surface-muted hover:text-dd-forest'
                      }`}
                    >
                      <Icon className="size-[18px] shrink-0" aria-hidden="true" />
                      <span className="min-w-0 flex-1">{item.label}</span>
                      {showOrderBadge && (
                        <span className="rounded-full bg-dd-brass px-2 py-0.5 text-[13px] font-bold text-white shadow-xs">
                          {badges.actionableOrdersCount}
                        </span>
                      )}
                      {showBookingBadge && (
                        <span className="rounded-full bg-dd-forest px-2 py-0.5 text-[13px] font-bold text-white shadow-xs">
                          {badges.upcomingBookingsCount}
                        </span>
                      )}
                      {showVerificationDot && (
                        <span
                          className="size-2.5 rounded-full bg-dd-brass ring-2 ring-white"
                          title="Perlu perbaikan dokumen"
                        />
                      )}
                      {showPackageDot && (
                        <span
                          className="size-2.5 rounded-full bg-dd-brass ring-2 ring-white"
                          title="Segera kedaluwarsa atau kuota sisa 1 sesi"
                        />
                      )}
                      {locked && (
                        <LockKeyhole
                          className="size-3.5 text-dd-muted"
                          aria-hidden="true"
                        />
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {!approved && (
          <div className="mt-5 rounded-dd-lg border border-dd-line bg-dd-surface-muted p-3 text-xs leading-5 text-dd-muted">
            Selesaikan verifikasi untuk membuka booking dan transaksi.
          </div>
        )}
        <div className="mt-5 grid gap-1 border-t border-dd-line pt-4">
          <button
            type="button"
            onClick={() => {
              onClose();
              studioPreference?.openStudioPreference();
            }}
            className="flex min-h-11 w-full items-center gap-3 rounded-dd-md border-0 bg-transparent px-3 text-left text-sm font-semibold text-dd-ink hover:bg-dd-surface-muted"
          >
            <MapPin className="size-[18px] shrink-0 text-dd-forest" aria-hidden="true" />
            Ganti studio
          </button>
          <Link
            href="/"
            onClick={onClose}
            className="flex min-h-11 items-center gap-3 rounded-dd-md px-3 text-sm font-semibold text-dd-ink no-underline hover:bg-dd-surface-muted"
          >
            <House className="size-[18px] shrink-0 text-dd-forest" aria-hidden="true" />
            Kunjungi situs utama
          </Link>
          <button
            type="button"
            onClick={() => {
              onClose();
              void onLogout();
            }}
            className="flex min-h-11 w-full items-center gap-3 rounded-dd-md border-0 bg-transparent px-3 text-left text-sm font-semibold text-dd-danger hover:bg-dd-danger-soft"
          >
            <LogOut className="size-[18px] shrink-0" aria-hidden="true" />
            Keluar
          </button>
        </div>
      </nav>
    </>
  );
}
