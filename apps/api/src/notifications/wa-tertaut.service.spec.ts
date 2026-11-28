import { EventEmitter } from 'node:events';
import * as tabelOpsional from '../foundation/tabel-opsional';
import { dekripsi, enkripsi, jidDariNomor, kunciSesiDariEnv, nomorDariIdAkun } from './wa-tertaut-kunci';
import { WaTertautService } from './wa-tertaut.service';
import { WhatsAppGatewayService } from './whatsapp-gateway.service';

const KUNCI = 'k'.repeat(40);
const admin = { sessionId: 's', userId: 'adm-1', roles: [{ role: 'ADMIN', branchId: 'gg' }], capabilities: [], branchIds: ['gg'] } as never;
const manager = { ...(admin as object), roles: [{ role: 'MANAGER', branchId: 'gg' }] } as never;

describe('kunci sesi WhatsApp', () => {
  it('enkripsi AES-GCM bolak-balik; kunci salah atau isi diubah ditolak', () => {
    const k = kunciSesiDariEnv({ WA_SESSION_KEY: KUNCI })!;
    const sandi = enkripsi('{"creds":1}', k);
    expect(sandi).not.toContain('creds');
    expect(dekripsi(sandi, k)).toBe('{"creds":1}');
    expect(() => dekripsi(sandi, kunciSesiDariEnv({ WA_SESSION_KEY: 'x'.repeat(40) })!)).toThrow();
    expect(kunciSesiDariEnv({ WA_SESSION_KEY: 'pendek' })).toBeNull();
  });
  it('nomor menjadi JID WhatsApp', () => {
    expect(jidDariNomor('0812-3456-7890')).toBe('6281234567890@s.whatsapp.net');
    expect(jidDariNomor('+6281234567890')).toBe('6281234567890@s.whatsapp.net');
    expect(jidDariNomor('12')).toBeNull();
    expect(nomorDariIdAkun('6281234567890:12@s.whatsapp.net')).toBe('6281234567890');
  });
});

/** Tiruan pustaka Baileys: soket dengan event emitter yang dikendalikan tes. */
function tiruanBaileys() {
  const soket: any = {
    ev: new EventEmitter(),
    user: { id: '6281111111111:7@s.whatsapp.net' },
    sendMessage: jest.fn(async () => ({ key: { id: 'msg-1' } })),
    logout: jest.fn(async () => undefined),
    end: jest.fn(),
  };
  const b = {
    makeWASocket: jest.fn(() => soket),
    initAuthCreds: () => ({ me: null }),
    BufferJSON: { replacer: (_k: string, v: unknown) => v, reviver: (_k: string, v: unknown) => v },
    DisconnectReason: { loggedOut: 401, restartRequired: 515 },
    proto: { Message: { AppStateSyncKeyData: { fromObject: (v: unknown) => v } } },
  };
  return { b, soket };
}

function setup() {
  process.env.WA_SESSION_KEY = KUNCI;
  const rows = new Map<string, any>();
  const db: any = {
    waTertautSesi: {
      findUnique: jest.fn(async ({ where }: any) => rows.get(where.userId) ?? null),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        rows.set(where.userId, { ...(rows.get(where.userId) ?? create), ...(rows.has(where.userId) ? update : {}) });
      }),
      update: jest.fn(async ({ where, data }: any) => rows.set(where.userId, { ...rows.get(where.userId), ...data })),
      findMany: jest.fn(async ({ where }: any) =>
        [...rows.entries()].filter(([, r]) => r.branchId === where.branchId && r.status === where.status).map(([userId]) => ({ userId })),
      ),
      deleteMany: jest.fn(async ({ where }: any) => rows.delete(where.userId)),
    },
  };
  const { b, soket } = tiruanBaileys();
  const service = new WaTertautService(db);
  service.muat = async () => b;
  service.jeda = () => 0;
  return { service, db, soket, rows, b };
}

describe('WaTertautService', () => {
  let spy: jest.SpyInstance;
  beforeEach(() => {
    spy = jest.spyOn(tabelOpsional, 'tabelOpsionalAda').mockResolvedValue(true);
  });
  afterEach(async () => {
    spy.mockRestore();
    delete process.env.WA_SESSION_KEY;
  });

  it('hanya Admin cabang yang boleh menautkan', async () => {
    const { service } = setup();
    await expect(service.mulai(manager)).rejects.toMatchObject({ response: 'WA_LINK_ADMIN_ONLY' });
  });

  it('tanpa WA_SESSION_KEY fitur belum siap dan tidak menyambung', async () => {
    const { service } = setup();
    delete process.env.WA_SESSION_KEY;
    await expect(service.mulai(admin)).rejects.toMatchObject({ response: 'WA_LINK_NOT_CONFIGURED' });
    expect((await service.status(admin)).siap).toBe(false);
  });

  it('QR tampil, scan membuat tersambung, kunci sesi tersimpan terenkripsi, pesan terkirim dari nomor admin', async () => {
    const { service, soket, rows } = setup();
    await service.mulai(admin);
    soket.ev.emit('connection.update', { qr: '2@abc' });
    const menunggu = await service.status(admin);
    expect(menunggu.status).toBe('MENUNGGU_SCAN');
    expect(menunggu.qr).toMatch(/^data:image\/png;base64,/);

    soket.ev.emit('connection.update', { connection: 'open' });
    await new Promise((r) => setTimeout(r, 600)); // tulis kunci sesi ditunda 500 ms
    const row = rows.get('adm-1');
    expect(row).toMatchObject({ status: 'TERSAMBUNG', nomor: '6281111111111', branchId: 'gg' });
    expect(row.data).toMatch(/^v1\./);
    expect(row.data).not.toContain('creds');

    expect(await service.pengirimCabang('gg')).toBe('adm-1');
    expect(await service.pengirimCabang('mk')).toBeNull();
    expect(await service.kirimDari('adm-1', '0812-2222-3333', 'Halo')).toEqual({ success: true, messageId: 'msg-1' });
    expect(soket.sendMessage).toHaveBeenCalledWith('6281222223333@s.whatsapp.net', { text: 'Halo' });
    const png = Buffer.from('89504e47', 'hex');
    await service.kirimGambarDari('adm-1', '081222223333', png, 'QR Anda');
    expect(soket.sendMessage).toHaveBeenLastCalledWith('6281222223333@s.whatsapp.net', { image: png, caption: 'QR Anda', mimetype: 'image/png' });

    await service.uji(admin);
    expect(soket.sendMessage).toHaveBeenLastCalledWith('6281111111111@s.whatsapp.net', expect.objectContaining({ text: expect.stringContaining('Tes WhatsApp') }));

    await service.putuskan(admin);
    expect(soket.logout).toHaveBeenCalled();
    expect(rows.has('adm-1')).toBe(false);
    await service.onModuleDestroy();
  });

  it('perangkat tertaut dihapus dari HP: status terputus, kunci sesi dibuang', async () => {
    const { service, soket, rows } = setup();
    await service.mulai(admin);
    soket.ev.emit('connection.update', { connection: 'open' });
    soket.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } });
    await new Promise((r) => setTimeout(r, 0));
    expect(rows.get('adm-1')).toMatchObject({ status: 'TERPUTUS', data: null });
    expect((await service.kirimDari('adm-1', '081222223333', 'x')).success).toBe(false);
    await service.onModuleDestroy();
  });
});

describe('WhatsAppGatewayService + WhatsApp admin tertaut', () => {
  it('pesan bercabang dikirim dari WhatsApp admin cabang; tanpa admin tersambung lewat penyedia biasa', async () => {
    const db: any = {
      reminderLog: { findFirst: jest.fn(async () => null), create: jest.fn(async ({ data }: any) => ({ id: 'log-1', ...data })) },
    };
    const wa: any = {
      pengirimCabang: jest.fn(async (b: string) => (b === 'gg' ? 'adm-1' : null)),
      kirimDari: jest.fn(async () => ({ success: true, messageId: 'wa-1' })),
      kirimGambarDari: jest.fn(async () => ({ success: true, messageId: 'wa-2' })),
    };
    const gateway = new WhatsAppGatewayService(db, wa);
    const viaAdmin = await gateway.sendMessage({ to: '081234567890', text: 'Halo', recipientType: 'CUSTOMER', reminderType: 'T1', branchId: 'gg' });
    expect(viaAdmin).toMatchObject({ status: 'SENT', provider: 'WA_ADMIN_TERTAUT' });
    expect(wa.kirimDari).toHaveBeenCalledWith('adm-1', '+6281234567890', 'Halo');

    const tanpaAdmin = await gateway.sendMessage({ to: '081234567890', text: 'Halo', recipientType: 'CUSTOMER', reminderType: 'T2', branchId: 'mk' });
    expect(tanpaAdmin.provider).toBe('MOCK');
    expect(await gateway.bisaKirimNyata('gg')).toBe(true);
    expect(await gateway.bisaKirimNyata('mk')).toBe(false);

    // Gambar (QR kehadiran) juga lewat WhatsApp admin cabang.
    const png = Buffer.from('89504e47', 'hex');
    const gambar = await gateway.sendMessage({ to: '081234567890', text: 'QR', imagePng: png, recipientType: 'CUSTOMER', reminderType: 'T3', branchId: 'gg' });
    expect(gambar).toMatchObject({ status: 'SENT', provider: 'WA_ADMIN_TERTAUT' });
    expect(wa.kirimGambarDari).toHaveBeenCalledWith('adm-1', '+6281234567890', png, 'QR');
  });
});
