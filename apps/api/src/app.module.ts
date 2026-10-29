import { FinanceModule } from './modules/finance/public/index.js';
import { InsightsModule } from './modules/insights/public/index.js';
import { RewardsModule } from './modules/rewards/public/index.js';
import { NotificationsModule } from './modules/notifications/public/index.js';
import { NotesModule } from './modules/notes/public/index.js';
import { JournalModule } from './modules/journal/public/index.js';
import { CaptureModule } from './modules/capture/public/index.js';
import { FocusModule } from './modules/focus/public/index.js';
import { GoalsModule } from './modules/goals/public/index.js';
import { TasksModule } from './modules/tasks/public/index.js';
import { PlanningModule } from './modules/planning/public/index.js';
import { CalendarModule } from './modules/calendar/public/index.js';
import { HabitsModule } from './modules/habits/public/index.js';
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigurationModule } from './bootstrap/configuration.module.js';
import type { AppConfig } from './bootstrap/environment.js';
import { DatabaseModule } from './platform/database/database.module.js';
import { loggingOptions } from './platform/observability/logging.js';
import { HealthController } from './platform/observability/health.controller.js';
import {
  AccountModule,
  initialAccountRelations,
} from './modules/account/public/index.js';
import {
  SpacesModule,
  initialSpaceRelations,
  SpacesService,
} from './modules/spaces/public/index.js';
import { AuthModule } from './platform/auth/auth.module.js';
import { StorageModule } from './platform/storage/public/index.js';
import { FILE_SCOPE_RESOLVER } from './platform/storage/files.controller.js';
import type { FileScopeResolver } from './platform/storage/files.controller.js';

@Module({})
export class AppModule {
  static register(config: AppConfig): DynamicModule {
    const storage = StorageModule.register([SpacesModule], {
      provide: FILE_SCOPE_RESOLVER,
      inject: [SpacesService],
      useFactory:
        (spaces: SpacesService): FileScopeResolver =>
        (actor) =>
          spaces.authorizePersonal(actor),
    });
    const tasks = TasksModule.register(storage);
    const goals = GoalsModule.register(tasks);
    const notes = NotesModule.register(tasks, goals);
    const capture = CaptureModule.register(tasks, goals, notes, storage);
    const planning = PlanningModule.register(tasks);
    const finance = FinanceModule.register(capture);
    const focus = FocusModule.register(tasks);
    return {
      module: AppModule,
      imports: [
        ConfigurationModule.register(config),
        DatabaseModule,
        LoggerModule.forRoot(loggingOptions(config)),
        AuthModule.register(() => ({
          ...initialAccountRelations(),
          ...initialSpaceRelations(),
        })),
        AccountModule,
        SpacesModule,
        storage,
        tasks,
        planning,
        CalendarModule.register(tasks),
        HabitsModule,
        goals,
        notes,
        JournalModule,
        capture,
        finance,
        focus,
        InsightsModule.register([tasks, planning, goals, focus, finance]),
        RewardsModule.register(tasks),
        NotificationsModule.register(tasks),
      ],
      controllers: [HealthController],
    };
  }
}
