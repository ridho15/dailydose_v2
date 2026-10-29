/** Fee/jam bawaan bila belum ada konfigurasi fee yang cocok untuk instruktur + tipe kelas. */
export const DEFAULT_INSTRUCTOR_FEE_PER_HOUR_RP = 150_000;

export type InstructorFeeRow = {
  instructorId: string;
  branchId: string;
  classTypeId: string;
  effectiveDate: Date;
  feePerJamRp: number;
};

export type FeeableSlot = {
  startAt: Date;
  endAt: Date;
  branchId: string;
  classTypeId: string;
  instructor: { id: string; displayName: string } | null;
  classType: { name: string } | null;
  instructorAttendance?: unknown;
  instructorFeeRp?: number | null;
  isManualFee?: boolean;
};

export type InstructorFeeSummary = {
  instructorId: string;
  instructorName: string;
  groupHours: number;
  groupFeeRp: number;
  semiPrivateHours: number;
  semiPrivateFeeRp: number;
  privateHours: number;
  privateFeeRp: number;
  totalHours: number;
  totalFeeRp: number;
  verifiedFeeRp: number;
  unverifiedFeeRp: number;
  unverifiedClassCount: number;
  /** Kelas yang honornya memakai fee bawaan karena belum ada konfigurasi fee yang cocok. */
  unconfiguredFeeClassCount: number;
};

/** Rentang bulan (UTC) untuk periode `YYYY-MM`; bulan berjalan bila periode kosong. */
export function periodRange(periodStr?: string) {
  const period = periodStr ?? new Date().toISOString().slice(0, 7);
  const fromDate = new Date(`${period}-01T00:00:00.000Z`);
  const nextMonth = new Date(fromDate);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  return { period, fromDate, nextMonth };
}

export function sortFeesNewestFirst(fees: readonly InstructorFeeRow[]): InstructorFeeRow[] {
  return [...fees].sort((a, b) => b.effectiveDate.getTime() - a.effectiveDate.getTime());
}

export function teachingHours(slot: Pick<FeeableSlot, 'startAt' | 'endAt'>): number {
  return Math.max(1, Math.round((slot.endAt.getTime() - slot.startAt.getTime()) / 3_600_000));
}

/**
 * Fee/jam yang berlaku untuk satu kelas: konfigurasi cabang kelas itu lebih dulu, lalu konfigurasi
 * cabang lain, lalu fee bawaan. `fees` harus sudah urut effectiveDate terbaru lebih dulu.
 *
 * Fee hanya berasal dari Data Master (per instruktur, cabang, dan tipe kelas). Nominal yang dulu
 * bisa diketik di form jadwal (`instructorFeeRp`/`isManualFee`) tidak dipakai lagi.
 */
export function calculateSlotFee(
  sortedFees: readonly InstructorFeeRow[],
  slot: Pick<
    FeeableSlot,
    'startAt' | 'endAt' | 'branchId' | 'classTypeId' | 'instructorFeeRp' | 'isManualFee'
  > & { instructorId: string },
) {
  const hours = teachingHours(slot);

  const applicable = (f: InstructorFeeRow) =>
    f.instructorId === slot.instructorId &&
    f.classTypeId === slot.classTypeId &&
    f.effectiveDate <= slot.startAt;
  const matched =
    sortedFees.find((f) => applicable(f) && f.branchId === slot.branchId) ??
    sortedFees.find(applicable);
  const feePerJamRp = matched?.feePerJamRp ?? DEFAULT_INSTRUCTOR_FEE_PER_HOUR_RP;
  return {
    hours,
    feePerJamRp,
    feeRp: hours * feePerJamRp,
    configured: Boolean(matched),
    isManual: false,
  };
}

/**
 * Honor per instruktur dari kelas yang sudah selesai. Hanya kelas dengan presensi instruktur (QR
 * dipindai atau diverifikasi) yang masuk total honor dan beban payroll; kelas selesai tanpa
 * presensi dicatat terpisah sebagai "belum terverifikasi" supaya bisa diverifikasi dulu.
 */
export function summarizeInstructorFees(
  slots: readonly FeeableSlot[],
  fees: readonly InstructorFeeRow[],
): InstructorFeeSummary[] {
  const sortedFees = sortFeesNewestFirst(fees);
  const byInstructor = new Map<string, InstructorFeeSummary>();

  for (const slot of slots) {
    if (!slot.instructor) continue;
    const { id, displayName } = slot.instructor;
    let entry = byInstructor.get(id);
    if (!entry) {
      entry = {
        instructorId: id,
        instructorName: displayName,
        groupHours: 0,
        groupFeeRp: 0,
        semiPrivateHours: 0,
        semiPrivateFeeRp: 0,
        privateHours: 0,
        privateFeeRp: 0,
        totalHours: 0,
        totalFeeRp: 0,
        verifiedFeeRp: 0,
        unverifiedFeeRp: 0,
        unverifiedClassCount: 0,
        unconfiguredFeeClassCount: 0,
      };
      byInstructor.set(id, entry);
    }

    const { hours, feeRp, configured } = calculateSlotFee(sortedFees, { ...slot, instructorId: id });
    if (!slot.instructorAttendance) {
      entry.unverifiedFeeRp += feeRp;
      entry.unverifiedClassCount += 1;
      continue;
    }
    entry.totalHours += hours;
    entry.totalFeeRp += feeRp;
    entry.verifiedFeeRp += feeRp;
    if (!configured) entry.unconfiguredFeeClassCount += 1;

    const typeName = (slot.classType?.name ?? '').toLowerCase();
    if (typeName.includes('semi')) {
      entry.semiPrivateHours += hours;
      entry.semiPrivateFeeRp += feeRp;
    } else if (typeName.includes('private')) {
      entry.privateHours += hours;
      entry.privateFeeRp += feeRp;
    } else {
      entry.groupHours += hours;
      entry.groupFeeRp += feeRp;
    }
  }

  return Array.from(byInstructor.values());
}
