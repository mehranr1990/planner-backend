import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { AuditModule } from '../../platform/audit/audit.service.js';
import { SpacesModule } from '../spaces/public/index.js';
import { MessagingService } from './application/messaging.service.js';
import { DmContacts } from './application/dm-contacts.service.js';
import { DmContactsController } from './http/dm-contacts.controller.js';
import { AdvancedMessagingService } from './application/advanced-messaging.service.js';
import { AdvancedMessagingController } from './http/advanced-messaging.controller.js';
import {
  MessagingController,
  ConversationInvitationsController,
  MessagingGuard,
} from './http/messaging.controller.js';
@Module({
  imports: [DatabaseModule, SpacesModule, AuditModule],
  providers: [
    MessagingService,
    AdvancedMessagingService,
    MessagingGuard,
    DmContacts,
  ],
  controllers: [
    DmContactsController,
    MessagingController,
    ConversationInvitationsController,
    AdvancedMessagingController,
  ],
  exports: [MessagingService, AdvancedMessagingService, MessagingGuard],
})
export class MessagingModule {}
