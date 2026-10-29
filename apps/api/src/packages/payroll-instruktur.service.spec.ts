import { PolicyService } from '../identity/policy.service';
import { AKSI_KOREKSI_JAM } from './koreksi-jam.service';
import { PayrollInstrukturService } from './payroll-instruktur.service';

const instruktur = {
  sessionId: 's',
  userId: 'i-a',
  roles: [{ role: 'INSTRUCTOR', branchId: 'gg' }],
  capabilities: ['attendance:self', 'class:assigned:read'],
  branchIds: ['gg'],
} as never;

const slot = (id: string, start: string, hadir: boolean) => ({
  id,
  branchId: 'gg',
  classTypeId: 'ct-g',
  startAt: new Date(start),
  endAt: new Date(new Date(start).getTime() + 60 * 60_000),
  instructorFeeRp: null,
  isManualFee: false,
  classType: { name: 'Group' },
  branch: { name: 'Gading' },
  instructorAttendance: hadir ? { checkedInAt: new Date(start) } : null,
});

function setup() {
  const db = {
    slotKelas: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          slot('s1', '2026-10-20T02:00:00Z', true),
          slot('s2', '2026-10-21T02:00:00Z', false),
        ]),
    },
    instructorFee: {
      findMany: jest.fn().mockResolvedValue([
        {
          instructorId: 'i-a',
          branchId: 'gg',
          classTypeId: 'ct-g',
          effectiveDate: new Date('2026-01-01'),
          feePerJamRp: 200_000,
        },
      ]),
    },
    auditLog: {
      findMany: jest.fn().mockResolvedValue([
        {
          objectId: 'k1',
          reason: 'QR tidak terpindai',
          createdAt: new Date('2026-10-22T00:00:00Z'),
          detail: {
            after: { classStartAt: '2026-10-21T02:00:00.000Z', hours: 1, amountRp: 200_000 },
          },
        },
        {
          objectId: 'k-lama',
          reason: 'kelas bulan lalu',
          createdAt: new Date('2026-10-02T00:00:00Z'),
          detail: {
            after: { classStartAt: '2026-09-30T02:00:00.000Z', hours: 1, amountRp: 200_000 },
          },
        },
      ]),
    },
  };
  return { db, service: new PayrollInstrukturService(db as never, new PolicyService()) };
}

describe('PayrollInstrukturService.milikSaya', () => {
  it('menjumlahkan kelas terverifikasi dan koreksi bulan kelasnya saja', async () => {
    const { db, service } = setup();
    const hasil = await service.milikSaya(instruktur, { period: '2026-10' });

    expect(db.slotKelas.findMany.mock.calls[0][0].where).toMatchObject({
      instructorId: 'i-a',
      status: 'COMPLETED',
    });
    expect(db.auditLog.findMany.mock.calls[0][0].where).toMatchObject({
      action: AKSI_KOREKSI_JAM,
      targetUserId: 'i-a',
    });
    expect(hasil.terverifikasiRp).toBe(200_000);
    // Kelas tanpa check-in QR tidak diberi nominal sama sekali.
    expect(hasil.belumTerverifikasiRp).toBe(0);
    expect(hasil.kelas.find((k) => !k.terverifikasi)).toMatchObject({ honorRp: 0, tarifPerJamRp: 0 });
    expect(hasil.koreksi.map((k) => k.id)).toEqual(['k1']);
    expect(hasil.totalRp).toBe(400_000);
    expect(hasil.kelasTerverifikasi).toBe(1);
    expect(hasil.kelasBelumTerverifikasi).toBe(1);
    expect(hasil.kelas[0]).toMatchObject({ namaCabang: 'Gading', terverifikasi: true, jam: 1 });
  });

  it('menolak pengguna tanpa izin instruktur', async () => {
    const { service } = setup();
    await expect(
      service.milikSaya({ ...(instruktur as object), capabilities: ['customer:read'] } as never),
    ).rejects.toThrow();
  });
});
