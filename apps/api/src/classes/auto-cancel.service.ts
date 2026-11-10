import { Injectable, Logger } from '@nestjs/common';
import { ClassSlotStatus, PrismaClient, SessionMutationType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { WhatsAppGatewayService } from '../notifications/whatsapp-gateway.service';

export interface AutoCancelEvaluationResult {
  /** `true` bila evaluasi tidak dijalankan karena dinonaktifkan di lingkungan ini (bukan "tidak ada kelas"). */
  skipped?: boolean;
  skippedReason?: 'AUTO_CANCEL_DISABLED';
  evaluatedAt: Date;
  evaluatedSlotsCount: number;
  cancelledSlotsCount: number;
  /** Kelas yang gagal dievaluasi pada putaran ini (dilewati, dicoba lagi putaran berikutnya). */
  failedSlotsCount?: number;
  confirmedSlotsCount: number;
  cancelledSlots: Array<{
    slotId: string;
    branchId: string;
    branchName: string;
    className: string;
    startAt: Date;
    bookedCount: number;
    minQuota: number;
    refundedBookingsCount: number;
  }>;
}

@Injectable()
export class AutoCancelService {
  private readonly logger = new Logger(AutoCancelService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly whatsapp: WhatsAppGatewayService,
  ) {}

  /**
   * Evaluasi seluruh kelas yang akan mulai dalam rentang waktu cutoff (default H-24).
   * Membatalkan kelas yang pesertanya kurang dari minQuota (Keputusan Bisnis #4 & #5).
   */
  async evaluateClasses(now = new Date()): Promise<AutoCancelEvaluationResult> {
    if (process.env.ENABLE_AUTO_CANCEL !== 'true') {
      this.logger.log('AutoCancel evaluation disabled (ENABLE_AUTO_CANCEL !== "true")');
      return {
        skipped: true,
        skippedReason: 'AUTO_CANCEL_DISABLED',
        evaluatedAt: now,
        evaluatedSlotsCount: 0,
        cancelledSlotsCount: 0,
        confirmedSlotsCount: 0,
        cancelledSlots: [],
      };
    }
    // Ambil seluruh slot kelas yang masih aktif (PUBLISHED / DRAFT)
    // yang akan dimulai dalam 48 jam ke depan dari waktu sekarang
    const maxWindow = new Date(now.getTime() + 48 * 3_600_000);

    const upcomingSlots = await this.db.slotKelas.findMany({
      where: {
        status: { in: [ClassSlotStatus.PUBLISHED, ClassSlotStatus.DRAFT] },
        startAt: { gte: now, lte: maxWindow },
      },
      orderBy: { startAt: 'asc' },
      include: {
        branch: true,
        classType: true,
        instructor: { include: { profile: true } },
        bookings: {
          where: { status: 'BOOKED' },
          include: {
            user: true,
            customerPackage: { include: { package: true } },
          },
        },
      },
    });

    const cancelledSlots: AutoCancelEvaluationResult['cancelledSlots'] = [];
    let confirmedSlotsCount = 0;
    let gagalCount = 0;

    for (const slot of upcomingSlots) {
      // Satu kelas yang gagal (mis. WhatsApp tidak terkirim) tidak boleh menghentikan evaluasi kelas
      // lain. Dulu satu galat membuat sisa kelas tidak pernah dikonfirmasi pada setiap putaran.
      try {
        // 1. Ambil aturan MinQuotaSetting cabang & jenis kelas (fallback: minQuota=1, cutoffHours=24)
        const setting = await this.db.minQuotaSetting.findUnique({
          where: {
            branchId_classTypeId: {
              branchId: slot.branchId,
              classTypeId: slot.classTypeId,
            },
          },
        });

        const minQuota = setting?.active ? setting.minQuota : 1;
        const cutoffHours = setting?.active ? setting.cutoffHours : 24;

        // Evaluasi apakah kelas sudah memasuki batas waktu H-cutoff (startAt <= now + cutoffHours)
        const cutoffThreshold = new Date(slot.startAt.getTime() - cutoffHours * 3_600_000);
        const isPastCutoff = now.getTime() >= cutoffThreshold.getTime();

        if (!isPastCutoff) {
          // Kelas masih di luar batas cutoff H-24, belum perlu dievaluasi pembatalan
          continue;
        }

        const bookedCount = slot.bookings.length;

        // 2. Cek apakah kuota terpenuhi
        if (bookedCount >= minQuota) {
          // Kuota aman, konfirmasi kelas jika masih status awal. Klaim bersyarat status agar tidak menimpa
          // pembatalan staf yang terjadi di antara pembacaan dan penulisan; versi naik supaya form staf yang
          // terbuka dinyatakan usang.
          if (slot.status === ClassSlotStatus.PUBLISHED) {
            await this.db.slotKelas.updateMany({
              where: { id: slot.id, status: ClassSlotStatus.PUBLISHED },
              data: { status: ClassSlotStatus.CONFIRMED, version: { increment: 1 } },
            });
          }
          confirmedSlotsCount++;
          continue;
        }

        // 3. KUOTA KURANG -> AUTO-CANCEL KELAS (Keputusan Bisnis #4 & #5)
        this.logger.warn(
          `[AUTO_CANCEL] Slot ${slot.id} (${slot.classType.name} di ${slot.branch.name}) dibatalkan otomatis. Peserta: ${bookedCount} < MinQuota: ${minQuota}`,
        );

        const claimed = await this.db.$transaction(async (tx) => {
          // A. Perbarui status slot kelas. Klaim bersyarat: bila staf sudah membatalkan/menyelesaikan kelas ini
          // selagi evaluasi berjalan, jangan menimpa dan jangan mengirim notifikasi ganda.
          const claim = await tx.slotKelas.updateMany({
            where: {
              id: slot.id,
              status: { in: [ClassSlotStatus.PUBLISHED, ClassSlotStatus.DRAFT] },
            },
            data: {
              status: ClassSlotStatus.CANCELLED,
              cancellationReason: 'AUTO_CANCEL_MIN_QUOTA',
              bookedCount: 0,
              version: { increment: 1 },
            },
          });
          if (claim.count === 0) return false;

          // B. Batalkan seluruh booking peserta
          for (const booking of slot.bookings) {
            await tx.pemesananKelas.update({
              where: { id: booking.id },
              data: {
                status: 'CANCELLED',
                cancellationReason: 'CLASS_AUTO_CANCELLED',
                cancelledAt: now,
              },
            });

            // C. Catat pengembalian / keamanan sesi via SessionLedger jika ada pengurangan
            // Pada Rule #1 sesi dipotong saat COMPLETED, pembatalan booking mengembalikan kuota aktif.
            // Untuk kepatuhan SessionLedger dan audit integritas:
            if (booking.customerPackageId) {
              const customerPkg = await tx.paketPelanggan.findUnique({
                where: { id: booking.customerPackageId },
              });
              if (customerPkg) {
                await tx.sessionLedger.create({
                  data: {
                    customerPackageId: booking.customerPackageId,
                    type: SessionMutationType.REFUND_AUTOCANCEL,
                    amount: 0, // Saldo tidak terpotong di muka, dicatat untuk audit trail
                    balanceAfter: customerPkg.remainingSessions,
                    referenceId: booking.id,
                    notes: `Auto-cancel kelas ${slot.classType.name} karena kuota tidak terpenuhi (kuota reservasi dilepas, saldo fisik utuh)`,
                  },
                });
              }
            }
          }
          return true;
        });
        // Kelas sudah diubah pihak lain saat evaluasi berjalan: lewati, tanpa notifikasi ganda.
        if (!claimed) continue;

        // 4. Kirim Notifikasi WhatsApp Multi-Pihak
        const classDateStr = new Intl.DateTimeFormat('id-ID', {
          dateStyle: 'full',
          timeStyle: 'short',
          timeZone: slot.branch.timezone || 'Asia/Jakarta',
        }).format(slot.startAt);

        // A. Kirim ke Setiap Customer yang Terdaftar
        for (const booking of slot.bookings) {
          if (booking.user?.phone) {
            const customerName = booking.user.displayName || 'Member';
            const message =
              `Halo ${customerName},\n\n` +
              `Kami informasikan bahwa kelas Pilates *${slot.classType.name}* di cabang *${slot.branch.name}* ` +
              `pada *${classDateStr}* dibatalkan otomatis karena kuota minimum kelas (${minQuota} orang) belum terpenuhi.\n\n` +
              `Kuota sesi Anda tetap aman dan dapat langsung digunakan untuk memilih jadwal kelas lainnya.\n\n` +
              `Terima kasih atas pengertian Anda.\n_Daily Dose Pilates_`;

            await this.whatsapp.sendMessage({
              to: booking.user.phone,
              text: message,
              recipientType: 'CUSTOMER',
              reminderType: 'CLASS_AUTO_CANCELLED',
              payload: { slotId: slot.id, bookingId: booking.id },
            });
          }
        }

        // B. Kirim ke Instruktur Pengajar
        if (slot.instructor?.phone) {
          const instructorName = slot.instructor.displayName || 'Coach';
          const instructorMsg =
            `Halo Coach ${instructorName},\n\n` +
            `Kelas *${slot.classType.name}* di cabang *${slot.branch.name}* pada *${classDateStr}* ` +
            `dibatalkan otomatis oleh sistem karena kuota minimum (${minQuota} peserta) tidak terpenuhi.\n\n` +
            `Jadwal mengajar Anda telah dibebaskan. Terima kasih.\n_Daily Dose Pilates_`;

          await this.whatsapp.sendMessage({
            to: slot.instructor.phone,
            text: instructorMsg,
            recipientType: 'INSTRUCTOR',
            reminderType: 'CLASS_AUTO_CANCELLED_INSTRUCTOR',
            payload: { slotId: slot.id },
          });
        }

        // C. Kirim Notifikasi ke Admin & Owner Cabang
        const branchStaff = await this.db.user.findMany({
          where: {
            role: { in: ['ADMIN', 'MANAGER', 'OWNER', 'SUPER_OWNER'] },
            OR: [
              { preferredBranchId: slot.branchId },
              { ownedBranches: { some: { branchId: slot.branchId } } },
              { role: 'SUPER_OWNER' },
            ],
          },
        });

        for (const staff of branchStaff) {
          if (staff.phone) {
            const staffMsg =
              `[NOTIFIKASI OPERASIONAL DD]\n` +
              `Kelas *${slot.classType.name}* di cabang *${slot.branch.name}* pada *${classDateStr}* ` +
              `telah DIBATALKAN OTOMATIS (Peserta: ${bookedCount}/${minQuota}).\n\n` +
              `Seluruh peserta telah diinfokan melalui WhatsApp.`;

            await this.whatsapp.sendMessage({
              to: staff.phone,
              text: staffMsg,
              recipientType: staff.role as any,
              reminderType: 'CLASS_AUTO_CANCELLED_STAFF',
              payload: { slotId: slot.id, branchId: slot.branchId },
            });
          }
        }

        cancelledSlots.push({
          slotId: slot.id,
          branchId: slot.branchId,
          branchName: slot.branch.name,
          className: slot.classType.name,
          startAt: slot.startAt,
          bookedCount,
          minQuota,
          refundedBookingsCount: slot.bookings.length,
        });
      } catch (error) {
        gagalCount++;
        this.logger.error(
          `[AUTO_CANCEL] Gagal mengevaluasi slot ${slot.id}: ${(error as Error)?.message ?? error}`,
        );
      }
    }

    return {
      evaluatedAt: now,
      evaluatedSlotsCount: upcomingSlots.length,
      cancelledSlotsCount: cancelledSlots.length,
      confirmedSlotsCount,
      failedSlotsCount: gagalCount,
      cancelledSlots,
    };
  }
}
