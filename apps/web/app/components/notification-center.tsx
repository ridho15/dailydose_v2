'use client';

import { ArrowRight, Bell, CheckCheck, LoaderCircle, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  browserNotificationClient,
  getNotificationActionLabel,
  type NotificationClient,
  type UserNotification,
} from '@/api-clients/notification-client';
import { useSessionContext } from '../session-context';
import { Button, IconButton } from './actions';

const toneDot = {
  success: 'bg-dd-success',
  info: 'bg-dd-info',
  warning: 'bg-dd-warning',
  danger: 'bg-dd-danger',
};

export function NotificationCenter({
  compact = false,
  quiet = false,
  open: controlledOpen,
  onOpenChange,
  client = browserNotificationClient,
}: {
  compact?: boolean;
  /** Tombol ikon tanpa bingkai, untuk bilah atas staf yang mengikuti mockup. */
  quiet?: boolean;
  open?: boolean;
  onOpenChange?(open: boolean): void;
  client?: NotificationClient;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange],
  );
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('loading');
  const [items, setItems] = useState<UserNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [actionError, setActionError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const stoppedByAuthError = useRef(false);
  const lastRefreshAt = useRef(0);

  const context = useSessionContext();
  const isAuthenticated = context
    ? context.status === 'authenticated' && Boolean(context.session)
    : true;

  const refresh = useCallback(async () => {
    if (!isAuthenticated || stoppedByAuthError.current) return;
    lastRefreshAt.current = Date.now();
    setStatus('loading');
    try {
      const [page, count] = await Promise.all([client.list({ limit: 12 }), client.unreadCount()]);
      setItems(page.items);
      setNextCursor(page.page.nextCursor);
      setUnread(count.count);
      setStatus('ready');
    } catch (err: unknown) {
      const statusCode = (err as { response?: { status?: number } })?.response?.status;
      if (statusCode === 401 || (err instanceof Error && err.message.includes('401'))) {
        stoppedByAuthError.current = true;
      }
      setStatus('error');
    }
  }, [client, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      setStatus('idle');
      setItems([]);
      setUnread(0);
      return;
    }
    stoppedByAuthError.current = false;
    void refresh();
    const timer = window.setInterval(() => {
      if (stoppedByAuthError.current) {
        window.clearInterval(timer);
        return;
      }
      void refresh();
    }, 60_000);
    const visible = () => {
      // Fokus beruntun (pindah tab, klik jendela) tidak perlu memuat ulang berkali-kali.
      const recentlyRefreshed = Date.now() - lastRefreshAt.current < 5_000;
      if (document.visibilityState === 'visible' && !stoppedByAuthError.current && !recentlyRefreshed) {
        void refresh();
      }
    };
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [isAuthenticated, refresh]);

  useEffect(() => {
    if (open && isAuthenticated && !stoppedByAuthError.current) void refresh();
  }, [isAuthenticated, open, refresh]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', escape);
    };
  }, [open, setOpen]);

  const markRead = async (item: UserNotification) => {
    if (!item.readAt) {
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id ? { ...candidate, readAt: new Date().toISOString() } : candidate,
        ),
      );
      setUnread((current) => Math.max(0, current - 1));
      try {
        await client.markRead(item.id);
      } catch {
        void refresh();
      }
    }
    setOpen(false);
  };

  return (
    <div className="relative" ref={root}>
      <IconButton
        ref={trigger}
        label={unread ? `Notifikasi, ${unread} belum dibaca` : 'Notifikasi'}
        variant="secondary"
        aria-expanded={open}
        aria-controls="global-notification-center"
        onClick={() => setOpen(!open)}
        className={`relative shadow-none text-dd-muted ${
          quiet
            ? 'rounded-dd-sm border-transparent bg-transparent hover:bg-black/5'
            : 'rounded-dd-md border-dd-line bg-white'
        }`}
      >
        <Bell className="size-[18px]" aria-hidden="true" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-dd-danger px-1 text-[13px] font-bold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </IconButton>
      {open && (
        <section
          id="global-notification-center"
          aria-label="Pusat notifikasi"
          className={`fixed inset-x-3 top-16 z-[80] overflow-hidden rounded-dd-lg border border-dd-line bg-white shadow-dd-float sm:absolute sm:inset-auto sm:right-0 sm:top-auto sm:mt-2 ${compact ? 'sm:w-[340px]' : 'sm:w-[390px]'}`}
        >
          <header className="flex items-center justify-between gap-3 border-b border-dd-line px-4 py-3">
            <div>
              <strong className="block text-sm">Notifikasi</strong>
              <span className="text-xs text-dd-muted">{unread} belum dibaca</span>
            </div>
            {unread > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                leadingIcon={<CheckCheck className="size-4" aria-hidden="true" />}
                onClick={() =>
                  void client
                    .markAllRead()
                    .then(({ readAt }) => {
                      setActionError('');
                      setUnread(0);
                      setItems((current) => current.map((item) => ({ ...item, readAt })));
                    })
                    .catch(() => setActionError('Notifikasi belum dapat diperbarui.'))
                }
              >
                Tandai semua
              </Button>
            )}
          </header>
          {actionError && (
            <p role="alert" className="border-b border-dd-line px-4 py-2 text-xs text-dd-danger">
              {actionError}
            </p>
          )}
          <div className="max-h-[min(520px,70dvh)] overflow-y-auto" aria-live="polite">
            {status === 'loading' && items.length === 0 && (
              <div className="grid place-items-center gap-2 p-8 text-sm text-dd-muted">
                <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" />
                Memuat notifikasi…
              </div>
            )}
            {status === 'error' && (
              <div className="p-6 text-center">
                <p className="text-sm text-dd-muted">Notifikasi belum dapat dimuat.</p>
                <Button
                  className="mt-3"
                  variant="secondary"
                  size="sm"
                  leadingIcon={<RefreshCw className="size-4" aria-hidden="true" />}
                  onClick={() => void refresh()}
                >
                  Coba lagi
                </Button>
              </div>
            )}
            {(status === 'ready' || status === 'idle') && items.length === 0 && (
              <div className="p-8 text-center">
                <Bell className="mx-auto size-6 text-dd-muted" />
                <strong className="mt-3 block text-sm">Belum ada notifikasi</strong>
                <p className="mt-1 text-xs leading-5 text-dd-muted">
                  Pembaruan penting akan muncul di sini.
                </p>
              </div>
            )}
            {items.map((item) => (
              <Link
                key={item.id}
                href={item.href ?? '#'}
                onClick={(event) => {
                  if (!item.href) event.preventDefault();
                  void markRead(item);
                }}
                className={`grid grid-cols-[auto_minmax(0,1fr)] gap-3 border-b border-dd-line px-4 py-3 text-dd-ink no-underline last:border-0 hover:bg-dd-surface-muted ${item.readAt ? 'opacity-70' : 'bg-dd-paper/50'}`}
              >
                <span
                  className={`mt-1.5 size-2 rounded-full ${toneDot[item.tone]}`}
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <strong className="block text-sm">{item.title}</strong>
                  <span className="mt-1 block text-xs leading-5 text-dd-muted">{item.message}</span>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <time className="block text-[12px] text-dd-muted" dateTime={item.createdAt}>
                      {new Intl.DateTimeFormat('id-ID', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(new Date(item.createdAt))}
                    </time>
                    {item.href && (
                      <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-dd-forest">
                        {getNotificationActionLabel(item)}
                        <ArrowRight className="size-3" aria-hidden="true" />
                      </span>
                    )}
                  </div>
                </span>
              </Link>
            ))}
            {nextCursor && status === 'ready' && (
              <button
                type="button"
                disabled={loadingMore}
                className="min-h-11 w-full rounded-none border-0 border-t border-dd-line bg-white text-sm font-semibold text-dd-forest"
                onClick={() => {
                  if (loadingMore) return;
                  setLoadingMore(true);
                  setActionError('');
                  void client
                    .list({ cursor: nextCursor, limit: 12 })
                    .then((page) => {
                      setItems((current) => {
                        const existing = new Set(current.map(({ id }) => id));
                        return [...current, ...page.items.filter(({ id }) => !existing.has(id))];
                      });
                      setNextCursor(page.page.nextCursor);
                    })
                    .catch(() => setActionError('Halaman notifikasi berikutnya gagal dimuat.'))
                    .finally(() => setLoadingMore(false));
                }}
              >
                {loadingMore ? 'Memuat…' : 'Muat lebih banyak'}
              </button>
            )}
          </div>
          {/* Footer: lihat semua */}
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="flex min-h-11 w-full items-center justify-center gap-1.5 border-t border-dd-line bg-dd-surface-muted/60 px-4 text-xs font-semibold text-dd-forest no-underline transition-colors hover:bg-dd-surface-muted"
          >
            <span>Lihat semua notifikasi</span>
            <ArrowRight className="size-3.5" />
          </Link>
        </section>
      )}
    </div>
  );
}
