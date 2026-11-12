import { RefundPaketService, hitungRefund } from './refund-paket.service';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PKG = id(1);
const CABANG = id(5);
const admin = { sessionId: 's', userId: id(98), roles: [{ role: 'ADMIN', branchId: CABANG }], capabilities: [], branchIds: [CABANG] } as never;
const adminLain = { sessionId: 's', userId: id(97), roles: [{ role: 'ADMIN', branchId: id(6) }], capabilities: [], branchIds: [id(6)] } as never;
const instruktur = { sessionId: 's', userId: id(96), roles: [{ role: 'INSTRUCTOR', branchId: CABANG }], capabilities: [], branchIds: [CABANG] } as never;
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
const form = { bankName: 'BCA', nomorRekening: '123-456-7890', namaRekening: 'Citra Meilia', alasan: 'Pindah domisili ke luar kota' };

describe('rumus refund', () => {
  it('harga final / total sesi x sisa sesi', () => {
    // 22 sesi Rp3.000.000, sisa 15 sesi.
    expect(hitungRefund(3_000_000, 22, 15)).toEqual({ hargaPerSesiRp: 136_364, nominalRefundRp: 2_045_455 });
    expect(hitungRefund(3_000_000, 22, 0).nominalRefundRp).toBe(0);
  });
});

function setup(opsi: { booking?: Array<{ id: string; classSlotId: string }>; uniqueCode?: number } = {}) {
  const pkg = {
    id: PKG, userId: id(10), status: 'ACTIVE', totalSessions: 22, remainingSessions: 15,
    validFrom: new Date('2026-10-31'), validUntil: new Date('2026-12-31'),
    package: { id: id(20), name: 'Paket 22 Sesi', code: 'P22', branchId: CABANG },
    purchase: { id: id(30), status: 'PAID', branchId: CABANG, totalAmountRp: 3_000_000 + (opsi.uniqueCode ?? 0), uniqueCode: opsi.uniqueCode ?? null },
    user: { id: id(10), displayName: 'Citra Meilia' },
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    paketPelanggan: { findUnique: jest.fn().mockResolvedValue(pkg), update: jest.fn() },
    pemesananKelas: { findMany: jest.fn().mockResolvedValue(opsi.booking ?? []), update: jest.fn() },
    slotKelas: { update: jest.fn() },
    sessionLedger: { create: jest.fn() },
    refundPaket: { create: jest.fn(async ({ data }: any) => data) },
  };
  const db = { ...tx, $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
  const storage = { put: jest.fn(), delete: jest.fn().mockResolvedValue(undefined) };
  const audit = { catat: jest.fn() };
  return { service: new RefundPaketService(db as never, audit as never, storage as never), tx, storage, audit };
}

describe('proses refund', () => {
  it('menolak peran di luar Admin/Manager/Owner/Super Owner dan cabang lain', async () => {
    await expect(setup().service.pratinjau(instruktur, PKG)).rejects.toMatchObject({ status: 403 });
    await expect(setup().service.pratinjau(adminLain, PKG)).rejects.toMatchObject({ status: 404 });
  });

  it('pratinjau memakai harga final tanpa kode unik transfer', async () => {
    const hasil = await setup({ uniqueCode: 123 }).service.pratinjau(admin, PKG);
    expect(hasil).toMatchObject({ hargaDibayarRp: 3_000_000, sisaSesi: 15, nominalRefundRp: 2_045_455, bisaRefund: true });
  });

  it('wajib rekening, nama, alasan, dan bukti transfer berupa gambar/PDF', async () => {
    const { service, storage } = setup();
    await expect(service.proses(admin, PKG, { ...form, nomorRekening: 'abc' }, { buffer: JPG })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(service.proses(admin, PKG, form, undefined)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(service.proses(admin, PKG, form, { buffer: Buffer.from('<html>bukan gambar</html>') })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('menyimpan refund, menolkan paket, dan mencatat buku sesi serta audit', async () => {
    const { service, tx, audit } = setup();
    const hasil = await service.proses(admin, PKG, form, { buffer: JPG });
    expect(hasil).toMatchObject({ nominalRefundRp: 2_045_455 });
    expect(tx.paketPelanggan.update).toHaveBeenCalledWith({ where: { id: PKG }, data: { remainingSessions: 0, status: 'EXPIRED' } });
    expect(tx.sessionLedger.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ amount: -15, balanceAfter: 0 }) }));
    expect(tx.refundPaket.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ nomorRekening: '1234567890', namaRekening: 'Citra Meilia', sisaSesi: 15 }) }));
    expect(audit.catat).toHaveBeenCalledWith(tx, expect.objectContaining({ action: 'customer_package.refunded' }));
  });

  it('booking aktif harus dibatalkan bersama; bila gagal, bukti yang terunggah dihapus lagi', async () => {
    const booking = [{ id: id(40), classSlotId: id(41) }];
    const a = setup({ booking });
    await expect(a.service.proses(admin, PKG, form, { buffer: JPG })).rejects.toMatchObject({ code: 'PACKAGE_HAS_ACTIVE_BOOKINGS' });
    expect(a.storage.delete).toHaveBeenCalled();
    const b = setup({ booking });
    await b.service.proses(admin, PKG, { ...form, batalkanBooking: 'true' }, { buffer: JPG });
    expect(b.tx.pemesananKelas.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: id(40) } }));
  });
});
