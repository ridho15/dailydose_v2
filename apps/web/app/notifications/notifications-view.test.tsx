import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserNotification } from '@/api-clients/notification-client';
import { canAccessSessionPath } from '../session-context';
import type { WebSession } from '@/api-clients/session-client';

const mockNotification: UserNotification = {
  id: 'notif-123',
  category: 'SYSTEM',
  tone: 'info',
  title: 'Ringkasan Eksekutif Harian',
  message: 'Laporan harian seluruh studio telah diperbarui.',
  href: '/workspace',
  branchId: null,
  metadataMasked: null,
  readAt: null,
  expiresAt: null,
  createdAt: '2026-09-11T08:00:00.000Z',
};

const mockList = vi.fn();
const mockUnreadCount = vi.fn();
const mockMarkRead = vi.fn();
const mockMarkAllRead = vi.fn();

vi.mock('@/api-clients/notification-client', () => ({
  browserNotificationClient: {
    list: (...args: unknown[]) => mockList(...args),
    unreadCount: (...args: unknown[]) => mockUnreadCount(...args),
    markRead: (...args: unknown[]) => mockMarkRead(...args),
    markAllRead: (...args: unknown[]) => mockMarkAllRead(...args),
  },
  getNotificationActionLabel: vi.fn(() => 'Lihat detail'),
}));

// Import component after mock
import { NotificationsView } from './notifications-view';

const createSession = (roles: string[], capabilities: string[] = []): WebSession => ({
  id: 'session-id',
  displayName: 'Test User',
  roles,
  capabilities,
  branchIds: [],
  branches: [],
  preferredBranch: null,
  identityVerificationStatus: 'APPROVED',
  sessionExpiresAt: new Date(Date.now() + 3_600_000),
});

describe('NotificationsView & Route Access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue({
      items: [mockNotification],
      page: { hasMore: false, nextCursor: null },
    });
    mockUnreadCount.mockResolvedValue({ count: 1 });
    mockMarkRead.mockResolvedValue({ ...mockNotification, readAt: new Date().toISOString() });
    mockMarkAllRead.mockResolvedValue({ updatedCount: 1, readAt: new Date().toISOString() });
  });

  describe('route capability authorization', () => {
    it('allows SUPER_OWNER to access /notifications', () => {
      const superOwner = createSession(['SUPER_OWNER'], ['notification:manage', 'user:admin']);
      expect(canAccessSessionPath(superOwner, '/notifications')).toBe(true);
    });

    it('allows ADMIN to access /notifications', () => {
      const admin = createSession(['ADMIN'], ['customer:read']);
      expect(canAccessSessionPath(admin, '/notifications')).toBe(true);
    });

    it('allows CUSTOMER to access /notifications', () => {
      const customer = createSession(['CUSTOMER'], ['customer:self']);
      expect(canAccessSessionPath(customer, '/notifications')).toBe(true);
    });
  });

  describe('component rendering and actions', () => {
    it('renders notification list and unread badge', async () => {
      render(<NotificationsView />);

      expect(await screen.findByRole('heading', { name: 'Notifikasi' })).toBeInTheDocument();
      expect(await screen.findByText('1 belum dibaca')).toBeInTheDocument();
      expect(screen.getByText('Ringkasan Eksekutif Harian')).toBeInTheDocument();
      expect(screen.getByText('Laporan harian seluruh studio telah diperbarui.')).toBeInTheDocument();
    });

    it('allows marking a notification as read', async () => {
      const user = userEvent.setup();
      render(<NotificationsView />);

      const link = await screen.findByRole('link', { name: /Ringkasan Eksekutif Harian/ });
      await user.click(link);

      await waitFor(() => {
        expect(mockMarkRead).toHaveBeenCalledWith('notif-123');
      });
    });

    it('displays empty state when there are no notifications', async () => {
      mockList.mockResolvedValueOnce({
        items: [],
        page: { hasMore: false, nextCursor: null },
      });
      mockUnreadCount.mockResolvedValueOnce({ count: 0 });

      render(<NotificationsView />);

      expect(await screen.findByText('Tidak ada notifikasi')).toBeInTheDocument();
      expect(screen.getByText('Semua sudah dibaca')).toBeInTheDocument();
    });
  });
});
