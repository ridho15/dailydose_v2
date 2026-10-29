import { createHash } from 'node:crypto';
import {
  checkInWindowState,
  isOwningInstructor,
  isOwningCustomer,
  AttendanceService,
} from './kehadiran.service';
import { AvailabilityService } from '../classes/ketersediaan-instruktur.service';
import { PolicyService } from '../identity/policy.service';
import { ApiProblem } from '../identity/security';
import {
  calculateSlotFee,
  DEFAULT_INSTRUCTOR_FEE_PER_HOUR_RP,
  summarizeInstructorFees,
  type FeeableSlot,
  type InstructorFeeRow,
} from '../packages/instructor-fee-calculator';

describe('PRIORITAS 8: Instructor Lifecycle & Operational Non-Happy Path Specs', () => {
  const branchId = '00000000-0000-4000-8000-000000000002';
  const otherBranchId = '00000000-0000-4000-8000-000000000099';
  const instructorId = '00000000-0000-4000-8000-000000000050';
  const otherInstructorId = '00000000-0000-4000-8000-000000000051';

  // ---------------------------------------------------------------------------
  // 1. Jendela Waktu Check-In Instruktur (H-30 Menit, Sedang Berjalan, Kadaluwarsa)
  // ---------------------------------------------------------------------------
  describe('checkInWindowState: Validasi Jendela Waktu Check-in QR Tablet', () => {
    const startAt = new Date('2026-10-19T10:00:00.000Z');
    const endAt = new Date('2026-10-19T11:00:00.000Z');

    it('mengembalikan TOO_EARLY jika dipanggil lebih awal dari H-30 menit (contoh H-35m)', () => {
      const now = new Date('2026-10-19T09:25:00.000Z');
      expect(checkInWindowState(startAt, endAt, now)).toBe('TOO_EARLY');
    });

    it('mengembalikan OPEN tepat pada H-30 menit sebelum kelas dimulai', () => {
      const now = new Date('2026-10-19T09:30:00.000Z');
      expect(checkInWindowState(startAt, endAt, now)).toBe('OPEN');
    });

    it('mengembalikan OPEN ketika kelas sedang berjalan', () => {
      const now = new Date('2026-10-19T10:30:00.000Z');
      expect(checkInWindowState(startAt, endAt, now)).toBe('OPEN');
    });

    it('mengembalikan EXPIRED jika kelas telah berakhir (now >= endAt)', () => {
      const nowAtEnd = new Date('2026-10-19T11:00:00.000Z');
      const nowPastEnd = new Date('2026-10-19T11:05:00.000Z');
      expect(checkInWindowState(startAt, endAt, nowAtEnd)).toBe('EXPIRED');
      expect(checkInWindowState(startAt, endAt, nowPastEnd)).toBe('EXPIRED');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Otorisasi Peran Instruktur & Kepemilikan Token
  // ---------------------------------------------------------------------------
  describe('isOwningInstructor: Boundary Otorisasi Presensi Instruktur', () => {
    it('menerima jika userId cocok dan memiliki capability attendance:self', () => {
      const principal = {
        userId: instructorId,
        capabilities: ['attendance:self', 'class-slot:read'],
      };
      expect(isOwningInstructor(principal, instructorId)).toBe(true);
    });

    it('menolak jika userId cocok tetapi tidak memiliki capability attendance:self', () => {
      const principal = {
        userId: instructorId,
        capabilities: ['class-slot:read'],
      };
      expect(isOwningInstructor(principal, instructorId)).toBe(false);
    });

    it('menolak jika userId berbeda (instruktur lain mencoba check-in slot rekannya)', () => {
      const principal = {
        userId: otherInstructorId,
        capabilities: ['attendance:self'],
      };
      expect(isOwningInstructor(principal, instructorId)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Batasan Ketersediaan Instruktur (AvailabilityService)
  // ---------------------------------------------------------------------------
  describe('AvailabilityService: Validasi Range Waktu & Cabang Penugasan', () => {
    let service: AvailabilityService;
    let mockDb: any;
    let policy: PolicyService;

    beforeEach(() => {
      mockDb = {
        instructorAvailability: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      };
      policy = new PolicyService();
      service = new AvailabilityService(mockDb, policy, {} as any);
    });

    it('menolak request jika parameter fromValue >= untilValue (VALIDATION_ERROR)', async () => {
      const principal: any = {
        userId: instructorId,
        capabilities: ['availability:self:read'],
        branchIds: [branchId],
      };

      await expect(
        service.list(
          principal,
          branchId,
          '2026-10-20T12:00:00Z',
          '2026-10-20T10:00:00Z', // from > until
        ),
      ).rejects.toThrow();
    });

    it('menolak request jika branchId tidak ada dalam daftar penugasan principal (RESOURCE_NOT_FOUND)', async () => {
      const principal: any = {
        userId: instructorId,
        capabilities: ['availability:self:read'],
        branchIds: [branchId], // Hanya diizinkan branchId
      };

      await expect(
        service.list(
          principal,
          otherBranchId, // Mencoba akses cabang lain
          '2026-10-20T08:00:00Z',
          '2026-10-20T17:00:00Z',
        ),
      ).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Perhitungan Honor Instruktur & Verifikasi Scan QR (FinanceService Logic)
  // ---------------------------------------------------------------------------
  describe('Honor Instruktur & Validasi Presensi Aktual QR Tablet Studio', () => {
    const coach = { id: instructorId, displayName: 'Coach Clara' };

    const makeFee = (over: Partial<InstructorFeeRow> = {}): InstructorFeeRow => ({
      instructorId: coach.id,
      branchId: branchId,
      classTypeId: 'group',
      effectiveDate: new Date('2026-01-01T00:00:00Z'),
      feePerJamRp: 250_000,
      ...over,
    });

    const makeSlot = (over: Partial<FeeableSlot> = {}): FeeableSlot => ({
      startAt: new Date('2026-10-19T02:00:00Z'),
      endAt: new Date('2026-10-19T03:00:00Z'),
      branchId: branchId,
      classTypeId: 'group',
      instructor: coach,
      classType: { name: 'Group Class' },
      instructorAttendance: { id: 'att-valid-qr' },
      ...over,
    });

    it('menghitung honor terverifikasi 100% jika terdapat bukti scan QR (instructorAttendance terisi)', () => {
      const slots = [makeSlot()];
      const fees = [makeFee()];

      const summaries = summarizeInstructorFees(slots, fees);
      expect(summaries.length).toBe(1);
      const summary = summaries[0]!;

      expect(summary.totalFeeRp).toBe(250_000);
      expect(summary.verifiedFeeRp).toBe(250_000);
      expect(summary.unverifiedFeeRp).toBe(0);
      expect(summary.unverifiedClassCount).toBe(0);
      expect(summary.totalHours).toBe(1);
    });

    it('menandai unverifiedFeeRp & unverifiedClassCount jika kelas diselesaikan tanpa scan QR presensi', () => {
      const slots = [
        makeSlot({ instructorAttendance: null }), // Kelas selesai tapi QR tidak di-scan di tablet studio
      ];
      const fees = [makeFee()];

      const summaries = summarizeInstructorFees(slots, fees);
      expect(summaries.length).toBe(1);
      const summary = summaries[0]!;

      // Tanpa scan QR, honor tidak masuk total/beban; hanya dilaporkan sebagai belum terverifikasi.
      expect(summary.totalFeeRp).toBe(0);
      expect(summary.verifiedFeeRp).toBe(0);
      expect(summary.unverifiedFeeRp).toBe(250_000);
      expect(summary.unverifiedClassCount).toBe(1);
    });

    it('menggunakan fallback DEFAULT_INSTRUCTOR_FEE_PER_HOUR_RP dengan flag configured=false jika tarif belum diatur', () => {
      const slotWithoutFee = { ...makeSlot(), instructorId: coach.id };
      const calculated = calculateSlotFee([], slotWithoutFee);

      expect(calculated.feePerJamRp).toBe(DEFAULT_INSTRUCTOR_FEE_PER_HOUR_RP);
      expect(calculated.configured).toBe(false);
    });
  });
});
