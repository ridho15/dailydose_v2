import * as tabelOpsional from '../foundation/tabel-opsional';
import { PolicyService } from '../identity/policy.service';
import { PembelianBaruService } from './pembelian-baru.service';

const NOW = new Date('2026-12-10T05:00:00Z');
const hariLalu = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const admin = {
  sessionId: 's',
  userId: 'admin-1',
  roles: [{ role: 'ADMIN', branchId: 'gg' }],
  capabilities: ['purchase:record', 'payment:review'],
  branchIds: ['gg'],
} as never;

const beli = (id: string, paidAt: Date) => ({
  id,
  invoiceNumber: `INV-${id}`,
  totalAmountRp: 1_500_123,
  paidAt,
  packageId: 'pkg-1',
  user: { displayName: `Member ${id}`, phone: '081234567890' },
  package: { name: 'Group 10x', validityDays: 60 },
});

function setup(o: { terkirim?: Array<{ purchaseId: string; dikirimPada: Date }>; adaTabel?: boolean } = {}) {
  const terkirim = o.terkirim ?? [];
  const db: any = {
    $queryRawUnsafe: jest.fn(async () => (o.adaTabel === false ? [] : [{ ada: 1 }])),
    syaratTerkirimWa: {
      findMany: jest.fn(async () => terkirim),
      upsert: jest.fn(async () => ({ dikirimPada: NOW })),
    },
    pembelian: {
      findMany: jest.fn(async ({ where }: any) =>
        where.paidAt.lte
          ? [beli('baru-terkirim', hariLalu(2)), beli('baru-belum', hariLalu(1))]
          : [beli('lama-belum', hariLalu(9))],
      ),
      findUnique: jest.fn(async () => ({ id: 'baru-belum', branchId: 'gg', status: 'PAID' })),
    },
    paketPerpanjangan: { findMany: jest.fn(async () => []) },
  };
  const audit = { record: jest.fn() };
  return { service: new PembelianBaruService(db, new PolicyService(), audit as never), db, audit };
}

describe('PembelianBaruService', () => {
  it('pembelian 7 hari terakhir tampil; yang lebih lama tampil hanya bila belum dikirimi pesan', async () => {
    const { service, db } = setup({ terkirim: [{ purchaseId: 'baru-terkirim', dikirimPada: hariLalu(1) }] });
    const { items, siap } = await service.daftar(admin, { branchId: 'gg' }, NOW);
    expect(siap).toBe(true);
    // Belum dikirim di atas (terbaru dulu), sudah dikirim di bawah.
    expect(items.map((i) => i.id)).toEqual(['baru-belum', 'lama-belum', 'baru-terkirim']);
    expect(items[2]!.terkirimPada).toBe(hariLalu(1).toISOString());
    const lama = db.pembelian.findMany.mock.calls[1][0].where;
    expect(lama.id).toEqual({ notIn: ['baru-terkirim'] });
    expect(lama.paidAt.lt).toEqual(hariLalu(7));
    expect(items[0]).toMatchObject({ telepon: '081234567890', namaPaket: 'Group 10x', masaBerlakuHari: 60 });
  });

  it('staf cabang lain ditolak; cabang wajib diisi', async () => {
    const { service } = setup();
    await expect(service.daftar(admin, { branchId: 'mk' }, NOW)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.daftar(admin, {}, NOW)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('klik WhatsApp mencatat waktu kirim pertama dan audit', async () => {
    const { service, db, audit } = setup();
    expect(await service.tandaiTerkirim(admin, 'baru-belum')).toEqual({
      purchaseId: 'baru-belum',
      terkirimPada: NOW.toISOString(),
    });
    expect(db.syaratTerkirimWa.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: {}, create: expect.objectContaining({ branchId: 'gg', dikirimOleh: 'admin-1' }) }),
    );
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'purchase.terms_whatsapp_sent' }));
  });

  it('tanpa tabel: daftar tetap tampil, menandai terkirim ditolak dengan alasan jelas', async () => {
    const { service } = setup({ adaTabel: false });
    const spy = jest.spyOn(tabelOpsional, 'tabelOpsionalAda').mockResolvedValue(false);
    expect((await service.daftar(admin, { branchId: 'gg' }, NOW)).siap).toBe(false);
    await expect(service.tandaiTerkirim(admin, 'baru-belum')).rejects.toMatchObject({
      code: 'TERMS_FOLLOWUP_UNAVAILABLE',
    });
    spy.mockRestore();
  });
});
