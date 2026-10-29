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

describe('hitungModalSesi', () => {
  it('contoh pemilik: paket Group 20 sesi Rp4 juta di Untar, modal Rp50.000 → modal Rp1 juta', async () => {
    const db = {
      modalSesi: {
        findMany: jest.fn(async () => [tarif('b', 'untar', 'grp', 50_000, '2026-01-01')]),
      },
    };
    const hasil = await hitungModalSesi(db as never, [
      {
        branchId: 'untar',
        paidAt: new Date('2026-10-20'),
        package: { sessionCount: 20, classTypeId: 'grp' },
      },
    ]);
    expect(hasil.totalRp).toBe(1_000_000);
    expect(4_000_000 - hasil.totalRp).toBe(3_000_000);
    expect(hasil.sesi).toBe(20);
    expect(hasil.perPembelian).toEqual([1_000_000]);
  });

  it('sesi tanpa tarif dihitung Rp0 dan dilaporkan per cabang', async () => {
    const db = { modalSesi: { findMany: jest.fn(async () => []) } };
    const hasil = await hitungModalSesi(db as never, [
      {
        branchId: 'pik',
        paidAt: new Date('2026-10-20'),
        package: { sessionCount: 8, classTypeId: 'grp' },
      },
    ]);
    expect(hasil).toMatchObject({ totalRp: 0, sesi: 8, sesiTanpaModal: 8 });
    expect(hasil.sesiTanpaModalPerCabang.get('pik')).toBe(8);
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
