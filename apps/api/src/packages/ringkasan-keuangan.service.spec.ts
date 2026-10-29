import { PolicyService } from '../identity/policy.service';
import { RingkasanKeuanganService } from './ringkasan-keuangan.service';

const NOW = new Date('2026-10-28T03:00:00Z');
const superOwner = {
  sessionId: 's',
  userId: 'u-so',
  roles: [{ role: 'SUPER_OWNER', branchId: null }],
  capabilities: ['finance:read', 'branch:all'],
  branchIds: [],
} as never;
const admin = {
  sessionId: 's',
  userId: 'u-admin',
  roles: [{ role: 'ADMIN', branchId: 'gg' }],
  capabilities: ['expense:create'],
  branchIds: ['gg'],
} as never;

const slot = (branchId: string) => ({
  branchId,
  classTypeId: 'ct',
  startAt: new Date('2026-10-20T02:00:00Z'),
  endAt: new Date('2026-10-20T03:00:00Z'),
  instructor: { id: 'i-a', displayName: 'Asrida' },
  classType: { name: 'Group' },
  instructorAttendance: { id: 'att' },
  instructorFeeRp: null,
  isManualFee: false,
});

function setup() {
  const db = {
    pembayarPengeluaran: { findMany: jest.fn(async () => []) },
    cabang: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'gg', name: 'Green Garden', monthlyTargetRp: 100_000_000 },
        { id: 'mk', name: 'Muara Karang', monthlyTargetRp: null },
      ]),
    },
    pembelian: {
      findMany: jest.fn(async (args: { select?: { invoiceNumber?: boolean } }) =>
        args.select?.invoiceNumber
          ? [
              {
                id: 'p1',
                branchId: 'gg',
                invoiceNumber: 'INV-1',
                totalAmountRp: 1_850_000,
                paymentMethod: 'BANK_TRANSFER',
                paidAt: new Date('2026-10-21T02:00:00Z'),
                user: { displayName: 'Lia' },
                package: { name: 'Group 10 sesi' },
                verifiedBy: { displayName: 'Rina' },
              },
            ]
          : [
              {
                branchId: 'gg',
                totalAmountRp: 1_850_000,
                paidAt: new Date('2026-10-21T02:00:00Z'),
                package: { sessionCount: 10, classTypeId: 'grp' },
              },
              {
                branchId: 'gg',
                totalAmountRp: 1_000_000,
                paidAt: new Date('2026-10-22T02:00:00Z'),
                package: { sessionCount: 5, classTypeId: 'pvt' },
              },
              {
                branchId: 'mk',
                totalAmountRp: 500_000,
                paidAt: new Date('2026-10-22T02:00:00Z'),
                package: { sessionCount: 4, classTypeId: 'grp' },
              },
            ],
      ),
    },
    // Modal per sesi: Group GG Rp50.000; tipe lain di GG Rp80.000; Muara Karang belum diatur.
    modalSesi: {
      findMany: jest.fn(async () => [
        {
          id: 'm1',
          branchId: 'gg',
          classTypeId: 'grp',
          modalPerSesiRp: 50_000,
          effectiveDate: new Date('2026-01-01'),
          createdAt: new Date('2026-01-01'),
        },
        {
          id: 'm2',
          branchId: 'gg',
          classTypeId: null,
          modalPerSesiRp: 80_000,
          effectiveDate: new Date('2026-01-01'),
          createdAt: new Date('2026-01-01'),
        },
      ]),
    },
    otherCost: {
      findMany: jest.fn(async (args: { select?: { description?: boolean } }) =>
        args.select?.description
          ? [
              {
                id: 'c1',
                branchId: 'gg',
                incurredOn: new Date('2026-10-22T00:00:00Z'),
                period: '2026-10',
                category: 'SUPPLIES',
                description: 'Beli handuk 10 pcs',
                amountRp: 450_000,
                createdAt: new Date('2026-10-22T05:00:00Z'),
                createdBy: { displayName: 'Rina' },
              },
            ]
          : [
              { branchId: 'gg', category: 'SUPPLIES', amountRp: 450_000 },
              { branchId: 'gg', category: 'RENT', amountRp: 5_000_000 },
              { branchId: 'mk', category: 'SUPPLIES', amountRp: 100_000 },
            ],
      ),
    },
    slotKelas: { findMany: jest.fn().mockResolvedValue([slot('gg'), slot('gg'), slot('mk')]) },
    instructorFee: {
      findMany: jest.fn().mockResolvedValue([
        {
          instructorId: 'i-a',
          branchId: 'gg',
          classTypeId: 'ct',
          effectiveDate: new Date('2026-01-01'),
          feePerJamRp: 200_000,
        },
      ]),
    },
    auditLog: {
      findMany: jest.fn().mockResolvedValue([
        {
          objectId: 'k1',
          branchId: 'gg',
          actorId: null,
          reason: null,
          detail: { after: { classStartAt: '2026-10-20T02:00:00Z', amountRp: 100_000 } },
          createdAt: new Date('2026-10-21T00:00:00Z'),
        },
      ]),
    },
  };
  return { db, service: new RingkasanKeuanganService(db as never, new PolicyService()) };
}

describe('RingkasanKeuanganService.ringkasanBulanan', () => {
  it('laba = omzet − modal sesi − pengeluaran; payroll ditampilkan terpisah', async () => {
    const { service } = setup();
    const hasil = await service.ringkasanBulanan(superOwner, { period: '2026-10' }, NOW);

    const gg = hasil.cabang.find((c) => c.branchId === 'gg')!;
    expect(gg).toMatchObject({
      omsetRp: 2_850_000,
      payrollRp: 500_000, // 2 kelas × 1 jam × 200.000 + koreksi 100.000
      koreksiPayrollRp: 100_000,
      pengeluaranRp: 5_450_000,
      // 10 sesi Group x 50.000 + 5 sesi Private x 80.000 (tarif semua tipe kelas GG).
      modalSesiRp: 500_000 + 400_000,
      sesiTerjual: 15,
      sesiTanpaModal: 0,
      profitRp: 2_850_000 - 900_000 - 5_450_000,
      targetRp: 100_000_000,
    });
    expect(gg.pengeluaranPerKategori[0]).toEqual({ category: 'RENT', amountRp: 5_000_000 });

    // Muara Karang belum punya tarif: memakai tarif bawaan dan dilaporkan.
    const mk = hasil.cabang.find((c) => c.branchId === 'mk')!;
    expect(mk.targetRp).toBeNull();
    // Muara Karang belum punya modal sesi: dihitung Rp0 dan dilaporkan.
    expect(mk).toMatchObject({ modalSesiRp: 0, sesiTanpaModal: 4, profitRp: 500_000 - mk.pengeluaranRp });
    expect(hasil.tarifBelumDipasang).toBe(1);

    expect(hasil.total.omsetRp).toBe(3_350_000);
    expect(hasil.total.profitRp).toBe(gg.profitRp + mk.profitRp);
    expect(hasil.total.targetRp).toBe(100_000_000);
  });

  it('hanya untuk peran yang boleh membaca keuangan', async () => {
    const { service } = setup();
    await expect(service.ringkasanBulanan(admin, {}, NOW)).rejects.toBeDefined();
  });
});

describe('RingkasanKeuanganService.jurnalKas', () => {
  it('menggabungkan uang masuk dan keluar satu cabang untuk admin pencatat pengeluaran', async () => {
    const { service, db } = setup();
    const hasil = await service.jurnalKas(admin, { branchId: 'gg', period: '2026-10' }, NOW);

    expect(hasil).toMatchObject({ masukRp: 1_850_000, keluarRp: 450_000, selisihRp: 1_400_000 });
    expect(hasil.rows.map((r) => [r.tanggal, r.arah])).toEqual([
      ['2026-10-22', 'KELUAR'],
      ['2026-10-21', 'MASUK'],
    ]);
    expect(hasil.rows[1]!.keterangan).toBe('Group 10 sesi · Lia (INV-1)');
    expect(db.otherCost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ branchId: 'gg' }) }),
    );
  });

  it('menolak cabang lain dan mewajibkan cabang untuk staf cabang', async () => {
    const { service } = setup();
    await expect(service.jurnalKas(admin, { branchId: 'mk' }, NOW)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(service.jurnalKas(admin, {}, NOW)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});
