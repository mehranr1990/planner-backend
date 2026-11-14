import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  Query,
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
import { ProjectGuard } from './projects.controller.js';
import { ProjectOverviewService } from '../application/project-overview.service.js';
const uuid = new ZodValidationPipe(c.ProjectCreateSchema.shape.id);

@Controller('projects/:id')
@UseGuards(VerifiedSessionGuard, ProjectGuard)
export class ProjectOverviewController {
  constructor(
    @Inject(ProjectOverviewService)
    private readonly overview: ProjectOverviewService,
  ) {}

  @Get('access/me')
  accessMe(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(c.ProjectEmptySchema)) _query: unknown,
  ) {
    return this.overview.accessMe(actor, id);
  }

  @Get('metadata')
  async metadata(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(c.ProjectEmptySchema)) _query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.overview.metadata(actor, id);
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Patch('metadata')
  async patchMetadata(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(c.ProjectMetadataPatchSchema))
    body: z.infer<typeof c.ProjectMetadataPatchSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const revision = expectedRevision(match);
    if (revision === undefined) throw new BadRequestException();
    const value = await this.overview.patchMetadata(actor, id, revision, body);
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Get('members')
  members(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(c.ProjectPageQuerySchema))
    query: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    return this.overview.members(actor, id, query);
  }
  @Get('ownership-handovers')
  handovers(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(c.ProjectPageQuerySchema))
    query: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    return this.overview.handovers(actor, id, query);
  }
  @Get('dashboard')
  dashboard(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(c.ProjectReportWindowSchema))
    query: z.infer<typeof c.ProjectReportWindowSchema>,
  ) {
    return this.overview.dashboard(actor, id, query);
  }
}
