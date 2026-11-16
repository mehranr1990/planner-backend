import { TeamFilesService } from '../application/team-files.service.js';
import { TeamAssociationsService } from '../application/team-associations.service.js';
import { TeamSourceViewsService } from '../application/team-source-views.service.js';
import { TeamSprintReportsService } from '../application/team-sprint-reports.service.js';
import {
  Controller,
  Get,
  Put,
  Post,
  Patch,
  Inject,
  Param,
  Query,
  Body,
  Headers,
  Res,
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
import { TeamGuard } from './teams.controller.js';
import { TeamGapService } from '../application/team-gap.service.js';
import { TeamMeetingsService } from '../application/team-meetings.service.js';
import { TeamOperationsService } from '../application/team-operations.service.js';
import { TeamsService } from '../application/teams.service.js';

const uuid = new ZodValidationPipe(c.TeamCreateSchema.shape.id),
  empty = new ZodValidationPipe(c.CollaborationEmptySchema);
function rev(raw: string | undefined) {
  const n = expectedRevision(raw);
  if (n === undefined) throw new BadRequestException();
  return n;
}
function tagged<T extends { revision: number }>(res: Response, v: T) {
  res.setHeader('ETag', revisionTag(v.revision));
  return v;
}
@Controller('teams/:id')
@UseGuards(VerifiedSessionGuard, TeamGuard)
export class TeamGapController {
  constructor(
    @Inject(TeamFilesService) private readonly files: TeamFilesService,
    @Inject(TeamAssociationsService)
    private readonly associations: TeamAssociationsService,
    @Inject(TeamSourceViewsService)
    private readonly sources: TeamSourceViewsService,
    @Inject(TeamSprintReportsService)
    private readonly sprints: TeamSprintReportsService,
    @Inject(TeamGapService) private readonly gaps: TeamGapService,
    @Inject(TeamMeetingsService) private readonly meetings: TeamMeetingsService,
    @Inject(TeamOperationsService) private readonly ops: TeamOperationsService,
    @Inject(TeamsService) private readonly teams: TeamsService,
  ) {}
  @Get('projects/:projectId/association-history') associationHistory(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('projectId', uuid) projectId: string,
    @Query(new ZodValidationPipe(c.ProjectPageQuerySchema))
    q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    return this.associations.history(actor, id, projectId, q);
  }
  @Get('project-association-requests') pendingAssociations(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(c.ProjectPageQuerySchema))
    q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    return this.associations.pending(actor, id, q);
  }
  @Get('projects/:projectId/association-request') async association(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('projectId', uuid) projectId: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      c.TeamAssociationSchema.parse(
        await this.associations.command(actor, id, projectId, undefined),
      ),
    );
  }
  @Post('projects/:projectId/association-requests') async requestAssociation(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('projectId', uuid) projectId: string,
    @Headers('if-match') match: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.TeamAssociationInputSchema))
    body: z.infer<typeof c.TeamAssociationInputSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      c.TeamAssociationSchema.parse(
        await this.associations.command(
          actor,
          id,
          projectId,
          rev(match),
          body,
          key,
        ),
      ),
    );
  }
  @Post('projects/:projectId/association-request/decision')
  @HttpCode(200)
  async decideAssociation(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('projectId', uuid) projectId: string,
    @Headers('if-match') match: string | undefined,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.TeamAssociationDecisionSchema))
    body: z.infer<typeof c.TeamAssociationDecisionSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      c.TeamAssociationSchema.parse(
        await this.associations.command(actor, id, projectId, rev(match), body),
      ),
    );
  }
  @Get('visible-tasks') visibleTasks(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(c.TeamSourceQuerySchema))
    q: z.infer<typeof c.TeamSourceQuerySchema>,
  ) {
    return this.sources.sources(actor, id, q, 'TASK');
  }
  @Get('calendar/occupancy') occupancy(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(c.TeamSourceCalendarQuerySchema))
    q: z.infer<typeof c.TeamSourceCalendarQuerySchema>,
  ) {
    return this.sources.sources(actor, id, q, 'OCCUPANCY');
  }
  @Get('calendar/sources') sourceCalendar(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(c.TeamSourceCalendarQuerySchema))
    q: z.infer<typeof c.TeamSourceCalendarQuerySchema>,
  ) {
    return this.sources.sources(actor, id, q, 'CALENDAR');
  }
  @Get('cross-team-workload') crossWorkload(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(c.TeamCrossWorkloadQuerySchema))
    q: z.infer<typeof c.TeamCrossWorkloadQuerySchema>,
  ) {
    return this.teams
      .read(actor, id)
      .then(() => this.sources.crossWorkload(actor, q));
  }
  @Get('files/config') fileConfiguration(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
  ) {
    return this.files.configuration(actor, id);
  }
  @Post('assignments/:assignmentId/revert') @HttpCode(200) revert(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('assignmentId', uuid) assignmentId: string,
    @Headers('if-match') match: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.TeamAssignmentRevertSchema))
    body: z.infer<typeof c.TeamAssignmentRevertSchema>,
  ) {
    return this.ops.revert(actor, id, assignmentId, rev(match), body, key);
  }
  @Get('sent-invitations') async sent(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(c.TeamSentInvitationQuerySchema))
    q: z.infer<typeof c.TeamSentInvitationQuerySchema>,
  ) {
    await this.teams.hint(id);
    return this.teams.collaboration.projectSent(actor, id, q, 'TEAM');
  }
  @Post('invitations/:offerId/resend') @HttpCode(200) async resend(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('offerId', uuid) offerId: string,
    @Headers('if-match') match: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Query(empty) _q: unknown,
    @Body(empty) _body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.teams.hint(id);
    return tagged(
      res,
      await this.teams.collaboration.resendProjectInvitation(
        actor,
        id,
        offerId,
        rev(match),
        key,
        'TEAM',
      ),
    );
  }
  @Get('memberships/:accessId/weekly-capacity') async weekly(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('accessId', uuid) accessId: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(res, await this.gaps.weekly(actor, id, accessId));
  }
  @Put('memberships/:accessId/weekly-capacity') async setWeekly(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('accessId', uuid) accessId: string,
    @Headers('if-match') match: string | undefined,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.TeamWeeklyCapacityInputSchema))
    body: z.infer<typeof c.TeamWeeklyCapacityInputSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      await this.gaps.setWeekly(actor, id, accessId, rev(match), body),
    );
  }
  @Get('availability') availability(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(c.TeamCapacitySummaryQuerySchema))
    q: z.infer<typeof c.TeamCapacitySummaryQuerySchema>,
  ) {
    return this.gaps.availability(actor, id, q);
  }
  @Get('forecast') forecast(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(c.TeamCapacitySummaryQuerySchema))
    q: z.infer<typeof c.TeamCapacitySummaryQuerySchema>,
  ) {
    return this.gaps.availability(actor, id, q, true);
  }
  @Get('meetings/:meetingId/rsvp-summary') rsvp(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('meetingId', uuid) meetingId: string,
    @Query(new ZodValidationPipe(c.TeamRsvpQuerySchema))
    q: z.infer<typeof c.TeamRsvpQuerySchema>,
  ) {
    return this.meetings.summary(actor, id, meetingId, q);
  }
  @Patch('time-off/:timeOffId') async editTimeOff(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('timeOffId', uuid) timeOffId: string,
    @Headers('if-match') match: string | undefined,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.TeamTimeOffCreateSchema))
    body: z.infer<typeof c.TeamTimeOffCreateSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      await this.ops.editTimeOff(actor, id, timeOffId, rev(match), body),
    );
  }
  @Get('plans/:planId/point-capacity') async sprintCapacity(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('planId', uuid) planId: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(res, await this.gaps.sprintCapacity(actor, id, planId));
  }
  @Put('plans/:planId/point-capacity') async setSprintCapacity(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('planId', uuid) planId: string,
    @Headers('if-match') match: string | undefined,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.TeamSprintCapacityInputSchema))
    body: z.infer<typeof c.TeamSprintCapacityInputSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      await this.gaps.setSprintCapacity(actor, id, planId, rev(match), body),
    );
  }
  @Get('plans/:planId/burndown') burndown(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('planId', uuid) planId: string,
    @Query(empty) _q: unknown,
  ) {
    return this.sprints.burndown(actor, id, planId);
  }
  @Get('plans/:planId/history') history(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('planId', uuid) planId: string,
    @Query(new ZodValidationPipe(c.ProjectPageQuerySchema))
    q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    return this.sprints.history(actor, id, planId, q);
  }
  @Get('sprint-velocity') velocity(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(c.TeamVelocityQuerySchema))
    q: z.infer<typeof c.TeamVelocityQuerySchema>,
  ) {
    return this.sprints.velocity(actor, id, q);
  }
  @Get('recorded-activity') activity(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(c.TeamHistoryQuerySchema))
    q: z.infer<typeof c.TeamHistoryQuerySchema>,
  ) {
    return this.gaps.activity(actor, id, q);
  }
}
