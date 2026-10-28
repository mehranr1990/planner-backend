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
import { z } from 'zod';
import * as c from '@mehran/api-contracts';
import { TaskToolsService } from '../application/task-tools.service.js';
import { RecurrenceService } from '../application/recurrence.service.js';
import { VerifiedSessionGuard } from '../../../platform/auth/session.guard.js';
import { CurrentActor } from '../../../platform/auth/request-actor.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { SpacesService } from '../../spaces/public/index.js';
import { ZodValidationPipe } from '../../../bootstrap/zod-validation.pipe.js';
import {
  expectedRevision,
  revisionTag,
} from '../../../bootstrap/concurrency.js';

const pipe = (schema: z.ZodType) => new ZodValidationPipe(schema);
const empty = pipe(c.EmptyQuerySchema),
  page = pipe(c.CursorQuerySchema),
  idPipe = pipe(c.TaskIdSchema),
  noBody = pipe(c.EmptyQuerySchema.optional());
function required(header: string | undefined) {
  const value = expectedRevision(header);
  if (value === undefined) throw new BadRequestException();
  return value;
}
function versioned<T extends { revision: number }>(res: Response, value: T) {
  res.setHeader('ETag', revisionTag(value.revision));
  return value;
}

@Controller()
@UseGuards(VerifiedSessionGuard)
export class TaskToolsController {
  constructor(
    @Inject(TaskToolsService) private readonly service: TaskToolsService,
    @Inject(SpacesService) private readonly spaces: SpacesService,
  ) {}
  @Post('tasks/bulk')
  @HttpCode(200)
  async bulk(
    @CurrentActor() actor: RequestActor,
    @Body(pipe(c.BulkTaskRequestSchema)) body: c.BulkTaskRequest,
    @Query(empty) _query: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return this.service.bulk(
      await this.spaces.authorizePersonal(actor),
      body,
      key,
    );
  }
  @Post('task-templates')
  async createTemplate(
    @CurrentActor() actor: RequestActor,
    @Body(pipe(c.TaskTemplateCreateSchema)) body: c.TaskTemplateCreate,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.createTemplate(
        await this.spaces.authorizePersonal(actor),
        body,
      ),
    );
  }
  @Get('task-templates')
  async templates(
    @CurrentActor() actor: RequestActor,
    @Query(page) query: c.TaskCursorQuery,
  ) {
    return this.service.templates(
      await this.spaces.authorizePersonal(actor),
      query,
    );
  }
  @Get('task-templates/:id')
  async template(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.template(
        await this.spaces.authorizePersonal(actor),
        id,
      ),
    );
  }
  @Patch('task-templates/:id')
  async patchTemplate(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(pipe(c.TaskTemplatePatchSchema)) body: c.TaskTemplatePatch,
    @Query(empty) _query: unknown,
    @Headers('if-match') header: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.patchTemplate(
        await this.spaces.authorizePersonal(actor),
        id,
        required(header),
        body,
      ),
    );
  }
  @Delete('task-templates/:id')
  @HttpCode(204)
  async deleteTemplate(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(noBody) _body: unknown,
    @Query(empty) _query: unknown,
    @Headers('if-match') header: string | undefined,
  ) {
    await this.service.deleteTemplate(
      await this.spaces.authorizePersonal(actor),
      id,
      required(header),
    );
  }
  @Post('task-templates/:id/apply')
  async applyTemplate(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(pipe(c.TaskTemplateApplySchema)) body: c.TaskTemplateApply,
    @Query(empty) _query: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.applyTemplate(
        await this.spaces.authorizePersonal(actor),
        id,
        body,
        key,
      ),
    );
  }
  @Post('saved-task-filters')
  async createFilter(
    @CurrentActor() actor: RequestActor,
    @Body(pipe(c.SavedTaskFilterCreateSchema)) body: c.SavedTaskFilterCreate,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.createFilter(
        await this.spaces.authorizePersonal(actor),
        body,
      ),
    );
  }
  @Get('saved-task-filters')
  async filters(
    @CurrentActor() actor: RequestActor,
    @Query(page) query: c.TaskCursorQuery,
  ) {
    return this.service.filters(
      await this.spaces.authorizePersonal(actor),
      query,
    );
  }
  @Get('saved-task-filters/:id')
  async filter(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.filter(await this.spaces.authorizePersonal(actor), id),
    );
  }
  @Patch('saved-task-filters/:id')
  async patchFilter(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(pipe(c.SavedTaskFilterPatchSchema)) body: c.SavedTaskFilterPatch,
    @Query(empty) _query: unknown,
    @Headers('if-match') header: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.patchFilter(
        await this.spaces.authorizePersonal(actor),
        id,
        required(header),
        body,
      ),
    );
  }
  @Delete('saved-task-filters/:id')
  @HttpCode(204)
  async deleteFilter(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(noBody) _body: unknown,
    @Query(empty) _query: unknown,
    @Headers('if-match') header: string | undefined,
  ) {
    await this.service.deleteFilter(
      await this.spaces.authorizePersonal(actor),
      id,
      required(header),
    );
  }
  @Get('saved-task-filters/:id/tasks')
  async filterTasks(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(page) query: c.TaskCursorQuery,
  ) {
    return this.service.filterTasks(
      await this.spaces.authorizePersonal(actor),
      id,
      query,
    );
  }
}

@Controller()
@UseGuards(VerifiedSessionGuard)
export class RecurrenceController {
  constructor(
    @Inject(RecurrenceService) private readonly service: RecurrenceService,
    @Inject(SpacesService) private readonly spaces: SpacesService,
  ) {}
  @Post('task-recurrences')
  async create(
    @CurrentActor() actor: RequestActor,
    @Body(pipe(c.TaskRecurrenceCreateSchema)) body: c.RecurrenceCreate,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.create(
        await this.spaces.authorizePersonal(actor),
        body,
      ),
    );
  }
  @Get('task-recurrences')
  async list(
    @CurrentActor() actor: RequestActor,
    @Query(page) query: c.TaskCursorQuery,
  ) {
    return this.service.list(await this.spaces.authorizePersonal(actor), query);
  }
  @Get('task-recurrences/:id')
  async get(
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
  @Patch('task-recurrences/:id')
  async edit(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(pipe(c.RecurrenceEditSchema)) body: c.RecurrenceEdit,
    @Query(empty) _query: unknown,
    @Headers('if-match') header: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.service.edit(
      await this.spaces.authorizePersonal(actor),
      id,
      required(header),
      body,
    );
    versioned(res, result.series);
    return result;
  }
  @Delete('task-recurrences/:id')
  @HttpCode(200)
  async cancel(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(noBody) _body: unknown,
    @Query(empty) _query: unknown,
    @Headers('if-match') header: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.cancel(
        await this.spaces.authorizePersonal(actor),
        id,
        required(header),
      ),
    );
  }
  @Post('task-recurrences/:id/catch-up')
  @HttpCode(200)
  async catchUp(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(pipe(c.CatchUpSchema)) body: c.CatchUp,
    @Query(empty) _query: unknown,
  ) {
    return this.service.catchUp(
      await this.spaces.authorizePersonal(actor),
      id,
      body,
    );
  }
  @Get('task-recurrences/:id/occurrences')
  async occurrences(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(page) query: c.TaskCursorQuery,
  ) {
    return this.service.occurrences(
      await this.spaces.authorizePersonal(actor),
      id,
      query,
    );
  }
  @Get('task-occurrences/:id')
  async occurrence(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(empty) _query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.occurrence(
        await this.spaces.authorizePersonal(actor),
        id,
      ),
    );
  }
  @Post('task-occurrences/:id/:action')
  @HttpCode(200)
  async action(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Param('action', pipe(z.enum(['complete', 'skip', 'cancel'])))
    action: 'complete' | 'skip' | 'cancel',
    @Body(pipe(c.OccurrenceActionSchema))
    body: z.infer<typeof c.OccurrenceActionSchema>,
    @Query(empty) _query: unknown,
    @Headers('if-match') header: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.action(
        await this.spaces.authorizePersonal(actor),
        id,
        required(header),
        action,
        body.taskRevision,
      ),
    );
  }
}
