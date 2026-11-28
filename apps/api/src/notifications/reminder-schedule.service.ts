import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { WhatsAppGatewayService } from './whatsapp-gateway.service';
import { NotificationTemplateService } from './notification-template.service';
import { KODE_PEMBATALAN_TERLAMBAT } from '../bookings/pembatalan-terlambat';
import { tutupPembatalanUsang } from '../bookings/tutup-pembatalan-usang';

export interface ReminderBatchSummary {
  evaluatedAt: Date;
  adminDigestsSent: number;
  ownerRecapsSent: number;
  customerH7Sent: number;
  customerH3Sent: number;
  customerH1Sent: number;
  customerExpiredRenewSent: number;
  stoppedCustomersProtected: number;
  pengingatPembatalanSent: number;
}

/** Pengajuan batal < 12 jam yang belum diputus lebih lama dari ini diingatkan ke pemutusnya. */
export const BATAS_TUNGGU_PEMBATALAN_JAM = 24;

@Injectable()
export class ReminderScheduleService {
  private readonly logger = new Logger(ReminderScheduleService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly whatsapp: WhatsAppGatewayService,
    private readonly templates: NotificationTemplateService,
  ) {}

  /**
   * Menjalankan siklus evaluasi pengingat berjenjang lengkap (Keputusan Bisnis #11, #12, #13)
   */
  async runAllReminders(now = new Date()): Promise<ReminderBatchSummary> {
    const summary: ReminderBatchSummary = {
      evaluatedAt: now,
      adminDigestsSent: 0,
      ownerRecapsSent: 0,
      customerH7Sent: 0,
      customerH3Sent: 0,
      customerH1Sent: 0,
      customerExpiredRenewSent: 0,
      stoppedCustomersProtected: 0,
      pengingatPembatalanSent: 0,
    };

    // 1. Jalankan Pengingat Customer Menjelang Expired (H-7, H-3, H-1) & Expired Renewal
    const custRes = await this.runCustomerExpiryReminders(now);
    summary.customerH7Sent = custRes.h7Count;
    summary.customerH3Sent = custRes.h3Count;
    summary.customerH1Sent = custRes.h1Count;
    summary.customerExpiredRenewSent = custRes.expiredRenewCount;
    summary.stoppedCustomersProtected = custRes.stoppedProtectedCount;

    // 2. Jalankan Digest Admin (Setiap 3 Jam)
    summary.adminDigestsSent = await this.runAdminDigest(now);

    // 3. Jalankan Rekap Owner (Setiap 3 Hari)
    summary.ownerRecapsSent = await this.runOwnerRecap(now);

    // 4. Pengajuan batal < 12 jam yang menunggu keputusan lebih dari 24 jam (sekali sehari)
    summary.pengingatPembatalanSent = await this.runPengingatPembatalan(now);

    return summary;
  }

  /**
   * Rule #12 & #13: Pengingat Customer Menjelang Expired (H-7, H-3, H-1) dan Follow-up Expired (Max 5x)
   */
  async runCustomerExpiryReminders(now = new Date()) {
    let h7Count = 0;
    let h3Count = 0;
    let h1Count = 0;
    let expiredRenewCount = 0;
    let stoppedProtectedCount = 0;

    // Ambil seluruh paket pelanggan aktif
    const activePackages = await this.db.paketPelanggan.findMany({
      where: {
        status: 'ACTIVE',
        validUntil: { gte: now },
      },
      include: {
        user: true,
        package: true,
      },
    });

    for (const cp of activePackages) {
      const user = cp.user;
      if (!user || !user.phone) continue;

      // ATURAN KRITIS (Keputusan Bisnis #12 & #13):
      // Customer yang ditandai berhenti (stoppedAt != null) WAJIB DIKECUALIKAN 100%!
      if (user.stoppedAt) {
        stoppedProtectedCount++;
        continue;
      }

      const diffMs = cp.validUntil.getTime() - now.getTime();
      const diffDays = diffMs / (24 * 3_600_000);

      const customerName = user.displayName || 'Member';
      const packageName = cp.package?.name || 'Paket Pilates';
      const validUntilStr = new Intl.DateTimeFormat('id-ID', { dateStyle: 'long' }).format(cp.validUntil);

      // Evaluasi H-1 (0 s/d 1 hari lagi)
      if (diffDays <= 1) {
        const text = await this.templates.whatsappText('WA_REMINDER_EXPIRY_H1', {
          nama: customerName,
          paket: packageName,
          berlaku_sampai: validUntilStr,
          sisa_sesi: cp.remainingSessions,
        });

        const res = await this.whatsapp.sendMessage({
          to: user.phone,
          branchId: user.preferredBranchId,
          text,
          recipientType: 'CUSTOMER',
          reminderType: 'EXPIRY_H1',
          dedupWindowMs: 20 * 3_600_000,
          sentAt: now,
          payload: { customerPackageId: cp.id, validUntil: cp.validUntil },
        });
        if (res.status === 'SENT') h1Count++;
      }
      // Evaluasi H-3 (2 s/d 3 hari lagi)
      else if (diffDays <= 3 && diffDays > 2) {
        const text = await this.templates.whatsappText('WA_REMINDER_EXPIRY_H3', {
          nama: customerName,
          paket: packageName,
          berlaku_sampai: validUntilStr,
          sisa_sesi: cp.remainingSessions,
        });

        const res = await this.whatsapp.sendMessage({
          to: user.phone,
          branchId: user.preferredBranchId,
          text,
          recipientType: 'CUSTOMER',
          reminderType: 'EXPIRY_H3',
          dedupWindowMs: 20 * 3_600_000,
          sentAt: now,
          payload: { customerPackageId: cp.id, validUntil: cp.validUntil },
        });
        if (res.status === 'SENT') h3Count++;
      }
      // Evaluasi H-7 (6 s/d 7 hari lagi)
      else if (diffDays <= 7 && diffDays > 6) {
        const text = await this.templates.whatsappText('WA_REMINDER_EXPIRY_H7', {
          nama: customerName,
          paket: packageName,
          berlaku_sampai: validUntilStr,
          sisa_sesi: cp.remainingSessions,
        });

        const res = await this.whatsapp.sendMessage({
          to: user.phone,
          branchId: user.preferredBranchId,
          text,
          recipientType: 'CUSTOMER',
          reminderType: 'EXPIRY_H7',
          dedupWindowMs: 20 * 3_600_000,
          sentAt: now,
          payload: { customerPackageId: cp.id, validUntil: cp.validUntil },
        });
        if (res.status === 'SENT') h7Count++;
      }
    }

    // ------------------------------------------------------------------------
    // Rule #13: Customer Sudah Expired Belum Renew (Setiap 3 Hari Sekali, Max 5x)
    // ------------------------------------------------------------------------
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3_600_000);
    const expiredPackages = await this.db.paketPelanggan.findMany({
      where: {
        OR: [
          { status: 'EXPIRED' },
          { validUntil: { lt: now } },
        ],
        validUntil: { gte: thirtyDaysAgo },
      },
      include: {
        user: {
          include: {
            customerPackages: {
              where: { status: 'ACTIVE', validUntil: { gte: now } },
            },
          },
        },
        package: true,
      },
      take: 50,
    });

    for (const cp of expiredPackages) {
      const user = cp.user;
      if (!user || !user.phone) continue;

      // Proteksi Customer Berhenti
      if (user.stoppedAt) {
        stoppedProtectedCount++;
        continue;
      }

      // Jika customer sudah memiliki paket aktif lain yang baru, jangan kirim reminder renew
      if (user.customerPackages && user.customerPackages.length > 0) {
        continue;
      }

      const cleanPhone = this.whatsapp.normalizePhone(user.phone);
      if (!cleanPhone) continue;

      // Hitung riwayat pengiriman reminder renew dari ReminderLog
      const sentHistory = await this.db.reminderLog.findMany({
        where: {
          recipientPhone: cleanPhone,
          reminderType: 'EXPIRED_RENEWAL',
          status: 'SENT',
        },
        orderBy: { sentAt: 'desc' },
      });

      // Batasan Maksimal 5 Kali (Keputusan Bisnis #13)
      if (sentHistory.length >= 5) {
        this.logger.debug(`Customer ${user.phone} sudah menerima 5x follow-up expired. Dihentikan.`);
        continue;
      }

      // Cek interval 3 hari (72 jam) sejak pengiriman terakhir
      if (sentHistory.length > 0 && sentHistory[0]) {
        const lastSent = sentHistory[0].sentAt;
        const hoursSinceLast = (now.getTime() - lastSent.getTime()) / 3_600_000;
        if (hoursSinceLast < 70) {
          // Belum 3 hari sejak pengiriman terakhir
          continue;
        }
      }

      const customerName = user.displayName || 'Member';
      const currentCount = sentHistory.length + 1;
      const text = await this.templates.whatsappText('WA_REMINDER_EXPIRED_RENEWAL', {
        nama: customerName,
        tautan_paket: 'https://dailydosepilates.com/packages',
      });

      const res = await this.whatsapp.sendMessage({
        to: user.phone,
        branchId: user.preferredBranchId,
        text,
        recipientType: 'CUSTOMER',
        reminderType: 'EXPIRED_RENEWAL',
        dedupWindowMs: 70 * 3_600_000,
        sentAt: now,
        payload: { attemptCount: currentCount, packageId: cp.packageId },
      });

      if (res.status === 'SENT') {
        expiredRenewCount++;
      }
    }

    return {
      h7Count,
      h3Count,
      h1Count,
      expiredRenewCount,
      stoppedProtectedCount,
    };
  }

  /**
   * Rule #11: Internal Admin Digest Setiap 3 Jam
   */
  async runAdminDigest(now = new Date()): Promise<number> {
    let sentCount = 0;
    const branches = await this.db.cabang.findMany({ where: { active: true } });

    for (const branch of branches) {
      // Kueri customer cabang ini yang paketnya mendekati expired (<= 7 hari) atau sisa sesi <= 2
      const sevenDaysAhead = new Date(now.getTime() + 7 * 24 * 3_600_000);

      const expiringPackages = await this.db.paketPelanggan.findMany({
        where: {
          status: 'ACTIVE',
          user: {
            stoppedAt: null, // Pengecualian customer berhenti
            OR: [
              { preferredBranchId: branch.id },
              { bookings: { some: { classSlot: { branchId: branch.id } } } },
            ],
          },
          OR: [
            { validUntil: { lte: sevenDaysAhead } },
            { remainingSessions: { lte: 2 } },
          ],
        },
        include: { user: true, package: true },
        take: 30,
      });

      if (expiringPackages.length === 0) continue;

      // Ambil daftar admin & manager cabang
      const staffList = await this.db.user.findMany({
        where: {
          role: { in: ['ADMIN', 'MANAGER', 'SUPER_OWNER'] },
          OR: [{ preferredBranchId: branch.id }, { role: 'SUPER_OWNER' }],
        },
      });

      const lines: string[] = [
        `*[DIGEST ADMIN 3 JAM - ${branch.name.toUpperCase()}]*`,
        `Waktu: ${new Intl.DateTimeFormat('id-ID', { dateStyle: 'short', timeStyle: 'short', timeZone: branch.timezone || 'Asia/Jakarta' }).format(now)}`,
        `Daftar Customer Paket Hampir Habis / Expired:`,
      ];

      expiringPackages.slice(0, 15).forEach((cp, idx) => {
        const phone = cp.user?.phone || '-';
        const name = cp.user?.displayName || 'Customer';
        const expStr = new Intl.DateTimeFormat('id-ID', {
          dateStyle: 'short',
          timeZone: branch.timezone || 'Asia/Jakarta',
        }).format(cp.validUntil);
        lines.push(`${idx + 1}. *${name}* (${phone}) | Sisa: *${cp.remainingSessions} Sesi* | Exp: ${expStr}`);
      });

      const digestText = lines.join('\n');

      for (const staff of staffList) {
        if (!staff.phone) continue;
        const res = await this.whatsapp.sendMessage({
          to: staff.phone,
          branchId: branch.id,
          text: digestText,
          recipientType: staff.role as any,
          reminderType: `ADMIN_DIGEST_3H_${branch.id}`,
          dedupWindowMs: 2.5 * 3_600_000, // 2.5 jam window deduplikasi
          sentAt: now,
          payload: { branchId: branch.id, customerCount: expiringPackages.length },
        });
        if (res.status === 'SENT') sentCount++;
      }
    }

    return sentCount;
  }

  /**
   * Pengajuan batal kurang dari 12 jam bisa menunggu berminggu-minggu tanpa ada yang tahu (audit
   * 24 November 2026). Manager cabang dan Owner/Super Owner menerima daftar pengajuan yang sudah
   * menunggu lebih dari 24 jam, paling sering sekali sehari per orang.
   */
  async runPengingatPembatalan(now = new Date()): Promise<number> {
    await tutupPembatalanUsang(this.db, now);
    const batas = new Date(now.getTime() - BATAS_TUNGGU_PEMBATALAN_JAM * 3_600_000);
    const menunggu = await this.db.sessionAdjustRequest.findMany({
      where: { status: 'PENDING', reasonCode: KODE_PEMBATALAN_TERLAMBAT, createdAt: { lte: batas } },
      select: {
        createdAt: true,
        customerPackage: { select: { user: { select: { displayName: true } } } },
        booking: { select: { classSlot: { select: { branchId: true, startAt: true } } } },
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    if (!menunggu.length) return 0;

    const pemutus = await this.db.user.findMany({
      where: { role: { in: ['MANAGER', 'OWNER', 'SUPER_OWNER'] }, phone: { not: null }, stoppedAt: null },
      select: { id: true, role: true, phone: true, preferredBranchId: true },
    });
    const hari = (d: Date) => Math.max(1, Math.floor((now.getTime() - d.getTime()) / 86_400_000));
    let terkirim = 0;
    for (const orang of pemutus) {
      // Manager hanya cabangnya; Owner dan Super Owner semua cabang.
      const miliknya = menunggu.filter(
        (m) => orang.role !== 'MANAGER' || m.booking?.classSlot?.branchId === orang.preferredBranchId,
      );
      if (!miliknya.length || !orang.phone) continue;
      const baris = miliknya.slice(0, 10).map((m, i) => {
        const nama = m.customerPackage?.user?.displayName ?? 'Member';
        return `${i + 1}. ${nama}, menunggu ${hari(m.createdAt)} hari`;
      });
      const lebih = miliknya.length > 10 ? [`dan ${miliknya.length - 10} lainnya`] : [];
      const res = await this.whatsapp.sendMessage({
        to: orang.phone,
        branchId: miliknya[0]?.booking?.classSlot?.branchId ?? orang.preferredBranchId,
        text: [
          `*Pengajuan batal < 12 jam menunggu keputusan: ${miliknya.length}*`,
          ...baris,
          ...lebih,
          'Putuskan di menu Perlu tindakan. Sesi member tertahan sampai diputuskan.',
        ].join('\n'),
        recipientType: orang.role as any,
        reminderType: 'PENGINGAT_PEMBATALAN_TERLAMBAT',
        dedupWindowMs: 23 * 3_600_000,
        sentAt: now,
        payload: { jumlah: miliknya.length },
      });
      if (res.status === 'SENT') terkirim++;
    }
    return terkirim;
  }

  /**
   * Rule #11: Internal Owner & Super Owner Rekap Setiap 3 Hari
   */
  async runOwnerRecap(now = new Date()): Promise<number> {
    let sentCount = 0;
    const branches = await this.db.cabang.findMany({ where: { active: true } });

    for (const branch of branches) {
      const activeCount = await this.db.paketPelanggan.count({
        where: {
          status: 'ACTIVE',
          validUntil: { gte: now },
          user: { stoppedAt: null },
        },
      });

      const expiredCount = await this.db.paketPelanggan.count({
        where: {
          status: 'EXPIRED',
          user: { stoppedAt: null },
        },
      });

      // Ambil owner cabang dan super owner
      const owners = await this.db.user.findMany({
        where: {
          OR: [
            { ownedBranches: { some: { branchId: branch.id } } },
            { role: 'SUPER_OWNER' },
          ],
        },
      });

      const recapText =
        `*[REKAP 3 HARI OWNER - ${branch.name.toUpperCase()}]*\n` +
        `Tanggal: ${new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeZone: branch.timezone || 'Asia/Jakarta' }).format(now)}\n\n` +
        `• Paket Member Aktif: *${activeCount} paket*\n` +
        `• Paket Kedaluwarsa: *${expiredCount} paket*\n\n` +
        `Laporan performa finansial cabang tersedia di dashboard Daily Dose.`;

      for (const owner of owners) {
        if (!owner.phone) continue;
        const res = await this.whatsapp.sendMessage({
          to: owner.phone,
          branchId: branch.id,
          text: recapText,
          recipientType: owner.role as any,
          reminderType: `OWNER_RECAP_3D_${branch.id}`,
          dedupWindowMs: 65 * 3_600_000, // 65 jam window deduplikasi
          sentAt: now,
          payload: { branchId: branch.id, activeCount, expiredCount },
        });
        if (res.status === 'SENT') sentCount++;
      }
    }

    return sentCount;
  }
}
