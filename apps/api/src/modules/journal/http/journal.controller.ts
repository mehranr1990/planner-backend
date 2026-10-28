import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
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
  page = new ZodValidationPipe(c.CursorQuerySchema),
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
import { JournalService } from '../application/journal.service.js';

@Controller('journal/entries')
@UseGuards(VerifiedSessionGuard)
export class JournalEntriesController {
  constructor(
    @Inject(JournalService) private readonly service: JournalService,
    @Inject(SpacesService) private readonly spaces: SpacesService,
  ) {}
  @Post() async create(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(c.JournalCreateSchema)) body: c.JournalCreate,
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
    @Query(new ZodValidationPipe(c.JournalQuerySchema))
    q: z.infer<typeof c.JournalQuerySchema>,
  ) {
    return this.service.list(await this.spaces.authorizePersonal(actor), q);
  }
  @Get(':id') async get(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(new ZodValidationPipe(c.NoteReadQuerySchema))
    q: z.infer<typeof c.NoteReadQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.get(
        await this.spaces.authorizePersonal(actor),
        id,
        q.includeDeleted === 'true',
      ),
    );
  }
  @Patch(':id') async patch(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.JournalPatchSchema)) body: c.JournalPatch,
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
  @Delete(':id') async remove(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.EmptyQuerySchema.optional())) _body: unknown,
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
        { deleted: true },
      ),
    );
  }
  @Get(':id/history') async history(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(page) q: z.infer<typeof c.CursorQuerySchema>,
  ) {
    return this.service.history(
      await this.spaces.authorizePersonal(actor),
      id,
      q,
    );
  }
}
@Controller('journal/daily-checkins')
@UseGuards(VerifiedSessionGuard)
export class DailyCheckinsController {
  constructor(
    @Inject(JournalService) private readonly service: JournalService,
    @Inject(SpacesService) private readonly spaces: SpacesService,
  ) {}
  @Post() async create(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(c.DailyCheckinCreateSchema))
    body: c.DailyCheckinCreate,
    @Query(empty) _q: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.checkin(
        await this.spaces.authorizePersonal(actor),
        key,
        body,
      ),
    );
  }
  @Get() async list(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(c.CheckinQuerySchema))
    q: z.infer<typeof c.CheckinQuerySchema>,
  ) {
    return this.service.list(await this.spaces.authorizePersonal(actor), {
      ...q,
      kind: 'CHECK_IN',
    });
  }
  @Get(':date') async get(
    @CurrentActor() actor: RequestActor,
    @Param('date', new ZodValidationPipe(c.PlanningDateSchema)) date: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.getCheckin(
        await this.spaces.authorizePersonal(actor),
        date,
      ),
    );
  }
}
@Controller('moods')
@UseGuards(VerifiedSessionGuard)
export class MoodsController {
  constructor(
    @Inject(JournalService) private readonly service: JournalService,
    @Inject(SpacesService) private readonly spaces: SpacesService,
  ) {}
  @Post() async create(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(c.MoodCreateSchema)) body: c.MoodCreate,
    @Query(empty) _q: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.createMood(
        await this.spaces.authorizePersonal(actor),
        key,
        body,
      ),
    );
  }
  @Get() async list(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(c.MoodQuerySchema))
    q: z.infer<typeof c.MoodQuerySchema>,
  ) {
    return this.service.moods(await this.spaces.authorizePersonal(actor), q);
  }
  @Get(':id') async get(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.mood(await this.spaces.authorizePersonal(actor), id),
    );
  }
  @Patch(':id') async patch(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.MoodPatchSchema)) body: c.MoodPatch,
    @Query(empty) _q: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.patchMood(
        await this.spaces.authorizePersonal(actor),
        id,
        required(tag),
        body,
      ),
    );
  }
  @Delete(':id') async remove(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.EmptyQuerySchema.optional())) _body: unknown,
    @Query(empty) _q: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.patchMood(
        await this.spaces.authorizePersonal(actor),
        id,
        required(tag),
        { void: true },
      ),
    );
  }
  @Get(':id/history') async history(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(page) q: z.infer<typeof c.CursorQuerySchema>,
  ) {
    return this.service.moodHistory(
      await this.spaces.authorizePersonal(actor),
      id,
      q,
    );
  }
}
