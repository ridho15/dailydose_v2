import { PolicyService } from '../identity/policy.service';
import {
  HREF_KOTAK_MASUK_PEMBATALAN,
  kirimNotifikasiPengajuanPembatalan,
} from './pembatalan-terlambat';
import { PembatalanTerlambatService } from './pembatalan-terlambat.service';
// Pembersihan pengajuan usang diuji di tutup-pembatalan-usang.spec.ts; di sini kueri daftarnya.
jest.mock('./tutup-pembatalan-usang', () => ({ tutupPembatalanUsang: jest.fn(async () => 0) }));


const GG = '00000000-0000-4000-8000-0000000000a1';
const MK = '00000000-0000-4000-8000-0000000000a2';

const manager = {
  sessionId: 's',
  userId: 'mgr-1',
  roles: [{ role: 'MANAGER', branchId: GG }],
  capabilities: ['booking:late-cancel:decide', 'ledger:adjust:decide', 'booking:read'],
  branchIds: [GG],
} as never;
const owner = {
  sessionId: 's',
  userId: 'own-1',
  roles: [{ role: 'OWNER', branchId: MK }],
  capabilities: ['booking:late-cancel:decide', 'booking:read'],
  branchIds: [MK],
} as never;
const admin = {
  sessionId: 's',
  userId: 'adm-1',
  roles: [{ role: 'ADMIN', branchId: GG }],
  capabilities: ['booking:cancel:assisted', 'booking:read'],
  branchIds: [GG],
} as never;

const baris = (id: string, requestedById: string, createdAt: string) => ({
  id,
  version: 1,
  bookingId: `b-${id}`,
  sessionCount: 0,
  reason: 'Member sakit mendadak pagi ini',
  requestedById,
  createdAt: new Date(createdAt),
  requestedBy: { displayName: 'Pengaju' },
  booking: {
    user: { displayName: 'Rina' },
    classSlot: {
      branchId: GG,
      startAt: new Date('2026-11-22T10:00:00Z'),
      branch: { name: 'Gading' },
      classType: { name: 'Reformer' },
    },
  },
});

function setup(rows = [baris('r-1', 'adm-1', '2026-11-22T01:00:00Z')]) {
  const db = { sessionAdjustRequest: { findMany: jest.fn(async () => rows) } };
  return { db, service: new PembatalanTerlambatService(db as never, new PolicyService()) };
}

describe('Pengajuan pembatalan kurang dari H-12 tanpa classSlotId (kotak masuk penyetuju)', () => {
  it('dibatasi ke cabang penyetuju, tanpa perlu tahu kelasnya', async () => {
    const { db, service } = setup();
    const hasil = await service.tertunda(manager, '', {});
    const where = (db.sessionAdjustRequest.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0]
      .where;
    expect(where).toMatchObject({
      reasonCode: 'LATE_CANCELLATION',
      status: 'PENDING',
      booking: { is: { classSlot: { branchId: { in: [GG] } } } },
    });
    expect(hasil.items[0]).toMatchObject({
      id: 'r-1',
      customerName: 'Rina',
      className: 'Reformer',
      branchName: 'Gading',
      canDecide: true,
    });
    expect(hasil.nextCursor).toBeNull();
  });

  it('Owner cabang melihat cabang miliknya; pengajuan miliknya sendiri ditandai tidak bisa diputus', async () => {
    const { db, service } = setup([baris('r-2', 'own-1', '2026-11-22T01:00:00Z')]);
    const hasil = await service.tertunda(owner, '', {});
    const where = (db.sessionAdjustRequest.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0]
      .where;
    expect(where.booking).toEqual({ is: { classSlot: { branchId: { in: [MK] } } } });
    expect(hasil.items[0]!.canDecide).toBe(false);
  });

  it('admin tanpa izin memutus ditolak, dan cabang di luar cakupan ditolak', async () => {
    const { service } = setup();
    await expect(service.tertunda(admin, '', {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.tertunda(manager, '', { branchId: MK })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('berhalaman kursor: nextCursor bila ada baris lebih, dan kursor dipakai di permintaan berikut', async () => {
    const { db, service } = setup([
      baris('r-1', 'adm-1', '2026-11-22T01:00:00Z'),
      baris('r-2', 'adm-1', '2026-11-22T02:00:00Z'),
    ]);
    const pertama = await service.tertunda(manager, '', { limit: 1 });
    expect(pertama.items.map((i) => i.id)).toEqual(['r-1']);
    expect(pertama.nextCursor).not.toBeNull();
    await service.tertunda(manager, '', { limit: 1, cursor: pertama.nextCursor! });
    const where = (db.sessionAdjustRequest.findMany.mock.calls[1] as unknown as [{ where: Record<string, unknown> }])[0]
      .where;
    expect(where.OR).toEqual([
      { createdAt: { gt: new Date('2026-11-22T01:00:00Z') } },
      { createdAt: new Date('2026-11-22T01:00:00Z'), id: { gt: 'r-1' } },
    ]);
    await expect(service.tertunda(manager, '', { cursor: 'rusak' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});

describe('Notifikasi pengajuan pembatalan', () => {
  it('dikirim ke Manager cabang, Owner pemilik cabang, dan Super Owner, dengan tautan ke kotak masuk', async () => {
    const writer = { writeForUser: jest.fn(async () => undefined) };
    const db = {
      pemesananKelas: {
        findUnique: jest.fn(async () => ({
          bookingNumber: 'BKG-1',
          user: { displayName: 'Rina' },
          classSlot: { branchId: GG },
        })),
      },
      user: { findMany: jest.fn(async () => [{ id: 'mgr-1' }, { id: 'own-1' }, { id: 'so-1' }]) },
    };
    await kirimNotifikasiPengajuanPembatalan(writer, db as never, {
      pengajuanId: 'r-1',
      bookingId: 'b-1',
    });
    const filter = (db.user.findMany.mock.calls[0] as unknown as [{ where: { OR: unknown[] } }])[0].where.OR;
    expect(filter).toEqual([
      { role: 'MANAGER', preferredBranchId: GG },
      { role: 'OWNER', ownedBranches: { some: { branchId: GG } } },
      { role: { in: ['SUPER_OWNER', 'SUPERADMIN'] } },
    ]);
    expect(writer.writeForUser).toHaveBeenCalledTimes(3);
    expect(writer.writeForUser).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        userId: 'own-1',
        eventKey: 'late_cancel.requested:r-1',
        href: HREF_KOTAK_MASUK_PEMBATALAN,
      }),
    );
  });

  it('kegagalan membaca penerima tidak menggagalkan pengajuan', async () => {
    const writer = { writeForUser: jest.fn() };
    const db = { pemesananKelas: { findUnique: jest.fn(async () => { throw new Error('putus'); }) } };
    await expect(
      kirimNotifikasiPengajuanPembatalan(writer, db as never, { pengajuanId: 'r', bookingId: 'b' }),
    ).resolves.toBeUndefined();
  });
});

describe('filter daftar pengajuan (tanggal kelas WIB, jenis alasan, teks)', () => {
  it('menerjemahkan filter ke kueri: tanggal kelas WIB inklusif, izin medis, dan cari alasan/nama', async () => {
    const { db, service } = setup();
    await service.tertunda(manager, '', { dari: '2026-11-05', sampai: '2026-11-19', jenis: 'medis', q: 'noriko' });
    const where = (db.sessionAdjustRequest.findMany.mock.lastCall as unknown as [{ where: any }])[0].where;
    expect(where.booking.is.classSlot.startAt).toEqual({
      gte: new Date('2026-11-04T17:00:00.000Z'),
      lte: new Date('2026-11-19T16:59:59.000Z'),
    });
    expect(where.reason).toEqual({ startsWith: '[IZIN MEDIS]' });
    const cari = JSON.stringify(where.AND);
    expect(cari).toContain('Noriko');
    expect(cari).toContain('displayName');
  });

  it('jenis biasa mengecualikan izin medis; tanggal atau jenis tidak sah ditolak 422', async () => {
    const { db, service } = setup();
    await service.tertunda(manager, '', { jenis: 'biasa' });
    const where = (db.sessionAdjustRequest.findMany.mock.lastCall as unknown as [{ where: any }])[0].where;
    expect(where.NOT).toEqual({ reason: { startsWith: '[IZIN MEDIS]' } });
    await expect(service.tertunda(manager, '', { dari: '2026-13-40' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(service.tertunda(manager, '', { jenis: 'apa' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
