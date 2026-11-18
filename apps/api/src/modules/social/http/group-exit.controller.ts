import {
  Controller,
  Get,
  Post,
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
  socialEmpty,
  socialExpected,
  socialResult,
} from './social.controller.js';
import { SocialGroupExitService } from '../application/group-exit.service.js';
type A = RequestActor;
type Infer<T extends z.ZodType> = z.infer<T>;
const pipe = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
/** P6-06 (ADR 0066): Group departure, deletion and 30-day recovery. */
@Controller('social-groups')
@UseGuards(VerifiedSessionGuard, SocialGuard)
export class SocialGroupExitController {
  constructor(
    @Inject(SocialGroupExitService) private readonly s: SocialGroupExitService,
  ) {}
  @Get(':id/exit-check') check(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Query(socialEmpty) _q: unknown,
  ) {
    return this.s.check(a, id);
  }
  @Post(':id/leave') leave(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Body(pipe(c.SocialGroupLeaveSchema.optional()))
    b: Infer<typeof c.SocialGroupLeaveSchema> | undefined,
    @Headers('if-match') v: string | undefined,
  ) {
    return this.s.leave(a, id, socialExpected(v), b);
  }
  @Post(':id/delete') async delete(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Body(pipe(c.SocialGroupDeleteSchema))
    b: Infer<typeof c.SocialGroupDeleteSchema>,
    @Headers('if-match') v: string | undefined,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(r, await this.s.delete(a, id, socialExpected(v), b));
  }
  @Get(':id/lifecycle-job') async job(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Query(socialEmpty) _q: unknown,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(
      r,
      c.SocialGroupLifecycleJobSchema.parse(await this.s.job(a, id)),
    );
  }
  @Post(':id/lifecycle-job/recovery-proof') async proof(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Body(pipe(c.SocialGroupLifecyclePasswordSchema))
    b: Infer<typeof c.SocialGroupLifecyclePasswordSchema>,
    @Headers('if-match') v: string | undefined,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(
      r,
      c.SocialGroupLifecycleProofSchema.parse(
        await this.s.proof(a, id, socialExpected(v), b.password),
      ),
    );
  }
  @Post(':id/lifecycle-job/recover') async recover(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Body(pipe(c.SocialGroupLifecycleRecoverSchema))
    b: Infer<typeof c.SocialGroupLifecycleRecoverSchema>,
    @Headers('if-match') v: string | undefined,
    @Headers('x-deletion-recovery') proof: string | undefined,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(
      r,
      c.SocialGroupLifecycleRecoverySchema.parse(
        await this.s.recover(
          a,
          id,
          socialExpected(v),
          b.generation,
          proof,
          b.password,
        ),
      ),
    );
  }
}
