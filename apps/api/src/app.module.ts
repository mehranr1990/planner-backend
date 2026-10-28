import { TasksModule } from './modules/tasks/public/index.js';
import { PlanningModule } from './modules/planning/public/index.js';
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
        PlanningModule.register(tasks),
      ],
      controllers: [HealthController],
    };
  }
}
