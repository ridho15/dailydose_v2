import { Prisma } from '@prisma/client';
import { PolicyService } from '../identity/policy.service';
import { PackageAccessService } from './package-access.service';
import { PackagePricingService } from './kalkulasi-harga-paket.service';
import { CustomerOrderService } from './pembelian-paket.service';
import { PaymentReviewService } from './verifikasi-pembayaran.service';
import {
  MAKS_PERPANJANGAN,
  cekSesiPaketPerpanjangan,
  paketPerpanjanganIds,
  periksaTargetPerpanjangan,
  pilihanTargetPerpanjangan,
  simpanTandaPerpanjangan,
  tarikPerpanjangan,
  terapkanPerpanjangan,
} from './perpanjangan-masa-aktif';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const HARI = 86_400_000;
const branchA = id(1);
const memberId = id(300);
const paketPerpanjanganId = id(40);
const targetId = id(70);
const now = new Date('2026-11-16T03:00:00.000Z');

type Baris = Record<string, any>;

/** Database tiruan kecil: cukup untuk alur perpanjangan (penanda, catatan, paket member, pembelian). */
function fakeDb(opts: { target?: Partial<Baris>; catatan?: Baris[]; pembelian?: Baris[] } = {}) {
  const paket: Baris = {
    id: targetId,
    userId: memberId,
    status: 'ACTIVE',
    validUntil: new Date(now.getTime() + 10 * HARI),
    remainingSessions: 4,
    totalSessions: 8,
    package: { name: 'Paket 8 Sesi' },
    ...opts.target,
  };
  const catatan: Baris[] = [...(opts.catatan ?? [])];
  const pembelian: Baris[] = [...(opts.pembelian ?? [])];
  const cocok = (row: Baris, where: Baris) =>
    Object.entries(where).every(([k, v]) =>
      v && typeof v === 'object' && 'in' in v ? (v.in as unknown[]).includes(row[k]) : row[k] === v,
    );
  const db: any = {
    paketPerpanjangan: {
      findMany: jest.fn(async ({ where }) =>
        (where.packageId.in as string[]).includes(paketPerpanjanganId) ? [{ packageId: paketPerpanjanganId }] : [],
      ),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    perpanjanganPaket: {
      findMany: jest.fn(async ({ where }) => catatan.filter((r) => cocok(r, where))),
      findUnique: jest.fn(async ({ where }) => catatan.find((r) => r.purchaseId === where.purchaseId) ?? null),
      create: jest.fn(async ({ data }) => {
        const row = { appliedAt: null, rolledBackAt: null, validUntilBefore: null, validUntilAfter: null, ...data };
        catatan.push(row);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }) => {
        const rows = catatan.filter((r) => cocok(r, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      }),
    },
    paketPelanggan: {
      findUnique: jest.fn(async ({ where }) => (where.id === paket.id ? { ...paket } : null)),
      findMany: jest.fn(async () => [{ ...paket }]),
      update: jest.fn(async ({ data }) => Object.assign(paket, data)),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    pembelian: {
      findMany: jest.fn(async ({ where }) => pembelian.filter((p) => cocok(p, where))),
    },
  };
  return { db, paket, catatan, pembelian };
}

const diterapkan = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    purchaseId: id(500 + i),
    targetCustomerPackageId: targetId,
    userId: memberId,
    hari: 30,
    appliedAt: new Date(now.getTime() - HARI),
    rolledBackAt: null,
  }));

const galatTabel = () =>
  new Prisma.PrismaClientKnownRequestError('The table `paket_perpanjangan` does not exist', {
    code: 'P2021',
    clientVersion: 'test',
  });

describe('perpanjangan masa aktif: aturan inti', () => {
  it('menambah 30 hari dari tanggal berakhir saat ini, bukan dari hari ini', async () => {
    const { db, paket, catatan } = fakeDb({
      catatan: [{ purchaseId: id(60), targetCustomerPackageId: targetId, userId: memberId, hari: 30, appliedAt: null, rolledBackAt: null }],
    });
    const awal = paket.validUntil as Date;
    const hasil = await terapkanPerpanjangan(db, id(60), now);
    expect(paket.validUntil.getTime()).toBe(awal.getTime() + 30 * HARI);
    expect(hasil.validUntilBefore).toEqual(awal);
    expect(catatan[0]!.appliedAt).toEqual(now);
    expect(catatan[0]!.validUntilAfter).toEqual(paket.validUntil);
  });

  it('idempoten: menerapkan dua kali tetap hanya menambah 30 hari sekali', async () => {
    const { db, paket } = fakeDb({
      catatan: [{ purchaseId: id(60), targetCustomerPackageId: targetId, userId: memberId, hari: 30, appliedAt: null, rolledBackAt: null }],
    });
    const awal = paket.validUntil.getTime();
    await terapkanPerpanjangan(db, id(60), now);
    await terapkanPerpanjangan(db, id(60), now);
    expect(paket.validUntil.getTime()).toBe(awal + 30 * HARI);
    expect(db.paketPelanggan.update).toHaveBeenCalledTimes(1);
  });

  it(`pembelian ke-${MAKS_PERPANJANGAN + 1} ditolak, saat pesanan dibuat maupun saat disetujui`, async () => {
    const { db } = fakeDb({ catatan: diterapkan(3) });
    await expect(periksaTargetPerpanjangan(db, targetId, memberId, now)).rejects.toMatchObject({
      code: 'PACKAGE_EXTENSION_LIMIT_REACHED',
      status: 409,
    });
    const lewat = fakeDb({
      catatan: [
        ...diterapkan(3),
        { purchaseId: id(60), targetCustomerPackageId: targetId, userId: memberId, hari: 30, appliedAt: null, rolledBackAt: null },
      ],
    });
    await expect(terapkanPerpanjangan(lewat.db, id(60), now)).rejects.toMatchObject({
      code: 'PACKAGE_EXTENSION_LIMIT_REACHED',
    });
    expect(lewat.db.paketPelanggan.update).not.toHaveBeenCalled();
  });

  it('pesanan yang masih menunggu ikut dihitung; perpanjangan yang ditarik (void) tidak', async () => {
    const menunggu = { purchaseId: id(61), targetCustomerPackageId: targetId, userId: memberId, hari: 30, appliedAt: null, rolledBackAt: null };
    const { db } = fakeDb({
      catatan: [...diterapkan(2), menunggu],
      pembelian: [{ id: id(61), status: 'WAITING_VERIFICATION' }],
    });
    await expect(periksaTargetPerpanjangan(db, targetId, memberId, now)).rejects.toMatchObject({
      code: 'PACKAGE_EXTENSION_PENDING_LIMIT',
    });
    const ditarik = fakeDb({ catatan: [...diterapkan(2), { ...diterapkan(1)[0], purchaseId: id(62), rolledBackAt: now }] });
    await expect(periksaTargetPerpanjangan(ditarik.db, targetId, memberId, now)).resolves.toMatchObject({ id: targetId });
    const [pilihan] = await pilihanTargetPerpanjangan(ditarik.db, memberId, now);
    expect(pilihan).toMatchObject({ extensionsUsed: 2, extensionsLeft: 1 });
  });

  it('paket target yang sudah hangus, sesi habis, atau milik member lain ditolak saat pesanan dibuat', async () => {
    for (const target of [
      { validUntil: new Date(now.getTime() - 1000) },
      { remainingSessions: 0 },
      { status: 'FROZEN' },
    ]) {
      const { db } = fakeDb({ target });
      await expect(periksaTargetPerpanjangan(db, targetId, memberId, now)).rejects.toMatchObject({
        code: 'PACKAGE_EXTENSION_TARGET_EXPIRED',
      });
    }
    const { db } = fakeDb({ target: { userId: id(301) } });
    await expect(periksaTargetPerpanjangan(db, targetId, memberId, now)).rejects.toMatchObject({
      code: 'PACKAGE_EXTENSION_TARGET_NOT_FOUND',
    });
    await expect(periksaTargetPerpanjangan(db, undefined, memberId, now)).rejects.toMatchObject({
      code: 'PACKAGE_EXTENSION_TARGET_REQUIRED',
    });
  });

  it('void menarik kembali 30 hari sekali saja', async () => {
    const { db, paket } = fakeDb({
      catatan: [{ ...diterapkan(1)[0], purchaseId: id(60) }],
    });
    const awal = paket.validUntil.getTime();
    await expect(tarikPerpanjangan(db, id(60), now)).resolves.toMatchObject({ hari: 30 });
    await expect(tarikPerpanjangan(db, id(60), now)).resolves.toBeNull();
    expect(paket.validUntil.getTime()).toBe(awal - 30 * HARI);
  });

  it('paket perpanjangan wajib 0 sesi; paket biasa minimal 1 sesi', () => {
    expect(() => cekSesiPaketPerpanjangan(true, 0)).not.toThrow();
    expect(() => cekSesiPaketPerpanjangan(true, 4)).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(() => cekSesiPaketPerpanjangan(false, 0)).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(() => cekSesiPaketPerpanjangan(false, 8)).not.toThrow();
  });
});

describe('perpanjangan masa aktif: tabel belum dibuat', () => {
  const tanpaTabel = { $queryRawUnsafe: jest.fn(async () => []) };

  it('penanda tidak terbaca berarti tidak ada paket perpanjangan (alur paket biasa tetap jalan)', async () => {
    const db = { paketPerpanjangan: { findMany: jest.fn(() => Promise.reject(galatTabel())) } };
    await expect(paketPerpanjanganIds(db, [paketPerpanjanganId])).resolves.toEqual(new Set());
  });

  it('mencentang paket perpanjangan atau membuat pesanannya tanpa tabel ditolak dengan kode jelas', async () => {
    const db = { ...tanpaTabel, paketPerpanjangan: { upsert: jest.fn() }, perpanjanganPaket: { create: jest.fn() } };
    await expect(simpanTandaPerpanjangan(db, paketPerpanjanganId, true, id(1))).rejects.toMatchObject({
      code: 'PACKAGE_EXTENSION_UNAVAILABLE',
    });
    await expect(simpanTandaPerpanjangan(db, paketPerpanjanganId, false, id(1))).resolves.toBeUndefined();
    await expect(periksaTargetPerpanjangan(db, targetId, memberId, now)).rejects.toMatchObject({
      code: 'PACKAGE_EXTENSION_UNAVAILABLE',
    });
    await expect(tarikPerpanjangan({ ...db, perpanjanganPaket: { findUnique: jest.fn() } }, id(60), now)).resolves.toBeNull();
  });
});

describe('persetujuan pembayaran paket perpanjangan', () => {
  const reviewer = {
    sessionId: 's',
    userId: id(200),
    roles: [] as never,
    capabilities: ['payment:decide', 'payment:review'],
    branchIds: [branchA],
  };
  const access = () => new PackageAccessService({} as never, new PolicyService(), { record: jest.fn() } as never);

  function setup(opts: Parameters<typeof fakeDb>[0] = {}, purchase: Baris = {}) {
    const fake = fakeDb({
      catatan: [{ purchaseId: id(60), targetCustomerPackageId: targetId, userId: memberId, hari: 30, appliedAt: null, rolledBackAt: null }],
      ...opts,
      // decide() memakai jam sungguhan, jadi masa berlaku dihitung dari Date.now().
      target: { validUntil: new Date(Date.now() + 10 * HARI), ...opts.target },
    });
    const row = {
      id: id(60),
      userId: memberId,
      recordedById: null,
      branchId: branchA,
      packageId: paketPerpanjanganId,
      voucherId: null,
      status: 'WAITING_VERIFICATION',
      paymentMethod: 'BANK_TRANSFER',
      invoiceNumber: 'INV-EXT',
      package: { name: 'Perpanjangan 30 Hari', sessionCount: 0, validityDays: 30 },
      branch: { name: 'GG' },
      paymentProof: { uploadedAt: new Date() },
      ...purchase,
    };
    const tx = {
      ...fake.db,
      pembelian: {
        ...fake.db.pembelian,
        findUnique: jest.fn().mockResolvedValue(row),
        update: jest.fn().mockImplementation(async ({ data }) => ({ ...row, ...data })),
      },
      sessionLedger: { create: jest.fn() },
    };
    const idempotency = { execute: jest.fn(async (_c: unknown, run: any) => run(tx)) };
    return { ...fake, tx, service: new PaymentReviewService({} as never, idempotency as never, access()) };
  }
  const approve = (s: PaymentReviewService) =>
    s.decide(reviewer, id(60), 'APPROVED', { reasonCode: 'PAYMENT_VERIFIED' }, 'key-12345', 'c');

  it('lunas: masa berlaku paket target bertambah 30 hari, tanpa Paket Pelanggan 0 sesi baru', async () => {
    const { service, tx, paket } = setup();
    const awal = paket.validUntil.getTime();
    const hasil: any = await approve(service);
    expect(paket.validUntil.getTime()).toBe(awal + 30 * HARI);
    expect(tx.paketPelanggan.create).not.toHaveBeenCalled();
    // Satu catatan riwayat tanpa perubahan sesi (amount 0), untuk log masa berlaku terpusat.
    expect(tx.sessionLedger.create).toHaveBeenCalledTimes(1);
    expect(tx.sessionLedger.create.mock.calls[0][0].data).toMatchObject({
      type: 'ADJUST_MANUAL',
      amount: 0,
      customerPackageId: targetId,
      notes: expect.stringMatching(/^Perpanjangan masa aktif berbayar \+30 hari/),
    });
    expect(tx.pembelian.update.mock.calls[0][0].data.status).toBe('PAID');
    expect(hasil.body.extension).toMatchObject({ targetCustomerPackageId: targetId, days: 30 });
  });

  it('paket target kedaluwarsa tanpa bukti bayar: persetujuan gagal dan pembelian tidak berubah', async () => {
    const { service, tx, paket } = setup({ target: { validUntil: new Date(Date.now() - 1000) } }, { paymentProof: null, paymentMethod: 'QRIS' });
    const awal = paket.validUntil.getTime();
    await expect(approve(service)).rejects.toMatchObject({ code: 'PACKAGE_EXTENSION_PROOF_REQUIRED', status: 409 });
    expect(tx.pembelian.update).not.toHaveBeenCalled();
    expect(paket.validUntil.getTime()).toBe(awal);
  });

  it('paket target kedaluwarsa dengan bukti bayar (25 Nov 2026): aktif lagi, berlaku 30 hari dari hari disetujui', async () => {
    const { service, paket } = setup({ target: { validUntil: new Date(Date.now() - 20 * HARI), status: 'EXPIRED' } });
    await approve(service);
    expect(paket.status).toBe('ACTIVE');
    const hari = (paket.validUntil.getTime() - Date.now()) / HARI;
    expect(hari).toBeGreaterThan(29.9);
    expect(hari).toBeLessThan(31);
    // Akhir hari WIB: 23:59:59 WIB = 16:59:59 UTC.
    expect(paket.validUntil.toISOString().slice(11, 19)).toBe('16:59:59');
  });

  it('paket habis sesinya tetap tidak bisa diperpanjang walau ada bukti', async () => {
    const { service } = setup({ target: { validUntil: new Date(Date.now() - HARI), status: 'EXPIRED', remainingSessions: 0 } });
    await expect(approve(service)).rejects.toMatchObject({ code: 'PACKAGE_EXTENSION_TARGET_EXPIRED' });
  });

  it('persetujuan kedua ditolak sebagai sudah diputus dan tidak memperpanjang lagi', async () => {
    const { service, paket } = setup({}, { status: 'PAID' });
    const awal = paket.validUntil.getTime();
    await expect(approve(service)).rejects.toMatchObject({ code: 'PURCHASE_ALREADY_DECIDED' });
    expect(paket.validUntil.getTime()).toBe(awal);
  });

  it('tanpa tabel penanda: pembelian diperlakukan sebagai paket biasa', async () => {
    const { service, tx } = setup();
    tx.paketPerpanjangan.findMany.mockRejectedValue(galatTabel());
    tx.paketPelanggan.create.mockImplementation(async ({ data }: any) => ({ id: id(71), ...data }));
    tx.paketPelanggan.findUnique.mockResolvedValue(null);
    await approve(service);
    expect(tx.paketPelanggan.create).toHaveBeenCalledTimes(1);
  });
});

describe('penjualan di meja paket perpanjangan', () => {
  it('wajib memilih paket target yang masih bersisa sesi; pesanan tidak dibuat bila sesinya habis', async () => {
    const fake = fakeDb({ target: { validUntil: new Date(Date.now() - 1000), remainingSessions: 0 } });
    const tx = {
      ...fake.db,
      user: { findUnique: jest.fn().mockResolvedValue({ id: memberId, role: 'CUSTOMER', status: 'ACTIVE' }) },
      cabang: { findUnique: jest.fn().mockResolvedValue({ id: branchA, active: true }) },
      paket: {
        findUnique: jest.fn().mockResolvedValue({
          id: paketPerpanjanganId,
          status: 'ACTIVE',
          branchId: null,
          priceRp: 150_000,
          sessionCount: 0,
          validityDays: 30,
        }),
      },
      packagePromotion: { findFirst: jest.fn().mockResolvedValue(null) },
      pembelian: { ...fake.db.pembelian, create: jest.fn() },
    };
    const idempotency = { execute: jest.fn(async (_c: unknown, run: any) => ({ ...(await run(tx)), replay: false })) };
    const audit = { record: jest.fn() };
    const service = new CustomerOrderService(
      {} as never,
      new PackageAccessService({} as never, new PolicyService(), audit as never),
      new PackagePricingService(),
      {} as never,
      idempotency as never,
      {} as never,
      audit as never,
    );
    const admin = { sessionId: 's', userId: id(100), roles: [] as never, capabilities: ['purchase:record'], branchIds: [branchA] };
    const input = { customerUserId: memberId, packageId: paketPerpanjanganId, branchId: branchA, paymentMethod: 'CASH' };
    await expect(service.recordAssistedSale(admin, input, 'key-12345', 'c')).rejects.toMatchObject({
      code: 'PACKAGE_EXTENSION_TARGET_REQUIRED',
    });
    await expect(
      service.recordAssistedSale(admin, { ...input, targetCustomerPackageId: targetId }, 'key-12345', 'c'),
    ).rejects.toMatchObject({ code: 'PACKAGE_EXTENSION_TARGET_EXPIRED' });
    expect(tx.pembelian.create).not.toHaveBeenCalled();

    // Staf boleh memperpanjang paket yang sudah kedaluwarsa asalkan masih ada sesinya.
    fake.paket.remainingSessions = 3;
    tx.pembelian.create.mockImplementation(async ({ data }: any) => ({ ...data, package: {}, branch: { paymentAccounts: [] } }));
    await service.recordAssistedSale(admin, { ...input, targetCustomerPackageId: targetId }, 'key-12345', 'c');
    expect(fake.catatan).toHaveLength(1);
    expect(fake.catatan[0]).toMatchObject({ targetCustomerPackageId: targetId, userId: memberId, hari: 30, createdById: id(100) });
  });
});

describe('jendela 14 hari paket perpanjangan', () => {
  const { dalamJendelaPerpanjangan, JENDELA_PERPANJANGAN_HARI } = jest.requireActual('./perpanjangan-masa-aktif');
  const now = new Date('2026-11-24T03:00:00Z');
  it('boleh dibeli bila paket berakhir dalam 14 hari, belum boleh bila lebih dari itu', () => {
    expect(JENDELA_PERPANJANGAN_HARI).toBe(14);
    expect(dalamJendelaPerpanjangan({ validUntil: new Date(now.getTime() + 13 * 86_400_000) }, now)).toBe(true);
    expect(dalamJendelaPerpanjangan({ validUntil: new Date(now.getTime() + 14 * 86_400_000) }, now)).toBe(true);
    expect(dalamJendelaPerpanjangan({ validUntil: new Date(now.getTime() + 15 * 86_400_000) }, now)).toBe(false);
  });
});

