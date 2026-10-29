import { Global, Module } from '@nestjs/common';
import type { DynamicModule, ModuleMetadata, Provider } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { IdentityMailService } from './mail.service.js';
import { VerifiedSessionGuard } from './session.guard.js';
import { INITIAL_IDENTITY_RELATIONS } from './identity-relations.js';
import type { InitialIdentityRelations } from './identity-relations.js';
import { AuditModule } from '../audit/audit.service.js';
import { IDENTITY_ADMISSION } from './admission.js';

@Global()
@Module({})
export class AuthModule {
  static register(
    relations: InitialIdentityRelations,
    imports: ModuleMetadata['imports'] = [],
    admission: Provider = {
      provide: IDENTITY_ADMISSION,
      useValue: async () => undefined,
    },
  ): DynamicModule {
    return {
      module: AuthModule,
      imports: [DatabaseModule, AuditModule, ...(imports ?? [])],
      controllers: [AuthController],
      providers: [
        admission,
        AuthService,
        IdentityMailService,
        VerifiedSessionGuard,
        { provide: INITIAL_IDENTITY_RELATIONS, useValue: relations },
      ],
      exports: [AuthService, VerifiedSessionGuard],
    };
  }
}
