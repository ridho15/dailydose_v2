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
  instructorAttendance: { id: 'att', instructorId: coach.id },
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

  it('ignores a fee configured only in another branch and uses the default', () => {
    const other = sortFeesNewestFirst([fee({ branchId: 'branch-b', feePerJamRp: 180_000 })]);
    expect(calculateSlotFee(other, withId(slot()))).toMatchObject({
      feePerJamRp: DEFAULT_INSTRUCTOR_FEE_PER_HOUR_RP,
      configured: false,
    });
  });

  it('applies a fee from the WIB calendar date, so a 06:00 WIB class on the effective date gets the new rate', () => {
    const fees = sortFeesNewestFirst([
      fee({ effectiveDate: new Date('2026-01-01T00:00:00Z'), feePerJamRp: 100_000 }),
      fee({ effectiveDate: new Date('2026-09-10T00:00:00Z'), feePerJamRp: 250_000 }),
    ]);
    // 06:00 WIB = 23:00 UTC hari sebelumnya, tetapi tanggal WIB-nya 10 September.
    const pagi = slot({
      startAt: new Date('2026-09-09T23:00:00Z'),
      endAt: new Date('2026-09-10T00:00:00Z'),
    });
    expect(calculateSlotFee(fees, withId(pagi)).feePerJamRp).toBe(250_000);
    // 23:00 WIB tanggal 9 masih tarif lama.
    const malam = slot({
      startAt: new Date('2026-09-09T16:00:00Z'),
      endAt: new Date('2026-09-09T17:00:00Z'),
    });
    expect(calculateSlotFee(fees, withId(malam)).feePerJamRp).toBe(100_000);
  });

  it('breaks ties between same-date fee versions by newest createdAt, then id', () => {
    const sama = new Date('2026-01-01T00:00:00Z');
    const urut = sortFeesNewestFirst([
      fee({ id: 'a', effectiveDate: sama, createdAt: new Date('2026-01-02'), feePerJamRp: 1 }),
      fee({ id: 'b', effectiveDate: sama, createdAt: new Date('2026-01-03'), feePerJamRp: 2 }),
      fee({ id: 'c', effectiveDate: sama, createdAt: new Date('2026-01-03'), feePerJamRp: 3 }),
    ]);
    expect(urut.map((f) => f.id)).toEqual(['c', 'b', 'a']);
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

describe('summarizeInstructorFees: presensi milik instruktur lain', () => {
  it('tidak membayar honor bila presensi dicatat atas instruktur lain', () => {
    const [hasil] = summarizeInstructorFees(
      [slot({ instructorAttendance: { id: 'att', instructorId: 'coach-lain' } })],
      [fee()],
    );
    expect(hasil).toMatchObject({ totalFeeRp: 0, unverifiedClassCount: 1, unverifiedFeeRp: 200_000 });
  });
});

describe('Rekonsiliasi Kasus Instruktur Yoan & Lulu (Kelas 3 & 4 Nov 2026)', () => {
  const pik2 = 'a1000000-0000-4000-8000-000000000005';
  const privateGroupType = 'c1000000-0000-4000-8000-000000000004';
  const yoan = { id: '10000000-0000-4000-8000-000000005174', displayName: 'Yoan' };
  const lulu = { id: '10000000-0000-4000-8000-000000004033', displayName: 'Lulu' };

  // Kelas Yoan: 3 Nov 19:00-20:00 WIB (12:00-13:00 UTC)
  const yoanSlot = (attendance = false): FeeableSlot => ({
    startAt: new Date('2026-11-03T12:00:00Z'),
    endAt: new Date('2026-11-03T13:00:00Z'),
    branchId: pik2,
    classTypeId: privateGroupType,
    instructor: yoan,
    classType: { name: 'Private Group' },
    instructorAttendance: attendance ? { id: 'att-yoan', instructorId: yoan.id } : null,
  });

  // Kelas Lulu: 4 Nov 08:00-08:50 WIB & 09:00-09:50 WIB (masing-masing dihitung minimum 1 jam)
  const luluSlot1: FeeableSlot = {
    startAt: new Date('2026-11-04T01:00:00Z'),
    endAt: new Date('2026-11-04T01:50:00Z'),
    branchId: pik2,
    classTypeId: privateGroupType,
    instructor: lulu,
    classType: { name: 'Private Group' },
    instructorAttendance: { id: 'att-lulu-1', instructorId: lulu.id },
  };
  const luluSlot2: FeeableSlot = {
    startAt: new Date('2026-11-04T02:00:00Z'),
    endAt: new Date('2026-11-04T02:50:00Z'),
    branchId: pik2,
    classTypeId: privateGroupType,
    instructor: lulu,
    classType: { name: 'Private Group' },
    instructorAttendance: { id: 'att-lulu-2', instructorId: lulu.id },
  };

  it('sebelum ada konfigurasi tarif: keduanya memakai tarif bawaan Rp 150.000', () => {
    const summary = summarizeInstructorFees([yoanSlot(false), luluSlot1, luluSlot2], []);
    const yoanSummary = summary.find((s) => s.instructorId === yoan.id);
    const luluSummary = summary.find((s) => s.instructorId === lulu.id);

    // Yoan belum presensi: masuk unverifiedFeeRp dengan tarif bawaan Rp 150.000
    expect(yoanSummary).toMatchObject({
      instructorName: 'Yoan',
      totalFeeRp: 0,
      unverifiedFeeRp: 150_000,
      unverifiedClassCount: 1,
    });

    // Lulu sudah presensi: 2 kelas x 1 jam (minimal 1 jam) x Rp 150.000 = Rp 300.000
    expect(luluSummary).toMatchObject({
      instructorName: 'Lulu',
      totalFeeRp: 300_000,
      verifiedFeeRp: 300_000,
      unconfiguredFeeClassCount: 2,
    });
  });

  it('setelah dipasang tarif khusus Rp 175.000 dan presensi divalidasi: honor terhitung sesuai tarif master', () => {
    const configuredFees: InstructorFeeRow[] = [
      {
        instructorId: yoan.id,
        branchId: pik2,
        classTypeId: privateGroupType,
        effectiveDate: new Date('2026-11-01T00:00:00Z'),
        feePerJamRp: 175_000,
      },
      {
        instructorId: lulu.id,
        branchId: pik2,
        classTypeId: privateGroupType,
        effectiveDate: new Date('2026-11-01T00:00:00Z'),
        feePerJamRp: 175_000,
      },
    ];

    // Presensi Yoan divalidasi
    const summary = summarizeInstructorFees([yoanSlot(true), luluSlot1, luluSlot2], configuredFees);
    const yoanSummary = summary.find((s) => s.instructorId === yoan.id);
    const luluSummary = summary.find((s) => s.instructorId === lulu.id);

    // Yoan: 1 jam x Rp 175.000 = Rp 175.000 (verified)
    expect(yoanSummary).toMatchObject({
      instructorName: 'Yoan',
      totalFeeRp: 175_000,
      verifiedFeeRp: 175_000,
      unverifiedFeeRp: 0,
      unconfiguredFeeClassCount: 0,
    });

    // Lulu: 2 jam x Rp 175.000 = Rp 350.000 (verified)
    expect(luluSummary).toMatchObject({
      instructorName: 'Lulu',
      totalFeeRp: 350_000,
      verifiedFeeRp: 350_000,
      unconfiguredFeeClassCount: 0,
    });
  });
});
