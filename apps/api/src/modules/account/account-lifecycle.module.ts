import { Module } from '@nestjs/common';
import type { DynamicModule, Type } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { AuditModule } from '../../platform/audit/audit.service.js';
import { SpacesModule } from '../spaces/public/index.js';
import { AccountModule } from './account.module.js';
import { PersonalLifecycle } from './public/lifecycle.js';
import { LifecycleRepository } from './infrastructure/lifecycle.repository.js';
import {
  LifecycleController,
  lifecycleThrottle,
} from './http/lifecycle.controller.js';
import { PlatformPersonalData } from '../../platform/lifecycle/platform-data.js';
@Module({})
export class AccountLifecycleModule {
  static register(owners: Array<DynamicModule | Type>): DynamicModule {
    return {
      module: AccountLifecycleModule,
      imports: [
        DatabaseModule,
        AuditModule,
        SpacesModule,
        AccountModule,
        lifecycleThrottle,
        ...owners,
      ],
      providers: [
        PlatformPersonalData,
        { provide: PersonalLifecycle, useClass: LifecycleRepository },
      ],
      controllers: [LifecycleController],
      exports: [PersonalLifecycle],
    };
  }
}
