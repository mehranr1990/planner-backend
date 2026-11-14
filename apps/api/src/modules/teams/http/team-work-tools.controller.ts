import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  Headers,
  Res,
  Inject,
  UseGuards,
  HttpCode,
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
import { TeamWorkToolsService } from '../application/team-work-tools.service.js';
const uuid = new ZodValidationPipe(c.TeamCreateSchema.shape.id),
  empty = new ZodValidationPipe(c.BackendCompletionEmptySchema);
function rev(match: string | undefined) {
  const result = expectedRevision(match);
  if (result === undefined) throw new BadRequestException();
  return result;
}
/** Team task checklists, dependencies, readiness and the TM-12 export snapshot. */
@Controller('teams/:id')
@UseGuards(VerifiedSessionGuard, TeamGuard)
export class TeamWorkToolsController {
  constructor(
    @Inject(TeamWorkToolsService) private readonly tools: TeamWorkToolsService,
  ) {}
  @Get('tasks/:sourceId/checklist') async checklist(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('sourceId', uuid) sourceId: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.tools.checklist(actor, id, sourceId);
    res.setHeader('ETag', revisionTag(v.revision));
    return v;
  }
  @Post('tasks/:sourceId/checklist') @HttpCode(200) async changeChecklist(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('sourceId', uuid) sourceId: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(new ZodValidationPipe(c.TeamChecklistChangeSchema))
    input: z.infer<typeof c.TeamChecklistChangeSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.tools.changeChecklist(
      actor,
      id,
      sourceId,
      rev(match),
      input,
    );
    res.setHeader('ETag', revisionTag(v.revision));
    return v;
  }
  @Get('dependencies') dependencies(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
  ) {
    return this.tools.dependencies(actor, id);
  }
  @Post('dependencies') async addDependency(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.DependencyInputSchema))
    input: z.infer<typeof c.DependencyInputSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.tools.addDependency(actor, id, input);
    res.setHeader('ETag', revisionTag(v.revision));
    return v;
  }
  @Post('dependencies/:dependencyId/retire') @HttpCode(200) async retire(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('dependencyId', uuid) dependencyId: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(empty) _b: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.tools.retireDependency(
      actor,
      id,
      dependencyId,
      rev(match),
    );
    res.setHeader('ETag', revisionTag(v.revision));
    return v;
  }
  @Get('task-readiness') readiness(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
  ) {
    return this.tools.readiness(actor, id);
  }
  @Post('exports') @HttpCode(200) async export(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Body(empty) _b: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.tools.exportSnapshot(actor, id);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="team-${id}-export.json"`,
    );
    return v;
  }
}
