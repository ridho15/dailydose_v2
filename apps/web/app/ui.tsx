'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, Inbox, X } from 'lucide-react';

export function PageHeader({
  eyebrow,
  title,
  description,
  context,
  titleId,
  backHref,
  onBack,
  backLabel = 'Kembali',
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  context?: ReactNode;
  titleId?: string;
  backHref?: string;
  onBack?: () => void;
  backLabel?: string;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-dd-line pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 items-start gap-3.5">
        {backHref ? (
          <Link
            href={backHref}
            aria-label={backLabel}
            className="inline-flex size-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-dd-md border border-dd-border-interactive bg-white text-dd-forest transition hover:bg-dd-surface-muted focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#09371f]"
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </Link>
        ) : onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label={backLabel}
            className="inline-flex size-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-dd-md border border-dd-border-interactive bg-white text-dd-forest transition hover:bg-dd-surface-muted focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#09371f]"
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </button>
        ) : null}
        <div className="min-w-0">
          {eyebrow && <p className="text-[13px] font-bold text-dd-forest">{eyebrow}</p>}
          <h1
            id={titleId}
            className="mt-1 text-[28px] font-semibold tracking-[-0.02em] text-dd-ink sm:text-[32px]"
          >
            {title}
          </h1>
          {description && (
            <p className="mt-2 max-w-3xl text-[17px] leading-7 text-dd-muted">{description}</p>
          )}
        </div>
      </div>
      {context && <div className="flex shrink-0 flex-wrap items-center gap-2">{context}</div>}
    </header>
  );
}

export function StatusBadge({
  children,
  tone = 'neutral',
  withDot = false,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  withDot?: boolean;
}) {
  const classes = {
    neutral: 'bg-dd-surface-muted text-dd-muted ring-dd-line',
    info: 'bg-dd-info-soft text-dd-info ring-dd-info/30',
    success: 'bg-dd-success-soft text-dd-success ring-dd-success/30',
    warning: 'bg-dd-warning-soft text-dd-warning ring-dd-warning/40',
    danger: 'bg-dd-danger-soft text-dd-danger ring-dd-danger/30',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${classes[tone]}`}
    >
      {withDot && <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function Feedback({
  kind,
  children,
  onDismiss,
  autoDismiss,
  durationMs = 5000,
}: {
  kind: 'status' | 'error' | 'warning' | 'info';
  children: ReactNode;
  onDismiss?: () => void;
  autoDismiss?: boolean;
  durationMs?: number;
}) {
  const [visible, setVisible] = useState(true);
  const dismissedContentRef = useRef<unknown>(null);

  useEffect(() => {
    if (dismissedContentRef.current !== null) {
      if (typeof children === 'string' || typeof children === 'number') {
        if (children === dismissedContentRef.current) {
          return;
        }
      }
    }
    setVisible(true);
  }, [children]);

  useEffect(() => {
    const shouldAutoDismiss = autoDismiss ?? kind === 'status';
    if (!shouldAutoDismiss || !visible) return;

    const timer = setTimeout(() => {
      dismissedContentRef.current =
        typeof children === 'string' || typeof children === 'number' ? children : true;
      setVisible(false);
      onDismiss?.();
    }, durationMs);

    return () => clearTimeout(timer);
  }, [autoDismiss, children, durationMs, kind, onDismiss, visible]);

  if (!visible) return null;

  const role = kind === 'error' ? 'alert' : 'status';
  const classes = {
    status: 'border-dd-success/30 bg-dd-success-soft text-dd-success',
    error: 'border-dd-danger/30 bg-dd-danger-soft text-dd-danger',
    warning: 'border-dd-warning/40 bg-dd-warning-soft text-dd-warning',
    info: 'border-dd-info/30 bg-dd-info-soft text-dd-info',
  };

  return (
    <div
      className={`flex items-start justify-between gap-3 rounded-dd-md border p-3.5 text-sm leading-6 transition-all duration-200 ${classes[kind]}`}
      role={role}
      aria-live={kind === 'error' ? 'assertive' : 'polite'}
    >
      <div className="flex items-start gap-3 min-w-0">
        <span className="mt-2 size-2 shrink-0 rounded-full bg-current" aria-hidden="true" />
        <div className="min-w-0 break-words font-medium">{children}</div>
      </div>
      <button
        type="button"
        onClick={() => {
          dismissedContentRef.current =
            typeof children === 'string' || typeof children === 'number' ? children : true;
          setVisible(false);
          onDismiss?.();
        }}
        className="ml-2 -mr-1 -mt-1 inline-flex size-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-dd-sm text-current opacity-70 hover:opacity-100 hover:bg-black/5 transition cursor-pointer focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#09371f]"
        aria-label="Tutup pemberitahuan"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid min-h-52 place-items-center rounded-dd-lg border border-dashed border-dd-line bg-dd-surface-muted p-8 text-center">
      <div className="max-w-md">
        <span
          className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-dd-brass-soft text-dd-brass"
          aria-hidden="true"
        >
          <Inbox className="size-6" />
        </span>
        <strong className="text-base text-dd-ink">{title}</strong>
        <p className="mt-2 text-sm leading-6 text-dd-muted">{description}</p>
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  );
}

export function Skeleton({ label = 'Memuat konten' }: { label?: string }) {
  return (
    <div
      className="grid gap-3 rounded-dd-lg border border-dd-line bg-white p-5"
      role="status"
      aria-label={label}
    >
      <span className="h-5 w-4/5 rounded bg-dd-surface-muted" />
      <span className="h-5 rounded bg-dd-surface-muted" />
      <span className="h-5 w-2/5 rounded bg-dd-surface-muted" />
    </div>
  );
}

export function DataRegion({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      className="overflow-x-auto rounded-dd-lg border border-dd-line bg-white"
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      {children}
    </div>
  );
}
