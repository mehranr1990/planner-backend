import { JournalData } from './public/personal-data.js';
import { JournalDataRepository } from './infrastructure/personal-data.repository.js';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { AuditModule } from '../../platform/audit/audit.service.js';
import { SpacesModule } from '../spaces/public/index.js';
import { AccountModule } from '../account/public/index.js';
import { JournalService } from './application/journal.service.js';
import { JOURNAL_REPOSITORY } from './application/journal.port.js';
import {
  JournalRepository,
  PersonalJournalRepository,
} from './infrastructure/journal.repository.js';
import { PersonalJournal } from './public/personal-journal.js';
import {
  JournalEntriesController,
  DailyCheckinsController,
  MoodsController,
} from './http/journal.controller.js';
@Module({
  imports: [DatabaseModule, AuditModule, SpacesModule, AccountModule],
  providers: [
    { provide: JournalData, useClass: JournalDataRepository },
    JournalService,
    JournalRepository,
    { provide: JOURNAL_REPOSITORY, useExisting: JournalRepository },
    { provide: PersonalJournal, useClass: PersonalJournalRepository },
  ],
  controllers: [
    JournalEntriesController,
    DailyCheckinsController,
    MoodsController,
  ],
  exports: [JournalData, PersonalJournal],
})
export class JournalModule {}
