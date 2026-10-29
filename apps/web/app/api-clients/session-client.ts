import { appLoading } from '../components/app-loading';

export type SessionStatus =
  'loading' | 'authenticated' | 'unauthenticated' | 'expired' | 'dependency-error';

export interface SessionBranch {
  id: string;
  code: string;
  name: string;
  timezone: string;
}

export interface PreferredStudio extends SessionBranch {
  supportWhatsappE164: string | null;
}

export interface WebSession {
  id: string;
  displayName: string;
  roles: string[];
  branchIds: string[];
  capabilities: string[];
  globalCapabilities?: string[];
  identityVerificationStatus?:
    | 'NOT_REQUIRED'
    | 'PENDING'
    | 'ACTION_REQUIRED'
    | 'APPROVED'
    | 'REJECTED';
  sessionExpiresAt: Date;
  branches: SessionBranch[];
  preferredBranch?: PreferredStudio | null;
  passwordChangeRequired?: boolean;
  /** Member belum punya nomor WhatsApp (biasanya daftar lewat Google); wajib dilengkapi dulu. */
  phoneRequired?: boolean;
}

export interface SessionClient {
  me(): Promise<WebSession>;
  logout(): Promise<void>;
}

async function sessionFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
    ...init,
  });
  if (!response.ok) {
    const error = new Error(`Session request failed: ${response.status}`);
    (error as any).response = { status: response.status };
    throw error;
  }
  if (response.status === 204) {
    return undefined as unknown as T;
  }
  return response.json() as Promise<T>;
}

export function hasSessionHint(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const fromLocal =
      typeof localStorage !== 'undefined' && localStorage.getItem('dd_session_hint') === '1';
    const fromSession =
      typeof sessionStorage !== 'undefined' && sessionStorage.getItem('dd_session_hint') === '1';
    return Boolean(fromLocal || fromSession);
  } catch {
    return false;
  }
}

export function setSessionHint(): void {
  if (typeof window === 'undefined') return;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem('dd_session_hint', '1');
  } catch {}
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('dd_session_hint', '1');
  } catch {}
}

export function clearSessionHint(): void {
  if (typeof window === 'undefined') return;
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem('dd_session_hint');
  } catch {}
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem('dd_session_hint');
  } catch {}
}

export const browserSessionClient: SessionClient = {
  async me() {
    const fetchMe = async (): Promise<any> => {
      let attempts = 0;
      while (true) {
        try {
          return await appLoading.track(sessionFetch<any>('/me'), {
            label: 'Memuat sesi…',
          });
        } catch (err: any) {
          const status = err?.response?.status;
          if (status === 500 && attempts < 2) {
            attempts++;
            await new Promise((r) => setTimeout(r, attempts * 300));
            continue;
          }
          throw err;
        }
      }
    };

    let value: Omit<WebSession, 'sessionExpiresAt'> & { sessionExpiresAt: Date | string };
    try {
      value = (await fetchMe()) as unknown as typeof value;
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status !== 401) throw error;

      // Jika status 401 dan tidak ada hint sesi aktif, jangan memicu panggilan /auth/refresh yang sia-sia
      if (!hasSessionHint()) {
        clearSessionHint();
        throw error;
      }

      try {
        await appLoading.track(sessionFetch<void>('/auth/refresh', { method: 'POST' }), {
          label: 'Memperbarui sesi…',
        });
      } catch (refreshError) {
        clearSessionHint();
        throw refreshError;
      }

      value = (await fetchMe()) as unknown as typeof value;
    }
    setSessionHint();
    return { ...value, sessionExpiresAt: new Date(value.sessionExpiresAt) };
  },
  async logout() {
    clearSessionHint();
    await appLoading.track(sessionFetch<void>('/auth/logout', { method: 'POST' }), {
      label: 'Keluar dari akun…',
    });
  },
};

export function sessionFailure(
  error: unknown,
): Exclude<SessionStatus, 'loading' | 'authenticated'> {
  const status = (error as { response?: { status?: number } })?.response?.status;
  return status === 401 ? 'unauthenticated' : 'dependency-error';
}

export function notifySessionFailure(error: unknown): void {
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (status === 401 && typeof window !== 'undefined') {
    clearSessionHint();
    window.dispatchEvent(new CustomEvent('dd-session-revoked'));
  }
}
