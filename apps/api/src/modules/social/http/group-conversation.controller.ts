import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  Headers,
  Inject,
  UseGuards,
} from '@nestjs/common';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import { VerifiedSessionGuard } from '../../../platform/auth/session.guard.js';
import { CurrentActor } from '../../../platform/auth/request-actor.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { ZodValidationPipe } from '../../../bootstrap/zod-validation.pipe.js';
import {
  SocialGuard,
  socialBody,
  socialId,
  socialEmpty,
  socialExpected,
} from './social.controller.js';
import { SocialGroupConversationService } from '../application/group-conversation.service.js';
type A = RequestActor;
type K = string | undefined;
const pipe = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
/** ADR 0067 (D7): the primary Social Group conversation. */
@Controller('social-groups')
@UseGuards(VerifiedSessionGuard, SocialGuard)
export class SocialGroupConversationController {
  constructor(
    @Inject(SocialGroupConversationService)
    private readonly s: SocialGroupConversationService,
  ) {}
  @Get(':id/conversation') read(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Query(socialEmpty) _q: unknown,
  ) {
    return this.s.read(a, id);
  }
  @Post(':id/conversation/open') open(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Body(pipe(c.SocialGroupConversationOpenSchema))
    b: z.infer<typeof c.SocialGroupConversationOpenSchema>,
    @Headers('idempotency-key') k: K,
    @Headers('if-match') v: K,
  ) {
    return this.s.open(a, id, b, socialExpected(v), k);
  }
  @Post(':id/conversation/join') join(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Body(socialBody) _b: unknown,
    @Headers('idempotency-key') k: K,
  ) {
    return this.s.join(a, id, k);
  }
}
