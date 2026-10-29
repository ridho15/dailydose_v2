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

describe('BookingsService - Unpaid Package Guard (Poin 6)', () => {
  function createService(purchaseStatus: 'WAITING_VERIFICATION' | 'PENDING' | 'PAID') {
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
      bookedCount: 0,
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
      purchase: { status: purchaseStatus },
      package: { id: 'pkg-1', name: 'Pkg 10', branchId, classTypeId: 'ct-1' },
    };

    const mockCustomer = {
      id: customerUserId,
      status: 'ACTIVE',
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
        findUnique: jest.fn(async () => mockCustomer),
      },
      pemesananKelas: {
        count: jest.fn(async () => 0),
        findFirst: jest.fn(async () => null),
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
        findUnique: jest.fn(async () => ({
          id: customerUserId,
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

  it('menolak booking jika pembelian paket berstatus WAITING_VERIFICATION (PURCHASE_NOT_PAID 409)', async () => {
    const { service } = createService('WAITING_VERIFICATION');

    await expect(
      service.create(
        principal as any,
        {
          classSlotId: slotId,
          customerPackageId,
          source: 'SELF',
        },
        'idem-key-unpaid-1',
        'corr-1',
      ),
    ).rejects.toMatchObject({
      code: 'PURCHASE_NOT_PAID',
      status: HttpStatus.CONFLICT,
    });
  });

  it('menolak booking jika pembelian paket berstatus PENDING (PURCHASE_NOT_PAID 409)', async () => {
    const { service } = createService('PENDING');

    await expect(
      service.create(
        principal as any,
        {
          classSlotId: slotId,
          customerPackageId,
          source: 'SELF',
        },
        'idem-key-unpaid-2',
        'corr-2',
      ),
    ).rejects.toMatchObject({
      code: 'PURCHASE_NOT_PAID',
      status: HttpStatus.CONFLICT,
    });
  });

  it('mengizinkan booking jika pembelian paket berstatus PAID', async () => {
    const { service, tx } = createService('PAID');

    const result = await service.create(
      principal as any,
      {
        classSlotId: slotId,
        customerPackageId,
        source: 'SELF',
      },
      'idem-key-paid',
      'corr-3',
    );

    expect(result.status).toBe(HttpStatus.CREATED);
    expect(tx.pemesananKelas.create).toHaveBeenCalled();
  });
});
