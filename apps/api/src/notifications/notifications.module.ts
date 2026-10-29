import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { IdentityModule } from '../identity/identity.module';
import { ClassesModule } from '../classes/classes.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationManagementController } from './notification-management.controller';
import { NotificationManagementService } from './notification-management.service';
import { NotificationWriterService } from './notification-writer.service';
import { WhatsAppGatewayService } from './whatsapp-gateway.service';
import { ReminderScheduleService } from './reminder-schedule.service';
import { NotificationTemplateService } from './notification-template.service';
import { OperationsAutomationController } from './operations-automation.controller';
import { KirimQrController } from './kirim-qr.controller';
import { KirimQrService } from './kirim-qr.service';

@Global()
@Module({
  imports: [DatabaseModule, IdentityModule, ClassesModule],
  controllers: [
    NotificationsController,
    NotificationManagementController,
    OperationsAutomationController,
    KirimQrController,
  ],
  providers: [
    NotificationsService,
    NotificationManagementService,
    NotificationWriterService,
    WhatsAppGatewayService,
    ReminderScheduleService,
    NotificationTemplateService,
    KirimQrService,
  ],
  exports: [
    KirimQrService,
    NotificationWriterService,
    WhatsAppGatewayService,
    ReminderScheduleService,
    NotificationTemplateService,
  ],
})
export class NotificationsModule {}

