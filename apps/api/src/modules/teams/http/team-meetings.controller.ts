import {
  Controller,
  Get,
  Post,
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
import { TeamMeetingsService } from '../application/team-meetings.service.js';
const uuid = new ZodValidationPipe(c.TeamCreateSchema.shape.id),
  empty = new ZodValidationPipe(c.CollaborationEmptySchema);
function rev(match: string | undefined) {
  const result = expectedRevision(match);
  if (result === undefined) throw new BadRequestException();
  return result;
}
function result<T>(res: Response, value: T) {
  if (
    value &&
    typeof value === 'object' &&
    'revision' in value &&
    typeof value.revision === 'number'
  )
    res.setHeader('ETag', revisionTag(value.revision));
  return value;
}
@Controller('teams/:id')
@UseGuards(VerifiedSessionGuard, TeamGuard)
export class TeamMeetingsController {
  constructor(
    @Inject(TeamMeetingsService) private readonly service: TeamMeetingsService,
  ) {}
  @Get('meetings') async operation0(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(c.ProjectPageQuerySchema))
    q: z.infer<typeof c.ProjectPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      res,
      c.TeamMeetingPageSchema.parse(await this.service.list(actor, id, q)),
    );
  }
  @Post('meetings') async operation1(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.TeamMeetingCreateSchema))
    body: z.infer<typeof c.TeamMeetingCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      res,
      c.TeamMeetingSchema.parse(
        await this.service.create(actor, id, body, key),
      ),
    );
  }
  @Get('meetings/:meetingId') async operation2(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('meetingId', uuid) meetingId: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      res,
      c.TeamMeetingSchema.parse(await this.service.read(actor, id, meetingId)),
    );
  }
  @Patch('meetings/:meetingId') async operation3(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('meetingId', uuid) meetingId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.TeamMeetingPatchSchema))
    body: z.infer<typeof c.TeamMeetingPatchSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      res,
      c.TeamMeetingSchema.parse(
        await this.service.patch(actor, id, meetingId, rev(match), body),
      ),
    );
  }
  @Get('meetings/:meetingId/invitations') async operation4(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('meetingId', uuid) meetingId: string,
    @Query(new ZodValidationPipe(c.ProjectPageQuerySchema))
    q: z.infer<typeof c.ProjectPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      res,
      c.TeamMeetingInvitationPageSchema.parse(
        await this.service.invitations(actor, id, meetingId, q),
      ),
    );
  }
  @Post('meetings/:meetingId/invitations') async operation5(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('meetingId', uuid) meetingId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.TeamMeetingInvitationCreateSchema))
    body: z.infer<typeof c.TeamMeetingInvitationCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      res,
      c.TeamMeetingInvitationSchema.parse(
        await this.service.invite(actor, id, meetingId, rev(match), body, key),
      ),
    );
  }
  @Post('meetings/:meetingId/invitations/:invitationId/respond')
  async operation6(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('meetingId', uuid) meetingId: string,
    @Param('invitationId', uuid) invitationId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.TeamMeetingInvitationResponseSchema))
    body: z.infer<typeof c.TeamMeetingInvitationResponseSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      res,
      c.TeamMeetingInvitationSchema.parse(
        await this.service.respond(
          actor,
          id,
          meetingId,
          invitationId,
          rev(match),
          body.decision,
        ),
      ),
    );
  }
  @Post('meetings/:meetingId/invitations/:invitationId/revoke')
  async operation7(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('meetingId', uuid) meetingId: string,
    @Param('invitationId', uuid) invitationId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CollaborationEmptySchema.optional()))
    _body: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      res,
      c.TeamMeetingInvitationSchema.parse(
        await this.service.respond(
          actor,
          id,
          meetingId,
          invitationId,
          rev(match),
          'REVOKED',
        ),
      ),
    );
  }
}
