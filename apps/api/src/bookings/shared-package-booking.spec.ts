import { HttpStatus } from '@nestjs/common';
import { BookingsService } from './pemesanan-kelas.service';
import { PolicyService } from '../identity/policy.service';

const slotId = '00000000-0000-4000-8000-000000000010';
const ownerUserId = '00000000-0000-4000-8000-000000000020';
const friendUserId = '00000000-0000-4000-8000-000000000021';
const strangerUserId = '00000000-0000-4000-8000-000000000022';
const customerPackageId = '00000000-0000-4000-8000-000000000030';
const branchId = '00000000-0000-4000-8000-000000000040';

describe('BookingsService - Shared / Family Package Booking', () => {
  function createTestContext(options: {
    isShareable: boolean;
    sharedMembers: Array<{ userId: string }>;
    remainingSessions: number;
    activeBookingsCount: number;
    purchaseStatus?: string;
    validUntil?: Date;
    slotBranchId?: string;
    packageClassTypeId?: string;
  }) {
    const futureDate = new Date(Date.now() + 24 * 3600 * 1000);
    const mockSlot = {
      id: slotId,
      branchId: options.slotBranchId ?? branchId,
      classTypeId: 'ct-1',
      studioId: 'std-1',
      startAt: futureDate,
      endAt: new Date(futureDate.getTime() + 3600 * 1000),
      status: 'PUBLISHED',
      capacity: 8,
      bookedCount: 0,
      branch: { id: options.slotBranchId ?? branchId, name: 'Branch' },
      classType: { id: 'ct-1', name: 'Reformer' },
      instructor: null,
      studio: null,
    };

    const mockPackage = {
      id: customerPackageId,
      userId: ownerUserId,
      status: 'ACTIVE',
      validUntil: options.validUntil ?? new Date(Date.now() + 30 * 24 * 3600 * 1000),
      remainingSessions: options.remainingSessions,
      purchase: { status: options.purchaseStatus ?? 'PAID', branchId },
      package: {
        id: 'pkg-1',
        name: 'Duet Package 10',
        branchId,
        classTypeId: options.packageClassTypeId ?? 'ct-1',
        isShareable: options.isShareable,
      },
      sharedMembers: options.sharedMembers,
    };

    const mockUsers: Record<string, any> = {
      [ownerUserId]: { id: ownerUserId, displayName: 'Owner Member', status: 'ACTIVE' },
      [friendUserId]: { id: friendUserId, displayName: 'Friend Member', status: 'ACTIVE' },
      [strangerUserId]: { id: strangerUserId, displayName: 'Stranger', status: 'ACTIVE' },
    };

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
        findUnique: jest.fn(async ({ where }: any) => mockUsers[where.id] ?? null),
      },
      pemesananKelas: {
        count: jest.fn(async () => options.activeBookingsCount),
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({
          ...data,
          id: 'new-bkg-id',
          user: mockUsers[data.userId],
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
        findUnique: jest.fn(async ({ where }: any) => ({
          id: where.id,
          status: 'ACTIVE',
          profile: { notes: 'KYC_APPROVED', selfieUrl: 'identity-documents/u/selfie.jpg' },
        })),
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

  it('pemilik paket dapat melakukan booking normal', async () => {
    const { service } = createTestContext({
      isShareable: true,
      sharedMembers: [{ userId: friendUserId }],
      remainingSessions: 5,
      activeBookingsCount: 0,
    });

    const result = await service.create(
      {
        sessionId: 'session-owner',
        userId: ownerUserId,
        roles: ['CUSTOMER'],
        capabilities: ['booking:self:create'],
        branchIds: [],
      } as any,
      {
        classSlotId: slotId,
        customerPackageId,
        source: 'SELF',
      },
      'idem-owner-1',
      'corr-1',
    );

    const body = result.body as any;
    expect(body.customerUserId).toBe(ownerUserId);
    expect(body.customerPackageId).toBe(customerPackageId);
  });

  it('anggota terdaftar (co-member) dapat booking jika paket isShareable = true', async () => {
    const { service } = createTestContext({
      isShareable: true,
      sharedMembers: [{ userId: friendUserId }],
      remainingSessions: 5,
      activeBookingsCount: 0,
    });

    const result = await service.create(
      {
        sessionId: 'session-friend',
        userId: friendUserId,
        roles: ['CUSTOMER'],
        capabilities: ['booking:self:create'],
        branchIds: [],
      } as any,
      {
        classSlotId: slotId,
        customerPackageId,
        source: 'SELF',
      },
      'idem-friend-1',
      'corr-2',
    );

    const body = result.body as any;
    expect(body.customerUserId).toBe(friendUserId);
    expect(body.customerPackageId).toBe(customerPackageId);
  });

  it('orang luar (bukan owner dan bukan shared member) ditolak RESOURCE_NOT_FOUND', async () => {
    const { service } = createTestContext({
      isShareable: true,
      sharedMembers: [{ userId: friendUserId }],
      remainingSessions: 5,
      activeBookingsCount: 0,
    });

    await expect(
      service.create(
        {
          sessionId: 'session-stranger',
          userId: strangerUserId,
          roles: ['CUSTOMER'],
          capabilities: ['booking:self:create'],
          branchIds: [],
        } as any,
        {
          classSlotId: slotId,
          customerPackageId,
          source: 'SELF',
        },
        'idem-stranger-1',
        'corr-3',
      ),
    ).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      status: HttpStatus.NOT_FOUND,
    });
  });

  it('ditolak jika paket bukan tipe isShareable (isShareable = false) meskipun user ada di list', async () => {
    const { service } = createTestContext({
      isShareable: false, // Paket individu biasa
      sharedMembers: [{ userId: friendUserId }],
      remainingSessions: 5,
      activeBookingsCount: 0,
    });

    await expect(
      service.create(
        {
          sessionId: 'session-friend-unshareable',
          userId: friendUserId,
          roles: ['CUSTOMER'],
          capabilities: ['booking:self:create'],
          branchIds: [],
        } as any,
        {
          classSlotId: slotId,
          customerPackageId,
          source: 'SELF',
        },
        'idem-friend-2',
        'corr-4',
      ),
    ).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      status: HttpStatus.NOT_FOUND,
    });
  });

  it('mencegah overbooking jika sisa kuota sesi bersama sudah habis terpakai booking aktif', async () => {
    const { service } = createTestContext({
      isShareable: true,
      sharedMembers: [{ userId: friendUserId }],
      remainingSessions: 1, // Sisa hanya 1 sesi
      activeBookingsCount: 1, // Sudah di-book 1 sesi oleh owner
    });

    await expect(
      service.create(
        {
          sessionId: 'session-friend-overbook',
          userId: friendUserId,
          roles: ['CUSTOMER'],
          capabilities: ['booking:self:create'],
          branchIds: [],
        } as any,
        {
          classSlotId: slotId,
          customerPackageId,
          source: 'SELF',
        },
        'idem-friend-3',
        'corr-5',
      ),
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_AVAILABLE_SESSIONS',
      status: HttpStatus.CONFLICT,
    });
  });

  it('anggota terdaftar ditolak jika pembelian paket belum lunas (PURCHASE_NOT_PAID 409)', async () => {
    const { service } = createTestContext({
      isShareable: true,
      sharedMembers: [{ userId: friendUserId }],
      remainingSessions: 5,
      activeBookingsCount: 0,
      purchaseStatus: 'WAITING_VERIFICATION',
    });

    await expect(
      service.create(
        {
          sessionId: 'session-friend-unpaid',
          userId: friendUserId,
          roles: ['CUSTOMER'],
          capabilities: ['booking:self:create'],
          branchIds: [],
        } as any,
        {
          classSlotId: slotId,
          customerPackageId,
          source: 'SELF',
        },
        'idem-friend-unpaid',
        'corr-6',
      ),
    ).rejects.toMatchObject({
      code: 'PURCHASE_NOT_PAID',
      status: HttpStatus.CONFLICT,
    });
  });

  it('anggota terdaftar ditolak jika masa berlaku paket sudah habis (INSUFFICIENT_AVAILABLE_SESSIONS 409)', async () => {
    const { service } = createTestContext({
      isShareable: true,
      sharedMembers: [{ userId: friendUserId }],
      remainingSessions: 5,
      activeBookingsCount: 0,
      validUntil: new Date(Date.now() - 24 * 3600 * 1000), // Kemarin (kadaluwarsa)
    });

    await expect(
      service.create(
        {
          sessionId: 'session-friend-expired',
          userId: friendUserId,
          roles: ['CUSTOMER'],
          capabilities: ['booking:self:create'],
          branchIds: [],
        } as any,
        {
          classSlotId: slotId,
          customerPackageId,
          source: 'SELF',
        },
        'idem-friend-expired',
        'corr-7',
      ),
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_AVAILABLE_SESSIONS',
      status: HttpStatus.CONFLICT,
    });
  });

  it('anggota terdaftar ditolak jika cabang paket tidak cocok dengan cabang kelas (PACKAGE_BRANCH_MISMATCH 409)', async () => {
    const { service } = createTestContext({
      isShareable: true,
      sharedMembers: [{ userId: friendUserId }],
      remainingSessions: 5,
      activeBookingsCount: 0,
      slotBranchId: 'foreign-branch-id',
    });

    await expect(
      service.create(
        {
          sessionId: 'session-friend-branch',
          userId: friendUserId,
          roles: ['CUSTOMER'],
          capabilities: ['booking:self:create'],
          branchIds: [],
        } as any,
        {
          classSlotId: slotId,
          customerPackageId,
          source: 'SELF',
        },
        'idem-friend-branch',
        'corr-8',
      ),
    ).rejects.toMatchObject({
      code: 'PACKAGE_BRANCH_MISMATCH',
      status: HttpStatus.CONFLICT,
    });
  });

  it('anggota terdaftar ditolak jika tipe kelas paket tidak cocok dengan kelas slot (PACKAGE_CLASS_TYPE_MISMATCH 409)', async () => {
    const { service } = createTestContext({
      isShareable: true,
      sharedMembers: [{ userId: friendUserId }],
      remainingSessions: 5,
      activeBookingsCount: 0,
      packageClassTypeId: 'different-class-type',
    });

    await expect(
      service.create(
        {
          sessionId: 'session-friend-classtype',
          userId: friendUserId,
          roles: ['CUSTOMER'],
          capabilities: ['booking:self:create'],
          branchIds: [],
        } as any,
        {
          classSlotId: slotId,
          customerPackageId,
          source: 'SELF',
        },
        'idem-friend-classtype',
        'corr-9',
      ),
    ).rejects.toMatchObject({
      code: 'PACKAGE_CLASS_TYPE_MISMATCH',
      status: HttpStatus.CONFLICT,
    });
  });
});
