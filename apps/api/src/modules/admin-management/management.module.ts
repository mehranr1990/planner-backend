import { Module } from '@nestjs/common';
import { AdminPrivacyService } from './privacy.service.js';
import { AdminPrivacyController } from './privacy.controller.js';
import { UserSecurityService } from './user-security.service.js';
import { UserSecurityController } from './user-security.controller.js';
import type { DynamicModule, ModuleMetadata } from '@nestjs/common';
import { AccountModule } from '../account/public/index.js';
import { SpacesModule } from '../spaces/public/index.js';
import { AdminModule } from '../../platform/admin/admin.module.js';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { ManagementController } from './management.controller.js';
import { ManagementService } from './management.service.js';
import { AdminDeliveryService } from './admin-delivery.service.js';
@Module({
  imports: [AccountModule, SpacesModule, AdminModule, DatabaseModule],
  providers: [
    ManagementService,
    AdminDeliveryService,
    UserSecurityService,
    AdminPrivacyService,
  ],
  exports: [AdminDeliveryService],
  controllers: [
    ManagementController,
    UserSecurityController,
    AdminPrivacyController,
  ],
})
export class ManagementModule {
  static register(imports: ModuleMetadata['imports']): DynamicModule {
    return { module: ManagementModule, imports: imports ?? [] };
  }
}
