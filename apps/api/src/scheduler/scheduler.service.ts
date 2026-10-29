import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { AutoCancelService } from '../classes/auto-cancel.service';
import { PrismaService } from '../database/prisma.service';
import { KirimQrService } from '../notifications/kirim-qr.service';
import { ReminderScheduleService } from '../notifications/reminder-schedule.service';
import { PaymentExpirationWorkerService } from '../packages/payment-expiration-worker';

export type SchedulerJobName =
  'expire-orders' | 'expire-packages' | 'auto-cancel' | 'reminders' | 'check-in-qr';

export interface SchedulerJobStatus {
  name: SchedulerJobName;
  label: string;
  intervalMs: number;
  running: boolean;
  runCount: number;
  failCount: number;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastDurationMs: number | null;
  lastOk: boolean | null;
  lastResult: Record<string, unknown> | null;
  /** Kode galat saja; pesan mentah tidak disimpan agar tidak membocorkan detail internal. */
  lastError: string | null;
}

interface Job {
  name: SchedulerJobName;
  label: string;
  intervalMs: number;
  run(): Promise<Record<string, unknown>>;
}

const MINUTE = 60_000;
/** Tunda putaran pertama setelah API hidup agar restart (mis. dev watch) tidak langsung menjalankan pekerjaan. */
const FIRST_RUN_DELAY_MS = 30_000;

/**
 * Penjadwal kecil di dalam proses API: menggantikan `apps/worker`. Tanpa Redis dan tanpa proses tambahan.
 *
 * - Hidup hanya bila `SCHEDULER_ENABLED=true` (produksi); di dev dan tes mati supaya tidak mengirim pesan atau membatalkan data.
 * - Setiap pekerjaan idempoten dan aman dijalankan ulang; satu pekerjaan tidak pernah berjalan tumpang tindih.
 * - Dirancang untuk SATU instance API (sesuai konfigurasi produksi `instances: 1`).
 */
@Injectable()
export class SchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly state = new Map<SchedulerJobName, SchedulerJobStatus>();
  private bootedAt: number | null = null;
  private readonly jobs: Job[];

  constructor(
    private readonly db: PrismaService,
    private readonly orders: PaymentExpirationWorkerService,
    private readonly autoCancel: AutoCancelService,
    private readonly reminders: ReminderScheduleService,
    private readonly kirimQr: KirimQrService,
  ) {
    this.jobs = [
      {
        name: 'expire-orders',
        label: 'Batalkan pesanan yang lewat batas bayar',
        intervalMs: 15 * MINUTE,
        run: async () => {
          const result = await this.orders.expirePendingOrders();
          return { expiredCount: result.expiredCount };
        },
      },
      {
        name: 'expire-packages',
        label: 'Tandai paket pelanggan yang kedaluwarsa',
        intervalMs: 60 * MINUTE,
        run: async () => {
          const result = await this.db.paketPelanggan.updateMany({
            where: { status: 'ACTIVE', validUntil: { lt: new Date() } },
            data: { status: 'EXPIRED' },
          });
          return { expiredCount: result.count };
        },
      },
      {
        name: 'auto-cancel',
        label: 'Evaluasi kuota minimum kelas (H-24)',
        intervalMs: 30 * MINUTE,
        run: async () => {
          // Tetap dijaga ENABLE_AUTO_CANCEL di AutoCancelService.
          const result = await this.autoCancel.evaluateClasses();
          return {
            skipped: Boolean((result as { skipped?: boolean }).skipped),
            evaluated: result.evaluatedSlotsCount,
            confirmed: result.confirmedSlotsCount,
            cancelled: result.cancelledSlotsCount,
          };
        },
      },
      {
        name: 'reminders',
        label: 'Pengingat WhatsApp (pelanggan, admin, owner)',
        intervalMs: 60 * MINUTE,
        run: async () => {
          // Pengiriman berulang dicegah jendela dedup di ReminderLog.
          const result = await this.reminders.runAllReminders();
          return JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
        },
      },
      {
        name: 'check-in-qr',
        label: 'Kirim QR kehadiran ke WhatsApp akun baru',
        intervalMs: 15 * MINUTE,
        run: async () => {
          // Sekali seumur akun: dedup di ReminderLog; yang gagal dicoba lagi putaran berikutnya.
          const result = await this.kirimQr.kirimOtomatis();
          return { ...result };
        },
      },
    ];
    for (const job of this.jobs)
      this.state.set(job.name, {
        name: job.name,
        label: job.label,
        intervalMs: job.intervalMs,
        running: false,
        runCount: 0,
        failCount: 0,
        lastStartedAt: null,
        lastFinishedAt: null,
        lastDurationMs: null,
        lastOk: null,
        lastResult: null,
        lastError: null,
      });
  }

  get enabled(): boolean {
    return process.env.SCHEDULER_ENABLED === 'true';
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.logger.log('Penjadwal mati (SCHEDULER_ENABLED bukan "true").');
      return;
    }
    this.bootedAt = Date.now();
    for (const job of this.jobs) {
      const first = setTimeout(() => {
        void this.runJob(job.name);
        const repeat = setInterval(() => void this.runJob(job.name), job.intervalMs);
        repeat.unref();
        this.timers.push(repeat);
      }, FIRST_RUN_DELAY_MS);
      first.unref();
      this.timers.push(first);
    }
    this.logger.log(`Penjadwal hidup: ${this.jobs.map((job) => job.name).join(', ')}.`);
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    this.timers.length = 0;
  }

  /** Menjalankan satu pekerjaan sekarang; tidak melempar galat dan tidak berjalan tumpang tindih. */
  async runJob(name: SchedulerJobName): Promise<SchedulerJobStatus> {
    const job = this.jobs.find((item) => item.name === name);
    const status = this.state.get(name);
    if (!job || !status) throw new Error(`UNKNOWN_JOB:${name}`);
    if (status.running) return status;

    const started = Date.now();
    status.running = true;
    status.lastStartedAt = new Date(started).toISOString();
    try {
      status.lastResult = await job.run();
      status.lastOk = true;
      status.lastError = null;
    } catch (error) {
      status.lastOk = false;
      status.failCount += 1;
      status.lastError = error instanceof Error ? error.constructor.name : 'UNKNOWN_ERROR';
      this.logger.error(`Pekerjaan ${name} gagal (${status.lastError}).`);
    } finally {
      status.running = false;
      status.runCount += 1;
      status.lastFinishedAt = new Date().toISOString();
      status.lastDurationMs = Date.now() - started;
    }
    return status;
  }

  status(): { enabled: boolean; jobs: SchedulerJobStatus[] } {
    return { enabled: this.enabled, jobs: [...this.state.values()].map((item) => ({ ...item })) };
  }

  /**
   * Sehat bila mati (tidak dipantau) atau setiap pekerjaan berhasil dalam 3x intervalnya
   * (setelah masa tenggang yang sama sejak API hidup).
   */
  isHealthy(now = Date.now()): boolean {
    if (!this.enabled || this.bootedAt === null) return true;
    return [...this.state.values()].every((job) => {
      const grace = FIRST_RUN_DELAY_MS + job.intervalMs * 3;
      if (!job.lastFinishedAt || job.lastOk === false) return now - this.bootedAt! < grace;
      return now - Date.parse(job.lastFinishedAt) < job.intervalMs * 3;
    });
  }
}
