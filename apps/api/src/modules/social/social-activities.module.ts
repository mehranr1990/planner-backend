import { Inject, Module } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { AuditModule } from '../../platform/audit/audit.service.js';
import { SpacesModule } from '../spaces/public/index.js';
import {
  MessagingModule,
  ConversationSources,
} from '../messaging/public/index.js';
import { SocialModule } from './social.module.js';
import {
  ActivityRuntime,
  ActivityConversationGuard,
} from './application/activity-runtime.js';
import { SocialActivitiesService } from './application/activities.service.js';
import { SocialPlanningService } from './application/activity-planning.service.js';
import { SocialExpensesService } from './application/expenses.service.js';
import {
  SocialActivitiesController,
  SocialNoticesController,
  SocialGroupLedgerController,
  SocialActivityLedgerController,
} from './http/activities.controller.js';
import { LendingKit } from './application/lending-kit.js';
import { SocialLendingService } from './application/lending.service.js';
import { SocialLostFoundService } from './application/lost-found.service.js';
import {
  SocialAssetsController,
  SocialLoansController,
  SocialLostFoundController,
} from './http/lending.controller.js';
/** P6-02/P6-03 (and P6-04 lending, Lost & Found): needs the composed Task and Calendar owners, as Meetings does. */
@Module({})
export class SocialActivitiesModule implements OnModuleInit {
  constructor(
    @Inject(ConversationSources) private readonly sources: ConversationSources,
    @Inject(ActivityConversationGuard)
    private readonly guard: ActivityConversationGuard,
  ) {}
  /** ADR 0062: Messaging asks this guard on every Activity chat operation. */
  onModuleInit() {
    this.sources.register('SOCIAL_ACTIVITY', this.guard);
  }
  static register(
    tasks: DynamicModule,
    calendar: DynamicModule,
    finance: DynamicModule,
  ): DynamicModule {
    return {
      module: SocialActivitiesModule,
      imports: [
        DatabaseModule,
        AuditModule,
        SpacesModule,
        MessagingModule,
        SocialModule,
        tasks,
        calendar,
        finance,
      ],
      providers: [
        ActivityRuntime,
        ActivityConversationGuard,
        SocialActivitiesService,
        SocialPlanningService,
        SocialExpensesService,
        LendingKit,
        SocialLendingService,
        SocialLostFoundService,
      ],
      controllers: [
        SocialActivitiesController,
        SocialNoticesController,
        SocialGroupLedgerController,
        SocialActivityLedgerController,
        SocialAssetsController,
        SocialLoansController,
        SocialLostFoundController,
      ],
      exports: [
        SocialActivitiesService,
        SocialPlanningService,
        SocialExpensesService,
        SocialLendingService,
        SocialLostFoundService,
      ],
    };
  }
}
