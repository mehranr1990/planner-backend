import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
  Body,
  Headers,
  Inject,
  UseGuards,
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
import { MessagingGuard } from './messaging.controller.js';
import { MessagingPush } from '../../notifications/public/index.js';
import { MessageNotices } from '../application/message-notices.service.js';
const uuid = new ZodValidationPipe(schema.uuid()),
  empty = new ZodValidationPipe(c.ConversationEmptySchema),
  page = new ZodValidationPipe(c.ConversationPageQuerySchema);
@Controller('messaging-notifications')
@UseGuards(VerifiedSessionGuard, MessagingGuard)
export class MessageNoticesController {
  constructor(
    @Inject(MessageNotices) private readonly notices: MessageNotices,
    @Inject(MessagingPush) private readonly push: MessagingPush,
  ) {}
  @Get('settings')
  settings(@CurrentActor() actor: RequestActor, @Query(empty) _q: unknown) {
    return this.push.settings(actor);
  }
  @Patch('settings')
  consent(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(c.MessagingPushConsentSchema))
    body: z.infer<typeof c.MessagingPushConsentSchema>,
    @Headers('if-match') version: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    const revision = expectedRevision(version);
    if (revision === undefined || !key) throw new BadRequestException();
    return this.push.setConsent(actor, body.enabled, revision, key);
  }
  @Get()
  list(
    @CurrentActor() actor: RequestActor,
    @Query(page) q: z.infer<typeof c.ConversationPageQuerySchema>,
  ) {
    return this.notices.list(actor, q);
  }
  @Post(':noticeId/read')
  read(
    @CurrentActor() actor: RequestActor,
    @Param('noticeId', uuid) id: string,
    @Headers('if-match') version: string | undefined,
    @Body(empty) _b: unknown,
    @Query(empty) _q: unknown,
  ) {
    return this.notices.read(actor, id, expectedRevision(version));
  }
  @Get(':noticeId/deliveries')
  attempts(
    @CurrentActor() actor: RequestActor,
    @Param('noticeId', uuid) id: string,
    @Query(empty) _q: unknown,
  ) {
    return this.notices.attempts(actor, id);
  }
}
