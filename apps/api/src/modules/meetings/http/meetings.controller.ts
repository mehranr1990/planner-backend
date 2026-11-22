import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  Headers,
  Inject,
  UseGuards,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
import { z as schema, type z } from 'zod';
import * as c from '@mehran/api-contracts';
import {
  CurrentActor,
  type RequestActor,
} from '../../../platform/auth/request-actor.js';
import { VerifiedSessionGuard } from '../../../platform/auth/session.guard.js';
import { ZodValidationPipe } from '../../../bootstrap/zod-validation.pipe.js';
import { expectedRevision } from '../../../bootstrap/concurrency.js';
import { MeetingsGuard } from './meetings.guard.js';
import { MeetingsService } from '../application/meetings.service.js';
const uuid = new ZodValidationPipe(schema.uuid()),
  empty = new ZodValidationPipe(c.MeetingEmptySchema),
  page = new ZodValidationPipe(c.MeetingPageQuerySchema);
@Controller('meetings')
@UseGuards(VerifiedSessionGuard, MeetingsGuard)
export class MeetingsController {
  @Post(':id/email-invitations')
  inviteEmail(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(c.CommunicationEmailInviteSchema))
    body: z.infer<typeof c.CommunicationEmailInviteSchema>,
    @Headers('if-match') match: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return this.meetings.inviteEmail(a, id, expectedRevision(match), body, key);
  }
  @Get(':id/email-invitations/:invitationId')
  emailOffer(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('invitationId', uuid) invitationId: string,
    @Query(empty) _q: unknown,
  ) {
    return this.meetings.emailInvitation(a, id, invitationId);
  }
  @Post(':id/email-invitations/:invitationId/revoke')
  @HttpCode(200)
  revokeEmail(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('invitationId', uuid) invitationId: string,
    @Headers('if-match') match: string | undefined,
    @Body(new ZodValidationPipe(c.CommunicationEmailEmptySchema)) _b: unknown,
    @Query(empty) _q: unknown,
  ) {
    const revision = expectedRevision(match);
    if (revision === undefined) throw new BadRequestException();
    return this.meetings.emailInvitation(a, id, invitationId, revision);
  }
  @Post('invitations/:invitationId/claim-email')
  @HttpCode(200)
  claimEmail(
    @CurrentActor() a: RequestActor,
    @Param('invitationId', uuid) invitationId: string,
    @Headers('if-match') match: string | undefined,
    @Headers('x-invitation-proof') proof: string | undefined,
    @Body(new ZodValidationPipe(c.CommunicationEmailEmptySchema)) _b: unknown,
    @Query(empty) _q: unknown,
  ) {
    return this.meetings.claimEmailInvitation(
      a,
      invitationId,
      proof,
      expectedRevision(match),
    );
  }
  constructor(
    @Inject(MeetingsService) private readonly meetings: MeetingsService,
  ) {}
  @Get('')
  list(
    @CurrentActor() a: RequestActor,
    @Query(page) q: z.infer<typeof c.MeetingPageQuerySchema>,
  ) {
    return this.meetings.list(a, q);
  }
  @Get('invitations')
  invitations(
    @CurrentActor() a: RequestActor,
    @Query(page) q: z.infer<typeof c.MeetingPageQuerySchema>,
  ) {
    return this.meetings.invitations(a, q);
  }
  @Post('')
  create(
    @CurrentActor() a: RequestActor,
    @Body(new ZodValidationPipe(c.MeetingCreateSchema))
    input: z.infer<typeof c.MeetingCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return this.meetings.create(a, input, key);
  }
  @Post('invitations/:invitationId/respond')
  respond(
    @CurrentActor() a: RequestActor,
    @Param('invitationId', uuid) invitationId: string,
    @Body(new ZodValidationPipe(c.MeetingRsvpSchema))
    input: z.infer<typeof c.MeetingRsvpSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') match: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return this.meetings.rsvp(
      a,
      invitationId,
      expectedRevision(match),
      input.decision,
      key,
    );
  }
  @Get(':id')
  get(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
  ) {
    return this.meetings.get(a, id);
  }
  @Get(':id/access/me') accessMe(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
  ) {
    return this.meetings.accessMe(actor, id);
  }
  @Post(':id/restore-admission')
  restoreAdmission(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(c.MeetingEmptySchema.optional())) _b: unknown,
    @Query(empty) _q: unknown,
    @Headers('if-match') version: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return this.meetings.restoreAdmission(
      a,
      id,
      expectedRevision(version),
      key,
    );
  }
  @Patch(':id')
  patch(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(c.MeetingPatchSchema))
    input: z.infer<typeof c.MeetingPatchSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') match: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return this.meetings.patch(a, id, expectedRevision(match), input, key);
  }
  @Post(':id/invitations')
  invite(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(c.MeetingInviteInputSchema))
    input: z.infer<typeof c.MeetingInviteInputSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') match: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return this.meetings.invite(a, id, expectedRevision(match), input, key);
  }
  @Post(':id/invitations/:invitationId/revoke')
  revokeInvitation(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('invitationId', uuid) invitationId: string,
    @Body(empty) _input: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') match: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return this.meetings.revokeInvitation(
      a,
      id,
      invitationId,
      expectedRevision(match),
      key,
    );
  }
  @Get(':id/members')
  members(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Query(page) q: z.infer<typeof c.MeetingPageQuerySchema>,
  ) {
    return this.meetings.members(a, id, q);
  }
  @Patch(':id/members/:memberId')
  role(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('memberId', uuid) memberId: string,
    @Body(new ZodValidationPipe(c.MeetingMemberRoleSchema))
    input: z.infer<typeof c.MeetingMemberRoleSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') match: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return this.meetings.memberRole(
      a,
      id,
      memberId,
      input.role,
      expectedRevision(match),
      key,
    );
  }
  @Post(':id/members/:memberId/remove')
  remove(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('memberId', uuid) memberId: string,
    @Body(empty) _input: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') match: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return this.meetings.remove(a, id, memberId, expectedRevision(match), key);
  }
  @Post(':id/leave')
  leave(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Body(empty) _input: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') match: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return this.meetings.leave(a, id, expectedRevision(match), key);
  }
  @Get(':id/agenda')
  agenda(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Query(page) q: z.infer<typeof c.MeetingPageQuerySchema>,
  ) {
    return this.meetings.agenda(a, id, q);
  }
  @Post(':id/agenda')
  propose(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(c.MeetingAgendaCreateSchema))
    input: z.infer<typeof c.MeetingAgendaCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return this.meetings.propose(a, id, input, key);
  }
  @Patch(':id/agenda/:entryId')
  select(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('entryId', uuid) entryId: string,
    @Body(new ZodValidationPipe(c.MeetingAgendaSelectSchema))
    input: z.infer<typeof c.MeetingAgendaSelectSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') match: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return this.meetings.selectAgenda(
      a,
      id,
      entryId,
      input.state,
      expectedRevision(match),
      key,
    );
  }
}
