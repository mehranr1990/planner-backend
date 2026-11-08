import { CalendarCustodyGraph } from './application/calendar-custody-graph.js';
import { CalendarData } from './public/personal-data.js';
import { SharedScheduling } from './public/shared-scheduling.js';
import { SharedSchedulingRepository } from './infrastructure/shared-scheduling.repository.js';
import { CalendarDataRepository } from './infrastructure/personal-data.repository.js';
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
        CalendarCustodyGraph,
        { provide: SharedCalendar, useClass: SharedCalendarRepository },
        { provide: SharedScheduling, useClass: SharedSchedulingRepository },
        { provide: CalendarData, useClass: CalendarDataRepository },
        CalendarService,
        { provide: CALENDAR_REPOSITORY, useClass: CalendarRepository },
      ],
      controllers: [CalendarController],
      exports: [
        CalendarCustodyGraph,
        CalendarData,
        SharedScheduling,
        SharedCalendar,
      ],
    };
  }
}
import { SharedCalendar } from './public/shared-calendar.js';
import { SharedCalendarRepository } from './infrastructure/shared-calendar.repository.js';
