import {
  Controller,
  Get,
  Put,
  Body,
  Headers,
  Param,
  Query,
  Res,
  Inject,
  Injectable,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import { z as schema } from 'zod';
import { VerifiedSessionGuard } from '../../../platform/auth/session.guard.js';
import { CurrentActor } from '../../../platform/auth/request-actor.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { ZodValidationPipe } from '../../../bootstrap/zod-validation.pipe.js';
import {
  expectedRevision,
  revisionTag,
} from '../../../bootstrap/concurrency.js';
import { CollaborationService } from '../application/collaboration.service.js';
import { RetentionSelectionService } from '../application/retention-selection.service.js';
const empty = new ZodValidationPipe(c.BackendCompletionEmptySchema),
  id = new ZodValidationPipe(schema.uuid());
/** Shared availability, rate limits and no-store, for any Shared space kind. */
@Injectable()
export class RetentionGuard implements CanActivate {
  constructor(
    @Inject(CollaborationService)
    private readonly service: CollaborationService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context
      .switchToHttp()
      .getRequest<Request & { actor?: RequestActor }>();
    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Cache-Control', 'no-store');
    await this.service.request(
      request.ip ?? request.socket.remoteAddress ?? 'unknown',
      request.actor,
    );
    return true;
  }
}
@Controller()
@UseGuards(VerifiedSessionGuard, RetentionGuard)
export class RetentionController {
  constructor(
    @Inject(RetentionSelectionService)
    private readonly retention: RetentionSelectionService,
  ) {}
  @Get('retention-policies') catalog(
    @Query(new ZodValidationPipe(c.RetentionPolicyCatalogQuerySchema))
    q: z.infer<typeof c.RetentionPolicyCatalogQuerySchema>,
  ) {
    return this.retention.catalog(q);
  }
  @Get('spaces/:spaceId/retention') async current(
    @CurrentActor() actor: RequestActor,
    @Param('spaceId', id) spaceId: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.retention.current(actor, spaceId);
    res.setHeader('ETag', revisionTag(v.revision));
    return v;
  }
  @Put('spaces/:spaceId/retention') async change(
    @CurrentActor() actor: RequestActor,
    @Param('spaceId', id) spaceId: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(new ZodValidationPipe(c.SpaceRetentionChangeSchema))
    body: z.infer<typeof c.SpaceRetentionChangeSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const expected = expectedRevision(match);
    if (expected === undefined) throw new BadRequestException();
    const v = await this.retention.change(actor, spaceId, expected, body);
    res.setHeader('ETag', revisionTag(v.revision));
    return v;
  }
}
