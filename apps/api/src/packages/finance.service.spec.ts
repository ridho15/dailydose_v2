import { createHash } from 'node:crypto';
import { PolicyService } from '../identity/policy.service';
import { FinanceService } from './finance.service';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const branchA = id(1);
const branchB = id(2);

const principal = (
  capabilities: string[],
  role: string,
  userId: string,
  branchIds: string[] = [],
) => ({
  sessionId: 's',
  userId,
  roles: [{ role, branchId: null }] as never,
  capabilities,
  branchIds,
});

const finance = principal(
  ['finance:read', 'finance:manage', 'finance:export', 'branch:all'],
  'FINANCE',
  id(100),
);
const superOwner = principal(
  ['finance:read', 'finance:manage', 'finance:export', 'branch:all'],
  'SUPER_OWNER',
  id(101),
);

function setup() {
  const db = {
    pembelian: { findMany: jest.fn().mockResolvedValue([]) },
    otherCost: { findMany: jest.fn().mockResolvedValue([]) },
    cabang: { findUnique: jest.fn().mockResolvedValue({ code: 'DD-GG' }) },
  };
  const audit = { catat: jest.fn().mockResolvedValue(undefined) };
  const service = new FinanceService(db as never, new PolicyService(), audit as never);
  return { service, db, audit };
}

describe('FinanceService.exportReport', () => {
  const range = { from: '2026-08-01T00:00:00.000Z', until: '2026-08-31T00:00:00.000Z' };
  const purchase = (n: number, name: string, amount: number, paidAt: string) => ({
    id: id(200 + n),
    invoiceNumber: `INV-${n}`,
    totalAmountRp: amount,
    paidAt: new Date(paidAt),
    createdAt: new Date(paidAt),
    branch: { code: 'DD-GG' },
    package: { name },
  });

  it('requires finance:export and a valid, bounded range', async () => {
    const { service } = setup();
    await expect(
      service.exportReport(principal(['finance:read'], 'FINANCE', id(104)), range),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.exportReport(finance, { from: 'x', until: 'y' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(
      service.exportReport(finance, { from: range.until, until: range.from }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      service.exportReport(finance, { from: '2025-01-01', until: '2026-08-31' }),
    ).rejects.toMatchObject({ code: 'EXPORT_RANGE_TOO_LARGE' });
  });

  it('respects branch access for non-global principals', async () => {
    const { service } = setup();
    const owner = principal(['finance:read', 'finance:export'], 'OWNER', id(105), [branchA]);
    await expect(
      service.exportReport(owner, { ...range, branchId: branchB }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('builds a CSV with totals, a control hash, no personal data and neutralised formulas', async () => {
    const { service, db, audit } = setup();
    db.pembelian.findMany.mockResolvedValue([
      purchase(1, 'Paket 4 Sesi', 1_000_000, '2026-08-05T03:00:00Z'),
      purchase(2, '=HYPERLINK("http://x","a")', 500_000, '2026-08-06T03:00:00Z'),
      purchase(3, 'Paket, dengan koma', 250_000, '2026-08-07T03:00:00Z'),
    ]);
    db.otherCost.findMany.mockResolvedValue([
      {
        id: id(300),
        period: '2026-08',
        incurredOn: new Date('2026-08-12T00:00:00.000Z'),
        category: 'SEWA',
        description: 'Sewa studio',
        amountRp: 400_000,
        branch: { code: 'DD-GG' },
      },
    ]);
    const result = await service.exportReport(superOwner, { ...range, branchId: branchA });

    expect(db.pembelian.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          branchId: branchA,
          status: 'PAID',
          paidAt: { gte: new Date(range.from), lt: new Date('2026-09-01T00:00:00.000Z') },
        }),
      }),
    );
    expect(result).toMatchObject({
      fileName: 'finance-DD-GG-2026-08-01-2026-08-31.csv',
      mimeType: 'text/csv;charset=utf-8',
      completeness: 'COMPLETE',
      auditLogId: null,
    });
    const rows = result.content.replace('﻿', '').trim().split('\r\n');
    expect(rows[0]).toBe('tanggal,cabang,jenis,referensi,keterangan,jumlah_rp');
    expect(rows[1]).toBe('2026-08-05,DD-GG,PENJUALAN_PAKET,INV-1,Paket 4 Sesi,1000000');
    expect(rows[2]).toContain(`'=HYPERLINK("http://x","a")`.replace(/"/g, '""'));
    expect(rows[3]).toContain('"Paket, dengan koma"');
    expect(rows[4]).toBe('2026-08-12,DD-GG,BIAYA_LAIN,'+id(300)+',SEWA: Sewa studio,400000');
    expect(rows.slice(-3)).toEqual([
      ',,TOTAL_PENJUALAN,,Penjualan paket lunas,1750000',
      ',,TOTAL_BIAYA_LAIN,,Biaya lain menurut tanggal pengeluaran,400000',
      ',,SELISIH,,Penjualan dikurangi biaya lain,1350000',
    ]);
    expect(result.content).not.toMatch(/@|displayName|email|phone/i);
    expect(result.controlHash).toBe(createHash('sha256').update(result.content).digest('hex'));
    expect(audit.catat).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ action: 'FINANCE_EXPORT' }),
    );
  });

  it('flags an export cut at the row limit as INCOMPLETE', async () => {
    const { service, db } = setup();
    db.pembelian.findMany.mockResolvedValue(
      Array.from({ length: 50_001 }, (_, n) => purchase(n, 'P', 1000, '2026-08-05T03:00:00Z')),
    );
    const result = await service.exportReport(superOwner, range);
    expect(result.completeness).toBe('INCOMPLETE');
  });
});

describe('FinanceService.realtimeInstructorCostReport instructor attendance', () => {
  const instructor = { id: id(200), displayName: 'Coach Sarah' };
  const slot = (n: number, attended: boolean) => ({
    id: id(300 + n),
    branchId: branchA,
    classTypeId: id(400),
    startAt: new Date('2026-09-10T02:00:00.000Z'),
    endAt: new Date('2026-09-10T03:00:00.000Z'),
    instructor,
    classType: { name: 'Group Class' },
    branch: { id: branchA },
    instructorAttendance: attended ? { id: id(500 + n) } : null,
  });

  function build(slots: unknown[]) {
    const db = {
      slotKelas: { findMany: jest.fn().mockResolvedValue(slots) },
      instructorFee: {
        findMany: jest.fn().mockResolvedValue([
          {
            instructorId: instructor.id,
            branchId: branchA,
            classTypeId: id(400),
            effectiveDate: new Date('2026-01-01T00:00:00.000Z'),
            feePerJamRp: 200_000,
          },
        ]),
      },
    };
    return {
      db,
      service: new FinanceService(db as never, new PolicyService(), { catat: jest.fn() } as never),
    };
  }

  it('counts only classes with instructor attendance as cost and reports the rest separately', async () => {
    const { service } = build([slot(1, true), slot(2, false)]);
    const report = await service.realtimeInstructorCostReport(finance, {
      branchId: branchA,
      period: '2026-09',
    });
    expect(report.totalInstructorCostRp).toBe(200_000);
    expect(report.totalVerifiedFeeRp).toBe(200_000);
    expect(report.totalUnverifiedFeeRp).toBe(200_000);
    expect(report.unverifiedClassCount).toBe(1);
    expect(report.instructors[0]).toMatchObject({
      totalFeeRp: 200_000,
      verifiedFeeRp: 200_000,
      unverifiedFeeRp: 200_000,
      unverifiedClassCount: 1,
    });
  });

  it('asks the database for the attendance relation so the split is real', async () => {
    const { db, service } = build([]);
    await service.realtimeInstructorCostReport(finance, { branchId: branchA, period: '2026-09' });
    expect(db.slotKelas.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({ instructorAttendance: expect.anything() }),
      }),
    );
  });

  it('reports zero unverified when every completed class has recorded attendance', async () => {
    const { service } = build([slot(1, true), slot(2, true)]);
    const report = await service.realtimeInstructorCostReport(finance, {
      branchId: branchA,
      period: '2026-09',
    });
    expect(report.totalUnverifiedFeeRp).toBe(0);
    expect(report.unverifiedClassCount).toBe(0);
    expect(report.totalVerifiedFeeRp).toBe(report.totalInstructorCostRp);
  });
});

describe('instructor honor is computed identically by every finance report', () => {
  const coach = { id: id(200), displayName: 'Coach Sarah' };
  const mk = (n: number, attended: boolean, classTypeId = id(400)) => ({
    id: id(300 + n),
    branchId: branchA,
    classTypeId,
    startAt: new Date('2026-09-10T02:00:00.000Z'),
    endAt: new Date('2026-09-10T04:00:00.000Z'),
    instructor: coach,
    classType: { name: 'Private Class' },
    branch: { id: branchA },
    instructorAttendance: attended ? { id: id(500 + n) } : null,
  });
  const slots = [mk(1, true), mk(2, false), mk(3, true, id(401))];
  const fees = [
    {
      instructorId: coach.id,
      branchId: branchA,
      classTypeId: id(400),
      effectiveDate: new Date('2026-01-01T00:00:00.000Z'),
      feePerJamRp: 175_000,
    },
  ];
  const db = {
    slotKelas: { findMany: jest.fn().mockResolvedValue(slots) },
    instructorFee: { findMany: jest.fn().mockResolvedValue(fees) },
    cabang: {
      findUnique: jest.fn().mockResolvedValue({ id: branchA, code: 'GG', name: 'Green Garden' }),
      findFirst: jest.fn(),
    },
    pembelian: { findMany: jest.fn().mockResolvedValue([]) },
    otherCost: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = new FinanceService(db as never, new PolicyService(), { catat: jest.fn() } as never);

  it('returns the same per-instructor breakdown in the realtime and owner branch reports', async () => {
    const realtime = await service.realtimeInstructorCostReport(finance, {
      branchId: branchA,
      period: '2026-09',
    });
    const owner = await service.ownerBranchPerformance(superOwner, {
      branchId: branchA,
      period: '2026-09',
    });
    expect(owner.instructors).toEqual(realtime.instructors);
    expect(owner.totalInstructorFeeRp).toBe(realtime.totalInstructorCostRp);
    expect(owner.totalUnverifiedFeeRp).toBe(realtime.totalUnverifiedFeeRp);
    // 2 jam x 175.000 (fee cocok) x 2 kelas + 2 jam x 150.000 (fee bawaan)
    // Kelas tanpa presensi (mk 2) tidak menjadi beban; mk 3 memakai fee bawaan.
    expect(realtime.totalInstructorCostRp).toBe(350_000 + 300_000);
    expect(realtime.totalUnverifiedFeeRp).toBe(350_000);
    expect(realtime.instructors[0]?.unconfiguredFeeClassCount).toBe(1);
    expect(realtime.unconfiguredClassCount).toBe(1);
    expect(realtime.instructorFeeMissing).toBe(true);
    expect(owner.unconfiguredClassCount).toBe(1);
    expect(owner.instructorFeeMissing).toBe(true);
  });

  it('marks instructorFeeMissing as false when all classes have configured fees or no classes exist', async () => {
    // Kasus 1: Tidak ada kelas
    const emptyDb = {
      ...db,
      slotKelas: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const emptyService = new FinanceService(emptyDb as never, new PolicyService(), { catat: jest.fn() } as never);
    const emptyReport = await emptyService.ownerBranchPerformance(superOwner, {
      branchId: branchA,
      period: '2026-09',
    });
    expect(emptyReport.instructorFeeMissing).toBe(false);
    expect(emptyReport.unconfiguredClassCount).toBe(0);

    // Kasus 2: Semua kelas memiliki tarif yang cocok
    const configuredFees = [
      {
        instructorId: coach.id,
        branchId: branchA,
        classTypeId: id(400),
        effectiveDate: new Date('2026-01-01T00:00:00.000Z'),
        feePerJamRp: 175_000,
      },
      {
        instructorId: coach.id,
        branchId: branchA,
        classTypeId: id(401),
        effectiveDate: new Date('2026-01-01T00:00:00.000Z'),
        feePerJamRp: 200_000,
      },
    ];
    const fullDb = {
      ...db,
      instructorFee: { findMany: jest.fn().mockResolvedValue(configuredFees) },
    };
    const fullService = new FinanceService(fullDb as never, new PolicyService(), { catat: jest.fn() } as never);
    const fullReport = await fullService.ownerBranchPerformance(superOwner, {
      branchId: branchA,
      period: '2026-09',
    });
    expect(fullReport.instructorFeeMissing).toBe(false);
    expect(fullReport.unconfiguredClassCount).toBe(0);
  });
});

describe('finance reports take a free date range (from/until)', () => {
  const owner = principal(['finance:read', 'finance:manage'], 'OWNER', id(110), [branchA]);

  function reportSetup() {
    const { service, db } = setup();
    db.pembelian.findMany.mockResolvedValue([
      {
        id: id(400),
        invoiceNumber: 'INV-1',
        totalAmountRp: 1_000_000,
        paymentMethod: 'TRANSFER',
        paidAt: new Date('2026-10-12T03:00:00Z'),
        createdAt: new Date('2026-10-12T03:00:00Z'),
        branch: { id: branchA, code: 'GG', name: 'Green Garden' },
        user: { id: id(5), displayName: 'Maya', email: 'm@x.test' },
        package: { id: id(6), name: 'Paket', sessionCount: 4 },
      },
    ]);
    (db as Record<string, unknown>).slotKelas = { findMany: jest.fn().mockResolvedValue([]) };
    (db as Record<string, unknown>).instructorFee = { findMany: jest.fn().mockResolvedValue([]) };
    db.otherCost.findMany.mockResolvedValue([
      {
        id: id(401),
        branchId: branchA,
        period: '2026-10',
        incurredOn: new Date('2026-10-15T00:00:00Z'),
        category: 'LISTRIK',
        description: 'Listrik',
        amountRp: 300_000,
        createdAt: new Date('2026-10-15T08:00:00Z'),
        branch: { id: branchA, code: 'GG', name: 'Green Garden' },
        createdBy: { id: id(1), displayName: 'Admin' },
      },
      {
        id: id(402),
        branchId: branchA,
        period: '2026-10',
        incurredOn: null,
        category: 'SEWA',
        description: 'Sewa (catatan lama tanpa tanggal)',
        amountRp: 200_000,
        createdAt: new Date('2026-10-01T08:00:00Z'),
        branch: { id: branchA, code: 'GG', name: 'Green Garden' },
        createdBy: null,
      },
    ]);
    return { service, db };
  }

  it('queries sales by paid date inside [from, until] inclusive', async () => {
    const { service, db } = reportSetup();
    const result = await service.omsetReport(owner, { branchId: branchA, from: '2026-10-10', until: '2026-10-20' });
    expect(db.pembelian.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'PAID',
          paidAt: { gte: new Date('2026-10-10T00:00:00.000Z'), lt: new Date('2026-10-21T00:00:00.000Z') },
        }),
      }),
    );
    expect(result).toMatchObject({ from: '2026-10-10', until: '2026-10-20', period: '2026-10-10/2026-10-20', totalOmsetRp: 1_000_000 });
  });

  it('a whole month keeps the short label, and the old period shortcut still means that month', async () => {
    const { service } = reportSetup();
    expect(await service.omsetReport(owner, { branchId: branchA, period: '2026-10' })).toMatchObject({
      from: '2026-10-01',
      until: '2026-10-31',
      period: '2026-10',
    });
    expect(
      await service.omsetReport(owner, { branchId: branchA, from: '2026-02-01', until: '2026-02-28' }),
    ).toMatchObject({ period: '2026-02' });
  });

  it('refuses an inverted, malformed, half-given or oversized range', async () => {
    const { service } = reportSetup();
    for (const bad of [
      { from: '2026-10-20', until: '2026-10-10' },
      { from: '20-10-2026', until: '2026-10-31' },
      { from: '2026-02-30', until: '2026-03-05' },
      { from: '2026-10-01' },
      { until: '2026-10-01' },
      { from: '2024-01-01', until: '2026-12-31' },
    ])
      await expect(service.omsetReport(owner, { branchId: branchA, ...bad })).rejects.toMatchObject({
        status: 422,
      });
  });

  it('sums other costs by their own date, and counts an old undated cost on the 1st of its month', async () => {
    const { service, db } = reportSetup();
    const report = await service.otherCostReport(owner, { branchId: branchA, from: '2026-10-10', until: '2026-10-20' });
    const where = (db.otherCost.findMany.mock.calls[0]![0] as { where: { OR: unknown[] } }).where;
    expect(where.OR[0]).toEqual({
      incurredOn: { gte: new Date('2026-10-10T00:00:00.000Z'), lt: new Date('2026-10-21T00:00:00.000Z') },
    });
    // 1 Okt tidak jatuh di 10–20 Okt, jadi biaya lama tanpa tanggal tidak ikut dicari lewat bulan.
    expect(where.OR).toHaveLength(1);
    expect(report.items.map((item) => item.incurredOn)).toEqual(['2026-10-15', '2026-10-01']);

    await service.otherCostReport(owner, { branchId: branchA, from: '2026-09-25', until: '2026-10-05' });
    const wide = (db.otherCost.findMany.mock.calls[1]![0] as { where: { OR: unknown[] } }).where;
    expect(wide.OR[1]).toEqual({ incurredOn: null, period: { in: ['2026-10'] } });
  });

  it('profit = sales - instructor honor - other costs, with margins, for the chosen range', async () => {
    const { service } = reportSetup();
    const profit = await service.profitReport(owner, { branchId: branchA, from: '2026-10-01', until: '2026-10-31' });
    expect(profit).toMatchObject({
      period: '2026-10',
      omsetRp: 1_000_000,
      costRealtimeRp: 0,
      grossProfitRp: 1_000_000,
      otherCostRp: 500_000,
      netProfitRealtimeRp: 500_000,
      grossMarginPercent: 100,
      netMarginPercent: 50,
    });
    expect(profit).not.toHaveProperty('isLocked');
    expect(profit).not.toHaveProperty('totalCorrectionAdjustmentRp');
  });

  it('keeps the branch scope: an owner cannot read another branch', async () => {
    const { service } = reportSetup();
    await expect(
      service.profitReport(owner, { branchId: branchB, from: '2026-10-01', until: '2026-10-31' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('FinanceService.createOtherCost validation', () => {
  const input = {
    branchId: branchA,
    incurredOn: '2026-10-20',
    amountRp: 150_000,
    description: 'Handuk studio',
  };
  const build = (branchExists = true) => {
    const { service, db, audit } = setup();
    const create = jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: id(900), ...data }));
    (db as unknown as { otherCost: unknown }).otherCost = { create };
    (db.cabang.findUnique as jest.Mock).mockResolvedValue(branchExists ? { id: branchA } : null);
    return { service, create, audit };
  };

  it('stores a trimmed description and an upper-case category', async () => {
    const { service, create } = build();
    await service.createOtherCost(finance, { ...input, description: '  Handuk studio  ', categoryCode: 'laundry' });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ description: 'Handuk studio', category: 'LAUNDRY' }),
    });
  });

  it.each(['', '   ', 'x'.repeat(2001)])('rejects a description of %j', async (description) => {
    const { service, create } = build();
    await expect(service.createOtherCost(finance, { ...input, description })).rejects.toMatchObject({
      status: 422,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a malformed category', async () => {
    const { service, create } = build();
    await expect(
      service.createOtherCost(finance, { ...input, categoryCode: 'bad category!' }),
    ).rejects.toMatchObject({ status: 422 });
    expect(create).not.toHaveBeenCalled();
  });

  it('answers 404 for a branch that does not exist instead of a database error', async () => {
    const { service, create } = build(false);
    await expect(service.createOtherCost(superOwner, input)).rejects.toMatchObject({ status: 404 });
    expect(create).not.toHaveBeenCalled();
  });
});
