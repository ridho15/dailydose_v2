import { PolicyService } from '../identity/policy.service';
import { TargetService } from './target.service';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cabangA = id(1);
const cabangB = id(2);

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

const superOwner = principal(['finance:read', 'branch:all'], 'SUPER_OWNER', id(100));
const ownerA = principal(['finance:read'], 'OWNER', id(101), [cabangA]);

const NOW = new Date('2026-10-28T10:00:00.000Z');

const cabang = (
  over: Partial<{ id: string; name: string; monthlyTargetRp: number | null }> = {},
) => ({
  id: cabangA,
  name: 'Green Garden',
  monthlyTargetRp: 1_000_000,
  ...over,
});

function setup(opts: { satu?: unknown; semua?: unknown[]; omzet?: number } = {}) {
  const db = {
    cabang: {
      findUnique: jest.fn().mockResolvedValue(opts.satu === undefined ? cabang() : opts.satu),
      findMany: jest.fn().mockResolvedValue(opts.semua ?? [cabang()]),
    },
    pembelian: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { totalAmountRp: opts.omzet ?? 0 } }),
    },
  };
  return { service: new TargetService(db as never, new PolicyService()), db };
}

function whereDari(mock: jest.Mock): {
  status?: string;
  paidAt?: { gte: Date; lt: Date };
  branchId?: { in: string[] };
} {
  return (mock.mock.calls[0]?.[0] as { where: Record<string, never> }).where;
}

describe('TargetService membaca target dari cabang', () => {
  it('memakai target bulanan yang tersimpan di cabang', async () => {
    const { service } = setup({ omzet: 500_000 });

    const hasil = await service.pace(superOwner, { branchId: cabangA, period: '2026-10' }, NOW);

    expect(hasil.pace?.targetRp).toBe(1_000_000);
    expect(hasil.pace?.tercapaiRp).toBe(500_000);
    expect(hasil.pace?.tercapaiPersen).toBe(50);
    expect(hasil.branchName).toBe('Green Garden');
  });

  it('menjumlahkan target beberapa cabang untuk angka gabungan', async () => {
    const { service } = setup({
      semua: [
        cabang({ monthlyTargetRp: 1_000_000 }),
        cabang({ id: cabangB, monthlyTargetRp: 2_000_000 }),
      ],
      omzet: 900_000,
    });

    const hasil = await service.pace(superOwner, { period: '2026-10' }, NOW);

    expect(hasil.pace?.targetRp).toBe(3_000_000);
  });

  it('mengatakan target belum dipasang, bukan menampilkan nol', async () => {
    const { service } = setup({ satu: cabang({ monthlyTargetRp: null }) });

    const hasil = await service.pace(superOwner, { branchId: cabangA, period: '2026-10' }, NOW);

    expect(hasil.pace).toBeNull();
    expect(hasil.ringkasan).toContain('belum dipasang');
  });

  it('tidak menanyakan omzet sama sekali ketika target belum dipasang', async () => {
    const { service, db } = setup({ satu: cabang({ monthlyTargetRp: null }) });

    await service.pace(superOwner, { branchId: cabangA, period: '2026-10' }, NOW);

    expect(db.pembelian.aggregate).not.toHaveBeenCalled();
  });

  it('tetap menghitung bila sebagian cabang sudah memasang target', async () => {
    const { service } = setup({
      semua: [
        cabang({ monthlyTargetRp: 1_000_000 }),
        cabang({ id: cabangB, monthlyTargetRp: null }),
      ],
      omzet: 400_000,
    });

    const hasil = await service.pace(superOwner, { period: '2026-10' }, NOW);

    expect(hasil.pace?.targetRp).toBe(1_000_000);
  });

  it('mengizinkan simulasi target lain tanpa mengubah yang tersimpan', async () => {
    const { service, db } = setup({ omzet: 500_000 });

    const hasil = await service.pace(
      superOwner,
      { branchId: cabangA, period: '2026-10', targetRpOverride: 2_000_000 },
      NOW,
    );

    expect(hasil.pace?.targetRp).toBe(2_000_000);
    expect(Object.keys(db.cabang)).toEqual(['findUnique', 'findMany']);
  });

  it('menghormati simulasi walau cabang belum memasang target', async () => {
    const { service } = setup({ satu: cabang({ monthlyTargetRp: null }), omzet: 100_000 });

    const hasil = await service.pace(
      superOwner,
      { branchId: cabangA, period: '2026-10', targetRpOverride: 500_000 },
      NOW,
    );

    expect(hasil.pace?.targetRp).toBe(500_000);
  });

  it('mengatakan cabang tidak ditemukan alih-alih memberi angka palsu', async () => {
    const { service } = setup({ satu: null });

    const hasil = await service.pace(superOwner, { branchId: cabangB, period: '2026-10' }, NOW);

    expect(hasil.pace).toBeNull();
    expect(hasil.ringkasan).toContain('tidak ditemukan');
  });
});

describe('TargetService tidak menulis apa pun', () => {
  it('hanya membaca cabang dan pembelian', async () => {
    const { service, db } = setup({ omzet: 1 });

    await service.pace(superOwner, { branchId: cabangA, period: '2026-10' }, NOW);

    expect(Object.keys(db)).toEqual(['cabang', 'pembelian']);
    expect(Object.keys(db.pembelian)).toEqual(['aggregate']);
  });
});

describe('TargetService isolasi cabang', () => {
  it('membatasi omzet pada cabang yang dihitung', async () => {
    const { service, db } = setup({ omzet: 500_000 });

    await service.pace(superOwner, { branchId: cabangA, period: '2026-10' }, NOW);

    const where = whereDari(db.pembelian.aggregate);
    expect(where.status).toBe('PAID');
    expect(where.paidAt!.gte.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(where.paidAt!.lt.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(where.branchId).toEqual({ in: [cabangA] });
  });

  it('menyaring daftar cabang gabungan sampai milik pemanggil saja', async () => {
    const { service, db } = setup({ semua: [cabang()], omzet: 0 });
    const ownerDuaCabang = principal(['finance:read'], 'OWNER', id(103), [cabangA, cabangB]);

    await service.pace(ownerDuaCabang, { period: '2026-10' }, NOW);

    expect(db.cabang.findMany.mock.calls[0]![0].where.id).toEqual({ in: [cabangA, cabangB] });
  });

  it('tidak menyaring cabang untuk pemegang branch:all', async () => {
    const { service, db } = setup({ semua: [cabang()], omzet: 0 });

    await service.pace(superOwner, { period: '2026-10' }, NOW);

    expect(db.cabang.findMany.mock.calls[0]![0].where.id).toBeUndefined();
  });

  it('menolak Owner membaca cabang lain', async () => {
    const { service } = setup();

    await expect(
      service.pace(ownerA, { branchId: cabangB, period: '2026-10' }, NOW),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('memberi Owner gabungan cabangnya sendiri, bukan seluruh perusahaan', async () => {
    const { service, db } = setup({ semua: [cabang()], omzet: 700_000 });

    const hasil = await service.pace(ownerA, { period: '2026-10' }, NOW);

    // Daftar cabang disaring lebih dulu, lalu omzet hanya dijumlahkan dari daftar itu.
    expect(db.cabang.findMany.mock.calls[0]![0].where.id).toEqual({ in: [cabangA] });
    expect(whereDari(db.pembelian.aggregate).branchId).toEqual({ in: [cabangA] });
    expect(hasil.pace?.tercapaiRp).toBe(700_000);
  });

  it('menolak pemanggil tanpa kapabilitas keuangan', async () => {
    const { service } = setup();
    const tanpa = principal(['branch:all'], 'SUPER_OWNER', id(104));

    await expect(
      service.pace(tanpa, { branchId: cabangA, period: '2026-10' }, NOW),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('TargetService meja depan', () => {
  const admin = principal(['attendance:manage'], 'ADMIN', id(105), [cabangA]);

  it('memberi Admin target cabangnya sendiri', async () => {
    const { service } = setup();
    const hasil = await service.pace(admin, { branchId: cabangA, period: '2026-10' }, NOW);
    expect(hasil.branchId).toBe(cabangA);
  });

  it('menolak gabungan, simulasi, dan cabang lain untuk Admin', async () => {
    const { service } = setup();
    await expect(service.pace(admin, { period: '2026-10' }, NOW)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      service.pace(admin, { branchId: cabangA, period: '2026-10', targetRpOverride: 1 }, NOW),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.pace(admin, { branchId: cabangB, period: '2026-10' }, NOW),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('TargetService validasi', () => {
  it('memakai bulan berjalan ketika periode tidak diisi', async () => {
    const { service } = setup({ omzet: 0 });

    const hasil = await service.pace(superOwner, { branchId: cabangA }, NOW);

    expect(hasil.period).toBe('2026-10');
  });

  it('menolak periode yang tidak sah', async () => {
    const { service } = setup();

    for (const period of ['2026-13', '2026', 'Oktober']) {
      await expect(
        service.pace(superOwner, { branchId: cabangA, period }, NOW),
      ).rejects.toMatchObject({ status: 422 });
    }
  });

  it('menolak simulasi target negatif atau pecahan', async () => {
    const { service } = setup();

    for (const targetRpOverride of [-1, 1.5]) {
      await expect(
        service.pace(superOwner, { branchId: cabangA, period: '2026-10', targetRpOverride }, NOW),
      ).rejects.toMatchObject({ status: 422 });
    }
  });
});
