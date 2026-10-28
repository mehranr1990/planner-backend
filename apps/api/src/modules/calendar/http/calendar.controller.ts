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
import * as c from '@mehran/api-contracts';
import { CalendarService } from '../application/calendar.service.js';
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
  idPipe = new ZodValidationPipe(c.TaskIdSchema);
function required(tag: string | undefined) {
  const revision = expectedRevision(tag);
  if (revision === undefined) throw new BadRequestException();
  return revision;
}
function versioned<T extends { revision: number }>(res: Response, value: T) {
  res.setHeader('ETag', revisionTag(value.revision));
  return value;
}
@Controller('calendar')
@UseGuards(VerifiedSessionGuard)
export class CalendarController {
  constructor(
    @Inject(CalendarService) private readonly service: CalendarService,
    @Inject(SpacesService) private readonly spaces: SpacesService,
  ) {}

  @Post('events')
  async createEvent(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(c.CalendarEventCreateSchema))
    body: c.CalendarEventCreate,
    @Query(empty) _query: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.createEvent(
        await this.spaces.authorizePersonal(actor),
        key,
        body,
      ),
    );
  }
  @Get('events')
  async listEvent(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(c.CursorQuerySchema))
    query: { limit?: string; cursor?: string },
  ) {
    return this.service.list(
      await this.spaces.authorizePersonal(actor),
      'EVENT',
      query,
    );
  }
  @Get('events/:id')
  async getEvent(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.event(await this.spaces.authorizePersonal(actor), id),
    );
  }
  @Patch('events/:id')
  async patchEvent(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.CalendarEventPatchSchema))
    body: c.CalendarEventPatch,
    @Query(empty) _query: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.patchEvent(
        await this.spaces.authorizePersonal(actor),
        id,
        required(tag),
        body,
      ),
    );
  }
  @Delete('events/:id')
  @HttpCode(204)
  async deleteEvent(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(noBody) _body: unknown,
    @Query(empty) _query: unknown,
    @Headers('if-match') tag: string | undefined,
  ) {
    await this.service.deleteEvent(
      await this.spaces.authorizePersonal(actor),
      id,
      required(tag),
    );
  }

  @Post('time-blocks')
  async createBlock(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(c.TimeBlockCreateSchema))
    body: c.TimeBlockCreate,
    @Query(empty) _query: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.createBlock(
        await this.spaces.authorizePersonal(actor),
        key,
        body,
      ),
    );
  }
  @Get('time-blocks')
  async listBlock(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(c.CursorQuerySchema))
    query: { limit?: string; cursor?: string },
  ) {
    return this.service.list(
      await this.spaces.authorizePersonal(actor),
      'BLOCK',
      query,
    );
  }
  @Get('time-blocks/:id')
  async getBlock(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.block(await this.spaces.authorizePersonal(actor), id),
    );
  }
  @Patch('time-blocks/:id')
  async patchBlock(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.TimeBlockPatchSchema)) body: c.TimeBlockPatch,
    @Query(empty) _query: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.patchBlock(
        await this.spaces.authorizePersonal(actor),
        id,
        required(tag),
        body,
      ),
    );
  }
  @Delete('time-blocks/:id')
  @HttpCode(204)
  async deleteBlock(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(noBody) _body: unknown,
    @Query(empty) _query: unknown,
    @Headers('if-match') tag: string | undefined,
  ) {
    await this.service.deleteBlock(
      await this.spaces.authorizePersonal(actor),
      id,
      required(tag),
    );
  }

  @Post('events/:id/series')
  @HttpCode(200)
  async series(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.CalendarSeriesEditSchema))
    body: c.CalendarSeriesEdit,
    @Query(empty) _query: unknown,
    @Headers('if-match') tag: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.service.editSeries(
      await this.spaces.authorizePersonal(actor),
      id,
      required(tag),
      key,
      body,
    );
    versioned(res, result.event);
    return result;
  }
  @Get('views')
  async view(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(c.CalendarRangeQuerySchema))
    query: c.CalendarRangeQuery,
  ) {
    return this.service.view(await this.spaces.authorizePersonal(actor), query);
  }
  @Get('conflicts')
  async conflicts(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(c.CalendarRangeQuerySchema))
    query: c.CalendarRangeQuery,
  ) {
    return this.service.conflicts(
      await this.spaces.authorizePersonal(actor),
      query,
    );
  }
}
