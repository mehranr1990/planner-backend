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
  Put,
  Query,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import * as c from '@mehran/api-contracts';
import { PlanningService } from '../application/planning.service.js';
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
  datePipe = new ZodValidationPipe(c.PlanningDateSchema),
  idPipe = new ZodValidationPipe(c.TaskIdSchema);
function required(header: string | undefined) {
  const value = expectedRevision(header);
  if (value === undefined) throw new BadRequestException();
  return value;
}
function versioned<T extends { revision: number }>(
  response: Response,
  value: T,
) {
  response.setHeader('ETag', revisionTag(value.revision));
  return value;
}
@Controller('planning')
@UseGuards(VerifiedSessionGuard)
export class PlanningController {
  constructor(
    @Inject(PlanningService) private readonly service: PlanningService,
    @Inject(SpacesService) private readonly spaces: SpacesService,
  ) {}
  @Post('days/:date')
  async createDay(
    @CurrentActor() actor: RequestActor,
    @Param('date', datePipe) date: string,
    @Body(noBody) _body: unknown,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    return versioned(
      response,
      await this.service.createDay(
        await this.spaces.authorizePersonal(actor),
        date,
      ),
    );
  }
  @Get('days/:date')
  async day(
    @CurrentActor() actor: RequestActor,
    @Param('date', datePipe) date: string,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    return versioned(
      response,
      await this.service.getDay(
        await this.spaces.authorizePersonal(actor),
        date,
      ),
    );
  }
  @Patch('days/:date')
  async reorder(
    @CurrentActor() actor: RequestActor,
    @Param('date', datePipe) date: string,
    @Body(new ZodValidationPipe(c.DayReorderSchema))
    body: { taskIds: string[] },
    @Query(empty) _query: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    return versioned(
      response,
      await this.service.reorder(
        await this.spaces.authorizePersonal(actor),
        date,
        required(tag),
        body.taskIds,
      ),
    );
  }
  @Put('days/:date/items/:taskId')
  async select(
    @CurrentActor() actor: RequestActor,
    @Param('date', datePipe) date: string,
    @Param('taskId', idPipe) taskId: string,
    @Body(new ZodValidationPipe(c.SelectionPutSchema)) body: c.SelectionPut,
    @Query(empty) _query: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    return versioned(
      response,
      await this.service.select(
        await this.spaces.authorizePersonal(actor),
        date,
        taskId,
        required(tag),
        body,
      ),
    );
  }
  @Delete('days/:date/items/:taskId')
  @HttpCode(200)
  async remove(
    @CurrentActor() actor: RequestActor,
    @Param('date', datePipe) date: string,
    @Param('taskId', idPipe) taskId: string,
    @Body(noBody) _body: unknown,
    @Query(empty) _query: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    return versioned(
      response,
      await this.service.remove(
        await this.spaces.authorizePersonal(actor),
        date,
        taskId,
        required(tag),
      ),
    );
  }
  @Post('days/:date/items/:taskId/move')
  @HttpCode(200)
  async move(
    @CurrentActor() actor: RequestActor,
    @Param('date', datePipe) date: string,
    @Param('taskId', idPipe) taskId: string,
    @Body(new ZodValidationPipe(c.SelectionMoveSchema)) body: c.SelectionMove,
    @Query(empty) _query: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.service.move(
      await this.spaces.authorizePersonal(actor),
      date,
      taskId,
      required(tag),
      body,
    );
    versioned(response, result.source);
    return result;
  }
  @Post('weeks/:date')
  async createWeek(
    @CurrentActor() actor: RequestActor,
    @Param('date', datePipe) date: string,
    @Body(noBody) _body: unknown,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    return versioned(
      response,
      await this.service.createWeek(
        await this.spaces.authorizePersonal(actor),
        date,
      ),
    );
  }
  @Get('weeks/:date')
  async week(
    @CurrentActor() actor: RequestActor,
    @Param('date', datePipe) date: string,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    return versioned(
      response,
      await this.service.getWeek(
        await this.spaces.authorizePersonal(actor),
        date,
      ),
    );
  }
  @Get('capacity/availability')
  async availability(
    @CurrentActor() actor: RequestActor,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    return versioned(
      response,
      await this.service.availability(
        await this.spaces.authorizePersonal(actor),
      ),
    );
  }
  @Put('capacity/availability')
  async setAvailability(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(c.AvailabilityPutSchema))
    body: { availability: c.Availability | null },
    @Query(empty) _query: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    return versioned(
      response,
      await this.service.setAvailability(
        await this.spaces.authorizePersonal(actor),
        required(tag),
        body.availability,
      ),
    );
  }
  @Get('capacity')
  async capacity(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(c.CapacityQuerySchema)) query: c.CapacityQuery,
  ) {
    return this.service.capacity(
      await this.spaces.authorizePersonal(actor),
      query,
    );
  }
  @Post('reviews')
  async createReview(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(c.PlanningReviewCreateSchema))
    body: c.ReviewCreate,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    return versioned(
      response,
      await this.service.createReview(
        await this.spaces.authorizePersonal(actor),
        body,
      ),
    );
  }
  @Get('reviews')
  async reviews(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(c.PlanningReviewQuerySchema))
    query: c.ReviewQuery,
  ) {
    return this.service.reviews(
      await this.spaces.authorizePersonal(actor),
      query,
    );
  }
  @Get('reviews/:id')
  async review(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    return versioned(
      response,
      await this.service.review(await this.spaces.authorizePersonal(actor), id),
    );
  }
  @Patch('reviews/:id')
  async patchReview(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.PlanningReviewPatchSchema))
    body: { reflection: string },
    @Query(empty) _query: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    return versioned(
      response,
      await this.service.patchReview(
        await this.spaces.authorizePersonal(actor),
        id,
        required(tag),
        body.reflection,
      ),
    );
  }
  @Delete('reviews/:id')
  @HttpCode(204)
  async deleteReview(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(noBody) _body: unknown,
    @Query(empty) _query: unknown,
    @Headers('if-match') tag: string | undefined,
  ) {
    await this.service.deleteReview(
      await this.spaces.authorizePersonal(actor),
      id,
      required(tag),
    );
  }
  @Post('rollover/preview')
  @HttpCode(200)
  async preview(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(c.RolloverPreviewRequestSchema))
    body: { fromDate: string; toDate: string },
    @Query(empty) _query: unknown,
  ) {
    return this.service.preview(
      await this.spaces.authorizePersonal(actor),
      body.fromDate,
      body.toDate,
    );
  }
  @Post('rollover/commit')
  @HttpCode(200)
  async commit(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(c.RolloverCommitSchema)) body: c.RolloverCommit,
    @Query(empty) _query: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return this.service.commit(
      await this.spaces.authorizePersonal(actor),
      key,
      body,
    );
  }
}
