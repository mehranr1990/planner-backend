import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Headers,
  Res,
  Inject,
  UseGuards,
  BadRequestException,
  HttpCode,
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
import { ProjectGuard } from './projects.controller.js';
import { ProjectTransferService } from '../application/project-transfer.service.js';
const uuid = new ZodValidationPipe(c.ProjectCreateSchema.shape.id),
  empty = new ZodValidationPipe(c.ProjectEmptySchema);
function revision(raw: string | undefined) {
  const n = expectedRevision(raw);
  if (n === undefined) throw new BadRequestException();
  return n;
}
@Controller('projects/:projectId/transfers')
@UseGuards(VerifiedSessionGuard, ProjectGuard)
export class ProjectTransferController {
  constructor(
    @Inject(ProjectTransferService)
    private readonly service: ProjectTransferService,
  ) {}
  @Post()
  @HttpCode(200)
  async preview(
    @CurrentActor() a: RequestActor,
    @Param('projectId', uuid) p: string,
    @Body(new ZodValidationPipe(c.ProjectTransferPreviewInputSchema))
    v: z.infer<typeof c.ProjectTransferPreviewInputSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.service.preview(a, p, v, key);
    res.setHeader('ETag', revisionTag(r.revision));
    return r;
  }
  @Get(':transferId')
  async get(
    @CurrentActor() a: RequestActor,
    @Param('projectId', uuid) p: string,
    @Param('transferId', uuid) id: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.service.get(a, p, id);
    res.setHeader('ETag', revisionTag(r.revision));
    return r;
  }
  @Post(':transferId/accept')
  @HttpCode(200)
  async accept(
    @CurrentActor() a: RequestActor,
    @Param('projectId', uuid) p: string,
    @Param('transferId', uuid) id: string,
    @Body(new ZodValidationPipe(c.ProjectTransferAcceptSchema))
    v: z.infer<typeof c.ProjectTransferAcceptSchema>,
    @Headers('if-match') raw: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.service.accept(
      a,
      p,
      id,
      revision(raw),
      v.manifestHash,
    );
    res.setHeader('ETag', revisionTag(r.revision));
    return r;
  }
  @Post(':transferId/apply')
  @HttpCode(200)
  async apply(
    @CurrentActor() a: RequestActor,
    @Param('projectId', uuid) p: string,
    @Param('transferId', uuid) id: string,
    @Body(new ZodValidationPipe(c.ProjectTransferApplySchema))
    v: z.infer<typeof c.ProjectTransferApplySchema>,
    @Headers('if-match') raw: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.service.apply(a, p, id, revision(raw), v, key);
    res.setHeader('ETag', revisionTag(r.revision));
    return r;
  }
  @Post(':transferId/cancel')
  @HttpCode(200)
  async cancel(
    @CurrentActor() a: RequestActor,
    @Param('projectId', uuid) p: string,
    @Param('transferId', uuid) id: string,
    @Body(new ZodValidationPipe(c.ProjectEmptySchema.optional())) _v: unknown,
    @Headers('if-match') raw: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.service.cancel(a, p, id, revision(raw));
    res.setHeader('ETag', revisionTag(r.revision));
    return r;
  }
}
