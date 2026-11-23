import { readFileSync } from 'node:fs';
import * as tabelOpsional from '../foundation/tabel-opsional';
import { join } from 'node:path';
import { AKSI_AUTO_LEWAT, AKSI_AUTO_SETUJU, AutoBuktiService, bacaTeksTesseract, PELAKU_SISTEM } from './auto-bukti.service';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const PDF = Buffer.from('%PDF-1.7\n', 'ascii');
const wib = (s: string) => new Date(`${s}+07:00`);
const TEKS_BCA = 'Transfer Berhasil\n23/11/2026 10:15:32 WIB\nRp 1.500.123,00';

function setup(o: { pembelian?: Record<string, unknown>; bytes?: Buffer; dipakaiLain?: boolean; teks?: string } = {}) {
  const pembelian = {
    id: 'pur-1',
    status: 'WAITING_VERIFICATION',
    paymentMethod: 'BANK_TRANSFER',
    uniqueCode: 123,
    totalAmountRp: 1_500_123,
    createdAt: wib('2026-11-23T10:05:00'),
    branchId: 'gg',
    paymentProof: { id: 'bukti-awal', fileUrl: '/uploads/payment-proofs/00000000-0000-4000-8000-0000000000b1', uploadedAt: wib('2026-11-23T10:40:00') },
    ...o.pembelian,
  };
  const db: any = {
    pembelian: { findUnique: jest.fn(async () => pembelian) },
    buktiSidik: {
      findFirst: jest.fn(async () => (o.dipakaiLain ? { purchaseId: 'pur-lain' } : null)),
      upsert: jest.fn(async () => ({})),
    },
    auditLog: { create: jest.fn(async () => ({})) },
    $queryRawUnsafe: jest.fn(async () => [{ ada: 1 }]),
  };
  const review = { decide: jest.fn(async () => ({})) };
  const storage = { readPrivateObject: jest.fn(async () => o.bytes ?? PNG) };
  const service = new AutoBuktiService(db, review as never, storage as never);
  service.bacaTeks = jest.fn(async () => o.teks ?? TEKS_BCA);
  return { service, db, review, storage };
}

const ID = '00000000-0000-4000-8000-0000000000b1';

describe('AutoBuktiService', () => {
  it('nominal unik dan waktu cocok: disetujui lewat jalur keputusan biasa sebagai sistem, tercatat di audit', async () => {
    const { service, review, db, storage } = setup();
    expect(await service.periksa('pur-1', ID)).toBe('COCOK');
    // Berkas dibaca dari unggahan terbaru (fileUrl), bukan id baris pertama.
    expect(storage.readPrivateObject).toHaveBeenCalledWith(`payment-proofs/${ID}`);
    expect(review.decide).toHaveBeenCalledWith(
      PELAKU_SISTEM,
      'pur-1',
      'APPROVED',
      expect.objectContaining({ reasonCode: 'PAYMENT_VERIFIED' }),
      `auto-bukti:${ID}`,
      `auto-bukti:${ID}`,
    );
    expect(db.buktiSidik.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ hasil: 'COCOK', purchaseId: 'pur-1' }) }),
    );
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: AKSI_AUTO_SETUJU, objectId: 'pur-1', actorId: null }),
    });
  });

  it('foto yang pernah dipakai pesanan lain: tidak disetujui', async () => {
    const { service, review, db } = setup({ dipakaiLain: true });
    expect(await service.periksa('pur-1', ID)).toBe('FOTO_DIPAKAI_ULANG');
    expect(review.decide).not.toHaveBeenCalled();
    expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: AKSI_AUTO_LEWAT }) });
  });

  it('nominal di foto berbeda: tetap menunggu diperiksa staf', async () => {
    const { service, review } = setup({ teks: '23/11/2026 10:15 WIB\nRp 1.500.000' });
    expect(await service.periksa('pur-1', ID)).toBe('NOMINAL_TIDAK_DITEMUKAN');
    expect(review.decide).not.toHaveBeenCalled();
  });

  it('PDF tidak dibaca otomatis', async () => {
    const { service, review } = setup({ bytes: PDF });
    expect(await service.periksa('pur-1', ID)).toBe('BUKAN_GAMBAR');
    expect(review.decide).not.toHaveBeenCalled();
  });

  it('bukan transfer bank, tanpa kode unik, sudah diputus, atau bukan bukti terbaru: tidak diproses', async () => {
    for (const pembelian of [
      { paymentMethod: 'CASH' },
      { uniqueCode: null },
      { status: 'PAID' },
      { paymentProof: { id: 'x', fileUrl: '/uploads/payment-proofs/00000000-0000-4000-8000-0000000000c9', uploadedAt: new Date() } },
    ]) {
      const { service, review, storage } = setup({ pembelian });
      expect(await service.periksa('pur-1', ID)).toBe('TIDAK_BERLAKU');
      expect(storage.readPrivateObject).not.toHaveBeenCalled();
      expect(review.decide).not.toHaveBeenCalled();
    }
  });

  it('tabel bukti_sidik belum dibuat: tidak menyetujui otomatis (foto dipakai ulang tak bisa dicek)', async () => {
    const { service, review, storage } = setup();
    const spy = jest.spyOn(tabelOpsional, 'tabelOpsionalAda').mockResolvedValue(false);
    expect(await service.periksa('pur-1', ID)).toBe('TIDAK_BERLAKU');
    expect(storage.readPrivateObject).not.toHaveBeenCalled();
    expect(review.decide).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('OCR sungguhan membaca contoh bukti m-BCA', async () => {
    const gambar = readFileSync(join(__dirname, '__fixtures__', 'bukti-bca.png'));
    const teks = await bacaTeksTesseract(gambar);
    expect(teks).toContain('1.500.123');
    expect(teks).toContain('23/11/2026 10:15:32');
  }, 30_000);
});
