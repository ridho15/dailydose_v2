import {
  Controller,
  Get,
  Post,
  Optional,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../identity/auth.guard';
import { Roles } from '../identity/roles.decorator';
import { RolesGuard } from '../identity/roles.guard';
import { AutoCancelService } from '../classes/auto-cancel.service';
import { WhatsAppGatewayService } from './whatsapp-gateway.service';
import { ReminderScheduleService } from './reminder-schedule.service';
import { PrismaService } from '../database/prisma.service';
import { newId } from '../identity/security';

@Controller('operations')
@UseGuards(AuthGuard, RolesGuard)
export class OperationsAutomationController {
  constructor(
    private readonly autoCancel: AutoCancelService,
    private readonly whatsapp: WhatsAppGatewayService,
    private readonly reminderSchedule: ReminderScheduleService,
    @Optional() private readonly db?: PrismaService,
  ) {}

  /**
   * Memicu evaluasi pembatalan otomatis kelas kurang kuota pada H-24 (Keputusan Bisnis #4 & #5)
   */
  @Post('auto-cancel/evaluate')
  @Roles('SUPER_OWNER')
  async evaluateAutoCancel(@Req() req: AuthenticatedRequest) {
    const result = await this.autoCancel.evaluateClasses();

    if (this.db) {
      await this.db.auditLog.create({
        data: {
          id: newId(),
          action: 'operations.auto_cancel_evaluated',
          actorId: req.principal?.userId ?? 'system',
          reason: 'Manual evaluation triggered by Super Owner',
          detail: {
            evaluatedSlotsCount: result?.evaluatedSlotsCount ?? 0,
            cancelledSlotsCount: result?.cancelledSlotsCount ?? 0,
            confirmedSlotsCount: result?.confirmedSlotsCount ?? 0,
          },
        },
      }).catch(() => null);
    }

    return {
      success: true,
      data: result,
    };
  }

  /**
   * Memicu evaluasi pengingat berjenjang WhatsApp (Keputusan Bisnis #11, #12, #13)
   */
  @Post('reminders/evaluate-batch')
  @Roles('SUPER_OWNER')
  async evaluateRemindersBatch(@Req() req: AuthenticatedRequest) {
    const result = await this.reminderSchedule.runAllReminders();

    if (this.db) {
      await this.db.auditLog.create({
        data: {
          id: newId(),
          action: 'operations.reminders_batch_evaluated',
          actorId: req.principal?.userId ?? 'system',
          reason: 'Manual reminder batch triggered by Super Owner',
          detail: JSON.parse(JSON.stringify(result)),
        },
      }).catch(() => null);
    }

    return {
      success: true,
      data: result,
    };
  }

  /**
   * Mengambil riwayat pengiriman pesan WhatsApp (ReminderLog)
   */
  @Get('reminders/logs')
  @Roles('SUPER_OWNER', 'OWNER', 'MANAGER', 'FINANCE')
  async listReminderLogs(
    @Req() _req: AuthenticatedRequest,
    @Query('phone') phone?: string,
    @Query('reminderType') reminderType?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? Math.max(1, Number(page)) : 1;
    const limitNum = limit ? Math.max(1, Math.min(Number(limit), 100)) : 20;

    const [logs, total] = await Promise.all([
      this.whatsapp.listLogs({
        phone,
        reminderType,
        status,
        page: pageNum,
        limit: limitNum,
      }),
      this.whatsapp.countLogs({
        phone,
        reminderType,
        status,
      }),
    ]);

    return {
      success: true,
      data: {
        items: logs,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.max(1, Math.ceil(total / limitNum)),
      },
    };
  }

  /**
   * Ringkasan statistik pengiriman pengingat & otomasi
   */
  @Get('reminders/summary')
  @Roles('SUPER_OWNER', 'OWNER', 'MANAGER', 'FINANCE')
  async getRemindersSummary(@Req() _req: AuthenticatedRequest) {
    const recentLogs = await this.whatsapp.listLogs({ limit: 100 });
    const sentCount = recentLogs.filter((l) => l.status === 'SENT').length;
    const failedCount = recentLogs.filter((l) => l.status === 'FAILED').length;

    return {
      success: true,
      data: {
        totalRecentSent: sentCount,
        totalRecentFailed: failedCount,
        lastSentAt: recentLogs[0]?.sentAt ?? null,
        provider: this.whatsapp.providerName,
      },
    };
  }
}
