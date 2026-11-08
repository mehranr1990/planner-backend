import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { AuditModule } from '../../platform/audit/audit.service.js';
import { SpacesModule } from '../spaces/public/index.js';
import { MessagingService } from './application/messaging.service.js';
import { AdvancedMessagingService } from './application/advanced-messaging.service.js';
import { AdvancedMessagingController } from './http/advanced-messaging.controller.js';
import {
  MessagingController,
  ConversationInvitationsController,
  MessagingGuard,
} from './http/messaging.controller.js';
@Module({
  imports: [DatabaseModule, SpacesModule, AuditModule],
  providers: [MessagingService, AdvancedMessagingService, MessagingGuard],
  controllers: [
    MessagingController,
    ConversationInvitationsController,
    AdvancedMessagingController,
  ],
  exports: [MessagingService, AdvancedMessagingService, MessagingGuard],
})
export class MessagingModule {}
