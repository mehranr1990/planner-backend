import { Module } from '@nestjs/common';
import { DatabaseService } from './database.service.js';
import { PrivacyGate } from '../authorization/privacy-gate.js';

@Module({
  providers: [DatabaseService, PrivacyGate],
  exports: [DatabaseService, PrivacyGate],
})
export class DatabaseModule {}
