import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ClassSlot } from '@/api-clients/class-slot-client';
import { TimetableWeekGrid } from './timetable-week-grid';
import { TimetableRosterPanel } from './timetable-roster-panel';

const TZ = 'Asia/Jakarta';

const mockSlot = (over: Partial<ClassSlot> = {}): ClassSlot => ({
  id: 'slot-1',
  branchId: 'b-1',
  classTypeId: 'ct-1',
  studioId: 's-1',
  instructorUserId: 'inst-1',
  startAt: new Date('2026-11-03T02:00:00.000Z'), // 09:00 WIB
  endAt: new Date('2026-11-03T03:00:00.000Z'),   // 10:00 WIB
  timezone: TZ,
  status: 'PUBLISHED',
  minimumQuota: 2,
  capacity: 8,
  bookedCount: 3,
  version: 1,
  ...over,
});

describe('Instructor check-in visibility in TimetableWeekGrid', () => {
  const defaultGridProps = {
    days: ['2026-11-03'],
    hours: [9],
    todayKey: '2026-11-03',
    posisi: (_s: ClassSlot) => ({ hari: '2026-11-03', jam: 9 }),
    tertunda: {},
    selectedId: null,
    canMove: false,
    namaTipe: (_s: ClassSlot) => 'Reformer Flow',
    namaInstruktur: (_s: ClassSlot) => 'Coach Budi',
    onSelect: vi.fn(),
    onStage: vi.fn(),
  };

  it('renders "instruktur belum check-in" in aria-label when instructor has not checked in', () => {
    const slot = mockSlot();
    render(<TimetableWeekGrid {...defaultGridProps} slots={[slot]} />);

    const button = screen.getByRole('button', {
      name: /Reformer Flow, Coach Budi\. instruktur belum check-in\./,
    });
    expect(button).toBeInTheDocument();
    expect(screen.queryByText('Hadir')).not.toBeInTheDocument();
  });

  it('renders green "Hadir" badge and "instruktur hadir pk ..." when instructor attendance is recorded', () => {
    const slot = mockSlot({
      instructorAttendance: {
        checkedInAt: '2026-11-03T01:50:00.000Z', // 08:50 WIB
        method: 'QR_SCAN',
      },
    });

    render(<TimetableWeekGrid {...defaultGridProps} slots={[slot]} />);

    const button = screen.getByRole('button', {
      name: /Reformer Flow, Coach Budi\. instruktur hadir pk 08\.50\./,
    });
    expect(button).toBeInTheDocument();
    expect(screen.getByText('Hadir')).toBeInTheDocument();
  });
});

describe('Instructor check-in in TimetableRosterPanel', () => {
  const dummyClient = {
    list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  };

  it('displays "Belum check-in" status and quick "Tandai hadir" action when staff has capability', async () => {
    const user = userEvent.setup();
    const onVerify = vi.fn().mockResolvedValue(undefined);
    const onChanged = vi.fn();
    const slot = mockSlot();

    render(
      <TimetableRosterPanel
        slot={slot}
        classTypeName="Reformer Flow"
        instructorName="Coach Budi"
        studioName="Studio 1"
        client={dummyClient}
        canAdd={false}
        canRemove={false}
        canManageClass={false}
        canVerifyInstructor={true}
        onVerifyInstructor={onVerify}
        onManage={vi.fn()}
        onChanged={onChanged}
      />,
    );

    expect(screen.getByText('Status instruktur:')).toBeInTheDocument();
    expect(screen.getByText('Belum check-in')).toBeInTheDocument();

    const verifyBtn = screen.getByRole('button', { name: 'Tandai hadir' });
    expect(verifyBtn).toBeInTheDocument();

    await user.click(verifyBtn);

    await waitFor(() => {
      expect(onVerify).toHaveBeenCalledTimes(1);
      expect(onChanged).toHaveBeenCalledTimes(1);
    });
  });

  it('displays confirmed attendance badge when already checked in', () => {
    const slot = mockSlot({
      instructorAttendance: {
        checkedInAt: '2026-11-03T01:55:00.000Z',
        method: 'QR_SCAN',
      },
    });

    render(
      <TimetableRosterPanel
        slot={slot}
        classTypeName="Reformer Flow"
        instructorName="Coach Budi"
        studioName="Studio 1"
        client={dummyClient}
        canAdd={false}
        canRemove={false}
        canManageClass={false}
        canVerifyInstructor={true}
        onVerifyInstructor={vi.fn()}
        onManage={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    expect(screen.getByText(/Hadir pk 08\.55 \(scan QR\)/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tandai hadir' })).not.toBeInTheDocument();
  });
});
