import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { AuditModule } from '../../platform/audit/audit.service.js';
import { SpacesModule } from '../spaces/public/index.js';
import { CalendarController } from './http/calendar.controller.js';
import { CalendarService } from './application/calendar.service.js';
import { CALENDAR_REPOSITORY } from './application/calendar.port.js';
import { CalendarRepository } from './infrastructure/calendar.repository.js';
@Module({})
export class CalendarModule {
  static register(tasks: DynamicModule): DynamicModule {
    return {
      module: CalendarModule,
      imports: [DatabaseModule, AuditModule, SpacesModule, tasks],
      providers: [
        CalendarService,
        { provide: CALENDAR_REPOSITORY, useClass: CalendarRepository },
      ],
      controllers: [CalendarController],
    };
  }
}
