import { PolicyService } from '../identity/policy.service';
import { hitungModalSesi, ModalSesiService, tarifUntuk } from './modal-sesi.service';

const tarif = (
  id: string,
  branchId: string,
  classTypeId: string | null,
  modalPerSesiRp: number,
  mulai: string,
) => ({
  id,
  branchId,
  classTypeId,
  modalPerSesiRp,
  effectiveDate: new Date(`${mulai}T00:00:00Z`),
  createdAt: new Date(`${mulai}T00:00:00Z`),
});

const superOwner = {
  sessionId: 's',
  userId: 'so',
  roles: [{ role: 'SUPER_OWNER', branchId: null }],
  capabilities: ['master:read', 'master:manage', 'branch:all'],
  branchIds: [],
} as never;
const admin = {
  sessionId: 's',
  userId: 'adm',
  roles: [{ role: 'ADMIN', branchId: 'untar' }],
  capabilities: ['class-slot:manage'],
  branchIds: ['untar'],
} as never;

describe('tarifUntuk', () => {
  const daftar = [
    tarif('a', 'untar', 'grp', 45_000, '2026-01-01'),
    tarif('b', 'untar', 'grp', 50_000, '2026-10-01'),
    tarif('c', 'untar', null, 70_000, '2026-01-01'),
  ];
  it('memakai versi terbaru yang sudah berlaku pada tanggal lunas', () => {
    expect(
      tarifUntuk(daftar, { branchId: 'untar', classTypeId: 'grp', pada: new Date('2026-09-15') })
        ?.modalPerSesiRp,
    ).toBe(45_000);
    expect(
      tarifUntuk(daftar, { branchId: 'untar', classTypeId: 'grp', pada: new Date('2026-10-20') })
        ?.modalPerSesiRp,
    ).toBe(50_000);
  });
  it('membandingkan tanggal WIB: kelas 06:00 WIB pada tanggal berlaku sudah memakai tarif baru', () => {
    // 06:00 WIB 1 Oktober = 23:00 UTC 30 September.
    expect(
      tarifUntuk(daftar, {
        branchId: 'untar',
        classTypeId: 'grp',
        pada: new Date('2026-09-30T23:00:00Z'),
      })?.modalPerSesiRp,
    ).toBe(50_000);
  });
  it('tipe kelas tanpa tarif khusus memakai tarif semua tipe kelas cabang itu', () => {
    expect(
      tarifUntuk(daftar, { branchId: 'untar', classTypeId: 'pvt', pada: new Date('2026-10-20') })
        ?.modalPerSesiRp,
    ).toBe(70_000);
    expect(
      tarifUntuk(daftar, { branchId: 'pik', classTypeId: 'grp', pada: new Date('2026-10-20') }),
    ).toBeNull();
  });
});

describe('hitungModalSesi (mengikuti pemakaian sesi)', () => {
  const sesi = (branchId: string, classTypeId: string, tanggal: string) => ({
    classSlot: { branchId, classTypeId, startAt: new Date(`${tanggal}T02:00:00Z`) },
  });
  const rentang = {
    branchIds: null,
    fromDate: new Date('2026-10-01T00:00:00Z'),
    untilExclusive: new Date('2026-11-01T00:00:00Z'),
  };

  it('contoh pemilik: 20 sesi Group Untar terpakai x Rp50.000 = Rp1 juta', async () => {
    const db = {
      pemesananKelas: {
        findMany: jest.fn(async () =>
          Array.from({ length: 20 }, () => sesi('untar', 'grp', '2026-10-10')),
        ),
      },
      modalSesi: {
        findMany: jest.fn(async () => [tarif('b', 'untar', 'grp', 50_000, '2026-01-01')]),
      },
    };
    const hasil = await hitungModalSesi(db as never, rentang);
    expect(hasil.totalRp).toBe(1_000_000);
    expect(4_000_000 - hasil.totalRp).toBe(3_000_000);
    expect(hasil.sesi).toBe(20);
    expect(hasil.perHari.get('2026-10-10')).toBe(1_000_000);
  });

  it('hanya sesi hadir/tidak hadir di kelas selesai dalam rentang yang dihitung', async () => {
    const db = {
      pemesananKelas: { findMany: jest.fn(async () => []) },
      modalSesi: { findMany: jest.fn(async () => []) },
    };
    await hitungModalSesi(db as never, { ...rentang, branchIds: ['untar'] });
    expect(db.pemesananKelas.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: { in: ['ATTENDED', 'NO_SHOW'] },
          classSlot: {
            status: 'COMPLETED',
            startAt: { gte: rentang.fromDate, lt: rentang.untilExclusive },
            branchId: { in: ['untar'] },
          },
        },
      }),
    );
  });

  it('memakai tarif yang berlaku pada tanggal kelas; sesi tanpa tarif dihitung Rp0', async () => {
    const db = {
      pemesananKelas: {
        findMany: jest.fn(async () => [
          sesi('untar', 'grp', '2026-10-05'),
          sesi('untar', 'grp', '2026-10-20'),
          sesi('pik', 'grp', '2026-10-20'),
        ]),
      },
      modalSesi: {
        findMany: jest.fn(async () => [
          tarif('a', 'untar', 'grp', 45_000, '2026-01-01'),
          tarif('b', 'untar', 'grp', 50_000, '2026-10-15'),
        ]),
      },
    };
    const hasil = await hitungModalSesi(db as never, rentang);
    expect(hasil.totalRp).toBe(95_000);
    expect(hasil).toMatchObject({ sesi: 3, sesiTanpaModal: 1 });
    expect(hasil.sesiTanpaModalPerCabang.get('pik')).toBe(1);
    expect(hasil.sesiPerCabang.get('untar')).toBe(2);
  });
});

describe('ModalSesiService', () => {
  const setup = () => {
    const db = {
      modalSesi: {
        findMany: jest.fn(async () => []),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'baru',
          createdAt: new Date('2026-10-29T00:00:00Z'),
          ...data,
        })),
      },
      cabang: { findUnique: jest.fn(async () => ({ id: 'untar' })) },
      jenisKelas: { findUnique: jest.fn(async () => ({ id: 'grp' })) },
      auditLog: { create: jest.fn() },
      $transaction: jest.fn(async (fn: (t: unknown) => unknown): Promise<unknown> => fn(db)),
    };
    return { db, service: new ModalSesiService(db as never, new PolicyService()) };
  };

  it('Super Owner menyimpan modal per sesi dan tercatat di audit', async () => {
    const { service, db } = setup();
    const hasil = await service.simpan(superOwner, {
      branchId: 'untar',
      classTypeId: 'grp',
      modalPerSesiRp: 50_000,
      effectiveDate: '2026-10-01',
    });
    expect(hasil).toMatchObject({
      branchId: 'untar',
      classTypeId: 'grp',
      modalPerSesiRp: 50_000,
      effectiveDate: '2026-10-01',
    });
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'finance.session_cost_created' }),
      }),
    );
  });

  it('admin tidak bisa membaca atau mengubah modal', async () => {
    const { service } = setup();
    await expect(service.daftar(admin)).rejects.toBeDefined();
    await expect(
      service.simpan(admin, {
        branchId: 'untar',
        classTypeId: 'grp',
        modalPerSesiRp: 1,
        effectiveDate: '2026-10-01',
      }),
    ).rejects.toBeDefined();
  });

  it('menolak nominal yang tidak valid', async () => {
    const { service } = setup();
    await expect(
      service.simpan(superOwner, {
        branchId: 'untar',
        modalPerSesiRp: -5,
        effectiveDate: '2026-10-01',
      }),
    ).rejects.toMatchObject({ details: [{ field: 'modalPerSesiRp', issue: 'INVALID_AMOUNT' }] });
  });
});
