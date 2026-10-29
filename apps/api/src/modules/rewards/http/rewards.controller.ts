import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
  BadRequestException,
  HttpCode,
} from '@nestjs/common';
import type { Response } from 'express';
import * as c from '@mehran/api-contracts';
import { SpacesService } from '../../spaces/public/index.js';
import { VerifiedSessionGuard } from '../../../platform/auth/session.guard.js';
import { CurrentActor } from '../../../platform/auth/request-actor.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { ZodValidationPipe } from '../../../bootstrap/zod-validation.pipe.js';
import {
  expectedRevision,
  revisionTag,
} from '../../../bootstrap/concurrency.js';
import { RewardsPort } from '../application/rewards.port.js';
const empty = new ZodValidationPipe(c.EmptyQuerySchema);
@Controller('rewards')
@UseGuards(VerifiedSessionGuard)
export class RewardsController {
  constructor(
    @Inject(RewardsPort) private readonly service: RewardsPort,
    @Inject(SpacesService) private readonly spaces: SpacesService,
  ) {}
  private mutation(tag: string | undefined, key: string | undefined) {
    const revision = expectedRevision(tag);
    if (revision === undefined || !key || !/^[\x21-\x7e]{1,128}$/.test(key))
      throw new BadRequestException();
    return { revision, key };
  }
  @Get('preferences') async preferences(
    @CurrentActor() a: RequestActor,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const p = await this.service.preferences(
      await this.spaces.authorizePersonal(a),
    );
    res.setHeader('ETag', revisionTag(p.revision));
    return p;
  }
  @Patch('preferences') async update(
    @CurrentActor() a: RequestActor,
    @Query(empty) _q: unknown,
    @Headers('if-match') tag: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(c.RewardPreferencesPatchSchema))
    body: { enabled: boolean; displayAchievements: boolean },
    @Res({ passthrough: true }) res: Response,
  ) {
    const m = this.mutation(tag, key);
    const p = await this.service.setPreferences(
      await this.spaces.authorizePersonal(a),
      m.revision,
      m.key,
      body,
    );
    res.setHeader('ETag', revisionTag(p.revision));
    return p;
  }
  @Get('progress') async progress(
    @CurrentActor() a: RequestActor,
    @Query(new ZodValidationPipe(c.RewardQuerySchema))
    q: { cursor?: string; limit?: string },
  ) {
    return this.service.progress(await this.spaces.authorizePersonal(a), q);
  }
  @Get('achievements') async achievements(
    @CurrentActor() a: RequestActor,
    @Query(empty) _q: unknown,
  ) {
    return this.service.achievements(await this.spaces.authorizePersonal(a));
  }
  @Post('achievements/recalculate') @HttpCode(200) async recalculate(
    @CurrentActor() a: RequestActor,
    @Query(empty) _q: unknown,
    @Headers('if-match') tag: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(c.RewardRecalculateSchema))
    q: { after?: string; limit: number },
  ) {
    const m = this.mutation(tag, key);
    return this.service.recalculate(
      await this.spaces.authorizePersonal(a),
      m.revision,
      m.key,
      q,
    );
  }
}
