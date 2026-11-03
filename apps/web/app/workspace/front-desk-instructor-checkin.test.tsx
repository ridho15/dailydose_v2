import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppFeedbackProvider } from '../components/app-feedback';
import type { ClassSlotClient, ClassWorkspace } from '../api-clients/class-slot-client';
import type { BookingClient } from '../api-clients/booking-client';
import type { DashboardClient } from '../api-clients/dashboard-client';
import { FrontDeskTodayView } from './front-desk-today-view';

const capabilities = vi.hoisted(() => ({
  list: ['attendance:manage', 'class-slot:read', 'booking:read'] as string[],
}));

const branch = {
  id: 'branch-1',
  code: 'DD-GG',
  name: 'Daily Dose Green Garden',
  timezone: 'Asia/Jakarta',
};

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('../session-context', () => ({
  useSessionContext: () => ({
    session: {
      id: 'u-admin',
      displayName: 'Admin Meja Depan',
      roles: ['ADMIN'],
      branches: [branch],
    },
    activeBranchId: 'branch-1',
    activeBranch: branch,
    hasCapability: (cap: string) => capabilities.list.includes(cap),
  }),
}));

const now = new Date('2026-10-27T04:30:00.000Z'); // 11:30 WIB

const mockSlot = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  branchId: 'branch-1',
  classTypeId: 'type-1',
  studioId: 'studio-1',
  instructorUserId: 'inst-1',
  startAt: new Date('2026-10-27T04:00:00.000Z'), // 11:00 WIB
  endAt: new Date('2026-10-27T05:00:00.000Z'),   // 12:00 WIB
  timezone: 'Asia/Jakarta',
  status: 'CONFIRMED',
  minimumQuota: 2,
  capacity: 6,
  bookedCount: 3,
  version: 1,
  ...over,
});

describe('FrontDeskTodayView - Instructor Check-in Visibility & Verification', () => {
  beforeEach(() => {
    capabilities.list = ['attendance:manage', 'class-slot:read', 'booking:read'];
  });

  it('renders instructor "Belum check-in" status and "Tandai hadir" action on running class', async () => {
    const user = userEvent.setup();
    const verifyMock = vi.fn().mockResolvedValue({
      classSlotId: 'slot-running',
      checkedInAt: '2026-10-27T04:25:00.000Z',
      method: 'MANUAL_FRONTDESK',
      verifiedByUserId: 'u-admin',
    });

    const mockClassClient = {
      discover: vi.fn().mockResolvedValue({
        slots: [mockSlot('slot-running')],
        classTypes: [{ id: 'type-1', code: 'RF', name: 'Reformer Flow' }],
        instructors: [{ id: 'inst-1', displayName: 'Coach Sarah' }],
        studios: [{ id: 'studio-1', branchId: 'branch-1', code: 'S1', name: 'Studio Utama', rooms: [] }],
      }),
      verifyInstructorAttendance: verifyMock,
    } as unknown as ClassSlotClient;

    const mockBookingClient = {
      list: vi.fn().mockResolvedValue({ items: [] }),
    } as unknown as BookingClient;

    const mockDashboardClient = {
      overview: vi.fn().mockResolvedValue({ queues: [] }),
    } as unknown as DashboardClient;

    render(
      <AppFeedbackProvider>
        <FrontDeskTodayView
          client={mockClassClient}
          bookingClient={mockBookingClient}
          dashboardClient={mockDashboardClient}
          initialNow={now}
        />
      </AppFeedbackProvider>,
    );

    // Assert initial un-checked-in state in selected class card
    await waitFor(() => {
      expect(screen.getByText('Status instruktur:')).toBeInTheDocument();
      expect(screen.getByText('Belum check-in')).toBeInTheDocument();
    });

    const verifyBtn = screen.getByRole('button', { name: 'Tandai hadir' });
    expect(verifyBtn).toBeInTheDocument();

    await user.click(verifyBtn);

    // Confirm dialog appears
    const confirmBtn = await screen.findByRole('button', { name: 'Verifikasi' });
    expect(confirmBtn).toBeInTheDocument();
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(verifyMock).toHaveBeenCalledWith('slot-running');
      expect(screen.getByText(/Hadir pk 11\.25 \(manual\)/)).toBeInTheDocument();
    });
  });

  it('renders "Hadir" badge when slot already has instructor attendance recorded', async () => {
    const slotWithAttendance = mockSlot('slot-attended', {
      instructorAttendance: {
        checkedInAt: '2026-10-27T03:55:00.000Z', // 10:55 WIB
        method: 'QR_SCAN',
      },
    });

    const mockClassClient = {
      discover: vi.fn().mockResolvedValue({
        slots: [slotWithAttendance],
        classTypes: [{ id: 'type-1', code: 'RF', name: 'Reformer Flow' }],
        instructors: [{ id: 'inst-1', displayName: 'Coach Sarah' }],
        studios: [{ id: 'studio-1', branchId: 'branch-1', code: 'S1', name: 'Studio Utama', rooms: [] }],
      }),
    } as unknown as ClassSlotClient;

    const mockBookingClient = {
      list: vi.fn().mockResolvedValue({ items: [] }),
    } as unknown as BookingClient;

    const mockDashboardClient = {
      overview: vi.fn().mockResolvedValue({ queues: [] }),
    } as unknown as DashboardClient;

    render(
      <AppFeedbackProvider>
        <FrontDeskTodayView
          client={mockClassClient}
          bookingClient={mockBookingClient}
          dashboardClient={mockDashboardClient}
          initialNow={now}
        />
      </AppFeedbackProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Hadir pk 10\.55 \(scan QR\)/)).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: 'Tandai hadir' })).not.toBeInTheDocument();
  });
});
