import { PolicyService } from '../identity/policy.service';
import { MaksTemanMassalService } from './maks-teman-massal.service';
import { PackageAccessService } from './package-access.service';

const superOwner = {
  sessionId: 's',
  userId: 'u-so',
  roles: [{ role: 'SUPER_OWNER', branchId: null }],
  capabilities: ['master:manage', 'package:read', 'branch:all'],
  branchIds: [],
} as never;
const adminTanpaKelola = {
  sessionId: 's',
  userId: 'u-adm',
  roles: [{ role: 'ADMIN', branchId: 'gg' }],
  capabilities: ['package:read', 'purchase:record'],
  branchIds: ['gg'],
} as never;

const paket = (id: string, name: string, status = 'ACTIVE') => ({
  id,
  name,
  code: id.toUpperCase(),
  status,
  branchId: 'gg',
});

/**
 * Database tiruan yang meniru transaksi: tulisan ke paket_bawa_teman dan audit_log disimpan di
 * salinan, dan hanya dipakai bila callback transaksi selesai tanpa galat (rollback bila galat).
 */
function setup(opts: {
  rows: ReturnType<typeof paket>[];
  teman?: Record<string, number>;
  perpanjangan?: string[];
  gagalTulisUntuk?: string;
}) {
  const state = {
    teman: new Map(Object.entries(opts.teman ?? {})),
    audit: [] as Array<Record<string, any>>,
  };
  const buatTx = (teman: Map<string, number>, audit: Array<Record<string, any>>) => ({
    paket: {
      findMany: jest.fn(async ({ where }: any) =>
        opts.rows.filter((r) => !where?.id?.in || where.id.in.includes(r.id)),
      ),
    },
    paketBawaTeman: {
      findMany: jest.fn(async ({ where }: any) =>
        [...teman].filter(([id]) => where.packageId.in.includes(id)).map(([packageId, maksTeman]) => ({ packageId, maksTeman })),
      ),
      upsert: jest.fn(async ({ where, update }: any) => {
        if (where.packageId === opts.gagalTulisUntuk) throw new Error('deadlock');
        teman.set(where.packageId, update.maksTeman);
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        if (where.packageId === opts.gagalTulisUntuk) throw new Error('deadlock');
        teman.delete(where.packageId);
      }),
    },
    paketPerpanjangan: {
      findMany: jest.fn(async ({ where }: any) =>
        (opts.perpanjangan ?? []).filter((id) => where.packageId.in.includes(id)).map((packageId) => ({ packageId })),
      ),
    },
    paketMasaJual: { findMany: jest.fn(async () => []) },
    auditLog: { create: jest.fn(async ({ data }: any) => void audit.push(data)) },
  });
  const db: any = {
    ...buatTx(state.teman, state.audit),
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const teman = new Map(state.teman);
      const audit: Array<Record<string, any>> = [];
      const hasil = await fn(buatTx(teman, audit));
      state.teman = teman;
      state.audit.push(...audit);
      return hasil;
    }),
  };
  const policy = new PolicyService();
  const access = new PackageAccessService(db, policy, {} as never);
  return { service: new MaksTemanMassalService(db, access), state, db };
}

const trio = [paket('trio-1', 'TRIO PASS 10'), paket('trio-2', 'TRIO PASS 20'), paket('trio-3', 'TRIO PASS 5', 'INACTIVE')];

describe('MaksTemanMassalService.simpan', () => {
  it('menyimpan 2 teman untuk semua paket terpilih dalam satu aksi, dengan satu audit per paket', async () => {
    const { service, state } = setup({ rows: trio, teman: { 'trio-1': 1 } });
    const hasil = await service.simpan(superOwner, {
      packageIds: ['trio-1', 'trio-2', 'trio-3'],
      maksTeman: 2,
      reason: 'TRIO PASS bisa datang bertiga',
    });
    expect([...state.teman]).toEqual([
      ['trio-1', 2],
      ['trio-2', 2],
      ['trio-3', 2],
    ]);
    expect(hasil.updated).toEqual([
      { id: 'trio-1', name: 'TRIO PASS 10', sebelum: 1, sesudah: 2 },
      { id: 'trio-2', name: 'TRIO PASS 20', sebelum: 0, sesudah: 2 },
      { id: 'trio-3', name: 'TRIO PASS 5', sebelum: 0, sesudah: 2 },
    ]);
    expect(state.audit).toHaveLength(3);
    expect(state.audit[0]).toMatchObject({
      action: 'PACKAGE_MAX_FRIENDS_UPDATED',
      actorId: 'u-so',
      objectType: 'Package',
      objectId: 'trio-1',
      reason: 'TRIO PASS bisa datang bertiga',
      correlationId: hasil.batchId,
      detail: { before: { maksTeman: 1 }, after: { maksTeman: 2, batchId: hasil.batchId, jumlahPaket: 3 } },
    });
    // Semua entri satu batch.
    expect(new Set(state.audit.map((a) => a.correlationId))).toEqual(new Set([hasil.batchId]));
  });

  it('0 menghapus izin bawa teman', async () => {
    const { service, state } = setup({ rows: trio, teman: { 'trio-1': 2 } });
    await service.simpan(superOwner, { packageIds: ['trio-1'], maksTeman: 0, reason: 'Kembali individu' });
    expect(state.teman.has('trio-1')).toBe(false);
    expect(state.audit[0]!.detail).toMatchObject({ before: { maksTeman: 2 }, after: { maksTeman: 0 } });
  });

  it.each([
    [6, 'INVALID_RANGE'],
    [-1, 'INVALID_RANGE'],
    [1.5, 'INVALID_RANGE'],
    ['dua', 'INVALID_RANGE'],
    [undefined, 'REQUIRED'],
  ])('validasi angka: %p ditolak (%s)', async (maksTeman, issue) => {
    const { service, state, db } = setup({ rows: trio });
    await expect(
      service.simpan(superOwner, { packageIds: ['trio-1'], maksTeman, reason: 'Alasan cukup' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', details: [{ field: 'maksTeman', issue }] });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(state.audit).toHaveLength(0);
  });

  it('alasan wajib dan daftar paket tidak boleh kosong', async () => {
    const { service } = setup({ rows: trio });
    await expect(service.simpan(superOwner, { packageIds: ['trio-1'], maksTeman: 2, reason: ' ' })).rejects.toMatchObject({
      details: [{ field: 'reason', issue: 'REQUIRED' }],
    });
    await expect(service.simpan(superOwner, { packageIds: [], maksTeman: 2, reason: 'Alasan' })).rejects.toMatchObject({
      details: [{ field: 'packageIds', issue: 'REQUIRED' }],
    });
  });

  it('rollback: bila satu paket gagal ditulis, tidak ada paket atau audit yang berubah dan paket gagal disebut', async () => {
    const { service, state } = setup({ rows: trio, teman: { 'trio-1': 1 }, gagalTulisUntuk: 'trio-2' });
    await expect(
      service.simpan(superOwner, { packageIds: ['trio-1', 'trio-2', 'trio-3'], maksTeman: 2, reason: 'Bertiga' }),
    ).rejects.toMatchObject({ code: 'BULK_UPDATE_FAILED', details: [{ field: 'trio-2', issue: 'WRITE_FAILED' }] });
    expect([...state.teman]).toEqual([['trio-1', 1]]);
    expect(state.audit).toHaveLength(0);
  });

  it('paket yang tidak ada atau paket perpanjangan membatalkan semuanya dan disebut satu per satu', async () => {
    const { service, state } = setup({ rows: trio, perpanjangan: ['trio-3'] });
    await expect(
      service.simpan(superOwner, { packageIds: ['trio-1', 'hilang', 'trio-3'], maksTeman: 2, reason: 'Bertiga' }),
    ).rejects.toMatchObject({
      code: 'BULK_UPDATE_FAILED',
      details: [
        { field: 'hilang', issue: 'NOT_FOUND' },
        { field: 'trio-3', issue: 'EXTENSION_PACKAGE' },
      ],
    });
    expect(state.teman.size).toBe(0);
    expect(state.audit).toHaveLength(0);
  });

  it('cek izin: admin tanpa izin kelola paket ditolak', async () => {
    const { service, db } = setup({ rows: trio });
    await expect(
      service.simpan(adminTanpaKelola, { packageIds: ['trio-1'], maksTeman: 2, reason: 'Bertiga' }),
    ).rejects.toBeDefined();
    await expect(service.kandidat(adminTanpaKelola, {})).rejects.toBeDefined();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe('MaksTemanMassalService.kandidat', () => {
  it('mengembalikan semua paket hasil filter dengan nilai teman saat ini', async () => {
    const { service, db } = setup({ rows: trio, teman: { 'trio-2': 1 } });
    const hasil = await service.kandidat(superOwner, { q: 'TRIO PASS', shareable: 'true' });
    expect(hasil.items.map((i) => [i.id, i.maksTeman, i.effectiveState])).toEqual([
      ['trio-1', 0, 'LIVE'],
      ['trio-2', 1, 'LIVE'],
      ['trio-3', 0, 'INACTIVE'],
    ]);
    const where = db.paket.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('"isShareable":true');
    expect(JSON.stringify(where)).toContain('TRIO PASS');
  });
});
