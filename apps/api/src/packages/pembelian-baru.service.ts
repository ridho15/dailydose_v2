import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../foundation/audit.service';
import { PolicyService } from '../identity/policy.service';
import { bacaOpsional, tabelOpsionalAda } from '../foundation/tabel-opsional';
import type { SessionPrincipal } from '../identity/identity.service';
import { ApiProblem } from '../identity/security';
import { paketPerpanjanganIds } from './perpanjangan-masa-aktif';

/** Pembelian lunas tampil 7 hari; yang belum dikirimi pesan tetap tampil sampai dikirim. */
export const HARI_TAMPIL_PEMBELIAN_BARU = 7;
/** Pembelian sebelum tanggal ini tidak ditagih pesannya (fitur mulai 28 November 2026, mundur 7 hari). */
export const MULAI_PEMBELIAN_BARU = new Date('2026-11-21T00:00:00+07:00');
const MAKS_BARIS = 100;
const IZIN = ['purchase:record', 'payment:review'];

export interface PembelianBaru {
  id: string;
  invoiceNumber: string;
  namaMember: string;
  telepon: string | null;
  namaPaket: string;
  masaBerlakuHari: number | null;
  perpanjangan: boolean;
  totalRp: number;
  dibayarPada: string;
  terkirimPada: string | null;
}

/**
 * Daftar "Pembelian baru" di meja depan: staf mengirim pesan terima kasih + Syarat & Ketentuan ke
 * WhatsApp member, lalu sistem mencatat bahwa pesannya sudah dikirim.
 */
@Injectable()
export class PembelianBaruService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private cabangBoleh(principal: SessionPrincipal, branchId: string | undefined): string {
    if (!branchId)
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'branchId', issue: 'REQUIRED' },
      ]);
    const boleh =
      this.policy.hasCapability(principal, 'branch:all', branchId) ||
      IZIN.some((cap) => this.policy.hasCapability(principal, cap, branchId));
    if (!boleh) throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
    return branchId;
  }

  async daftar(principal: SessionPrincipal, input: { branchId?: string }, now = new Date()) {
    this.policy.requireAnyCapability(principal.capabilities, IZIN);
    const branchId = this.cabangBoleh(principal, input.branchId);
    const batasBaru = new Date(
      Math.max(now.getTime() - HARI_TAMPIL_PEMBELIAN_BARU * 86_400_000, MULAI_PEMBELIAN_BARU.getTime()),
    );
    const terkirim = await bacaOpsional(
      'syarat_terkirim_wa',
      () =>
        this.db.syaratTerkirimWa.findMany({
          where: { branchId },
          select: { purchaseId: true, dikirimPada: true },
        }),
      [] as Array<{ purchaseId: string; dikirimPada: Date }>,
    );
    const kapan = new Map(terkirim.map((t) => [t.purchaseId, t.dikirimPada]));
    const pilih = {
      id: true,
      invoiceNumber: true,
      totalAmountRp: true,
      paidAt: true,
      packageId: true,
      user: { select: { displayName: true, phone: true } },
      package: { select: { name: true, validityDays: true } },
    } as const;
    const [baru, belumDikirim] = await Promise.all([
      // Lunas 7 hari terakhir: tampil, sudah dikirim atau belum.
      this.db.pembelian.findMany({
        where: { branchId, status: 'PAID', paidAt: { gte: batasBaru, lte: now } },
        select: pilih,
        orderBy: { paidAt: 'desc' },
        take: MAKS_BARIS,
      }),
      // Lebih lama dari 7 hari tetapi belum dikirimi pesan: tetap tampil.
      batasBaru > MULAI_PEMBELIAN_BARU
        ? this.db.pembelian.findMany({
            where: {
              branchId,
              status: 'PAID',
              paidAt: { gte: MULAI_PEMBELIAN_BARU, lt: batasBaru },
              ...(kapan.size ? { id: { notIn: [...kapan.keys()] } } : {}),
            },
            select: pilih,
            orderBy: { paidAt: 'desc' },
            take: MAKS_BARIS,
          })
        : Promise.resolve([]),
    ]);
    const semua = [...baru, ...belumDikirim];
    const perpanjangan = await paketPerpanjanganIds(this.db, semua.map((p) => p.packageId));
    const items: PembelianBaru[] = semua.map((p) => ({
      id: p.id,
      invoiceNumber: p.invoiceNumber,
      namaMember: p.user?.displayName ?? 'Member',
      telepon: p.user?.phone ?? null,
      namaPaket: p.package?.name ?? 'Paket',
      masaBerlakuHari: p.package?.validityDays ?? null,
      perpanjangan: perpanjangan.has(p.packageId),
      totalRp: p.totalAmountRp,
      dibayarPada: (p.paidAt ?? now).toISOString(),
      terkirimPada: kapan.get(p.id)?.toISOString() ?? null,
    }));
    // Yang belum dikirim di atas, lalu yang terbaru.
    items.sort(
      (a, b) =>
        Number(a.terkirimPada !== null) - Number(b.terkirimPada !== null) ||
        b.dibayarPada.localeCompare(a.dibayarPada),
    );
    return { items, siap: await tabelOpsionalAda(this.db, 'syarat_terkirim_wa') };
  }

  /** Dipanggil saat staf mengklik tombol WhatsApp. Klik ulang tidak mengubah waktu kirim pertama. */
  async tandaiTerkirim(principal: SessionPrincipal, purchaseId: string, correlationId?: string) {
    this.policy.requireAnyCapability(principal.capabilities, IZIN);
    const purchase = await this.db.pembelian.findUnique({
      where: { id: purchaseId },
      select: { id: true, branchId: true, status: true },
    });
    if (!purchase) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    this.cabangBoleh(principal, purchase.branchId);
    if (purchase.status !== 'PAID') throw new ApiProblem('PURCHASE_NOT_PAID', HttpStatus.CONFLICT);
    if (!(await tabelOpsionalAda(this.db, 'syarat_terkirim_wa')))
      throw new ApiProblem('TERMS_FOLLOWUP_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE);
    const row = await this.db.syaratTerkirimWa.upsert({
      where: { purchaseId },
      create: { purchaseId, branchId: purchase.branchId, dikirimOleh: principal.userId || null },
      update: {},
    });
    this.audit?.record({
      action: 'purchase.terms_whatsapp_sent',
      resourceType: 'Purchase',
      resourceId: purchaseId,
      branchId: purchase.branchId,
      actorUserId: principal.userId,
      correlationId,
    });
    return { purchaseId, terkirimPada: row.dikirimPada.toISOString() };
  }
}
