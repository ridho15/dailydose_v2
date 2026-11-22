import { PolicyService } from '../identity/policy.service';
import type { NotificationWriterService } from '../notifications/notification-writer.service';
import { ReschedulesService } from './ubah-jadwal.service';

/**
 * Keputusan pemilik 22 November 2026: pengajuan ganti jadwal member yang masuk sebelum batas H-12
 * langsung disetujui bila kelas tujuan masih ada tempat. Setelah batas, member tetap ditolak.
 */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const branchId = id(1);
const sourceSlotId = id(20);
const targetSlotId = id(21);
const bookingId = id(10);
const customerUserId = id(300);
const JAM = 3_600_000;

const customer = {
  sessionId: 'cust-sess',
  userId: customerUserId,
  roles: [{ role: 'CUSTOMER' as const, branchId: null }],
  capabilities: ['reschedule:self:read', 'reschedule:self:request'],
  branchIds: [] as string[],
};

const config = {
  value: {
    booking: { enabled: true, cutoffHours: 2 },
    reschedule: { enabled: true, cutoffHours: 12 },
  },
} as never;

function siapkan({ jamSebelumKelas, terisiTujuan = 2, kapasitas = 8 }: { jamSebelumKelas: number; terisiTujuan?: number; kapasitas?: number }) {
  const mulaiAsal = new Date(Date.now() + jamSebelumKelas * JAM);
  const mulaiTujuan = new Date(Date.now() + 72 * JAM);
  const tx = {
    $queryRaw: jest.fn(async () => []),
    pemesananKelas: {
      findUnique: jest.fn(async () => ({
        id: bookingId,
        userId: customerUserId,
        status: 'BOOKED',
        classSlotId: sourceSlotId,
        classSlot: { id: sourceSlotId, branchId, startAt: mulaiAsal, endAt: new Date(mulaiAsal.getTime() + JAM) },
        customerPackage: {
          validUntil: new Date(Date.now() + 30 * 86_400_000),
          package: { classTypeId: 'ct-1', isMultiBranch: true },
        },
        user: { id: customerUserId, displayName: 'Bu Ratna' },
      })),
      findFirst: jest.fn(async () => null),
      count: jest.fn(async () => terisiTujuan),
      update: jest.fn(async () => ({})),
    },
    slotKelas: {
      findUnique: jest.fn(async () => ({
        id: targetSlotId,
        branchId,
        classTypeId: 'ct-1',
        status: 'PUBLISHED',
        startAt: mulaiTujuan,
        endAt: new Date(mulaiTujuan.getTime() + JAM),
        capacity: kapasitas,
        bookedCount: terisiTujuan,
        _count: { bookings: terisiTujuan },
        classType: { name: 'Reformer' },
        branch: { name: 'Studio Senopati', timezone: 'Asia/Jakarta' },
      })),
      update: jest.fn(async () => ({})),
    },
    ubahJadwal: {
      create: jest.fn(async ({ data }: any) => ({
        ...data,
        requestedAt: new Date(),
        targetSlot: { classType: { name: 'Reformer' }, branch: { timezone: 'Asia/Jakarta' } },
        sourceSlot: {},
        booking: {},
      })),
    },
  };
  const audit = { catat: jest.fn(async () => undefined) };
  const notificationWriter: Partial<NotificationWriterService> = {
    writeForUser: jest.fn(async () => undefined),
    writeForUsersInBranch: jest.fn(async () => undefined),
  };
  const service = new ReschedulesService(
    {} as never,
    { execute: jest.fn(async (_c: unknown, action: (t: typeof tx) => Promise<unknown>) => action(tx)) } as never,
    new PolicyService(),
    config,
    audit as never,
    notificationWriter as NotificationWriterService,
  );
  const ajukan = () =>
    service.request(
      customer,
      { bookingId, targetClassSlotId: targetSlotId, reasonCode: 'PERSONAL_UNAVAILABLE' },
      'idem-1',
      'corr-1',
    );
  return { tx, audit, notificationWriter, ajukan };
}

describe('Ganti jadwal member: otomatis disetujui sebelum H-12', () => {
  it('memindahkan booking langsung, mencatat APPROVED dan audit, tanpa antrean admin', async () => {
    const { tx, audit, notificationWriter, ajukan } = siapkan({ jamSebelumKelas: 48 });
    const hasil = await ajukan();

    expect(hasil.status).toBe(201);
    expect((hasil.body as any).status).toBe('APPROVED');
    expect(tx.pemesananKelas.update).toHaveBeenCalledWith({
      where: { id: bookingId },
      data: { classSlotId: targetSlotId },
    });
    expect(tx.slotKelas.update).toHaveBeenCalledWith({
      where: { id: sourceSlotId },
      data: { bookedCount: { decrement: 1 } },
    });
    expect(tx.slotKelas.update).toHaveBeenCalledWith({ where: { id: targetSlotId }, data: { bookedCount: 3 } });
    expect((tx.ubahJadwal.create.mock.calls as any)[0][0].data.status).toBe('APPROVED');
    expect(audit.catat).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: 'reschedule.auto_approved', objectType: 'Reschedule' }),
    );
    // Tidak ada yang perlu diputus staf; member diberi tahu jadwal barunya.
    expect(notificationWriter.writeForUsersInBranch).not.toHaveBeenCalled();
    expect(notificationWriter.writeForUser).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ userId: customerUserId, tone: 'SUCCESS', title: 'Jadwal sudah dipindah' }),
    );
    // Kedua slot dikunci sebelum kursi dihitung.
    expect(tx.$queryRaw).toHaveBeenCalled();
  });

  it('kurang dari H-12 tetap ditolak dan tidak membuat permintaan apa pun', async () => {
    const { tx, ajukan } = siapkan({ jamSebelumKelas: 11 });
    await expect(ajukan()).rejects.toMatchObject({ code: 'RESCHEDULE_CUTOFF_PASSED' });
    expect(tx.ubahJadwal.create).not.toHaveBeenCalled();
    expect(tx.pemesananKelas.update).not.toHaveBeenCalled();
  });

  it('kelas tujuan penuh saat dihitung ulang: ditolak, booking tetap di jadwal semula', async () => {
    const { tx, ajukan } = siapkan({ jamSebelumKelas: 48, terisiTujuan: 7, kapasitas: 8 });
    tx.pemesananKelas.count.mockResolvedValue(8);
    await expect(ajukan()).rejects.toMatchObject({ code: 'CLASS_CAPACITY_FULL' });
    expect(tx.pemesananKelas.update).not.toHaveBeenCalled();
    expect(tx.ubahJadwal.create).not.toHaveBeenCalled();
  });
});
