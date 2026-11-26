import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { PRIVATE_FILE_STORAGE, type PrivateFileStorage } from '../identity/private-file-storage';
import { catatNota, periksaNota, simpanBerkasNota, type BerkasNota } from './nota-pengeluaran';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../foundation/audit.service';
import { bacaOpsional, tabelOpsionalAda } from '../foundation/tabel-opsional';
import type { SessionPrincipal } from '../identity/identity.service';
import { PolicyService } from '../identity/policy.service';
import { ApiProblem } from '../identity/security';
import { tanggalWib } from './instructor-fee-calculator';

/**
 * Stok minuman per cabang (keputusan pemilik 25 November 2026):
 * - master barang (nama dan harga jual) berlaku untuk semua cabang, hanya Super Owner yang mengisi;
 * - admin hanya mencatat beli (MASUK) dan jual (DIJUAL); harga jual selalu dari master, tidak bisa diubah
 *   saat mencatat (keputusan pemilik 26 November 2026); DIPAKAI_OWNER hanya untuk pemegang inventory:manage;
 * - MASUK (beli/restock) menambah stok dan otomatis mencatat pengeluaran kas cabang kategori MINUMAN;
 * - keluar hanya DIJUAL (pemasukan penjualan minuman di laporan laba) atau DIPAKAI_OWNER (tanpa nilai);
 * - stok tidak boleh minus; catatan tidak diubah atau dihapus (riwayat utuh untuk audit).
 */
export type JenisMutasi = 'MASUK' | 'DIJUAL' | 'DIPAKAI_OWNER';
export const JENIS_MUTASI: readonly JenisMutasi[] = ['MASUK', 'DIJUAL', 'DIPAKAI_OWNER'];
export const KATEGORI_PENGELUARAN_MINUMAN = 'MINUMAN';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const MAKS_JUMLAH = 10_000;
const MAKS_HARGA = 100_000_000;

const salah = (field: string, issue: string) =>
  new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [{ field, issue }]);

/** Total penjualan minuman (DIJUAL) per cabang dalam rentang; 0 bila tabel belum ada. Dipakai laporan laba. */
export async function penjualanMinuman(
  db: { mutasiStokMinuman?: { findMany(args: unknown): Promise<Array<{ branchId: string; totalRp: number }>> } },
  input: { branchIds: string[] | null; fromDate: Date; untilExclusive: Date },
): Promise<{ totalRp: number; perCabang: Map<string, number> }> {
  const perCabang = new Map<string, number>();
  if (typeof db.mutasiStokMinuman?.findMany !== 'function') return { totalRp: 0, perCabang };
  const rows = await bacaOpsional(
    'mutasi_stok_minuman',
    () =>
      db.mutasiStokMinuman!.findMany({
        where: {
          jenis: 'DIJUAL',
          tanggal: { gte: input.fromDate, lt: input.untilExclusive },
          ...(input.branchIds ? { branchId: { in: input.branchIds } } : {}),
        },
        select: { branchId: true, totalRp: true },
      }),
    [],
  );
  let totalRp = 0;
  for (const r of rows) {
    totalRp += r.totalRp;
    perCabang.set(r.branchId, (perCabang.get(r.branchId) ?? 0) + r.totalRp);
  }
  return { totalRp, perCabang };
}

@Injectable()
export class StokMinumanService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    @Optional() private readonly audit?: AuditService,
    @Optional() @Inject(PRIVATE_FILE_STORAGE) private readonly storage?: PrivateFileStorage,
  ) {}

  private async pastikanTabel() {
    const [a, b] = await Promise.all([
      tabelOpsionalAda(this.db, 'barang_minuman'),
      tabelOpsionalAda(this.db, 'mutasi_stok_minuman'),
    ]);
    if (!a || !b) throw new ApiProblem('DRINK_STOCK_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE);
  }

  private cabangBoleh(principal: SessionPrincipal, branchId: string, cap: string) {
    if (!branchId) throw salah('branchId', 'REQUIRED');
    if (!this.policy.hasCapability(principal, 'branch:all', branchId) && !this.policy.hasCapability(principal, cap, branchId))
      throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
  }

  // ---------- Master barang ----------

  async daftarBarang(principal: SessionPrincipal, query: { semua?: string } = {}) {
    this.policy.requireAnyCapability(principal.capabilities, ['inventory:read', 'inventory:record', 'inventory:manage']);
    await this.pastikanTabel();
    const items = await this.db.barangMinuman.findMany({
      where: query.semua === '1' ? {} : { aktif: true },
      orderBy: [{ aktif: 'desc' }, { nama: 'asc' }],
      take: 500,
    });
    return { items };
  }

  private bacaBarang(input: { nama?: unknown; satuan?: unknown; hargaJualRp?: unknown }, wajib: boolean) {
    const data: { nama?: string; satuan?: string; hargaJualRp?: number | null } = {};
    if (input.nama !== undefined || wajib) {
      const nama = typeof input.nama === 'string' ? input.nama.trim() : '';
      if (nama.length < 2 || nama.length > 80) throw salah('nama', 'LENGTH');
      data.nama = nama;
    }
    if (input.satuan !== undefined || wajib) {
      const satuan = typeof input.satuan === 'string' ? input.satuan.trim().toLowerCase() : '';
      if (satuan.length < 1 || satuan.length > 20) throw salah('satuan', 'LENGTH');
      data.satuan = satuan;
    }
    if (input.hargaJualRp !== undefined) {
      if (input.hargaJualRp === null || input.hargaJualRp === '') data.hargaJualRp = null;
      else {
        const h = Number(input.hargaJualRp);
        if (!Number.isInteger(h) || h < 0 || h > MAKS_HARGA) throw salah('hargaJualRp', 'INVALID');
        data.hargaJualRp = h;
      }
    }
    return data;
  }

  async buatBarang(principal: SessionPrincipal, input: { nama?: unknown; satuan?: unknown; hargaJualRp?: unknown }) {
    this.policy.requireCapability(principal.capabilities, 'inventory:manage');
    await this.pastikanTabel();
    const data = this.bacaBarang(input, true);
    const ada = await this.db.barangMinuman.findFirst({ where: { nama: data.nama }, select: { id: true } });
    if (ada) throw new ApiProblem('DRINK_NAME_TAKEN', HttpStatus.CONFLICT, false, [{ field: 'nama', issue: 'TAKEN' }]);
    const barang = await this.db.barangMinuman.create({
      data: { id: randomUUID(), nama: data.nama!, satuan: data.satuan!, hargaJualRp: data.hargaJualRp ?? null },
    });
    await this.audit?.catat(null, {
      actorId: principal.userId,
      action: 'inventory.drink_created',
      objectType: 'BarangMinuman',
      objectId: barang.id,
      afterMasked: { nama: barang.nama, satuan: barang.satuan, hargaJualRp: barang.hargaJualRp },
    });
    return barang;
  }

  async ubahBarang(
    principal: SessionPrincipal,
    id: string,
    input: { nama?: unknown; satuan?: unknown; hargaJualRp?: unknown; aktif?: unknown },
  ) {
    this.policy.requireCapability(principal.capabilities, 'inventory:manage');
    if (!UUID.test(id)) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    await this.pastikanTabel();
    const lama = await this.db.barangMinuman.findUnique({ where: { id } });
    if (!lama) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const data: Record<string, unknown> = this.bacaBarang(input, false);
    if (input.aktif !== undefined) data.aktif = input.aktif === true || input.aktif === 'true';
    if (data.nama && data.nama !== lama.nama) {
      const ada = await this.db.barangMinuman.findFirst({ where: { nama: data.nama as string, id: { not: id } }, select: { id: true } });
      if (ada) throw new ApiProblem('DRINK_NAME_TAKEN', HttpStatus.CONFLICT, false, [{ field: 'nama', issue: 'TAKEN' }]);
    }
    const barang = await this.db.barangMinuman.update({ where: { id }, data });
    await this.audit?.catat(null, {
      actorId: principal.userId,
      action: 'inventory.drink_updated',
      objectType: 'BarangMinuman',
      objectId: id,
      beforeMasked: { nama: lama.nama, satuan: lama.satuan, hargaJualRp: lama.hargaJualRp, aktif: lama.aktif },
      afterMasked: { nama: barang.nama, satuan: barang.satuan, hargaJualRp: barang.hargaJualRp, aktif: barang.aktif },
    });
    return barang;
  }

  // ---------- Stok ----------

  private async stokMap(branchId: string, barangIds?: string[]) {
    const rows = await this.db.mutasiStokMinuman.groupBy({
      by: ['barangId', 'jenis'],
      where: { branchId, ...(barangIds ? { barangId: { in: barangIds } } : {}) },
      _sum: { jumlah: true },
    });
    const stok = new Map<string, number>();
    for (const r of rows) {
      const n = r._sum.jumlah ?? 0;
      stok.set(r.barangId, (stok.get(r.barangId) ?? 0) + (r.jenis === 'MASUK' ? n : -n));
    }
    return stok;
  }

  async stok(principal: SessionPrincipal, query: { branchId?: string }) {
    this.policy.requireAnyCapability(principal.capabilities, ['inventory:read', 'inventory:record', 'inventory:manage']);
    const branchId = query.branchId ?? '';
    this.cabangBoleh(principal, branchId, 'inventory:read');
    await this.pastikanTabel();
    const [barang, stok] = await Promise.all([
      this.db.barangMinuman.findMany({ orderBy: [{ aktif: 'desc' }, { nama: 'asc' }], take: 500 }),
      this.stokMap(branchId),
    ]);
    return {
      branchId,
      items: barang
        .filter((b) => b.aktif || (stok.get(b.id) ?? 0) !== 0)
        .map((b) => ({ barang: b, stok: stok.get(b.id) ?? 0 })),
    };
  }

  async riwayat(principal: SessionPrincipal, query: { branchId?: string; barangId?: string; cursor?: string; limit?: string }) {
    this.policy.requireAnyCapability(principal.capabilities, ['inventory:read', 'inventory:record', 'inventory:manage']);
    const branchId = query.branchId ?? '';
    this.cabangBoleh(principal, branchId, 'inventory:read');
    await this.pastikanTabel();
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 30));
    const rows = await this.db.mutasiStokMinuman.findMany({
      where: { branchId, ...(query.barangId && UUID.test(query.barangId) ? { barangId: query.barangId } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor && UUID.test(query.cursor) ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const lebih = rows.length > limit;
    const dipakai = lebih ? rows.slice(0, limit) : rows;
    const [barang, orang] = await Promise.all([
      this.db.barangMinuman.findMany({ where: { id: { in: [...new Set(dipakai.map((r) => r.barangId))] } }, select: { id: true, nama: true, satuan: true } }),
      this.db.user.findMany({
        where: { id: { in: [...new Set(dipakai.map((r) => r.createdById).filter((x): x is string => Boolean(x)))] } },
        select: { id: true, displayName: true },
      }),
    ]);
    const b = new Map(barang.map((x) => [x.id, x]));
    const o = new Map(orang.map((x) => [x.id, x.displayName]));
    return {
      items: dipakai.map((r) => ({
        ...r,
        tanggal: r.tanggal.toISOString().slice(0, 10),
        namaBarang: b.get(r.barangId)?.nama ?? 'Barang',
        satuan: b.get(r.barangId)?.satuan ?? '',
        oleh: r.createdById ? (o.get(r.createdById) ?? null) : null,
      })),
      nextCursor: lebih ? dipakai.at(-1)!.id : null,
    };
  }

  async catat(
    principal: SessionPrincipal,
    input: {
      branchId?: unknown;
      barangId?: unknown;
      jenis?: unknown;
      jumlah?: unknown;
      hargaSatuanRp?: unknown;
      tanggal?: unknown;
      catatan?: unknown;
    },
    now = new Date(),
    berkasNota?: BerkasNota,
  ) {
    this.policy.requireCapability(principal.capabilities, 'inventory:record');
    const branchId = typeof input.branchId === 'string' ? input.branchId : '';
    this.cabangBoleh(principal, branchId, 'inventory:record');
    const barangId = typeof input.barangId === 'string' ? input.barangId : '';
    if (!UUID.test(barangId)) throw salah('barangId', 'REQUIRED');
    const jenis = input.jenis as JenisMutasi;
    if (!JENIS_MUTASI.includes(jenis)) throw salah('jenis', 'INVALID');
    const jumlah = Number(input.jumlah);
    if (!Number.isInteger(jumlah) || jumlah < 1 || jumlah > MAKS_JUMLAH) throw salah('jumlah', 'INVALID');
    const tanggal = typeof input.tanggal === 'string' && input.tanggal ? input.tanggal : tanggalWib(now);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal) || Number.isNaN(Date.parse(`${tanggal}T00:00:00Z`)) || tanggal > tanggalWib(now))
      throw salah('tanggal', 'INVALID');
    const catatan = typeof input.catatan === 'string' ? input.catatan.trim().slice(0, 200) || null : null;
    await this.pastikanTabel();

    const barang = await this.db.barangMinuman.findUnique({ where: { id: barangId } });
    if (!barang) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (!barang.aktif && jenis === 'MASUK') throw new ApiProblem('DRINK_INACTIVE', HttpStatus.CONFLICT);

    if (jenis === 'DIPAKAI_OWNER') this.policy.requireCapability(principal.capabilities, 'inventory:manage');
    let hargaSatuanRp = 0;
    if (jenis === 'DIJUAL') {
      // Harga jual ditetapkan studio di master barang; harga kiriman klien diabaikan.
      if (!barang.hargaJualRp || barang.hargaJualRp <= 0)
        throw new ApiProblem('DRINK_PRICE_NOT_SET', HttpStatus.CONFLICT, false, [{ field: 'hargaJualRp', issue: 'REQUIRED' }]);
      hargaSatuanRp = barang.hargaJualRp;
    } else if (jenis === 'MASUK') {
      const mentah = input.hargaSatuanRp;
      const h = Number(mentah);
      if (mentah === undefined || mentah === null || mentah === '' || !Number.isInteger(h) || h < 0 || h > MAKS_HARGA)
        throw salah('hargaSatuanRp', 'REQUIRED');
      hargaSatuanRp = h;
    }
    const totalRp = hargaSatuanRp * jumlah;
    const hari = new Date(`${tanggal}T00:00:00.000Z`);
    const id = randomUUID();
    // Pembelian stok adalah pengeluaran cabang: nota wajib, sama seperti pengeluaran di Jurnal kas.
    const nota = jenis === 'MASUK' ? periksaNota(berkasNota) : null;
    const biayaId = randomUUID();
    const hapusNota = nota && totalRp > 0 ? await simpanBerkasNota(this.storage, biayaId, nota) : null;

    let hasil;
    try {
      hasil = await this.db.$transaction(async (tx) => {
      // Satu pencatatan per barang per cabang pada satu waktu, supaya dua kasir tidak menjual stok terakhir.
      if (typeof (tx as { $queryRaw?: unknown }).$queryRaw === 'function')
        await tx.$queryRaw`SELECT id FROM barang_minuman WHERE id = ${barangId} FOR UPDATE`;
      if (jenis !== 'MASUK') {
        const stokKini = (await this.stokMapTx(tx, branchId, barangId)) ?? 0;
        if (stokKini < jumlah)
          throw new ApiProblem('DRINK_STOCK_INSUFFICIENT', HttpStatus.CONFLICT, false, [
            { field: 'jumlah', issue: `STOK_${stokKini}` },
          ]);
      }
      let otherCostId: string | null = null;
      if (jenis === 'MASUK' && totalRp > 0) {
        const biaya = await tx.otherCost.create({
          data: {
            id: biayaId,
            branchId,
            period: tanggal.slice(0, 7),
            incurredOn: hari,
            category: KATEGORI_PENGELUARAN_MINUMAN,
            description: `Beli minuman: ${barang.nama} ${jumlah} ${barang.satuan} x Rp${hargaSatuanRp.toLocaleString('id-ID')}${catatan ? ` (${catatan})` : ''}`.slice(0, 2000),
            amountRp: totalRp,
            createdById: principal.userId || null,
          },
        });
        otherCostId = biaya.id;
      }
      const mutasi = await tx.mutasiStokMinuman.create({
        data: {
          id,
          barangId,
          branchId,
          jenis,
          jumlah,
          hargaSatuanRp,
          totalRp,
          tanggal: hari,
          catatan,
          otherCostId,
          createdById: principal.userId || null,
        },
      });
      await this.audit?.catat(tx, {
        actorId: principal.userId,
        branchId,
        action: `inventory.drink_${jenis.toLowerCase()}`,
        objectType: 'MutasiStokMinuman',
        objectId: id,
        afterMasked: { barangId, jenis, jumlah, hargaSatuanRp, totalRp, tanggal, otherCostId },
      });
      const stokSesudah = (await this.stokMapTx(tx, branchId, barangId)) ?? 0;
      return { ...mutasi, tanggal, stokSesudah, namaBarang: barang.nama, satuan: barang.satuan };
    });
    } catch (error) {
      await hapusNota?.();
      throw error;
    }
    if (nota && hasil.otherCostId)
      await catatNota(this.db as never, this.db, {
        otherCostId: hasil.otherCostId,
        ext: nota.jenis.ext,
        mimeType: nota.jenis.mime,
        ukuranByte: nota.buffer.length,
        diunggahOleh: principal.userId || null,
      });
    return hasil;
  }

  private async stokMapTx(tx: Pick<PrismaService, 'mutasiStokMinuman'>, branchId: string, barangId: string) {
    const rows = await tx.mutasiStokMinuman.groupBy({
      by: ['jenis'],
      where: { branchId, barangId },
      _sum: { jumlah: true },
    });
    return rows.reduce((s, r) => s + (r.jenis === 'MASUK' ? 1 : -1) * (r._sum.jumlah ?? 0), 0);
  }
}
