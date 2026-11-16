import { PolicyService } from '../identity/policy.service';
import { catatModalPaket, hitungModalSesi, ModalSesiService, tarifUntuk } from './modal-sesi.service';

const tarif = (
  id: string,
  branchId: string,
  classTypeId: string | null,
  modalPerSesiRp: number,
  mulai: string,
) => ({
  id,
  branchId,
  classTypeId,
  modalPerSesiRp,
  effectiveDate: new Date(`${mulai}T00:00:00Z`),
  createdAt: new Date(`${mulai}T00:00:00Z`),
});

const superOwner = {
  sessionId: 's',
  userId: 'so',
  roles: [{ role: 'SUPER_OWNER', branchId: null }],
  capabilities: ['master:read', 'master:manage', 'branch:all'],
  branchIds: [],
} as never;
const admin = {
  sessionId: 's',
  userId: 'adm',
  roles: [{ role: 'ADMIN', branchId: 'untar' }],
  capabilities: ['class-slot:manage'],
  branchIds: ['untar'],
} as never;

describe('tarifUntuk', () => {
  const daftar = [
    tarif('a', 'untar', 'grp', 45_000, '2026-01-01'),
    tarif('b', 'untar', 'grp', 50_000, '2026-10-01'),
    tarif('c', 'untar', null, 70_000, '2026-01-01'),
  ];
  it('memakai versi terbaru yang sudah berlaku pada tanggal lunas', () => {
    expect(
      tarifUntuk(daftar, { branchId: 'untar', classTypeId: 'grp', pada: new Date('2026-09-15') })
        ?.modalPerSesiRp,
    ).toBe(45_000);
    expect(
      tarifUntuk(daftar, { branchId: 'untar', classTypeId: 'grp', pada: new Date('2026-10-20') })
        ?.modalPerSesiRp,
    ).toBe(50_000);
  });
  it('membandingkan tanggal WIB: kelas 06:00 WIB pada tanggal berlaku sudah memakai tarif baru', () => {
    // 06:00 WIB 1 Oktober = 23:00 UTC 30 September.
    expect(
      tarifUntuk(daftar, {
        branchId: 'untar',
        classTypeId: 'grp',
        pada: new Date('2026-09-30T23:00:00Z'),
      })?.modalPerSesiRp,
    ).toBe(50_000);
  });
  it('tipe kelas tanpa tarif khusus memakai tarif semua tipe kelas cabang itu', () => {
    expect(
      tarifUntuk(daftar, { branchId: 'untar', classTypeId: 'pvt', pada: new Date('2026-10-20') })
        ?.modalPerSesiRp,
    ).toBe(70_000);
    expect(
      tarifUntuk(daftar, { branchId: 'pik', classTypeId: 'grp', pada: new Date('2026-10-20') }),
    ).toBeNull();
  });
});

describe('hitungModalSesi (mengikuti pemakaian sesi)', () => {
  const sesi = (branchId: string, classTypeId: string, tanggal: string) => ({
    classSlot: { branchId, classTypeId, startAt: new Date(`${tanggal}T02:00:00Z`) },
  });
  const rentang = {
    branchIds: null,
    fromDate: new Date('2026-10-01T00:00:00Z'),
    untilExclusive: new Date('2026-11-01T00:00:00Z'),
  };

  it('contoh pemilik: 20 sesi Group Untar terpakai x Rp50.000 = Rp1 juta', async () => {
    const db = {
      pemesananKelas: {
        findMany: jest.fn(async () =>
          Array.from({ length: 20 }, () => sesi('untar', 'grp', '2026-10-10')),
        ),
      },
      modalSesi: {
        findMany: jest.fn(async () => [tarif('b', 'untar', 'grp', 50_000, '2026-01-01')]),
      },
    };
    const hasil = await hitungModalSesi(db as never, rentang);
    expect(hasil.totalRp).toBe(1_000_000);
    expect(4_000_000 - hasil.totalRp).toBe(3_000_000);
    expect(hasil.sesiTerpakai).toBe(20);
    expect(hasil.perHari.get('2026-10-10')).toBe(1_000_000);
  });

  it('hanya sesi hadir/tidak hadir di kelas selesai dalam rentang yang dihitung', async () => {
    const db = {
      pemesananKelas: { findMany: jest.fn(async () => []) },
      modalSesi: { findMany: jest.fn(async () => []) },
    };
    await hitungModalSesi(db as never, { ...rentang, branchIds: ['untar'] });
    expect(db.pemesananKelas.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: { in: ['ATTENDED', 'NO_SHOW'] },
          classSlot: {
            status: 'COMPLETED',
            startAt: { gte: rentang.fromDate, lt: rentang.untilExclusive },
            branchId: { in: ['untar'] },
          },
        },
      }),
    );
  });

  it('memakai tarif yang berlaku pada tanggal kelas; sesi tanpa tarif dihitung Rp0', async () => {
    const db = {
      pemesananKelas: {
        findMany: jest.fn(async () => [
          sesi('untar', 'grp', '2026-10-05'),
          sesi('untar', 'grp', '2026-10-20'),
          sesi('pik', 'grp', '2026-10-20'),
        ]),
      },
      modalSesi: {
        findMany: jest.fn(async () => [
          tarif('a', 'untar', 'grp', 45_000, '2026-01-01'),
          tarif('b', 'untar', 'grp', 50_000, '2026-10-15'),
        ]),
      },
    };
    const hasil = await hitungModalSesi(db as never, rentang);
    expect(hasil.totalRp).toBe(95_000);
    expect(hasil).toMatchObject({ sesiTerpakai: 3, sesiTanpaModal: 1, metode: 'PEMAKAIAN' });
    expect(hasil.sesiTanpaModalPerCabang.get('pik')).toBe(1);
    expect(hasil.sesiTerpakaiPerCabang.get('untar')).toBe(2);
  });
});

describe('hitungModalSesi (paket terjual, mulai November 2026)', () => {
  const nov = {
    branchIds: null,
    fromDate: new Date('2026-11-01T00:00:00Z'),
    untilExclusive: new Date('2026-12-01T00:00:00Z'),
  };
  const beli = (
    id: string,
    branchId: string,
    sesi: number,
    paidAt: string,
    status = 'PAID',
    classTypeId: string | null = 'grp',
  ) => ({
    id,
    branchId,
    status,
    paidAt: new Date(paidAt),
    package: { sessionCount: sesi, classTypeId },
    customerPackage: { totalSessions: sesi },
  });
  const dbDengan = (o: {
    pembelian?: ReturnType<typeof beli>[];
    sumberLain?: ReturnType<typeof beli>[];
    koreksi?: { purchaseId: string; branchId: string; createdAt: Date }[];
    refund?: { purchaseId: string; branchId: string; sisaSesi: number; createdAt: Date }[];
    snapshot?: Record<string, unknown>[];
    tarif?: ReturnType<typeof tarif>[];
  }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = {
      pemesananKelas: { findMany: jest.fn(async () => []) },
      pembelian: {
        findMany: jest.fn(async ({ where }: { where: { id?: unknown } }) =>
          where.id ? (o.sumberLain ?? []) : (o.pembelian ?? []),
        ),
      },
      pembelianKoreksi: {
        findMany: jest.fn(async ({ where }: { where: { purchaseId?: { in: string[] } } }) =>
          where.purchaseId
            ? (o.koreksi ?? []).filter((k) => where.purchaseId!.in.includes(k.purchaseId))
            : (o.koreksi ?? []),
        ),
      },
      refundPaket: {
        findMany: jest.fn(async ({ where }: { where: { purchaseId?: { in?: string[] } } }) =>
          where.purchaseId?.in
            ? (o.refund ?? []).filter((r) => where.purchaseId!.in!.includes(r.purchaseId))
            : (o.refund ?? []),
        ),
      },
      modalPaketTerjual: {
        findMany: jest.fn(async () => o.snapshot ?? []),
        createMany: jest.fn(async () => ({ count: 0 })),
      },
      modalSesi: {
        findMany: jest.fn(async () => o.tarif ?? [tarif('t80', 'untar', 'grp', 80_000, '2026-01-01')]),
      },
    };
    return db;
  };

  it('contoh pemilik: paket 20 sesi Rp4.000.000, modal Rp80.000/sesi → modal Rp1.600.000, laba Rp2.400.000', async () => {
    const db = dbDengan({ pembelian: [beli('p1', 'untar', 20, '2026-11-05T03:00:00Z')] });
    const hasil = await hitungModalSesi(db as never, nov);
    expect(hasil).toMatchObject({
      metode: 'PAKET_TERJUAL',
      totalRp: 1_600_000,
      sesiTerjual: 20,
      modalTerjualRp: 1_600_000,
      modalBalikRp: 0,
      sesiTerpakai: 0,
    });
    expect(4_000_000 - hasil.totalRp).toBe(2_400_000);
    expect(hasil.perHari.get('2026-11-05')).toBe(1_600_000);
    // Sesi terpakai tidak dibaca untuk bulan aturan baru.
    expect(db.pemesananKelas.findMany).not.toHaveBeenCalled();
    // Snapshot dibekukan di tabel baru.
    expect(db.modalPaketTerjual.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          purchaseId: 'p1',
          sesi: 20,
          modalPerSesiRp: 80_000,
          modalTotalRp: 1_600_000,
          modalSesiId: 't80',
        }),
      ],
      skipDuplicates: true,
    });
  });

  it('modal per sesi yang diubah setelah paket lunas tidak mengubah laba paket itu', async () => {
    const db = dbDengan({
      pembelian: [beli('p1', 'untar', 20, '2026-11-05T03:00:00Z')],
      snapshot: [
        {
          purchaseId: 'p1',
          branchId: 'untar',
          classTypeId: 'grp',
          sesi: 20,
          modalPerSesiRp: 80_000,
          modalTotalRp: 1_600_000,
          modalSesiId: 't80',
          paidAt: new Date('2026-11-05T03:00:00Z'),
        },
      ],
      // Tarif baru Rp100.000 dengan tanggal berlaku mundur sebelum tanggal lunas.
      tarif: [tarif('t100', 'untar', 'grp', 100_000, '2026-10-01')],
    });
    const hasil = await hitungModalSesi(db as never, nov);
    expect(hasil.totalRp).toBe(1_600_000);
    expect(db.modalPaketTerjual.createMany).not.toHaveBeenCalled();
  });

  it('VOID setelah lunas: modal tetap di bulan lunas, dibalik penuh di bulan pembatalan', async () => {
    const p = beli('p1', 'untar', 20, '2026-11-05T03:00:00Z', 'CANCELLED');
    const koreksi = [{ purchaseId: 'p1', branchId: 'untar', createdAt: new Date('2026-12-03T05:00:00Z') }];
    const bulanLunas = await hitungModalSesi(dbDengan({ pembelian: [p], koreksi: [] , refund: [] }) as never, nov);
    // Di bulan lunas tidak ada koreksi dalam rentang, tetapi pembelian CANCELLED tetap dihitung bila pernah VOID.
    const dbNov = dbDengan({ pembelian: [p], koreksi });
    dbNov.pembelianKoreksi.findMany = jest.fn(async ({ where }: { where: { purchaseId?: unknown } }) =>
      where.purchaseId ? koreksi : [],
    );
    const nov2 = await hitungModalSesi(dbNov as never, nov);
    expect(bulanLunas.totalRp).toBe(0);
    expect(nov2.modalTerjualRp).toBe(1_600_000);
    expect(nov2.modalBalikRp).toBe(0);

    const des = {
      branchIds: null,
      fromDate: new Date('2026-12-01T00:00:00Z'),
      untilExclusive: new Date('2027-01-01T00:00:00Z'),
    };
    const hasilDes = await hitungModalSesi(dbDengan({ pembelian: [], sumberLain: [p], koreksi }) as never, des);
    expect(hasilDes).toMatchObject({ modalTerjualRp: 0, modalBalikRp: 1_600_000, totalRp: -1_600_000 });
    expect(hasilDes.modalBalikPerCabang.get('untar')).toBe(1_600_000);
  });

  it('refund membalik modal sisa sesi di bulan refund', async () => {
    const p = beli('p1', 'untar', 20, '2026-11-05T03:00:00Z');
    const hasil = await hitungModalSesi(
      dbDengan({
        pembelian: [p],
        refund: [{ purchaseId: 'p1', branchId: 'untar', sisaSesi: 5, createdAt: new Date('2026-11-20T03:00:00Z') }],
      }) as never,
      nov,
    );
    expect(hasil).toMatchObject({ modalTerjualRp: 1_600_000, modalBalikRp: 400_000, totalRp: 1_200_000 });
  });

  it('pembelian lunas sebelum November tidak punya snapshot; refund-nya tidak membalik apa pun', async () => {
    const lama = beli('lama', 'untar', 10, '2026-10-20T03:00:00Z');
    const db = dbDengan({
      sumberLain: [lama],
      refund: [{ purchaseId: 'lama', branchId: 'untar', sisaSesi: 4, createdAt: new Date('2026-11-10T03:00:00Z') }],
    });
    const hasil = await hitungModalSesi(db as never, nov);
    expect(hasil.totalRp).toBe(0);
    expect(db.modalPaketTerjual.createMany).not.toHaveBeenCalled();
  });

  it('paket 0 sesi (perpanjangan masa aktif) bermodal Rp0', async () => {
    const hasil = await hitungModalSesi(
      dbDengan({ pembelian: [beli('ext', 'untar', 0, '2026-11-07T03:00:00Z', 'PAID', null)] }) as never,
      nov,
    );
    expect(hasil).toMatchObject({ totalRp: 0, sesiTerjual: 0, sesiTanpaModal: 0 });
  });

  it('rentang yang melewati 1 November: bagian Oktober tetap sesi terpakai', async () => {
    const db = dbDengan({ pembelian: [beli('p1', 'untar', 20, '2026-11-05T03:00:00Z')] });
    db.pemesananKelas.findMany = jest.fn(async () => [
      { classSlot: { branchId: 'untar', classTypeId: 'grp', startAt: new Date('2026-10-30T02:00:00Z') } },
    ]);
    const hasil = await hitungModalSesi(db as never, {
      branchIds: null,
      fromDate: new Date('2026-10-15T00:00:00Z'),
      untilExclusive: new Date('2026-11-16T00:00:00Z'),
    });
    expect(hasil).toMatchObject({ metode: 'CAMPURAN', sesiTerpakai: 1, sesiTerjual: 20, totalRp: 1_680_000 });
    expect(db.pemesananKelas.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          classSlot: expect.objectContaining({
            startAt: { gte: new Date('2026-10-15T00:00:00Z'), lt: new Date('2026-11-01T00:00:00Z') },
          }),
        }),
      }),
    );
  });

  it('tabel modal_paket_terjual belum ada: snapshot dihitung tanpa disimpan', async () => {
    const db = dbDengan({ pembelian: [beli('p1', 'untar', 20, '2026-11-05T03:00:00Z')] });
    const p2021 = Object.assign(new (require('@prisma/client').Prisma.PrismaClientKnownRequestError)('no table', {
      code: 'P2021',
      clientVersion: 'x',
    }));
    db.modalPaketTerjual.findMany = jest.fn(async () => {
      throw p2021;
    });
    (db as Record<string, unknown>).$queryRawUnsafe = jest.fn(async () => []);
    const hasil = await hitungModalSesi(db as never, nov);
    expect(hasil.totalRp).toBe(1_600_000);
    expect(db.modalPaketTerjual.createMany).not.toHaveBeenCalled();
  });

  it('catatModalPaket membekukan modal saat pembelian lunas', async () => {
    const db = dbDengan({});
    db.pembelian.findUnique = jest.fn(async () => beli('p9', 'untar', 10, '2026-11-12T03:00:00Z'));
    await catatModalPaket(db as never, 'p9');
    expect(db.modalPaketTerjual.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ purchaseId: 'p9', modalTotalRp: 800_000 })],
      skipDuplicates: true,
    });
  });
});

describe('ModalSesiService', () => {
  const setup = () => {
    const db = {
      modalSesi: {
        findMany: jest.fn(async () => []),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'baru',
          createdAt: new Date('2026-10-29T00:00:00Z'),
          ...data,
        })),
      },
      cabang: { findUnique: jest.fn(async () => ({ id: 'untar' })) },
      jenisKelas: { findUnique: jest.fn(async () => ({ id: 'grp' })) },
      auditLog: { create: jest.fn() },
      $transaction: jest.fn(async (fn: (t: unknown) => unknown): Promise<unknown> => fn(db)),
    };
    return { db, service: new ModalSesiService(db as never, new PolicyService()) };
  };

  it('Super Owner menyimpan modal per sesi dan tercatat di audit', async () => {
    const { service, db } = setup();
    const hasil = await service.simpan(superOwner, {
      branchId: 'untar',
      classTypeId: 'grp',
      modalPerSesiRp: 50_000,
      effectiveDate: '2026-10-01',
    });
    expect(hasil).toMatchObject({
      branchId: 'untar',
      classTypeId: 'grp',
      modalPerSesiRp: 50_000,
      effectiveDate: '2026-10-01',
    });
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'finance.session_cost_created' }),
      }),
    );
  });

  it('admin tidak bisa membaca atau mengubah modal', async () => {
    const { service } = setup();
    await expect(service.daftar(admin)).rejects.toBeDefined();
    await expect(
      service.simpan(admin, {
        branchId: 'untar',
        classTypeId: 'grp',
        modalPerSesiRp: 1,
        effectiveDate: '2026-10-01',
      }),
    ).rejects.toBeDefined();
  });

  it('menolak nominal yang tidak valid', async () => {
    const { service } = setup();
    await expect(
      service.simpan(superOwner, {
        branchId: 'untar',
        modalPerSesiRp: -5,
        effectiveDate: '2026-10-01',
      }),
    ).rejects.toMatchObject({ details: [{ field: 'modalPerSesiRp', issue: 'INVALID_AMOUNT' }] });
  });
});
