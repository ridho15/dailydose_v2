import { PolicyService } from '../identity/policy.service';
import { kenaliBukti, PenyesuaianBuktiService } from './penyesuaian-bukti.service';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(20)]);
const manajer = {
  sessionId: 's',
  userId: 'u-1',
  roles: [{ role: 'MANAGER', branchId: 'b' }] as never,
  capabilities: ['ledger:adjust:decide', 'ledger:adjust:read'],
  branchIds: ['b'],
};

function setup(opts: { gagal?: unknown } = {}) {
  const ledger = {
    directAdjustment: jest.fn(async () => {
      if (opts.gagal) throw opts.gagal;
      return { resultingBalance: 5 };
    }),
    getAdjustment: jest.fn().mockResolvedValue({}),
  };
  const storage = {
    put: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue(undefined),
    exists: jest.fn(async (k: string) => k.endsWith('.pdf')),
    read: jest.fn().mockResolvedValue('ALIRAN'),
  };
  const audit = { catat: jest.fn().mockResolvedValue(undefined) };
  const service = new PenyesuaianBuktiService(
    {} as never,
    new PolicyService(),
    ledger as never,
    audit as never,
    storage as never,
  );
  return { service, ledger, storage, audit };
}

const isian = {
  customerPackageId: '00000000-0000-4000-8000-000000000001',
  quantity: '2',
  reason: 'Kelas 14 Okt batal karena instruktur sakit, sesi dikembalikan.',
};

describe('kenaliBukti', () => {
  it('mengenali gambar dan PDF dari byte awalnya', () => {
    expect(kenaliBukti(JPEG)?.mime).toBe('image/jpeg');
    expect(kenaliBukti(PDF)?.mime).toBe('application/pdf');
  });

  it('menolak berkas lain walau namanya .jpg', () => {
    expect(kenaliBukti(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
  });
});

describe('PenyesuaianBuktiService.sesuaikan', () => {
  it('menyimpan bukti lebih dulu lalu menerapkan penyesuaian dengan id yang sama', async () => {
    const { service, ledger, storage } = setup();

    const hasil = await service.sesuaikan(manajer, isian, { buffer: JPEG });

    const kunci = storage.put.mock.calls[0]![0].key as string;
    const id = (ledger.directAdjustment.mock.calls[0] as unknown as [unknown, { id: string }])[1]
      .id;
    expect(kunci).toBe(`adjustment-evidence/${id}.jpg`);
    expect(storage.put.mock.invocationCallOrder[0]).toBeLessThan(
      ledger.directAdjustment.mock.invocationCallOrder[0]!,
    );
    expect(ledger.directAdjustment).toHaveBeenCalledWith(
      manajer,
      expect.objectContaining({
        quantity: 2,
        note: isian.reason,
        reasonCode: 'PACKAGE_COMPENSATION',
      }),
    );
    expect(hasil.evidenceUrl).toBe(`/api/v1/session-adjustments/${id}/evidence`);
  });

  it('menandai koreksi kehadiran bila menyebut booking yang dikoreksi', async () => {
    const { service, ledger } = setup();

    await service.sesuaikan(manajer, { ...isian, bookingId: 'bk-1' }, { buffer: JPEG });

    expect(ledger.directAdjustment).toHaveBeenCalledWith(
      manajer,
      expect.objectContaining({ bookingId: 'bk-1', reasonCode: 'ATTENDANCE_CORRECTION' }),
    );
  });

  it('menghapus bukti bila penyesuaiannya gagal, agar tidak ada berkas yatim', async () => {
    const { service, storage } = setup({ gagal: new Error('saldo tidak cukup') });

    await expect(service.sesuaikan(manajer, isian, { buffer: JPEG })).rejects.toThrow('saldo');
    expect(storage.delete).toHaveBeenCalledWith(storage.put.mock.calls[0]![0].key);
  });

  it('menolak tanpa bukti', async () => {
    const { service, ledger } = setup();

    await expect(service.sesuaikan(manajer, isian, undefined)).rejects.toMatchObject({
      status: 422,
    });
    expect(ledger.directAdjustment).not.toHaveBeenCalled();
  });

  it('menolak alasan yang terlalu singkat untuk dipahami orang lain kelak', async () => {
    const { service, storage } = setup();

    await expect(
      service.sesuaikan(manajer, { ...isian, reason: 'salah catat' }, { buffer: JPEG }),
    ).rejects.toMatchObject({ status: 422, details: [{ field: 'reason', issue: 'TOO_SHORT' }] });
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('menolak berkas yang bukan gambar atau PDF', async () => {
    const { service } = setup();

    await expect(
      service.sesuaikan(manajer, isian, { buffer: Buffer.from('MZ' + 'x'.repeat(40)) }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('hanya untuk Super Owner dan Studio Manager', async () => {
    const { service } = setup();
    const admin = { ...manajer, capabilities: ['ledger:adjust:read'] };

    await expect(service.sesuaikan(admin, isian, { buffer: JPEG })).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe('PenyesuaianBuktiService.bukti', () => {
  it('memeriksa hak baca penyesuaian sebelum membuka berkas', async () => {
    const { service, ledger, storage } = setup();

    const hasil = await service.bukti(manajer, 'adj-1');

    expect(ledger.getAdjustment).toHaveBeenCalledWith(manajer, 'adj-1');
    expect(hasil).toEqual({ mimeType: 'application/pdf', stream: 'ALIRAN' });
    expect(storage.read).toHaveBeenCalledWith('adjustment-evidence/adj-1.pdf');
  });
});

describe('Disetujui Owner tanpa lampiran', () => {
  const owner = { ...manajer, roles: [{ role: 'OWNER', branchId: 'b' }] as never };

  it('Owner boleh tanpa berkas: catatan ditandai [DISETUJUI OWNER], tidak ada yang disimpan, tercatat di audit', async () => {
    const { service, ledger, storage, audit } = setup();
    const hasil = await service.sesuaikan(owner, { ...isian, ownerApproved: 'true' }, undefined);
    expect(hasil.evidenceUrl).toBeNull();
    expect(storage.put).not.toHaveBeenCalled();
    expect((ledger.directAdjustment.mock.calls[0] as any[])[1].note).toMatch(/^\[DISETUJUI OWNER\] Kelas 14 Okt/);
    expect(audit.catat).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ action: 'SESSION_ADJUSTMENT_OWNER_APPROVED_WITHOUT_EVIDENCE', actorId: 'u-1' }),
    );
  });

  it('Manager tidak bisa memakai opsi ini; tanpa opsi, berkas tetap wajib', async () => {
    const { service, ledger } = setup();
    await expect(service.sesuaikan(manajer, { ...isian, ownerApproved: 'true' }, undefined)).rejects.toMatchObject({
      code: 'OWNER_APPROVAL_REQUIRED',
    });
    await expect(service.sesuaikan(owner, isian, undefined)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(ledger.directAdjustment).not.toHaveBeenCalled();
  });
});
