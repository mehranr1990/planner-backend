import {
  Body,
  Controller,
  Delete,
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
import { FocusService } from '../application/focus.service.js';
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
  page = new ZodValidationPipe(c.CursorQuerySchema),
  ids = new ZodValidationPipe(c.TaskIdSchema);
function revision(tag: string | undefined) {
  const v = expectedRevision(tag);
  if (v === undefined) throw new BadRequestException();
  return v;
}
function versioned<T extends { revision: number }>(res: Response, v: T) {
  res.setHeader('ETag', revisionTag(v.revision));
  return v;
}

@Controller('focus/sessions')
@UseGuards(VerifiedSessionGuard)
export class FocusController {
  constructor(
    @Inject(FocusService) private readonly service: FocusService,
    @Inject(SpacesService) private readonly spaces: SpacesService,
  ) {}
  @Post() async create(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(c.FocusCreateSchema)) body: c.FocusCreate,
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
  @Get() async list(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(c.FocusQuerySchema))
    q: z.infer<typeof c.FocusQuerySchema>,
  ) {
    return this.service.list(await this.spaces.authorizePersonal(actor), q);
  }
  @Get(':id') async get(
    @CurrentActor() actor: RequestActor,
    @Param('id', ids) id: string,
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
    @Param('id', ids) id: string,
    @Body(new ZodValidationPipe(c.FocusPatchSchema)) body: c.FocusPatch,
    @Query(empty) _q: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.patch(
        await this.spaces.authorizePersonal(actor),
        id,
        revision(tag),
        body,
      ),
    );
  }
  @Get(':id/history') async history(
    @CurrentActor() actor: RequestActor,
    @Param('id', ids) id: string,
    @Query(page) q: z.infer<typeof c.CursorQuerySchema>,
  ) {
    return this.service.history(
      await this.spaces.authorizePersonal(actor),
      id,
      q,
    );
  }

  @Post(':id/start') @HttpCode(200) async start(
    @CurrentActor() actor: RequestActor,
    @Param('id', ids) id: string,
    @Body(new ZodValidationPipe(c.FocusTransitionSchema)) _body: unknown,
    @Query(empty) _q: unknown,
    @Headers('if-match') tag: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.action(
        await this.spaces.authorizePersonal(actor),
        id,
        revision(tag),
        'START',
        key,
      ),
    );
  }

  @Post(':id/pause') @HttpCode(200) async pause(
    @CurrentActor() actor: RequestActor,
    @Param('id', ids) id: string,
    @Body(new ZodValidationPipe(c.FocusTransitionSchema)) _body: unknown,
    @Query(empty) _q: unknown,
    @Headers('if-match') tag: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.action(
        await this.spaces.authorizePersonal(actor),
        id,
        revision(tag),
        'PAUSE',
        key,
      ),
    );
  }

  @Post(':id/resume') @HttpCode(200) async resume(
    @CurrentActor() actor: RequestActor,
    @Param('id', ids) id: string,
    @Body(new ZodValidationPipe(c.FocusTransitionSchema)) _body: unknown,
    @Query(empty) _q: unknown,
    @Headers('if-match') tag: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.action(
        await this.spaces.authorizePersonal(actor),
        id,
        revision(tag),
        'RESUME',
        key,
      ),
    );
  }

  @Post(':id/finish') @HttpCode(200) async finish(
    @CurrentActor() actor: RequestActor,
    @Param('id', ids) id: string,
    @Body(new ZodValidationPipe(c.FocusTransitionSchema)) _body: unknown,
    @Query(empty) _q: unknown,
    @Headers('if-match') tag: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.action(
        await this.spaces.authorizePersonal(actor),
        id,
        revision(tag),
        'FINISH',
        key,
      ),
    );
  }

  @Post(':id/stop') @HttpCode(200) async stop(
    @CurrentActor() actor: RequestActor,
    @Param('id', ids) id: string,
    @Body(new ZodValidationPipe(c.FocusTransitionSchema)) _body: unknown,
    @Query(empty) _q: unknown,
    @Headers('if-match') tag: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.action(
        await this.spaces.authorizePersonal(actor),
        id,
        revision(tag),
        'STOP',
        key,
      ),
    );
  }
}
@Controller('time-entries')
@UseGuards(VerifiedSessionGuard)
export class TimeEntriesController {
  constructor(
    @Inject(FocusService) private readonly service: FocusService,
    @Inject(SpacesService) private readonly spaces: SpacesService,
  ) {}
  @Post() async create(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(c.TimeCreateSchema)) body: c.TimeCreate,
    @Query(empty) _q: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.createEntry(
        await this.spaces.authorizePersonal(actor),
        key,
        body,
      ),
    );
  }
  @Get() async list(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(c.TimeQuerySchema))
    q: z.infer<typeof c.TimeQuerySchema>,
  ) {
    return this.service.entries(await this.spaces.authorizePersonal(actor), q);
  }
  @Get(':id') async get(
    @CurrentActor() actor: RequestActor,
    @Param('id', ids) id: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.entry(await this.spaces.authorizePersonal(actor), id),
    );
  }
  @Patch(':id') async patch(
    @CurrentActor() actor: RequestActor,
    @Param('id', ids) id: string,
    @Body(new ZodValidationPipe(c.TimePatchSchema)) body: c.TimePatch,
    @Query(empty) _q: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.patchEntry(
        await this.spaces.authorizePersonal(actor),
        id,
        revision(tag),
        body,
      ),
    );
  }
  @Delete(':id') async remove(
    @CurrentActor() actor: RequestActor,
    @Param('id', ids) id: string,
    @Body(new ZodValidationPipe(c.EmptyQuerySchema.optional())) _body: unknown,
    @Query(empty) _q: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.patchEntry(
        await this.spaces.authorizePersonal(actor),
        id,
        revision(tag),
        { void: true },
      ),
    );
  }
  @Get(':id/history') async history(
    @CurrentActor() actor: RequestActor,
    @Param('id', ids) id: string,
    @Query(page) q: z.infer<typeof c.CursorQuerySchema>,
  ) {
    return this.service.entryHistory(
      await this.spaces.authorizePersonal(actor),
      id,
      q,
    );
  }
}
@Controller('productivity')
@UseGuards(VerifiedSessionGuard)
export class ProductivityController {
  constructor(
    @Inject(FocusService) private readonly service: FocusService,
    @Inject(SpacesService) private readonly spaces: SpacesService,
  ) {}
  @Get('summary') async summary(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(c.ProductivityQuerySchema))
    q: c.ProductivityQuery,
  ) {
    return this.service.summary(await this.spaces.authorizePersonal(actor), q);
  }
}
