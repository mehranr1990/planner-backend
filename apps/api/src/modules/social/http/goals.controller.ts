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
} from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import { VerifiedSessionGuard } from '../../../platform/auth/session.guard.js';
import { CurrentActor } from '../../../platform/auth/request-actor.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { ZodValidationPipe } from '../../../bootstrap/zod-validation.pipe.js';
import {
  SocialGuard,
  socialId,
  socialPage,
  socialEmpty,
  socialBody,
  socialExpected,
  socialResult,
} from './social.controller.js';
import { SocialGoalsService } from '../application/goals.service.js';
type A = RequestActor;
type K = string | undefined;
type Infer<T extends z.ZodType> = z.infer<T>;
const pipe = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
/** P6-05 Social Goals and Challenges (ADR 0065). No album operations exist. */
@Controller('social-goals')
@UseGuards(VerifiedSessionGuard, SocialGuard)
export class SocialGoalsController {
  constructor(
    @Inject(SocialGoalsService) private readonly s: SocialGoalsService,
  ) {}
  @Get() list(
    @CurrentActor() a: A,
    @Query(pipe(c.SocialGoalListQuerySchema))
    q: Infer<typeof c.SocialGoalListQuerySchema>,
  ) {
    return this.s.list(a, q);
  }
  @Post() async create(
    @CurrentActor() a: A,
    @Body(pipe(c.SocialGoalCreateSchema))
    b: Infer<typeof c.SocialGoalCreateSchema>,
    @Headers('idempotency-key') k: K,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(r, await this.s.create(a, b, k));
  }
  @Get(':id') async read(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Query(socialEmpty) _q: unknown,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(r, await this.s.read(a, id));
  }
  @Patch(':id') async patch(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Body(pipe(c.SocialGoalPatchSchema))
    b: Infer<typeof c.SocialGoalPatchSchema>,
    @Headers('idempotency-key') k: K,
    @Headers('if-match') v: K,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(r, await this.s.patch(a, id, b, socialExpected(v), k));
  }
  @Post(':id/actions/:action') async act(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Param('action', pipe(c.SocialGoalActionSchema))
    action: Infer<typeof c.SocialGoalActionSchema>,
    @Body(socialBody) _b: unknown,
    @Headers('idempotency-key') k: K,
    @Headers('if-match') v: K,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(
      r,
      await this.s.act(a, id, action, socialExpected(v), k),
    );
  }
  @Post(':id/join') async join(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Body(socialBody) _b: unknown,
    @Headers('idempotency-key') k: K,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(r, await this.s.join(a, id, k));
  }
  @Post(':id/withdraw') async withdraw(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Body(socialBody) _b: unknown,
    @Headers('idempotency-key') k: K,
    @Headers('if-match') v: K,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(r, await this.s.withdraw(a, id, socialExpected(v), k));
  }
  @Get(':id/participants') participants(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Query(socialPage) q: Infer<typeof c.SocialPageQuerySchema>,
  ) {
    return this.s.participants(a, id, q);
  }
  @Get(':id/entries') entries(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Query(pipe(c.SocialGoalEntryListQuerySchema))
    q: Infer<typeof c.SocialGoalEntryListQuerySchema>,
  ) {
    return this.s.entries(a, id, q);
  }
  @Post(':id/entries') async submit(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Body(pipe(c.SocialGoalEntryCreateSchema))
    b: Infer<typeof c.SocialGoalEntryCreateSchema>,
    @Headers('idempotency-key') k: K,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(r, await this.s.submit(a, id, b, k));
  }
  @Post(':id/entries/:entryId/actions/:action') async entryAct(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Param('entryId', socialId) entryId: string,
    @Param('action', pipe(c.SocialGoalEntryActionSchema))
    action: Infer<typeof c.SocialGoalEntryActionSchema>,
    @Body(pipe(c.SocialGoalEntryDecisionSchema))
    b: Infer<typeof c.SocialGoalEntryDecisionSchema>,
    @Headers('idempotency-key') k: K,
    @Headers('if-match') v: K,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(
      r,
      await this.s.entryAct(a, id, entryId, action, b, socialExpected(v), k),
    );
  }
  @Post(':id/corrections') async correct(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Body(pipe(c.SocialGoalCorrectionCreateSchema))
    b: Infer<typeof c.SocialGoalCorrectionCreateSchema>,
    @Headers('idempotency-key') k: K,
    @Headers('if-match') v: K,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(
      r,
      await this.s.correct(a, id, b, socialExpected(v), k),
    );
  }
  @Get(':id/history') history(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Query(socialEmpty) _q: unknown,
  ) {
    return this.s.history(a, id);
  }
}
