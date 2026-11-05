import {
  Controller,
  Get,
  Post,
  Put,
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
import { ProjectRegisterService } from '../application/project-register.service.js';
import { ProjectPlansService } from '../application/project-plans.service.js';
import { ProjectWorkMetricsService } from '../application/project-work-metrics.service.js';
const uuid = new ZodValidationPipe(c.ProjectCreateSchema.shape.id);
function rev(match: string | undefined) {
  const r = expectedRevision(match);
  if (r === undefined) throw new BadRequestException();
  return r;
}
@Controller('projects/:projectId')
@UseGuards(VerifiedSessionGuard, ProjectGuard)
export class ProjectExecutionController {
  constructor(
    @Inject(ProjectRegisterService)
    private readonly register: ProjectRegisterService,
    @Inject(ProjectPlansService) private readonly plans: ProjectPlansService,
    @Inject(ProjectWorkMetricsService)
    private readonly metrics: ProjectWorkMetricsService,
  ) {}
  @Get('register-items')
  async registerList(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Query(new ZodValidationPipe(c.ProjectRegisterQuerySchema))
    q: z.infer<typeof c.ProjectRegisterQuerySchema>,
  ) {
    const v = await this.register.list(actor, pid, q);
    return v;
  }
  @Post('register-items')
  @HttpCode(200)
  async registerCreate(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Body(new ZodValidationPipe(c.ProjectRegisterCreateSchema))
    input: z.infer<typeof c.ProjectRegisterCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.register.create(actor, pid, input, key);
    res.setHeader('ETag', revisionTag(v.revision));
    return v;
  }
  @Get('register-items/:itemId')
  async registerGet(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('itemId', uuid) itemId: string,
    @Query(new ZodValidationPipe(c.ProjectEmptySchema)) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.register.get(actor, pid, itemId);
    res.setHeader('ETag', revisionTag(v.revision));
    return v;
  }
  @Put('register-items/:itemId')
  async registerUpdate(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('itemId', uuid) itemId: string,
    @Body(new ZodValidationPipe(c.ProjectRegisterInputSchema))
    input: z.infer<typeof c.ProjectRegisterInputSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.register.update(actor, pid, itemId, rev(match), input);
    res.setHeader('ETag', revisionTag(v.revision));
    return v;
  }
  @Delete('register-items/:itemId')
  async registerRetire(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('itemId', uuid) itemId: string,
    @Body(new ZodValidationPipe(c.ProjectEmptySchema.optional()))
    _input: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.register.retire(actor, pid, itemId, rev(match));
    res.setHeader('ETag', revisionTag(v.revision));
    return v;
  }
  @Get('register-items/:itemId/history')
  async registerHistory(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('itemId', uuid) itemId: string,
    @Query(new ZodValidationPipe(c.ProjectPageQuerySchema))
    q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    const v = await this.register.events(actor, pid, itemId, q);
    return v;
  }
  @Get('templates')
  async templates(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Query(new ZodValidationPipe(c.ProjectPageQuerySchema))
    q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    const v = await this.plans.templates(actor, pid, q);
    return v;
  }
  @Post('templates')
  @HttpCode(200)
  async templateCreate(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Body(new ZodValidationPipe(c.ProjectTemplateCreateSchema))
    input: z.infer<typeof c.ProjectTemplateCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.plans.publish(actor, pid, input.id, 0, input, key);
    res.setHeader('ETag', revisionTag(v.version));
    return v;
  }
  @Get('templates/:templateId/versions')
  async templateVersion(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('templateId', uuid) templateId: string,
    @Query(new ZodValidationPipe(c.ToolVersionQuerySchema))
    q: z.infer<typeof c.ToolVersionQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.plans.template(actor, pid, templateId, q.version);
    res.setHeader('ETag', revisionTag(v.version));
    return v;
  }
  @Post('templates/:templateId/versions')
  @HttpCode(200)
  async templatePublish(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('templateId', uuid) templateId: string,
    @Body(new ZodValidationPipe(c.ProjectTemplateVersionInputSchema))
    input: z.infer<typeof c.ProjectTemplateVersionInputSchema>,
    @Headers('if-match') match: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.plans.publish(
      actor,
      pid,
      templateId,
      rev(match),
      input,
      key,
    );
    res.setHeader('ETag', revisionTag(v.version));
    return v;
  }
  @Post('templates/:templateId/deprecate')
  @HttpCode(200)
  async templateDeprecate(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('templateId', uuid) templateId: string,
    @Body(new ZodValidationPipe(c.ProjectEmptySchema.optional()))
    _input: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.plans.deprecate(actor, pid, templateId, rev(match));
    res.setHeader('ETag', revisionTag(v.revision));
    return v;
  }
  @Post('templates/:templateId/previews')
  @HttpCode(200)
  async templatePreview(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('templateId', uuid) templateId: string,
    @Body(new ZodValidationPipe(c.ProjectTemplatePreviewSchema))
    input: z.infer<typeof c.ProjectTemplatePreviewSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.plans.templatePreview(
      actor,
      pid,
      templateId,
      input,
      key,
    );
    res.setHeader('ETag', revisionTag(v.revision));
    return v;
  }
  @Post('change-plans/bulk')
  @HttpCode(200)
  async bulkPreview(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Body(new ZodValidationPipe(c.ProjectBulkPreviewSchema))
    input: z.infer<typeof c.ProjectBulkPreviewSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.plans.bulk(actor, pid, input, key);
    res.setHeader('ETag', revisionTag(v.revision));
    return v;
  }
  @Post('change-plans/csv')
  @HttpCode(200)
  async csvPreview(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Body(new ZodValidationPipe(c.ProjectCsvPreviewSchema))
    input: z.infer<typeof c.ProjectCsvPreviewSchema>,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const v = await this.plans.csv(actor, pid, input, key);
    return v;
  }
  @Get('change-plans/:planId')
  async planGet(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('planId', uuid) planId: string,
    @Query(new ZodValidationPipe(c.ProjectEmptySchema)) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.plans.getPlan(actor, pid, planId);
    res.setHeader('ETag', revisionTag(v.revision));
    return v;
  }
  @Post('change-plans/:planId/apply')
  @HttpCode(200)
  async planApply(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('planId', uuid) planId: string,
    @Body(new ZodValidationPipe(c.ProjectChangeApplySchema))
    input: z.infer<typeof c.ProjectChangeApplySchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.plans.apply(
      actor,
      pid,
      planId,
      rev(match),
      input.manifestHash,
    );
    res.setHeader('ETag', revisionTag(v.revision));
    return v;
  }
  @Get('tasks/:taskId/estimate')
  async estimateGet(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('taskId', uuid) taskId: string,
    @Query(new ZodValidationPipe(c.ProjectEmptySchema)) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.metrics.estimate(actor, pid, taskId);
    res.setHeader('ETag', revisionTag(v.sourceRevision));
    return v;
  }
  @Put('tasks/:taskId/estimate')
  async estimatePut(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('taskId', uuid) taskId: string,
    @Body(new ZodValidationPipe(c.SharedEstimateInputSchema))
    input: z.infer<typeof c.SharedEstimateInputSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.metrics.estimate(actor, pid, taskId, {
      revision: rev(match),
      estimatedMinutes: input.estimatedMinutes,
    });
    res.setHeader('ETag', revisionTag(v.sourceRevision));
    return v;
  }
  @Get('tasks/:taskId/work-logs')
  async logs(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('taskId', uuid) taskId: string,
    @Query(new ZodValidationPipe(c.ProjectPageQuerySchema))
    q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    const v = await this.metrics.logs(actor, pid, taskId, q);
    return v;
  }
  @Post('tasks/:taskId/work-logs')
  @HttpCode(200)
  async recordWork(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('taskId', uuid) taskId: string,
    @Body(new ZodValidationPipe(c.SharedWorkLogCreateSchema))
    input: z.infer<typeof c.SharedWorkLogCreateSchema>,
    @Headers('if-match') match: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.metrics.record(
      actor,
      pid,
      taskId,
      rev(match),
      input,
      key,
    );
    res.setHeader('ETag', revisionTag(v.revision));
    return v;
  }
  @Post('tasks/:taskId/work-logs/:logId/void')
  @HttpCode(200)
  async voidWork(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('taskId', uuid) taskId: string,
    @Param('logId', uuid) logId: string,
    @Body(new ZodValidationPipe(c.ProjectEmptySchema.optional()))
    _input: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.metrics.void(actor, pid, taskId, logId, rev(match));
    res.setHeader('ETag', revisionTag(v.revision));
    return v;
  }
  @Get('capacity-days')
  async capacityList(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Query(new ZodValidationPipe(c.ProjectWorkRecordsQuerySchema))
    q: z.infer<typeof c.ProjectWorkRecordsQuerySchema>,
  ) {
    const v = await this.metrics.records(actor, pid, 'capacity', q);
    return v;
  }
  @Get('capacity-days/:recordId')
  async capacityGet(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('recordId', uuid) recordId: string,
    @Query(new ZodValidationPipe(c.ProjectEmptySchema)) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.metrics.getRecord(actor, pid, 'capacity', recordId);
    res.setHeader('ETag', revisionTag(v.revision));
    return v;
  }
  @Post('capacity-days')
  @HttpCode(200)
  async capacityCreate(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Body(new ZodValidationPipe(c.ProjectCapacityCreateSchema))
    input: z.infer<typeof c.ProjectCapacityCreateSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.metrics.capacity(actor, pid, input.id, 0, input);
    res.setHeader('ETag', revisionTag(v.revision));
    return v;
  }
  @Put('capacity-days/:recordId')
  async capacityUpdate(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('recordId', uuid) recordId: string,
    @Body(new ZodValidationPipe(c.ProjectCapacityInputSchema))
    input: z.infer<typeof c.ProjectCapacityInputSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.metrics.capacity(
      actor,
      pid,
      recordId,
      rev(match),
      input,
    );
    res.setHeader('ETag', revisionTag(v.revision));
    return v;
  }
  @Get('work-allocations')
  async allocationsList(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Query(new ZodValidationPipe(c.ProjectWorkRecordsQuerySchema))
    q: z.infer<typeof c.ProjectWorkRecordsQuerySchema>,
  ) {
    const v = await this.metrics.records(actor, pid, 'allocations', q);
    return v;
  }
  @Get('work-allocations/:recordId')
  async allocationsGet(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('recordId', uuid) recordId: string,
    @Query(new ZodValidationPipe(c.ProjectEmptySchema)) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.metrics.getRecord(actor, pid, 'allocations', recordId);
    res.setHeader('ETag', revisionTag(v.revision));
    return v;
  }
  @Post('work-allocations')
  @HttpCode(200)
  async allocationsCreate(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Body(new ZodValidationPipe(c.ProjectAllocationCreateSchema))
    input: z.infer<typeof c.ProjectAllocationCreateSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.metrics.allocation(actor, pid, input.id, 0, input);
    res.setHeader('ETag', revisionTag(v.revision));
    return v;
  }
  @Put('work-allocations/:recordId')
  async allocationsUpdate(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('recordId', uuid) recordId: string,
    @Body(new ZodValidationPipe(c.ProjectAllocationInputSchema))
    input: z.infer<typeof c.ProjectAllocationInputSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.metrics.allocation(
      actor,
      pid,
      recordId,
      rev(match),
      input,
    );
    res.setHeader('ETag', revisionTag(v.revision));
    return v;
  }
  @Get('workload')
  async workload(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Query(new ZodValidationPipe(c.ProjectWorkloadQuerySchema))
    q: z.infer<typeof c.ProjectWorkloadQuerySchema>,
  ) {
    const v = await this.metrics.workload(actor, pid, q);
    return v;
  }
  @Get('reports/current')
  async report(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Query(new ZodValidationPipe(c.ProjectReportWindowSchema))
    q: z.infer<typeof c.ProjectReportWindowSchema>,
  ) {
    const v = await this.metrics.currentReport(actor, pid, q);
    return v;
  }
  @Post('reports/snapshots')
  @HttpCode(200)
  async snapshotCreate(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Body(new ZodValidationPipe(c.ProjectReportCreateSchema))
    input: z.infer<typeof c.ProjectReportCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const v = await this.metrics.createSnapshot(actor, pid, input, key);
    return v;
  }
  @Get('reports/snapshots/:snapshotId')
  async snapshotGet(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('snapshotId', uuid) snapshotId: string,
    @Query(new ZodValidationPipe(c.ProjectEmptySchema)) _q: unknown,
  ) {
    const v = await this.metrics.getSnapshot(actor, pid, snapshotId);
    return v;
  }
}
