import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DetailPanel } from './class-slot-panels';
import { AppFeedbackProvider } from '@/components/app-feedback';
import type { ClassSlot } from '@/api-clients/class-slot-client';

const now = new Date();
const confirmedSlotWithBookings: ClassSlot = {
  id: 'slot-confirmed-1',
  branchId: 'branch-1',
  classTypeId: 'type-1',
  instructorUserId: 'instructor-1',
  startAt: new Date(now.getTime() + 2 * 3600 * 1000),
  endAt: new Date(now.getTime() + 3 * 3600 * 1000),
  timezone: 'Asia/Jakarta',
  status: 'CONFIRMED',
  minimumQuota: 1,
  capacity: 2,
  bookedCount: 2,
  cancellationReasonCode: null,
  version: 2,
  idempotentReplay: false,
};

const completedSlot: ClassSlot = {
  ...confirmedSlotWithBookings,
  id: 'slot-completed-1',
  status: 'COMPLETED',
  startAt: new Date(now.getTime() - 4 * 3600 * 1000),
  endAt: new Date(now.getTime() - 3 * 3600 * 1000),
};

const classTypes = [{ id: 'type-1', code: 'REF', name: 'Reformer' }];
const instructors = [{ id: 'instructor-1', displayName: 'Lucia' }];

describe('Super Admin Class Schedule Edit Override', () => {
  it('allows Super Admin to edit a confirmed class that already has bookings (inputs are unlocked)', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(undefined);

    render(
      <AppFeedbackProvider>
        <DetailPanel
          slot={confirmedSlotWithBookings}
          instructorName="Lucia"
          classTypes={classTypes}
          instructors={instructors}
          canManage={true}
          canComplete={false}
          canManageAttendance={false}
          canReadBookings={true}
          isSuperOwner={true}
          busy={false}
          onAssign={vi.fn()}
          onUpdate={onUpdate}
          onPublish={vi.fn()}
          onCancel={vi.fn()}
          onComplete={vi.fn()}
        />
      </AppFeedbackProvider>,
    );

    // Super Admin should see the Super Admin Edit button instead of "Ubah kapasitas kelas"
    const editBtn = screen.getByRole('button', { name: 'Edit kelas (Super Admin)' });
    expect(editBtn).toBeInTheDocument();
    await user.click(editBtn);

    // Form should be rendered
    const form = screen.getByRole('form', { name: 'Edit draft kelas' });
    expect(form).toBeInTheDocument();

    // Mode Super Admin notification is visible
    expect(screen.getByText(/Mode Super Admin:/)).toBeInTheDocument();

    // Inputs should NOT be disabled for Super Admin
    expect(within(form).getByLabelText('Tanggal')).not.toBeDisabled();
    expect(within(form).getByLabelText('Mulai')).not.toBeDisabled();
    expect(within(form).getByLabelText('Selesai')).not.toBeDisabled();
  });

  it('keeps schedule inputs locked for normal staff when a class already has bookings', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(undefined);

    render(
      <AppFeedbackProvider>
        <DetailPanel
          slot={confirmedSlotWithBookings}
          instructorName="Lucia"
          classTypes={classTypes}
          instructors={instructors}
          canManage={true}
          canComplete={false}
          canManageAttendance={false}
          canReadBookings={true}
          isSuperOwner={false}
          busy={false}
          onAssign={vi.fn()}
          onUpdate={onUpdate}
          onPublish={vi.fn()}
          onCancel={vi.fn()}
          onComplete={vi.fn()}
        />
      </AppFeedbackProvider>,
    );

    // Normal staff should see "Ubah kapasitas kelas"
    const capBtn = screen.getByRole('button', { name: 'Ubah kapasitas kelas' });
    expect(capBtn).toBeInTheDocument();
    await user.click(capBtn);

    const form = screen.getByRole('form', { name: 'Edit draft kelas' });
    expect(form).toBeInTheDocument();

    // Schedule inputs should be disabled for normal staff
    expect(within(form).getByLabelText('Tanggal')).toBeDisabled();
    expect(within(form).getByLabelText('Mulai')).toBeDisabled();
    expect(within(form).getByLabelText('Selesai')).toBeDisabled();
  });

  it('allows Super Admin to edit a COMPLETED class for historical corrections', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(undefined);

    render(
      <AppFeedbackProvider>
        <DetailPanel
          slot={completedSlot}
          instructorName="Lucia"
          classTypes={classTypes}
          instructors={instructors}
          canManage={true}
          canComplete={false}
          canManageAttendance={false}
          canReadBookings={true}
          isSuperOwner={true}
          busy={false}
          onAssign={vi.fn()}
          onUpdate={onUpdate}
          onPublish={vi.fn()}
          onCancel={vi.fn()}
          onComplete={vi.fn()}
        />
      </AppFeedbackProvider>,
    );

    const editBtn = screen.getByRole('button', { name: 'Edit kelas (Super Admin)' });
    expect(editBtn).toBeInTheDocument();
    await user.click(editBtn);

    const form = screen.getByRole('form', { name: 'Edit draft kelas' });
    expect(form).toBeInTheDocument();
    expect(within(form).getByLabelText('Tanggal')).not.toBeDisabled();
  });
});
