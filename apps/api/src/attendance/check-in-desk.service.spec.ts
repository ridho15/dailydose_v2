import { PolicyService } from '../identity/policy.service';
import { AKSI_TETAP_JALAN, CheckInDeskService } from './check-in-desk.service';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cabangA = id(1);
const cabangB = id(2);

const principal = (capabilities: string[], branchIds: string[] = [cabangA]) => ({
  sessionId: 's',
  userId: id(100),
  roles: [{ role: 'ADMIN', branchId: cabangA }] as never,
  capabilities,
  branchIds,
});
const admin = principal(['attendance:manage']);

/** Rabu 28 Okt 2026, 08.50 WIB. */
const NOW = new Date('2026-10-28T01:50:00.000Z');
const wib = (jam: number, menit = 0) => new Date(Date.UTC(2026, 9, 28, jam - 7, menit));

const slot = (over: Record<string, unknown> = {}) => ({
  id: id(10),
  branchId: cabangA,
  startAt: wib(9),
  endAt: wib(9, 55),
  capacity: 8,
  minQuota: 3,
  status: 'PUBLISHED',
  version: 4,
  instructorId: id(50),
  classTypeId: id(60),
  classType: { name: 'Group Reformer' },
  studio: { name: 'Studio 2' },
  instructor: { displayName: 'Anna Wijaya' },
  bookings: [{ attendance: { id: 'a1' } }, { attendance: null }, { attendance: null }],
  instructorAttendance: null,
  ...over,
});

function setup(opts: { slots?: unknown[]; satu?: unknown; keputusan?: unknown[] } = {}) {
  const db = {
    cabang: {
      findUnique: jest.fn().mockResolvedValue({ name: 'Green Garden', timezone: 'Asia/Jakarta' }),
    },
    slotKelas: {
      findMany: jest.fn().mockResolvedValue(opts.slots ?? [slot()]),
      findUnique: jest.fn().mockResolvedValue(opts.satu === undefined ? slot() : opts.satu),
    },
    auditLog: { findMany: jest.fn().mockResolvedValue(opts.keputusan ?? []) },
    user: { findMany: jest.fn().mockResolvedValue([{ id: id(100), displayName: 'Rina' }]) },
    kehadiranPelanggan: { findMany: jest.fn().mockResolvedValue([]) },
    // Honor dari Data Master: 300.000 per jam untuk instruktur, cabang, dan tipe kelas ini.
    instructorFee: {
      findMany: jest.fn().mockResolvedValue([
        {
          instructorId: id(50),
          branchId: cabangA,
          classTypeId: id(60),
          effectiveDate: new Date('2026-01-01'),
          feePerJamRp: 300_000,
        },
      ]),
    },
  };
  const audit = { catat: jest.fn().mockResolvedValue(undefined) };
  return {
    service: new CheckInDeskService(db as never, new PolicyService(), audit as never),
    db,
    audit,
  };
}

describe('CheckInDeskService.meja', () => {
  it('membatasi kelas pada hari ini menurut jam dinding cabang', async () => {
    const { service, db } = setup();

    const hasil = await service.meja(admin, { branchId: cabangA }, NOW);

    const where = db.slotKelas.findMany.mock.calls[0]![0].where;
    expect(where.branchId).toBe(cabangA);
    expect(where.startAt.gte.toISOString()).toBe('2026-10-27T17:00:00.000Z');
    expect(where.startAt.lt.toISOString()).toBe('2026-10-28T17:00:00.000Z');
    expect(hasil.tanggal).toBe('2026-10-28');
  });

  it('menghitung terdaftar dan hadir dari booking kelas itu', async () => {
    const { service } = setup();

    const [kelas] = (await service.meja(admin, { branchId: cabangA }, NOW)).kelas;

    expect(kelas!.terdaftar).toBe(3);
    expect(kelas!.hadir).toBe(1);
    expect(kelas!.kuota.status).toBe('KURANG');
    expect(kelas!.kuota.kurang).toBe(2);
  });

  it('menandai kelas yang sudah lewat tetapi belum ditutup', async () => {
    const { service } = setup({
      slots: [
        slot({ startAt: wib(7), endAt: wib(7, 55) }),
        slot({ id: id(11), status: 'COMPLETED', startAt: wib(6), endAt: wib(6, 55) }),
      ],
    });

    const { kelas } = await service.meja(admin, { branchId: cabangA }, NOW);

    expect(kelas.find((k) => k.id === id(10))!.perluDitutup).toBe(true);
    expect(kelas.find((k) => k.id === id(11))!.perluDitutup).toBe(false);
  });

  it('menyertakan keputusan tetap jalan yang sudah diambil beserta nama pengambilnya', async () => {
    const { service } = setup({
      keputusan: [
        {
          objectId: id(10),
          actorId: id(100),
          createdAt: wib(8, 40),
          reason: 'Peserta sudah datang',
        },
      ],
    });

    const [kelas] = (await service.meja(admin, { branchId: cabangA }, NOW)).kelas;

    expect(kelas!.keputusan).toEqual({
      oleh: 'Rina',
      pada: wib(8, 40).toISOString(),
      alasan: 'Peserta sudah datang',
    });
  });

  it('menolak cabang di luar penugasan staf', async () => {
    const { service } = setup();

    await expect(service.meja(admin, { branchId: cabangB }, NOW)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('mewajibkan cabang dipilih', async () => {
    const { service } = setup();

    await expect(service.meja(admin, {}, NOW)).rejects.toMatchObject({ status: 422 });
  });

  it('menolak tanpa izin mengelola kehadiran', async () => {
    const { service } = setup();

    await expect(
      service.meja(principal(['attendance:read']), { branchId: cabangA }, NOW),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('CheckInDeskService.tetapJalan', () => {
  it('mencatat selisih beban per kursi kosong di audit, tanpa nominal ke meja check-in', async () => {
    const { service, audit } = setup();

    const hasil = await service.tetapJalan(
      admin,
      id(10),
      { reason: 'Dua peserta sudah di studio' },
      NOW,
    );

    // Admin tidak menerima nominal honor.
    expect(hasil).not.toHaveProperty('selisihBebanRp');
    // Honor 300.000 (Data Master) dibagi minimum 3, kurang 2 kursi.
    expect(audit.catat).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        action: AKSI_TETAP_JALAN,
        objectType: 'ClassSlot',
        objectId: id(10),
        branchId: cabangA,
        reason: 'Dua peserta sudah di studio',
        afterMasked: expect.objectContaining({ hadir: 1, minimum: 3, selisihBebanRp: 200_000 }),
      }),
    );
  });

  it('meminta alasan yang cukup jelas', async () => {
    const { service, audit } = setup();

    await expect(service.tetapJalan(admin, id(10), { reason: 'ok' }, NOW)).rejects.toMatchObject({
      status: 422,
    });
    expect(audit.catat).not.toHaveBeenCalled();
  });

  it('menolak bila kuota sudah terpenuhi', async () => {
    const { service } = setup({
      satu: slot({
        bookings: [
          { attendance: { id: 'a' } },
          { attendance: { id: 'b' } },
          { attendance: { id: 'c' } },
        ],
      }),
    });

    await expect(
      service.tetapJalan(admin, id(10), { reason: 'Tetap jalan saja' }, NOW),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('menolak setelah batas keputusan lewat, karena kelas sudah berjalan dengan sendirinya', async () => {
    const { service } = setup();

    await expect(
      service.tetapJalan(admin, id(10), { reason: 'Tetap jalan saja' }, wib(8, 58)),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('menolak kelas di cabang lain', async () => {
    const { service } = setup({ satu: slot({ branchId: cabangB }) });

    await expect(
      service.tetapJalan(admin, id(10), { reason: 'Tetap jalan saja' }, NOW),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('menyebut honor yang belum diketahui alih-alih menulis beban nol seolah pasti', async () => {
    const { service, audit } = setup({ satu: slot({ classTypeId: id(61) }) });

    await service.tetapJalan(admin, id(10), { reason: 'Dua peserta sudah di studio' }, NOW);

    expect(audit.catat.mock.calls[0]![1].afterMasked).toMatchObject({ honorDiketahui: false });
  });
});

describe('CheckInDeskService.fotoMember', () => {
  function setupFoto(
    opts: { punyaKelas?: boolean; selfie?: string | null; storage?: boolean } = {},
  ) {
    const db = {
      cabang: { findUnique: jest.fn().mockResolvedValue({ timezone: 'Asia/Jakarta' }) },
      pemesananKelas: {
        findFirst: jest.fn().mockResolvedValue(opts.punyaKelas === false ? null : { id: 'b' }),
      },
      profilPengguna: {
        findUnique: jest
          .fn()
          .mockResolvedValue({
            selfieUrl:
              opts.selfie === undefined ? 'identity-documents/u/selfie-1.png' : opts.selfie,
          }),
      },
    };
    const storage = { read: jest.fn().mockResolvedValue('ALIRAN') };
    const service = new CheckInDeskService(
      db as never,
      new PolicyService(),
      undefined,
      opts.storage === false ? undefined : (storage as never),
    );
    return { service, db, storage };
  }

  it('memberi foto member yang punya kelas di cabang ini hari ini', async () => {
    const { service, db, storage } = setupFoto();

    const hasil = await service.fotoMember(admin, { userId: id(50), branchId: cabangA }, NOW);

    expect(hasil).toEqual({ mimeType: 'image/png', stream: 'ALIRAN' });
    expect(storage.read).toHaveBeenCalledWith('identity-documents/u/selfie-1.png');
    const where = db.pemesananKelas.findFirst.mock.calls[0]![0].where;
    expect(where.classSlot.branchId).toBe(cabangA);
    expect(where.classSlot.startAt.gte.toISOString()).toBe('2026-10-27T17:00:00.000Z');
  });

  it('tidak bisa dipakai menjelajah foto member yang tidak punya kelas hari ini', async () => {
    const { service, storage } = setupFoto({ punyaKelas: false });

    await expect(
      service.fotoMember(admin, { userId: id(50), branchId: cabangA }, NOW),
    ).rejects.toMatchObject({ status: 404 });
    expect(storage.read).not.toHaveBeenCalled();
  });

  it('menolak cabang di luar penugasan', async () => {
    const { service } = setupFoto();

    await expect(
      service.fotoMember(admin, { userId: id(50), branchId: cabangB }, NOW),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('menjawab tidak ada bila member belum mengunggah selfie', async () => {
    const { service } = setupFoto({ selfie: null });

    await expect(
      service.fotoMember(admin, { userId: id(50), branchId: cabangA }, NOW),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('menyajikan alamat terlindungi di daftar, bukan kunci berkas privat', async () => {
    const { service } = setup();
    const db = (service as unknown as { db: { kehadiranPelanggan: { findMany: jest.Mock } } }).db;
    db.kehadiranPelanggan.findMany.mockResolvedValue([
      {
        id: 'k1',
        checkedInAt: wib(8, 50),
        method: 'QR_SCAN',
        recordedBy: null,
        booking: {
          userId: id(50),
          user: {
            displayName: 'Sari',
            profile: { selfieUrl: 'identity-documents/u/selfie-1.png' },
          },
          classSlot: {
            startAt: wib(9),
            endAt: wib(9, 55),
            classType: { name: 'Group' },
            studio: null,
          },
        },
      },
    ]);

    const { tercatat } = await service.meja(admin, { branchId: cabangA }, NOW);

    expect(tercatat[0]!.fotoUrl).toBe(
      `/api/v1/attendance/desk/members/${id(50)}/photo?branchId=${cabangA}`,
    );
    expect(JSON.stringify(tercatat)).not.toContain('identity-documents');
  });
});
