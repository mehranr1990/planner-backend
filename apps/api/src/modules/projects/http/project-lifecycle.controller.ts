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
import { ProjectCleanupService } from '../application/project-cleanup.service.js';
const uuid = new ZodValidationPipe(c.ProjectCreateSchema.shape.id),
  empty = new ZodValidationPipe(c.ProjectEmptySchema);
function revision(raw: string | undefined) {
  const n = expectedRevision(raw);
  if (n === undefined) throw new BadRequestException();
  return n;
}
@Controller('projects/:projectId/lifecycle-job')
@UseGuards(VerifiedSessionGuard, ProjectGuard)
export class ProjectLifecycleController {
  constructor(
    @Inject(ProjectCleanupService)
    private readonly cleanup: ProjectCleanupService,
  ) {}
  @Get()
  async status(
    @CurrentActor() a: RequestActor,
    @Param('projectId', uuid) p: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = c.ProjectLifecycleJobSchema.parse(
      await this.cleanup.lifecycle.status(a, p),
    );
    res.setHeader('ETag', revisionTag(r.revision));
    return r;
  }
  @Post('recovery-proof')
  @HttpCode(200)
  async proof(
    @CurrentActor() a: RequestActor,
    @Param('projectId', uuid) p: string,
    @Body(new ZodValidationPipe(c.ProjectLifecyclePasswordSchema))
    v: z.infer<typeof c.ProjectLifecyclePasswordSchema>,
    @Headers('if-match') raw: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = c.ProjectLifecycleProofSchema.parse(
      await this.cleanup.lifecycle.issueProof(a, p, revision(raw), v.password),
    );
    res.setHeader('ETag', revisionTag(r.revision));
    return r;
  }
  @Post('recover')
  @HttpCode(200)
  async recover(
    @CurrentActor() a: RequestActor,
    @Param('projectId', uuid) p: string,
    @Body(new ZodValidationPipe(c.ProjectLifecycleRecoverSchema))
    v: z.infer<typeof c.ProjectLifecycleRecoverSchema>,
    @Headers('if-match') raw: string | undefined,
    @Headers('x-deletion-recovery') proof: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = c.ProjectLifecycleRecoverySchema.parse(
      await this.cleanup.recover(
        a,
        p,
        revision(raw),
        v.generation,
        proof,
        v.password,
      ),
    );
    res.setHeader('ETag', revisionTag(r.revision));
    return r;
  }
}
