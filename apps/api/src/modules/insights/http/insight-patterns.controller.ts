import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import { SpacesService } from '../../spaces/public/index.js';
import { VerifiedSessionGuard } from '../../../platform/auth/session.guard.js';
import { CurrentActor } from '../../../platform/auth/request-actor.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { ZodValidationPipe } from '../../../bootstrap/zod-validation.pipe.js';
import { InsightPatternsService } from '../application/insight-patterns.service.js';
/** B4 Personal Insights patterns (owner-approved). */
@Controller('insights/patterns')
@UseGuards(VerifiedSessionGuard)
export class InsightPatternsController {
  constructor(
    @Inject(InsightPatternsService)
    private readonly patterns: InsightPatternsService,
    @Inject(SpacesService) private readonly spaces: SpacesService,
  ) {}
  @Get() async pattern(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(c.InsightPatternQuerySchema))
    q: z.infer<typeof c.InsightPatternQuerySchema>,
  ) {
    return this.patterns.pattern(
      await this.spaces.authorizePersonal(actor),
      actor,
      q,
    );
  }
}
