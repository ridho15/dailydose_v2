import { notifySessionFailure } from './session-client';

export type NotificationTone = 'success' | 'info' | 'warning' | 'danger';

export type UserNotification = {
  id: string;
  category: string;
  tone: NotificationTone;
  title: string;
  message: string;
  href: string | null;
  branchId: string | null;
  metadataMasked: unknown;
  readAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

export type UserNotificationPage = {
  items: UserNotification[];
  page: { hasMore: boolean; nextCursor: string | null };
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    credentials: 'include',
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const error = new Error(`NOTIFICATION_REQUEST_${response.status}`);
    (error as any).response = { status: response.status };
    if (response.status === 401) {
      notifySessionFailure(error);
    }
    throw error;
  }
  return response.json() as Promise<T>;
}

export type NotificationClient = {
  list(input?: {
    cursor?: string;
    limit?: number;
    unreadOnly?: boolean;
  }): Promise<UserNotificationPage>;
  unreadCount(): Promise<{ count: number }>;
  markRead(id: string): Promise<UserNotification>;
  markAllRead(): Promise<{ updatedCount: number; readAt: string }>;
};

export const browserNotificationClient: NotificationClient = {
  list(input: { cursor?: string; limit?: number; unreadOnly?: boolean } = {}) {
    const query = new URLSearchParams();
    if (input.cursor) query.set('cursor', input.cursor);
    if (input.limit) query.set('limit', String(input.limit));
    if (input.unreadOnly) query.set('unreadOnly', 'true');
    return request<UserNotificationPage>(`/me/notifications?${query}`);
  },
  unreadCount() {
    return request<{ count: number }>('/me/notifications/unread-count');
  },
  markRead(id: string) {
    return request<UserNotification>(`/me/notifications/${encodeURIComponent(id)}/read`, {
      method: 'PATCH',
    });
  },
  markAllRead() {
    return request<{ updatedCount: number; readAt: string }>('/me/notifications/read-all', {
      method: 'POST',
    });
  },
};

export function getNotificationActionLabel(item: {
  category?: string;
  href?: string | null;
}): string {
  if (!item.href) return '';
  const href = item.href.toLowerCase();
  const cat = (item.category ?? '').toUpperCase();

  if (href.includes('/purchases') || href.includes('/payments')) {
    return 'Verifikasi Pembayaran';
  }
  if (cat === 'PAYMENT' || href.includes('/orders')) {
    return 'Lihat Pesanan';
  }
  if (cat === 'APPROVAL') {
    return 'Tinjau Pengajuan';
  }
  if (cat === 'BOOKING' || href.includes('/bookings')) {
    return 'Lihat Booking';
  }
  if (cat === 'SCHEDULE' || href.includes('/schedule') || href.includes('/classes') || href.includes('/instructor')) {
    return 'Lihat Jadwal';
  }
  if (cat === 'PACKAGE' || href.includes('/packages')) {
    return 'Lihat Paket';
  }
  if (href.includes('/account')) {
    return 'Buka Akun';
  }
  return 'Buka Halaman';
}

