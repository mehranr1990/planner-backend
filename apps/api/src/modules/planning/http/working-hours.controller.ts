import {
  Controller,
  Get,
  Put,
  Body,
  Query,
  Headers,
  Res,
  Inject,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import * as c from '@mehran/api-contracts';
import { WorkingHoursService } from '../application/working-hours.service.js';
import { VerifiedSessionGuard } from '../../../platform/auth/session.guard.js';
import { CurrentActor } from '../../../platform/auth/request-actor.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { SpacesService } from '../../spaces/public/index.js';
import { ZodValidationPipe } from '../../../bootstrap/zod-validation.pipe.js';
import {
  expectedRevision,
  revisionTag,
} from '../../../bootstrap/concurrency.js';
@Controller('planning')
@UseGuards(VerifiedSessionGuard)
export class WorkingHoursController {
  constructor(
    @Inject(WorkingHoursService) private readonly service: WorkingHoursService,
    @Inject(SpacesService) private readonly spaces: SpacesService,
  ) {}
  @Get('working-hours') async read(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(c.EmptyQuerySchema)) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.service.read(
      await this.spaces.authorizePersonal(actor),
    );
    res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Put('working-hours') async write(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(c.WorkingHoursPutSchema))
    body: { workingHours: c.WorkingHours | null },
    @Query(new ZodValidationPipe(c.EmptyQuerySchema)) _q: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const revision = expectedRevision(tag);
    if (revision === undefined) throw new BadRequestException();
    const result = await this.service.write(
      await this.spaces.authorizePersonal(actor),
      revision,
      body.workingHours,
    );
    res.setHeader('ETag', revisionTag(result.revision));
    return result;
  }
  @Get('capacity/schedule') async capacity(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(c.WorkingCapacityQuerySchema))
    query: { date?: string; weekStartDate?: string },
  ) {
    return this.service.capacity(
      await this.spaces.authorizePersonal(actor),
      query,
    );
  }
}
