import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';
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
const empty = new ZodValidationPipe(c.EmptyQuerySchema),
  idPipe = new ZodValidationPipe(c.TaskIdSchema);
function required(tag: string | undefined) {
  const r = expectedRevision(tag);
  if (r === undefined) throw new BadRequestException();
  return r;
}
function versioned<T extends { revision: number }>(res: Response, v: T) {
  res.setHeader('ETag', revisionTag(v.revision));
  return v;
}
import { CaptureService } from '../application/capture.service.js';

@Controller('capture')
@UseGuards(VerifiedSessionGuard)
export class CaptureController {
  constructor(
    @Inject(CaptureService) private readonly service: CaptureService,
    @Inject(SpacesService) private readonly spaces: SpacesService,
  ) {}
  @Post() async create(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(c.CaptureCreateSchema)) body: c.CaptureCreate,
    @Query(empty) _q: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.create(
        await this.spaces.authorizePersonal(actor),
        key,
        body,
      ),
    );
  }
  @Post('parse') @HttpCode(200) async parse(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(c.CaptureParseSchema)) body: c.CaptureParse,
    @Query(empty) _q: unknown,
  ) {
    return this.service.parse(await this.spaces.authorizePersonal(actor), body);
  }
  @Get() async list(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(c.CaptureQuerySchema))
    q: z.infer<typeof c.CaptureQuerySchema>,
  ) {
    return this.service.list(await this.spaces.authorizePersonal(actor), q);
  }
  @Get(':id') async get(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.get(await this.spaces.authorizePersonal(actor), id),
    );
  }
  @Patch(':id') async patch(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.CapturePatchSchema)) body: c.CapturePatch,
    @Query(empty) _q: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.patch(
        await this.spaces.authorizePersonal(actor),
        id,
        required(tag),
        body,
      ),
    );
  }
  @Post(':id/triage') @HttpCode(200) async triage(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.CaptureTriageSchema)) body: c.CaptureTriage,
    @Query(empty) _q: unknown,
    @Headers('if-match') tag: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.triage(
        await this.spaces.authorizePersonal(actor),
        id,
        required(tag),
        key,
        body,
      ),
    );
  }
}
@Controller('search')
@UseGuards(VerifiedSessionGuard)
export class PersonalSearchController {
  constructor(
    @Inject(CaptureService) private readonly service: CaptureService,
    @Inject(SpacesService) private readonly spaces: SpacesService,
  ) {}
  @Get('personal') async search(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(c.PersonalSearchQuerySchema))
    q: c.PersonalSearchQuery,
  ) {
    return this.service.search(await this.spaces.authorizePersonal(actor), q);
  }
}
