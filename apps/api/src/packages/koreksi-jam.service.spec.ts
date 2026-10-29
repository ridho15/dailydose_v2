import { PolicyService } from '../identity/policy.service';
import {
  AKSI_KOREKSI_JAM,
  KoreksiJamService,
  koreksiHonorDalamRentang,
} from './koreksi-jam.service';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1]);
const ALASAN = 'QR instruktur tidak terpindai, kelas berjalan penuh 55 menit.';

const manager = {
  sessionId: 's',
  userId: 'u-mgr',
  roles: [{ role: 'MANAGER', branchId: 'gg' }],
  capabilities: ['instructor:hours:adjust'],
  branchIds: ['gg'],
} as never;

function setup() {
  const db = {
    slotKelas: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'slot-1',
        branchId: 'gg',
        classTypeId: 'ct-g',
        instructorId: 'i-a',
        startAt: new Date('2026-10-20T02:00:00Z'),
        endAt: new Date('2026-10-20T02:55:00Z'),
        instructorFeeRp: null,
        isManualFee: false,
        classType: { name: 'Group' },
      }),
      findMany: jest.fn().mockResolvedValue([{ id: 'slot-1', classType: { name: 'Group' } }]),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: 'i-a', displayName: 'Asrida' }),
      findMany: jest.fn().mockResolvedValue([
        { id: 'i-a', displayName: 'Asrida' },
        { id: 'u-mgr', displayName: 'Budi Manager' },
      ]),
    },
    instructorFee: {
      findMany: jest.fn().mockResolvedValue([
        {
          instructorId: 'i-a',
          branchId: 'gg',
          classTypeId: 'ct-g',
          effectiveDate: new Date('2026-01-01'),
          feePerJamRp: 200_000,
        },
      ]),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  };
  const storage = {
    put: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    exists: jest.fn().mockResolvedValue(true),
    read: jest.fn(),
  };
  return {
    db,
    storage,
    service: new KoreksiJamService(db as never, new PolicyService(), storage as never),
  };
}

describe('KoreksiJamService.koreksi', () => {
  it('menilai koreksi dengan tarif kelas itu dan mencatatnya bersama bukti', async () => {
    const { service, db, storage } = setup();
    const hasil = await service.koreksi(
      manager,
      { classSlotId: 'slot-1', hours: '1', reason: ALASAN },
      { buffer: PNG },
    );

    // Manager mencatat jam tanpa melihat rupiah; nominal tetap tersimpan di audit untuk payroll.
    expect(hasil).toMatchObject({ hours: 1, feePerJamRp: null, amountRp: null });
    expect(storage.put).toHaveBeenCalledWith(
      expect.objectContaining({ key: `instructor-hours-evidence/${hasil.id}.png` }),
    );
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: AKSI_KOREKSI_JAM,
        branchId: 'gg',
        targetUserId: 'i-a',
        objectId: hasil.id,
        reason: ALASAN,
        detail: {
          after: expect.objectContaining({
            classStartAt: '2026-10-20T02:00:00.000Z',
            amountRp: 200_000,
          }),
        },
      }),
    });
  });

  it('menerima pengurangan setengah jam dan menolak jam yang bukan kelipatan setengah', async () => {
    const { service } = setup();
    const superOwner = {
      ...(manager as object),
      capabilities: ['instructor:hours:adjust', 'instructor:fee:read', 'branch:all'],
    } as never;
    const kurang = await service.koreksi(
      superOwner,
      { classSlotId: 'slot-1', hours: -0.5, reason: ALASAN },
      { buffer: PNG },
    );
    expect(kurang.amountRp).toBe(-100_000);

    await expect(
      service.koreksi(
        manager,
        { classSlotId: 'slot-1', hours: 0.3, reason: ALASAN },
        { buffer: PNG },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      service.koreksi(
        manager,
        { classSlotId: 'slot-1', hours: 0, reason: ALASAN },
        { buffer: PNG },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('mewajibkan bukti dan alasan yang cukup panjang', async () => {
    const { service, storage } = setup();
    await expect(
      service.koreksi(manager, { classSlotId: 'slot-1', hours: 1, reason: ALASAN }, undefined),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      service.koreksi(
        manager,
        { classSlotId: 'slot-1', hours: 1, reason: 'lupa' },
        { buffer: PNG },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('menghapus bukti bila catatan koreksi gagal ditulis', async () => {
    const { service, db, storage } = setup();
    db.auditLog.create.mockRejectedValue(new Error('db'));
    await expect(
      service.koreksi(
        manager,
        { classSlotId: 'slot-1', hours: 1, reason: ALASAN },
        { buffer: PNG },
      ),
    ).rejects.toThrow('db');
    expect(storage.delete).toHaveBeenCalled();
  });

  it('menolak kelas di cabang lain dan peran tanpa izin', async () => {
    const { service, db } = setup();
    db.slotKelas.findUnique.mockResolvedValue({
      ...(await db.slotKelas.findUnique()),
      branchId: 'mk',
    });
    await expect(
      service.koreksi(
        manager,
        { classSlotId: 'slot-1', hours: 1, reason: ALASAN },
        { buffer: PNG },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const admin = { ...(manager as object), capabilities: ['attendance:manage'] } as never;
    await expect(
      service.koreksi(admin, { classSlotId: 'slot-1', hours: 1, reason: ALASAN }, { buffer: PNG }),
    ).rejects.toBeDefined();
  });
});

describe('koreksiHonorDalamRentang', () => {
  it('menghitung koreksi pada bulan kelasnya, bukan bulan dicatat', async () => {
    const baris = (branchId: string, classStartAt: string, amountRp: number) => ({
      objectId: 'x',
      branchId,
      actorId: null,
      reason: null,
      detail: { after: { classStartAt, amountRp } },
      createdAt: new Date('2026-11-02T00:00:00Z'),
    });
    const db = {
      auditLog: {
        findMany: jest.fn().mockResolvedValue([
          baris('gg', '2026-10-20T02:00:00Z', 200_000),
          baris('gg', '2026-10-25T02:00:00Z', -100_000),
          baris('mk', '2026-10-10T02:00:00Z', 150_000),
          // Kelas November tidak masuk Oktober walau dicatat bersamaan.
          baris('gg', '2026-11-01T02:00:00Z', 999_000),
        ]),
      },
    };
    const hasil = await koreksiHonorDalamRentang(db as never, {
      branchFilter: {},
      fromDate: new Date('2026-10-01T00:00:00Z'),
      untilExclusive: new Date('2026-11-01T00:00:00Z'),
    });
    expect(hasil.totalRp).toBe(250_000);
    expect(hasil.perCabang.get('gg')).toBe(100_000);
    expect(hasil.perCabang.get('mk')).toBe(150_000);
    expect(hasil.jumlah).toBe(3);
  });
});
