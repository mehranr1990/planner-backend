import { NotesData } from './public/personal-data.js';
import { NotesDataRepository } from './infrastructure/personal-data.repository.js';
import { NotesSync } from './public/sync-access.js';
import { NotesSyncRepository } from './infrastructure/sync.repository.js';
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { AuditModule } from '../../platform/audit/audit.service.js';
import { SpacesModule } from '../spaces/public/index.js';
import { NotesService } from './application/notes.service.js';
import { NOTES_REPOSITORY } from './application/notes.port.js';
import {
  NotesRepository,
  PersonalNotesRepository,
} from './infrastructure/notes.repository.js';
import { PersonalNotes } from './public/personal-notes.js';
import {
  NotesController,
  NoteFoldersController,
} from './http/notes.controller.js';
@Module({})
export class NotesModule {
  static register(tasks: DynamicModule, goals: DynamicModule): DynamicModule {
    return {
      module: NotesModule,
      imports: [DatabaseModule, AuditModule, SpacesModule, tasks, goals],
      providers: [
        { provide: NotesData, useClass: NotesDataRepository },
        { provide: NotesSync, useClass: NotesSyncRepository },
        NotesService,
        NotesRepository,
        { provide: NOTES_REPOSITORY, useExisting: NotesRepository },
        { provide: PersonalNotes, useClass: PersonalNotesRepository },
      ],
      controllers: [NoteFoldersController, NotesController],
      exports: [NotesData, NotesSync, PersonalNotes],
    };
  }
}
