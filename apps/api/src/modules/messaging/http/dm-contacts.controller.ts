import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
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
import { DmContacts } from '../application/dm-contacts.service.js';
import { MessagingGuard } from './messaging.controller.js';
const empty = new ZodValidationPipe(c.ConversationEmptySchema);
@Controller()
@UseGuards(VerifiedSessionGuard, MessagingGuard)
export class DmContactsController {
  constructor(@Inject(DmContacts) private readonly contacts: DmContacts) {}
  @Get('conversations/:id/contact-block')
  async get(
    @CurrentActor() actor: RequestActor,
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.contacts.get(actor, id);
    res.setHeader('ETag', revisionTag(r.revision));
    return r;
  }
  @Get('messaging/blocks')
  list(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(c.ConversationPageQuerySchema))
    q: z.infer<typeof c.ConversationPageQuerySchema>,
  ) {
    return this.contacts.list(actor, q);
  }
  @Post('messaging/blocks')
  async set(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(c.DmContactInputSchema))
    body: z.infer<typeof c.DmContactInputSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') version: string | undefined,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.contacts.set(
      actor,
      'blockId' in body ? body.blockId : body.conversationId,
      body.active,
      key,
      expectedRevision(version),
      'blockId' in body,
    );
    res.setHeader('ETag', revisionTag(r.revision));
    return r;
  }
  @Post('messaging/blocks/replay')
  replay(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(c.ConversationEmptySchema.optional()))
    _b: unknown,
    @Query(empty) _q: unknown,
  ) {
    return this.contacts.replay(actor);
  }
}
