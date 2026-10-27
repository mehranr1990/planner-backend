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
} from './modules/spaces/public/index.js';
import { AuthModule } from './platform/auth/auth.module.js';

@Module({})
export class AppModule {
  static register(config: AppConfig): DynamicModule {
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
      ],
      controllers: [HealthController],
    };
  }
}
