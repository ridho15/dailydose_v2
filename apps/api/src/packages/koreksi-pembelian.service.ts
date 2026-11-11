import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { SessionMutationType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../foundation/audit.service';
import type { SessionPrincipal } from '../identity/identity.service';
import { ApiProblem, ENTITY_ID_REGEX } from '../identity/security';
import { MEMEGANG_SESI } from './sesi-terpesan';

/**
 * Koreksi pembelian yang sudah lunas, khusus Super Owner (November 2026):
 * - Batalkan (void): pembelian salah input/duplikat/refund keluar dari omzet, paketnya tidak bisa
 *   dipakai lagi. Status pembelian menjadi CANCELLED (status yang sudah ada), sehingga semua laporan
 *   omzet yang menghitung PAID otomatis terkoreksi tanpa mengubah skema tabel lama.
 * - Pindahkan ke member lain: pembelian dan paketnya berpindah pemilik, nominal dan tanggal tetap,
 *   supaya kesalahan akun tidak ditambal dengan "order baru + kurangi sesi" (omzet dobel).
 * Setiap koreksi dicatat di `pembelian_koreksi` dan audit log.
 */
export const KODE_ALASAN_VOID = ['SALAH_INPUT_AKUN', 'DUPLIKAT', 'SALAH_PAKET', 'REFUND', 'LAINNYA'] as const;
const MIN_ALASAN = 20;

type Tx = any;

@Injectable()
export class KoreksiPembelianService {
  constructor(
    private readonly db: PrismaService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private wajibSuperOwner(principal: SessionPrincipal) {
    if (!principal.roles?.some((r) => r.role === 'SUPER_OWNER'))
      throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
  }

  private alasan(input: unknown) {
    const teks = typeof input === 'string' ? input.trim() : '';
    if (teks.length < MIN_ALASAN || teks.length > 500)
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'alasan', issue: teks.length < MIN_ALASAN ? 'TOO_SHORT' : 'TOO_LONG' },
      ]);
    return teks;
  }

  /** Keadaan pembelian dan paketnya: dasar tampilan konfirmasi dan pemeriksaan sebelum koreksi. */
  private async keadaan(tx: Tx, purchaseId: string) {
    if (!ENTITY_ID_REGEX.test(purchaseId)) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const purchase = await tx.pembelian.findUnique({
      where: { id: purchaseId },
      include: {
        user: { select: { id: true, displayName: true } },
        package: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        customerPackage: true,
      },
    });
    if (!purchase) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const pkg = purchase.customerPackage;
    const potongan = pkg
      ? await tx.sessionLedger.count({ where: { customerPackageId: pkg.id, type: SessionMutationType.ATTEND } })
      : 0;
    const sesiTerpakai = Math.max(pkg?.usedSessions ?? 0, potongan);
    const bookingAktif = pkg
      ? await tx.pemesananKelas.findMany({
          where: { customerPackageId: pkg.id, ...MEMEGANG_SESI },
          select: { id: true, classSlotId: true, status: true },
        })
      : [];
    return { purchase, pkg, sesiTerpakai, bookingAktif };
  }

  async pratinjau(principal: SessionPrincipal, purchaseId: string) {
    this.wajibSuperOwner(principal);
    const { purchase, pkg, sesiTerpakai, bookingAktif } = await this.keadaan(this.db, purchaseId);
    const riwayat =
      typeof (this.db as any).pembelianKoreksi?.findMany === 'function'
        ? await (this.db as any).pembelianKoreksi.findMany({ where: { purchaseId }, orderBy: { createdAt: 'desc' } })
        : [];
    return {
      purchaseId: purchase.id,
      invoiceNumber: purchase.invoiceNumber,
      status: purchase.status,
      member: purchase.user,
      paket: purchase.package,
      cabang: purchase.branch,
      nominalRp: purchase.totalAmountRp,
      paidAt: purchase.paidAt,
      customerPackageId: pkg?.id ?? null,
      sisaSesi: pkg?.remainingSessions ?? 0,
      sesiTerpakai,
      bookingAktif: bookingAktif.length,
      kodeAlasan: KODE_ALASAN_VOID,
      riwayat,
    };
  }

  private async batalkanBooking(tx: Tx, bookings: Array<{ id: string; classSlotId: string }>, actorId: string, now: Date) {
    for (const b of bookings) {
      await tx.pemesananKelas.update({
        where: { id: b.id },
        data: {
          status: 'CANCELLED',
          cancelledAt: now,
          cancelledById: actorId,
          cancellationReason: 'Pembelian dikoreksi Super Owner',
        },
      });
      await tx.slotKelas.update({ where: { id: b.classSlotId }, data: { bookedCount: { decrement: 1 } } });
    }
  }

  async batalkan(
    principal: SessionPrincipal,
    purchaseId: string,
    input: { kodeAlasan?: string; alasan?: string; batalkanBooking?: boolean; sebagian?: boolean },
  ) {
    this.wajibSuperOwner(principal);
    const kodeAlasan = String(input.kodeAlasan ?? '');
    if (!(KODE_ALASAN_VOID as readonly string[]).includes(kodeAlasan))
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'kodeAlasan', issue: 'INVALID' },
      ]);
    const alasan = this.alasan(input.alasan);
    const now = new Date();

    return this.db.$transaction(async (tx: Tx) => {
      // Kunci baris pembelian supaya dua koreksi bersamaan tidak saling menimpa.
      await tx.$queryRaw`SELECT id FROM pembelian WHERE id = ${purchaseId} FOR UPDATE`;
      const { purchase, pkg, sesiTerpakai, bookingAktif } = await this.keadaan(tx, purchaseId);
      if (purchase.status !== 'PAID') throw new ApiProblem('PURCHASE_NOT_PAID', HttpStatus.CONFLICT);
      if (bookingAktif.length && !input.batalkanBooking)
        throw new ApiProblem('PURCHASE_HAS_ACTIVE_BOOKINGS', HttpStatus.CONFLICT);
      // Sesi yang sudah dipakai tidak bisa "dikembalikan" ke omzet: pilihannya void sebagian
      // (sisa sesi dinolkan, pembelian tetap terhitung omzet).
      if (sesiTerpakai > 0 && !input.sebagian)
        throw new ApiProblem('PURCHASE_HAS_USED_SESSIONS', HttpStatus.CONFLICT);

      if (bookingAktif.length) await this.batalkanBooking(tx, bookingAktif, principal.userId, now);
      const sisa = pkg?.remainingSessions ?? 0;
      if (pkg) {
        await tx.paketPelanggan.update({
          where: { id: pkg.id },
          data: { remainingSessions: 0, status: 'EXPIRED' },
        });
        if (sisa > 0)
          await tx.sessionLedger.create({
            data: {
              customerPackageId: pkg.id,
              type: SessionMutationType.ADJUST_MANUAL,
              amount: -sisa,
              balanceAfter: 0,
              referenceId: purchase.id,
              notes: `Pembelian dibatalkan Super Owner (${kodeAlasan}): ${alasan}`.slice(0, 1000),
              createdById: principal.userId,
            },
          });
      }
      const penuh = !(sesiTerpakai > 0);
      if (penuh)
        await tx.pembelian.update({
          where: { id: purchase.id },
          data: { status: 'CANCELLED', rejectionReason: `VOID (${kodeAlasan}): ${alasan}`.slice(0, 1000) },
        });
      const jenis = penuh ? 'VOID' : 'VOID_SEBAGIAN';
      await tx.pembelianKoreksi.create({
        data: {
          id: randomUUID(),
          purchaseId: purchase.id,
          jenis,
          kodeAlasan,
          alasan,
          actorId: principal.userId,
          dariUserId: purchase.userId,
          branchId: purchase.branchId,
          // Void sebagian tidak mengubah omzet (sesinya sudah terpakai).
          nominalRp: penuh ? purchase.totalAmountRp : 0,
          paidAt: purchase.paidAt,
          sisaSesiSebelum: sisa,
          sesiTerpakai,
        },
      });
      await this.audit?.catat(tx, {
        action: penuh ? 'purchase.voided' : 'purchase.voided_partially',
        actorId: principal.userId,
        branchId: purchase.branchId,
        targetUserId: purchase.userId,
        objectType: 'Purchase',
        objectId: purchase.id,
        reason: `${kodeAlasan}: ${alasan}`,
        beforeMasked: { status: purchase.status, totalAmountRp: purchase.totalAmountRp, sisaSesi: sisa },
        afterMasked: {
          status: penuh ? 'CANCELLED' : purchase.status,
          sisaSesi: 0,
          bookingDibatalkan: bookingAktif.length,
        },
      });
      return {
        purchaseId: purchase.id,
        jenis,
        omzetBerkurangRp: penuh ? purchase.totalAmountRp : 0,
        sesiDinolkan: sisa,
        bookingDibatalkan: bookingAktif.length,
      };
    });
  }

  async pindahkan(
    principal: SessionPrincipal,
    purchaseId: string,
    input: { keUserId?: string; alasan?: string; batalkanBooking?: boolean; konfirmasiTerpakai?: boolean },
  ) {
    this.wajibSuperOwner(principal);
    const keUserId = String(input.keUserId ?? '');
    if (!ENTITY_ID_REGEX.test(keUserId))
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'keUserId', issue: 'REQUIRED' },
      ]);
    const alasan = this.alasan(input.alasan);
    const now = new Date();

    return this.db.$transaction(async (tx: Tx) => {
      await tx.$queryRaw`SELECT id FROM pembelian WHERE id = ${purchaseId} FOR UPDATE`;
      const { purchase, pkg, sesiTerpakai, bookingAktif } = await this.keadaan(tx, purchaseId);
      if (purchase.status !== 'PAID') throw new ApiProblem('PURCHASE_NOT_PAID', HttpStatus.CONFLICT);
      if (purchase.userId === keUserId) throw new ApiProblem('SAME_MEMBER', HttpStatus.CONFLICT);
      const tujuan = await tx.user.findUnique({
        where: { id: keUserId },
        select: { id: true, role: true, status: true, displayName: true },
      });
      if (!tujuan || tujuan.role !== 'CUSTOMER' || tujuan.status !== 'ACTIVE')
        throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
      if (bookingAktif.length && !input.batalkanBooking)
        throw new ApiProblem('PURCHASE_HAS_ACTIVE_BOOKINGS', HttpStatus.CONFLICT);
      if (sesiTerpakai > 0 && !input.konfirmasiTerpakai)
        throw new ApiProblem('PURCHASE_HAS_USED_SESSIONS', HttpStatus.CONFLICT);

      if (bookingAktif.length) await this.batalkanBooking(tx, bookingAktif, principal.userId, now);
      await tx.pembelian.update({ where: { id: purchase.id }, data: { userId: keUserId } });
      // Riwayat kelas member asal tetap atas namanya; yang pindah hanya pemilik paket (sisa sesinya).
      if (pkg) await tx.paketPelanggan.update({ where: { id: pkg.id }, data: { userId: keUserId } });
      await tx.pembelianKoreksi.create({
        data: {
          id: randomUUID(),
          purchaseId: purchase.id,
          jenis: 'PINDAH',
          kodeAlasan: 'SALAH_INPUT_AKUN',
          alasan,
          actorId: principal.userId,
          dariUserId: purchase.userId,
          keUserId,
          branchId: purchase.branchId,
          nominalRp: 0,
          paidAt: purchase.paidAt,
          sisaSesiSebelum: pkg?.remainingSessions ?? 0,
          sesiTerpakai,
        },
      });
      await this.audit?.catat(tx, {
        action: 'purchase.transferred',
        actorId: principal.userId,
        branchId: purchase.branchId,
        targetUserId: keUserId,
        objectType: 'Purchase',
        objectId: purchase.id,
        reason: alasan,
        beforeMasked: { userId: purchase.userId },
        afterMasked: { userId: keUserId, bookingDibatalkan: bookingAktif.length, sesiTerpakai },
      });
      return {
        purchaseId: purchase.id,
        dari: purchase.user,
        ke: { id: tujuan.id, displayName: tujuan.displayName },
        sisaSesi: pkg?.remainingSessions ?? 0,
        bookingDibatalkan: bookingAktif.length,
      };
    });
  }
}
