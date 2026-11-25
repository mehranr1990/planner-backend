import { AdminSessionController } from './admin-session.controller.js';
import { AdminAuditRetention } from './audit-retention.service.js';
import { AdminSecurityAlerts } from './security-alerts.service.js';
import { AdminAuditController } from './audit-query.controller.js';
import { AdminAuditQuery } from './audit-query.service.js';
import { AdminSecurityController } from './security.controller.js';
import { AdminSecurityService } from './security.service.js';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from '../database/database.module.js';
import { AdminService } from './admin.service.js';
import { AdminGuard } from './admin.guard.js';
import { AdminController } from './admin.controller.js';
@Module({
  imports: [DatabaseModule],
  providers: [
    AdminAuditRetention,
    AdminSecurityAlerts,
    AdminAuditQuery,
    AdminService,
    AdminSecurityService,
    { provide: APP_GUARD, useClass: AdminGuard },
  ],
  controllers: [
    AdminAuditController,
    AdminController,
    AdminSessionController,
    AdminSecurityController,
  ],
  exports: [AdminService, AdminSecurityAlerts],
})
export class AdminModule {}
