import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import {
  CurrentActor,
  type RequestActor,
} from '../../../platform/auth/request-actor.js';
import { VerifiedSessionGuard } from '../../../platform/auth/session.guard.js';
import { ZodValidationPipe } from '../../../bootstrap/zod-validation.pipe.js';
import { MessagingGuard } from './messaging.controller.js';
import { MessageMediaService } from '../application/message-media.service.js';

@Controller('conversations')
@UseGuards(VerifiedSessionGuard, MessagingGuard)
export class ConversationSummaryController {
  constructor(
    @Inject(MessageMediaService) private readonly media: MessageMediaService,
  ) {}
  @Get() list(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(c.ConversationPageQuerySchema))
    q: z.infer<typeof c.ConversationPageQuerySchema>,
  ) {
    return this.media.conversations(actor, q);
  }
}
