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

  it('verification status follows the selfie rule used everywhere (selfie = verified)', async () => {
    const db = database();
    const service = new DashboardService(db as never);
    const customer = principal({ roles: [{ role: 'CUSTOMER', branchId: null }] });

    db.profilPengguna.findUnique.mockResolvedValueOnce(null);
    expect((await service.customerOverview(customer)).verification.status).toBe('ACTION_REQUIRED');

    // KTP tanpa selfie tidak lagi dianggap "menunggu": tidak ada antrean persetujuan selfie.
    db.profilPengguna.findUnique.mockResolvedValueOnce({ userId: 'user-1', ktpUrl: 'ktp.jpg', notes: null });
    expect((await service.customerOverview(customer)).verification.status).toBe('ACTION_REQUIRED');

    db.profilPengguna.findUnique.mockResolvedValueOnce({ userId: 'user-1', selfieUrl: 'selfie.jpg', notes: null });
    expect((await service.customerOverview(customer)).verification.status).toBe('APPROVED');

    db.profilPengguna.findUnique.mockResolvedValueOnce({
      userId: 'user-1',
      selfieUrl: null,
      notes: 'KYC_REJECTED: FOTO_BURAM',
    });
    const ditolak = await service.customerOverview(customer);
    expect(ditolak.verification).toMatchObject({ status: 'REJECTED', rejectionReason: 'FOTO_BURAM' });
  });

  it('home remaining sessions use the ledger formula (balance minus booked) and a real branch name', async () => {
    const db = database();
    const service = new DashboardService(db as never);
    const validUntil = new Date(Date.now() + 20 * 86_400_000);
    db.paketPelanggan = { findMany: jest.fn().mockResolvedValue([
      {
        id: 'cp-1',
        remainingSessions: 8,
        validUntil,
        package: { name: 'Reformer 8x', isMultiBranch: false, classType: { name: 'Reformer' } },
        purchase: { branch: { name: 'Senopati' } },
      },
      {
        id: 'cp-2',
        remainingSessions: 1,
        validUntil,
        package: { name: 'Mat 10x', isMultiBranch: true, classType: null },
        purchase: null,
      },
    ]) } as never;
    // Panggilan pertama: booking mendatang; kedua: booking yang menahan sesi (tertahanPerPaket).
    db.pemesananKelas = { ...db.pemesananKelas, findMany: jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'b-1', status: 'BOOKED', customerPackageId: 'cp-1' },
        { id: 'b-2', status: 'BOOKED', customerPackageId: 'cp-1' },
        { id: 'b-3', status: 'BOOKED', customerPackageId: 'cp-2' },
      ]) };
    const hasil = await service.customerOverview(principal({ roles: [{ role: 'CUSTOMER', branchId: null }] }));
    expect(hasil.packages).toEqual([
      expect.objectContaining({ id: 'cp-1', available: 6, reserved: 2, branchName: 'Senopati' }),
      expect.objectContaining({ id: 'cp-2', available: 0, reserved: 1, branchName: 'Semua cabang' }),
    ]);
    expect(JSON.stringify(hasil)).not.toContain('All Branches');
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
    // findMany is shared by pemesananKelas, paketPelanggan (active and expired-with-sessions), and pembelian (4 calls total)
    expect(db.pemesananKelas.findMany).toHaveBeenCalledTimes(4);

    const second = await service.customerOverview(p, { ttlMs: 10_000 });
    // Second call within TTL should return cached object without querying database again
    expect(db.pemesananKelas.findMany).toHaveBeenCalledTimes(4);
    expect(second).toBe(first);

    const third = await service.customerOverview(p, { forceRefresh: true, ttlMs: 10_000 });
    expect(db.pemesananKelas.findMany).toHaveBeenCalledTimes(8);

    service.clearCustomerOverviewCache('cached-user');
    await service.customerOverview(p, { ttlMs: 10_000 });
    expect(db.pemesananKelas.findMany).toHaveBeenCalledTimes(12);
  });

  it('upcoming bookings say which seat is a friend seat and whether another friend may still be added', async () => {
    const db = database() as any;
    const service = new DashboardService(db as never);
    const slot = {
      startAt: new Date(Date.now() + 86_400_000),
      endAt: new Date(Date.now() + 90_000_000),
      classType: { id: 'ct', name: 'Reformer' },
      branch: { id: 'b', name: 'Senopati', timezone: 'Asia/Jakarta' },
    };
    const booking = (id: string) => ({
      id,
      classSlotId: 'slot-1',
      customerPackageId: 'cp-1',
      status: 'BOOKED',
      classSlot: slot,
      customerPackage: { packageId: 'pkg-dt', package: { isShareable: false } },
    });
    db.pemesananKelas = { ...db.pemesananKelas, findMany: jest.fn().mockResolvedValue([booking('own'), booking('friend')]) };
    db.paketBawaTeman = { findMany: jest.fn().mockResolvedValue([{ packageId: 'pkg-dt', maksTeman: 2 }]) };
    db.bookingTeman = { findMany: jest.fn().mockResolvedValue([{ bookingId: 'friend', namaTeman: 'Rani' }]) };

    const hasil = await service.customerOverview(principal({ roles: [{ role: 'CUSTOMER', branchId: null }] }));
    expect(hasil.upcomingBookings).toEqual([
      expect.objectContaining({ id: 'own', kursiTeman: false, bisaTambahTeman: true, customerPackageId: 'cp-1' }),
      expect.objectContaining({ id: 'friend', kursiTeman: true, namaTeman: 'Rani', bisaTambahTeman: false }),
    ]);

    // Batas paket 1 teman sudah terpakai: tombol Kursi teman tidak ditawarkan lagi.
    db.paketBawaTeman.findMany.mockResolvedValue([{ packageId: 'pkg-dt', maksTeman: 1 }]);
    const penuh = await service.customerOverview(principal({ roles: [{ role: 'CUSTOMER', branchId: null }] }), {
      forceRefresh: true,
    });
    expect(penuh.upcomingBookings[0]).toMatchObject({ id: 'own', bisaTambahTeman: false });
  });
});
