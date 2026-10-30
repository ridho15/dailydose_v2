import { HttpStatus } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { PolicyService } from '../identity/policy.service';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const branchA = id(1);
const packageId = id(10);
const ownerId = id(100);
const friendId = id(101);
const strangerId = id(102);

const ownerPrincipal = {
  sessionId: 's-owner',
  userId: ownerId,
  roles: [{ role: 'CUSTOMER' }],
  capabilities: ['ledger:read'],
  branchIds: [],
};

const adminPrincipal = {
  sessionId: 's-admin',
  userId: id(999),
  roles: [{ role: 'ADMIN' }],
  capabilities: ['ledger:read', 'customer-package:manage', 'branch:all'],
  branchIds: [branchA],
};

const strangerPrincipal = {
  sessionId: 's-stranger',
  userId: strangerId,
  roles: [{ role: 'CUSTOMER' }],
  capabilities: ['ledger:read'],
  branchIds: [],
};

describe('LedgerService - Shared Package Members Management', () => {
  function setupTest(overrides: { isShareable?: boolean; sharedMembers?: any[] } = {}) {
    const isShareable = overrides.isShareable ?? true;
    const sharedMembers = overrides.sharedMembers ?? [];

    const mockPackage = {
      id: packageId,
      userId: ownerId,
      remainingSessions: 5,
      usedSessions: 0,
      totalSessions: 5,
      status: 'ACTIVE',
      validFrom: new Date('2026-01-01'),
      validUntil: new Date('2099-01-01'),
      purchaseId: id(30),
      user: { id: ownerId, displayName: 'Owner User', phone: '081234567890' },
      package: {
        id: id(40),
        name: 'Duet Package 5',
        isShareable,
        classType: { id: id(41), name: 'Reformer' },
      },
      purchase: { branchId: branchA, branch: { id: branchA, name: 'Green Garden' } },
      sharedMembers,
      bookings: [],
    };

    const mockUsers: Record<string, any> = {
      [ownerId]: { id: ownerId, displayName: 'Owner User', phone: '081234567890', email: 'owner@test.com', status: 'ACTIVE' },
      [friendId]: { id: friendId, displayName: 'Friend User', phone: '081299998888', email: 'friend@test.com', status: 'ACTIVE' },
    };

    const db = {
      paketPelanggan: {
        findUnique: jest.fn(async ({ where }: any) => {
          if (where.id === packageId) return mockPackage;
          return null;
        }),
        findMany: jest.fn(async () => [mockPackage]),
        count: jest.fn(async () => 1),
      },
      user: {
        findUnique: jest.fn(async ({ where }: any) => mockUsers[where.id] ?? null),
      },
      paketPelangganAnggota: {
        findMany: jest.fn(async () => sharedMembers),
        create: jest.fn(async ({ data }: any) => ({
          id: id(500),
          ...data,
          user: mockUsers[data.userId],
          createdAt: new Date(),
        })),
        delete: jest.fn(async () => ({})),
      },
      pemesananKelas: {
        count: jest.fn(async () => 0),
      },
      sessionLedger: {
        groupBy: jest.fn(async () => []),
      },
    };

    const audit = {
      catat: jest.fn(async () => {}),
      record: jest.fn(),
    };

    const service = new LedgerService(db as any, new PolicyService(), audit as any);

    return { service, db, mockPackage };
  }

  it('owner dan admin dapat melihat daftar shared members', async () => {
    const { service } = setupTest({
      isShareable: true,
      sharedMembers: [
        {
          id: id(501),
          customerPackageId: packageId,
          userId: friendId,
          relationship: 'FAMILY',
          addedById: ownerId,
          addedByRole: 'CUSTOMER',
          createdAt: new Date(),
          user: { id: friendId, displayName: 'Friend User', phone: '081299998888', email: 'friend@test.com' },
        },
      ],
    });

    const resultOwner = await service.listPackageMembers(ownerPrincipal as any, packageId);
    expect(resultOwner.customerPackageId).toBe(packageId);
    expect(resultOwner.members.length).toBe(1);
    expect(resultOwner.members[0]?.userId).toBe(friendId);

    const resultAdmin = await service.listPackageMembers(adminPrincipal as any, packageId);
    expect(resultAdmin.members.length).toBe(1);
  });

  it('orang luar tidak dapat melihat daftar shared members (RESOURCE_NOT_FOUND)', async () => {
    const { service } = setupTest();

    await expect(
      service.listPackageMembers(strangerPrincipal as any, packageId),
    ).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      status: HttpStatus.NOT_FOUND,
    });
  });

  it('owner atau admin dapat menambahkan member ke paket isShareable', async () => {
    const { service, db } = setupTest({ isShareable: true, sharedMembers: [] });

    const added = await service.addPackageMember(ownerPrincipal as any, packageId, {
      userId: friendId,
      relationship: 'FRIEND',
    });

    expect(added.userId).toBe(friendId);
    expect(added.relationship).toBe('FRIEND');
    expect(db.paketPelangganAnggota.create).toHaveBeenCalled();
  });

  it('menolak menambahkan member jika paket bukan isShareable (PACKAGE_NOT_SHAREABLE 400)', async () => {
    const { service } = setupTest({ isShareable: false });

    await expect(
      service.addPackageMember(ownerPrincipal as any, packageId, {
        userId: friendId,
      }),
    ).rejects.toMatchObject({
      code: 'PACKAGE_NOT_SHAREABLE',
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('menolak menambahkan owner sendiri sebagai shared member (CANNOT_ADD_OWNER_AS_MEMBER 400)', async () => {
    const { service } = setupTest({ isShareable: true });

    await expect(
      service.addPackageMember(ownerPrincipal as any, packageId, {
        userId: ownerId,
      }),
    ).rejects.toMatchObject({
      code: 'CANNOT_ADD_OWNER_AS_MEMBER',
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('menolak menambahkan member yang sudah terdaftar (MEMBER_ALREADY_ADDED 409)', async () => {
    const { service } = setupTest({
      isShareable: true,
      sharedMembers: [{ userId: friendId }],
    });

    await expect(
      service.addPackageMember(ownerPrincipal as any, packageId, {
        userId: friendId,
      }),
    ).rejects.toMatchObject({
      code: 'MEMBER_ALREADY_ADDED',
      status: HttpStatus.CONFLICT,
    });
  });

  it('dapat menghapus member jika tidak ada booking aktif', async () => {
    const { service, db } = setupTest({
      isShareable: true,
      sharedMembers: [{ id: id(501), userId: friendId }],
    });

    const res = await service.removePackageMember(ownerPrincipal as any, packageId, friendId);
    expect(res.success).toBe(true);
    expect(db.paketPelangganAnggota.delete).toHaveBeenCalled();
  });

  it('menolak menghapus member jika masih memiliki booking aktif (MEMBER_HAS_ACTIVE_BOOKINGS 409)', async () => {
    const { service, db } = setupTest({
      isShareable: true,
      sharedMembers: [{ id: id(501), userId: friendId }],
    });

    db.pemesananKelas.count = jest.fn(async () => 1); // 1 active booking

    await expect(
      service.removePackageMember(ownerPrincipal as any, packageId, friendId),
    ).rejects.toMatchObject({
      code: 'MEMBER_HAS_ACTIVE_BOOKINGS',
      status: HttpStatus.CONFLICT,
    });
  });

  it('orang luar ditolak saat mencoba menambah anggota bersama (FORBIDDEN 403)', async () => {
    const { service } = setupTest({ isShareable: true });

    await expect(
      service.addPackageMember(strangerPrincipal as any, packageId, {
        userId: friendId,
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: HttpStatus.FORBIDDEN,
    });
  });

  it('orang luar ditolak saat mencoba menghapus anggota bersama (FORBIDDEN 403)', async () => {
    const { service } = setupTest({
      isShareable: true,
      sharedMembers: [{ id: id(501), userId: friendId }],
    });

    await expect(
      service.removePackageMember(strangerPrincipal as any, packageId, friendId),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: HttpStatus.FORBIDDEN,
    });
  });

  it('menolak menambahkan member jika user tidak ditemukan di database (USER_NOT_FOUND 404)', async () => {
    const { service } = setupTest({ isShareable: true });

    await expect(
      service.addPackageMember(ownerPrincipal as any, packageId, {
        userId: id(888), // user does not exist
      }),
    ).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
      status: HttpStatus.NOT_FOUND,
    });
  });

  it('menolak menghapus member jika user tidak terdaftar di paket (MEMBER_NOT_FOUND 404)', async () => {
    const { service } = setupTest({ isShareable: true, sharedMembers: [] });

    await expect(
      service.removePackageMember(ownerPrincipal as any, packageId, friendId),
    ).rejects.toMatchObject({
      code: 'MEMBER_NOT_FOUND',
      status: HttpStatus.NOT_FOUND,
    });
  });

  it('menolak menambah anggota jika status paket bukan ACTIVE (PACKAGE_NOT_ACTIVE 400)', async () => {
    const { service, mockPackage } = setupTest({ isShareable: true });
    mockPackage.status = 'FROZEN';

    await expect(
      service.addPackageMember(ownerPrincipal as any, packageId, {
        userId: friendId,
      }),
    ).rejects.toMatchObject({
      code: 'PACKAGE_NOT_ACTIVE',
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('staf cabang lain ditolak saat mencoba mengelola anggota paket di luar cabangnya (RESOURCE_NOT_FOUND 404)', async () => {
    const { service } = setupTest({ isShareable: true });
    const foreignStaff = {
      sessionId: 's-foreign',
      userId: id(777),
      roles: [{ role: 'ADMIN' }],
      capabilities: ['customer-package:manage'],
      branchIds: [id(99)], // Branch berbeda, tidak punya branch:all
    };

    await expect(
      service.addPackageMember(foreignStaff as any, packageId, {
        userId: friendId,
      }),
    ).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      status: HttpStatus.NOT_FOUND,
    });
  });
});
