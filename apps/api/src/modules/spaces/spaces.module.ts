import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { SpacesRepository } from './infrastructure/spaces.repository.js';
import { SpacesService } from './application/spaces.service.js';
import { SpacePolicyService } from '../../platform/authorization/space-policy.service.js';
import { SPACES_REPOSITORY } from './application/spaces.port.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    { provide: SPACES_REPOSITORY, useClass: SpacesRepository },
    SpacesService,
    SpacePolicyService,
  ],
  exports: [SpacesService],
})
export class SpacesModule {}
