import { PolicyService } from '../identity/policy.service';
import * as tabelOpsional from '../foundation/tabel-opsional';
import { penjualanMinuman, StokMinumanService } from './stok-minuman.service';

const BARANG = '11111111-1111-4111-8111-111111111111';
const policy = new PolicyService();
const prinsipal = (role: string, branchId: string | null = 'gg') => {
  const roles = [{ role, branchId }] as never;
  const akses = policy.resolveAccess('u-' + role, roles);
  return { sessionId: 's', userId: 'u-' + role, roles, capabilities: akses.capabilities, branchIds: akses.branchIds } as never;
};

/** Database tiruan: mutasi disimpan di array, stok dihitung dari groupBy seperti Prisma. */
function setup(mutasiAwal: Array<{ branchId: string; barangId: string; jenis: string; jumlah: number }> = []) {
  jest.spyOn(tabelOpsional, 'tabelOpsionalAda').mockResolvedValue(true);
  const mutasi = [...mutasiAwal];
  const groupBy = jest.fn(async ({ by, where }: any) => {
    const cocok = mutasi.filter((m) => m.branchId === where.branchId && (!where.barangId || m.barangId === where.barangId));
    const kunci = new Map<string, any>();
    for (const m of cocok) {
      const k = by.map((f: string) => (m as any)[f]).join('|');
      const row = kunci.get(k) ?? { ...Object.fromEntries(by.map((f: string) => [f, (m as any)[f]])), _sum: { jumlah: 0 } };
      row._sum.jumlah += m.jumlah;
      kunci.set(k, row);
    }
    return [...kunci.values()];
  });
  const barang = { id: BARANG, nama: 'Air mineral', satuan: 'botol', hargaJualRp: 8000, aktif: true };
  const tx: any = {
    $queryRaw: jest.fn(async () => []),
    otherCost: { create: jest.fn(async ({ data }) => ({ id: 'cost-1', ...data })) },
    mutasiStokMinuman: {
      groupBy,
      create: jest.fn(async ({ data }) => {
        mutasi.push(data);
        return { ...data, createdAt: new Date() };
      }),
    },
  };
  const db: any = {
    $transaction: jest.fn(async (fn: any) => fn(tx)),
    barangMinuman: { findUnique: jest.fn(async () => barang), findMany: jest.fn(async () => [barang]) },
    mutasiStokMinuman: { groupBy },
  };
  const audit = { catat: jest.fn() };
  return { svc: new StokMinumanService(db, policy, audit as never), db, tx, audit, mutasi };
}

const NOW = new Date('2026-11-25T05:00:00Z');

describe('StokMinumanService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('barang masuk menambah stok dan otomatis jadi pengeluaran cabang kategori MINUMAN', async () => {
    const { svc, tx } = setup();
    const hasil = await svc.catat(
      prinsipal('ADMIN'),
      { branchId: 'gg', barangId: BARANG, jenis: 'MASUK', jumlah: 24, hargaSatuanRp: 3500 },
      NOW,
    );
    expect(hasil.stokSesudah).toBe(24);
    expect(hasil.totalRp).toBe(84_000);
    expect(hasil.otherCostId).toBe('cost-1');
    expect(tx.otherCost.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ branchId: 'gg', category: 'MINUMAN', amountRp: 84_000, period: '2026-11' }),
    });
  });

  it('dijual memakai harga jual master bila harga tidak diisi; tidak membuat pengeluaran', async () => {
    const { svc, tx } = setup([{ branchId: 'gg', barangId: BARANG, jenis: 'MASUK', jumlah: 10 }]);
    const hasil = await svc.catat(prinsipal('ADMIN'), { branchId: 'gg', barangId: BARANG, jenis: 'DIJUAL', jumlah: 3 }, NOW);
    expect(hasil.totalRp).toBe(24_000);
    expect(hasil.stokSesudah).toBe(7);
    expect(tx.otherCost.create).not.toHaveBeenCalled();
  });

  it('dipakai owner bernilai Rp0; stok tidak boleh minus', async () => {
    const { svc } = setup([{ branchId: 'gg', barangId: BARANG, jenis: 'MASUK', jumlah: 2 }]);
    const pakai = await svc.catat(prinsipal('SUPER_OWNER', null), { branchId: 'gg', barangId: BARANG, jenis: 'DIPAKAI_OWNER', jumlah: 2 }, NOW);
    expect(pakai.totalRp).toBe(0);
    expect(pakai.stokSesudah).toBe(0);
    await expect(
      svc.catat(prinsipal('MANAGER'), { branchId: 'gg', barangId: BARANG, jenis: 'DIJUAL', jumlah: 1 }, NOW),
    ).rejects.toMatchObject({ response: 'DRINK_STOCK_INSUFFICIENT' });
  });

  it('admin hanya beli dan jual: dipakai owner ditolak; harga jual selalu dari master walau admin mengirim harga lain', async () => {
    const { svc } = setup([{ branchId: 'gg', barangId: BARANG, jenis: 'MASUK', jumlah: 5 }]);
    await expect(
      svc.catat(prinsipal('ADMIN'), { branchId: 'gg', barangId: BARANG, jenis: 'DIPAKAI_OWNER', jumlah: 1 }, NOW),
    ).rejects.toMatchObject({ status: 403 });
    const jual = await svc.catat(prinsipal('ADMIN'), { branchId: 'gg', barangId: BARANG, jenis: 'DIJUAL', jumlah: 2, hargaSatuanRp: 1 }, NOW);
    expect(jual.hargaSatuanRp).toBe(8000);
    expect(jual.totalRp).toBe(16_000);
  });

  it('barang tanpa harga jual tidak bisa dijual sampai Super Owner mengisi harganya', async () => {
    const { svc, db } = setup([{ branchId: 'gg', barangId: BARANG, jenis: 'MASUK', jumlah: 5 }]);
    db.barangMinuman.findUnique.mockResolvedValue({ id: BARANG, nama: 'Teh', satuan: 'botol', hargaJualRp: null, aktif: true });
    await expect(
      svc.catat(prinsipal('ADMIN'), { branchId: 'gg', barangId: BARANG, jenis: 'DIJUAL', jumlah: 1, hargaSatuanRp: 5000 }, NOW),
    ).rejects.toMatchObject({ response: 'DRINK_PRICE_NOT_SET' });
  });

  it('stok dihitung per cabang: stok cabang lain tidak bisa dijual di sini', async () => {
    const { svc } = setup([{ branchId: 'mk', barangId: BARANG, jenis: 'MASUK', jumlah: 50 }]);
    await expect(
      svc.catat(prinsipal('ADMIN'), { branchId: 'gg', barangId: BARANG, jenis: 'DIJUAL', jumlah: 1 }, NOW),
    ).rejects.toMatchObject({ response: 'DRINK_STOCK_INSUFFICIENT' });
  });

  it('admin tidak bisa mencatat di cabang lain; tanggal masa depan dan jenis lain ditolak', async () => {
    const { svc } = setup();
    await expect(
      svc.catat(prinsipal('ADMIN'), { branchId: 'mk', barangId: BARANG, jenis: 'MASUK', jumlah: 1, hargaSatuanRp: 1 }, NOW),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      svc.catat(prinsipal('ADMIN'), { branchId: 'gg', barangId: BARANG, jenis: 'MASUK', jumlah: 1, hargaSatuanRp: 1, tanggal: '2026-11-26' }, NOW),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      svc.catat(prinsipal('ADMIN'), { branchId: 'gg', barangId: BARANG, jenis: 'RUSAK', jumlah: 1 }, NOW),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('master barang hanya Super Owner; Manager dan Admin tidak; Owner dan Finance hanya membaca', async () => {
    const { svc } = setup();
    await expect(svc.buatBarang(prinsipal('ADMIN'), { nama: 'Teh', satuan: 'botol' })).rejects.toMatchObject({ status: 403 });
    await expect(svc.buatBarang(prinsipal('MANAGER'), { nama: 'Teh', satuan: 'botol' })).rejects.toMatchObject({ status: 403 });
    await expect(svc.catat(prinsipal('OWNER'), { branchId: 'gg', barangId: BARANG, jenis: 'DIJUAL', jumlah: 1 }, NOW)).rejects.toMatchObject({ status: 403 });
    await expect(svc.stok(prinsipal('OWNER'), { branchId: 'gg' })).resolves.toMatchObject({ items: [{ stok: 0 }] });
    await expect(svc.stok(prinsipal('FINANCE', null), { branchId: 'gg' })).resolves.toBeDefined();
  });
});

describe('penjualanMinuman', () => {
  it('menjumlah DIJUAL per cabang; tabel belum ada berarti Rp0', async () => {
    const db = {
      mutasiStokMinuman: {
        findMany: jest.fn(async () => [
          { branchId: 'gg', totalRp: 16_000 },
          { branchId: 'mk', totalRp: 8_000 },
          { branchId: 'gg', totalRp: 8_000 },
        ]),
      },
    };
    const r = await penjualanMinuman(db, { branchIds: ['gg', 'mk'], fromDate: new Date(), untilExclusive: new Date() });
    expect(r.totalRp).toBe(32_000);
    expect(r.perCabang.get('gg')).toBe(24_000);
    const galat = new (require('@prisma/client').Prisma.PrismaClientKnownRequestError)('x', { code: 'P2021', clientVersion: 'x' });
    const kosong = await penjualanMinuman(
      { mutasiStokMinuman: { findMany: async () => { throw galat; } } },
      { branchIds: null, fromDate: new Date(), untilExclusive: new Date() },
    );
    expect(kosong.totalRp).toBe(0);
  });
});
