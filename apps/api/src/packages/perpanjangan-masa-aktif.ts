import { HttpStatus } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { bacaOpsional, tabelOpsionalAda } from '../foundation/tabel-opsional';
import { ApiProblem, ENTITY_ID_REGEX } from '../identity/security';
import { akhirHariWib } from '../foundation/masa-berlaku';
import { tanggalWib } from './instructor-fee-calculator';

/**
 * Paket "Perpanjangan masa aktif" (keputusan pemilik, November 2026):
 * - Paket 0 sesi; setelah lunas menambah masa berlaku SATU Paket Pelanggan milik member yang sama
 *   sebanyak 30 hari, dihitung dari tanggal berakhir saat itu (bukan dari hari ini).
 * - Paling banyak 3 kali per Paket Pelanggan.
 * - Untuk paket yang masih aktif: status ACTIVE, belum lewat masa berlaku, sisa sesi > 0.
 *   Diperiksa saat pesanan dibuat dan sekali lagi saat pembayaran disetujui.
 * - Paket yang sudah kedaluwarsa tetapi masih bersisa sesi (25 November 2026): hanya lewat staf,
 *   wajib bukti pembayaran saat disetujui, berlaku 30 hari dari hari disetujui, status kembali ACTIVE.
 * - Pembelian perpanjangan tidak membuat Paket Pelanggan baru (paket 0 sesi hanya akan muncul di
 *   pilihan booking dan daftar paket member sebagai paket kosong).
 *
 * Penanda paket ada di `paket_perpanjangan`, catatan per pembelian di `perpanjangan_paket`; tabel lama
 * tidak berubah. Bila tabel penanda belum dibuat, tidak ada paket yang dianggap perpanjangan.
 */
export const HARI_PERPANJANGAN = 30;
export const MAKS_PERPANJANGAN = 3;
/**
 * Paket perpanjangan baru bisa dibeli bila paket target tinggal sekian hari lagi sebelum berakhir
 * dan masih ada sesinya (keputusan pemilik 24 November 2026).
 */
export const JENDELA_PERPANJANGAN_HARI = 14;
const HARI_MS = 86_400_000;

type Db = any;

type CatatanPerpanjangan = {
  id: string;
  purchaseId: string;
  targetCustomerPackageId: string;
  userId: string;
  hari: number;
  validUntilBefore: Date | null;
  validUntilAfter: Date | null;
  appliedAt: Date | null;
  rolledBackAt: Date | null;
};

type PaketTarget = {
  id: string;
  userId: string;
  status: string;
  validUntil: Date;
  remainingSessions: number;
};

/** `perpanjanganMasaAktif` dari form paket: true/false mengubah, selain itu dibiarkan. */
export function bacaTandaPerpanjangan(body: any): boolean | undefined {
  const nilai = body?.perpanjanganMasaAktif;
  if (nilai === true || nilai === 'true') return true;
  if (nilai === false || nilai === 'false') return false;
  return undefined;
}

/** Paket (definisi) mana saja yang berjenis perpanjangan masa aktif. */
export async function paketPerpanjanganIds(
  db: Db,
  packageIds: readonly (string | null | undefined)[],
): Promise<Set<string>> {
  const ids = [...new Set(packageIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length || typeof db?.paketPerpanjangan?.findMany !== 'function') return new Set();
  const rows = await bacaOpsional<Array<{ packageId: string }>>(
    'paket_perpanjangan',
    () => db.paketPerpanjangan.findMany({ where: { packageId: { in: ids } }, select: { packageId: true } }),
    [],
  );
  return new Set(rows.map((r) => r.packageId));
}

export async function adalahPaketPerpanjangan(db: Db, packageId: string): Promise<boolean> {
  return (await paketPerpanjanganIds(db, [packageId])).has(packageId);
}

/**
 * Menyimpan centang "Perpanjangan masa aktif" di form paket. Mencentang tanpa tabelnya ditolak
 * (paket 0 sesi tanpa penanda akan terjual sebagai paket biasa yang kosong); melepas centang tanpa
 * tabel tidak perlu apa-apa.
 */
export async function simpanTandaPerpanjangan(
  tx: Db,
  packageId: string,
  nilai: boolean | undefined,
  actorId: string,
): Promise<boolean | undefined> {
  if (nilai === undefined) return undefined;
  if (typeof tx.paketPerpanjangan?.upsert !== 'function' || !(await tabelOpsionalAda(tx, 'paket_perpanjangan'))) {
    if (nilai) throw new ApiProblem('PACKAGE_EXTENSION_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE);
    return undefined;
  }
  if (nilai)
    await tx.paketPerpanjangan.upsert({
      where: { packageId },
      create: { packageId, updatedById: actorId },
      update: { updatedById: actorId },
    });
  else await tx.paketPerpanjangan.deleteMany({ where: { packageId } });
  return nilai;
}

/** Paket perpanjangan wajib 0 sesi; paket biasa wajib minimal 1 sesi. */
export function cekSesiPaketPerpanjangan(perpanjangan: boolean, sessionCount: number) {
  if (perpanjangan && sessionCount !== 0)
    throw new ApiProblem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST, false, [
      { field: 'sessionCount', issue: 'EXTENSION_MUST_BE_ZERO' },
    ]);
  if (!perpanjangan && !(Number.isInteger(sessionCount) && sessionCount >= 1))
    throw new ApiProblem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST, false, [
      { field: 'sessionCount', issue: 'INVALID' },
    ]);
}

/** Paket aktif yang masa berlakunya tinggal paling lama JENDELA_PERPANJANGAN_HARI. */
export function dalamJendelaPerpanjangan(cp: Pick<PaketTarget, 'validUntil'>, now: Date) {
  return cp.validUntil.getTime() - now.getTime() <= JENDELA_PERPANJANGAN_HARI * HARI_MS;
}

export function paketMasihAktif(cp: Pick<PaketTarget, 'status' | 'validUntil' | 'remainingSessions'>, now: Date) {
  return cp.status === 'ACTIVE' && cp.validUntil.getTime() > now.getTime() && cp.remainingSessions > 0;
}

/**
 * Paket yang sudah lewat masa berlaku tetapi masih punya sesi (keputusan pemilik 25 November 2026):
 * boleh diperpanjang berbayar lewat staf, wajib bukti pembayaran saat disetujui. Paket beku atau
 * habis sesinya tidak termasuk.
 */
export function paketKedaluwarsaBersisa(cp: Pick<PaketTarget, 'status' | 'validUntil' | 'remainingSessions'>, now: Date) {
  if (cp.remainingSessions <= 0) return false;
  return cp.status === 'EXPIRED' || (cp.status === 'ACTIVE' && cp.validUntil.getTime() <= now.getTime());
}

/** Masa berlaku baru: paket aktif ditambah dari tanggal berakhirnya; paket kedaluwarsa dari hari ini (akhir hari WIB). */
export function masaBerlakuSetelahPerpanjangan(cp: Pick<PaketTarget, 'validUntil'>, hari: number, now: Date) {
  if (cp.validUntil.getTime() > now.getTime()) return new Date(cp.validUntil.getTime() + hari * HARI_MS);
  return akhirHariWib(tanggalWib(new Date(now.getTime() + hari * HARI_MS)))!;
}

async function kunciPaket(tx: Db, id: string) {
  if (typeof tx.$queryRaw === 'function')
    await tx.$queryRaw`SELECT id FROM paket_pelanggan WHERE id = ${id} FOR UPDATE`;
}

/**
 * Jumlah perpanjangan per Paket Pelanggan: `terpakai` sudah diterapkan dan tidak ditarik, `menunggu`
 * pesanan yang belum lunas tetapi masih bisa disetujui (PENDING / WAITING_VERIFICATION).
 */
async function hitungPerpanjangan(
  db: Db,
  targetIds: readonly string[],
): Promise<Map<string, { terpakai: number; menunggu: number }>> {
  const hasil = new Map(targetIds.map((id) => [id, { terpakai: 0, menunggu: 0 }]));
  if (!targetIds.length || typeof db?.perpanjanganPaket?.findMany !== 'function') return hasil;
  const rows = await bacaOpsional<CatatanPerpanjangan[]>(
    'perpanjangan_paket',
    () => db.perpanjanganPaket.findMany({ where: { targetCustomerPackageId: { in: [...targetIds] } } }),
    [],
  );
  const belumLunas = rows.filter((r) => !r.appliedAt).map((r) => r.purchaseId);
  const menunggu = new Set<string>(
    belumLunas.length
      ? (
          await db.pembelian.findMany({
            where: { id: { in: belumLunas }, status: { in: ['PENDING', 'WAITING_VERIFICATION'] } },
            select: { id: true },
          })
        ).map((p: { id: string }) => p.id)
      : [],
  );
  for (const r of rows) {
    const angka = hasil.get(r.targetCustomerPackageId);
    if (!angka) continue;
    if (r.appliedAt && !r.rolledBackAt) angka.terpakai += 1;
    else if (!r.appliedAt && menunggu.has(r.purchaseId)) angka.menunggu += 1;
  }
  return hasil;
}

/** Paket aktif milik member yang bisa dipilih untuk diperpanjang (pilihan di checkout dan meja). */
export async function pilihanTargetPerpanjangan(
  db: Db,
  userId: string,
  now = new Date(),
  opsi: { staf?: boolean } = {},
) {
  const hampirBerakhir = {
    status: 'ACTIVE',
    validUntil: { gt: now, lte: new Date(now.getTime() + JENDELA_PERPANJANGAN_HARI * HARI_MS) },
  };
  // Staf juga melihat paket yang sudah kedaluwarsa tetapi masih bersisa sesi.
  const kedaluwarsa = [{ status: 'EXPIRED' }, { status: 'ACTIVE', validUntil: { lte: now } }];
  const paket: Array<PaketTarget & { totalSessions: number; package: { name: string } | null }> =
    await db.paketPelanggan.findMany({
      where: {
        userId,
        remainingSessions: { gt: 0 },
        ...(opsi.staf ? { OR: [hampirBerakhir, ...kedaluwarsa] } : hampirBerakhir),
      },
      include: { package: { select: { name: true } } },
      orderBy: [{ validUntil: 'asc' }, { id: 'asc' }],
      take: 50,
    });
  const angka = await hitungPerpanjangan(db, paket.map((p) => p.id));
  return paket.map((p) => {
    const { terpakai, menunggu } = angka.get(p.id) ?? { terpakai: 0, menunggu: 0 };
    return {
      customerPackageId: p.id,
      packageName: p.package?.name ?? 'Paket',
      remainingSessions: p.remainingSessions,
      totalSessions: p.totalSessions,
      validUntil: p.validUntil,
      /** Sudah lewat masa berlaku: perpanjangan wajib bukti bayar dan dihitung dari hari disetujui. */
      kedaluwarsa: paketKedaluwarsaBersisa(p, now),
      validUntilAfterExtension: masaBerlakuSetelahPerpanjangan(p, HARI_PERPANJANGAN, now),
      extensionsUsed: terpakai,
      extensionsPending: menunggu,
      extensionsLeft: Math.max(0, MAKS_PERPANJANGAN - terpakai - menunggu),
    };
  });
}

/**
 * Pemeriksaan saat pesanan perpanjangan dibuat (member atau staf). Mengunci baris paket target supaya
 * dua pesanan bersamaan tidak sama-sama lolos batas 3 kali.
 */
export async function periksaTargetPerpanjangan(
  tx: Db,
  targetId: unknown,
  userId: string,
  now: Date,
  opsi: { staf?: boolean } = {},
): Promise<PaketTarget> {
  if (typeof targetId !== 'string' || !ENTITY_ID_REGEX.test(targetId))
    throw new ApiProblem('PACKAGE_EXTENSION_TARGET_REQUIRED', HttpStatus.UNPROCESSABLE_ENTITY, false, [
      { field: 'targetCustomerPackageId', issue: 'REQUIRED' },
    ]);
  if (typeof tx.perpanjanganPaket?.create !== 'function' || !(await tabelOpsionalAda(tx, 'perpanjangan_paket')))
    throw new ApiProblem('PACKAGE_EXTENSION_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE);
  await kunciPaket(tx, targetId);
  const cp: PaketTarget | null = await tx.paketPelanggan.findUnique({ where: { id: targetId } });
  if (!cp || cp.userId !== userId)
    throw new ApiProblem('PACKAGE_EXTENSION_TARGET_NOT_FOUND', HttpStatus.NOT_FOUND);
  const kedaluwarsa = paketKedaluwarsaBersisa(cp, now);
  if (!paketMasihAktif(cp, now) && !(opsi.staf && kedaluwarsa))
    throw new ApiProblem('PACKAGE_EXTENSION_TARGET_EXPIRED', HttpStatus.CONFLICT);
  // Saat pesanan dibuat saja; persetujuan pembayaran yang datang belakangan tidak dicek ulang.
  if (!kedaluwarsa && !dalamJendelaPerpanjangan(cp, now))
    throw new ApiProblem('PACKAGE_EXTENSION_TOO_EARLY', HttpStatus.CONFLICT);
  const { terpakai, menunggu } = (await hitungPerpanjangan(tx, [cp.id])).get(cp.id)!;
  if (terpakai >= MAKS_PERPANJANGAN)
    throw new ApiProblem('PACKAGE_EXTENSION_LIMIT_REACHED', HttpStatus.CONFLICT);
  if (terpakai + menunggu >= MAKS_PERPANJANGAN)
    throw new ApiProblem('PACKAGE_EXTENSION_PENDING_LIMIT', HttpStatus.CONFLICT);
  return cp;
}

/** Mencatat paket target untuk pesanan yang baru dibuat; perpanjangannya diterapkan saat lunas. */
export async function catatPerpanjangan(
  tx: Db,
  data: { purchaseId: string; targetCustomerPackageId: string; userId: string; actorId: string },
) {
  return tx.perpanjanganPaket.create({
    data: {
      id: randomUUID(),
      purchaseId: data.purchaseId,
      targetCustomerPackageId: data.targetCustomerPackageId,
      userId: data.userId,
      hari: HARI_PERPANJANGAN,
      createdById: data.actorId,
    },
  });
}

/**
 * Menerapkan perpanjangan saat pembelian disetujui (PAID). Sekali saja per pembelian: baris diklaim
 * dengan `appliedAt IS NULL`, sehingga persetujuan ganda tidak memperpanjang dua kali. Paket yang
 * sudah hangus saat disetujui ditolak; staf bisa menolak pembayaran lalu mengembalikan dananya.
 */
export async function terapkanPerpanjangan(
  tx: Db,
  purchaseId: string,
  now: Date,
  opsi: { adaBukti?: boolean } = {},
): Promise<CatatanPerpanjangan> {
  if (typeof tx.perpanjanganPaket?.findUnique !== 'function' || !(await tabelOpsionalAda(tx, 'perpanjangan_paket')))
    throw new ApiProblem('PACKAGE_EXTENSION_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE);
  const catatan: CatatanPerpanjangan | null = await tx.perpanjanganPaket.findUnique({ where: { purchaseId } });
  if (!catatan) throw new ApiProblem('PACKAGE_EXTENSION_TARGET_REQUIRED', HttpStatus.CONFLICT);
  if (catatan.appliedAt) return catatan;

  await kunciPaket(tx, catatan.targetCustomerPackageId);
  const cp: PaketTarget | null = await tx.paketPelanggan.findUnique({
    where: { id: catatan.targetCustomerPackageId },
  });
  if (!cp || cp.userId !== catatan.userId)
    throw new ApiProblem('PACKAGE_EXTENSION_TARGET_NOT_FOUND', HttpStatus.CONFLICT);
  const kedaluwarsa = paketKedaluwarsaBersisa(cp, now);
  if (!paketMasihAktif(cp, now) && !kedaluwarsa)
    throw new ApiProblem('PACKAGE_EXTENSION_TARGET_EXPIRED', HttpStatus.CONFLICT);
  // Paket yang sudah kedaluwarsa hanya dihidupkan kembali bila ada bukti pembayaran.
  if (kedaluwarsa && !opsi.adaBukti)
    throw new ApiProblem('PACKAGE_EXTENSION_PROOF_REQUIRED', HttpStatus.CONFLICT);
  const { terpakai } = (await hitungPerpanjangan(tx, [cp.id])).get(cp.id)!;
  if (terpakai >= MAKS_PERPANJANGAN)
    throw new ApiProblem('PACKAGE_EXTENSION_LIMIT_REACHED', HttpStatus.CONFLICT);

  const validUntilAfter = masaBerlakuSetelahPerpanjangan(cp, catatan.hari, now);
  const klaim = await tx.perpanjanganPaket.updateMany({
    where: { purchaseId, appliedAt: null },
    data: { appliedAt: now, validUntilBefore: cp.validUntil, validUntilAfter },
  });
  if (klaim.count === 0) return (await tx.perpanjanganPaket.findUnique({ where: { purchaseId } })) ?? catatan;
  await tx.paketPelanggan.update({
    where: { id: cp.id },
    data: { validUntil: validUntilAfter, ...(kedaluwarsa ? { status: 'ACTIVE' } : {}) },
  });
  // Riwayat sesi paket: supaya perpanjangan berbayar ikut tampil di log masa berlaku terpusat.
  if (typeof tx.sessionLedger?.create === 'function')
    await tx.sessionLedger.create({
      data: {
        customerPackageId: cp.id,
        type: 'ADJUST_MANUAL',
        amount: 0,
        balanceAfter: cp.remainingSessions,
        referenceId: purchaseId,
        notes: `Perpanjangan masa aktif berbayar +${catatan.hari} hari (hingga ${tanggalWib(validUntilAfter)})${kedaluwarsa ? ', paket kedaluwarsa diaktifkan kembali' : ''}`,
        createdById: null,
      },
    });
  return { ...catatan, appliedAt: now, validUntilBefore: cp.validUntil, validUntilAfter };
}

/** Catatan perpanjangan satu pembelian (null bila bukan pembelian perpanjangan atau tabel belum ada). */
export async function perpanjanganPembelian(db: Db, purchaseId: string): Promise<CatatanPerpanjangan | null> {
  if (typeof db?.perpanjanganPaket?.findUnique !== 'function') return null;
  return bacaOpsional('perpanjangan_paket', () => db.perpanjanganPaket.findUnique({ where: { purchaseId } }), null);
}

/** Info perpanjangan untuk tampilan pesanan (member dan staf), per id pembelian. */
export async function infoPerpanjangan(db: Db, purchaseIds: readonly string[]) {
  const ids = [...new Set(purchaseIds.filter(Boolean))];
  if (!ids.length || typeof db?.perpanjanganPaket?.findMany !== 'function') return new Map();
  const rows = await bacaOpsional<CatatanPerpanjangan[]>(
    'perpanjangan_paket',
    () => db.perpanjanganPaket.findMany({ where: { purchaseId: { in: ids } } }),
    [],
  );
  if (!rows.length) return new Map();
  const paket: Array<{ id: string; validUntil: Date; package: { name: string } | null }> =
    await db.paketPelanggan.findMany({
      where: { id: { in: rows.map((r) => r.targetCustomerPackageId) } },
      select: { id: true, validUntil: true, package: { select: { name: true } } },
    });
  const byId = new Map(paket.map((p) => [p.id, p]));
  return new Map(
    rows.map((r) => [
      r.purchaseId,
      {
        targetCustomerPackageId: r.targetCustomerPackageId,
        targetPackageName: byId.get(r.targetCustomerPackageId)?.package?.name ?? null,
        targetValidUntil: byId.get(r.targetCustomerPackageId)?.validUntil ?? null,
        days: r.hari,
        appliedAt: r.appliedAt,
        validUntilBefore: r.validUntilBefore,
        validUntilAfter: r.validUntilAfter,
        rolledBackAt: r.rolledBackAt,
      },
    ]),
  );
}

/**
 * Menarik kembali perpanjangan saat pembeliannya dibatalkan (void) Super Owner: masa berlaku paket
 * target dikurangi jumlah hari yang dulu ditambahkan, sekali saja. Dikurangi dari tanggal berakhir
 * saat ini (bukan dikembalikan ke tanggal lama) supaya perubahan lain sesudahnya (mis. buka bekuan)
 * tidak hilang. Tanpa tabel atau tanpa perpanjangan yang diterapkan: tidak ada yang ditarik.
 */
export async function tarikPerpanjangan(
  tx: Db,
  purchaseId: string,
  now: Date,
): Promise<{ customerPackageId: string; hari: number; validUntilBefore: Date; validUntilAfter: Date } | null> {
  if (typeof tx.perpanjanganPaket?.findUnique !== 'function' || !(await tabelOpsionalAda(tx, 'perpanjangan_paket')))
    return null;
  const catatan: CatatanPerpanjangan | null = await tx.perpanjanganPaket.findUnique({ where: { purchaseId } });
  if (!catatan?.appliedAt || catatan.rolledBackAt) return null;
  const klaim = await tx.perpanjanganPaket.updateMany({
    where: { purchaseId, rolledBackAt: null },
    data: { rolledBackAt: now },
  });
  if (klaim.count === 0) return null;
  await kunciPaket(tx, catatan.targetCustomerPackageId);
  const cp: PaketTarget | null = await tx.paketPelanggan.findUnique({
    where: { id: catatan.targetCustomerPackageId },
  });
  if (!cp) return null;
  const validUntilAfter = new Date(cp.validUntil.getTime() - catatan.hari * HARI_MS);
  await tx.paketPelanggan.update({ where: { id: cp.id }, data: { validUntil: validUntilAfter } });
  return { customerPackageId: cp.id, hari: catatan.hari, validUntilBefore: cp.validUntil, validUntilAfter };
}
