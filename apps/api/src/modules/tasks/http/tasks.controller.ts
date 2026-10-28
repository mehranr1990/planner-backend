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
import {
  TaskIdSchema,
  TaskCreateSchema,
  TaskPatchSchema,
  TaskReadQuerySchema,
  TaskListQuerySchema,
  SubtaskCreateSchema,
  SubtaskQuerySchema,
  ChecklistCreateSchema,
  ChecklistPatchSchema,
  ChecklistMutationSchema,
  LabelCreateSchema,
  LabelPatchSchema,
  CursorQuerySchema,
  EmptyQuerySchema,
} from '@mehran/api-contracts';
import type {
  TaskCreate,
  TaskPatch,
  TaskListQuery,
  TaskSubtaskQuery,
  TaskCursorQuery,
  ChecklistCreate,
  ChecklistPatch,
} from '@mehran/api-contracts';
import { TasksService } from '../application/tasks.service.js';
import { VerifiedSessionGuard } from '../../../platform/auth/session.guard.js';
import { CurrentActor } from '../../../platform/auth/request-actor.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { SpacesService } from '../../spaces/public/index.js';
import { ZodValidationPipe } from '../../../bootstrap/zod-validation.pipe.js';
import {
  expectedRevision,
  revisionTag,
} from '../../../bootstrap/concurrency.js';

const noBody = EmptyQuerySchema.optional();
function requiredRevision(header: string | undefined): number {
  const revision = expectedRevision(header);
  if (revision === undefined) throw new BadRequestException();
  return revision;
}
function versioned<T extends { revision: number }>(
  response: Response,
  value: T,
): T {
  response.setHeader('ETag', revisionTag(value.revision));
  return value;
}

@Controller('tasks')
@UseGuards(VerifiedSessionGuard)
export class TasksController {
  constructor(
    @Inject(TasksService) private readonly tasks: TasksService,
    @Inject(SpacesService) private readonly spaces: SpacesService,
  ) {}
  @Post()
  async create(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(TaskCreateSchema)) body: TaskCreate,
    @Query(new ZodValidationPipe(EmptyQuerySchema)) _query: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    return versioned(
      response,
      await this.tasks.create(
        await this.spaces.authorizePersonal(actor),
        body,
        key,
      ),
    );
  }
  @Get()
  async list(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(TaskListQuerySchema)) query: TaskListQuery,
  ) {
    return this.tasks.list(await this.spaces.authorizePersonal(actor), query);
  }
  @Get(':id')
  async get(
    @CurrentActor() actor: RequestActor,
    @Param('id', new ZodValidationPipe(TaskIdSchema)) id: string,
    @Query(new ZodValidationPipe(TaskReadQuerySchema))
    query: { includeDeleted?: 'true' | 'false' },
    @Res({ passthrough: true }) response: Response,
  ) {
    return versioned(
      response,
      await this.tasks.get(
        await this.spaces.authorizePersonal(actor),
        id,
        query.includeDeleted === 'true',
      ),
    );
  }
  @Patch(':id')
  async patch(
    @CurrentActor() actor: RequestActor,
    @Param('id', new ZodValidationPipe(TaskIdSchema)) id: string,
    @Body(new ZodValidationPipe(TaskPatchSchema)) body: TaskPatch,
    @Query(new ZodValidationPipe(EmptyQuerySchema)) _query: unknown,
    @Headers('if-match') header: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    return versioned(
      response,
      await this.tasks.patch(
        await this.spaces.authorizePersonal(actor),
        id,
        requiredRevision(header),
        body,
      ),
    );
  }
  @Delete(':id')
  async delete(
    @CurrentActor() actor: RequestActor,
    @Param('id', new ZodValidationPipe(TaskIdSchema)) id: string,
    @Body(new ZodValidationPipe(noBody)) _body: unknown,
    @Query(new ZodValidationPipe(EmptyQuerySchema)) _query: unknown,
    @Headers('if-match') header: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    return versioned(
      response,
      await this.tasks.delete(
        await this.spaces.authorizePersonal(actor),
        id,
        requiredRevision(header),
      ),
    );
  }
  @Post(':id/restore')
  @HttpCode(200)
  async restore(
    @CurrentActor() actor: RequestActor,
    @Param('id', new ZodValidationPipe(TaskIdSchema)) id: string,
    @Body(new ZodValidationPipe(noBody)) _body: unknown,
    @Query(new ZodValidationPipe(EmptyQuerySchema)) _query: unknown,
    @Headers('if-match') header: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    return versioned(
      response,
      await this.tasks.restore(
        await this.spaces.authorizePersonal(actor),
        id,
        requiredRevision(header),
      ),
    );
  }
  @Post(':id/complete')
  @HttpCode(200)
  async complete(
    @CurrentActor() actor: RequestActor,
    @Param('id', new ZodValidationPipe(TaskIdSchema)) id: string,
    @Body(new ZodValidationPipe(noBody)) _body: unknown,
    @Query(new ZodValidationPipe(EmptyQuerySchema)) _query: unknown,
    @Headers('if-match') header: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    return versioned(
      response,
      await this.tasks.changeStatus(
        await this.spaces.authorizePersonal(actor),
        id,
        requiredRevision(header),
        'complete',
      ),
    );
  }
  @Post(':id/reopen')
  @HttpCode(200)
  async reopen(
    @CurrentActor() actor: RequestActor,
    @Param('id', new ZodValidationPipe(TaskIdSchema)) id: string,
    @Body(new ZodValidationPipe(noBody)) _body: unknown,
    @Query(new ZodValidationPipe(EmptyQuerySchema)) _query: unknown,
    @Headers('if-match') header: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    return versioned(
      response,
      await this.tasks.changeStatus(
        await this.spaces.authorizePersonal(actor),
        id,
        requiredRevision(header),
        'reopen',
      ),
    );
  }
  @Post(':id/subtasks')
  async createSubtask(
    @CurrentActor() actor: RequestActor,
    @Param('id', new ZodValidationPipe(TaskIdSchema)) id: string,
    @Body(new ZodValidationPipe(SubtaskCreateSchema)) body: TaskCreate,
    @Query(new ZodValidationPipe(EmptyQuerySchema)) _query: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    return versioned(
      response,
      await this.tasks.create(
        await this.spaces.authorizePersonal(actor),
        { ...body, parentTaskId: id },
        key,
      ),
    );
  }
  @Get(':id/subtasks')
  async subtasks(
    @CurrentActor() actor: RequestActor,
    @Param('id', new ZodValidationPipe(TaskIdSchema)) id: string,
    @Query(new ZodValidationPipe(SubtaskQuerySchema)) query: TaskSubtaskQuery,
  ) {
    return this.tasks.subtasks(
      await this.spaces.authorizePersonal(actor),
      id,
      query,
    );
  }
  @Get(':id/checklist-items')
  async checklist(
    @CurrentActor() actor: RequestActor,
    @Param('id', new ZodValidationPipe(TaskIdSchema)) id: string,
    @Query(new ZodValidationPipe(CursorQuerySchema)) query: TaskCursorQuery,
  ) {
    return this.tasks.checklist(
      await this.spaces.authorizePersonal(actor),
      id,
      query,
    );
  }
  @Post(':id/checklist-items')
  async addChecklist(
    @CurrentActor() actor: RequestActor,
    @Param('id', new ZodValidationPipe(TaskIdSchema)) id: string,
    @Body(new ZodValidationPipe(ChecklistCreateSchema)) body: ChecklistCreate,
    @Query(new ZodValidationPipe(EmptyQuerySchema)) _query: unknown,
    @Headers('if-match') header: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const value = await this.tasks.addChecklist(
      await this.spaces.authorizePersonal(actor),
      id,
      requiredRevision(header),
      body,
    );
    versioned(response, value.task);
    return ChecklistMutationSchema.parse(value);
  }
  @Patch(':id/checklist-items/:itemId')
  async patchChecklist(
    @CurrentActor() actor: RequestActor,
    @Param('id', new ZodValidationPipe(TaskIdSchema)) id: string,
    @Param('itemId', new ZodValidationPipe(TaskIdSchema)) itemId: string,
    @Body(new ZodValidationPipe(ChecklistPatchSchema)) body: ChecklistPatch,
    @Query(new ZodValidationPipe(EmptyQuerySchema)) _query: unknown,
    @Headers('if-match') header: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const value = await this.tasks.patchChecklist(
      await this.spaces.authorizePersonal(actor),
      id,
      itemId,
      requiredRevision(header),
      body,
    );
    versioned(response, value.task);
    return ChecklistMutationSchema.parse(value);
  }
  @Delete(':id/checklist-items/:itemId')
  async deleteChecklist(
    @CurrentActor() actor: RequestActor,
    @Param('id', new ZodValidationPipe(TaskIdSchema)) id: string,
    @Param('itemId', new ZodValidationPipe(TaskIdSchema)) itemId: string,
    @Body(new ZodValidationPipe(noBody)) _body: unknown,
    @Query(new ZodValidationPipe(EmptyQuerySchema)) _query: unknown,
    @Headers('if-match') header: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    return versioned(
      response,
      await this.tasks.deleteChecklist(
        await this.spaces.authorizePersonal(actor),
        id,
        itemId,
        requiredRevision(header),
      ),
    );
  }
  @Get(':id/labels')
  async labels(
    @CurrentActor() actor: RequestActor,
    @Param('id', new ZodValidationPipe(TaskIdSchema)) id: string,
    @Query(new ZodValidationPipe(CursorQuerySchema)) query: TaskCursorQuery,
  ) {
    return this.tasks.labels(
      await this.spaces.authorizePersonal(actor),
      query,
      id,
    );
  }
  @Put(':id/labels/:labelId')
  async bindLabel(
    @CurrentActor() actor: RequestActor,
    @Param('id', new ZodValidationPipe(TaskIdSchema)) id: string,
    @Param('labelId', new ZodValidationPipe(TaskIdSchema)) labelId: string,
    @Body(new ZodValidationPipe(noBody)) _body: unknown,
    @Query(new ZodValidationPipe(EmptyQuerySchema)) _query: unknown,
    @Headers('if-match') header: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    return versioned(
      response,
      await this.tasks.setLabel(
        await this.spaces.authorizePersonal(actor),
        id,
        labelId,
        requiredRevision(header),
        true,
      ),
    );
  }
  @Delete(':id/labels/:labelId')
  async unbindLabel(
    @CurrentActor() actor: RequestActor,
    @Param('id', new ZodValidationPipe(TaskIdSchema)) id: string,
    @Param('labelId', new ZodValidationPipe(TaskIdSchema)) labelId: string,
    @Body(new ZodValidationPipe(noBody)) _body: unknown,
    @Query(new ZodValidationPipe(EmptyQuerySchema)) _query: unknown,
    @Headers('if-match') header: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    return versioned(
      response,
      await this.tasks.setLabel(
        await this.spaces.authorizePersonal(actor),
        id,
        labelId,
        requiredRevision(header),
        false,
      ),
    );
  }
  @Get(':id/attachments')
  async attachments(
    @CurrentActor() actor: RequestActor,
    @Param('id', new ZodValidationPipe(TaskIdSchema)) id: string,
    @Query(new ZodValidationPipe(CursorQuerySchema)) query: TaskCursorQuery,
  ) {
    return this.tasks.attachments(
      await this.spaces.authorizePersonal(actor),
      id,
      query,
    );
  }
  @Put(':id/attachments/:fileId')
  async bindAttachment(
    @CurrentActor() actor: RequestActor,
    @Param('id', new ZodValidationPipe(TaskIdSchema)) id: string,
    @Param('fileId', new ZodValidationPipe(TaskIdSchema)) fileId: string,
    @Body(new ZodValidationPipe(noBody)) _body: unknown,
    @Query(new ZodValidationPipe(EmptyQuerySchema)) _query: unknown,
    @Headers('if-match') header: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    return versioned(
      response,
      await this.tasks.setAttachment(
        await this.spaces.authorizePersonal(actor),
        id,
        fileId,
        requiredRevision(header),
        true,
      ),
    );
  }
  @Delete(':id/attachments/:fileId')
  async unbindAttachment(
    @CurrentActor() actor: RequestActor,
    @Param('id', new ZodValidationPipe(TaskIdSchema)) id: string,
    @Param('fileId', new ZodValidationPipe(TaskIdSchema)) fileId: string,
    @Body(new ZodValidationPipe(noBody)) _body: unknown,
    @Query(new ZodValidationPipe(EmptyQuerySchema)) _query: unknown,
    @Headers('if-match') header: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    return versioned(
      response,
      await this.tasks.setAttachment(
        await this.spaces.authorizePersonal(actor),
        id,
        fileId,
        requiredRevision(header),
        false,
      ),
    );
  }
  @Get(':id/history')
  async history(
    @CurrentActor() actor: RequestActor,
    @Param('id', new ZodValidationPipe(TaskIdSchema)) id: string,
    @Query(new ZodValidationPipe(CursorQuerySchema)) query: TaskCursorQuery,
  ) {
    return this.tasks.history(
      await this.spaces.authorizePersonal(actor),
      id,
      query,
    );
  }
}

@Controller('labels')
@UseGuards(VerifiedSessionGuard)
export class LabelsController {
  constructor(
    @Inject(TasksService) private readonly tasks: TasksService,
    @Inject(SpacesService) private readonly spaces: SpacesService,
  ) {}
  @Post()
  async create(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(LabelCreateSchema)) body: { name: string },
    @Query(new ZodValidationPipe(EmptyQuerySchema)) _query: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    return versioned(
      response,
      await this.tasks.createLabel(
        await this.spaces.authorizePersonal(actor),
        body.name,
      ),
    );
  }
  @Get()
  async list(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(CursorQuerySchema)) query: TaskCursorQuery,
  ) {
    return this.tasks.labels(await this.spaces.authorizePersonal(actor), query);
  }
  @Get(':id')
  async get(
    @CurrentActor() actor: RequestActor,
    @Param('id', new ZodValidationPipe(TaskIdSchema)) id: string,
    @Query(new ZodValidationPipe(EmptyQuerySchema)) _query: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    return versioned(
      response,
      await this.tasks.label(await this.spaces.authorizePersonal(actor), id),
    );
  }
  @Patch(':id')
  async patch(
    @CurrentActor() actor: RequestActor,
    @Param('id', new ZodValidationPipe(TaskIdSchema)) id: string,
    @Body(new ZodValidationPipe(LabelPatchSchema)) body: { name: string },
    @Query(new ZodValidationPipe(EmptyQuerySchema)) _query: unknown,
    @Headers('if-match') header: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    return versioned(
      response,
      await this.tasks.patchLabel(
        await this.spaces.authorizePersonal(actor),
        id,
        requiredRevision(header),
        body.name,
      ),
    );
  }
  @Delete(':id')
  @HttpCode(204)
  async delete(
    @CurrentActor() actor: RequestActor,
    @Param('id', new ZodValidationPipe(TaskIdSchema)) id: string,
    @Body(new ZodValidationPipe(noBody)) _body: unknown,
    @Query(new ZodValidationPipe(EmptyQuerySchema)) _query: unknown,
    @Headers('if-match') header: string | undefined,
  ) {
    await this.tasks.deleteLabel(
      await this.spaces.authorizePersonal(actor),
      id,
      requiredRevision(header),
    );
  }
}
