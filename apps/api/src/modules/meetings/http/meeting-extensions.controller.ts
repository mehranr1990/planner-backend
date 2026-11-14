import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Query,
  Param,
  Headers,
  Inject,
  UseGuards,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
import { z as schema, type z } from 'zod';
import * as c from '@mehran/api-contracts';
import { VerifiedSessionGuard } from '../../../platform/auth/session.guard.js';
import { CurrentActor } from '../../../platform/auth/request-actor.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { ZodValidationPipe } from '../../../bootstrap/zod-validation.pipe.js';
import { expectedRevision } from '../../../bootstrap/concurrency.js';
import { MeetingsGuard } from './meetings.guard.js';
import { MeetingsService } from '../application/meetings.service.js';
import { AnnouncementsService } from '../application/announcements.service.js';
const uuid = new ZodValidationPipe(schema.uuid()),
  empty = new ZodValidationPipe(c.BackendCompletionEmptySchema);
function rev(match: string | undefined) {
  const result = expectedRevision(match);
  if (result === undefined) throw new BadRequestException();
  return result;
}
/** OD-12 busy-only meeting blocks and OD-13 announcement reminders. */
@Controller()
@UseGuards(VerifiedSessionGuard, MeetingsGuard)
export class MeetingExtensionsController {
  constructor(
    @Inject(MeetingsService) private readonly meetings: MeetingsService,
    @Inject(AnnouncementsService)
    private readonly announcements: AnnouncementsService,
  ) {}
  @Put('meetings/:id/busy-visibility') busyVisibility(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(new ZodValidationPipe(c.MeetingBusyVisibilityInputSchema))
    body: z.infer<typeof c.MeetingBusyVisibilityInputSchema>,
  ) {
    return this.meetings.setBusyVisibility(actor, id, rev(match), body);
  }
  @Get('meeting-busy') busy(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(c.MeetingBusyQuerySchema))
    q: z.infer<typeof c.MeetingBusyQuerySchema>,
  ) {
    return this.meetings.busy(actor, q);
  }
  @Post('announcements/:id/versions/:versionId/remind') @HttpCode(200) remind(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('versionId', uuid) versionId: string,
    @Query(empty) _q: unknown,
    @Body(empty) _b: unknown,
  ) {
    return this.announcements.remind(actor, id, versionId);
  }
  @Get('announcement-reminders') reminders(
    @CurrentActor() actor: RequestActor,
    @Query(empty) _q: unknown,
  ) {
    return this.announcements.reminders(actor);
  }
  @Post('announcement-reminders/:reminderId/read') @HttpCode(200) read(
    @CurrentActor() actor: RequestActor,
    @Param('reminderId', uuid) reminderId: string,
    @Query(empty) _q: unknown,
    @Body(empty) _b: unknown,
  ) {
    return this.announcements.readReminder(actor, reminderId);
  }
}
