import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Inject,
  UseGuards,
} from '@nestjs/common';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import { VerifiedSessionGuard } from '../../platform/auth/session.guard.js';
import { CurrentActor } from '../../platform/auth/request-actor.js';
import type { RequestActor } from '../../platform/auth/request-actor.js';
import { ZodValidationPipe } from '../../bootstrap/zod-validation.pipe.js';
import { SpacesService } from '../spaces/public/index.js';
import { SyncService } from './sync.service.js';
@Controller('sync')
@UseGuards(VerifiedSessionGuard)
export class SyncController {
  constructor(
    @Inject(SpacesService) private readonly spaces: SpacesService,
    @Inject(SyncService) private readonly sync: SyncService,
  ) {}
  @Post('push') async push(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(c.SyncPushSchema))
    body: z.infer<typeof c.SyncPushSchema>,
    @Query(new ZodValidationPipe(c.EmptyQuerySchema)) _q: unknown,
  ) {
    return this.sync.push(await this.spaces.authorizePersonal(actor), body);
  }
  @Get('pull') async pull(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(c.SyncPullQuerySchema))
    query: z.infer<typeof c.SyncPullQuerySchema>,
  ) {
    return this.sync.pull(await this.spaces.authorizePersonal(actor), query);
  }
  @Get('status') async status(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(c.EmptyQuerySchema)) _q: unknown,
  ) {
    return this.sync.status(await this.spaces.authorizePersonal(actor));
  }
}
