import { CommerceAnalytics } from './public/analytics.js';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { AdminModule } from '../../platform/admin/admin.module.js';
import { SpacesModule } from '../spaces/public/index.js';
import { CommerceCore } from './commerce-core.js';
import { CatalogService } from './catalog.service.js';
import { SubscriptionsService } from './subscriptions.service.js';
import { FinancialLedger } from './financial-ledger.js';
import { BillingService } from './billing.service.js';
import { CommerceQueries } from './commerce-queries.js';
import { CommerceWorker } from './commerce.worker.js';
import {
  CommerceAdminController,
  CommerceUserController,
  CommerceCatalogController,
} from './commerce.controller.js';
import { AuditModule } from '../../platform/audit/audit.service.js';
import { CommerceData } from './public/commerce-data.js';
@Module({
  imports: [DatabaseModule, AdminModule, SpacesModule, AuditModule],
  providers: [
    CommerceAnalytics,
    CommerceCore,
    CatalogService,
    SubscriptionsService,
    FinancialLedger,
    BillingService,
    CommerceQueries,
    CommerceWorker,
    CommerceData,
  ],
  controllers: [
    CommerceAdminController,
    CommerceUserController,
    CommerceCatalogController,
  ],
  exports: [CommerceWorker, CommerceData, CommerceAnalytics],
})
export class CommerceModule {}
