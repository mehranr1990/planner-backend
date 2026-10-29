import {
  Controller,
  Get,
  Inject,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import * as c from '@mehran/api-contracts';
import { SpacesService } from '../../spaces/public/index.js';
import { VerifiedSessionGuard } from '../../../platform/auth/session.guard.js';
import { CurrentActor } from '../../../platform/auth/request-actor.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { ZodValidationPipe } from '../../../bootstrap/zod-validation.pipe.js';
import { InsightsService } from '../application/insights.service.js';
@Controller('insights')
@UseGuards(VerifiedSessionGuard)
export class InsightsController {
  constructor(
    @Inject(InsightsService) private readonly service: InsightsService,
    @Inject(SpacesService) private readonly spaces: SpacesService,
  ) {}
  @Get(':family') async read(
    @CurrentActor() actor: RequestActor,
    @Param('family', new ZodValidationPipe(c.InsightFamilySchema))
    family: c.InsightFamily,
    @Query(new ZodValidationPipe(c.InsightQuerySchema)) query: c.InsightQuery,
  ) {
    return this.service.query(
      await this.spaces.authorizePersonal(actor),
      family,
      query,
    );
  }
}
