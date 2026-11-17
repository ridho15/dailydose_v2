import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { tabelOpsionalAda } from '../foundation/tabel-opsional';
import type { SessionPrincipal } from '../identity/identity.service';
import { ApiProblem } from '../identity/security';
import { maksTemanPaket } from './bawa-teman';
import { whereDaftarPaket, type FilterPaket } from './filter-paket';
import { MAKS_TEMAN_PAKET, statusEfektif } from './katalog-paket.service';
import { masaJualPaket } from './masa-jual';
import { PackageAccessService } from './package-access.service';
import { paketPerpanjanganIds } from './perpanjangan-masa-aktif';

/** Batas satu kali aksi massal; katalog saat ini ±160 paket. */
export const MAKS_PAKET_MASSAL = 500;
export const AKSI_AUDIT_MAKS_TEMAN = 'PACKAGE_MAX_FRIENDS_UPDATED';

export interface KandidatMaksTeman {
  id: string;
  name: string;
  businessKey: string;
  status: string;
  effectiveState: string;
  effectiveUntil: string | null;
  maksTeman: number;
  perpanjanganMasaAktif: boolean;
}

const tidakValid = (field: string, issue: string) =>
  new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [{ field, issue }]);

/**
 * Edit massal "Maksimal teman per kelas" di Kelola Paket. Ini metadata paket (tabel terpisah
 * `paket_bawa_teman`), bukan revisi harga/sesi: tidak ada paket baru, order lama tidak berubah, dan
 * paket member yang sudah dibeli langsung memakai nilai baru untuk booking berikutnya.
 * Izin sama dengan mengedit paket (`master:manage`).
 */
@Injectable()
export class MaksTemanMassalService {
  constructor(
    private readonly db: PrismaService,
    private readonly access: PackageAccessService,
  ) {}

  /** Seluruh paket yang cocok dengan filter Kelola Paket, untuk "Pilih semua hasil filter". */
  async kandidat(principal: SessionPrincipal, filter: FilterPaket): Promise<{ items: KandidatMaksTeman[] }> {
    this.access.catalog(principal, true);
    const { where } = await whereDaftarPaket(this.db, filter);
    const rows: Array<{ id: string; name: string; code: string; status: string }> =
      await this.db.paket.findMany({
        where,
        select: { id: true, name: true, code: true, status: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: MAKS_PAKET_MASSAL + 1,
      });
    if (rows.length > MAKS_PAKET_MASSAL)
      throw new ApiProblem('BULK_SELECTION_TOO_LARGE', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'filter', issue: `MAX_${MAKS_PAKET_MASSAL}` },
      ]);
    return { items: await this.ringkas(this.db, rows) };
  }

  private async ringkas(
    db: any,
    rows: Array<{ id: string; name: string; code: string; status: string }>,
  ): Promise<KandidatMaksTeman[]> {
    const ids = rows.map((r) => r.id);
    const [teman, masa, perpanjangan] = await Promise.all([
      maksTemanPaket(db, ids),
      masaJualPaket(db, ids),
      paketPerpanjanganIds(db, ids),
    ]);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      businessKey: r.code,
      status: r.status,
      effectiveState: statusEfektif(r.status, masa.get(r.id)),
      effectiveUntil: masa.get(r.id)?.berakhir?.toISOString() ?? null,
      maksTeman: teman.get(r.id) ?? 0,
      perpanjanganMasaAktif: perpanjangan.has(r.id),
    }));
  }

  /**
   * Menyimpan nilai yang sama untuk banyak paket dalam satu transaksi. Satu entri audit per paket
   * (nilai lama, nilai baru, alasan, ID batch). Bila satu paket gagal, semuanya batal dan galat
   * menyebut paket mana beserta sebabnya (`details[].field` = ID paket).
   */
  async simpan(
    principal: SessionPrincipal,
    body: { packageIds?: unknown; maksTeman?: unknown; reason?: unknown },
  ) {
    this.access.catalog(principal, true);
    const maksTeman = Number(body?.maksTeman);
    if (body?.maksTeman === undefined || body?.maksTeman === null || body?.maksTeman === '')
      throw tidakValid('maksTeman', 'REQUIRED');
    if (!Number.isInteger(maksTeman) || maksTeman < 0 || maksTeman > MAKS_TEMAN_PAKET)
      throw tidakValid('maksTeman', 'INVALID_RANGE');
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 3) throw tidakValid('reason', 'REQUIRED');
    if (reason.length > 500) throw tidakValid('reason', 'TOO_LONG');
    const daftar = Array.isArray(body?.packageIds) ? body.packageIds : [];
    const ids = [...new Set(daftar.filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64))];
    if (!ids.length || ids.length !== daftar.length) throw tidakValid('packageIds', 'REQUIRED');
    if (ids.length > MAKS_PAKET_MASSAL) throw tidakValid('packageIds', `MAX_${MAKS_PAKET_MASSAL}`);
    if (!(await tabelOpsionalAda(this.db, 'paket_bawa_teman')))
      throw new ApiProblem('PACKAGE_FRIENDS_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE);

    const batchId = randomUUID();
    const gagal = (rincian: Array<{ field: string; issue: string }>) =>
      new ApiProblem('BULK_UPDATE_FAILED', HttpStatus.UNPROCESSABLE_ENTITY, false, rincian);

    return this.db.$transaction(
      async (tx: any) => {
        const rows: Array<{ id: string; name: string; code: string; status: string; branchId: string | null }> =
          await tx.paket.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true, code: true, status: true, branchId: true },
          });
        const ada = new Map(rows.map((r) => [r.id, r]));
        const perpanjangan = await paketPerpanjanganIds(tx, ids);
        const masalah = [
          ...ids.filter((id) => !ada.has(id)).map((id) => ({ field: id, issue: 'NOT_FOUND' })),
          // Paket perpanjangan tidak punya sesi, jadi tidak bisa membawa teman.
          ...(maksTeman > 0
            ? ids.filter((id) => perpanjangan.has(id)).map((id) => ({ field: id, issue: 'EXTENSION_PACKAGE' }))
            : []),
        ];
        if (masalah.length) throw gagal(masalah);

        const lama = await maksTemanPaket(tx, ids);
        const hasil: Array<{ id: string; name: string; sebelum: number; sesudah: number }> = [];
        for (const id of ids) {
          const paket = ada.get(id)!;
          const sebelum = lama.get(id) ?? 0;
          try {
            if (maksTeman === 0) await tx.paketBawaTeman.deleteMany({ where: { packageId: id } });
            else
              await tx.paketBawaTeman.upsert({
                where: { packageId: id },
                create: { packageId: id, maksTeman, updatedById: principal.userId },
                update: { maksTeman, updatedById: principal.userId },
              });
          } catch {
            // Seluruh transaksi batal; sebutkan paket tempat penulisan gagal.
            throw gagal([{ field: id, issue: 'WRITE_FAILED' }]);
          }
          // Ditulis langsung (bukan AuditService yang menelan galat): audit gagal = semuanya batal.
          try {
            await tx.auditLog.create({
              data: {
                id: randomUUID(),
                action: AKSI_AUDIT_MAKS_TEMAN,
                actorId: principal.userId,
                branchId: paket.branchId,
                correlationId: batchId,
                reason,
                objectType: 'Package',
                objectId: id,
                detail: {
                  before: { maksTeman: sebelum },
                  after: { maksTeman, batchId, jumlahPaket: ids.length },
                },
              },
            });
          } catch {
            throw gagal([{ field: id, issue: 'AUDIT_FAILED' }]);
          }
          hasil.push({ id, name: paket.name, sebelum, sesudah: maksTeman });
        }
        return { batchId, maksTeman, updated: hasil };
      },
      { timeout: 60_000 },
    );
  }
}
