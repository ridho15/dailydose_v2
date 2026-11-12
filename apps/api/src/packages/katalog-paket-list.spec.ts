import { Prisma } from '@prisma/client';
import { PackageCatalogService } from './katalog-paket.service';

const row = (n: number, status = 'ACTIVE', branchId: string | null = null) => ({
  id: `pkg-${String(n).padStart(3, '0')}`,
  code: `PKG-${n}`,
  name: `Paket ${n}`,
  description: null,
  priceRp: 100_000 + n,
  sessionCount: 4,
  validityDays: 30,
  status,
  branchId,
  classTypeId: null,
  classType: null,
  createdAt: new Date(`2026-10-${String(30 - (n % 28)).padStart(2, '0')}T00:00:00Z`),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
});

function setup(rows: ReturnType<typeof row>[], counts: Record<string, number>) {
  const db = {
    paket: {
      findMany: jest.fn().mockResolvedValue(rows),
      count: jest.fn().mockImplementation(async ({ where }: { where: { status?: string } }) =>
        where.status ? (counts[where.status] ?? 0) : Object.values(counts).reduce((a, b) => a + b, 0),
      ),
    },
    packagePromotion: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = new PackageCatalogService(
    db as never,
    { catalog: jest.fn() } as never,
    {} as never,
    {} as never,
  );
  return { service, db };
}
const principal = { sessionId: 's', userId: 'u', roles: [], capabilities: [], branchIds: [] } as never;

describe('daftar paket admin menampilkan seluruh katalog', () => {
  it('menghitung ringkasan dari seluruh katalog, bukan dari 20 baris pertama', async () => {
    const { service } = setup(
      Array.from({ length: 21 }, (_, i) => row(i + 1)),
      { ACTIVE: 127, INACTIVE: 11, ARCHIVED: 3 },
    );
    const result = await service.list(principal, {});
    expect(result.items).toHaveLength(20);
    expect(result.page.hasMore).toBe(true);
    expect(result.summary).toMatchObject({ ACTIVE: 127, INACTIVE: 14 });
  });

  it('memakai cursor agar halaman berikutnya benar-benar berbeda', async () => {
    const { service, db } = setup([row(21)], { ACTIVE: 1 });
    await service.list(principal, { cursor: 'pkg-020' });
    expect(db.paket.findMany.mock.calls[0][0]).toMatchObject({ cursor: { id: 'pkg-020' }, skip: 1 });
  });

  it('filter cabang juga mencakup paket untuk semua cabang', async () => {
    const { service, db } = setup([], {});
    await service.list(principal, { branchId: 'branch-1' });
    expect(db.paket.findMany.mock.calls[0][0].where).toMatchObject({
      OR: expect.arrayContaining([{ branchId: 'branch-1' }, { branchId: null }]),
    });
  });

  it('update paket tetap berhasil ketika tabel opsional paket_masa_jual dan paket_bawa_teman belum ada (P2021)', async () => {
    const p2021 = (table: string) =>
      new Prisma.PrismaClientKnownRequestError(`The table \`${table}\` does not exist`, {
        code: 'P2021',
        clientVersion: 'test',
      });
    const baseRow = row(1);
    const tx = {
      paket: {
        findUnique: jest.fn().mockResolvedValue(baseRow),
        update: jest.fn().mockResolvedValue({ ...baseRow, name: 'Paket 1 Baru', branch: null }),
      },
      paketBawaTeman: {
        upsert: jest.fn().mockRejectedValue(p2021('paket_bawa_teman')),
        deleteMany: jest.fn().mockRejectedValue(p2021('paket_bawa_teman')),
        findMany: jest.fn().mockRejectedValue(p2021('paket_bawa_teman')),
      },
      paketMasaJual: {
        upsert: jest.fn().mockRejectedValue(p2021('paket_masa_jual')),
        findMany: jest.fn().mockRejectedValue(p2021('paket_masa_jual')),
      },
    };
    const service = new PackageCatalogService(
      {} as never,
      { catalog: jest.fn() } as never,
      { execute: (_opts: unknown, fn: (t: unknown) => Promise<unknown>) => fn(tx) } as never,
      { record: jest.fn() } as never,
    );

    const res = await service.update(
      principal,
      baseRow.id,
      { name: 'Paket 1 Baru', effectiveFrom: '2026-11-10', effectiveUntil: '2026-12-31', bawaTeman: true },
      'idem-1',
      'corr-1',
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Paket 1 Baru', bawaTeman: false, effectiveUntil: null });
  });
});
