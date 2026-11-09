import { Prisma } from '@prisma/client';
import { PolicyService } from '../identity/policy.service';
import { PackageAccessService } from './package-access.service';
import { PackagePricingService } from './kalkulasi-harga-paket.service';
import { CustomerOrderService } from './pembelian-paket.service';
import { PaymentReviewService } from './verifikasi-pembayaran.service';
import { PackageCatalogService } from './katalog-paket.service';
import { batalkanPesananKedaluwarsa } from './payment-expiration-worker';
import { lepasKuotaVoucher, pakaiKuotaVoucher } from './voucher.service';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const branchA = id(1);
const customerId = id(300);
const packageId = id(40);

const staff = (capabilities: string[], userId: string) => ({
  sessionId: 's',
  userId,
  roles: [] as never,
  capabilities,
  branchIds: [branchA],
});
const access = () =>
  new PackageAccessService({} as never, new PolicyService(), { record: jest.fn() } as never);

describe('persetujuan pembayaran: bukti, masa berlaku, penolakan', () => {
  const reviewer = staff(['payment:decide', 'payment:review'], id(200));
  const purchase = (overrides: Record<string, unknown> = {}) => ({
    id: id(60),
    userId: customerId,
    recordedById: null,
    branchId: branchA,
    packageId,
    voucherId: null,
    status: 'WAITING_VERIFICATION',
    paymentMethod: 'BANK_TRANSFER',
    paymentExpiresAt: null,
    invoiceNumber: 'INV-1',
    package: { name: 'P', sessionCount: 8, validityDays: 120 },
    branch: { name: 'GG' },
    paymentProof: { uploadedAt: new Date() },
    ...overrides,
  });
  function setup(row = purchase(), extra: Record<string, unknown> = {}) {
    const tx: any = {
      pembelian: {
        findUnique: jest.fn().mockResolvedValue(row),
        update: jest.fn().mockImplementation(async ({ data }) => ({ ...row, ...data })),
      },
      paketPelanggan: {
        create: jest.fn().mockImplementation(async ({ data }) => ({ id: id(70), ...data })),
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      pemesananKelas: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
      slotKelas: { update: jest.fn() },
      voucher: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      sessionLedger: { create: jest.fn() },
      ...extra,
    };
    const idempotency = { execute: jest.fn(async (_c: unknown, run: any) => run(tx)) };
    return { tx, service: new PaymentReviewService({} as never, idempotency as never, access()) };
  }
  const approve = (s: PaymentReviewService) =>
    s.decide(reviewer, id(60), 'APPROVED', { reasonCode: 'PAYMENT_VERIFIED' }, 'key-12345', 'c');
  const reject = (s: PaymentReviewService) =>
    s.decide(reviewer, id(60), 'REJECTED', { reasonCode: 'PROOF_INVALID' }, 'key-12345', 'c');

  it('paket berlaku sampai 23.59.59 WIB hari ke-N sesudah aktivasi', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-01T03:00:00.000Z')); // 1 Nov 10.00 WIB
    try {
      const { service, tx } = setup();
      await approve(service);
      const { validUntil } = tx.paketPelanggan.create.mock.calls[0][0].data;
      expect(validUntil.toISOString()).toBe('2027-03-01T16:59:59.000Z'); // 1 Mar 23.59.59 WIB
    } finally {
      jest.useRealTimers();
    }
  });

  it('transfer bank tanpa bukti tidak bisa disetujui, tetapi bisa ditolak', async () => {
    const { service, tx } = setup(purchase({ paymentProof: null }));
    await expect(approve(service)).rejects.toMatchObject({ code: 'PAYMENT_PROOF_REQUIRED', status: 409 });
    expect(tx.pembelian.update).not.toHaveBeenCalled();
    await expect(reject(service)).resolves.toBeDefined();
  });

  it('lewat batas bayar: sah selama ada bukti (termasuk bukti manual staf), ditolak tanpa bukti', async () => {
    const batas = new Date(Date.now() - 3_600_000);
    const sebelum = setup(
      purchase({ paymentExpiresAt: batas, paymentProof: { uploadedAt: new Date(batas.getTime() - 60_000) } }),
    );
    await expect(approve(sebelum.service)).resolves.toBeDefined();

    const sesudah = setup(
      purchase({ paymentExpiresAt: batas, paymentProof: { uploadedAt: new Date(batas.getTime() + 60_000) } }),
    );
    await expect(approve(sesudah.service)).resolves.toBeDefined();
    const tanpa = setup(purchase({ paymentExpiresAt: batas, paymentProof: null }));
    await expect(approve(tanpa.service)).rejects.toMatchObject({ code: 'PAYMENT_PROOF_REQUIRED' });
  });

  it('persetujuan ganda yang kalah balapan (P2002) menjadi 409, bukan 500', async () => {
    const { service, tx } = setup();
    tx.paketPelanggan.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );
    await expect(approve(service)).rejects.toMatchObject({ code: 'PURCHASE_ALREADY_DECIDED', status: 409 });
  });

  it('menolak penjualan meja membatalkan booking BOOKED, mengurangi slot, dan melepas voucher', async () => {
    const { service, tx } = setup(purchase({ voucherId: id(50) }));
    tx.paketPelanggan.findUnique.mockResolvedValue({ id: id(70) });
    tx.pemesananKelas.findMany.mockResolvedValue([
      { id: id(81), classSlotId: id(91) },
      { id: id(82), classSlotId: id(92) },
    ]);
    await reject(service);
    expect(tx.pemesananKelas.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerPackageId: id(70), status: 'BOOKED' } }),
    );
    expect(tx.pemesananKelas.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [id(81), id(82)] }, status: 'BOOKED' },
      data: expect.objectContaining({
        status: 'CANCELLED',
        cancellationReason: 'Pembayaran ditolak',
        cancelledById: reviewer.userId,
      }),
    });
    expect(tx.slotKelas.update).toHaveBeenCalledTimes(2);
    expect(tx.slotKelas.update).toHaveBeenCalledWith({
      where: { id: id(91) },
      data: { bookedCount: { decrement: 1 } },
    });
    expect(tx.sessionLedger.create).not.toHaveBeenCalled();
    expect(tx.voucher.updateMany).toHaveBeenCalledWith({
      where: { id: id(50), usedCount: { gt: 0 } },
      data: { usedCount: { decrement: 1 } },
    });
  });
});

describe('kuota voucher atomik', () => {
  it('menolak 409 bila UPDATE bersyarat tidak mengenai baris', async () => {
    const tx: any = { voucher: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) } };
    await expect(pakaiKuotaVoucher(tx, { id: 'v', quota: 5 })).rejects.toMatchObject({
      code: 'VOUCHER_QUOTA_EXHAUSTED',
      status: 409,
    });
    expect(tx.voucher.updateMany).toHaveBeenCalledWith({
      where: { id: 'v', usedCount: { lt: 5 } },
      data: { usedCount: { increment: 1 } },
    });
  });

  it('melepas kuota tanpa menyentuh voucher bila pesanan tidak bervoucher', async () => {
    const tx: any = { voucher: { updateMany: jest.fn() } };
    await lepasKuotaVoucher(tx, null);
    expect(tx.voucher.updateMany).not.toHaveBeenCalled();
  });
});

describe('kedaluwarsa otomatis', () => {
  function setup(kandidat: any[], countPerUpdate = 1) {
    const tx: any = {
      pembelian: { updateMany: jest.fn().mockResolvedValue({ count: countPerUpdate }) },
      voucher: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const db: any = {
      pembelian: { findMany: jest.fn().mockResolvedValue(kandidat) },
      $transaction: jest.fn(async (run: any) => run(tx)),
    };
    return { db, tx };
  }

  it('hanya memilih pesanan mandiri tanpa bukti, dan memasang ulang syaratnya di UPDATE', async () => {
    const { db, tx } = setup([{ id: 'a', voucherId: 'v1' }, { id: 'b', voucherId: null }]);
    const ids = await batalkanPesananKedaluwarsa(db, 24, new Date());
    expect(ids).toEqual(['a', 'b']);
    expect(db.pembelian.findMany.mock.calls[0][0].where).toMatchObject({
      status: 'PENDING',
      paymentProof: null,
      recordedById: null,
    });
    expect(tx.pembelian.updateMany.mock.calls[0][0].where).toMatchObject({
      id: 'a',
      status: 'PENDING',
      paymentProof: null,
      recordedById: null,
    });
    expect(tx.voucher.updateMany).toHaveBeenCalledTimes(1); // hanya pesanan bervoucher
  });

  it('pesanan yang berubah di antara baca dan tulis tidak dihitung dan voucher tidak dilepas', async () => {
    const { db, tx } = setup([{ id: 'a', voucherId: 'v1' }], 0);
    expect(await batalkanPesananKedaluwarsa(db, 24, new Date())).toEqual([]);
    expect(tx.voucher.updateMany).not.toHaveBeenCalled();
  });

  it('endpoint expire-stale menolak olderThanHours di luar 1..720 atau bukan bilangan bulat', async () => {
    const service = new CustomerOrderService(
      {} as never,
      access(),
      new PackagePricingService(),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const p = staff(['payment:decide', 'payment:review'], id(200));
    for (const bad of [0, -1, 721, 1.5, NaN])
      await expect(service.expireStaleOrders(p, bad)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('createOrder: paket harus dijual di cabang pesanan', () => {
  it('menolak paket cabang lain dengan PACKAGE_BRANCH_MISMATCH', async () => {
    const tx: any = {
      paket: { findUnique: jest.fn().mockResolvedValue({ id: packageId, status: 'ACTIVE', branchId: id(2) }) },
      cabang: { findUnique: jest.fn().mockResolvedValue({ id: branchA, active: true }) },
    };
    const idempotency = { execute: jest.fn(async (_c: unknown, run: any) => run(tx)) };
    const service = new CustomerOrderService(
      {} as never,
      { requireVerifiedCustomer: jest.fn() } as never,
      new PackagePricingService(),
      {} as never,
      idempotency as never,
      {} as never,
      {} as never,
    );
    await expect(
      service.createOrder(staff([], customerId), { packageId, branchId: branchA }, 'key-12345', 'c'),
    ).rejects.toMatchObject({ code: 'PACKAGE_BRANCH_MISMATCH' });
  });
});

describe('katalog paket: validasi angka', () => {
  const p = staff(['master:manage'], id(200));
  function setup() {
    const tx: any = {
      paket: { findUnique: jest.fn().mockResolvedValue({ id: packageId }), update: jest.fn(), create: jest.fn() },
    };
    const idempotency = { execute: jest.fn(async (_c: unknown, run: any) => run(tx)) };
    return new PackageCatalogService({} as never, access(), idempotency as never, { record: jest.fn() } as never);
  }
  const ok = { code: 'X', name: 'X', priceRp: 100_000, sessionCount: 8, validityDays: 30 };

  it('create menolak NaN, nol, negatif, pecahan, dan harga di atas batas', async () => {
    const s = setup();
    for (const bad of [
      { sessionCount: 0 },
      { sessionCount: 1.5 },
      { sessionCount: 'abc' },
      { validityDays: -5 },
      { validityDays: 2.5 },
      { priceRp: -1 },
      { priceRp: 10.5 },
      { priceRp: 2_000_000_001 },
      { priceRp: undefined },
    ])
      await expect(s.create(p, { ...ok, ...bad }, 'key-12345', 'c')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
  });

  it('update memvalidasi hanya kolom yang dikirim', async () => {
    const s = setup();
    await expect(s.update(p, packageId, { sessionCount: 0 }, 'key-12345', 'c')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(s.update(p, packageId, { durationDays: 1.5 }, 'key-12345', 'c')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(s.update(p, packageId, { priceRp: 'x' }, 'key-12345', 'c')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});
