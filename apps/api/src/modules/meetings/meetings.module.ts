import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { AuditModule } from '../../platform/audit/audit.service.js';
import { SpacesModule } from '../spaces/public/index.js';
import { MeetingKernel } from './application/meeting-kernel.js';
@Module({
  imports: [DatabaseModule, AuditModule, SpacesModule],
  providers: [MeetingKernel],
  exports: [MeetingKernel],
})
export class MeetingsModule {}
