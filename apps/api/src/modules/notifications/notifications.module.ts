import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { AuditModule } from '../../platform/audit/audit.service.js';
import { AccountModule } from '../account/public/index.js';
import { SpacesModule } from '../spaces/public/index.js';
import { NotificationsPort } from './application/notifications.port.js';
import { NotificationsService } from './application/notifications.service.js';
import { NotificationWorker } from './application/notification-worker.js';
import { NotificationsRepository } from './infrastructure/notifications.repository.js';
import { NotificationTransport } from './application/transport.port.js';
import { ChannelTransport } from './infrastructure/transport.js';
import { NotificationOutbox } from '../../platform/outbox/notification-consumer.js';
import { JobsService } from '../../platform/jobs/jobs.service.js';
import { NotificationsController } from './http/notifications.controller.js';
@Module({})
export class NotificationsModule {
  static register(tasks: DynamicModule): DynamicModule {
    return {
      module: NotificationsModule,
      imports: [
        DatabaseModule,
        AuditModule,
        AccountModule,
        SpacesModule,
        tasks,
      ],
      providers: [
        NotificationsService,
        NotificationWorker,
        JobsService,
        NotificationOutbox,
        { provide: NotificationsPort, useClass: NotificationsRepository },
        { provide: NotificationTransport, useClass: ChannelTransport },
      ],
      controllers: [NotificationsController],
      exports: [NotificationWorker],
    };
  }
}
