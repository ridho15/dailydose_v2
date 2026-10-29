import {
  CustomerManagementService,
  customerVerificationStatus,
  verificationStatusWhere,
} from './manajemen-pelanggan.service';
import { PolicyService } from './policy.service';

const profile = (overrides: Record<string, unknown>) => ({
  ktpUrl: null,
  selfieUrl: null,
  notes: null,
  ...overrides,
});

describe('status verifikasi pelanggan satu sumber (selfie saja, tanpa KTP)', () => {
  it.each([
    [null, 'ACTION_REQUIRED'],
    [profile({}), 'ACTION_REQUIRED'],
    // KTP tidak dihitung lagi: tanpa selfie tetap harus mengambil foto.
    [profile({ ktpUrl: 'k' }), 'ACTION_REQUIRED'],
    [profile({ ktpUrl: 'k', notes: 'KYC_APPROVED' }), 'ACTION_REQUIRED'],
    // Punya selfie berarti terverifikasi, tanpa menunggu persetujuan staf.
    [profile({ selfieUrl: 's' }), 'APPROVED'],
    [profile({ ktpUrl: 'k', selfieUrl: 's', notes: 'KYC_APPROVED' }), 'APPROVED'],
    // Foto ditolak staf: fotonya dihapus, member diminta mengambil ulang.
    [profile({ notes: 'SELFIE_UPDATED | KYC_REJECTED: FOTO_BURAM (ref: x)' }), 'REJECTED'],
    [profile({ selfieUrl: 's2', notes: 'KYC_REJECTED: FOTO_BURAM | SELFIE_UPDATED' }), 'APPROVED'],
  ])('%j → %s', (input, expected) => {
    expect(customerVerificationStatus(input as never)).toBe(expected);
  });

  it('daftar pelanggan memakai status yang sama dengan detail, bukan APPROVED untuk semua', async () => {
    const users = [
      { id: 'u1', displayName: 'A', profile: null },
      { id: 'u2', displayName: 'B', profile: profile({ ktpUrl: 'k' }) },
      {
        id: 'u3',
        displayName: 'C',
        profile: profile({ ktpUrl: 'k', selfieUrl: 's', notes: 'KYC_APPROVED' }),
      },
    ].map((u) => ({
      ...u,
      email: `${u.id}@x.test`,
      phone: null,
      status: 'ACTIVE',
      preferredBranchId: null,
      customerPackages: [],
      _count: { customerPackages: 0, bookings: 0, purchases: 0 },
      createdAt: new Date('2026-10-01T00:00:00Z'),
    }));
    const db = {
      user: { findMany: jest.fn().mockResolvedValue(users), count: jest.fn().mockResolvedValue(3) },
    };
    const service = new CustomerManagementService(db as never, new PolicyService());
    const result = await service.list(
      {
        sessionId: 's',
        userId: 'staff',
        roles: [] as never,
        capabilities: ['customer:read'],
        branchIds: [],
      },
      {},
    );
    expect(result.items.map((item) => item.verificationStatus)).toEqual([
      'ACTION_REQUIRED',
      'ACTION_REQUIRED',
      'APPROVED',
    ]);
  });

  it('menerapkan filter verificationStatus pada pencarian', async () => {
    const db = {
      user: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    };
    const service = new CustomerManagementService(db as never, new PolicyService());
    await service.list(
      {
        sessionId: 's',
        userId: 'staff',
        roles: [] as never,
        capabilities: ['customer:read'],
        branchIds: [],
      },
      { verificationStatus: 'APPROVED' },
    );
    const where = db.user.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('"selfieUrl":{"not":null}');
    expect(JSON.stringify(db.user.count.mock.calls[0][0].where)).toContain(
      '"selfieUrl":{"not":null}',
    );
  });

  it('tidak ada lagi yang menunggu persetujuan: filter PENDING selalu kosong', () => {
    expect(verificationStatusWhere('PENDING')).toEqual({ id: { in: [] } });
  });
});
