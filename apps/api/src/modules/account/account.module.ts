import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { SpacesModule } from '../spaces/public/index.js';
import { SettingsRepository } from './infrastructure/settings.repository.js';
import { AccountService } from './application/account.service.js';
import { MeController } from './http/me.controller.js';
import { SETTINGS_REPOSITORY } from './application/settings.port.js';
import { AuditModule } from '../../platform/audit/audit.service.js';
import { PlanningPreferences } from './public/planning-preferences.js';
import { PlanningPreferencesRepository } from './infrastructure/planning-preferences.repository.js';

@Module({
  imports: [DatabaseModule, SpacesModule, AuditModule],
  providers: [
    { provide: SETTINGS_REPOSITORY, useClass: SettingsRepository },
    AccountService,
    { provide: PlanningPreferences, useClass: PlanningPreferencesRepository },
  ],
  controllers: [MeController],
  exports: [PlanningPreferences],
})
export class AccountModule {}
