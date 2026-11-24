import { PolicyService } from '../identity/policy.service';
import { PembatalanTerlambatService } from './pembatalan-terlambat.service';
// Pembersihan pengajuan usang diuji di tutup-pembatalan-usang.spec.ts; di sini kueri daftarnya.
jest.mock('./tutup-pembatalan-usang', () => ({ tutupPembatalanUsang: jest.fn(async () => 0) }));


const MK = '00000000-0000-4000-8000-0000000000a2';
const BOOKING = '00000000-0000-4000-8000-0000000000b1';
const REQ = '00000000-0000-4000-8000-0000000000c1';
const now = new Date('2026-10-29T10:00:00Z');
/** Tangkapan layar chat member (PNG) yang dilampirkan admin. */
const BUKTI = { buffer: Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex') };
const besok = new Date('2026-10-30T02:00:00Z');

const admin = {
  sessionId: 's',
  userId: 'admin-1',
  roles: [{ role: 'ADMIN', branchId: MK }],
  capabilities: ['booking:cancel:assisted', 'booking:read'],
  branchIds: [MK],
} as never;
const manager = {
  sessionId: 's',
  userId: 'mgr-1',
  roles: [{ role: 'MANAGER', branchId: MK }],
  capabilities: ['booking:late-cancel:decide', 'booking:read'],
  branchIds: [MK],
} as never;

// Booking "terkunci Hadir" berasal dari V1 (sesinya sudah dipotong V1 saat dikunci H-24).
function setup(status = 'ATTENDED', bookingNumber = 'BKG-V1-00000001') {
  const tx = {
    pemesananKelas: {
      findUnique: jest.fn(async () => ({
        id: BOOKING,
        status,
        bookingNumber,
        userId: 'cust-1',
        classSlotId: 'slot-1',
        customerPackageId: 'pkg-1',
        attendance: status === 'ATTENDED' ? { id: 'att-1' } : null,
        classSlot: { branchId: MK, startAt: besok, endAt: new Date(besok.getTime() + 3_600_000), status: 'CONFIRMED' },
      })),
      update: jest.fn(),
    },
    sessionAdjustRequest: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }) => ({
        ...data,
        id: REQ,
        version: 1,
        createdAt: now,
        requestedBy: { displayName: 'Admin MK' },
      })),
      findUnique: jest.fn(),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    sessionLedger: { findFirst: jest.fn(async () => null), create: jest.fn() },
    kehadiranPelanggan: { delete: jest.fn() },
    slotKelas: { update: jest.fn() },
    paketPelanggan: {
      findUniqueOrThrow: jest.fn(async () => ({
        id: 'pkg-1',
        remainingSessions: 0,
        usedSessions: 4,
        status: 'DEPLETED',
        validUntil: new Date('2026-12-31T00:00:00Z'),
      })),
      update: jest.fn(),
    },
    auditLog: { create: jest.fn() },
  };
  const db = { $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
  const storage = { put: jest.fn(async () => ({})), delete: jest.fn(async () => undefined), exists: jest.fn(async () => false) };
  return { tx, storage, service: new PembatalanTerlambatService(db as never, new PolicyService(), undefined, storage as never) };
}

describe('PembatalanTerlambatService', () => {
  it('admin mengajukan pembatalan booking yang terkunci Hadir; 1 sesi akan kembali', async () => {
    const { tx, service } = setup('ATTENDED');
    const hasil = await service.ajukan(
      admin,
      BOOKING,
      { reason: 'Member sakit, ada surat dokter' }, BUKTI,
      now,
    );
    expect(hasil).toMatchObject({
      bookingId: BOOKING,
      sessionCount: 1,
      requestedByName: 'Admin MK',
    });
    expect(tx.sessionAdjustRequest.create.mock.calls[0]![0].data).toMatchObject({
      reasonCode: 'LATE_CANCELLATION',
      bookingId: BOOKING,
    });
  });

  it('booking aktif biasa di bawah H-24: sesinya belum terpotong, tidak ada yang dikembalikan', async () => {
    const { service } = setup('BOOKED');
    const hasil = await service.ajukan(
      admin,
      BOOKING,
      { reason: 'Member berhalangan mendadak' }, BUKTI,
      now,
    );
    expect(hasil.sessionCount).toBe(0);
  });

  it('menolak alasan pendek, kelas yang sudah dimulai, dan pengajuan ganda', async () => {
    const { tx, service } = setup('BOOKED');
    await expect(service.ajukan(admin, BOOKING, { reason: 'sakit' }, BUKTI, now)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(
      service.ajukan(
        admin,
        BOOKING,
        { reason: 'Member berhalangan mendadak' },
        BUKTI,
        new Date('2026-10-30T03:00:00Z'),
      ),
    ).rejects.toMatchObject({ code: 'CLASS_ALREADY_STARTED' });
    tx.sessionAdjustRequest.findFirst.mockResolvedValueOnce({ id: 'lama' } as never);
    await expect(
      service.ajukan(admin, BOOKING, { reason: 'Member berhalangan mendadak' }, BUKTI, now),
    ).rejects.toMatchObject({ code: 'LATE_CANCELLATION_ALREADY_PENDING' });
  });

  it('manager menyetujui: booking batal, catatan hadir dihapus, kursi dibuka, 1 sesi kembali', async () => {
    const { tx, service } = setup('ATTENDED');
    tx.sessionAdjustRequest.findUnique.mockResolvedValue({
      id: REQ,
      version: 1,
      status: 'PENDING',
      reasonCode: 'LATE_CANCELLATION',
      requestedById: 'admin-1',
      bookingId: BOOKING,
      customerPackageId: 'pkg-1',
      sessionCount: 1,
      reason: 'Member sakit, ada surat dokter',
      booking: { classSlot: { branchId: MK } },
    } as never);
    const hasil = await service.putuskan(manager, REQ, 'approve', { expectedVersion: 1 }, now);
    expect(hasil).toMatchObject({ status: 'APPROVED', sessionsReturned: 1, resultingBalance: 1 });
    expect(tx.pemesananKelas.update.mock.calls[0]![0].data.status).toBe('CANCELLED');
    expect(tx.kehadiranPelanggan.delete).toHaveBeenCalledWith({ where: { id: 'att-1' } });
    expect(tx.slotKelas.update).toHaveBeenCalledWith({
      where: { id: 'slot-1' },
      data: { bookedCount: { decrement: 1 } },
    });
    expect(tx.paketPelanggan.update.mock.calls[0]![0].data).toMatchObject({
      remainingSessions: 1,
      // satu sesi dikembalikan, jadi "terpakai" ikut turun (4 → 3)
      usedSessions: 3,
      status: 'ACTIVE',
    });
  });

  it('admin tidak bisa memutus, dan pengaju tidak memutus pengajuannya sendiri', async () => {
    const { tx, service } = setup('ATTENDED');
    await expect(
      service.putuskan(admin, REQ, 'approve', { expectedVersion: 1 }, now),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    tx.sessionAdjustRequest.findUnique.mockResolvedValue({
      id: REQ,
      status: 'PENDING',
      reasonCode: 'LATE_CANCELLATION',
      requestedById: 'mgr-1',
      bookingId: BOOKING,
      booking: { classSlot: { branchId: MK } },
    } as never);
    await expect(
      service.putuskan(manager, REQ, 'approve', { expectedVersion: 1 }, now),
    ).rejects.toMatchObject({
      code: 'SEPARATION_OF_DUTIES',
    });
  });

  it('ditolak: booking tetap seperti semula', async () => {
    const { tx, service } = setup('ATTENDED');
    tx.sessionAdjustRequest.findUnique.mockResolvedValue({
      id: REQ,
      status: 'PENDING',
      reasonCode: 'LATE_CANCELLATION',
      requestedById: 'admin-1',
      bookingId: BOOKING,
      sessionCount: 1,
      booking: { classSlot: { branchId: MK } },
    } as never);
    const hasil = await service.putuskan(manager, REQ, 'reject', { expectedVersion: 1 }, now);
    expect(hasil.status).toBe('REJECTED');
    expect(tx.pemesananKelas.update).not.toHaveBeenCalled();
  });
  it('izin medis: kursi langsung dilepas; sesi yang belum terpotong tetap utuh dan tidak ada sesi tambahan', async () => {
    const { tx, service } = setup('BOOKED');
    const hasilAjukan = await service.ajukan(
      admin,
      BOOKING,
      { reason: 'Member dirawat di RS, ada surat dokter', isMedical: true }, BUKTI,
      now,
    );
    expect(hasilAjukan).toMatchObject({
      bookingId: BOOKING,
      sessionCount: 0,
    });
    // Kursi langsung dikosongkan dan booking dibatalkan seketika
    expect(tx.pemesananKelas.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: BOOKING },
        data: expect.objectContaining({ status: 'CANCELLED' }),
      }),
    );
    expect(tx.slotKelas.update).toHaveBeenCalledWith({
      where: { id: 'slot-1' },
      data: { bookedCount: { decrement: 1 } },
    });

    // Saat Manager menyetujui: booking ini belum pernah dipotong, jadi tidak ada sesi yang ditambahkan
    tx.pemesananKelas.findUnique.mockResolvedValueOnce({ id: BOOKING, status: 'CANCELLED', classSlot: { branchId: MK } } as never);
    tx.sessionAdjustRequest.findUnique.mockResolvedValue({
      id: REQ,
      version: 1,
      status: 'PENDING',
      reasonCode: 'LATE_CANCELLATION',
      requestedById: 'admin-1',
      bookingId: BOOKING,
      customerPackageId: 'pkg-1',
      sessionCount: 1,
      reason: '[IZIN MEDIS] Member dirawat di RS, ada surat dokter',
      booking: { status: 'CANCELLED', classSlot: { branchId: MK } },
    } as never);

    const hasilPutus = await service.putuskan(manager, REQ, 'approve', { expectedVersion: 1 }, now);
    expect(hasilPutus).toMatchObject({ status: 'APPROVED', sessionsReturned: 0 });
    expect(tx.paketPelanggan.update).not.toHaveBeenCalled();
  });

  it('booking V2 yang sudah check-in tetapi kelasnya belum selesai: tidak ada sesi yang dikembalikan', async () => {
    const { service } = setup('ATTENDED', 'BKG-20261102-0001');
    const hasil = await service.ajukan(admin, BOOKING, { reason: 'Member harus pulang mendadak, keluarga sakit' }, BUKTI, now);
    expect(hasil).toMatchObject({ sessionCount: 0 });
  });

  describe('bukti pendukung (wajib untuk admin)', () => {
    it('tanpa bukti ditolak 422 sebelum apa pun disimpan', async () => {
      const { tx, storage, service } = setup('BOOKED');
      await expect(
        service.ajukan(admin, BOOKING, { reason: 'Member berhalangan mendadak' }, undefined, now),
      ).rejects.toMatchObject({ code: 'EVIDENCE_REQUIRED' });
      expect(storage.put).not.toHaveBeenCalled();
      expect(tx.sessionAdjustRequest.create).not.toHaveBeenCalled();
    });

    it('berkas selain gambar atau PDF ditolak', async () => {
      const { service } = setup('BOOKED');
      await expect(
        service.ajukan(admin, BOOKING, { reason: 'Member berhalangan mendadak' }, { buffer: Buffer.from('bukan gambar sama sekali') }, now),
      ).rejects.toMatchObject({ code: 'UPLOAD_REJECTED' });
    });

    it('bukti disimpan dengan id pengajuan; dihapus lagi bila pengajuan gagal dibuat', async () => {
      const { tx, storage, service } = setup('BOOKED');
      await service.ajukan(admin, BOOKING, { reason: 'Member berhalangan mendadak' }, BUKTI, now);
      const idPengajuan = (tx.sessionAdjustRequest.create.mock.calls[0] as any[])[0].data.id;
      expect(idPengajuan).toMatch(/^[0-9a-f-]{36}$/);
      expect(storage.put).toHaveBeenCalledWith({ key: `adjustment-evidence/${idPengajuan}.png`, content: BUKTI.buffer });

      const gagal = setup('BOOKED');
      gagal.tx.sessionAdjustRequest.create.mockRejectedValueOnce(new Error('db'));
      await expect(
        gagal.service.ajukan(admin, BOOKING, { reason: 'Member berhalangan mendadak' }, BUKTI, now),
      ).rejects.toThrow('db');
      expect(gagal.storage.delete).toHaveBeenCalledTimes(1);
    });
  });
});
