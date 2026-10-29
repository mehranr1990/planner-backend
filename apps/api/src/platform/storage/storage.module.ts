import { VoiceFilesController } from './voice-files.controller.js';
import { FilePortability } from './public/file-portability.js';
import { ErasureControl } from './erasure-control.js';
import { FileCatalog } from './public/file-catalog.js';
import { Module } from '@nestjs/common';
import type { DynamicModule, ModuleMetadata, Provider } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from '../database/database.module.js';
import { AuditModule } from '../audit/audit.service.js';
import { STORAGE_PORT } from './storage.port.js';
import { LocalFileStorage } from './local-storage.js';
import { FilesRepository } from './files.repository.js';
import { FilesService } from './files.service.js';
import { FileThrottleGuard, FilesController } from './files.controller.js';

@Module({})
export class StorageModule {
  static register(
    imports: ModuleMetadata['imports'],
    scopeProvider: Provider,
  ): DynamicModule {
    return {
      module: StorageModule,
      imports: [
        ...(imports ?? []),
        DatabaseModule,
        AuditModule,
        ThrottlerModule.forRoot({
          throttlers: [{ name: 'files', ttl: 60000, limit: 60 }],
        }),
      ],
      controllers: [FilesController, VoiceFilesController],
      providers: [
        FilePortability,
        ErasureControl,
        scopeProvider,
        FileCatalog,
        FileThrottleGuard,
        FilesRepository,
        FilesService,
        { provide: STORAGE_PORT, useClass: LocalFileStorage },
      ],
      exports: [
        FilesService,
        STORAGE_PORT,
        FileCatalog,
        FilePortability,
        ErasureControl,
      ],
    };
  }
}
