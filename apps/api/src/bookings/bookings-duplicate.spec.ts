import { HttpStatus } from '@nestjs/common';
import { BookingsService } from './pemesanan-kelas.service';
import { PolicyService } from '../identity/policy.service';

const slotId = '00000000-0000-4000-8000-000000000010';
const customerUserId = '00000000-0000-4000-8000-000000000020';
const customerPackageId = '00000000-0000-4000-8000-000000000030';
const branchId = '00000000-0000-4000-8000-000000000040';

const principal = {
  sessionId: 'session',
  userId: customerUserId,
  roles: ['CUSTOMER'],
  capabilities: ['booking:self:create'],
  branchIds: [],
};

describe('BookingsService - Anti-Booking Kembar Duplicate Guard (Poin 8)', () => {
  function createService(
    existingBookingStatus?: 'BOOKED' | 'ATTENDED' | 'CANCELLED' | 'SCHEDULE_CONFLICT' | null,
    activeBookingsCount = 0,
    maksTeman = 0,
  ) {
    const futureDate = new Date(Date.now() + 24 * 3600 * 1000);
    const mockSlot = {
      id: slotId,
      branchId,
      classTypeId: 'ct-1',
      studioId: 'std-1',
      startAt: futureDate,
      endAt: new Date(futureDate.getTime() + 3600 * 1000),
      status: 'PUBLISHED',
      capacity: 8,
      bookedCount: 2,
      branch: { id: branchId, name: 'Branch' },
      classType: { id: 'ct-1', name: 'Reformer' },
      instructor: null,
      studio: null,
    };

    const mockPackage = {
      id: customerPackageId,
      userId: customerUserId,
      status: 'ACTIVE',
      validUntil: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      remainingSessions: 5,
      purchase: { status: 'PAID' },
      packageId: 'pkg-1',
      package: { id: 'pkg-1', name: 'Pkg 10', branchId, classTypeId: 'ct-1' },
    };

    const mockCustomer = {
      id: customerUserId,
      status: 'ACTIVE',
    };

    const tx = {
      $queryRaw: jest.fn(async () => [{ id: slotId }]),
      paketBawaTeman: {
        findMany: jest.fn(async () => (maksTeman ? [{ packageId: 'pkg-1', maksTeman }] : [])),
      },
      bookingTeman: { create: jest.fn() },
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
          // Booking milik member ini di kelas yang sama (pengecekan duplikat).
          if (where?.userId && where?.classSlotId === slotId)
            return existingBookingStatus && ['BOOKED', 'ATTENDED'].includes(existingBookingStatus)
              ? 1
              : 0;
          if (where?.classSlotId) return activeBookingsCount;
          return 0;
        }),
        findFirst: jest.fn(async ({ where }: any) => {
          if (existingBookingStatus === 'SCHEDULE_CONFLICT' && where?.classSlotId?.not) {
            return {
              id: 'conflict-booking-1',
              userId: customerUserId,
              classSlotId: 'other-slot-id',
              status: 'BOOKED',
            };
          }
          if (
            existingBookingStatus &&
            ['BOOKED', 'ATTENDED'].includes(existingBookingStatus) &&
            where?.classSlotId === slotId
          ) {
            return {
              id: 'existing-booking-1',
              userId: customerUserId,
              classSlotId: slotId,
              status: existingBookingStatus,
            };
          }
          return null;
        }),
        create: jest.fn(async ({ data }: any) => ({
          ...data,
          id: 'new-bkg-id',
          user: mockCustomer,
          classSlot: mockSlot,
          customerPackage: mockPackage,
          attendance: null,
          checkInTokens: [],
        })),
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

    const mockDb = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: customerUserId,
          status: 'ACTIVE',
          profile: { notes: 'KYC_APPROVED', selfieUrl: 'identity-documents/u/selfie.jpg' },
        }),
      },
    };

    const service = new BookingsService(
      mockDb as any,
      idempotency as any,
      new PolicyService(),
      config as any,
    );

    return { service, tx };
  }

  it('menolak booking ganda jika customer sudah memiliki booking aktif berstatus BOOKED (409 Conflict)', async () => {
    const { service } = createService('BOOKED');

    await expect(
      service.create(
        principal as any,
        {
          classSlotId: slotId,
          customerPackageId,
          source: 'SELF',
        },
        'idem-key-1',
        'corr-1',
      ),
    ).rejects.toMatchObject({
      code: 'DUPLICATE_ACTIVE_BOOKING',
      status: HttpStatus.CONFLICT,
    });
  });

  it('menolak booking ganda jika customer sudah terdaftar dan berstatus ATTENDED (409 Conflict)', async () => {
    const { service } = createService('ATTENDED');

    await expect(
      service.create(
        principal as any,
        {
          classSlotId: slotId,
          customerPackageId,
          source: 'SELF',
        },
        'idem-key-2',
        'corr-2',
      ),
    ).rejects.toMatchObject({
      code: 'DUPLICATE_ACTIVE_BOOKING',
      status: HttpStatus.CONFLICT,
    });
  });

  it('menolak booking jika customer memiliki booking lain pada jam yang bertabrakan (SCHEDULE_CONFLICT 409)', async () => {
    const { service } = createService('SCHEDULE_CONFLICT');

    await expect(
      service.create(
        principal as any,
        {
          classSlotId: slotId,
          customerPackageId,
          source: 'SELF',
        },
        'idem-key-conflict',
        'corr-conflict',
      ),
    ).rejects.toMatchObject({
      code: 'SCHEDULE_CONFLICT',
      status: HttpStatus.CONFLICT,
    });
  });

  it('menolak booking jika jumlah booking riil di database sudah mencapai kapasitas slot (CLASS_CAPACITY_FULL 409)', async () => {
    // Kapasitas slot adalah 8, jumlah booking riil di database sudah 8
    const { service } = createService(null, 8);

    await expect(
      service.create(
        principal as any,
        {
          classSlotId: slotId,
          customerPackageId,
          source: 'SELF',
        },
        'idem-key-full',
        'corr-full',
      ),
    ).rejects.toMatchObject({
      code: 'CLASS_CAPACITY_FULL',
      status: HttpStatus.CONFLICT,
    });
  });

  describe('paket "bawa teman"', () => {
    const staf = {
      sessionId: 's',
      userId: 'staff-1',
      roles: [{ role: 'ADMIN', branchId }],
      capabilities: ['booking:create:assisted', 'booking:read'],
      branchIds: [branchId],
    };
    const tambahLagi = (service: BookingsService, p: unknown, source: 'SELF' | 'ADMIN_ASSISTED') =>
      service.create(
        p as any,
        { classSlotId: slotId, customerPackageId, customerUserId, source, namaTeman: 'Rani' },
        `idem-${source}-${Math.random()}`,
        'corr',
      );

    it('staf boleh memasukkan member yang sama sekali lagi sebagai kursi teman', async () => {
      const { service, tx } = createService('BOOKED', 1, 1);
      const result = await tambahLagi(service, staf, 'ADMIN_ASSISTED');
      expect(result.status).toBe(HttpStatus.CREATED);
      expect(tx.bookingTeman.create).toHaveBeenCalledWith({
        data: { bookingId: 'new-bkg-id', packageId: 'pkg-1', namaTeman: 'Rani' },
      });
    });

    it('paket tanpa centang bawa teman tetap ditolak ganda', async () => {
      const { service, tx } = createService('BOOKED', 1, 0);
      await expect(tambahLagi(service, staf, 'ADMIN_ASSISTED')).rejects.toMatchObject({
        code: 'DUPLICATE_ACTIVE_BOOKING',
      });
      expect(tx.bookingTeman.create).not.toHaveBeenCalled();
    });

    it('member sendiri juga boleh booking ganda bila memakai paket bawa teman', async () => {
      const { service, tx } = createService('BOOKED', 1, 1);
      const result = await service.create(
        principal as any,
        { classSlotId: slotId, customerPackageId, source: 'SELF' },
        'idem-self-teman',
        'corr',
      );
      expect(result.status).toBe(HttpStatus.CREATED);
      expect(tx.bookingTeman.create).toHaveBeenCalled();
    });

    it('member dengan paket biasa tetap ditolak booking ganda', async () => {
      const { service } = createService('BOOKED', 1, 0);
      await expect(tambahLagi(service, principal, 'SELF')).rejects.toMatchObject({
        code: 'DUPLICATE_ACTIVE_BOOKING',
      });
    });

    it('booking pertama member tidak ditandai sebagai kursi teman', async () => {
      const { service, tx } = createService(null, 0, 1);
      await tambahLagi(service, staf, 'ADMIN_ASSISTED');
      expect(tx.bookingTeman.create).not.toHaveBeenCalled();
    });
  });

  it('mengizinkan booking baru jika riwayat booking sebelumnya pada slot tersebut berstatus CANCELLED', async () => {
    const { service, tx } = createService('CANCELLED');

    const result = await service.create(
      principal as any,
      {
        classSlotId: slotId,
        customerPackageId,
        source: 'SELF',
      },
      'idem-key-3',
      'corr-3',
    );

    expect(result.status).toBe(HttpStatus.CREATED);
    expect(tx.pemesananKelas.create).toHaveBeenCalled();
  });
});
