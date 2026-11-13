'use client';

import {
  ArrowRight,
  Bell,
  CheckCheck,
  ChevronDown,
  Filter,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  CreditCard,
  CalendarCheck,
  LayoutDashboard,
  Info,
  AlertTriangle,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  browserNotificationClient,
  getNotificationActionLabel,
  type UserNotification,
} from '@/api-clients/notification-client';
import { Button } from '../components/actions';

// ── Tone helpers ─────────────────────────────────────────────────────────────
const toneDot: Record<string, string> = {
  success: 'bg-dd-success',
  info: 'bg-dd-info',
  warning: 'bg-dd-warning',
  danger: 'bg-dd-danger',
};

const toneIcon: Record<string, React.ReactNode> = {
  success: <CheckCircle className="size-4 text-dd-success" aria-hidden="true" />,
  info: <Info className="size-4 text-dd-info" aria-hidden="true" />,
  warning: <AlertTriangle className="size-4 text-dd-warning" aria-hidden="true" />,
  danger: <XCircle className="size-4 text-dd-danger" aria-hidden="true" />,
};

const toneBg: Record<string, string> = {
  success: 'bg-dd-success-soft border-dd-success/20',
  info: 'bg-dd-info-soft border-dd-info/20',
  warning: 'bg-dd-warning-soft border-dd-warning/20',
  danger: 'bg-dd-danger-soft border-dd-danger/20',
};

// ── Category helpers ──────────────────────────────────────────────────────────
const categoryLabel: Record<string, string> = {
  VERIFICATION: 'Verifikasi',
  PAYMENT: 'Pembayaran',
  BOOKING: 'Booking',
  PACKAGE: 'Paket',
  ATTENDANCE: 'Kehadiran',
  CLASS: 'Kelas',
  SYSTEM: 'Sistem',
  OPERATIONS: 'Operasional',
  APPROVAL: 'Persetujuan',
  RESCHEDULE: 'Reschedule',
  ADJUSTMENT: 'Penyesuaian',
};

const categoryIcon: Record<string, React.ReactNode> = {
  VERIFICATION: <ShieldCheck className="size-4" aria-hidden="true" />,
  PAYMENT: <CreditCard className="size-4" aria-hidden="true" />,
  BOOKING: <CalendarCheck className="size-4" aria-hidden="true" />,
  PACKAGE: <LayoutDashboard className="size-4" aria-hidden="true" />,
  SYSTEM: <Info className="size-4" aria-hidden="true" />,
};

const categoryColors: Record<string, string> = {
  VERIFICATION: 'bg-dd-brass-soft text-dd-brass-dark',
  PAYMENT: 'bg-dd-success-soft text-dd-success',
  BOOKING: 'bg-dd-forest/10 text-dd-forest',
  PACKAGE: 'bg-dd-info-soft text-dd-info',
  SYSTEM: 'bg-dd-surface-muted text-dd-muted',
  OPERATIONS: 'bg-dd-warning-soft text-dd-warning',
  APPROVAL: 'bg-dd-brass-soft text-dd-brass-dark',
};

function formatRelativeTime(dateString: string): string {
  const diff = Date.now() - new Date(dateString).getTime();
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (minutes < 1) return 'Baru saja';
  if (minutes < 60) return `${minutes} mnt lalu`;
  if (hours < 24) return `${hours} jam lalu`;
  if (days < 7) return `${days} hari lalu`;
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(new Date(dateString));
}

type FilterTab = 'all' | 'unread' | string;

// ── Main component ────────────────────────────────────────────────────────────
export function NotificationsView() {
  const client = browserNotificationClient;

  const [items, setItems] = useState<UserNotification[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [actionError, setActionError] = useState('');
  const [unread, setUnread] = useState(0);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(
    async (reset = false, filter: FilterTab = activeFilter) => {
      if (reset) {
        setStatus('loading');
        setItems([]);
        setNextCursor(null);
      }
      try {
        const page = await client.list({
          limit: 20,
          unreadOnly: filter === 'unread',
        });
        setItems(reset ? page.items : (prev) => [...prev, ...page.items]);
        setNextCursor(page.page.nextCursor);
        setStatus('ready');
      } catch {
        setStatus('error');
      }
    },
    [activeFilter, client],
  );

  const loadUnreadCount = useCallback(async () => {
    try {
      const { count } = await client.unreadCount();
      setUnread(count);
    } catch {
      /* silently ignore */
    }
  }, [client]);

  useEffect(() => {
    void load(true, 'all');
    void loadUnreadCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFilterChange = (filter: FilterTab) => {
    setActiveFilter(filter);
    void load(true, filter);
  };

  const markRead = async (item: UserNotification) => {
    if (item.readAt) return;
    setItems((current) =>
      current.map((c) => (c.id === item.id ? { ...c, readAt: new Date().toISOString() } : c)),
    );
    setUnread((n) => Math.max(0, n - 1));
    try {
      await client.markRead(item.id);
    } catch {
      void load(true);
    }
  };

  const markAllRead = async () => {
    if (markingAll) return;
    setMarkingAll(true);
    setActionError('');
    try {
      const { readAt } = await client.markAllRead();
      setUnread(0);
      setItems((current) => current.map((item) => ({ ...item, readAt })));
    } catch {
      setActionError('Gagal menandai semua notifikasi sebagai dibaca.');
    } finally {
      setMarkingAll(false);
    }
  };

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setActionError('');
    try {
      const page = await client.list({
        cursor: nextCursor,
        limit: 20,
        unreadOnly: activeFilter === 'unread',
      });
      setItems((current) => {
        const existing = new Set(current.map(({ id }) => id));
        return [...current, ...page.items.filter(({ id }) => !existing.has(id))];
      });
      setNextCursor(page.page.nextCursor);
    } catch {
      setActionError('Gagal memuat halaman berikutnya.');
    } finally {
      setLoadingMore(false);
    }
  };

  // ── filter by category (client-side after load) ────────────────────────────
  const categoryFilters = ['all', 'unread', ...Object.keys(categoryLabel)];
  const visibleItems =
    activeFilter === 'all' || activeFilter === 'unread'
      ? items
      : items.filter((item) => item.category === activeFilter);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      {/* ── Header ── */}
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-dd-ink sm:text-3xl">Notifikasi</h1>
          <p className="mt-0.5 text-sm text-dd-muted">
            {unread > 0 ? `${unread} belum dibaca` : 'Semua sudah dibaca'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            leadingIcon={<RefreshCw className="size-4" aria-hidden="true" />}
            onClick={() => {
              void load(true);
              void loadUnreadCount();
            }}
          >
            Perbarui
          </Button>
          {unread > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              leadingIcon={<CheckCheck className="size-4" aria-hidden="true" />}
              onClick={() => void markAllRead()}
              disabled={markingAll}
            >
              {markingAll ? 'Menandai…' : 'Tandai semua'}
            </Button>
          )}
        </div>
      </div>

      {/* ── Filter tabs ── */}
      <div className="mb-4 flex items-center gap-2 overflow-x-auto pb-1">
        <Filter className="shrink-0 size-4 text-dd-muted" aria-hidden="true" />
        {[
          { key: 'all', label: 'Semua' },
          { key: 'unread', label: `Belum dibaca${unread > 0 ? ` (${unread})` : ''}` },
          ...Object.entries(categoryLabel).map(([key, label]) => ({ key, label })),
        ].map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => handleFilterChange(key)}
            className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
              activeFilter === key
                ? 'border-dd-forest bg-dd-forest text-white'
                : 'border-dd-line bg-white text-dd-muted hover:border-dd-forest/40 hover:text-dd-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Error banner ── */}
      {actionError && (
        <p
          role="alert"
          className="mb-4 rounded-dd-md border border-dd-danger/30 bg-dd-danger-soft px-4 py-3 text-sm text-dd-danger"
        >
          {actionError}
        </p>
      )}

      {/* ── Content area ── */}
      <div
        className="overflow-hidden rounded-dd-lg border border-dd-line bg-white"
        aria-live="polite"
        aria-label="Daftar notifikasi"
      >
        {status === 'loading' && (
          <div className="flex flex-col items-center gap-3 py-16 text-dd-muted">
            <LoaderCircle className="size-7 animate-spin motion-reduce:animate-none" />
            <span className="text-sm">Memuat notifikasi…</span>
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <Bell className="size-8 text-dd-muted" />
            <p className="text-sm text-dd-muted">Notifikasi belum dapat dimuat.</p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              leadingIcon={<RefreshCw className="size-4" aria-hidden="true" />}
              onClick={() => void load(true)}
            >
              Coba lagi
            </Button>
          </div>
        )}

        {status === 'ready' && visibleItems.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <Bell className="size-8 text-dd-muted" />
            <strong className="text-sm text-dd-ink">Tidak ada notifikasi</strong>
            <p className="text-xs text-dd-muted">
              {activeFilter === 'unread'
                ? 'Semua notifikasi sudah dibaca.'
                : 'Pembaruan penting akan muncul di sini.'}
            </p>
          </div>
        )}

        {status === 'ready' && visibleItems.length > 0 && (
          <ul role="list">
            {visibleItems.map((item) => {
              const isUnread = !item.readAt;
              const catColor = categoryColors[item.category] ?? 'bg-dd-surface-muted text-dd-muted';
              const catIcon = categoryIcon[item.category];
              const catLabel = categoryLabel[item.category] ?? item.category;

              const content = (
                <div
                  className={`grid grid-cols-[auto_minmax(0,1fr)] gap-3 border-b border-dd-line px-4 py-4 transition-colors last:border-0 hover:bg-dd-surface-muted ${
                    isUnread ? 'bg-dd-info-soft/40' : 'bg-white'
                  }`}
                >
                  {/* Tone indicator dot */}
                  <div className="flex flex-col items-center pt-1.5 gap-1.5">
                    <span
                      className={`size-2.5 rounded-full ${toneDot[item.tone] ?? 'bg-dd-muted/40'}`}
                      aria-hidden="true"
                    />
                  </div>

                  <div className="min-w-0">
                    {/* Category badge + time */}
                    <div className="mb-1.5 flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[13px] font-semibold ${catColor}`}
                      >
                        {catIcon}
                        {catLabel}
                      </span>
                      <time className="ml-auto text-[13px] text-dd-muted" dateTime={item.createdAt}>
                        {formatRelativeTime(item.createdAt)}
                      </time>
                      {isUnread && (
                        <span
                          className="inline-block size-2 rounded-full bg-dd-forest"
                          aria-label="Belum dibaca"
                        />
                      )}
                    </div>

                    {/* Title + message */}
                    <strong className="block text-sm font-semibold text-dd-ink">
                      {item.title}
                    </strong>
                    <span className="mt-1 block text-xs leading-relaxed text-dd-muted">
                      {item.message}
                    </span>

                    {/* Action CTA Button */}
                    {item.href && (
                      <div className="mt-3 flex items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-dd-sm border border-dd-forest/20 bg-dd-forest/5 px-2.5 py-1 text-xs font-semibold text-dd-forest transition-colors group-hover:bg-dd-forest group-hover:text-white">
                          {getNotificationActionLabel(item)}
                          <ArrowRight className="size-3.5" aria-hidden="true" />
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );

              return (
                <li key={item.id}>
                  {item.href ? (
                    <Link
                      href={item.href}
                      className="group block no-underline"
                      onClick={() => void markRead(item)}
                    >
                      {content}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="w-full text-left"
                      onClick={() => void markRead(item)}
                    >
                      {content}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* Load more */}
        {nextCursor && status === 'ready' && (
          <div className="border-t border-dd-line p-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              leadingIcon={
                loadingMore ? (
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ChevronDown className="size-4" aria-hidden="true" />
                )
              }
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore ? 'Memuat…' : 'Muat lebih banyak'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
