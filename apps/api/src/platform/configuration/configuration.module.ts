import {
  Global,
  Module,
  type DynamicModule,
  type Provider,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DatabaseModule } from '../database/database.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { AuditModule } from '../audit/audit.service.js';
import { ConfigurationCore } from './configuration-core.js';
import { ConfigurationService } from './configuration.service.js';
import { ConfigurationMaintenance } from './maintenance.js';
import { ConfigurationRuntime } from './runtime.js';
import { ConfigurationInterceptor } from './configuration.interceptor.js';
import {
  ConfigurationController,
  ConfigurationStatusController,
  ConfigurationEffectiveController,
} from './configuration.controller.js';
@Global()
@Module({})
export class PlatformConfigurationModule {
  static register(
    imports: NonNullable<DynamicModule['imports']>,
    authority: Provider,
  ): DynamicModule {
    return {
      module: PlatformConfigurationModule,
      imports: [DatabaseModule, AdminModule, AuditModule, ...imports],
      providers: [
        ConfigurationCore,
        ConfigurationService,
        ConfigurationMaintenance,
        ConfigurationRuntime,
        authority,
        { provide: APP_INTERCEPTOR, useClass: ConfigurationInterceptor },
      ],
      controllers: [
        ConfigurationController,
        ConfigurationStatusController,
        ConfigurationEffectiveController,
      ],
      exports: [ConfigurationCore, ConfigurationRuntime],
    };
  }
}
