import {
  Controller,
  Get,
  Inject,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  EmptyQuerySchema,
  LiveHealthSchema,
  ReadyHealthSchema,
  healthRoutes,
} from '@mehran/api-contracts';
import { DatabaseService } from '../database/database.service.js';
import { ZodValidationPipe } from '../../bootstrap/zod-validation.pipe.js';

@Controller()
export class HealthController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  @Get(healthRoutes.live)
  live(@Query(new ZodValidationPipe(EmptyQuerySchema)) _query: unknown) {
    return LiveHealthSchema.parse({ status: 'ok' });
  }

  @Get(healthRoutes.ready)
  async ready(@Query(new ZodValidationPipe(EmptyQuerySchema)) _query: unknown) {
    try {
      await this.database.checkConnection();
    } catch {
      throw new ServiceUnavailableException();
    }
    return ReadyHealthSchema.parse({
      status: 'ok',
      checks: { database: 'up' },
    });
  }
}
