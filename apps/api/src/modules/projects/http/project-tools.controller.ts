import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  Res,
  Inject,
  UseGuards,
  BadRequestException,
  HttpCode,
} from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import { VerifiedSessionGuard } from '../../../platform/auth/session.guard.js';
import { CurrentActor } from '../../../platform/auth/request-actor.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { ZodValidationPipe } from '../../../bootstrap/zod-validation.pipe.js';
import {
  expectedRevision,
  revisionTag,
} from '../../../bootstrap/concurrency.js';
import { ProjectGuard } from './projects.controller.js';
import { ProjectToolsService } from '../application/project-tools.service.js';
const uuid = new ZodValidationPipe(c.ProjectCreateSchema.shape.id);
function rev(match: string | undefined) {
  const r = expectedRevision(match);
  if (r === undefined) throw new BadRequestException();
  return r;
}
@Controller('projects/:projectId')
@UseGuards(VerifiedSessionGuard, ProjectGuard)
export class ProjectToolsController {
  constructor(
    @Inject(ProjectToolsService) private readonly s: ProjectToolsService,
  ) {}
  @Get('workflows')
  async workflows(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Query(new ZodValidationPipe(c.ProjectPageQuerySchema))
    q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    const v = await this.s.workflows(actor, pid, q);
    return v;
  }
  @Post('workflows')
  @HttpCode(200)
  async createWorkflow(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Body(new ZodValidationPipe(c.WorkflowCreateSchema))
    input: z.infer<typeof c.WorkflowCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.s.publishWorkflow(actor, pid, input.id, 0, input, key);
    res.setHeader('ETag', revisionTag(v.version));
    return v;
  }
  @Get('workflows/:workflowId/versions')
  async workflow(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('workflowId', uuid) workflowId: string,
    @Query(new ZodValidationPipe(c.ToolVersionQuerySchema))
    q: z.infer<typeof c.ToolVersionQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.s.workflow(actor, pid, workflowId, q.version);
    res.setHeader('ETag', revisionTag(v.version));
    return v;
  }
  @Post('workflows/:workflowId/versions')
  @HttpCode(200)
  async publishWorkflow(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('workflowId', uuid) workflowId: string,
    @Body(new ZodValidationPipe(c.WorkflowVersionInputSchema))
    input: z.infer<typeof c.WorkflowVersionInputSchema>,
    @Headers('if-match') match: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.s.publishWorkflow(
      actor,
      pid,
      workflowId,
      rev(match),
      input,
      key,
    );
    res.setHeader('ETag', revisionTag(v.version));
    return v;
  }
  @Get('tasks/:taskId/workflow')
  async binding(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('taskId', uuid) taskId: string,
    @Query(new ZodValidationPipe(c.ProjectEmptySchema)) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.s.binding(actor, pid, taskId);
    res.setHeader('ETag', revisionTag(v.sourceRevision));
    return v;
  }
  @Put('tasks/:taskId/workflow')
  async bind(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('taskId', uuid) taskId: string,
    @Body(new ZodValidationPipe(c.WorkflowBindSchema))
    input: z.infer<typeof c.WorkflowBindSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.s.bind(actor, pid, taskId, rev(match), input);
    res.setHeader('ETag', revisionTag(v.sourceRevision));
    return v;
  }
  @Post('tasks/:taskId/workflow/transitions')
  @HttpCode(200)
  async transition(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('taskId', uuid) taskId: string,
    @Body(new ZodValidationPipe(c.WorkflowTransitionSchema))
    input: z.infer<typeof c.WorkflowTransitionSchema>,
    @Headers('if-match') match: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.s.transition(
      actor,
      pid,
      taskId,
      rev(match),
      input.edgeId,
      key,
    );
    res.setHeader('ETag', revisionTag(v.task.revision));
    return v;
  }
  @Get('tasks/:taskId/workflow/approvals')
  async approvals(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('taskId', uuid) taskId: string,
    @Query(new ZodValidationPipe(c.ProjectPageQuerySchema))
    q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    const v = await this.s.approvals(actor, pid, taskId, q);
    return v;
  }
  @Post('tasks/:taskId/workflow/approvals/:approvalId/approve')
  @HttpCode(200)
  async approve(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('taskId', uuid) taskId: string,
    @Param('approvalId', uuid) approvalId: string,
    @Body(new ZodValidationPipe(c.ProjectEmptySchema.optional()))
    _input: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.s.decide(
      actor,
      pid,
      taskId,
      approvalId,
      rev(match),
      true,
    );
    res.setHeader('ETag', revisionTag(v.task.revision));
    return v;
  }
  @Post('tasks/:taskId/workflow/approvals/:approvalId/reject')
  @HttpCode(200)
  async reject(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('taskId', uuid) taskId: string,
    @Param('approvalId', uuid) approvalId: string,
    @Body(new ZodValidationPipe(c.ProjectEmptySchema.optional()))
    _input: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.s.decide(
      actor,
      pid,
      taskId,
      approvalId,
      rev(match),
      false,
    );
    res.setHeader('ETag', revisionTag(v.task.revision));
    return v;
  }
  @Get('custom-fields')
  async fields(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Query(new ZodValidationPipe(c.ProjectPageQuerySchema))
    q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    const v = await this.s.fields(actor, pid, q);
    return v;
  }
  @Post('custom-fields')
  @HttpCode(200)
  async createField(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Body(new ZodValidationPipe(c.CustomFieldCreateSchema))
    input: z.infer<typeof c.CustomFieldCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.s.publishField(actor, pid, input.id, 0, input, key);
    res.setHeader('ETag', revisionTag(v.version));
    return v;
  }
  @Get('custom-fields/:fieldId/versions')
  async field(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('fieldId', uuid) fieldId: string,
    @Query(new ZodValidationPipe(c.ToolVersionQuerySchema))
    q: z.infer<typeof c.ToolVersionQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.s.field(actor, pid, fieldId, q.version);
    res.setHeader('ETag', revisionTag(v.version));
    return v;
  }
  @Post('custom-fields/:fieldId/versions')
  @HttpCode(200)
  async publishField(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('fieldId', uuid) fieldId: string,
    @Body(new ZodValidationPipe(c.CustomFieldVersionInputSchema))
    input: z.infer<typeof c.CustomFieldVersionInputSchema>,
    @Headers('if-match') match: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.s.publishField(
      actor,
      pid,
      fieldId,
      rev(match),
      input,
      key,
    );
    res.setHeader('ETag', revisionTag(v.version));
    return v;
  }
  @Post('custom-fields/:fieldId/deprecate')
  @HttpCode(200)
  async deprecate(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('fieldId', uuid) fieldId: string,
    @Body(new ZodValidationPipe(c.ProjectEmptySchema.optional()))
    _input: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.s.deprecateField(actor, pid, fieldId, rev(match));
    res.setHeader('ETag', revisionTag(v.revision));
    return v;
  }
  @Get('tasks/:taskId/field-values')
  async values(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('taskId', uuid) taskId: string,
    @Query(new ZodValidationPipe(c.ProjectEmptySchema)) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.s.values(actor, pid, taskId);
    res.setHeader('ETag', revisionTag(v.sourceRevision));
    return v;
  }
  @Put('tasks/:taskId/field-values/:fieldId')
  async setValue(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('taskId', uuid) taskId: string,
    @Param('fieldId', uuid) fieldId: string,
    @Body(new ZodValidationPipe(c.CustomFieldSetSchema))
    input: z.infer<typeof c.CustomFieldSetSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.s.setValue(
      actor,
      pid,
      taskId,
      fieldId,
      rev(match),
      input,
    );
    res.setHeader('ETag', revisionTag(v.sourceRevision));
    return v;
  }
  @Post('task-search')
  @HttpCode(200)
  async search(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Body(new ZodValidationPipe(c.CustomFieldSearchSchema))
    input: z.infer<typeof c.CustomFieldSearchSchema>,
  ) {
    const v = await this.s.search(actor, pid, input);
    return v;
  }
  @Get('dependencies')
  async graph(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Query(new ZodValidationPipe(c.ProjectEmptySchema)) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.s.graph(actor, pid);
    res.setHeader('ETag', revisionTag(v.revision));
    return v;
  }
  @Post('dependencies')
  @HttpCode(200)
  async dependency(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Body(new ZodValidationPipe(c.DependencyInputSchema))
    input: z.infer<typeof c.DependencyInputSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.s.dependency(actor, pid, input);
    res.setHeader('ETag', revisionTag(v.revision));
    return v;
  }
  @Patch('dependencies/:dependencyId')
  async patchDependency(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('dependencyId', uuid) dependencyId: string,
    @Body(new ZodValidationPipe(c.DependencyPatchSchema))
    input: z.infer<typeof c.DependencyPatchSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.s.patchDependency(
      actor,
      pid,
      dependencyId,
      rev(match),
      input.lagMinutes,
    );
    res.setHeader('ETag', revisionTag(v.revision));
    return v;
  }
  @Delete('dependencies/:dependencyId')
  async retireDependency(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('dependencyId', uuid) dependencyId: string,
    @Body(new ZodValidationPipe(c.ProjectEmptySchema.optional()))
    _input: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.s.retireDependency(
      actor,
      pid,
      dependencyId,
      rev(match),
    );
    res.setHeader('ETag', revisionTag(v.revision));
    return v;
  }
  @Post('reschedule-previews')
  @HttpCode(200)
  async preview(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Body(new ZodValidationPipe(c.ReschedulePreviewInputSchema))
    input: z.infer<typeof c.ReschedulePreviewInputSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.s.preview(actor, pid, input, key);
    res.setHeader('ETag', revisionTag(v.revision));
    return v;
  }
  @Get('reschedule-previews/:previewId')
  async plan(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('previewId', uuid) previewId: string,
    @Query(new ZodValidationPipe(c.ProjectEmptySchema)) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.s.plan(actor, pid, previewId);
    res.setHeader('ETag', revisionTag(v.revision));
    return v;
  }
  @Post('reschedule-previews/:previewId/apply')
  @HttpCode(200)
  async apply(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('previewId', uuid) previewId: string,
    @Body(new ZodValidationPipe(c.RescheduleApplySchema))
    input: z.infer<typeof c.RescheduleApplySchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.s.apply(
      actor,
      pid,
      previewId,
      rev(match),
      input.manifestHash,
    );
    res.setHeader('ETag', revisionTag(v.revision));
    return v;
  }
  @Get('tasks/:taskId/metadata-history')
  async history(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('taskId', uuid) taskId: string,
    @Query(new ZodValidationPipe(c.ProjectPageQuerySchema))
    q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    const v = await this.s.history(actor, pid, taskId, q);
    return v;
  }
}
