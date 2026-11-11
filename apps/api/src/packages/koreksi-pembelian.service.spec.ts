import { KoreksiPembelianService } from './koreksi-pembelian.service';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PURCHASE = id(1);
const FELICIA = id(10);
const JESSICA = id(11);
const superOwner = { sessionId: 's', userId: id(99), roles: [{ role: 'SUPER_OWNER', branchId: null }], capabilities: [], branchIds: [] } as never;
const admin = { sessionId: 's', userId: id(98), roles: [{ role: 'ADMIN', branchId: id(5) }], capabilities: ['purchase:record'], branchIds: [id(5)] } as never;
const ALASAN = 'Salah input akun, seharusnya untuk Jessica Natasia';

function setup(opsi: { used?: number; attend?: number; booking?: Array<{ id: string; classSlotId: string; status: string }>; status?: string } = {}) {
  const purchase = {
    id: PURCHASE, invoiceNumber: 'INV-1', userId: FELICIA, branchId: id(5), status: opsi.status ?? 'PAID',
    totalAmountRp: 330_360, paidAt: new Date('2026-11-06T04:23:00Z'),
    user: { id: FELICIA, displayName: 'Felicia' }, package: { id: id(20), name: 'PILATES NOVEMBER' },
    branch: { id: id(5), name: 'Untar' },
    customerPackage: { id: id(30), remainingSessions: 6, usedSessions: opsi.used ?? 0 },
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    pembelian: { findUnique: jest.fn().mockResolvedValue(purchase), update: jest.fn() },
    sessionLedger: { count: jest.fn().mockResolvedValue(opsi.attend ?? 0), create: jest.fn() },
    pemesananKelas: { findMany: jest.fn().mockResolvedValue(opsi.booking ?? []), update: jest.fn() },
    slotKelas: { update: jest.fn() },
    paketPelanggan: { update: jest.fn() },
    pembelianKoreksi: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    user: { findUnique: jest.fn().mockResolvedValue({ id: JESSICA, role: 'CUSTOMER', status: 'ACTIVE', displayName: 'Jessica' }) },
  };
  const db = { ...tx, $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
  const audit = { catat: jest.fn() };
  return { service: new KoreksiPembelianService(db as never, audit as never), tx, audit };
}

describe('batalkan pembelian (void)', () => {
  it('hanya Super Owner', async () => {
    const { service, tx } = setup();
    await expect(service.batalkan(admin, PURCHASE, { kodeAlasan: 'SALAH_INPUT_AKUN', alasan: ALASAN })).rejects.toMatchObject({ status: 403 });
    await expect(service.pratinjau(admin, PURCHASE)).rejects.toMatchObject({ status: 403 });
    expect(tx.pembelian.update).not.toHaveBeenCalled();
  });

  it('wajib kode alasan yang dikenal dan alasan minimal 20 karakter', async () => {
    const { service } = setup();
    await expect(service.batalkan(superOwner, PURCHASE, { kodeAlasan: 'NGASAL', alasan: ALASAN })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(service.batalkan(superOwner, PURCHASE, { kodeAlasan: 'DUPLIKAT', alasan: 'terlalu pendek' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('void penuh: pembelian CANCELLED (keluar dari omzet), paket dinolkan, tercatat di koreksi dan audit', async () => {
    const { service, tx, audit } = setup();
    const hasil = await service.batalkan(superOwner, PURCHASE, { kodeAlasan: 'SALAH_INPUT_AKUN', alasan: ALASAN });
    expect(hasil).toMatchObject({ jenis: 'VOID', omzetBerkurangRp: 330_360, sesiDinolkan: 6 });
    expect(tx.pembelian.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }));
    expect(tx.paketPelanggan.update).toHaveBeenCalledWith({ where: { id: id(30) }, data: { remainingSessions: 0, status: 'EXPIRED' } });
    expect(tx.sessionLedger.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ amount: -6, balanceAfter: 0 }) }));
    expect(tx.pembelianKoreksi.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ jenis: 'VOID', nominalRp: 330_360, actorId: id(99) }) }));
    expect(audit.catat).toHaveBeenCalledWith(tx, expect.objectContaining({ action: 'purchase.voided' }));
  });

  it('ada booking aktif: ditolak kecuali diminta membatalkan bookingnya', async () => {
    const booking = [{ id: id(40), classSlotId: id(41), status: 'BOOKED' }];
    const a = setup({ booking });
    await expect(a.service.batalkan(superOwner, PURCHASE, { kodeAlasan: 'DUPLIKAT', alasan: ALASAN })).rejects.toMatchObject({ code: 'PURCHASE_HAS_ACTIVE_BOOKINGS' });
    const b = setup({ booking });
    await b.service.batalkan(superOwner, PURCHASE, { kodeAlasan: 'DUPLIKAT', alasan: ALASAN, batalkanBooking: true });
    expect(b.tx.pemesananKelas.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: id(40) }, data: expect.objectContaining({ status: 'CANCELLED' }) }));
  });

  it('sesi sudah terpakai: wajib void sebagian; omzet tidak berubah, sisa sesi dinolkan', async () => {
    const a = setup({ used: 2 });
    await expect(a.service.batalkan(superOwner, PURCHASE, { kodeAlasan: 'REFUND', alasan: ALASAN })).rejects.toMatchObject({ code: 'PURCHASE_HAS_USED_SESSIONS' });
    const b = setup({ attend: 1 });
    const hasil = await b.service.batalkan(superOwner, PURCHASE, { kodeAlasan: 'REFUND', alasan: ALASAN, sebagian: true });
    expect(hasil).toMatchObject({ jenis: 'VOID_SEBAGIAN', omzetBerkurangRp: 0 });
    expect(b.tx.pembelian.update).not.toHaveBeenCalled();
  });

  it('hanya pembelian yang sudah lunas', async () => {
    const { service } = setup({ status: 'PENDING' });
    await expect(service.batalkan(superOwner, PURCHASE, { kodeAlasan: 'DUPLIKAT', alasan: ALASAN })).rejects.toMatchObject({ code: 'PURCHASE_NOT_PAID' });
  });
});

describe('pindahkan pembelian ke member lain', () => {
  it('pembelian dan paket berpindah ke member tujuan, tercatat asal dan tujuan', async () => {
    const { service, tx, audit } = setup();
    const hasil = await service.pindahkan(superOwner, PURCHASE, { keUserId: JESSICA, alasan: ALASAN });
    expect(hasil).toMatchObject({ ke: { id: JESSICA } });
    expect(tx.pembelian.update).toHaveBeenCalledWith({ where: { id: PURCHASE }, data: { userId: JESSICA } });
    expect(tx.paketPelanggan.update).toHaveBeenCalledWith({ where: { id: id(30) }, data: { userId: JESSICA } });
    expect(tx.pembelianKoreksi.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ jenis: 'PINDAH', dariUserId: FELICIA, keUserId: JESSICA }) }));
    expect(audit.catat).toHaveBeenCalledWith(tx, expect.objectContaining({ action: 'purchase.transferred' }));
  });

  it('member tujuan harus akun member aktif dan berbeda; sesi terpakai wajib dikonfirmasi', async () => {
    const a = setup();
    a.tx.user.findUnique.mockResolvedValue({ id: JESSICA, role: 'INSTRUCTOR', status: 'ACTIVE' } as never);
    await expect(a.service.pindahkan(superOwner, PURCHASE, { keUserId: JESSICA, alasan: ALASAN })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    const b = setup();
    await expect(b.service.pindahkan(superOwner, PURCHASE, { keUserId: FELICIA, alasan: ALASAN })).rejects.toMatchObject({ code: 'SAME_MEMBER' });
    const c = setup({ used: 1 });
    await expect(c.service.pindahkan(superOwner, PURCHASE, { keUserId: JESSICA, alasan: ALASAN })).rejects.toMatchObject({ code: 'PURCHASE_HAS_USED_SESSIONS' });
    await expect(c.service.pindahkan(superOwner, PURCHASE, { keUserId: JESSICA, alasan: ALASAN, konfirmasiTerpakai: true })).resolves.toBeDefined();
  });
});
