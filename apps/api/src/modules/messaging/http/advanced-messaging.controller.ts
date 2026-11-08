import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Headers,
  Inject,
  UseGuards,
} from '@nestjs/common';
import type { z } from 'zod';
import { z as schema } from 'zod';
import * as c from '@mehran/api-contracts';
import {
  CurrentActor,
  type RequestActor,
} from '../../../platform/auth/request-actor.js';
import { VerifiedSessionGuard } from '../../../platform/auth/session.guard.js';
import { ZodValidationPipe } from '../../../bootstrap/zod-validation.pipe.js';
import { expectedRevision } from '../../../bootstrap/concurrency.js';
import { MessagingGuard } from './messaging.controller.js';
import { AdvancedMessagingService } from '../application/advanced-messaging.service.js';
const uuid = new ZodValidationPipe(schema.uuid()),
  page = new ZodValidationPipe(c.ConversationPageQuerySchema),
  empty = new ZodValidationPipe(c.ConversationEmptySchema);
@Controller('conversations/:id')
@UseGuards(VerifiedSessionGuard, MessagingGuard)
export class AdvancedMessagingController {
  constructor(
    @Inject(AdvancedMessagingService)
    private readonly service: AdvancedMessagingService,
  ) {}
  @Post('advanced-actions')
  act(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(c.AdvancedMessageActionSchema))
    body: z.infer<typeof c.AdvancedMessageActionSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') version: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return this.service.act(actor, id, body, key, expectedRevision(version));
  }
  @Get('timeline')
  timeline(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(page) q: z.infer<typeof c.ConversationPageQuerySchema>,
  ) {
    return this.service.timeline(actor, id, q);
  }
  @Get('message-changes')
  changes(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(page) q: z.infer<typeof c.ConversationPageQuerySchema>,
  ) {
    return this.service.changes(actor, id, q);
  }
  @Get('message-details/:messageId')
  detail(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('messageId', uuid) messageId: string,
    @Query(empty) _q: unknown,
  ) {
    return this.service.detail(actor, id, messageId);
  }
  @Get('threads/:messageId')
  thread(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('messageId', uuid) messageId: string,
    @Query(page) q: z.infer<typeof c.ConversationPageQuerySchema>,
  ) {
    return this.service.timeline(actor, id, q, { thread: messageId });
  }
  @Get('message-search')
  search(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(c.MessageSearchQuerySchema))
    q: z.infer<typeof c.MessageSearchQuerySchema>,
  ) {
    return this.service.timeline(actor, id, q, { search: q.q });
  }
  @Get('pins')
  pins(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(page) q: z.infer<typeof c.ConversationPageQuerySchema>,
  ) {
    return this.service.timeline(actor, id, q, { pins: true });
  }
  @Get('mentions')
  mentions(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(page) q: z.infer<typeof c.ConversationPageQuerySchema>,
  ) {
    return this.service.timeline(actor, id, q, { mentions: true });
  }
  @Get('message-reports')
  reports(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(page) q: z.infer<typeof c.ConversationPageQuerySchema>,
  ) {
    return this.service.reports(actor, id, q);
  }
  @Get('message-details/:messageId/revisions')
  revisions(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('messageId', uuid) messageId: string,
    @Query(page) q: z.infer<typeof c.ConversationPageQuerySchema>,
  ) {
    return this.service.revisions(actor, id, messageId, q);
  }
  @Get('message-policy')
  policy(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
  ) {
    return this.service.policy(actor, id);
  }
}
