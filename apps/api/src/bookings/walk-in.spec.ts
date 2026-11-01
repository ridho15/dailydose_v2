import { HttpStatus } from '@nestjs/common';
import { BookingsService } from './pemesanan-kelas.service';
import { PolicyService } from '../identity/policy.service';

const branchId = '00000000-0000-4000-8000-000000000001';
const slotId = '00000000-0000-4000-8000-000000000002';
const customerUserId = '00000000-0000-4000-8000-000000000003';
const packageId = '00000000-0000-4000-8000-000000000004';
const staffUserId = '00000000-0000-4000-8000-000000000099';

const staffPrincipal = {
  sessionId: 'staff-session',
  userId: staffUserId,
  roles: [] as never,
  capabilities: ['booking:create:assisted'],
  branchIds: [branchId],
};

describe('BookingsService.walkIn (Fase 3: Alur Cepat Walk-In & Booking Kasir)', () => {
  function createService(overrides?: {
    slotStatus?: string;
    slotEndAt?: Date;
    capacity?: number;
    activeBookingsCount?: number;
    existingDuplicate?: boolean;
    pkgBranchId?: string | null;
  }) {
    const now = new Date();
    const futureEnd = overrides?.slotEndAt ?? new Date(now.getTime() + 45 * 60 * 1000); // 45 mins later

    const mockCustomer = {
      id: customerUserId,
      role: 'CUSTOMER',
      status: 'ACTIVE',
      displayName: 'Dewi Lestari',
      email: 'dewi@example.com',
      phone: '+6281234567890',
    };

    const mockSlot = {
      id: slotId,
      branchId,
      classTypeId: 'ct-1',
      studioId: 'std-1',
      startAt: new Date(now.getTime() - 15 * 60 * 1000), // Started 15 mins ago, ends in 45 mins
      endAt: futureEnd,
      status: overrides?.slotStatus ?? 'PUBLISHED',
      capacity: overrides?.capacity ?? 8,
      bookedCount: overrides?.activeBookingsCount ?? 2,
      branch: { id: branchId, name: 'Sudirman Studio', timezone: 'Asia/Jakarta' },
      classType: { id: 'ct-1', name: 'Reformer Beginner' },
      instructor: { id: 'inst-1', displayName: 'Budi Instruktur' },
      studio: { id: 'std-1', name: 'Studio A' },
    };

    const mockPackage = {
      id: packageId,
      name: 'Single Walk-In Visit',
      status: 'ACTIVE',
      branchId: overrides?.pkgBranchId !== undefined ? overrides.pkgBranchId : branchId,
      classTypeId: null,
      priceRp: 150_000,
      sessionCount: 1,
      validityDays: 1,
    };

    const tx = {
      user: {
        findUnique: jest.fn(async () => mockCustomer),
      },
      slotKelas: {
        findUnique: jest.fn(async () => mockSlot),
        update: jest.fn(async () => mockSlot),
      },
      paket: {
        findUnique: jest.fn(async () => mockPackage),
      },
      pemesananKelas: {
        count: jest.fn(async () => overrides?.activeBookingsCount ?? 2),
        findFirst: jest.fn(async () =>
          overrides?.existingDuplicate
            ? { id: 'existing-bkg', userId: customerUserId, classSlotId: slotId, status: 'BOOKED' }
            : null,
        ),
        create: jest.fn(async ({ data }: any) => ({
          ...data,
          id: 'new-walk-in-bkg-id',
          user: mockCustomer,
          classSlot: mockSlot,
          customerPackage: { id: 'new-cp-id', package: mockPackage },
          attendance: null,
          checkInTokens: [],
        })),
      },
      pembelian: {
        create: jest.fn(async ({ data }: any) => ({
          ...data,
          id: 'new-order-id',
        })),
      },
      paketPelanggan: {
        create: jest.fn(async ({ data }: any) => ({
          ...data,
          id: 'new-cp-id',
        })),
      },
      sessionLedger: {
        create: jest.fn(async ({ data }: any) => ({
          ...data,
          id: 'new-ledger-id',
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

    const audit = {
      catat: jest.fn(async () => {}),
    };

    const service = new BookingsService(
      {} as any,
      idempotency as any,
      new PolicyService(),
      config as any,
      audit as any,
    );

    return { service, tx };
  }

  it('berhasil memproses walk-in kasir dengan Instant Reserve Sesi Pertama & Maker-Checker', async () => {
    const { service, tx } = createService();

    const result = await service.walkIn(
      staffPrincipal as any,
      {
        branchId,
        classSlotId: slotId,
        customerUserId,
        packageId,
        paymentMethod: 'CASH',
        paymentNote: 'Uang pas diterima kasir',
      },
      'idemp-walkin-1',
      'corr-walkin-1',
    );

    expect(result.status).toBe(HttpStatus.CREATED);
    const body = result.body as any;

    // 1. Booking terdaftar langsung (Confirmed Seat)
    expect(body.booking).toBeDefined();
    expect(body.booking.status).toBe('BOOKED');
    expect(body.booking.source).toBe('ADMIN_ASSISTED');

    // 2. Pembelian kasir tercatat berstatus PENDING (menunggu rekap/verifikasi Manager)
    expect(body.purchase).toBeDefined();
    expect(body.purchase.status).toBe('PENDING');
    expect(body.purchase.paymentMethod).toBe('CASH');
    expect(body.purchase.totalAmountRp).toBe(150_000);
    expect(tx.pembelian.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recordedById: staffUserId,
          recordNote: 'Uang pas diterima kasir',
          status: 'PENDING',
        }),
      }),
    );

    // 3. Paket pelanggan aktif dibuat untuk instant reserve
    expect(body.customerPackage).toBeDefined();
    expect(body.customerPackage.remainingSessions).toBe(1);

    // 4. Kuota slot di-update
    expect(tx.slotKelas.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: slotId },
        data: { bookedCount: 3 },
      }),
    );
  });

  it('menolak walk-in jika kelas sudah selesai', async () => {
    const pastEnd = new Date(Date.now() - 10 * 60 * 1000); // Ended 10 minutes ago
    const { service } = createService({ slotEndAt: pastEnd });

    await expect(
      service.walkIn(
        staffPrincipal as any,
        {
          branchId,
          classSlotId: slotId,
          customerUserId,
          packageId,
          paymentMethod: 'QRIS',
        },
        'idemp-walkin-2',
        'corr-walkin-2',
      ),
    ).rejects.toThrow('CLASS_ALREADY_ENDED');
  });

  it('menolak walk-in jika kelas sudah penuh (kapasitas terlampaui)', async () => {
    const { service } = createService({ capacity: 8, activeBookingsCount: 8 });

    await expect(
      service.walkIn(
        staffPrincipal as any,
        {
          branchId,
          classSlotId: slotId,
          customerUserId,
          packageId,
          paymentMethod: 'CARD',
        },
        'idemp-walkin-3',
        'corr-walkin-3',
      ),
    ).rejects.toThrow('CLASS_CAPACITY_FULL');
  });

  it('menolak walk-in jika member sudah terdaftar di kelas tersebut', async () => {
    const { service } = createService({ existingDuplicate: true });

    await expect(
      service.walkIn(
        staffPrincipal as any,
        {
          branchId,
          classSlotId: slotId,
          customerUserId,
          packageId,
          paymentMethod: 'CASH',
        },
        'idemp-walkin-4',
        'corr-walkin-4',
      ),
    ).rejects.toThrow('DUPLICATE_ACTIVE_BOOKING');
  });
});
