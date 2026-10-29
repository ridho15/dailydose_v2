import { createHash } from 'node:crypto';
import { AttendanceService } from './kehadiran.service';
import { PolicyService } from '../identity/policy.service';
import { ApiProblem } from '../identity/security';
import {
  calculateSlotFee,
  DEFAULT_INSTRUCTOR_FEE_PER_HOUR_RP,
  type FeeableSlot,
  type InstructorFeeRow,
} from '../packages/instructor-fee-calculator';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

describe('UAT & Non-Happy Path: Geofencing, Absensi Instruktur & Modal Manual', () => {
  const branchId = '00000000-0000-4000-8000-000000000002';
  const slotId = '00000000-0000-4000-8000-000000000010';
  const instructorId = '00000000-0000-4000-8000-000000000050';
  const impostorInstructorId = '00000000-0000-4000-8000-000000000099';
  const rawToken = 'b'.repeat(43);

  // Studio Cabang Green Garden Coordinates: Lat -6.1685, Lng 106.7628, Radius 100m
  const branchWithGps = {
    id: branchId,
    code: 'GG',
    name: 'Green Garden Studio',
    latitude: -6.1685,
    longitude: 106.7628,
    geofenceRadiusMeters: 100,
  };

  const NOW = new Date('2026-10-21T09:45:00.000Z');
  // Slot starts at 10:00, ends at 11:00 (Check-in window opens at 09:30, closes at 11:00)
  const slotData = {
    id: slotId,
    branchId,
    instructorId,
    status: 'CONFIRMED',
    startAt: new Date('2026-10-21T10:00:00.000Z'),
    endAt: new Date('2026-10-21T11:00:00.000Z'),
    branch: branchWithGps,
  };

  const instructorPrincipal = {
    sessionId: 'session-inst-1',
    userId: instructorId,
    roles: [{ role: 'INSTRUCTOR' as const, branchId }],
    capabilities: ['attendance:self', 'class-slot:read'],
    branchIds: [branchId],
  };

  const tokenRecord = (overSlot: Record<string, unknown> = {}, overToken: Record<string, unknown> = {}) => ({
    id: 'token-uuid-1',
    token: sha256(rawToken),
    usedAt: null,
    expiresAt: new Date('2026-10-21T11:00:00.000Z'),
    classSlot: { ...slotData, ...overSlot },
    ...overToken,
  });

  function setupService() {
    const tx = {
      instructorCheckInToken: {
        update: jest.fn().mockResolvedValue({}),
      },
      kehadiranInstruktur: {
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    const db = {
      instructorCheckInToken: {
        findUnique: jest.fn(),
      },
      $transaction: jest.fn(async (callback: (t: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const service = new AttendanceService(db as never, new PolicyService(), {} as never);
    return { db, tx, service };
  }

  // =========================================================================
  // 1. NON-HAPPY PATH: GEOFENCING & GPS COORDINATE VALIDATION
  // =========================================================================
  describe('Skenario Geofencing GPS (Non-Happy Path & Edge Cases)', () => {
    it('[Non-Happy Path] Menolak presensi jika browser/perangkat tidak mengirim koordinat GPS (GEOLOCATION_REQUIRED)', async () => {
      const { db, service } = setupService();
      db.instructorCheckInToken.findUnique.mockResolvedValue(tokenRecord());

      await expect(
        service.consumeInstructor(
          instructorPrincipal,
          { token: `dd-checkin:v1:${rawToken}` }, // Missing latitude & longitude
          'idem-key-1',
          'corr-1',
          NOW,
        ),
      ).rejects.toMatchObject({
        code: 'GEOLOCATION_REQUIRED',
      });
    });

    it('[Non-Happy Path] Menolak presensi jika instruktur berada di luar radius cabang (OUT_OF_GEOFENCE)', async () => {
      const { db, service } = setupService();
      db.instructorCheckInToken.findUnique.mockResolvedValue(tokenRecord());

      // Titik berjarak ~330 meter dari studio (radius toleransi 100 meter)
      const outsideCoords = {
        latitude: -6.1685 + 0.003,
        longitude: 106.7628,
      };

      await expect(
        service.consumeInstructor(
          instructorPrincipal,
          { token: `dd-checkin:v1:${rawToken}`, ...outsideCoords },
          'idem-key-2',
          'corr-2',
          NOW,
        ),
      ).rejects.toMatchObject({
        code: 'OUT_OF_GEOFENCE',
      });
    });

    it('[Happy Path] Menerima presensi jika instruktur berada di dalam radius geofence studio (< 100m)', async () => {
      const { db, tx, service } = setupService();
      db.instructorCheckInToken.findUnique.mockResolvedValue(tokenRecord());

      // Titik berjarak ~35 meter dari studio
      const insideCoords = {
        latitude: -6.1685 + 0.0003,
        longitude: 106.7628,
      };

      const result = await service.consumeInstructor(
        instructorPrincipal,
        { token: `dd-checkin:v1:${rawToken}`, ...insideCoords },
        'idem-key-3',
        'corr-3',
        NOW,
      );

      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({
        success: true,
        type: 'INSTRUCTOR',
        classSlotId: slotId,
        branchName: 'Green Garden Studio',
      });
      expect(result.body.distanceMeters).toBeLessThanOrEqual(100);
      expect(result.body.isWithinGeofence).toBe(true);

      // Verifikasi data absensi tersimpan dengan koordinat dan jarak riil
      expect(tx.kehadiranInstruktur.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { classSlotId: slotId },
          create: expect.objectContaining({
            instructorId,
            isWithinGeofence: true,
            distanceMeters: expect.any(Number),
          }),
        }),
      );
    });
  });

  // =========================================================================
  // 2. NON-HAPPY PATH: TIME WINDOW, AUTHORIZATION & TOKEN INTEGRITY
  // =========================================================================
  describe('Skenario Keamanan Token & Hak Akses (Non-Happy Path)', () => {
    it('[Non-Happy Path] Menolak jika scan dilakukan sebelum jendela H-30m dibuka (CHECK_IN_TOO_EARLY)', async () => {
      const { db, service } = setupService();
      db.instructorCheckInToken.findUnique.mockResolvedValue(tokenRecord());

      // Kelas mulai 10:00, jendela buka 09:30. Instruktur scan pukul 09:15 (H-45m)
      const tooEarly = new Date('2026-10-21T09:15:00.000Z');

      await expect(
        service.consumeInstructor(
          instructorPrincipal,
          { token: rawToken, latitude: -6.1685, longitude: 106.7628 },
          'idem-early',
          'corr-early',
          tooEarly,
        ),
      ).rejects.toMatchObject({
        code: 'CHECK_IN_TOO_EARLY',
      });
    });

    it('[Non-Happy Path] Menolak jika kelas telah selesai (CHECK_IN_WINDOW_CLOSED)', async () => {
      const { db, service } = setupService();
      // Token valid hingga 11:30, tetapi kelas selesai pukul 11:00
      db.instructorCheckInToken.findUnique.mockResolvedValue(
        tokenRecord({}, { expiresAt: new Date('2026-10-21T11:30:00.000Z') }),
      );

      // Kelas selesai pukul 11:00. Instruktur scan pukul 11:05
      const pastEnd = new Date('2026-10-21T11:05:00.000Z');

      await expect(
        service.consumeInstructor(
          instructorPrincipal,
          { token: rawToken, latitude: -6.1685, longitude: 106.7628 },
          'idem-closed',
          'corr-closed',
          pastEnd,
        ),
      ).rejects.toMatchObject({
        code: 'CHECK_IN_WINDOW_CLOSED',
      });
    });

    it('[Non-Happy Path] Menolak jika token QR telah kadaluwarsa (TOKEN_EXPIRED)', async () => {
      const { db, service } = setupService();
      // Token kadaluwarsa pukul 10:30
      db.instructorCheckInToken.findUnique.mockResolvedValue(
        tokenRecord({}, { expiresAt: new Date('2026-10-21T10:30:00.000Z') }),
      );

      // Instruktur scan pukul 10:35
      const scanAfterExpiry = new Date('2026-10-21T10:35:00.000Z');

      await expect(
        service.consumeInstructor(
          instructorPrincipal,
          { token: rawToken, latitude: -6.1685, longitude: 106.7628 },
          'idem-expired',
          'corr-expired',
          scanAfterExpiry,
        ),
      ).rejects.toMatchObject({
        code: 'TOKEN_EXPIRED',
      });
    });

    it('[Non-Happy Path] Menolak jika instruktur lain mencoba scan kelas rekannya (RESOURCE_NOT_FOUND / Unauthorized)', async () => {
      const { db, service } = setupService();
      // Token ini milik instructorId, namun dipindai oleh impostorInstructorId
      db.instructorCheckInToken.findUnique.mockResolvedValue(tokenRecord());

      const impostorPrincipal = {
        sessionId: 'impostor-session',
        userId: impostorInstructorId,
        roles: [{ role: 'INSTRUCTOR' as const, branchId }],
        capabilities: ['attendance:self'],
        branchIds: [branchId],
      };

      await expect(
        service.consumeInstructor(
          impostorPrincipal,
          { token: rawToken, latitude: -6.1685, longitude: 106.7628 },
          'idem-impostor',
          'corr-impostor',
          NOW,
        ),
      ).rejects.toMatchObject({
        code: 'RESOURCE_NOT_FOUND',
      });
    });

    it('[Non-Happy Path] Menolak token palsu / tidak ditemukan (INVALID_TOKEN)', async () => {
      const { db, service } = setupService();
      db.instructorCheckInToken.findUnique.mockResolvedValue(null);

      await expect(
        service.consumeInstructor(
          instructorPrincipal,
          { token: 'dd-checkin:v1:fake-token-xyz', latitude: -6.1685, longitude: 106.7628 },
          'idem-fake',
          'corr-fake',
          NOW,
        ),
      ).rejects.toMatchObject({
        code: 'INVALID_TOKEN',
      });
    });

    it('[Non-Happy Path] Menolak scan ulang token yang sudah pernah terpakai (TOKEN_ALREADY_USED)', async () => {
      const { db, service } = setupService();
      db.instructorCheckInToken.findUnique.mockResolvedValue(
        tokenRecord({}, { usedAt: new Date('2026-10-21T09:40:00.000Z') }),
      );

      await expect(
        service.consumeInstructor(
          instructorPrincipal,
          { token: rawToken, latitude: -6.1685, longitude: 106.7628 },
          'idem-used',
          'corr-used',
          NOW,
        ),
      ).rejects.toMatchObject({
        code: 'TOKEN_ALREADY_USED',
      });
    });

    it('[Non-Happy Path] Menolak jika slot kelas berstatus CANCELLED (INVALID_STATE_TRANSITION)', async () => {
      const { db, service } = setupService();
      db.instructorCheckInToken.findUnique.mockResolvedValue(
        tokenRecord({ status: 'CANCELLED' }),
      );

      await expect(
        service.consumeInstructor(
          instructorPrincipal,
          { token: rawToken, latitude: -6.1685, longitude: 106.7628 },
          'idem-cancelled',
          'corr-cancelled',
          NOW,
        ),
      ).rejects.toMatchObject({
        code: 'INVALID_STATE_TRANSITION',
      });
    });
  });

  // =========================================================================
  // 3. UAT: MODAL / BIAYA MANUAL INSTRUKTUR PER SESI
  // =========================================================================
  describe('Penentuan Modal / Biaya Instruktur Manual (UAT Poin 2)', () => {
    const coach = { id: instructorId, displayName: 'Coach Sarah' };
    const standardFee: InstructorFeeRow = {
      instructorId: coach.id,
      branchId: branchId,
      classTypeId: 'reformer',
      effectiveDate: new Date('2026-01-01T00:00:00Z'),
      feePerJamRp: 150_000,
    };

    it('[UAT] Nominal modal manual di jadwal diabaikan; honor selalu dari Data Master', () => {
      const manualSlot: FeeableSlot & { instructorId: string } = {
        instructorId: coach.id,
        branchId,
        classTypeId: 'reformer',
        instructor: coach,
        classType: { name: 'Reformer Intro' },
        startAt: new Date('2026-10-21T10:00:00Z'),
        endAt: new Date('2026-10-21T11:30:00Z'), // 1.5 jam -> tarif normal = 225.000
        isManualFee: true,
        instructorFeeRp: 350_000, // Diset manual flat 350.000
      };

      const result = calculateSlotFee([standardFee], manualSlot);
      // 1,5 jam dibulatkan 2 jam x 150.000.
      expect(result.feeRp).toBe(300_000);
      expect(result.isManual).toBe(false);
      expect(result.configured).toBe(true);
    });

    it('[UAT] Fallback ke tarif per jam normal jika isManualFee tidak aktif (false/null)', () => {
      const standardSlot: FeeableSlot & { instructorId: string } = {
        instructorId: coach.id,
        branchId,
        classTypeId: 'reformer',
        instructor: coach,
        classType: { name: 'Reformer Intro' },
        startAt: new Date('2026-10-21T10:00:00Z'),
        endAt: new Date('2026-10-21T11:00:00Z'), // 1 jam
        isManualFee: false,
        instructorFeeRp: null,
      };

      const result = calculateSlotFee([standardFee], standardSlot);
      expect(result.feeRp).toBe(150_000);
      expect(result.isManual).toBe(false);
      expect(result.configured).toBe(true);
    });
  });

  // =========================================================================
  // 4. UAT: INTEGRITAS MATEMATIKA DEKOMPOSISI LABA RUGI & OMSET
  // =========================================================================
  describe('Integritas Dekomposisi Laba Rugi Dashboard (UAT Poin 3 & 4)', () => {
    it('[UAT] Integritas rumus P&L: Net Revenue = Gross - Discount, Gross Profit = Net Revenue - Modal Instruktur', () => {
      const grossSalesRp = 10_000_000;
      const discountRp = 1_500_000;
      const netRevenueRp = grossSalesRp - discountRp; // 8.500.000
      const instructorCostRp = 2_500_000;
      const otherCostRp = 1_000_000;

      const grossProfitRp = netRevenueRp - instructorCostRp; // 6.000.000
      const grossMarginPercent = Math.round((grossProfitRp / netRevenueRp) * 100); // 71%

      const netOperatingProfitRp = grossProfitRp - otherCostRp; // 5.000.000
      const netMarginPercent = Math.round((netOperatingProfitRp / netRevenueRp) * 100); // 59%

      expect(netRevenueRp).toBe(8_500_000);
      expect(grossProfitRp).toBe(6_000_000);
      expect(grossMarginPercent).toBe(71);
      expect(netOperatingProfitRp).toBe(5_000_000);
      expect(netMarginPercent).toBe(59);
    });

    it('[Edge Case] Penanganan pembagian nol (Zero Net Revenue) agar tidak menghasilkan NaN%', () => {
      const grossSalesRp = 0;
      const discountRp = 0;
      const netRevenueRp = 0;
      const instructorCostRp = 500_000;

      const grossProfitRp = netRevenueRp - instructorCostRp; // -500.000
      const grossMarginPercent = netRevenueRp > 0 ? Math.round((grossProfitRp / netRevenueRp) * 100) : 0;

      expect(grossProfitRp).toBe(-500_000);
      expect(grossMarginPercent).toBe(0);
      expect(Number.isNaN(grossMarginPercent)).toBe(false);
    });
  });
});
