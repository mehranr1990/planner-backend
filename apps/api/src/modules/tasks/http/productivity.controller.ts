import {
  Controller,
  Get,
  Patch,
  Inject,
  UseGuards,
  Body,
  Param,
  Query,
  Headers,
  Res,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import * as c from '@mehran/api-contracts';
import { TaskProductivityService } from '../application/productivity.service.js';
import { SpacesService } from '../../spaces/public/index.js';
import { VerifiedSessionGuard } from '../../../platform/auth/session.guard.js';
import { CurrentActor } from '../../../platform/auth/request-actor.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { ZodValidationPipe } from '../../../bootstrap/zod-validation.pipe.js';
import {
  expectedRevision,
  revisionTag,
} from '../../../bootstrap/concurrency.js';
@Controller('tasks')
@UseGuards(VerifiedSessionGuard)
export class TaskProductivityController {
  constructor(
    @Inject(TaskProductivityService)
    private readonly service: TaskProductivityService,
    @Inject(SpacesService) private readonly spaces: SpacesService,
  ) {}
  @Get(':id/productivity') async get(
    @CurrentActor() actor: RequestActor,
    @Param('id', new ZodValidationPipe(c.TaskIdSchema)) id: string,
    @Query(new ZodValidationPipe(c.EmptyQuerySchema)) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.get(
      await this.spaces.authorizePersonal(actor),
      id,
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Patch(':id/productivity') async patch(
    @CurrentActor() actor: RequestActor,
    @Param('id', new ZodValidationPipe(c.TaskIdSchema)) id: string,
    @Query(new ZodValidationPipe(c.EmptyQuerySchema)) _q: unknown,
    @Body(new ZodValidationPipe(c.ProductivityTaskPatchSchema))
    body: c.ProductivityTaskPatch,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const revision = expectedRevision(tag);
    if (revision === undefined) throw new BadRequestException();
    const value = await this.service.patch(
      await this.spaces.authorizePersonal(actor),
      id,
      revision,
      body,
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
}
