import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { SessionMutationType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../foundation/audit.service';
import type { SessionPrincipal } from '../identity/identity.service';
import { PRIVATE_FILE_STORAGE, type PrivateFileStorage } from '../identity/private-file-storage';
import { ApiProblem, ENTITY_ID_REGEX } from '../identity/security';
import { kenaliBukti } from './penyesuaian-bukti.service';
import { MEMEGANG_SESI } from './sesi-terpesan';

/**
 * Refund paket member (keputusan pemilik, November 2026): sisa sesi dikembalikan dalam rupiah,
 * prorata dari harga final yang dibayar (setelah promo/voucher, tanpa kode unik transfer):
 *
 *   refund = harga final / total sesi paket x sisa sesi
 *
 * Diproses oleh Admin, Manager, Owner, atau Super Owner di cabang pembeliannya, dengan rekening
 * tujuan dan bukti transfer refund. Paketnya dinolkan; pembelian asal tidak diubah. Hasilnya
 * berupa surat konfirmasi refund yang bisa dicetak.
 */
const PERAN_REFUND = new Set(['ADMIN', 'MANAGER', 'OWNER', 'SUPER_OWNER']);
const MAKS_BUKTI_BYTE = 8_000_000;
const kunciBukti = (id: string, ext: string) => `refund-proofs/${id}.${ext}`;

type Tx = any;

export function hitungRefund(hargaDibayarRp: number, totalSesi: number, sisaSesi: number) {
  if (totalSesi <= 0 || sisaSesi <= 0 || hargaDibayarRp <= 0) return { hargaPerSesiRp: 0, nominalRefundRp: 0 };
  return {
    hargaPerSesiRp: Math.round(hargaDibayarRp / totalSesi),
    // Dihitung dari harga total (bukan harga per sesi yang sudah dibulatkan) supaya tidak bergeser.
    nominalRefundRp: Math.round((hargaDibayarRp * sisaSesi) / totalSesi),
  };
}

const teks = (value: unknown, field: string, min: number, max: number) => {
  const isi = typeof value === 'string' ? value.trim() : '';
  if (isi.length < min || isi.length > max)
    throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
      { field, issue: isi.length < min ? 'REQUIRED' : 'TOO_LONG' },
    ]);
  return isi;
};

@Injectable()
export class RefundPaketService {
  constructor(
    private readonly db: PrismaService,
    @Optional() private readonly audit?: AuditService,
    @Optional() @Inject(PRIVATE_FILE_STORAGE) private readonly storage?: PrivateFileStorage,
  ) {}

  private bolehDiCabang(principal: SessionPrincipal, branchId: string) {
    if (!principal.roles?.some((r) => PERAN_REFUND.has(r.role as string)))
      throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
    const semua = principal.capabilities.includes('branch:all') || principal.roles.some((r) => r.role === 'SUPER_OWNER');
    if (!semua && !principal.branchIds.includes(branchId))
      throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
  }

  private async keadaan(tx: Tx, customerPackageId: string) {
    if (!ENTITY_ID_REGEX.test(customerPackageId)) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const pkg = await tx.paketPelanggan.findUnique({
      where: { id: customerPackageId },
      include: {
        package: { select: { id: true, name: true, code: true, branchId: true } },
        purchase: true,
        user: { select: { id: true, displayName: true } },
      },
    });
    if (!pkg) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const branchId: string | null = pkg.purchase?.branchId ?? pkg.package?.branchId ?? null;
    const bookingAktif = await tx.pemesananKelas.findMany({
      where: { customerPackageId: pkg.id, ...MEMEGANG_SESI },
      select: { id: true, classSlotId: true },
    });
    // Harga final = yang dibayar tanpa kode unik transfer (kode unik bukan harga paket).
    const hargaDibayarRp = pkg.purchase
      ? Math.max(0, pkg.purchase.totalAmountRp - (pkg.purchase.uniqueCode ?? 0))
      : 0;
    const hitung = hitungRefund(hargaDibayarRp, pkg.totalSessions, pkg.remainingSessions);
    return { pkg, branchId, bookingAktif, hargaDibayarRp, ...hitung };
  }

  async pratinjau(principal: SessionPrincipal, customerPackageId: string) {
    const k = await this.keadaan(this.db, customerPackageId);
    if (!k.branchId) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    this.bolehDiCabang(principal, k.branchId);
    return {
      customerPackageId: k.pkg.id,
      member: k.pkg.user,
      paket: { id: k.pkg.package?.id, name: k.pkg.package?.name, code: k.pkg.package?.code },
      status: k.pkg.status,
      berlakuSejak: k.pkg.validFrom,
      berlakuSampai: k.pkg.validUntil,
      hargaDibayarRp: k.hargaDibayarRp,
      totalSesi: k.pkg.totalSessions,
      sisaSesi: k.pkg.remainingSessions,
      sesiTerpakai: Math.max(0, k.pkg.totalSessions - k.pkg.remainingSessions),
      hargaPerSesiRp: k.hargaPerSesiRp,
      nominalRefundRp: k.nominalRefundRp,
      bookingAktif: k.bookingAktif.length,
      bisaRefund: Boolean(k.pkg.purchase && k.pkg.purchase.status === 'PAID' && k.pkg.remainingSessions > 0),
    };
  }

  async proses(
    principal: SessionPrincipal,
    customerPackageId: string,
    body: { bankName?: string; nomorRekening?: string; namaRekening?: string; alasan?: string; batalkanBooking?: string | boolean },
    bukti: { buffer?: Buffer; size?: number } | undefined,
  ) {
    const bankName = teks(body.bankName, 'bankName', 2, 64);
    const nomorRekening = teks(body.nomorRekening, 'nomorRekening', 5, 40).replace(/[\s.-]/g, '');
    if (!/^\d{5,30}$/.test(nomorRekening))
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'nomorRekening', issue: 'INVALID' },
      ]);
    const namaRekening = teks(body.namaRekening, 'namaRekening', 2, 128);
    const alasan = teks(body.alasan, 'alasan', 10, 500);
    const batalkanBooking = body.batalkanBooking === true || body.batalkanBooking === 'true';
    const jenis = bukti?.buffer ? kenaliBukti(bukti.buffer) : null;
    if (!bukti?.buffer || !jenis || bukti.buffer.length > MAKS_BUKTI_BYTE)
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'bukti', issue: !bukti?.buffer ? 'REQUIRED' : 'INVALID_FILE' },
      ]);
    if (!this.storage) throw new ApiProblem('STORAGE_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE);

    const id = randomUUID();
    const kunci = kunciBukti(id, jenis.ext);
    // Bukti disimpan dulu; bila refund gagal dicatat, berkasnya dihapus kembali.
    await this.storage.put({ key: kunci, content: bukti.buffer });
    try {
      return await this.db.$transaction(async (tx: Tx) => {
        await tx.$queryRaw`SELECT id FROM paket_pelanggan WHERE id = ${customerPackageId} FOR UPDATE`;
        const k = await this.keadaan(tx, customerPackageId);
        if (!k.branchId) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
        this.bolehDiCabang(principal, k.branchId);
        if (!k.pkg.purchase || k.pkg.purchase.status !== 'PAID')
          throw new ApiProblem('REFUND_NO_PAID_PURCHASE', HttpStatus.CONFLICT);
        if (k.bookingAktif.length && !batalkanBooking)
          throw new ApiProblem('PACKAGE_HAS_ACTIVE_BOOKINGS', HttpStatus.CONFLICT);
        if (k.pkg.remainingSessions <= 0) throw new ApiProblem('REFUND_NOTHING_LEFT', HttpStatus.CONFLICT);

        const now = new Date();
        for (const b of k.bookingAktif) {
          await tx.pemesananKelas.update({
            where: { id: b.id },
            data: { status: 'CANCELLED', cancelledAt: now, cancelledById: principal.userId, cancellationReason: 'Paket di-refund' },
          });
          await tx.slotKelas.update({ where: { id: b.classSlotId }, data: { bookedCount: { decrement: 1 } } });
        }
        await tx.paketPelanggan.update({
          where: { id: k.pkg.id },
          data: { remainingSessions: 0, status: 'EXPIRED' },
        });
        await tx.sessionLedger.create({
          data: {
            customerPackageId: k.pkg.id,
            type: SessionMutationType.ADJUST_MANUAL,
            amount: -k.pkg.remainingSessions,
            balanceAfter: 0,
            referenceId: id,
            notes: `Refund ${k.pkg.remainingSessions} sesi (Rp${k.nominalRefundRp}): ${alasan}`.slice(0, 1000),
            createdById: principal.userId,
          },
        });
        const refund = await tx.refundPaket.create({
          data: {
            id,
            customerPackageId: k.pkg.id,
            purchaseId: k.pkg.purchase.id,
            userId: k.pkg.userId,
            branchId: k.branchId,
            namaPaket: k.pkg.package?.name ?? 'Paket',
            hargaDibayarRp: k.hargaDibayarRp,
            totalSesi: k.pkg.totalSessions,
            sisaSesi: k.pkg.remainingSessions,
            nominalRefundRp: k.nominalRefundRp,
            bankName,
            nomorRekening,
            namaRekening,
            buktiExt: jenis.ext,
            alasan,
            bookingDibatalkan: k.bookingAktif.length,
            actorId: principal.userId,
          },
        });
        await this.audit?.catat(tx, {
          action: 'customer_package.refunded',
          actorId: principal.userId,
          branchId: k.branchId,
          targetUserId: k.pkg.userId,
          objectType: 'CustomerPackage',
          objectId: k.pkg.id,
          reason: alasan,
          beforeMasked: { sisaSesi: k.pkg.remainingSessions, status: k.pkg.status },
          afterMasked: {
            sisaSesi: 0,
            nominalRefundRp: k.nominalRefundRp,
            rekening: `${bankName} ****${nomorRekening.slice(-4)}`,
          },
        });
        return { id: refund.id, nominalRefundRp: refund.nominalRefundRp };
      });
    } catch (error) {
      await this.storage.delete(kunci).catch(() => undefined);
      throw error;
    }
  }

  /** Data surat konfirmasi refund. */
  async surat(principal: SessionPrincipal, id: string) {
    if (!ENTITY_ID_REGEX.test(id)) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const r = await (this.db as any).refundPaket.findUnique({ where: { id } });
    if (!r) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    this.bolehDiCabang(principal, r.branchId);
    const [member, cabang, pkg, petugas] = await Promise.all([
      this.db.user.findUnique({ where: { id: r.userId }, select: { id: true, displayName: true, phone: true } }),
      this.db.cabang.findUnique({ where: { id: r.branchId }, select: { name: true } }),
      this.db.paketPelanggan.findUnique({
        where: { id: r.customerPackageId },
        select: { validFrom: true, validUntil: true, package: { select: { code: true } } },
      }),
      this.db.user.findUnique({ where: { id: r.actorId }, select: { displayName: true } }),
    ]);
    const { hargaPerSesiRp } = hitungRefund(r.hargaDibayarRp, r.totalSesi, r.sisaSesi);
    return {
      id: r.id,
      tanggal: r.createdAt,
      member: { id: r.userId, nama: member?.displayName ?? '-', telepon: member?.phone ?? null },
      cabang: cabang?.name ?? '-',
      paket: { nama: r.namaPaket, kode: pkg?.package?.code ?? null, berlakuSejak: pkg?.validFrom ?? null, berlakuSampai: pkg?.validUntil ?? null },
      hargaDibayarRp: r.hargaDibayarRp,
      totalSesi: r.totalSesi,
      sesiTerpakai: r.totalSesi - r.sisaSesi,
      sisaSesi: r.sisaSesi,
      hargaPerSesiRp,
      nominalRefundRp: r.nominalRefundRp,
      rekening: { bank: r.bankName, nomor: r.nomorRekening, nama: r.namaRekening },
      alasan: r.alasan,
      petugas: petugas?.displayName ?? '-',
      adaBukti: Boolean(r.buktiExt),
    };
  }

  async bukti(principal: SessionPrincipal, id: string): Promise<{ mimeType: string; stream: Readable }> {
    if (!ENTITY_ID_REGEX.test(id)) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const r = await (this.db as any).refundPaket.findUnique({ where: { id } });
    if (!r?.buktiExt || !this.storage) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    this.bolehDiCabang(principal, r.branchId);
    const mime = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' }[r.buktiExt as string];
    if (!mime) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    return { mimeType: mime, stream: await this.storage.read(kunciBukti(r.id, r.buktiExt)) };
  }
}
