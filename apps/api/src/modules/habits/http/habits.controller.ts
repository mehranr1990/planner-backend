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
import * as c from '@mehran/api-contracts';
import { HabitsService } from '../application/habits.service.js';
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
  noBody = new ZodValidationPipe(c.EmptyQuerySchema.optional()),
  idPipe = new ZodValidationPipe(c.TaskIdSchema),
  page = new ZodValidationPipe(c.CursorQuerySchema);
function required(tag: string | undefined) {
  const r = expectedRevision(tag);
  if (r === undefined) throw new BadRequestException();
  return r;
}
function versioned<T extends { revision: number }>(res: Response, value: T) {
  res.setHeader('ETag', revisionTag(value.revision));
  return value;
}
@Controller('habits')
@UseGuards(VerifiedSessionGuard)
export class HabitsController {
  constructor(
    @Inject(HabitsService) private readonly service: HabitsService,
    @Inject(SpacesService) private readonly spaces: SpacesService,
  ) {}
  @Post() async create(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(c.HabitCreateSchema)) body: c.HabitCreate,
    @Query(empty) _query: unknown,
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
    @Query(page) query: { limit?: string; cursor?: string },
  ) {
    return this.service.list(await this.spaces.authorizePersonal(actor), query);
  }
  @Get('water-summary') async water(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(c.WaterSummaryQuerySchema))
    query: c.WaterSummaryQuery,
  ) {
    return this.service.water(
      await this.spaces.authorizePersonal(actor),
      query,
    );
  }
  @Get(':id') async get(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(empty) _query: unknown,
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
    @Body(new ZodValidationPipe(c.HabitPatchSchema)) body: c.HabitPatch,
    @Query(empty) _query: unknown,
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
  @Delete(':id') async archive(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(noBody) _body: unknown,
    @Query(empty) _query: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.patch(
        await this.spaces.authorizePersonal(actor),
        id,
        required(tag),
        { status: 'ARCHIVED' },
      ),
    );
  }
  @Get(':id/schedules') async schedules(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(page) query: { limit?: string; cursor?: string },
  ) {
    return this.service.schedules(
      await this.spaces.authorizePersonal(actor),
      id,
      query,
    );
  }
  @Get(':id/stats') async stats(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(new ZodValidationPipe(c.HabitStatsQuerySchema))
    query: c.HabitStatsQuery,
  ) {
    return this.service.stats(
      await this.spaces.authorizePersonal(actor),
      id,
      query,
    );
  }
  @Post(':id/entries') async record(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.HabitEntryCreateSchema))
    body: c.HabitEntryCreate,
    @Query(empty) _query: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.record(
        await this.spaces.authorizePersonal(actor),
        id,
        key,
        body,
      ),
    );
  }
  @Get(':id/entries') async entries(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(new ZodValidationPipe(c.HabitEntriesQuerySchema))
    query: c.HabitEntriesQuery,
  ) {
    return this.service.entries(
      await this.spaces.authorizePersonal(actor),
      id,
      query,
    );
  }
  @Get(':id/entries/:entryId') async entry(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Param('entryId', idPipe) entryId: string,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.entry(
        await this.spaces.authorizePersonal(actor),
        id,
        entryId,
      ),
    );
  }
  @Patch(':id/entries/:entryId') async correct(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Param('entryId', idPipe) entryId: string,
    @Body(new ZodValidationPipe(c.HabitEntryPatchSchema))
    body: c.HabitEntryPatch,
    @Query(empty) _query: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.correct(
        await this.spaces.authorizePersonal(actor),
        id,
        entryId,
        required(tag),
        body,
      ),
    );
  }
  @Get(':id/entries/:entryId/history') async history(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Param('entryId', idPipe) entryId: string,
    @Query(page) query: { limit?: string; cursor?: string },
  ) {
    return this.service.history(
      await this.spaces.authorizePersonal(actor),
      id,
      entryId,
      query,
    );
  }
}
@Controller('routines')
@UseGuards(VerifiedSessionGuard)
export class RoutinesController {
  constructor(
    @Inject(HabitsService) private readonly service: HabitsService,
    @Inject(SpacesService) private readonly spaces: SpacesService,
  ) {}
  @Post() async create(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(c.RoutineCreateSchema)) body: c.RoutineCreate,
    @Query(empty) _query: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.createRoutine(
        await this.spaces.authorizePersonal(actor),
        key,
        body,
      ),
    );
  }
  @Get() async list(
    @CurrentActor() actor: RequestActor,
    @Query(page) query: { limit?: string; cursor?: string },
  ) {
    return this.service.routines(
      await this.spaces.authorizePersonal(actor),
      query,
    );
  }
  @Get(':id') async get(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.routine(
        await this.spaces.authorizePersonal(actor),
        id,
      ),
    );
  }
  @Patch(':id') async patch(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.RoutinePatchSchema)) body: c.RoutinePatch,
    @Query(empty) _query: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.patchRoutine(
        await this.spaces.authorizePersonal(actor),
        id,
        required(tag),
        body,
      ),
    );
  }
  @Delete(':id') async archive(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(noBody) _body: unknown,
    @Query(empty) _query: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.patchRoutine(
        await this.spaces.authorizePersonal(actor),
        id,
        required(tag),
        { status: 'ARCHIVED' },
      ),
    );
  }
}
