import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { AuditModule } from '../../platform/audit/audit.service.js';
import { SpacesModule } from '../spaces/public/index.js';
import { MessagingModule } from '../messaging/public/index.js';
import { SocialContext } from './application/social-context.js';
import { ConnectionsService } from './application/connections.service.js';
import { SocialGroupsService } from './application/groups.service.js';
import { SocialGuard, SocialController } from './http/social.controller.js';
import {
  SocialGroupsController,
  SocialGroupInvitationsController,
} from './http/groups.controller.js';
import { SocialData } from './public/personal-data.js';
import { SocialDataOwner } from './application/social-data.js';
import { SocialLifecycle } from './application/social-lifecycle.js';
@Module({
  imports: [DatabaseModule, AuditModule, SpacesModule, MessagingModule],
  providers: [
    SocialContext,
    ConnectionsService,
    SocialGroupsService,
    SocialGuard,
    SocialLifecycle,
    { provide: SocialData, useClass: SocialDataOwner },
  ],
  controllers: [
    SocialController,
    SocialGroupsController,
    SocialGroupInvitationsController,
  ],
  exports: [
    ConnectionsService,
    SocialGroupsService,
    SocialData,
    SocialLifecycle,
  ],
})
export class SocialModule {}
