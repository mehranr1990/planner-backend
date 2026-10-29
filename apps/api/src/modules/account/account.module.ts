import { FinancePreferences } from './public/finance-preferences.js';
import { NotificationIdentity } from './public/notification-identity.js';
import { NotificationIdentityRepository } from './infrastructure/notification-identity.repository.js';
import { FinancePreferencesRepository } from './infrastructure/finance-preferences.repository.js';
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
    { provide: NotificationIdentity, useClass: NotificationIdentityRepository },
    { provide: SETTINGS_REPOSITORY, useClass: SettingsRepository },
    AccountService,
    { provide: FinancePreferences, useClass: FinancePreferencesRepository },
    { provide: PlanningPreferences, useClass: PlanningPreferencesRepository },
  ],
  controllers: [MeController],
  exports: [PlanningPreferences, FinancePreferences, NotificationIdentity],
})
export class AccountModule {}
