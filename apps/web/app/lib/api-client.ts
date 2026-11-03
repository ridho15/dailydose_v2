import { foregroundFetch } from '../components/app-loading';

export type ApiFetchOptions = RequestInit & {
  label?: string;
  idempotent?: boolean;
};

export class ApiError extends Error {
  status: number;
  data: unknown;
  code?: string;

  constructor(message: string, status: number, data?: unknown, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.code = code;
  }
}

export interface ParsedApiError {
  status?: number;
  code?: string;
  message?: string;
  details?: unknown;
  data?: unknown;
}

/**
 * Normalisasi objek error dari berbagai sumber (ApiError, Response, Axios-like { response }, dll.)
 * menjadi struktur terpadu { status, code, message, details, data }.
 */
export function parseApiError(error: unknown): ParsedApiError {
  if (!error) return {};

  const typed = error as {
    status?: number;
    code?: string;
    message?: string;
    data?: unknown;
    response?: {
      status?: number;
      data?: unknown;
    } | Response;
  };

  const status =
    typed.status ??
    (typed.response && typeof typed.response === 'object' && 'status' in typed.response
      ? (typed.response as { status?: number }).status
      : undefined);

  let data = typed.data;
  if (!data && typed.response && typeof typed.response === 'object' && 'data' in typed.response) {
    data = (typed.response as { data?: unknown }).data;
  }

  let code = typed.code;
  let details: unknown = undefined;
  let message = typed.message;

  if (data && typeof data === 'object') {
    const payload = data as Record<string, unknown>;
    const errObj =
      payload.error && typeof payload.error === 'object'
        ? (payload.error as Record<string, unknown>)
        : null;

    if (!code) {
      if (typeof errObj?.code === 'string') code = errObj.code;
      else if (typeof payload.code === 'string') code = payload.code;
    }

    if (errObj?.details !== undefined) details = errObj.details;
    else if (payload.details !== undefined) details = payload.details;

    const serverMessage =
      (typeof errObj?.message === 'string' ? errObj.message : undefined) ??
      (typeof payload.message === 'string' ? payload.message : undefined) ??
      (typeof payload.detail === 'string' ? payload.detail : undefined) ??
      (typeof payload.title === 'string' ? payload.title : undefined);
    if (serverMessage) {
      message = serverMessage;
    }
  }

  return { status, code, message, details, data };
}

/**
 * Universal direct-typed HTTP client helper for Dailydose Web Admin.
 * Handles baseUrl (/api/v1), automatic JSON parsing, credentials, and UI top-loader progress.
 */
export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const { label = 'Memuat data\u2026', idempotent = false, headers, ...rest } = options;
  const url = path.startsWith('/api/')
    ? path
    : `/api/v1${path.startsWith('/') ? path : `/${path}`}`;

  const requestHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...((headers as Record<string, string>) || {}),
  };

  if (options.body && typeof options.body === 'string' && !requestHeaders['Content-Type']) {
    requestHeaders['Content-Type'] = 'application/json';
  }

  if (idempotent && !requestHeaders['idempotency-key']) {
    requestHeaders['idempotency-key'] = crypto.randomUUID();
  }

  const response = await foregroundFetch(
    url,
    {
      credentials: 'include',
      headers: requestHeaders,
      ...rest,
    },
    label,
  );

  if (!response.ok) {
    let errorData: unknown = null;
    let errorMessage = `Request failed with status ${response.status}`;
    let errorCode: string | undefined = undefined;
    try {
      errorData = await response.json();
      if (typeof errorData === 'object' && errorData !== null) {
        const payload = errorData as Record<string, unknown>;
        const errObj =
          payload.error && typeof payload.error === 'object'
            ? (payload.error as Record<string, unknown>)
            : null;

        if (typeof errObj?.code === 'string') errorCode = errObj.code;
        else if (typeof payload.code === 'string') errorCode = payload.code;

        if (typeof errObj?.message === 'string') errorMessage = errObj.message;
        else if (typeof payload.message === 'string') errorMessage = payload.message;
        else if (typeof payload.detail === 'string') errorMessage = payload.detail;
        else if (typeof payload.title === 'string') errorMessage = payload.title;
      }
    } catch {
      // Body is not JSON, use status text
      if (response.statusText) errorMessage = response.statusText;
    }

    throw new ApiError(errorMessage, response.status, errorData, errorCode);
  }

  // Handle empty responses (204 No Content, etc.)
  if (response.status === 204) {
    return undefined as unknown as T;
  }

  const text = await response.text();
  if (!text) {
    return undefined as unknown as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}
