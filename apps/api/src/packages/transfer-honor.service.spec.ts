import { writeFileSync } from 'node:fs';
import { PolicyService } from '../identity/policy.service';
import {
  KOLOM_MULTI_PAYROLL,
  periodeTransfer,
  remarkTransfer,
  TransferHonorService,
} from './transfer-honor.service';

const finance = {
  sessionId: 's',
  userId: 'fin-1',
  roles: [{ role: 'FINANCE', branchId: null }],
  capabilities: ['finance:read', 'finance:export'],
  branchIds: [],
} as never;

const jam = (iso: string, durasiJam = 1) => ({
  startAt: new Date(iso),
  endAt: new Date(new Date(iso).getTime() + durasiJam * 3_600_000),
});

function setup() {
  const db = {
    slotKelas: {
      findMany: jest.fn(async () => [
        // Anna: dua kelas terverifikasi, satu belum.
        {
          instructorId: 'anna',
          branchId: 'gg',
          classTypeId: 'grp',
          ...jam('2026-10-05T01:00:00Z'),
          instructorFeeRp: null,
          isManualFee: false,
          instructorAttendance: { id: 'a1' },
        },
        {
          instructorId: 'anna',
          branchId: 'gg',
          classTypeId: 'grp',
          ...jam('2026-10-06T01:00:00Z'),
          instructorFeeRp: null,
          isManualFee: false,
          instructorAttendance: { id: 'a2' },
        },
        {
          instructorId: 'anna',
          branchId: 'gg',
          classTypeId: 'grp',
          ...jam('2026-10-07T01:00:00Z'),
          instructorFeeRp: null,
          isManualFee: false,
          instructorAttendance: null,
        },
        // Budi: rekening Mandiri; nominal manual lama di jadwal diabaikan, tarif dari Data Master.
        {
          instructorId: 'budi',
          branchId: 'mk',
          classTypeId: 'pvt',
          ...jam('2026-10-08T01:00:00Z'),
          instructorFeeRp: 300_000,
          isManualFee: true,
          instructorAttendance: { id: 'b1' },
        },
        // Citra: berhonor tetapi belum ada rekening.
        {
          instructorId: 'citra',
          branchId: 'gg',
          classTypeId: 'grp',
          ...jam('2026-10-09T01:00:00Z'),
          instructorFeeRp: null,
          isManualFee: false,
          instructorAttendance: { id: 'c1' },
        },
      ]),
    },
    instructorFee: {
      findMany: jest.fn(async () => [
        {
          instructorId: 'anna',
          branchId: 'gg',
          classTypeId: 'grp',
          effectiveDate: new Date('2026-01-01'),
          feePerJamRp: 200_000,
        },
        {
          instructorId: 'citra',
          branchId: 'gg',
          classTypeId: 'grp',
          effectiveDate: new Date('2026-01-01'),
          feePerJamRp: 175_000,
        },
        {
          instructorId: 'budi',
          branchId: 'mk',
          classTypeId: 'pvt',
          effectiveDate: new Date('2026-01-01'),
          feePerJamRp: 300_000,
        },
      ]),
    },
    auditLog: {
      findMany: jest.fn(async () => [
        // Koreksi +1 jam untuk Anna pada kelas bulan ini, dan satu untuk kelas bulan lalu (diabaikan).
        {
          targetUserId: 'anna',
          detail: {
            after: {
              instructorId: 'anna',
              classStartAt: '2026-10-07T01:00:00.000Z',
              amountRp: 200_000,
            },
          },
        },
        {
          targetUserId: 'anna',
          detail: {
            after: {
              instructorId: 'anna',
              classStartAt: '2026-09-28T01:00:00.000Z',
              amountRp: 999_000,
            },
          },
        },
      ]),
      create: jest.fn(),
    },
    user: {
      findMany: jest.fn(async ({ where }: { where: { role?: string } }) =>
        where.role
          ? [
              { id: 'anna', displayName: 'Anna' },
              { id: 'budi', displayName: 'Budi' },
              { id: 'citra', displayName: 'Citra' },
              { id: 'dewi', displayName: 'Dewi' },
            ]
          : [],
      ),
      findUnique: jest.fn(async () => ({ id: 'dewi' })),
    },
    rekeningInstruktur: {
      findMany: jest.fn(async () => [
        {
          instructorId: 'anna',
          bankName: 'BCA',
          swiftCode: 'CENAIDJA',
          accountNumber: '0123456789',
          accountName: 'Anna Wijaya',
          email: null,
        },
        {
          instructorId: 'budi',
          bankName: 'Mandiri',
          swiftCode: 'BMRIIDJA',
          accountNumber: '1230004567890',
          accountName: 'Budi Santoso',
          email: 'budi@contoh.id',
        },
      ]),
      findUnique: jest.fn(async () => null),
      upsert: jest.fn(),
    },
    $transaction: jest.fn(async (fn: (t: unknown) => unknown): Promise<unknown> => fn(db)),
  };
  return { db, service: new TransferHonorService(db as never, new PolicyService()) };
}

describe('periodeTransfer', () => {
  it('tanggal 1 bulan ini sampai hari ini (WIB)', () => {
    expect(periodeTransfer(new Date('2026-10-29T03:00:00Z'))).toEqual({
      from: '2026-10-01',
      until: '2026-10-29',
    });
    // 30 Okt 23.30 UTC sudah 31 Okt di Jakarta.
    expect(periodeTransfer(new Date('2026-10-30T23:30:00Z')).until).toBe('2026-10-31');
  });

  it('pada tanggal 1, bulan lalu penuh', () => {
    expect(periodeTransfer(new Date('2026-11-01T02:00:00Z'))).toEqual({
      from: '2026-10-01',
      until: '2026-10-31',
    });
    expect(periodeTransfer(new Date('2027-01-01T02:00:00Z'))).toEqual({
      from: '2026-12-01',
      until: '2026-12-31',
    });
    expect(periodeTransfer(new Date('2028-03-01T02:00:00Z')).until).toBe('2028-02-29');
  });
});

describe('remarkTransfer', () => {
  it('paling banyak 18 karakter', () => {
    expect(remarkTransfer('2026-10-01', '2026-10-29')).toBe('Honor 1-29 Okt 26');
    expect(remarkTransfer('2026-10-01', '2026-11-15')).toBe('Honor 0110-151126');
    for (const r of [
      remarkTransfer('2026-12-01', '2026-12-31'),
      remarkTransfer('2026-10-01', '2026-11-15'),
    ])
      expect(r.length).toBeLessThanOrEqual(18);
  });
});

describe('TransferHonorService', () => {
  it('menjumlah honor terverifikasi + koreksi per instruktur; kelas tanpa presensi tidak dibayar', async () => {
    const { service } = setup();
    const r = await service.ringkasan(finance, {}, new Date('2026-10-29T03:00:00Z'));

    expect(r.from).toBe('2026-10-01');
    expect(r.until).toBe('2026-10-29');
    const anna = r.baris.find((b) => b.instructorId === 'anna')!;
    expect(anna).toMatchObject({
      terverifikasiRp: 400_000,
      koreksiRp: 200_000,
      totalRp: 600_000,
      kelasBelumTerverifikasi: 1,
      belumTerverifikasiRp: 200_000,
    });
    expect(r.baris.find((b) => b.instructorId === 'budi')!.totalRp).toBe(300_000);
    // Dewi belum berhonor tetapi tetap tampil supaya rekeningnya bisa diisi.
    expect(r.baris.find((b) => b.instructorId === 'dewi')).toMatchObject({
      totalRp: 0,
      rekening: null,
    });
    expect(r.jumlahSiap).toBe(2);
    expect(r.siapRp).toBe(900_000);
    expect(r.tanpaRekening).toBe(1);
  });

  it('menolak tanpa izin ekspor keuangan', async () => {
    const { service } = setup();
    const admin = { ...(finance as object), capabilities: ['expense:create'] } as never;
    await expect(service.ringkasan(admin)).rejects.toThrow();
  });

  it('berkas Excel memakai kolom template Multi Payroll dan hanya instruktur berekening', async () => {
    const { service, db } = setup();
    const now = new Date('2026-10-29T03:04:05Z');
    const hasil = await service.unduh(finance, {}, now);

    expect(hasil.fileName).toBe('honor-instruktur-2026-10-01-sd-2026-10-29.xlsx');
    expect(hasil.jumlahBaris).toBe(2);
    expect(hasil.totalRp).toBe(900_000);
    const berkas = Buffer.from(hasil.base64, 'base64');
    expect(berkas.subarray(0, 2).toString()).toBe('PK');
    if (process.env.SIMPAN_XLSX) writeFileSync(process.env.SIMPAN_XLSX, berkas);
    expect(KOLOM_MULTI_PAYROLL).toHaveLength(13);
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'finance.instructor_transfer_exported',
          detail: { jumlahBaris: 2, totalRp: 900_000, idAwal: 'HN261029100405001' },
        }),
      }),
    );
  });

  it('tidak membuat berkas bila belum ada yang bisa ditransfer', async () => {
    const { service, db } = setup();
    db.rekeningInstruktur.findMany.mockResolvedValueOnce([]);
    await expect(
      service.unduh(finance, {}, new Date('2026-10-29T03:00:00Z')),
    ).rejects.toMatchObject({
      code: 'NOTHING_TO_TRANSFER',
    });
  });

  it('menyimpan rekening dengan validasi BCA 10 digit dan mencatat audit tersamar', async () => {
    const { service, db } = setup();
    await expect(
      service.simpanRekening(finance, 'dewi', {
        bankName: 'BCA',
        swiftCode: 'CENAIDJA',
        accountNumber: '12345',
        accountName: 'Dewi',
      }),
    ).rejects.toMatchObject({ details: [{ field: 'accountNumber', issue: 'BCA_10_DIGIT' }] });

    const hasil = await service.simpanRekening(finance, 'dewi', {
      bankName: ' BCA ',
      swiftCode: 'cenaidja',
      accountNumber: '012-345-6789',
      accountName: 'Dewi  Lestari',
    });
    expect(hasil).toEqual({
      bankName: 'BCA',
      swiftCode: 'CENAIDJA',
      accountNumber: '0123456789',
      accountName: 'Dewi Lestari',
      email: null,
    });
    expect(db.rekeningInstruktur.upsert).toHaveBeenCalled();
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          detail: { before: null, after: { bankName: 'BCA', accountNumber: '****6789' } },
        }),
      }),
    );
  });
});
