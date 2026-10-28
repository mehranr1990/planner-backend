import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import { GoalsService } from '../application/goals.service.js';
import { SpacesService } from '../../spaces/public/index.js';
import { VerifiedSessionGuard } from '../../../platform/auth/session.guard.js';
import { CurrentActor } from '../../../platform/auth/request-actor.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { ZodValidationPipe } from '../../../bootstrap/zod-validation.pipe.js';
import {
  expectedRevision,
  revisionTag,
} from '../../../bootstrap/concurrency.js';
const empty = new ZodValidationPipe(c.EmptyQuerySchema),
  idPipe = new ZodValidationPipe(c.TaskIdSchema),
  page = new ZodValidationPipe(c.CursorQuerySchema);
function required(tag: string | undefined) {
  const r = expectedRevision(tag);
  if (r === undefined) throw new BadRequestException();
  return r;
}
function versioned<T extends { revision: number }>(res: Response, v: T) {
  res.setHeader('ETag', revisionTag(v.revision));
  return v;
}

@Controller('life-areas')
@UseGuards(VerifiedSessionGuard)
export class LifeAreasController {
  constructor(
    @Inject(GoalsService) private readonly service: GoalsService,
    @Inject(SpacesService) private readonly spaces: SpacesService,
  ) {}
  @Post() async create(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(c.LifeAreaCreateSchema)) body: c.LifeAreaCreate,
    @Query(empty) _query: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.createArea(
        await this.spaces.authorizePersonal(actor),
        key,
        body,
      ),
    );
  }
  @Get() async list(
    @CurrentActor() actor: RequestActor,
    @Query(page) q: z.infer<typeof c.CursorQuerySchema>,
  ) {
    return this.service.areas(await this.spaces.authorizePersonal(actor), q);
  }
  @Get(':id') async get(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.area(await this.spaces.authorizePersonal(actor), id),
    );
  }
  @Patch(':id') async patch(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.LifeAreaPatchSchema)) body: c.LifeAreaPatch,
    @Query(empty) _query: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.patchArea(
        await this.spaces.authorizePersonal(actor),
        id,
        required(tag),
        body,
      ),
    );
  }
  @Delete(':id') async archive(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.EmptyQuerySchema.optional())) _body: unknown,
    @Query(empty) _query: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.patchArea(
        await this.spaces.authorizePersonal(actor),
        id,
        required(tag),
        { status: 'ARCHIVED' },
      ),
    );
  }
}
@Controller('goals')
@UseGuards(VerifiedSessionGuard)
export class GoalsController {
  constructor(
    @Inject(GoalsService) private readonly service: GoalsService,
    @Inject(SpacesService) private readonly spaces: SpacesService,
  ) {}
  @Post() async create(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(c.GoalCreateSchema)) body: c.GoalCreate,
    @Query(empty) _query: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.create(
        await this.spaces.authorizePersonal(actor),
        key,
        body,
      ),
    );
  }
  @Get() async list(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(c.GoalListQuerySchema))
    q: z.infer<typeof c.GoalListQuerySchema>,
  ) {
    return this.service.list(await this.spaces.authorizePersonal(actor), q);
  }
  @Get(':id') async get(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.get(await this.spaces.authorizePersonal(actor), id),
    );
  }
  @Patch(':id') async patch(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.GoalPatchSchema)) body: c.GoalPatch,
    @Query(empty) _query: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.patch(
        await this.spaces.authorizePersonal(actor),
        id,
        required(tag),
        body,
      ),
    );
  }

  @Get(':id/milestones') async list_milestones(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(empty) _query: unknown,
  ) {
    return this.service.children(
      await this.spaces.authorizePersonal(actor),
      id,
      'milestones',
    );
  }
  @Post(':id/milestones') async create_milestones(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.GoalMilestoneCreateSchema))
    body: z.infer<typeof c.GoalMilestoneCreateSchema>,
    @Query(empty) _query: unknown,
    @Headers('if-match') tag: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.nested(
        await this.spaces.authorizePersonal(actor),
        id,
        required(tag),
        'milestones',
        null,
        body,
        key,
      ),
    );
  }
  @Patch(':id/milestones/:childId') async patch_milestones(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Param('childId', idPipe) childId: string,
    @Body(new ZodValidationPipe(c.GoalMilestonePatchSchema))
    body: z.infer<typeof c.GoalMilestonePatchSchema>,
    @Query(empty) _query: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.nested(
        await this.spaces.authorizePersonal(actor),
        id,
        required(tag),
        'milestones',
        childId,
        body,
      ),
    );
  }
  @Delete(':id/milestones/:childId') async delete_milestones(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Param('childId', idPipe) childId: string,
    @Body(new ZodValidationPipe(c.EmptyQuerySchema.optional())) _body: unknown,
    @Query(empty) _query: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.remove(
        await this.spaces.authorizePersonal(actor),
        id,
        required(tag),
        'milestones',
        childId,
      ),
    );
  }

  @Get(':id/metrics') async list_metrics(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(empty) _query: unknown,
  ) {
    return this.service.children(
      await this.spaces.authorizePersonal(actor),
      id,
      'metrics',
    );
  }
  @Post(':id/metrics') async create_metrics(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.GoalMetricCreateSchema))
    body: z.infer<typeof c.GoalMetricCreateSchema>,
    @Query(empty) _query: unknown,
    @Headers('if-match') tag: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.nested(
        await this.spaces.authorizePersonal(actor),
        id,
        required(tag),
        'metrics',
        null,
        body,
        key,
      ),
    );
  }
  @Patch(':id/metrics/:childId') async patch_metrics(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Param('childId', idPipe) childId: string,
    @Body(new ZodValidationPipe(c.GoalMetricPatchSchema))
    body: z.infer<typeof c.GoalMetricPatchSchema>,
    @Query(empty) _query: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.nested(
        await this.spaces.authorizePersonal(actor),
        id,
        required(tag),
        'metrics',
        childId,
        body,
      ),
    );
  }
  @Delete(':id/metrics/:childId') async delete_metrics(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Param('childId', idPipe) childId: string,
    @Body(new ZodValidationPipe(c.EmptyQuerySchema.optional())) _body: unknown,
    @Query(empty) _query: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.remove(
        await this.spaces.authorizePersonal(actor),
        id,
        required(tag),
        'metrics',
        childId,
      ),
    );
  }

  @Get(':id/links/tasks') async list_tasks(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(empty) _query: unknown,
  ) {
    return this.service.children(
      await this.spaces.authorizePersonal(actor),
      id,
      'tasks',
    );
  }
  @Post(':id/links/tasks') async create_tasks(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.GoalTaskLinkCreateSchema))
    body: z.infer<typeof c.GoalTaskLinkCreateSchema>,
    @Query(empty) _query: unknown,
    @Headers('if-match') tag: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.nested(
        await this.spaces.authorizePersonal(actor),
        id,
        required(tag),
        'tasks',
        null,
        body,
        key,
      ),
    );
  }
  @Patch(':id/links/tasks/:childId') async patch_tasks(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Param('childId', idPipe) childId: string,
    @Body(new ZodValidationPipe(c.GoalTaskLinkPatchSchema))
    body: z.infer<typeof c.GoalTaskLinkPatchSchema>,
    @Query(empty) _query: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.nested(
        await this.spaces.authorizePersonal(actor),
        id,
        required(tag),
        'tasks',
        childId,
        body,
      ),
    );
  }
  @Delete(':id/links/tasks/:childId') async delete_tasks(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Param('childId', idPipe) childId: string,
    @Body(new ZodValidationPipe(c.EmptyQuerySchema.optional())) _body: unknown,
    @Query(empty) _query: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.remove(
        await this.spaces.authorizePersonal(actor),
        id,
        required(tag),
        'tasks',
        childId,
      ),
    );
  }

  @Get(':id/links/habits') async list_habits(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(empty) _query: unknown,
  ) {
    return this.service.children(
      await this.spaces.authorizePersonal(actor),
      id,
      'habits',
    );
  }
  @Post(':id/links/habits') async create_habits(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.GoalHabitLinkCreateSchema))
    body: z.infer<typeof c.GoalHabitLinkCreateSchema>,
    @Query(empty) _query: unknown,
    @Headers('if-match') tag: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.nested(
        await this.spaces.authorizePersonal(actor),
        id,
        required(tag),
        'habits',
        null,
        body,
        key,
      ),
    );
  }
  @Patch(':id/links/habits/:childId') async patch_habits(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Param('childId', idPipe) childId: string,
    @Body(new ZodValidationPipe(c.GoalHabitLinkPatchSchema))
    body: z.infer<typeof c.GoalHabitLinkPatchSchema>,
    @Query(empty) _query: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.nested(
        await this.spaces.authorizePersonal(actor),
        id,
        required(tag),
        'habits',
        childId,
        body,
      ),
    );
  }
  @Delete(':id/links/habits/:childId') async delete_habits(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Param('childId', idPipe) childId: string,
    @Body(new ZodValidationPipe(c.EmptyQuerySchema.optional())) _body: unknown,
    @Query(empty) _query: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.remove(
        await this.spaces.authorizePersonal(actor),
        id,
        required(tag),
        'habits',
        childId,
      ),
    );
  }

  @Get(':id/progress') async progress(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(empty) _query: unknown,
  ) {
    return this.service.progress(
      await this.spaces.authorizePersonal(actor),
      id,
    );
  }
  @Post(':id/progress') async snapshot(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.GoalSnapshotCreateSchema))
    _body: z.infer<typeof c.GoalSnapshotCreateSchema>,
    @Query(empty) _query: unknown,
    @Headers('if-match') tag: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.snapshot(
        await this.spaces.authorizePersonal(actor),
        id,
        required(tag),
        key,
        null,
      ),
    );
  }
  @Get(':id/reviews') async reviews(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(new ZodValidationPipe(c.GoalReviewQuerySchema))
    q: z.infer<typeof c.GoalReviewQuerySchema>,
  ) {
    return this.service.reviews(
      await this.spaces.authorizePersonal(actor),
      id,
      q,
    );
  }
  @Post(':id/reviews') async review(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.GoalReviewCreateSchema))
    body: z.infer<typeof c.GoalReviewCreateSchema>,
    @Query(empty) _query: unknown,
    @Headers('if-match') tag: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.snapshot(
        await this.spaces.authorizePersonal(actor),
        id,
        required(tag),
        key,
        body.reflection,
      ),
    );
  }
}
