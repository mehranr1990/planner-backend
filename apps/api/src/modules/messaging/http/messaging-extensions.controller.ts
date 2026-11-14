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
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
import type { z } from 'zod';
import { z as schema } from 'zod';
import * as c from '@mehran/api-contracts';
import { VerifiedSessionGuard } from '../../../platform/auth/session.guard.js';
import { CurrentActor } from '../../../platform/auth/request-actor.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { ZodValidationPipe } from '../../../bootstrap/zod-validation.pipe.js';
import { expectedRevision } from '../../../bootstrap/concurrency.js';
import { MessagingGuard } from './messaging.controller.js';
import { MessagingExtensionsService } from '../application/messaging-extensions.service.js';
const uuid = new ZodValidationPipe(schema.uuid()),
  empty = new ZodValidationPipe(c.BackendCompletionEmptySchema);
function rev(match: string | undefined) {
  const result = expectedRevision(match);
  if (result === undefined) throw new BadRequestException();
  return result;
}
/** OD-10 channel settings and conversation reports; OD-11 global search. */
@Controller()
@UseGuards(VerifiedSessionGuard, MessagingGuard)
export class MessagingExtensionsController {
  constructor(
    @Inject(MessagingExtensionsService)
    private readonly service: MessagingExtensionsService,
  ) {}
  @Get('conversations/:id/settings') settings(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
  ) {
    return this.service.settings(actor, id);
  }
  @Patch('conversations/:id/settings') updateSettings(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(new ZodValidationPipe(c.ConversationSettingsPatchSchema))
    body: z.infer<typeof c.ConversationSettingsPatchSchema>,
  ) {
    return this.service.updateSettings(actor, id, rev(match), body);
  }
  @Patch('conversations/:id/preferences') updatePreferences(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(new ZodValidationPipe(c.ConversationPreferencesPatchSchema))
    body: z.infer<typeof c.ConversationPreferencesPatchSchema>,
  ) {
    return this.service.updatePreferences(actor, id, rev(match), body);
  }
  @Post('conversations/:id/reports') report(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.ConversationReportCreateSchema))
    body: z.infer<typeof c.ConversationReportCreateSchema>,
  ) {
    return this.service.report(actor, id, body);
  }
  @Get('conversations/:id/reports') reports(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
  ) {
    return this.service.reports(actor, id);
  }
  @Post('conversations/:id/reports/:reportId/resolve') @HttpCode(200) resolve(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('reportId', uuid) reportId: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(new ZodValidationPipe(c.ConversationReportResolveSchema))
    body: z.infer<typeof c.ConversationReportResolveSchema>,
  ) {
    return this.service.resolveReport(actor, id, reportId, rev(match), body);
  }
  @Get('messaging/search') search(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(c.GlobalMessageSearchQuerySchema))
    q: z.infer<typeof c.GlobalMessageSearchQuerySchema>,
  ) {
    return this.service.search(actor, q);
  }
}
