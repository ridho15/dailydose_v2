import { mapUserToEffectiveRoles } from './identity.service';
import { PolicyService } from './policy.service';
import { cabangPetugasCheckin } from './petugas-checkin';
import { PetugasCheckinService } from './petugas-checkin.service';
import { pastikanRutePetugas } from './rute-petugas-checkin';
import { ROLE_CAPABILITIES } from './role-capabilities';
import * as tabelOpsional from '../foundation/tabel-opsional';

const petugas = { roles: [{ role: 'CHECKIN_STAFF' as const, branchId: 'gg' }] };

describe('Peran Petugas Check-in', () => {
  it('akun dengan baris petugas menjadi CHECKIN_STAFF, apa pun user.role-nya; hanya attendance:desk', () => {
    expect(mapUserToEffectiveRoles({ role: 'ADMIN', preferredBranchId: 'gg' }, 'gg')).toEqual([{ role: 'CHECKIN_STAFF', branchId: 'gg' }]);
    expect(mapUserToEffectiveRoles({ role: 'ADMIN', preferredBranchId: 'gg' })).toEqual([{ role: 'ADMIN', branchId: 'gg' }]);
    expect(ROLE_CAPABILITIES.CHECKIN_STAFF).toEqual(['attendance:desk']);
    const akses = new PolicyService().resolveAccess('u', [{ role: 'CHECKIN_STAFF', branchId: 'gg' }]);
    expect(akses.capabilities).toEqual(['attendance:desk']);
    expect(akses.branchIds).toEqual(['gg']);
  });

  it('cabangPetugasCheckin: tabel belum ada berarti bukan petugas; galat database lain dilempar (login gagal, bukan jadi Admin)', async () => {
    const galatTabel = Object.assign(new (require('@prisma/client').Prisma.PrismaClientKnownRequestError)('x', { code: 'P2021', clientVersion: 'x' }));
    await expect(cabangPetugasCheckin({ petugasCheckin: { findUnique: async () => { throw galatTabel; } } }, 'u')).resolves.toBeNull();
    await expect(cabangPetugasCheckin({ petugasCheckin: { findUnique: async () => { throw new Error('db down'); } } }, 'u')).rejects.toThrow('db down');
    await expect(cabangPetugasCheckin({ petugasCheckin: { findUnique: async () => ({ branchId: 'gg' }) } }, 'u')).resolves.toBe('gg');
  });

  it('guard: petugas hanya boleh rute layar check-in; daftar booking wajib per kelas; staf lain tidak terpengaruh', () => {
    const ok = (m: string, p: string, q = {}) => expect(() => pastikanRutePetugas(petugas, m, p, q)).not.toThrow();
    const tolak = (m: string, p: string, q = {}) => expect(() => pastikanRutePetugas(petugas, m, p, q)).toThrow();
    ok('GET', '/api/v1/me');
    ok('GET', '/api/v1/attendance/desk', { branchId: 'gg' });
    ok('POST', '/api/v1/attendance/desk/scan');
    ok('GET', '/api/v1/attendance/desk/members/abc/photo');
    ok('POST', '/api/v1/check-ins/customers/backfill');
    ok('GET', '/api/v1/bookings', { classSlotId: 'slot-1' });
    tolak('GET', '/api/v1/bookings');
    tolak('GET', '/api/v1/customers');
    tolak('POST', '/api/v1/purchases/assisted');
    tolak('GET', '/api/v1/finance/owner-month');
    tolak('GET', '/api/v1/targets/pace');
    tolak('GET', '/api/v1/attendance/no-shows');
    tolak('POST', '/api/v1/attendance/desk/slot-1/continue-below-quota');
    expect(() => pastikanRutePetugas({ roles: [{ role: 'ADMIN', branchId: 'gg' }] } as never, 'GET', '/api/v1/customers')).not.toThrow();
  });
});

describe('PetugasCheckinService', () => {
  const manager = {
    sessionId: 's', userId: 'mgr', roles: [{ role: 'MANAGER', branchId: 'gg' }],
    capabilities: ['checkin-staff:manage'], branchIds: ['gg'],
  } as never;
  const setup = () => {
    jest.spyOn(tabelOpsional, 'tabelOpsionalAda').mockResolvedValue(true);
    const tx: any = {
      user: { create: jest.fn(async ({ data }) => ({ ...data })), update: jest.fn() },
      petugasCheckin: { create: jest.fn(async ({ data }) => ({ ...data, createdAt: new Date('2026-11-25T00:00:00Z') })) },
      userSession: { updateMany: jest.fn() },
    };
    const db: any = {
      cabang: { findUnique: jest.fn(async () => ({ id: 'gg', name: 'Green Garden', active: true })) },
      user: { findUnique: jest.fn(async () => null) },
      petugasCheckin: { findUnique: jest.fn(async () => ({ userId: '00000000-0000-4000-8000-000000000001', branchId: 'mk' })) },
      $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    };
    return { db, tx, service: new PetugasCheckinService(db, new PolicyService()) };
  };
  afterEach(() => jest.restoreAllMocks());

  it('Manager membuat petugas untuk cabangnya: akun ADMIN + baris penanda, username huruf kecil', async () => {
    const { tx, service } = setup();
    const hasil = await service.buat(manager, { displayName: 'Andi OB', username: 'Andi.GG', password: 'rahasia123', branchId: 'gg' });
    expect(hasil).toMatchObject({ username: 'andi.gg', branchId: 'gg', branchName: 'Green Garden' });
    expect(tx.user.create.mock.calls[0][0].data).toMatchObject({ role: 'ADMIN', preferredBranchId: 'gg', username: 'andi.gg' });
    expect(tx.user.create.mock.calls[0][0].data.passwordHash).not.toBe('rahasia123');
    expect(tx.petugasCheckin.create.mock.calls[0][0].data).toMatchObject({ branchId: 'gg', createdById: 'mgr' });
  });

  it('Manager tidak bisa membuat atau menonaktifkan petugas cabang lain; isian tidak sah ditolak', async () => {
    const { service } = setup();
    await expect(service.buat(manager, { displayName: 'Andi', username: 'andi', password: 'rahasia123', branchId: 'mk' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.ubahStatus(manager, '00000000-0000-4000-8000-000000000001', false)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(service.buat(manager, { displayName: 'Andi', username: 'a b', password: 'rahasia123', branchId: 'gg' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(service.buat(manager, { displayName: 'Andi', username: 'andi', password: 'pendek', branchId: 'gg' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('Admin cabang (tanpa checkin-staff:manage) tidak bisa membuat petugas', async () => {
    const { service } = setup();
    const admin = { ...(manager as object), roles: [{ role: 'ADMIN', branchId: 'gg' }], capabilities: ['attendance:manage'] } as never;
    await expect(service.buat(admin, { displayName: 'Andi', username: 'andi', password: 'rahasia123', branchId: 'gg' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
