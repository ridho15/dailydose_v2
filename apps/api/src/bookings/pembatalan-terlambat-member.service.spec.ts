import { PolicyService } from '../identity/policy.service';
import { KODE_PEMBATALAN_TERLAMBAT } from './pembatalan-terlambat';
import { PembatalanTerlambatMemberService, teksAlasanMember } from './pembatalan-terlambat-member.service';

const JAM = 3_600_000;
const bookingId = '00000000-0000-4000-8000-000000000010';
const memberId = '00000000-0000-4000-8000-000000000020';
const orangLain = '00000000-0000-4000-8000-000000000099';
const branchId = '00000000-0000-4000-8000-000000000040';

const member = (userId = memberId) =>
  ({
    sessionId: 's',
    userId,
    roles: [{ role: 'CUSTOMER', branchId: null }],
    capabilities: ['booking:self:cancel', 'booking:self:create'],
    branchIds: [],
  }) as never;

const config = { value: { bookingCancellation: { enabled: true, cutoffHours: 12 } } } as never;

function siapkan({ jamSebelumKelas = 5, status = 'BOOKED', sudahMenunggu = false } = {}) {
  const booking = {
    id: bookingId,
    userId: memberId,
    status,
    bookingNumber: 'BK-1',
    classSlotId: 'slot-1',
    customerPackageId: 'cp-1',
    classSlot: { branchId, startAt: new Date(Date.now() + jamSebelumKelas * JAM) },
  };
  const tx = {
    pemesananKelas: {
      // Kepemilikan dicek di query: hanya booking milik userId pemanggil yang ditemukan.
      findFirst: jest.fn(async ({ where }: any) => (where.userId === booking.userId && where.id === bookingId ? booking : null)),
      findUnique: jest.fn(async () => null),
    },
    sessionLedger: { findFirst: jest.fn(async () => null) },
    sessionAdjustRequest: {
      findFirst: jest.fn(async () => (sudahMenunggu ? { id: 'lama' } : null)),
      create: jest.fn(async ({ data }: any) => ({ id: 'req-1', createdAt: new Date(), ...data })),
    },
    user: { findMany: jest.fn(async () => []) },
  };
  const db = { ...tx, $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
  const audit = { catat: jest.fn(async () => undefined) };
  const service = new PembatalanTerlambatMemberService(db as never, new PolicyService(), config, audit as never);
  return { service, tx, audit };
}

describe('Pengajuan pembatalan kurang dari H-12 oleh member sendiri', () => {
  it('membuat record LATE_CANCELLATION yang sama dengan pengajuan staf; booking tetap aktif', async () => {
    const { service, tx, audit } = siapkan();
    const hasil = await service.ajukan(member(), bookingId, { kodeAlasan: 'SAKIT' });

    expect(hasil).toMatchObject({ id: 'req-1', status: 'PENDING', reason: 'Sakit atau kurang sehat' });
    expect(tx.sessionAdjustRequest.create).toHaveBeenCalledWith({
      data: {
        customerPackageId: 'cp-1',
        bookingId,
        requestedById: memberId,
        sessionCount: 0,
        reason: 'Sakit atau kurang sehat',
        reasonCode: KODE_PEMBATALAN_TERLAMBAT,
      },
    });
    expect(audit.catat).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: 'booking.late_cancellation_requested_by_member' }),
    );
  });

  it('booking milik member lain tidak bisa diajukan (404, tidak ada record)', async () => {
    const { service, tx } = siapkan();
    await expect(service.ajukan(member(orangLain), bookingId, { kodeAlasan: 'SAKIT' })).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    expect(tx.pemesananKelas.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: bookingId, userId: orangLain } }),
    );
    expect(tx.sessionAdjustRequest.create).not.toHaveBeenCalled();
  });

  it('sebelum batas H-12 member membatalkan sendiri, pengajuan ditolak', async () => {
    const { service, tx } = siapkan({ jamSebelumKelas: 30 });
    await expect(service.ajukan(member(), bookingId, { kodeAlasan: 'SAKIT' })).rejects.toMatchObject({
      code: 'SELF_CANCELLATION_AVAILABLE',
    });
    expect(tx.sessionAdjustRequest.create).not.toHaveBeenCalled();
  });

  it('pengajuan kedua saat yang pertama masih menunggu ditolak', async () => {
    const { service } = siapkan({ sudahMenunggu: true });
    await expect(service.ajukan(member(), bookingId, { kodeAlasan: 'KELUARGA' })).rejects.toMatchObject({
      code: 'LATE_CANCELLATION_ALREADY_PENDING',
    });
  });

  it('kelas yang sudah mulai tidak bisa diajukan', async () => {
    const { service } = siapkan({ jamSebelumKelas: -1 });
    await expect(service.ajukan(member(), bookingId, { kodeAlasan: 'SAKIT' })).rejects.toMatchObject({
      code: 'CLASS_ALREADY_STARTED',
    });
  });

  it('tanpa kapabilitas member ditolak sebelum menyentuh database', async () => {
    const { service, tx } = siapkan();
    const staf = { ...(member() as object), capabilities: ['booking:read'] } as never;
    await expect(service.ajukan(staf, bookingId, { kodeAlasan: 'SAKIT' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(tx.pemesananKelas.findFirst).not.toHaveBeenCalled();
  });

  it('alasan wajib dari pilihan, atau "Lainnya" dengan teks minimal 3 huruf', () => {
    expect(teksAlasanMember('PEKERJAAN', undefined)).toBe('Ada pekerjaan mendadak');
    expect(teksAlasanMember('LAINNYA', '  ban bocor ')).toBe('Lainnya: ban bocor');
    expect(() => teksAlasanMember('LAINNYA', 'ok')).toThrow();
    expect(() => teksAlasanMember(undefined, undefined)).toThrow();
  });

  it('status: menampilkan pengajuan terakhir dan menutup tombol saat masih menunggu', async () => {
    const { service, tx } = siapkan();
    tx.sessionAdjustRequest.findFirst.mockResolvedValueOnce({
      id: 'req-1',
      status: 'PENDING',
      createdAt: new Date('2026-11-22T01:00:00Z'),
    } as never);
    const db = (service as unknown as { db: typeof tx }).db;
    expect(db).toBeDefined();
    const status = await service.status(member(), bookingId);
    expect(status).toEqual({
      bisaMengajukan: false,
      pengajuan: { id: 'req-1', status: 'PENDING', diajukanPada: '2026-11-22T01:00:00.000Z' },
    });
  });
});
