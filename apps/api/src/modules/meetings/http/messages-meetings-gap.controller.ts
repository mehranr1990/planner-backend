import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Query,
  Param,
  Headers,
  Inject,
  UseGuards,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { z, type infer as Infer } from 'zod';
import * as c from '@mehran/api-contracts';
import {
  CurrentActor,
  type RequestActor,
} from '../../../platform/auth/request-actor.js';
import { VerifiedSessionGuard } from '../../../platform/auth/session.guard.js';
import { ZodValidationPipe } from '../../../bootstrap/zod-validation.pipe.js';
import {
  expectedRevision,
  revisionTag,
} from '../../../bootstrap/concurrency.js';
import { MeetingsGuard } from './meetings.guard.js';
import { AgendaDetailsService } from '../application/agenda-details.service.js';
import { AnnouncementSchedulesService } from '../application/announcement-schedules.service.js';
import { MeetingsService } from '../application/meetings.service.js';
const uuid = new ZodValidationPipe(z.uuid()),
  empty = new ZodValidationPipe(c.MeetingEmptySchema),
  page = new ZodValidationPipe(c.MeetingPageQuerySchema);
function result<T extends { revision: number } | null>(
  res: Response,
  value: T,
) {
  if (value) res.setHeader('ETag', revisionTag(value.revision));
  return value;
}
@Controller()
@UseGuards(VerifiedSessionGuard, MeetingsGuard)
export class MessagesMeetingsGapController {
  constructor(
    @Inject(AgendaDetailsService) readonly agenda: AgendaDetailsService,
    @Inject(AnnouncementSchedulesService)
    readonly schedules: AnnouncementSchedulesService,
    @Inject(MeetingsService) readonly meetings: MeetingsService,
  ) {}
  @Get('meetings/:id/invitations') invitations(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Query(page) q: Infer<typeof c.MeetingPageQuerySchema>,
  ) {
    return this.meetings.organizerInvitations(a, id, q);
  }
  @Get('meetings/:id/agenda/:entryId/details') async details(
    @Res({ passthrough: true }) res: Response,
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('entryId', uuid) entryId: string,
    @Query(empty) _q: unknown,
  ) {
    return result(res, await this.agenda.get(a, id, entryId));
  }
  @Patch('meetings/:id/agenda/:entryId/details') async patch(
    @Res({ passthrough: true }) res: Response,
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('entryId', uuid) entryId: string,
    @Body(new ZodValidationPipe(c.AgendaDetailPatchSchema))
    b: Infer<typeof c.AgendaDetailPatchSchema>,
    @Headers('if-match') match: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return result(
      res,
      await this.agenda.patch(a, id, entryId, b, expectedRevision(match), key),
    );
  }
  @Get('meetings/:id/agenda/:entryId/history') history(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('entryId', uuid) entryId: string,
    @Query(page) q: Infer<typeof c.MeetingPageQuerySchema>,
  ) {
    return this.agenda.history(a, id, entryId, q);
  }
  @Get('meetings/:id/agenda-summary') summary(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
  ) {
    return this.agenda.summary(a, id);
  }
  @Get('announcements/:id/versions/:versionId/schedule') async schedule(
    @Res() res: Response,
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('versionId', uuid) versionId: string,
    @Query(empty) _q: unknown,
  ) {
    // Express must serialize the documented null result as JSON, not an empty body.
    res.json(result(res, await this.schedules.read(a, id, versionId)));
  }
  @Post('announcements/:id/versions/:versionId/schedule') async setSchedule(
    @Res({ passthrough: true }) res: Response,
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('versionId', uuid) versionId: string,
    @Body(new ZodValidationPipe(c.AnnouncementScheduleInputSchema))
    b: Infer<typeof c.AnnouncementScheduleInputSchema>,
    @Headers('if-match') match: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return result(
      res,
      await this.schedules.schedule(
        a,
        id,
        versionId,
        b,
        expectedRevision(match),
        key,
      ),
    );
  }
  @Post('announcements/:id/versions/:versionId/schedule/cancel') async cancel(
    @Res({ passthrough: true }) res: Response,
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('versionId', uuid) versionId: string,
    @Body(empty) _b: unknown,
    @Headers('if-match') match: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return result(
      res,
      await this.schedules.cancel(
        a,
        id,
        versionId,
        expectedRevision(match),
        key,
      ),
    );
  }
}
