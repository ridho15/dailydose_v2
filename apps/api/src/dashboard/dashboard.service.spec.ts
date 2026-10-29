import { DashboardService } from './dashboard.service';

const principal = (overrides: Record<string, unknown> = {}) =>
  ({
    userId: 'user-1',
    roles: [{ role: 'ADMIN', branchId: 'branch-1' }],
    branchIds: ['branch-1'],
    capabilities: ['purchase:review', 'reschedule:read'],
    ...overrides,
  }) as never;

function database() {
  const aggregate = jest.fn().mockResolvedValue({ _sum: { priceRpSnapshot: 0 } });
  const count = jest.fn().mockResolvedValue(0);
  const findMany = jest.fn().mockResolvedValue([]);
  return {
    pembelian: { aggregate, count, findMany },
    pemesananKelas: { count, findMany },
    paketPelanggan: { findMany },
    slotKelas: { findMany },
    otherCost: { findMany },
    instructorFee: { findMany },
    dokumenVerifikasiIdentitas: { count },
    ubahJadwal: { count },
    sessionAdjustRequest: { count: jest.fn().mockResolvedValue(0) },
    penyesuaianSesi: { count },
    quotaEvaluationJob: { count, findMany },
    cabang: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: 'branch-1', code: 'JKT', name: 'Jakarta', timezone: 'Asia/Jakarta' },
        ]),
    },
    user: { count, findMany },
    auditLog: { findMany },
    profilPengguna: { findUnique: jest.fn().mockResolvedValue(null) },
  };
}

describe('DashboardService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calculates dynamic customer verification status in customerOverview', async () => {
    const db = database();
    const service = new DashboardService(db as never);

    // 1. Tanpa dokumen -> ACTION_REQUIRED
    db.profilPengguna.findUnique.mockResolvedValueOnce(null);
    const resNoDocs = await service.customerOverview(principal({ roles: [{ role: 'CUSTOMER', branchId: null }] }));
    expect(resNoDocs.verification.status).toBe('ACTION_REQUIRED');

    // 2. Ada dokumen KTP/selfie tapi belum approved -> PENDING
    db.profilPengguna.findUnique.mockResolvedValueOnce({
      userId: 'user-1',
      ktpUrl: 'https://storage/ktp.jpg',
      notes: null,
    });
    const resPending = await service.customerOverview(principal({ roles: [{ role: 'CUSTOMER', branchId: null }] }));
    expect(resPending.verification.status).toBe('PENDING');

    // 3. KYC_APPROVED -> APPROVED
    db.profilPengguna.findUnique.mockResolvedValueOnce({
      userId: 'user-1',
      ktpUrl: 'https://storage/ktp.jpg',
      notes: 'VERIFIED_OK KYC_APPROVED',
    });
    const resApproved = await service.customerOverview(principal({ roles: [{ role: 'CUSTOMER', branchId: null }] }));
    expect(resApproved.verification.status).toBe('APPROVED');
  });

  it('rejects customer-only sessions', async () => {
    const service = new DashboardService(database() as never);
    await expect(
      service.overview(
        principal({
          roles: [{ role: 'CUSTOMER', branchId: null }],
          capabilities: [],
          branchIds: [],
        }),
        {},
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('rejects instructor/coach-only sessions', async () => {
    const service = new DashboardService(database() as never);
    await expect(
      service.overview(
        principal({
          roles: [{ role: 'INSTRUCTOR', branchId: 'branch-1' }],
          capabilities: ['class:assigned:read', 'attendance:self', 'class-slot:read'],
        }),
        {},
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('rejects a branch outside the principal scope', async () => {
    const service = new DashboardService(database() as never);
    await expect(service.overview(principal(), { branchId: 'branch-2' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
  });

  it('aggregates an empty branch dataset and only exposes permitted queues', async () => {
    const db = database();
    const result = await new DashboardService(db as never).overview(
      principal(),
      {
        branchId: 'branch-1',
        from: '2026-07-01',
        until: '2026-07-07',
      },
    );

    expect(result.views).toEqual({ finance: false, operations: true });
    expect(result.metrics.every((metric) => metric.value === 0)).toBe(true);
    expect(result.queues.map((queue) => queue.key)).toEqual(['payments', 'reschedules']);
    expect(db.cabang.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true, id: 'branch-1' } }),
    );
  });

  it('exposes the pending session adjustment queue only to actors who can read adjustments', async () => {
    const db = database();
    db.sessionAdjustRequest.count.mockResolvedValue(3);
    const result = await new DashboardService(db as never).overview(
      principal({
        capabilities: ['purchase:review', 'reschedule:read', 'ledger:adjust:read'],
      }),
      { branchId: 'branch-1', from: '2026-07-01', until: '2026-07-07' },
    );
    expect(result.queues.find((queue) => queue.key === 'adjustments')).toEqual({
      key: 'adjustments',
      label: 'Penyesuaian sesi menunggu',
      count: 3,
      href: '/ledger/adjustments?status=PENDING',
    });
    expect(db.sessionAdjustRequest.count).toHaveBeenCalledWith({
      where: {
        status: 'PENDING',
        customerPackage: { purchase: { branchId: { in: ['branch-1'] } } },
      },
    });
  });

  it('keeps an omitted branch filter inside the actor branch assignments', async () => {
    const db = database();
    await new DashboardService(db as never).overview(principal(), {
      from: '2026-07-01',
      until: '2026-07-07',
    });

    expect(db.cabang.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true, id: { in: ['branch-1'] } } }),
    );
  });

  it.each([
    [['SUPER_OWNER'], { finance: true, operations: true }, true],
    [['OWNER'], { finance: true, operations: true }, false],
    [['FINANCE'], { finance: true, operations: false }, true],
    [['ADMIN'], { finance: false, operations: true }, false],
    [['MANAGER'], { finance: false, operations: true }, false],
    [['FINANCE', 'ADMIN'], { finance: true, operations: true }, true],
  ] as const)('shows the finance and operations summaries by role %j', async (roles, views, paymentFlow) => {
    const result = await new DashboardService(database() as never).overview(
      principal({
        roles: roles.map((role) => ({ role, branchId: null })) as never,
        capabilities: ['branch:all', 'finance:read', 'operations:read'],
        branchIds: [],
      }),
      {},
    );
    expect(result.views).toEqual(views);
    const keys = result.metrics.map((metric) => metric.key);
    expect(keys.includes('profit')).toBe(views.finance);
    expect(keys.includes('occupancy')).toBe(views.operations);
    expect(keys.includes('pending-payments')).toBe(views.finance && paymentFlow);
    expect(keys).not.toContain('correction');
    expect(result.sections.branchComparison).toBe(views.finance);
    expect(result.sections.risk).toBe(views.operations);
  });

  it('admin hanya menerima omzet cabangnya: tanpa honor instruktur, modal, pengeluaran, atau laba', async () => {
    const db = database();
    const result = await new DashboardService(db as never).overview(principal(), {});
    expect(Object.keys(result.financial).sort()).toEqual(
      ['discountRp', 'grossSalesRp', 'revenueRp', 'sourceCutoffAt'].sort(),
    );
    expect(result.branches).toEqual([]);
    expect(result.trend.every((t) => t.profit === 0)).toBe(true);
    // Pembelian yang dijumlah hanya dari cabang penugasan admin.
    expect(db.pembelian.findMany.mock.calls[0]![0].where.branchId).toEqual({ in: ['branch-1'] });
  });

  it('menghitung booking dari kelas yang sudah dihadiri, bukan hanya yang masih BOOKED', async () => {
    const db = database();
    db.pemesananKelas.count = jest.fn().mockResolvedValue(0);
    const service = new DashboardService(db as never);
    await service.overview(principal({ capabilities: ['dashboard:read'] }), {
      from: '2026-09-01',
      until: '2026-09-30',
    });
    const bookingWheres = db.pemesananKelas.count.mock.calls.map(
      ([arg]: [{ where: { status: unknown } }]) => arg.where.status,
    );
    expect(bookingWheres.length).toBeGreaterThanOrEqual(3);
    for (const status of bookingWheres) expect(status).toEqual({ in: ['BOOKED', 'ATTENDED'] });
  });

  it('validates date order before querying the database', async () => {
    const db = database();
    const service = new DashboardService(db as never);
    await expect(
      service.overview(principal(), { from: '2026-08-01', until: '2026-07-01' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 422 });
    expect(db.pembelian.aggregate).not.toHaveBeenCalled();
  });

  it('reuses in-memory cached customerOverview when ttlMs is specified', async () => {
    const db = database();
    const service = new DashboardService(db as never);
    const p = principal({ userId: 'cached-user', roles: [{ role: 'CUSTOMER', branchId: null }] });

    const first = await service.customerOverview(p, { ttlMs: 10_000 });
    // findMany is shared by pemesananKelas, paketPelanggan, and pembelian (3 calls total)
    expect(db.pemesananKelas.findMany).toHaveBeenCalledTimes(3);

    const second = await service.customerOverview(p, { ttlMs: 10_000 });
    // Second call within TTL should return cached object without querying database again
    expect(db.pemesananKelas.findMany).toHaveBeenCalledTimes(3);
    expect(second).toBe(first);

    const third = await service.customerOverview(p, { forceRefresh: true, ttlMs: 10_000 });
    expect(db.pemesananKelas.findMany).toHaveBeenCalledTimes(6);

    service.clearCustomerOverviewCache('cached-user');
    await service.customerOverview(p, { ttlMs: 10_000 });
    expect(db.pemesananKelas.findMany).toHaveBeenCalledTimes(9);
  });
});
