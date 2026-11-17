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
      // Ringkasan dihitung per status efektif: AND [filter, syarat status].
      count: jest.fn().mockImplementation(async ({ where }: { where: unknown }) => {
        const teks = JSON.stringify(where);
        if (teks.includes('"status":"ACTIVE"')) return counts.ACTIVE ?? 0;
        if (teks.includes('"INACTIVE","ARCHIVED"')) return (counts.INACTIVE ?? 0) + (counts.ARCHIVED ?? 0);
        return 0;
      }),
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
    const where = JSON.stringify(db.paket.findMany.mock.calls[0][0].where);
    expect(where).toContain('{"OR":[{"branchId":"branch-1"},{"isMultiBranch":true},{"branchId":null}]}');
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

  describe('maksimal teman per kelas', () => {
    const baseRow = row(1);
    const buat = (tersimpan: number | null) => {
      const tx = {
        paket: {
          findUnique: jest.fn().mockResolvedValue(baseRow),
          update: jest.fn().mockResolvedValue({ ...baseRow, branch: null }),
        },
        paketBawaTeman: {
          findUnique: jest.fn().mockResolvedValue(tersimpan === null ? null : { packageId: baseRow.id, maksTeman: tersimpan }),
          upsert: jest.fn().mockResolvedValue({}),
          deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
          findMany: jest.fn().mockResolvedValue(tersimpan === null ? [] : [{ packageId: baseRow.id, maksTeman: tersimpan }]),
        },
        paketMasaJual: { upsert: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      };
      const service = new PackageCatalogService(
        {} as never,
        { catalog: jest.fn() } as never,
        { execute: (_o: unknown, fn: (t: unknown) => Promise<unknown>) => fn(tx) } as never,
        { record: jest.fn() } as never,
      );
      const ubah = (body: Record<string, unknown>) =>
        service.update(principal, baseRow.id, { name: 'Paket 1', ...body }, 'idem', 'corr');
      return { tx, ubah };
    };

    it('menyimpan 2 teman per kelas supaya pemilik paket bisa datang bertiga', async () => {
      const { tx, ubah } = buat(1);
      const res = await ubah({ maksTeman: 2 });
      expect(tx.paketBawaTeman.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ maksTeman: 2 }),
          update: expect.objectContaining({ maksTeman: 2 }),
        }),
      );
      expect(res.body).toMatchObject({ bawaTeman: true, maksTeman: 2 });
    });

    it('0 berarti tidak boleh bawa teman', async () => {
      const { tx, ubah } = buat(2);
      const res = await ubah({ maksTeman: 0 });
      expect(tx.paketBawaTeman.deleteMany).toHaveBeenCalled();
      expect(res.body).toMatchObject({ bawaTeman: false, maksTeman: 0 });
    });

    it('menolak angka di luar 0 sampai 5 atau pecahan', async () => {
      for (const salah of [6, -1, 1.5, 'dua']) {
        const { tx, ubah } = buat(1);
        await expect(ubah({ maksTeman: salah })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        expect(tx.paketBawaTeman.upsert).not.toHaveBeenCalled();
      }
    });

    it('form lama yang hanya mengirim centang tidak menurunkan 2 teman menjadi 1', async () => {
      const { tx, ubah } = buat(2);
      const res = await ubah({ bawaTeman: true });
      expect(tx.paketBawaTeman.upsert).not.toHaveBeenCalled();
      expect(res.body).toMatchObject({ maksTeman: 2 });
    });
  });
});
