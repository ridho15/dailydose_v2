import { PolicyService } from '../identity/policy.service';

// Membuat PNG sungguhan lambat di lingkungan tes; yang diuji di sini adalah isi QR dan pengirimannya.
jest.mock('qrcode', () => ({
  __esModule: true,
  default: {
    toBuffer: jest.fn(async (isi: string) =>
      Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from(isi)]),
    ),
  },
}));
import { JENIS_PESAN_QR, KirimQrService, keteranganQr } from './kirim-qr.service';

const admin = {
  sessionId: 's',
  userId: 'u-admin',
  roles: [{ role: 'ADMIN', branchId: 'gg' }],
  capabilities: ['attendance:manage', 'customer:manage'],
  branchIds: ['gg'],
} as never;

function setup(user: Record<string, unknown> | null = null) {
  const db = {
    user: {
      findUnique: jest.fn().mockResolvedValue(
        user ?? {
          id: 'm-1',
          displayName: 'Lia Kusuma',
          phone: '081234567890',
          role: 'CUSTOMER',
          status: 'ACTIVE',
          instructorAssignments: [],
        },
      ),
      findMany: jest.fn().mockResolvedValue([
        { id: 'm-1', displayName: 'Lia', phone: '0812', role: 'CUSTOMER', status: 'ACTIVE' },
        { id: 'i-1', displayName: 'Asrida', phone: '0813', role: 'INSTRUCTOR', status: 'ACTIVE' },
      ]),
    },
  };
  const whatsapp = {
    sendMessage: jest
      .fn()
      .mockResolvedValue({ status: 'SENT', provider: 'MOCK', success: true, recipientPhone: 'x' }),
  };
  const audit = { catat: jest.fn().mockResolvedValue(undefined) };
  return {
    db,
    whatsapp,
    audit,
    service: new KirimQrService(
      db as never,
      new PolicyService(),
      whatsapp as never,
      audit as never,
    ),
  };
}

describe('KirimQrService.kirimManual', () => {
  it('mengirim gambar QR PNG dengan keterangan dan mencatatnya di audit', async () => {
    const { service, whatsapp, audit } = setup();
    const hasil = await service.kirimManual(admin, 'm-1');

    expect(hasil).toEqual({ status: 'SENT', provider: 'MOCK', error: undefined });
    const kirim = whatsapp.sendMessage.mock.calls[0][0];
    expect(kirim).toMatchObject({
      to: '081234567890',
      reminderType: JENIS_PESAN_QR,
      recipientType: 'CUSTOMER',
      dedupWindowMs: 120_000,
    });
    // Gambar PNG berisi pass tetap milik member itu.
    expect(kirim.imagePng.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(kirim.imagePng.subarray(4).toString()).toMatch(/^dd-pass:v1:[A-Za-z0-9_-]{43}$/);
    expect(kirim.text).toMatch(/^Halo Lia, ini QR kehadiran Daily Dose Anda/);
    expect(audit.catat).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ action: 'checkin.qr_whatsapp_sent', targetUserId: 'm-1' }),
    );
  });

  it('menolak akun tanpa nomor WhatsApp atau yang tidak aktif', async () => {
    const tanpaNomor = setup({
      id: 'm-2',
      displayName: 'X',
      phone: null,
      role: 'CUSTOMER',
      status: 'ACTIVE',
      instructorAssignments: [],
    });
    await expect(tanpaNomor.service.kirimManual(admin, 'm-2')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    const nonaktif = setup({
      id: 'm-3',
      displayName: 'X',
      phone: '0812',
      role: 'CUSTOMER',
      status: 'INACTIVE',
      instructorAssignments: [],
    });
    await expect(nonaktif.service.kirimManual(admin, 'm-3')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(tanpaNomor.whatsapp.sendMessage).not.toHaveBeenCalled();
  });

  it('membatasi instruktur pada staf cabang tempat ia mengajar', async () => {
    const { service } = setup({
      id: 'i-9',
      displayName: 'Devi',
      phone: '0813',
      role: 'INSTRUCTOR',
      status: 'ACTIVE',
      instructorAssignments: [{ branchId: 'mk' }],
    });
    await expect(service.kirimManual(admin, 'i-9')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('bukan untuk akun staf', async () => {
    const { service } = setup({
      id: 'o',
      displayName: 'Owner',
      phone: '0812',
      role: 'OWNER',
      status: 'ACTIVE',
      instructorAssignments: [],
    });
    await expect(service.kirimManual(admin, 'o')).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });
});

describe('KirimQrService.kirimOtomatis', () => {
  it('mengirim sekali seumur akun ke member dan instruktur baru, dan menghitung hasilnya', async () => {
    const { service, whatsapp, db } = setup();
    whatsapp.sendMessage
      .mockResolvedValueOnce({ status: 'SENT', provider: 'META_CLOUD_API' })
      .mockResolvedValueOnce({ status: 'SKIPPED_DUPLICATE', provider: 'IDEMPOTENCY_GUARD' });

    const hasil = await service.kirimOtomatis(new Date('2026-10-28T03:00:00Z'));

    expect(hasil).toEqual({ dikirim: 1, gagal: 0, dilewati: 1 });
    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: { in: ['CUSTOMER', 'INSTRUCTOR'] },
          phone: { not: null },
          createdAt: { gte: new Date('2026-10-21T03:00:00Z') },
        }),
      }),
    );
    expect(whatsapp.sendMessage.mock.calls[1][0]).toMatchObject({ recipientType: 'INSTRUCTOR' });
    expect(whatsapp.sendMessage.mock.calls[0][0].dedupWindowMs).toBeGreaterThan(365 * 86_400_000);
  });
});

describe('keteranganQr', () => {
  it('memakai nama depan dan menyebut honor untuk instruktur', () => {
    expect(keteranganQr('Asrida Putri', 'INSTRUCTOR')).toMatch(/^Halo Asrida, .*honor/);
  });
});
