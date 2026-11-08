import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { AuditModule } from '../../platform/audit/audit.service.js';
import { SpacesModule } from '../spaces/public/index.js';
import { NotificationChannelModule } from '../notifications/public/index.js';
import { MessagingModule } from './messaging.module.js';
import { MessageMediaService } from './application/message-media.service.js';
import { MessageProgressService } from './application/message-progress.service.js';
import { MessageMediaController } from './http/message-media.controller.js';
import { MessageNotices } from './application/message-notices.service.js';
import { MessageNoticeWorker } from './application/message-notice-worker.js';
import { MessageNoticesController } from './http/message-notices.controller.js';
import { MessagingData } from './public/personal-data.js';
import { MessagingDataRepository } from './application/messaging-data.js';
@Module({})
export class MessagingMediaModule {
  static register(storage: DynamicModule): DynamicModule {
    return {
      module: MessagingMediaModule,
      imports: [
        MessagingModule,
        storage,
        DatabaseModule,
        AuditModule,
        SpacesModule,
        NotificationChannelModule,
      ],
      providers: [
        MessageMediaService,
        MessageProgressService,
        MessageNotices,
        MessageNoticeWorker,
        { provide: MessagingData, useClass: MessagingDataRepository },
      ],
      controllers: [MessageMediaController, MessageNoticesController],
      exports: [
        MessageMediaService,
        MessageProgressService,
        MessageNoticeWorker,
        MessagingData,
      ],
    };
  }
}
