import {
  Controller,
  Get,
  Post,
  Put,
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
import { TeamCollaborationService } from '../application/team-collaboration.service.js';
import { TeamPlanningService } from '../application/team-planning.service.js';
const uuid = new ZodValidationPipe(c.TeamCreateSchema.shape.id),
  week = new ZodValidationPipe(c.PlanningDateSchema),
  empty = new ZodValidationPipe(c.CollaborationEmptySchema),
  page = new ZodValidationPipe(c.ProjectPageQuerySchema);
type Page = z.infer<typeof c.ProjectPageQuerySchema>;
function rev(match: string | undefined) {
  const result = expectedRevision(match);
  if (result === undefined) throw new BadRequestException();
  return result;
}
function tagged<T>(res: Response, value: T, revision: number) {
  res.setHeader('ETag', revisionTag(revision));
  return value;
}
@Controller('teams/:id')
@UseGuards(VerifiedSessionGuard, TeamGuard)
export class TeamCompletionController {
  constructor(
    @Inject(TeamCollaborationService)
    private readonly collaboration: TeamCollaborationService,
    @Inject(TeamPlanningService)
    private readonly planning: TeamPlanningService,
  ) {}
  @Get('settings') async settings(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.collaboration.settings(actor, id);
    return tagged(res, v, v.revision);
  }
  @Patch('settings') async patchSettings(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(new ZodValidationPipe(c.TeamSettingsPatchSchema))
    body: z.infer<typeof c.TeamSettingsPatchSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.collaboration.patchSettings(
      actor,
      id,
      rev(match),
      body,
    );
    return tagged(res, v, v.revision);
  }
  @Get('presence') presence(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(page) q: Page,
  ) {
    return this.collaboration.presence(actor, id, q);
  }
  @Get('presence/me') async myPresence(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.collaboration.myPresence(actor, id);
    return tagged(res, v, v.revision);
  }
  @Put('presence/me') async setPresence(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(new ZodValidationPipe(c.TeamPresenceInputSchema))
    body: z.infer<typeof c.TeamPresenceInputSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.collaboration.setPresence(actor, id, rev(match), body);
    return tagged(res, v, v.revision);
  }
  @Get('checkins/:period') checkinWeek(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('period', week) w: string,
    @Query(empty) _q: unknown,
  ) {
    return this.collaboration.checkinWeek(actor, id, w);
  }
  @Put('checkins/:period/reply') async reply(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('period', week) w: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(new ZodValidationPipe(c.TeamCheckinReplyInputSchema))
    body: z.infer<typeof c.TeamCheckinReplyInputSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.collaboration.reply(actor, id, w, rev(match), body);
    return tagged(res, v, v.revision);
  }
  @Post('checkins/:period/replies/:replyId/comments') comment(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('period', week) w: string,
    @Param('replyId', uuid) replyId: string,
    @Query(empty) _q: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(c.TeamCheckinCommentInputSchema))
    body: z.infer<typeof c.TeamCheckinCommentInputSchema>,
  ) {
    return this.collaboration.comment(actor, id, w, replyId, body, key);
  }
  @Get('thanks') thanks(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(page) q: Page,
  ) {
    return this.collaboration.thanks(actor, id, q);
  }
  @Post('thanks') give(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(c.TeamThanksCreateSchema))
    body: z.infer<typeof c.TeamThanksCreateSchema>,
  ) {
    return this.collaboration.give(actor, id, body, key);
  }
  @Put('thanks/:thanksId/hidden') hide(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('thanksId', uuid) thanksId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.TeamThanksHiddenInputSchema))
    body: z.infer<typeof c.TeamThanksHiddenInputSchema>,
  ) {
    return this.collaboration.hide(actor, id, thanksId, body.hidden);
  }
  @Post('thanks/:thanksId/remove') remove(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('thanksId', uuid) thanksId: string,
    @Query(empty) _q: unknown,
    @Body(empty) _body: unknown,
  ) {
    return this.collaboration.remove(actor, id, thanksId);
  }
  @Get('feedback') feedback(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
  ) {
    return this.collaboration.feedback(actor, id);
  }
  @Post('feedback/requests') requestFeedback(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(c.TeamFeedbackRequestCreateSchema))
    body: z.infer<typeof c.TeamFeedbackRequestCreateSchema>,
  ) {
    return this.collaboration.requestFeedback(actor, id, body, key);
  }
  @Post('feedback/notes') writeFeedback(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(c.TeamFeedbackNoteCreateSchema))
    body: z.infer<typeof c.TeamFeedbackNoteCreateSchema>,
  ) {
    return this.collaboration.writeFeedback(actor, id, body, key);
  }
  @Get('activity') activity(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(c.TeamActivityQuerySchema))
    q: z.infer<typeof c.TeamActivityQuerySchema>,
  ) {
    return this.collaboration.activity(actor, id, q.limit);
  }
  @Get('task-planning') taskPlanning(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(page) q: Page,
  ) {
    return this.planning.taskPlanning(actor, id, q);
  }
  @Put('tasks/:sourceId/board-state') async boardState(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('sourceId', uuid) sourceId: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(new ZodValidationPipe(c.TeamBoardStateInputSchema))
    body: z.infer<typeof c.TeamBoardStateInputSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.planning.setBoardState(
      actor,
      id,
      sourceId,
      rev(match),
      body,
    );
    return tagged(res, v, v.task.revision);
  }
  @Put('tasks/:sourceId/estimate') async estimate(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('sourceId', uuid) sourceId: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(new ZodValidationPipe(c.TeamTaskEstimateInputSchema))
    body: z.infer<typeof c.TeamTaskEstimateInputSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.planning.setEstimate(
      actor,
      id,
      sourceId,
      rev(match),
      body,
    );
    return tagged(res, v, v.task.revision);
  }
  @Get('plans/:planId/summary') async summary(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('planId', uuid) planId: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.planning.summary(actor, id, planId);
    return tagged(res, v, v.revision);
  }
  @Put('plans/:planId/planning') async setPlanning(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('planId', uuid) planId: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(new ZodValidationPipe(c.TeamPlanPlanningInputSchema))
    body: z.infer<typeof c.TeamPlanPlanningInputSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.planning.setPlanning(
      actor,
      id,
      planId,
      rev(match),
      body,
    );
    return tagged(res, v, v.revision);
  }
  @Post('plans/:planId/items/:itemId/carry-over') async carryOver(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('planId', uuid) planId: string,
    @Param('itemId', uuid) itemId: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(new ZodValidationPipe(c.TeamCarryOverInputSchema))
    body: z.infer<typeof c.TeamCarryOverInputSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.planning.carryOver(
      actor,
      id,
      planId,
      itemId,
      rev(match),
      body,
    );
    return tagged(res, v, v.revision);
  }
  @Put('backlog/order') backlogOrder(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.TeamBacklogOrderInputSchema))
    body: z.infer<typeof c.TeamBacklogOrderInputSchema>,
  ) {
    return this.planning.backlogOrder(actor, id, body);
  }
}
