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
      slotKelas: {
        findUnique: jest.fn(async () => mockSlot),
      },
      paketPelanggan: {
        findMany: jest.fn(async (args?: any) => {
          const andList = args?.where?.AND;
          const userClause = andList?.[0]?.OR;
          const purchaseClause = andList?.[1]?.OR;

          if (mockPackage.status !== args?.where?.status) return [];
          if (mockPackage.validUntil && args?.where?.validUntil?.gt && mockPackage.validUntil <= new Date()) return [];
          if (mockPackage.remainingSessions <= 0) return [];
          if (args?.where?.package?.OR) {
            const classMatches = args.where.package.OR.some(
              (c: any) => c.classTypeId === null || c.classTypeId === mockPackage.package.classTypeId,
            );
            if (!classMatches) return [];
          }

          if (userClause) {
            const matchesUser = userClause.some((clause: any) => {
              if (clause.userId && clause.userId === mockPackage.userId) return true;
              if (clause.package?.isShareable && clause.sharedMembers?.some?.userId) {
                const targetId = clause.sharedMembers.some.userId;
                return Boolean(mockPackage.package.isShareable) && mockPackage.sharedMembers.some((sm: any) => sm.userId === targetId);
              }
              return false;
            });
            if (!matchesUser) return [];
          }

          if (purchaseClause) {
            const purchasePaid = purchaseClause.some((clause: any) => {
              if (clause.purchaseId === null && mockPackage.purchase === null) return true;
              if (clause.purchase?.status === mockPackage.purchase?.status) return true;
              return false;
            });
            if (!purchasePaid) return [];
          }

          return [mockPackage];
        }),
      },
      pemesananKelas: {
        count: jest.fn(async () => options.activeBookingsCount),
      },
    };

    const service = new BookingsService(
      mockDb as any,
      idempotency as any,
      new PolicyService(),
      config as any,
    );

    return { service, tx, mockDb };
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

  describe('customerOptions - Hak Akses Anggota Bersama (Co-Member)', () => {
    it('anggota terdaftar (co-member) dapat melihat paket bersama di customerOptions dan canBook = true (Happy Path)', async () => {
      const { service, mockDb } = createTestContext({
        isShareable: true,
        sharedMembers: [{ userId: friendUserId }],
        remainingSessions: 5,
        activeBookingsCount: 0,
      });

      const coMemberPrincipal = {
        sessionId: 'session-friend',
        userId: friendUserId,
        roles: [{ role: 'CUSTOMER', branchId }],
        capabilities: ['customer:self', 'booking:self:create'],
        branchIds: [branchId],
      };

      const result = await service.customerOptions(coMemberPrincipal as any, slotId);

      // Verifikasi query Prisma memuat klausa OR untuk userId maupun sharedMembers
      expect(mockDb.paketPelanggan.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({
                OR: [
                  { userId: friendUserId },
                  {
                    package: { isShareable: true },
                    sharedMembers: { some: { userId: friendUserId } },
                  },
                ],
              }),
            ]),
          }),
        }),
      );

      // Paket bersama sukses dikembalikan dan status booking aktif
      expect(result.packages).toHaveLength(1);
      expect(result.packages[0]?.customerPackageId).toBe(customerPackageId);
      expect(result.packages[0]?.packageName).toBe('Duet Package 10');
      expect(result.packages[0]?.available).toBe(5);
      expect(result.eligibility.canBook).toBe(true);
      expect(result.eligibility.reasonCode).toBeNull();
    });

    it('orang luar (stranger) yang tidak terdaftar di sharedMembers tidak mendapatkan paket (canBook = false, MATCHING_PACKAGE_REQUIRED)', async () => {
      const { service } = createTestContext({
        isShareable: true,
        sharedMembers: [{ userId: friendUserId }],
        remainingSessions: 5,
        activeBookingsCount: 0,
      });

      const strangerPrincipal = {
        sessionId: 'session-stranger',
        userId: strangerUserId,
        roles: [{ role: 'CUSTOMER', branchId }],
        capabilities: ['customer:self'],
        branchIds: [branchId],
      };

      const result = await service.customerOptions(strangerPrincipal as any, slotId);

      expect(result.packages).toHaveLength(0);
      expect(result.eligibility.canBook).toBe(false);
      expect(result.eligibility.reasonCode).toBe('MATCHING_PACKAGE_REQUIRED');
      expect(result.eligibility.requiredAction).toBe('BUY_MATCHING_PACKAGE');
    });

    it('co-member mendapatkan INSUFFICIENT_AVAILABLE_SESSION jika seluruh kuota paket bersama sudah habis/terpakai booking aktif', async () => {
      const { service } = createTestContext({
        isShareable: true,
        sharedMembers: [{ userId: friendUserId }],
        remainingSessions: 2,
        activeBookingsCount: 2, // 2 sesi sudah di-book aktif oleh member lain
      });

      const coMemberPrincipal = {
        sessionId: 'session-friend',
        userId: friendUserId,
        roles: [{ role: 'CUSTOMER', branchId }],
        capabilities: ['customer:self'],
        branchIds: [branchId],
      };

      const result = await service.customerOptions(coMemberPrincipal as any, slotId);

      expect(result.packages).toHaveLength(0);
      expect(result.eligibility.canBook).toBe(false);
      expect(result.eligibility.reasonCode).toBe('INSUFFICIENT_AVAILABLE_SESSION');
      expect(result.eligibility.requiredAction).toBe('BUY_MATCHING_PACKAGE');
    });

    it('co-member ditolak jika paket bukan tipe shareable (isShareable = false)', async () => {
      const { service } = createTestContext({
        isShareable: false,
        sharedMembers: [{ userId: friendUserId }],
        remainingSessions: 5,
        activeBookingsCount: 0,
      });

      const coMemberPrincipal = {
        sessionId: 'session-friend',
        userId: friendUserId,
        roles: [{ role: 'CUSTOMER', branchId }],
        capabilities: ['customer:self'],
        branchIds: [branchId],
      };

      const result = await service.customerOptions(coMemberPrincipal as any, slotId);

      expect(result.packages).toHaveLength(0);
      expect(result.eligibility.canBook).toBe(false);
      expect(result.eligibility.reasonCode).toBe('MATCHING_PACKAGE_REQUIRED');
    });

    it('co-member ditolak jika pembayaran paket belum lunas (purchaseStatus != PAID)', async () => {
      const { service } = createTestContext({
        isShareable: true,
        sharedMembers: [{ userId: friendUserId }],
        remainingSessions: 5,
        activeBookingsCount: 0,
        purchaseStatus: 'WAITING_VERIFICATION',
      });

      const coMemberPrincipal = {
        sessionId: 'session-friend',
        userId: friendUserId,
        roles: [{ role: 'CUSTOMER', branchId }],
        capabilities: ['customer:self'],
        branchIds: [branchId],
      };

      const result = await service.customerOptions(coMemberPrincipal as any, slotId);

      expect(result.packages).toHaveLength(0);
      expect(result.eligibility.canBook).toBe(false);
      expect(result.eligibility.reasonCode).toBe('MATCHING_PACKAGE_REQUIRED');
    });

    it('co-member ditolak jika masa berlaku paket sudah habis (validUntil <= now)', async () => {
      const { service } = createTestContext({
        isShareable: true,
        sharedMembers: [{ userId: friendUserId }],
        remainingSessions: 5,
        activeBookingsCount: 0,
        validUntil: new Date(Date.now() - 3600 * 1000), // Kedaluwarsa 1 jam lalu
      });

      const coMemberPrincipal = {
        sessionId: 'session-friend',
        userId: friendUserId,
        roles: [{ role: 'CUSTOMER', branchId }],
        capabilities: ['customer:self'],
        branchIds: [branchId],
      };

      const result = await service.customerOptions(coMemberPrincipal as any, slotId);

      expect(result.packages).toHaveLength(0);
      expect(result.eligibility.canBook).toBe(false);
      expect(result.eligibility.reasonCode).toBe('MATCHING_PACKAGE_REQUIRED');
    });

    it('co-member ditolak jika cabang paket tidak cocok dengan cabang slot', async () => {
      const { service } = createTestContext({
        isShareable: true,
        sharedMembers: [{ userId: friendUserId }],
        remainingSessions: 5,
        activeBookingsCount: 0,
        slotBranchId: 'other-branch-surabaya-timur',
      });

      const coMemberPrincipal = {
        sessionId: 'session-friend',
        userId: friendUserId,
        roles: [{ role: 'CUSTOMER', branchId }],
        capabilities: ['customer:self'],
        branchIds: [branchId],
      };

      const result = await service.customerOptions(coMemberPrincipal as any, slotId);

      expect(result.packages).toHaveLength(0);
      expect(result.eligibility.canBook).toBe(false);
      expect(result.eligibility.reasonCode).toBe('MATCHING_PACKAGE_REQUIRED');
    });
  });
});
