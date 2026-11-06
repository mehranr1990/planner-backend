import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Query,
  Param,
  Headers,
  Res,
  Inject,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import { VerifiedSessionGuard } from '../../../platform/auth/session.guard.js';
import { CurrentActor } from '../../../platform/auth/request-actor.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { ZodValidationPipe } from '../../../bootstrap/zod-validation.pipe.js';
import {
  expectedRevision,
  revisionTag,
} from '../../../bootstrap/concurrency.js';
import { TeamGuard } from './teams.controller.js';
import { TeamAnalyticsService } from '../application/team-analytics.service.js';
const uuid = new ZodValidationPipe(c.TeamCreateSchema.shape.id),
  empty = new ZodValidationPipe(c.CollaborationEmptySchema);
@Controller('teams/:id')
@UseGuards(VerifiedSessionGuard, TeamGuard)
export class TeamAnalyticsController {
  constructor(
    @Inject(TeamAnalyticsService)
    private readonly service: TeamAnalyticsService,
  ) {}
  @Get('capacity') capacities(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(c.TeamCapacityQuerySchema))
    q: z.infer<typeof c.TeamCapacityQuerySchema>,
  ) {
    return this.service.capacities(actor, id, q);
  }
  @Post('capacity') async create(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.TeamCapacityCreateSchema))
    input: z.infer<typeof c.TeamCapacityCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.capacity(actor, id, input, undefined, key);
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Patch('capacity/:capacityId') async patch(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('capacityId', uuid) capacityId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.TeamCapacityInputSchema))
    input: z.infer<typeof c.TeamCapacityInputSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const revision = expectedRevision(match);
    if (revision === undefined) throw new BadRequestException();
    const value = await this.service.capacity(
      actor,
      id,
      { ...input, id: capacityId },
      revision,
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Get('workload') workload(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(c.TeamAnalyticsQuerySchema))
    q: z.infer<typeof c.TeamAnalyticsQuerySchema>,
  ) {
    return this.service.analyze(actor, id, q, 'workload');
  }
  @Get('portfolio') portfolio(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(c.TeamAnalyticsQuerySchema))
    q: z.infer<typeof c.TeamAnalyticsQuerySchema>,
  ) {
    return this.service.analyze(actor, id, q, 'portfolio');
  }
  @Get('dashboard') dashboard(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(c.TeamAnalyticsQuerySchema))
    q: z.infer<typeof c.TeamAnalyticsQuerySchema>,
  ) {
    return this.service.analyze(actor, id, q, 'dashboard');
  }
}
