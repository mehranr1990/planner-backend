import { EngagementQueries } from './engagement-queries.js';
import { EngagementPolicies } from './engagement-policies.js';
import { EngagementData } from './public/engagement-data.js';
import { EngagementWorker } from './engagement.worker.js';
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { AdminModule } from '../../platform/admin/admin.module.js';
import { AccountModule } from '../account/public/index.js';
import { SpacesModule } from '../spaces/public/index.js';
import { MessagingModule } from '../messaging/public/index.js';
import { NotificationChannelModule } from '../notifications/public/index.js';
import { EngagementCore } from './engagement-core.js';
import { EngagementEvidence } from './engagement-evidence.js';
import { SupportService } from './support.service.js';
import { CommunicationsService } from './communications.service.js';
import { ModerationService } from './moderation.service.js';
import {
  PostgresSupportInbound,
  SupportInboundRuntime,
  SUPPORT_INBOUND_ADAPTER,
  SUPPORT_INBOUND_DOMAIN,
} from './support-inbound.adapter.js';
import {
  EngagementAdminController,
  EngagementUserController,
  RegisteredSupportGuard,
} from './engagement.controller.js';
@Module({})
export class EngagementModule {
  static register(storage: DynamicModule): DynamicModule {
    return {
      module: EngagementModule,
      imports: [
        DatabaseModule,
        AdminModule,
        AccountModule,
        SpacesModule,
        MessagingModule,
        NotificationChannelModule,
        storage,
      ],
      providers: [
        EngagementPolicies,
        EngagementQueries,
        EngagementData,
        EngagementWorker,
        EngagementCore,
        EngagementEvidence,
        SupportService,
        CommunicationsService,
        ModerationService,
        PostgresSupportInbound,
        SupportInboundRuntime,
        RegisteredSupportGuard,
        { provide: SUPPORT_INBOUND_ADAPTER, useValue: null },
        { provide: SUPPORT_INBOUND_DOMAIN, useValue: null },
      ],
      controllers: [EngagementAdminController, EngagementUserController],
      exports: [
        EngagementData,
        EngagementWorker,
        SupportInboundRuntime,
        EngagementEvidence,
        SupportService,
        CommunicationsService,
        ModerationService,
      ],
    };
  }
}
