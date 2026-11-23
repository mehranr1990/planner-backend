import { AdminSessionController } from './admin-session.controller.js';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from '../database/database.module.js';
import { AdminService } from './admin.service.js';
import { AdminGuard } from './admin.guard.js';
import { AdminController } from './admin.controller.js';
@Module({
  imports: [DatabaseModule],
  providers: [AdminService, { provide: APP_GUARD, useClass: AdminGuard }],
  controllers: [AdminController, AdminSessionController],
  exports: [AdminService],
})
export class AdminModule {}
