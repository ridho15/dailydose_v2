import { ROLE_CAPABILITIES } from '../identity/role-capabilities';
import { PolicyService } from '../identity/policy.service';
import { bacaKursor, kodekanKursor, KotakTindakanService } from './kotak-tindakan.service';

const GG = '00000000-0000-4000-8000-0000000000a1';
const MK = '00000000-0000-4000-8000-0000000000a2';
const NOW = new Date('2026-11-22T03:00:00.000Z');

const sebagai = (role: keyof typeof ROLE_CAPABILITIES, userId = `${role.toLowerCase()}-1`, branchIds = [GG]) =>
  ({
    sessionId: 's',
    userId,
    roles: [{ role, branchId: role === 'SUPER_OWNER' || role === 'FINANCE' ? null : GG }],
    capabilities: [...ROLE_CAPABILITIES[role]],
    branchIds,
  }) as never;

function setup() {
  const pembelian = {
    count: jest.fn(async () => 1),
    findMany: jest.fn(async () => [
      {
        id: 'p-1',
        createdAt: new Date('2026-11-21T01:00:00.000Z'),
        totalAmountRp: 1_500_000,
        paymentMethod: 'BANK_TRANSFER',
        recordedById: null,
        branchId: GG,
        user: { displayName: 'Rina' },
        branch: { name: 'Gading' },
        package: { name: '10 Sesi' },
        paymentProof: { uploadedAt: new Date('2026-11-21T02:00:00.000Z') },
      },
    ]),
  };
  const db = {
    pembelian,
    ubahJadwal: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
    sessionAdjustRequest: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
    user: { findMany: jest.fn(async () => []) },
  };
  const antrean = {
    antrean: jest.fn(async () => ({
      dibuatPada: NOW.toISOString(),
      items: [
        { key: 'renewal', jumlah: 3, href: '/workspace/renewal' },
        { key: 'bukti', jumlah: 9, href: '/workspace/payments' },
      ],
      gagal: [],
    })),
  };
  const service = new KotakTindakanService(db as never, new PolicyService(), antrean as never);
  return { db, service };
}

describe('KotakTindakanService: jenis mengikuti izin MEMUTUS, bukan izin membaca', () => {
  it('Admin tidak melihat transfer atau penjualan tunai (tanpa payment:decide), tetapi melihat reschedule', async () => {
    const { service } = setup();
    const admin = sebagai('ADMIN');
    expect(service.cakupan(admin, 'TRANSFER')).toBeNull();
    expect(service.cakupan(admin, 'PENJUALAN_LANGSUNG')).toBeNull();
    expect(service.cakupan(admin, 'PEMBATALAN')).toBeNull();
    expect(service.cakupan(admin, 'RESCHEDULE')).toEqual({ all: false, included: [GG], excluded: [] });
  });

  it('Owner cabang hanya memutus pembatalan kurang dari H-12', async () => {
    const { service } = setup();
    const owner = sebagai('OWNER');
    expect(service.cakupan(owner, 'PEMBATALAN')).not.toBeNull();
    for (const jenis of ['TRANSFER', 'PENJUALAN_LANGSUNG', 'RESCHEDULE', 'PENYESUAIAN'] as const)
      expect(service.cakupan(owner, jenis)).toBeNull();
  });

  it('Finance memutus transfer tetapi tidak penjualan tunai (wajib Manager/Super Owner, PRD 5.12)', () => {
    const { service } = setup();
    const finance = sebagai('FINANCE');
    expect(service.cakupan(finance, 'TRANSFER')).not.toBeNull();
    expect(service.cakupan(finance, 'PENJUALAN_LANGSUNG')).toBeNull();
    expect(service.cakupan(sebagai('MANAGER'), 'PENJUALAN_LANGSUNG')).not.toBeNull();
  });

  it('cabang yang diminta di luar cakupan membuat jenis itu kosong untuk staf cabang', () => {
    const { service } = setup();
    expect(service.cakupan(sebagai('MANAGER'), 'RESCHEDULE', MK)).toBeNull();
    expect(service.cakupan(sebagai('SUPER_OWNER'), 'RESCHEDULE', MK)).toEqual({
      all: false,
      included: [MK],
      excluded: [],
    });
  });

  it('Admin hanya meminta reschedule dan tidak pernah membaca pembelian', async () => {
    const { db, service } = setup();
    const hasil = await service.daftar(sebagai('ADMIN'), { branchId: GG }, NOW);
    expect(db.pembelian.findMany).not.toHaveBeenCalled();
    expect(db.ubahJadwal.findMany).toHaveBeenCalled();
    expect(hasil.items).toEqual([]);
    expect(hasil.pengingat).toEqual([{ key: 'renewal', jumlah: 3, href: '/workspace/renewal' }]);
  });

  it('menolak cabang di luar penugasan staf', async () => {
    const { service } = setup();
    await expect(service.daftar(sebagai('MANAGER'), { branchId: MK }, NOW)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('transfer: hanya yang sudah ada bukti, dan pembeli/pencatat sendiri dikecualikan', async () => {
    const { db, service } = setup();
    const hasil = await service.daftar(sebagai('MANAGER', 'mgr-1'), { branchId: GG }, NOW);
    const panggilan = db.pembelian.count.mock.calls as unknown as [{ where: Record<string, unknown> }][];
    const syarat = (w: Record<string, unknown>) => w.AND as Record<string, unknown>[];
    const transfer = syarat(
      panggilan.find(([a]) =>
        (syarat(a.where)[0]!.paymentMethod as { in: string[] }).in.includes('BANK_TRANSFER'),
      )![0].where,
    );
    expect(transfer).toContainEqual({
      OR: [{ paymentProof: { isNot: null } }, { paymentMethod: 'QRIS', recordedById: { not: null } }],
    });
    expect(transfer).toContainEqual({ userId: { not: 'mgr-1' } });
    expect(transfer).toContainEqual({ OR: [{ recordedById: null }, { recordedById: { not: 'mgr-1' } }] });
    expect(hasil.items[0]).toMatchObject({
      id: 'p-1',
      jenis: 'TRANSFER',
      nama: 'Rina',
      nilaiRp: 1_500_000,
      buktiAda: true,
      masukPada: '2026-11-21T02:00:00.000Z',
    });
  });

  it('Super Owner boleh memutus catatannya sendiri, jadi filter pemisahan tugas tidak dipasang', async () => {
    const { db, service } = setup();
    await service.daftar(sebagai('SUPER_OWNER'), {}, NOW);
    const where = (db.pembelian.count.mock.calls[0] as unknown as [{ where: { AND: Record<string, unknown>[] } }])[0]
      .where;
    expect(where.AND.some((w) => 'userId' in w)).toBe(false);
    expect(where.AND[0]!.branchId).toBeUndefined();
  });

  it('pengajuan sendiri tidak muncul untuk Manager di pembatalan maupun penyesuaian', async () => {
    const { db, service } = setup();
    await service.daftar(sebagai('MANAGER', 'mgr-1'), { branchId: GG }, NOW);
    for (const [arg] of db.sessionAdjustRequest.count.mock.calls as unknown as [
      { where: Record<string, unknown> },
    ][])
      expect(arg.where.requestedById).toEqual({ not: 'mgr-1' });
  });

  it('halaman satu jenis memakai kursor dan mengembalikan nextCursor bila masih ada', async () => {
    const { db, service } = setup();
    db.pembelian.findMany.mockResolvedValueOnce(
      Array.from({ length: 3 }, (_, i) => ({
        id: `p-${i}`,
        createdAt: new Date(`2026-11-2${i}T01:00:00.000Z`),
        totalAmountRp: 100,
        paymentMethod: 'BANK_TRANSFER',
        recordedById: null,
        branchId: GG,
        user: { displayName: 'A' },
        branch: { name: 'Gading' },
        package: { name: 'P' },
        paymentProof: { uploadedAt: new Date() },
      })),
    );
    const hasil = await service.daftar(
      sebagai('FINANCE'),
      { jenis: 'TRANSFER', limit: 2 },
      NOW,
    );
    expect(hasil.items).toHaveLength(2);
    expect(bacaKursor(hasil.nextCursor!)).toEqual({
      masukPada: new Date('2026-11-21T01:00:00.000Z'),
      id: 'p-1',
    });
  });

  it('jenis yang tidak dikenal dan kursor rusak ditolak dengan pesan validasi', async () => {
    const { service } = setup();
    await expect(service.daftar(sebagai('FINANCE'), { jenis: 'APA' }, NOW)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(() => bacaKursor('tidak-valid')).toThrow();
    expect(bacaKursor(kodekanKursor(NOW, 'x'))).toEqual({ masukPada: NOW, id: 'x' });
  });

  it('satu sumber gagal dilaporkan di gagal, bukan dihitung nol', async () => {
    const { db, service } = setup();
    db.ubahJadwal.count.mockRejectedValueOnce(new Error('db mati'));
    const hasil = await service.daftar(sebagai('MANAGER'), { branchId: GG }, NOW);
    expect(hasil.gagal).toEqual(['RESCHEDULE']);
    expect(hasil.ringkasan.find((r) => r.jenis === 'TRANSFER')).toEqual({ jenis: 'TRANSFER', jumlah: 1 });
  });
});
