import {
  calculateSlotFee,
  DEFAULT_INSTRUCTOR_FEE_PER_HOUR_RP,
  periodRange,
  sortFeesNewestFirst,
  summarizeInstructorFees,
  type FeeableSlot,
  type InstructorFeeRow,
} from './instructor-fee-calculator';

const coach = { id: 'coach-1', displayName: 'Coach Sarah' };
const fee = (over: Partial<InstructorFeeRow> = {}): InstructorFeeRow => ({
  instructorId: coach.id,
  branchId: 'branch-a',
  classTypeId: 'group',
  effectiveDate: new Date('2026-01-01T00:00:00Z'),
  feePerJamRp: 200_000,
  ...over,
});
const slot = (over: Partial<FeeableSlot> = {}): FeeableSlot => ({
  startAt: new Date('2026-09-10T02:00:00Z'),
  endAt: new Date('2026-09-10T03:00:00Z'),
  branchId: 'branch-a',
  classTypeId: 'group',
  instructor: coach,
  classType: { name: 'Group Class' },
  instructorAttendance: { id: 'att' },
  ...over,
});
const withId = (s: FeeableSlot) => ({ ...s, instructorId: coach.id });

describe('calculateSlotFee', () => {
  it('prefers the fee configured for the class\'s own branch over another branch', () => {
    const fees = sortFeesNewestFirst([
      fee({ branchId: 'branch-b', feePerJamRp: 999_000 }),
      fee({ branchId: 'branch-a', feePerJamRp: 200_000 }),
    ]);
    expect(calculateSlotFee(fees, withId(slot())).feePerJamRp).toBe(200_000);
  });

  it('falls back to a fee configured in another branch, then to the default', () => {
    const other = sortFeesNewestFirst([fee({ branchId: 'branch-b', feePerJamRp: 180_000 })]);
    expect(calculateSlotFee(other, withId(slot()))).toMatchObject({ feePerJamRp: 180_000, configured: true });
    expect(calculateSlotFee([], withId(slot()))).toMatchObject({
      feePerJamRp: DEFAULT_INSTRUCTOR_FEE_PER_HOUR_RP,
      configured: false,
    });
  });

  it('uses the newest fee already effective at class start, ignoring future ones', () => {
    const fees = sortFeesNewestFirst([
      fee({ effectiveDate: new Date('2026-01-01T00:00:00Z'), feePerJamRp: 100_000 }),
      fee({ effectiveDate: new Date('2026-09-01T00:00:00Z'), feePerJamRp: 150_000 }),
      fee({ effectiveDate: new Date('2026-10-01T00:00:00Z'), feePerJamRp: 300_000 }),
    ]);
    expect(calculateSlotFee(fees, withId(slot())).feePerJamRp).toBe(150_000);
  });

  it('never matches another instructor or class type', () => {
    const fees = sortFeesNewestFirst([
      fee({ instructorId: 'someone-else' }),
      fee({ classTypeId: 'private' }),
    ]);
    expect(calculateSlotFee(fees, withId(slot())).configured).toBe(false);
  });

  it('ignores the old per-slot manual fee; the fee always comes from master data', () => {
    const fees = sortFeesNewestFirst([fee({ feePerJamRp: 500_000 })]);
    const manualSlot = withId(
      slot({
        isManualFee: true,
        instructorFeeRp: 350_000,
      }),
    );
    const result = calculateSlotFee(fees, manualSlot);
    expect(result.feeRp).toBe(500_000);
    expect(result.isManual).toBe(false);
    expect(result.configured).toBe(true);
  });

  it('bills at least one hour and rounds to whole hours', () => {
    const short = slot({ endAt: new Date('2026-09-10T02:20:00Z') });
    const long = slot({ endAt: new Date('2026-09-10T04:30:00Z') });
    expect(calculateSlotFee([], withId(short)).hours).toBe(1);
    expect(calculateSlotFee([], withId(long)).hours).toBe(3);
  });
});

describe('summarizeInstructorFees', () => {
  it('counts only classes with instructor attendance; unverified ones are reported apart', () => {
    const [row] = summarizeInstructorFees(
      [slot(), slot({ instructorAttendance: null })],
      [fee()],
    );
    expect(row).toMatchObject({
      totalHours: 1,
      totalFeeRp: 200_000,
      verifiedFeeRp: 200_000,
      unverifiedFeeRp: 200_000,
      unverifiedClassCount: 1,
      unconfiguredFeeClassCount: 0,
    });
  });

  it('counts classes billed at the default fee as unconfigured', () => {
    const [row] = summarizeInstructorFees([slot(), slot({ classTypeId: 'private' })], [fee()]);
    expect(row?.unconfiguredFeeClassCount).toBe(1);
    expect(row?.totalFeeRp).toBe(200_000 + DEFAULT_INSTRUCTOR_FEE_PER_HOUR_RP);
  });

  it('buckets hours and fees by class type name and skips classes without an instructor', () => {
    const [row, ...rest] = summarizeInstructorFees(
      [
        slot({ classType: { name: 'Semi Private Class' } }),
        slot({ classType: { name: 'Private Class' } }),
        slot({ classType: { name: 'Group Class' } }),
        slot({ instructor: null }),
      ],
      [fee()],
    );
    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({
      semiPrivateHours: 1,
      privateHours: 1,
      groupHours: 1,
      totalHours: 3,
    });
  });

  it('groups by instructor', () => {
    const rows = summarizeInstructorFees(
      [slot(), slot({ instructor: { id: 'coach-2', displayName: 'Coach Devi' } })],
      [],
    );
    expect(rows.map((r) => r.instructorId).sort()).toEqual(['coach-1', 'coach-2']);
  });
});

describe('periodRange', () => {
  it('returns the UTC month window', () => {
    const { period, fromDate, nextMonth } = periodRange('2026-12');
    expect(period).toBe('2026-12');
    expect(fromDate.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(nextMonth.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('defaults to the current month', () => {
    expect(periodRange().period).toBe(new Date().toISOString().slice(0, 7));
  });
});
