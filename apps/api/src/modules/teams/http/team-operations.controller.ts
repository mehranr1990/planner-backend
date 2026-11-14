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
import { TeamOperationsService } from '../application/team-operations.service.js';
import { TeamInsightsService } from '../application/team-insights.service.js';
const uuid = new ZodValidationPipe(c.TeamCreateSchema.shape.id),
  period = new ZodValidationPipe(c.PlanningDateSchema),
  empty = new ZodValidationPipe(c.BackendCompletionEmptySchema),
  page = new ZodValidationPipe(c.ProjectPageQuerySchema),
  body = <T extends z.ZodType>(schema: T) => new ZodValidationPipe(schema);
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
/** Owner-approved Team completion (TA, SP, CA, TO, GL, MB, RM, PH, PM, AN). */
@Controller('teams/:id')
@UseGuards(VerifiedSessionGuard, TeamGuard)
export class TeamOperationsController {
  constructor(
    @Inject(TeamOperationsService) private readonly ops: TeamOperationsService,
    @Inject(TeamInsightsService) private readonly insights: TeamInsightsService,
  ) {}
  // Assignments
  @Get('assignments') assignments(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(body(c.TeamAssignmentQuerySchema))
    q: z.infer<typeof c.TeamAssignmentQuerySchema>,
  ) {
    return this.ops.assignments(actor, id, q);
  }
  @Post('tasks/:sourceId/assignments') async assign(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('sourceId', uuid) sourceId: string,
    @Query(empty) _q: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Body(body(c.TeamAssignmentCreateSchema))
    input: z.infer<typeof c.TeamAssignmentCreateSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.ops.assign(actor, id, sourceId, input, key);
    return tagged(res, v, v.revision);
  }
  @Post('assignments/:assignmentId/accept') @HttpCode(200) async accept(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('assignmentId', uuid) assignmentId: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(empty) _b: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.ops.respond(
      actor,
      id,
      assignmentId,
      rev(match),
      'accept',
    );
    return tagged(res, v, v.revision);
  }
  @Post('assignments/:assignmentId/decline') @HttpCode(200) async decline(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('assignmentId', uuid) assignmentId: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(body(c.TeamAssignmentDeclineSchema))
    input: z.infer<typeof c.TeamAssignmentDeclineSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.ops.respond(
      actor,
      id,
      assignmentId,
      rev(match),
      'decline',
      input,
    );
    return tagged(res, v, v.revision);
  }
  @Post('assignments/:assignmentId/remove') @HttpCode(200) async remove(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('assignmentId', uuid) assignmentId: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(empty) _b: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.ops.respond(
      actor,
      id,
      assignmentId,
      rev(match),
      'remove',
    );
    return tagged(res, v, v.revision);
  }
  @Post('assignments/:assignmentId/reassign') @HttpCode(200) reassign(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('assignmentId', uuid) assignmentId: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(body(c.TeamAssignmentReassignSchema))
    input: z.infer<typeof c.TeamAssignmentReassignSchema>,
  ) {
    return this.ops.reassign(actor, id, assignmentId, rev(match), input);
  }
  @Post('assignments/:assignmentId/remind') @HttpCode(200) remind(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('assignmentId', uuid) assignmentId: string,
    @Query(empty) _q: unknown,
    @Body(empty) _b: unknown,
  ) {
    return this.ops.remind(actor, id, assignmentId);
  }
  @Get('assignments/:assignmentId/history') assignmentHistory(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('assignmentId', uuid) assignmentId: string,
    @Query(page) q: Page,
  ) {
    return this.ops.assignmentHistory(actor, id, assignmentId, q);
  }
  @Get('my-work') myWork(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
  ) {
    return this.ops.myWork(actor, id);
  }
  @Get('now-working-on') nowWorking(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
  ) {
    return this.ops.nowWorking(actor, id);
  }
  @Get('memberships/:accessId/removal-preview') removalPreview(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('accessId', uuid) accessId: string,
    @Query(empty) _q: unknown,
  ) {
    return this.ops.removalPreview(actor, id, accessId);
  }
  // Story points
  @Get('task-points') points(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(page) q: Page,
  ) {
    return this.ops.points(actor, id, q);
  }
  @Put('tasks/:sourceId/points') async setPoints(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('sourceId', uuid) sourceId: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(body(c.TeamTaskPointsInputSchema))
    input: z.infer<typeof c.TeamTaskPointsInputSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.ops.setPoints(actor, id, sourceId, rev(match), input);
    return tagged(res, v, v.revision);
  }
  @Get('plans/:planId/points') planPoints(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('planId', uuid) planId: string,
    @Query(empty) _q: unknown,
  ) {
    return this.ops.planPoints(actor, id, planId);
  }
  // Capacity and time off
  @Get('capacity/summary') capacitySummary(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(body(c.TeamCapacitySummaryQuerySchema))
    q: z.infer<typeof c.TeamCapacitySummaryQuerySchema>,
  ) {
    return this.insights.capacitySummary(actor, id, q);
  }
  @Get('time-off') timeOff(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(body(c.TeamTimeOffQuerySchema))
    q: z.infer<typeof c.TeamTimeOffQuerySchema>,
  ) {
    return this.ops.timeOff(actor, id, q);
  }
  @Post('time-off') async requestTimeOff(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Body(body(c.TeamTimeOffCreateSchema))
    input: z.infer<typeof c.TeamTimeOffCreateSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.ops.requestTimeOff(actor, id, input, key);
    return tagged(res, v, v.revision);
  }
  @Post('time-off/:timeOffId/decision') @HttpCode(200) async decideTimeOff(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('timeOffId', uuid) timeOffId: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(body(c.TeamTimeOffDecisionSchema))
    input: z.infer<typeof c.TeamTimeOffDecisionSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.ops.decideTimeOff(
      actor,
      id,
      timeOffId,
      rev(match),
      input,
    );
    return tagged(res, v, v.revision);
  }
  @Post('time-off/:timeOffId/cancel') @HttpCode(200) async cancelTimeOff(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('timeOffId', uuid) timeOffId: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(empty) _b: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.ops.cancelTimeOff(actor, id, timeOffId, rev(match));
    return tagged(res, v, v.revision);
  }
  @Get('time-off/:timeOffId/history') timeOffHistory(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('timeOffId', uuid) timeOffId: string,
    @Query(page) q: Page,
  ) {
    return this.ops.timeOffHistory(actor, id, timeOffId, q);
  }
  // Goal periods and key results
  @Put('goals/:goalId/period') async setGoalPeriod(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('goalId', uuid) goalId: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(body(c.TeamGoalPeriodInputSchema))
    input: z.infer<typeof c.TeamGoalPeriodInputSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.ops.setGoalPeriod(
      actor,
      id,
      goalId,
      rev(match),
      input,
    );
    return tagged(res, v, v.revision);
  }
  @Get('goals/:goalId/key-results') keyResults(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('goalId', uuid) goalId: string,
    @Query(empty) _q: unknown,
  ) {
    return this.ops.keyResults(actor, id, goalId);
  }
  @Post('goals/:goalId/key-results') async createKeyResult(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('goalId', uuid) goalId: string,
    @Query(empty) _q: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Body(body(c.TeamKeyResultCreateSchema))
    input: z.infer<typeof c.TeamKeyResultCreateSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.ops.createKeyResult(actor, id, goalId, input, key);
    return tagged(res, v, v.revision);
  }
  @Patch('goals/:goalId/key-results/:keyResultId') async patchKeyResult(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('goalId', uuid) goalId: string,
    @Param('keyResultId', uuid) keyResultId: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(body(c.TeamKeyResultPatchSchema))
    input: z.infer<typeof c.TeamKeyResultPatchSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.ops.patchKeyResult(
      actor,
      id,
      goalId,
      keyResultId,
      rev(match),
      input,
    );
    return tagged(res, v, v.revision);
  }
  @Get('goals/:goalId/key-results/:keyResultId/checkins') keyResultCheckins(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('goalId', uuid) goalId: string,
    @Param('keyResultId', uuid) keyResultId: string,
    @Query(page) q: Page,
  ) {
    return this.ops.keyResultCheckins(actor, id, goalId, keyResultId, q);
  }
  @Post('goals/:goalId/key-results/:keyResultId/checkins') recordKeyResult(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('goalId', uuid) goalId: string,
    @Param('keyResultId', uuid) keyResultId: string,
    @Query(empty) _q: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Body(body(c.TeamKeyResultCheckinCreateSchema))
    input: z.infer<typeof c.TeamKeyResultCheckinCreateSchema>,
  ) {
    return this.ops.recordKeyResult(actor, id, goalId, keyResultId, input, key);
  }
  // Member profiles
  @Get('member-profiles') memberProfiles(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(page) q: Page,
  ) {
    return this.ops.memberProfiles(actor, id, q);
  }
  @Put('member-profiles/:accessId') async setMemberProfile(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('accessId', uuid) accessId: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(body(c.TeamMemberProfileInputSchema))
    input: z.infer<typeof c.TeamMemberProfileInputSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.ops.setMemberProfile(
      actor,
      id,
      accessId,
      rev(match),
      input,
    );
    return tagged(res, v, v.revision);
  }
  // Notifications and reminders
  @Get('notifications') notifications(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(page) q: Page,
  ) {
    return this.ops.notifications(actor, id, q);
  }
  @Post('notifications/:notificationId/read') @HttpCode(200) readNotification(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('notificationId', uuid) notificationId: string,
    @Query(empty) _q: unknown,
    @Body(empty) _b: unknown,
  ) {
    return this.ops.readNotification(actor, id, notificationId);
  }
  @Get('reminder-settings') async reminderSettings(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.ops.reminderSettings(actor, id);
    return tagged(res, v, v.revision);
  }
  @Put('reminder-settings') async setReminderSettings(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(body(c.TeamReminderSettingsInputSchema))
    input: z.infer<typeof c.TeamReminderSettingsInputSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.ops.setReminderSettings(actor, id, rev(match), input);
    return tagged(res, v, v.revision);
  }
  @Post('checkins/:period/remind') @HttpCode(200) remindCheckin(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('period', period) p: string,
    @Query(empty) _q: unknown,
    @Body(empty) _b: unknown,
  ) {
    return this.ops.remindCheckin(actor, id, p);
  }
  // Project health, identity mapping and analytics
  @Get('project-summaries') projectSummaries(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(page) q: Page,
  ) {
    return this.insights.projectSummaries(actor, id, q);
  }
  @Get('analytics/cycle-time') cycleTime(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(body(c.TeamAnalyticsWindowQuerySchema))
    q: z.infer<typeof c.TeamAnalyticsWindowQuerySchema>,
  ) {
    return this.insights.cycleTime(actor, id, q);
  }
  @Get('analytics/estimate-accuracy') estimateAccuracy(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(body(c.TeamAnalyticsWindowQuerySchema))
    q: z.infer<typeof c.TeamAnalyticsWindowQuerySchema>,
  ) {
    return this.insights.estimateAccuracy(actor, id, q);
  }
}
