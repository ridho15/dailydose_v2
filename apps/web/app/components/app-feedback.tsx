'use client';

import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Button, IconButton } from './actions';

export type OverlayPhase = 'entering' | 'open' | 'exiting';

export type OverlayMotionConfig = {
  enterMs: number;
  exitMs: number;
};

const overlayMotion: Record<'modal' | 'drawer', OverlayMotionConfig> = {
  modal: { enterMs: 180, exitMs: 140 },
  drawer: { enterMs: 220, exitMs: 180 },
};

export function useOverlayPresence(open: boolean, placement: 'modal' | 'drawer' = 'drawer') {
  const [rendered, setRendered] = useState(open);
  const [phase, setPhase] = useState<OverlayPhase>(open ? 'entering' : 'exiting');

  useEffect(() => {
    const motion = overlayMotion[placement];
    if (open) {
      setRendered(true);
      setPhase('entering');
      const frame = window.requestAnimationFrame(() => setPhase('open'));
      return () => window.cancelAnimationFrame(frame);
    }
    if (!rendered) return;
    setPhase('exiting');
    const timer = window.setTimeout(() => setRendered(false), motion.exitMs);
    return () => window.clearTimeout(timer);
  }, [open, placement, rendered]);

  return { rendered, phase, visible: phase === 'open' } as const;
}

export type FeedbackTone = 'success' | 'info' | 'warning' | 'danger';

export type FeedbackAction = {
  label: string;
  onSelect(): void;
};

export type AppToast = {
  id?: string;
  tone: FeedbackTone;
  title: string;
  message?: string;
  durationMs?: number;
  dismissible?: boolean;
  correlationReference?: string;
  action?: FeedbackAction;
};

export type AppAlert = Omit<AppToast, 'durationMs'> & {
  closeLabel?: string;
};

export type ConfirmationOptions = {
  tone?: 'warning' | 'danger';
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  correlationReference?: string;
};

type FeedbackContextValue = {
  showToast(input: AppToast): string;
  showAlert(input: AppAlert): string;
  confirm(input: ConfirmationOptions): Promise<boolean>;
  dismiss(id: string): void;
  dismissAll(): void;
};

type Stored<T> = T & { id: string };

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

const icons = {
  success: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
  danger: AlertCircle,
};

const toneClasses = {
  success: 'border-dd-success/30 bg-dd-success-soft text-dd-success',
  info: 'border-dd-info/30 bg-dd-info-soft text-dd-info',
  warning: 'border-dd-warning/40 bg-dd-warning-soft text-dd-warning',
  danger: 'border-dd-danger/30 bg-dd-danger-soft text-dd-danger',
};

const newFeedbackId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `feedback-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const dialogStack: string[] = [];
let originalBodyOverflow = '';

function registerDialog(id: string) {
  if (dialogStack.includes(id)) return;
  if (dialogStack.length === 0) {
    originalBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  dialogStack.push(id);
}

function unregisterDialog(id: string) {
  const index = dialogStack.lastIndexOf(id);
  if (index >= 0) dialogStack.splice(index, 1);
  if (dialogStack.length === 0) document.body.style.overflow = originalBodyOverflow;
}

function isTopDialog(id: string) {
  return dialogStack.at(-1) === id;
}

export function useOverlayInteraction({
  open,
  onClose,
  panelRef,
}: {
  open: boolean;
  onClose(): void;
  panelRef: RefObject<HTMLElement | null>;
}) {
  const overlayId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    registerDialog(overlayId);
    const focusable = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopDialog(overlayId)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0]!;
      const last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      unregisterDialog(overlayId);
      window.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [open, overlayId, panelRef]);
}

export function messageForApiError(error: unknown): {
  title: string;
  message: string;
  correlationReference?: string;
} {
  const response = (
    error as {
      response?: { status?: number; correlationId?: string; data?: { code?: string } };
    }
  )?.response;
  const code = response?.data?.code;
  const known: Record<string, [string, string]> = {
    STALE_VERSION: ['Data telah berubah', 'Muat ulang data terbaru sebelum mencoba kembali.'],
    SLOT_SCHEDULE_COLLISION: [
      'Jadwal Studio Bentrok',
      'Ruangan reformer atau instruktur sudah memiliki jadwal lain pada jam tersebut. Silakan pilih ruangan atau jam lain.',
    ],
    ADMIN_BACKFILL_WINDOW_CLOSED: [
      'Waktu Presensi Susulan Habis',
      'Kelas telah selesai lebih dari 2 jam lalu. Presensi ditutup dan wajib diajukan melalui Tiket Penyesuaian Medis ke Manager.',
    ],
    VERIFICATION_LOCKED_APPROVED: [
      'Dokumen Terverifikasi Resmi',
      'Dokumen identitas Anda telah disetujui sah oleh Super Owner dan terkunci demi keamanan akun.',
    ],
    SEPARATION_OF_DUTIES: [
      'Pemeriksaan Silang Staf',
      'Persetujuan harus diputuskan oleh staf atau manajer yang berbeda dari pemohon demi transparansi.',
    ],
    CUSTOMER_VERIFICATION_REQUIRED: [
      'Verifikasi Identitas Diperlukan',
      'Ambil foto selfie dulu di menu Akun > Foto selfie, lalu lanjutkan. Tidak perlu KTP.',
    ],
    FORBIDDEN: ['Akses tidak tersedia', 'Akun Anda tidak memiliki izin untuk tindakan ini.'],
    UNAUTHORIZED: ['Sesi telah berakhir', 'Silakan masuk kembali untuk melanjutkan.'],
    VALIDATION_ERROR: [
      'Periksa kembali data',
      'Beberapa informasi belum valid atau belum lengkap.',
    ],
    NOT_FOUND: ['Data tidak ditemukan', 'Data mungkin telah dipindahkan atau tidak lagi tersedia.'],
    SERVICE_UNAVAILABLE: ['Layanan belum tersedia', 'Coba kembali beberapa saat lagi.'],
    CONFIGURATION_REQUIRED: [
      'Dokumen belum dapat diproses',
      'Layanan dokumen sementara tidak tersedia. Silakan coba kembali nanti.',
    ],
    IDENTITY_DOCUMENT_NOT_READY: [
      'Dokumen belum siap diperiksa',
      'Upload atau pemeriksaan keamanan file belum selesai. Segarkan status sebelum mencoba lagi.',
    ],
  };
  const fallback: [string, string] =
    response?.status === 401
      ? known.UNAUTHORIZED!
      : response?.status === 403
        ? known.FORBIDDEN!
        : response?.status === 409
          ? (code === 'SLOT_SCHEDULE_COLLISION' ? known.SLOT_SCHEDULE_COLLISION! : known.STALE_VERSION!)
          : response?.status === 410
            ? known.ADMIN_BACKFILL_WINDOW_CLOSED!
            : ['Terjadi kendala', 'Permintaan belum dapat diproses. Silakan coba kembali.'];
  const [title, message] = (code && known[code]) || fallback;
  return { title, message, correlationReference: response?.correlationId };
}

export function AlertBanner({
  tone,
  title,
  message,
  correlationReference,
  action,
  onDismiss,
}: Omit<AppAlert, 'id'> & { onDismiss?: () => void }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setVisible(true);
  }, [title, message]);

  if (!visible) return null;

  const Icon = icons[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      aria-live={tone === 'danger' ? 'assertive' : 'polite'}
      className={`flex items-start justify-between gap-3 rounded-dd-md border p-4 ${toneClasses[tone]}`}
    >
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <strong className="block text-sm font-semibold">{title}</strong>
          {message && <p className="mt-1 text-sm leading-6 opacity-90">{message}</p>}
          {correlationReference && (
            <p className="mt-2 text-xs opacity-70">Kode bantuan: {correlationReference}</p>
          )}
          {action && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={action.onSelect}
            >
              {action.label}
            </Button>
          )}
        </div>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={() => {
            setVisible(false);
            onDismiss();
          }}
          className="ml-2 -mr-1 -mt-1 p-1 rounded-dd-sm text-current opacity-60 hover:opacity-100 hover:bg-black/5 transition cursor-pointer"
          aria-label="Tutup pemberitahuan"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

export function Modal({
  open,
  title,
  description,
  children,
  onClose,
  closeOnEscape = true,
  closeOnBackdrop = true,
  showCloseButton = true,
  className = '',
  bodyClassName = '',
  footer,
  busy = false,
  dirty = false,
  onDirtyClose,
  placement = 'center',
}: {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onClose(): void;
  closeOnEscape?: boolean;
  closeOnBackdrop?: boolean;
  showCloseButton?: boolean;
  className?: string;
  bodyClassName?: string;
  footer?: ReactNode;
  busy?: boolean;
  dirty?: boolean;
  onDirtyClose?: () => boolean | Promise<boolean>;
  placement?: 'center' | 'right';
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const openRef = useRef(open);
  const { rendered, phase, visible } = useOverlayPresence(
    open,
    placement === 'right' ? 'drawer' : 'modal',
  );
  const closingRef = useRef(false);
  const busyRef = useRef(busy);
  const dirtyRef = useRef(dirty);
  const onCloseRef = useRef(onClose);
  const onDirtyCloseRef = useRef(onDirtyClose);
  useEffect(() => {
    openRef.current = open;
    busyRef.current = busy;
    dirtyRef.current = dirty;
    onCloseRef.current = onClose;
    onDirtyCloseRef.current = onDirtyClose;
  }, [busy, dirty, onClose, onDirtyClose, open]);
  const requestClose = useCallback(async () => {
    if (busyRef.current || closingRef.current) return;
    if (dirtyRef.current) {
      if (!onDirtyCloseRef.current) return;
      closingRef.current = true;
      try {
        if (!(await onDirtyCloseRef.current())) return;
      } finally {
        closingRef.current = false;
      }
    }
    onCloseRef.current();
  }, []);
  useEffect(() => {
    if (!rendered) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    registerDialog(dialogId);
    const focusable = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopDialog(dialogId) || !openRef.current) return;
      if (event.key === 'Escape' && closeOnEscape) {
        event.preventDefault();
        void requestClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0]!;
      const last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      unregisterDialog(dialogId);
      window.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [closeOnEscape, dialogId, rendered, requestClose]);
  if (!rendered || typeof document === 'undefined') return null;
  const drawer = placement === 'right';
  return createPortal(
    <div
      data-overlay-phase={phase}
      className={`${
        drawer
          ? 'fixed inset-0 z-[120] flex justify-end overflow-hidden bg-dd-ink/60 backdrop-blur-sm'
          : 'fixed inset-0 z-[120] grid place-items-center overflow-y-auto bg-dd-ink/60 p-4 backdrop-blur-sm'
      } transition-opacity duration-[160ms] ease-out motion-reduce:duration-75 ${visible ? 'opacity-100' : 'opacity-0'}`}
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget && isTopDialog(dialogId)) {
          void requestClose();
        }
      }}
    >
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        aria-busy={busy || undefined}
        className={`${
          drawer
            ? `flex h-dvh w-full ${className.includes('max-w-') ? '' : 'max-w-xl'} flex-col overflow-hidden border-l border-dd-line bg-dd-surface shadow-dd-float transition-transform duration-[220ms] ease-out motion-reduce:transform-none motion-reduce:duration-75 ${visible ? 'translate-x-0' : 'translate-x-full'}`
            : `flex max-h-[calc(100dvh-2rem)] w-full ${className.includes('max-w-') ? '' : 'max-w-lg'} flex-col overflow-hidden rounded-dd-xl border border-dd-line bg-dd-surface shadow-dd-float transition-[opacity,transform] duration-[180ms] ease-out motion-reduce:transform-none motion-reduce:duration-75 ${visible ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-2 scale-[0.98] opacity-0'}`
        } ${className}`}
      >
        <div
          data-overlay-header
          className="flex shrink-0 items-start justify-between gap-4 border-b border-dd-line bg-dd-surface px-5 py-4 sm:px-6"
        >
          <div>
            <h2 id={titleId} className="text-xl font-semibold text-dd-ink">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-2 text-sm leading-6 text-dd-muted">
                {description}
              </p>
            )}
          </div>
          {showCloseButton && (
            <IconButton
              label="Tutup dialog"
              variant="ghost"
              onClick={() => void requestClose()}
              disabled={busy}
              className="size-11 min-h-[44px] min-w-[44px] rounded-full border border-dd-border-interactive bg-white text-dd-muted hover:border-dd-forest"
            >
              <X className="size-4" />
            </IconButton>
          )}
        </div>
        <div className={`min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6 ${bodyClassName}`}>
          {children}
        </div>
        {footer && (
          <div
            data-overlay-footer
            className="shrink-0 border-t border-dd-line bg-dd-surface px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6"
          >
            {footer}
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}

export function Drawer(props: Parameters<typeof Modal>[0]) {
  return <Modal {...props} placement="right" />;
}

export function PreviewModal(
  props: Omit<Parameters<typeof Modal>[0], 'placement'> & { className?: string },
) {
  return <Modal {...props} className={`max-w-5xl ${props.className ?? ''}`} />;
}

export function DestructiveDialog({
  impact,
  scope,
  children,
  ...props
}: Omit<Parameters<typeof Modal>[0], 'children'> & {
  impact: string;
  scope?: string;
  children: ReactNode;
}) {
  return (
    <Modal
      {...props}
      description={
        props.description ??
        'Tindakan ini berdampak pada data operasional dan akan dicatat dalam audit log.'
      }
    >
      <div className="mb-5 rounded-dd-md border border-dd-danger/30 bg-dd-danger-soft p-4 text-sm text-dd-danger">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div>
            <strong>Dampak</strong>
            <p className="mt-1 leading-6">{impact}</p>
            {scope && <p className="mt-2 font-semibold">Scope: {scope}</p>}
          </div>
        </div>
      </div>
      {children}
    </Modal>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Stored<AppToast>; onDismiss(id: string): void }) {
  const Icon = icons[toast.tone];
  useEffect(() => {
    if (toast.durationMs === 0) return;
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.durationMs ?? 5000);
    return () => window.clearTimeout(timer);
  }, [onDismiss, toast.durationMs, toast.id]);
  return (
    <div
      role={toast.tone === 'danger' ? 'alert' : 'status'}
      className={`pointer-events-auto flex w-full gap-3 rounded-dd-lg border p-4 shadow-dd-float ${toneClasses[toast.tone]}`}
    >
      <Icon className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <strong className="block text-sm">{toast.title}</strong>
        {toast.message && <p className="mt-1 text-sm leading-5 opacity-90">{toast.message}</p>}
        {toast.correlationReference && (
          <p className="mt-2 text-xs opacity-70">Referensi: {toast.correlationReference}</p>
        )}
        {toast.action && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-2"
            onClick={toast.action.onSelect}
          >
            {toast.action.label}
          </Button>
        )}
      </div>
      {toast.dismissible !== false && (
        <IconButton
          label={`Tutup pesan ${toast.title}`}
          variant="ghost"
          size="sm"
          onClick={() => onDismiss(toast.id)}
          className="size-11 min-h-[44px] min-w-[44px] text-current"
        >
          <X className="size-4" />
        </IconButton>
      )}
    </div>
  );
}

export function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Stored<AppToast>[];
  onDismiss(id: string): void;
}) {
  return (
    <div
      role="region"
      aria-label="Pesan aplikasi"
      className="pointer-events-none fixed inset-x-4 top-4 z-[150] ml-auto grid max-w-sm gap-3 sm:left-auto sm:right-5"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

export function AppFeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Stored<AppToast>[]>([]);
  const [alerts, setAlerts] = useState<Stored<AppAlert>[]>([]);
  const [confirmation, setConfirmation] = useState<{
    input: ConfirmationOptions;
    resolve(value: boolean): void;
  } | null>(null);
  const dismiss = useCallback((id: string) => {
    setToasts((items) => items.filter((item) => item.id !== id));
    setAlerts((items) => items.filter((item) => item.id !== id));
  }, []);
  const value = useMemo<FeedbackContextValue>(
    () => ({
      showToast(input) {
        const id = input.id ?? newFeedbackId();
        setToasts((items) => [...items.filter((item) => item.id !== id), { ...input, id }]);
        return id;
      },
      showAlert(input) {
        const id = input.id ?? newFeedbackId();
        setAlerts((items) => [...items.filter((item) => item.id !== id), { ...input, id }]);
        return id;
      },
      confirm(input) {
        return new Promise<boolean>((resolve) => setConfirmation({ input, resolve }));
      },
      dismiss,
      dismissAll() {
        setToasts([]);
        setAlerts([]);
      },
    }),
    [dismiss],
  );
  const currentAlert = confirmation ? undefined : alerts[0];
  const resolveConfirmation = (result: boolean) => {
    confirmation?.resolve(result);
    setConfirmation(null);
  };
  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <Modal
        open={Boolean(currentAlert)}
        title={currentAlert?.title ?? ''}
        description={currentAlert?.message}
        onClose={() => currentAlert && dismiss(currentAlert.id)}
      >
        {currentAlert?.correlationReference && (
          <p className="text-xs text-dd-muted">Referensi: {currentAlert.correlationReference}</p>
        )}
        <div className="mt-5 flex justify-end gap-3">
          {currentAlert?.action && (
            <Button type="button" variant="secondary" onClick={currentAlert.action.onSelect}>
              {currentAlert.action.label}
            </Button>
          )}
          <Button type="button" onClick={() => currentAlert && dismiss(currentAlert.id)}>
            {currentAlert?.closeLabel ?? 'Tutup'}
          </Button>
        </div>
      </Modal>
      <Modal
        open={Boolean(confirmation)}
        title={confirmation?.input.title ?? ''}
        description={confirmation?.input.message}
        onClose={() => resolveConfirmation(false)}
      >
        {confirmation?.input.correlationReference && (
          <p className="text-xs text-dd-muted">
            Referensi: {confirmation.input.correlationReference}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={() => resolveConfirmation(false)}>
            {confirmation?.input.cancelLabel ?? 'Batal'}
          </Button>
          <Button
            type="button"
            onClick={() => resolveConfirmation(true)}
            variant={confirmation?.input.tone === 'danger' ? 'danger' : 'primary'}
          >
            {confirmation?.input.confirmLabel ?? 'Lanjutkan'}
          </Button>
        </div>
      </Modal>
    </FeedbackContext.Provider>
  );
}

export function useAppFeedback() {
  const context = useContext(FeedbackContext);
  if (!context) throw new Error('useAppFeedback must be used within AppFeedbackProvider');
  return context;
}

export function useOptionalAppFeedback() {
  return useContext(FeedbackContext);
}
