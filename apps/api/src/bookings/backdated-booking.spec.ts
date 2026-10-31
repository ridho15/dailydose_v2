import { HttpStatus } from '@nestjs/common';
import { BookingsService } from './pemesanan-kelas.service';
import { PolicyService } from '../identity/policy.service';

const slotId = '00000000-0000-4000-8000-000000000010';
const customerUserId = '00000000-0000-4000-8000-000000000020';
const customerPackageId = '00000000-0000-4000-8000-000000000030';
const branchId = '00000000-0000-4000-8000-000000000040';

const adminPrincipal = {
  sessionId: 'admin-session',
  userId: '00000000-0000-4000-8000-000000000099',
  roles: [{ role: 'ADMIN', branchId }],
  capabilities: ['booking:create:assisted', 'class-slot:manage'],
  branchIds: [branchId],
};

const superOwnerPrincipal = {
  sessionId: 'super-owner-session',
  userId: '00000000-0000-4000-8000-000000000098',
  roles: [{ role: 'SUPER_OWNER', branchId: null }],
  capabilities: ['booking:create:assisted', 'class-slot:manage'],
  branchIds: [branchId],
};

const plainStaffPrincipal = {
  sessionId: 'plain-staff-session',
  userId: '00000000-0000-4000-8000-000000000097',
  roles: [] as never,
  capabilities: ['booking:create:assisted'],
  branchIds: [branchId],
};

const customerPrincipal = {
  sessionId: 'customer-session',
  userId: customerUserId,
  roles: [{ role: 'CUSTOMER', branchId: null }],
  capabilities: ['booking:self:create'],
  branchIds: [],
};

describe('Backdated Booking & Member Enrollment into Past Schedules (Solusi 1)', () => {
  function createService(opts?: {
    slotStatus?: string;
    slotStartAt?: Date;
    slotEndAt?: Date;
    packageValidUntil?: Date;
    packageRemaining?: number;
    capacity?: number;
    activeBookingsOnSlot?: number;
    duplicate?: boolean;
    customerKyc?: boolean;
  }) {
    const pastStart = opts?.slotStartAt ?? new Date(Date.now() - 3 * 3600 * 1000); // 3 hours ago
    const pastEnd = opts?.slotEndAt ?? new Date(Date.now() - 2 * 3600 * 1000); // 2 hours ago

    const mockSlot = {
      id: slotId,
      branchId,
      classTypeId: 'ct-1',
      studioId: 'std-1',
      startAt: pastStart,
      endAt: pastEnd,
      status: opts?.slotStatus ?? 'PUBLISHED',
      capacity: opts?.capacity ?? 8,
      bookedCount: opts?.activeBookingsOnSlot ?? 0,
      branch: { id: branchId, name: 'Sudirman Studio' },
      classType: { id: 'ct-1', name: 'Reformer' },
      instructor: { id: 'inst-1', displayName: 'Sarah' },
      studio: null,
    };

    const mockPackage = {
      id: customerPackageId,
      userId: customerUserId,
      status: 'ACTIVE',
      validUntil: opts?.packageValidUntil ?? new Date(Date.now() + 30 * 24 * 3600 * 1000), // Valid in future
      remainingSessions: opts?.packageRemaining ?? 5,
      purchase: { status: 'PAID' },
      package: { id: 'pkg-1', name: 'Package 10 Sessions', branchId, classTypeId: 'ct-1' },
    };

    const mockCustomer = {
      id: customerUserId,
      status: 'ACTIVE',
      displayName: 'Budi Member',
      profile: opts?.customerKyc ? { notes: 'KYC_APPROVED', selfieUrl: 'https://example.com/selfie.jpg' } : undefined,
    };

    const auditCatat = jest.fn(async () => {});

    const tx = {
      $queryRaw: jest.fn(async () => [{ id: slotId }]),
      slotKelas: {
        findUnique: jest.fn(async () => mockSlot),
        update: jest.fn(async () => ({})),
      },
      paketPelanggan: {
        findUnique: jest.fn(async () => mockPackage),
      },
      user: {
        findUnique: jest.fn(async () => mockCustomer),
      },
      pemesananKelas: {
        count: jest.fn(async ({ where }: any) => {
          if (where?.classSlotId) return opts?.activeBookingsOnSlot ?? 0;
          return 0;
        }),
        findFirst: jest.fn(async () => (opts?.duplicate ? { id: 'existing-dup' } : null)),
        create: jest.fn(async ({ data }: any) => ({
          ...data,
          id: 'bkg-past-01',
          user: mockCustomer,
          classSlot: mockSlot,
          customerPackage: mockPackage,
          attendance: null,
          checkInTokens: [],
        })),
      },
      auditLog: {
        create: jest.fn(async () => ({})),
      },
    };

    const idempotency = {
      execute: jest.fn(async (_opts: any, action: (t: any) => Promise<any>) => action(tx)),
    };

    const config = {
      value: {
        booking: { enabled: true, cutoffHours: 2 },
      },
    };

    const mockAudit = {
      catat: auditCatat,
    };

    const service = new BookingsService(
      tx as any,
      idempotency as any,
      new PolicyService(),
      config as any,
      mockAudit as any,
    );

    return { service, tx, auditCatat };
  }

  describe('Happy Paths', () => {
    it('mengizinkan Admin memasukkan member ke jadwal kelas yang sudah lewat (source: ADMIN_ASSISTED)', async () => {
      const { service, tx, auditCatat } = createService({ slotStatus: 'PUBLISHED' });

      const result = await service.create(
        adminPrincipal as any,
        {
          classSlotId: slotId,
          customerPackageId,
          customerUserId,
          source: 'ADMIN_ASSISTED',
        },
        'idem-admin-past-1',
        'corr-admin-past-1',
      );

      expect(result.status).toBe(HttpStatus.CREATED);
      expect((result.body as any).id).toBe('bkg-past-01');

      // Memastikan slot di-update menjadi CONFIRMED secara otomatis agar siap diselesaikan / diabsen
      expect(tx.slotKelas.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: slotId },
          data: expect.objectContaining({
            status: 'CONFIRMED',
            bookedCount: 1,
          }),
        }),
      );

      // Memastikan audit mencatat jejak backdated booking dengan jelas
      expect(auditCatat).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          action: 'booking.backdated_by_staff',
          objectId: 'bkg-past-01',
          targetUserId: customerUserId,
          afterMasked: expect.objectContaining({
            backdated: true,
          }),
        }),
      );
    });

    it('mengizinkan Super Owner memasukkan member ke jadwal kelas yang sudah lewat', async () => {
      const { service, tx, auditCatat } = createService({ slotStatus: 'PUBLISHED' });

      const result = await service.create(
        superOwnerPrincipal as any,
        {
          classSlotId: slotId,
          customerPackageId,
          customerUserId,
          source: 'ADMIN_ASSISTED',
        },
        'idem-superowner-past-1',
        'corr-superowner-past-1',
      );

      expect(result.status).toBe(HttpStatus.CREATED);
      expect(auditCatat).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          action: 'booking.backdated_by_staff',
        }),
      );
    });

    it('jika slot masa lalu sudah berstatus CONFIRMED, tetap mengizinkan Admin menambah member berikutnya', async () => {
      const { service, tx } = createService({ slotStatus: 'CONFIRMED', activeBookingsOnSlot: 1 });

      const result = await service.create(
        adminPrincipal as any,
        {
          classSlotId: slotId,
          customerPackageId,
          customerUserId,
          source: 'ADMIN_ASSISTED',
        },
        'idem-admin-past-2',
        'corr-admin-past-2',
      );

      expect(result.status).toBe(HttpStatus.CREATED);
      expect(tx.slotKelas.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: slotId },
          data: { bookedCount: 2 },
        }),
      );
    });

    it('mengizinkan backfill jika paket member masih aktif pada jam kelas masa lalu itu berlangsung', async () => {
      // Paket berakhir 1 jam lalu, tetapi kelas berlangsung 3 jam lalu (saat kelas berlangsung paket MASIH aktif)
      const pastStart = new Date(Date.now() - 3 * 3600 * 1000);
      const pkgValidUntil = new Date(Date.now() - 1 * 3600 * 1000);

      const { service } = createService({
        slotStartAt: pastStart,
        packageValidUntil: pkgValidUntil,
      });

      const result = await service.create(
        adminPrincipal as any,
        {
          classSlotId: slotId,
          customerPackageId,
          customerUserId,
          source: 'ADMIN_ASSISTED',
        },
        'idem-admin-pkg-past-1',
        'corr-admin-pkg-past-1',
      );

      expect(result.status).toBe(HttpStatus.CREATED);
    });
  });

  describe('No-Happy Path (Error & Security Guards)', () => {
    it('menolak staf biasa (non-privileged staff tanpa peran Admin/Super Owner) mendaftarkan peserta ke jadwal lewat', async () => {
      const { service } = createService({ slotStatus: 'PUBLISHED' });

      await expect(
        service.create(
          plainStaffPrincipal as any,
          {
            classSlotId: slotId,
            customerPackageId,
            customerUserId,
            source: 'ADMIN_ASSISTED',
          },
          'idem-plainstaff-past-1',
          'corr-plainstaff-past-1',
        ),
      ).rejects.toMatchObject({
        code: 'CLASS_ALREADY_FINISHED',
        status: HttpStatus.CONFLICT,
      });
    });

    it('menolak pelanggan (customer self-service) melakukan booking ke jadwal kelas masa lalu (BOOKING_CUTOFF_PASSED)', async () => {
      const { service } = createService({ slotStatus: 'PUBLISHED', customerKyc: true });

      await expect(
        service.create(
          customerPrincipal as any,
          {
            classSlotId: slotId,
            customerPackageId,
            source: 'SELF',
          },
          'idem-customer-past-1',
          'corr-customer-past-1',
        ),
      ).rejects.toMatchObject({
        code: 'BOOKING_CUTOFF_PASSED',
        status: HttpStatus.CONFLICT,
      });
    });

    it('menolak pendaftaran jika paket pelanggan sudah kedaluwarsa SEBELUM kelas masa lalu itu berlangsung', async () => {
      // Kelas berlangsung 3 jam lalu, tapi paket sudah kedaluwarsa sejak 5 jam lalu
      const pastStart = new Date(Date.now() - 3 * 3600 * 1000);
      const expiredBeforeClass = new Date(Date.now() - 5 * 3600 * 1000);

      const { service } = createService({
        slotStartAt: pastStart,
        packageValidUntil: expiredBeforeClass,
      });

      await expect(
        service.create(
          adminPrincipal as any,
          {
            classSlotId: slotId,
            customerPackageId,
            customerUserId,
            source: 'ADMIN_ASSISTED',
          },
          'idem-admin-expired-1',
          'corr-admin-expired-1',
        ),
      ).rejects.toMatchObject({
        code: 'INSUFFICIENT_AVAILABLE_SESSIONS',
        status: HttpStatus.CONFLICT,
      });
    });

    it('menolak pendaftaran jika sisa sesi paket sudah habis (remainingSessions <= 0)', async () => {
      const { service } = createService({ packageRemaining: 0 });

      await expect(
        service.create(
          adminPrincipal as any,
          {
            classSlotId: slotId,
            customerPackageId,
            customerUserId,
            source: 'ADMIN_ASSISTED',
          },
          'idem-admin-nosession-1',
          'corr-admin-nosession-1',
        ),
      ).rejects.toMatchObject({
        code: 'INSUFFICIENT_AVAILABLE_SESSIONS',
        status: HttpStatus.CONFLICT,
      });
    });

    it('menolak pendaftaran jika kapasitas kelas masa lalu sudah penuh (CLASS_CAPACITY_FULL)', async () => {
      const { service } = createService({ capacity: 4, activeBookingsOnSlot: 4 });

      await expect(
        service.create(
          adminPrincipal as any,
          {
            classSlotId: slotId,
            customerPackageId,
            customerUserId,
            source: 'ADMIN_ASSISTED',
          },
          'idem-admin-full-1',
          'corr-admin-full-1',
        ),
      ).rejects.toMatchObject({
        code: 'CLASS_CAPACITY_FULL',
        status: HttpStatus.CONFLICT,
      });
    });

    it('menolak pendaftaran ganda jika customer sudah terdaftar di kelas masa lalu tersebut (DUPLICATE_ACTIVE_BOOKING)', async () => {
      const { service } = createService({ duplicate: true });

      await expect(
        service.create(
          adminPrincipal as any,
          {
            classSlotId: slotId,
            customerPackageId,
            customerUserId,
            source: 'ADMIN_ASSISTED',
          },
          'idem-admin-dup-1',
          'corr-admin-dup-1',
        ),
      ).rejects.toMatchObject({
        code: 'DUPLICATE_ACTIVE_BOOKING',
        status: HttpStatus.CONFLICT,
      });
    });
  });
});
