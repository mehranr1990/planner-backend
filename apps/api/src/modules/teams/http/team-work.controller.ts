import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
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
import { TeamWorkService } from '../application/team-work.service.js';
const uuid = new ZodValidationPipe(c.TeamCreateSchema.shape.id),
  empty = new ZodValidationPipe(c.CollaborationEmptySchema),
  noBody = new ZodValidationPipe(c.CollaborationEmptySchema.optional());
function revision(raw: string | undefined) {
  const value = expectedRevision(raw);
  if (value === undefined) throw new BadRequestException();
  return value;
}
function requiredKey(key: string | undefined) {
  if (!key || !/^[!-~]{1,128}$/.test(key)) throw new BadRequestException();
  return key;
}
function send<T>(res: Response, value: T) {
  if (
    value &&
    typeof value === 'object' &&
    'revision' in value &&
    typeof value.revision === 'number'
  )
    res.setHeader('ETag', revisionTag(value.revision));
  else if (
    value &&
    typeof value === 'object' &&
    'event' in value &&
    value.event &&
    typeof value.event === 'object' &&
    'revision' in value.event &&
    typeof value.event.revision === 'number'
  )
    res.setHeader('ETag', revisionTag(value.event.revision));
  return value;
}
@Controller('teams/:id')
@UseGuards(VerifiedSessionGuard, TeamGuard)
export class TeamWorkController {
  constructor(
    @Inject(TeamWorkService) private readonly service: TeamWorkService,
  ) {}
  @Get('tasks') async operation0(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) teamId: string,
    @Query(new ZodValidationPipe(c.ProjectPageQuerySchema))
    query: z.infer<typeof c.ProjectPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(
      res,
      c.SharedTaskPageSchema.parse(
        await this.service.sourceList(actor, teamId, 'TASK', query),
      ),
    );
  }
  @Post('tasks') async operation1(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) teamId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.ProjectTaskCreateSchema))
    body: z.infer<typeof c.ProjectTaskCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(
      res,
      c.SharedTaskSchema.parse(
        await this.service.createTask(actor, teamId, body, key),
      ),
    );
  }
  @Get('tasks/:sourceId') async operation2(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) teamId: string,
    @Param('sourceId', uuid) sourceId: string,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(
      res,
      c.SharedTaskSchema.parse(
        await this.service.sourceRead(actor, teamId, 'TASK', sourceId),
      ),
    );
  }
  @Patch('tasks/:sourceId') async operation3(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) teamId: string,
    @Param('sourceId', uuid) sourceId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.ProjectTaskPatchSchema))
    body: z.infer<typeof c.ProjectTaskPatchSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(
      res,
      c.SharedTaskSchema.parse(
        await this.service.patchTask(
          actor,
          teamId,
          sourceId,
          revision(match),
          body,
          key,
        ),
      ),
    );
  }
  @Get('tasks/:sourceId/schedule') async operation4(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) teamId: string,
    @Param('sourceId', uuid) sourceId: string,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(
      res,
      c.SharedTaskScheduleSchema.parse(
        await this.service.schedule(actor, teamId, sourceId),
      ),
    );
  }
  @Put('tasks/:sourceId/schedule') async operation5(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) teamId: string,
    @Param('sourceId', uuid) sourceId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.SharedTaskScheduleInputSchema))
    body: z.infer<typeof c.SharedTaskScheduleInputSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(
      res,
      c.SharedTaskScheduleSchema.parse(
        await this.service.schedule(actor, teamId, sourceId, {
          revision: revision(match),
          value: body,
        }),
      ),
    );
  }
  @Get('goals') async operation6(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) teamId: string,
    @Query(new ZodValidationPipe(c.ProjectPageQuerySchema))
    query: z.infer<typeof c.ProjectPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(
      res,
      c.SharedGoalPageSchema.parse(
        await this.service.sourceList(actor, teamId, 'GOAL', query),
      ),
    );
  }
  @Post('goals') async operation7(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) teamId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.ProjectGoalCreateSchema))
    body: z.infer<typeof c.ProjectGoalCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(
      res,
      c.SharedGoalSchema.parse(
        await this.service.createGoal(actor, teamId, body, key),
      ),
    );
  }
  @Get('goals/:sourceId') async operation8(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) teamId: string,
    @Param('sourceId', uuid) sourceId: string,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(
      res,
      c.SharedGoalSchema.parse(
        await this.service.sourceRead(actor, teamId, 'GOAL', sourceId),
      ),
    );
  }
  @Patch('goals/:sourceId') async operation9(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) teamId: string,
    @Param('sourceId', uuid) sourceId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.ProjectGoalPatchSchema))
    body: z.infer<typeof c.ProjectGoalPatchSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(
      res,
      c.SharedGoalSchema.parse(
        await this.service.patchGoal(
          actor,
          teamId,
          sourceId,
          revision(match),
          body,
          key,
        ),
      ),
    );
  }
  @Put('goals/:goalId/tasks/:taskId') async operation10(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) teamId: string,
    @Param('goalId', uuid) goalId: string,
    @Param('taskId', uuid) taskId: string,
    @Query(empty) _query: unknown,
    @Body(noBody) _body: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(
      res,
      c.SharedGoalSchema.parse(
        await this.service.linkGoalTask(
          actor,
          teamId,
          goalId,
          taskId,
          revision(match),
        ),
      ),
    );
  }
  @Get('calendar/events') async operation11(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) teamId: string,
    @Query(new ZodValidationPipe(c.TeamCalendarQuerySchema))
    query: z.infer<typeof c.TeamCalendarQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(
      res,
      c.TeamCalendarPageSchema.parse(
        await this.service.calendarCommand(actor, teamId, {
          kind: 'LIST',
          query: {
            limit: String(query.limit),
            ...(query.cursor ? { cursor: query.cursor } : {}),
          },
        }),
      ),
    );
  }
  @Post('calendar/events') async operation12(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) teamId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CalendarEventCreateSchema))
    body: z.infer<typeof c.CalendarEventCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(
      res,
      c.TeamCalendarEventSchema.parse(
        await this.service.calendarCommand(
          actor,
          teamId,
          { kind: 'CREATE', key: requiredKey(key), input: body },
          key,
        ),
      ),
    );
  }
  @Get('calendar/events/:eventId') async operation13(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) teamId: string,
    @Param('eventId', uuid) eventId: string,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(
      res,
      c.TeamCalendarEventSchema.parse(
        await this.service.calendarCommand(actor, teamId, {
          kind: 'READ',
          id: eventId,
        }),
      ),
    );
  }
  @Patch('calendar/events/:eventId') async operation14(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) teamId: string,
    @Param('eventId', uuid) eventId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CalendarEventPatchSchema))
    body: z.infer<typeof c.CalendarEventPatchSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(
      res,
      c.TeamCalendarEventSchema.parse(
        await this.service.calendarCommand(actor, teamId, {
          kind: 'PATCH',
          id: eventId,
          revision: revision(match),
          input: body,
        }),
      ),
    );
  }
  @Delete('calendar/events/:eventId') async operation15(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) teamId: string,
    @Param('eventId', uuid) eventId: string,
    @Query(empty) _query: unknown,
    @Body(noBody) _body: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(
      res,
      c.TeamWorkRemovedSchema.parse(
        await this.service.calendarCommand(actor, teamId, {
          kind: 'DELETE',
          id: eventId,
          revision: revision(match),
        }),
      ),
    );
  }
  @Post('calendar/events/:eventId/series') async operation16(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) teamId: string,
    @Param('eventId', uuid) eventId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.CalendarSeriesEditSchema))
    body: z.infer<typeof c.CalendarSeriesEditSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(
      res,
      c.TeamCalendarSeriesResultSchema.parse(
        await this.service.calendarCommand(
          actor,
          teamId,
          {
            kind: 'SERIES',
            id: eventId,
            revision: revision(match),
            key: requiredKey(key),
            input: body,
          },
          key,
        ),
      ),
    );
  }
  @Get('calendar') async operation17(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) teamId: string,
    @Query(new ZodValidationPipe(c.TeamCalendarRangeQuerySchema))
    query: z.infer<typeof c.TeamCalendarRangeQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(
      res,
      c.CalendarViewSchema.parse(
        await this.service.calendarCommand(actor, teamId, {
          kind: 'VIEW',
          query,
        }),
      ),
    );
  }
  @Get('plans') async operation18(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) teamId: string,
    @Query(new ZodValidationPipe(c.ProjectPageQuerySchema))
    query: z.infer<typeof c.ProjectPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(
      res,
      c.TeamPlanPageSchema.parse(
        await this.service.plans(actor, teamId, query),
      ),
    );
  }
  @Post('plans') async operation19(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) teamId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.TeamPlanCreateSchema))
    body: z.infer<typeof c.TeamPlanCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(
      res,
      c.TeamPlanSchema.parse(
        await this.service.createPlan(actor, teamId, body, key),
      ),
    );
  }
  @Get('plans/:planId') async operation20(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) teamId: string,
    @Param('planId', uuid) planId: string,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(
      res,
      c.TeamPlanSchema.parse(
        await this.service.readPlan(actor, teamId, planId),
      ),
    );
  }
  @Patch('plans/:planId') async operation21(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) teamId: string,
    @Param('planId', uuid) planId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.TeamPlanPatchSchema))
    body: z.infer<typeof c.TeamPlanPatchSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(
      res,
      c.TeamPlanSchema.parse(
        await this.service.patchPlan(
          actor,
          teamId,
          planId,
          revision(match),
          body,
        ),
      ),
    );
  }
  @Put('plans/:planId/review') async operation22(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) teamId: string,
    @Param('planId', uuid) planId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.TeamReviewInputSchema))
    body: z.infer<typeof c.TeamReviewInputSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(
      res,
      c.TeamPlanSchema.parse(
        await this.service.review(actor, teamId, planId, revision(match), body),
      ),
    );
  }
  @Get('work-items') async operation23(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) teamId: string,
    @Query(new ZodValidationPipe(c.TeamWorkPageQuerySchema))
    query: z.infer<typeof c.TeamWorkPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(
      res,
      c.TeamWorkItemPageSchema.parse(
        await this.service.items(actor, teamId, query),
      ),
    );
  }
  @Post('work-items') async operation24(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) teamId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.TeamWorkItemCreateSchema))
    body: z.infer<typeof c.TeamWorkItemCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(
      res,
      c.TeamWorkItemSchema.parse(
        await this.service.createItem(actor, teamId, body, key),
      ),
    );
  }
  @Patch('work-items/:itemId') async operation25(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) teamId: string,
    @Param('itemId', uuid) itemId: string,
    @Query(empty) _query: unknown,
    @Body(new ZodValidationPipe(c.TeamWorkItemPatchSchema))
    body: z.infer<typeof c.TeamWorkItemPatchSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(
      res,
      c.TeamWorkItemSchema.parse(
        await this.service.patchItem(
          actor,
          teamId,
          itemId,
          revision(match),
          body,
          await this.service.itemHint(actor, teamId, itemId),
        ),
      ),
    );
  }
  @Delete('work-items/:itemId') async operation26(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) teamId: string,
    @Param('itemId', uuid) itemId: string,
    @Query(empty) _query: unknown,
    @Body(noBody) _body: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(
      res,
      c.TeamWorkRemovedSchema.parse(
        await this.service.removeItem(actor, teamId, itemId, revision(match)),
      ),
    );
  }
}
