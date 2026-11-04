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
import { WorkService } from '../application/work.service.js';
const uuid = new ZodValidationPipe(c.TaskAssignmentCreateSchema.shape.id),
  empty = new ZodValidationPipe(c.ProjectEmptySchema),
  emptyBody = new ZodValidationPipe(c.ProjectEmptySchema.optional()),
  pageQuery = new ZodValidationPipe(c.ProjectPageQuerySchema);
function rev(value: string | undefined) {
  const v = expectedRevision(value);
  if (v === undefined) throw new BadRequestException();
  return v;
}
function etag<T>(res: Response, value: T, revision: number) {
  res.setHeader('ETag', revisionTag(revision));
  return value;
}
@Controller('projects/:projectId')
@UseGuards(VerifiedSessionGuard, ProjectGuard)
export class WorkController {
  constructor(@Inject(WorkService) private readonly work: WorkService) {}
  @Get('assignment-policy')
  async policy(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.work.policy(actor, pid);
    return etag(res, v, v.policyVersion);
  }
  @Get('tasks/:taskId/assignments')
  list(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('taskId', uuid) tid: string,
    @Query(pageQuery) q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    return this.work.list(actor, pid, tid, q);
  }
  @Post('tasks/:taskId/assignments')
  async create(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('taskId', uuid) tid: string,
    @Body(new ZodValidationPipe(c.TaskAssignmentCreateSchema))
    input: z.infer<typeof c.TaskAssignmentCreateSchema>,
    @Headers('if-match') match: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.work.create(actor, pid, tid, rev(match), input, key);
    return etag(res, v, v.revision);
  }
  @Get('tasks/:taskId/assignments/:assignmentId')
  async get(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('taskId', uuid) tid: string,
    @Param('assignmentId', uuid) id: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.work.get(actor, pid, tid, id);
    return etag(res, v, v.assignment.revision);
  }
  @Post('tasks/:taskId/assignments/:assignmentId/accept')
  async accept(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('taskId', uuid) tid: string,
    @Param('assignmentId', uuid) id: string,
    @Body(emptyBody) _input: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.work.respond(actor, pid, tid, id, rev(match), {
      decision: 'ACCEPTED',
    });
    return etag(res, v, v.revision);
  }
  @Post('tasks/:taskId/assignments/:assignmentId/decline')
  async decline(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('taskId', uuid) tid: string,
    @Param('assignmentId', uuid) id: string,
    @Body(new ZodValidationPipe(c.TaskAssignmentDeclineSchema))
    input: z.infer<typeof c.TaskAssignmentDeclineSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.work.respond(actor, pid, tid, id, rev(match), {
      decision: 'DECLINED',
      reason: input.reason,
    });
    return etag(res, v, v.revision);
  }
  @Post('tasks/:taskId/assignments/:assignmentId/revoke')
  async revoke(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('taskId', uuid) tid: string,
    @Param('assignmentId', uuid) id: string,
    @Body(emptyBody) _input: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.work.revoke(actor, pid, tid, id, rev(match));
    return etag(res, v, v.revision);
  }
  @Post('tasks/:taskId/assignments/:assignmentId/reassign')
  async reassign(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('taskId', uuid) tid: string,
    @Param('assignmentId', uuid) id: string,
    @Body(new ZodValidationPipe(c.TaskAssignmentReassignSchema))
    input: z.infer<typeof c.TaskAssignmentReassignSchema>,
    @Headers('if-match') match: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.work.reassign(
      actor,
      pid,
      tid,
      id,
      rev(match),
      input,
      key,
    );
    return etag(res, v, v.revision);
  }
  @Get('tasks/:taskId/schedule')
  async getSchedule(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('taskId', uuid) tid: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.work.schedule(actor, pid, tid);
    return etag(res, v, v.revision);
  }
  @Put('tasks/:taskId/schedule')
  async schedule(
    @CurrentActor() actor: RequestActor,
    @Param('projectId', uuid) pid: string,
    @Param('taskId', uuid) tid: string,
    @Body(new ZodValidationPipe(c.SharedTaskScheduleInputSchema))
    input: z.infer<typeof c.SharedTaskScheduleInputSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.work.schedule(actor, pid, tid, {
      revision: rev(match),
      value: input,
    });
    return etag(res, v, v.revision);
  }
}
@Controller('me')
@UseGuards(VerifiedSessionGuard, ProjectGuard)
export class WorkProjectionController {
  constructor(@Inject(WorkService) private readonly work: WorkService) {}
  @Get('work/assignments')
  pending(
    @CurrentActor() actor: RequestActor,
    @Query(pageQuery) q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    return this.work.pending(actor, q);
  }
  @Get('work/tasks')
  tasks(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(c.WorkTaskQuerySchema))
    q: z.infer<typeof c.WorkTaskQuerySchema>,
  ) {
    return this.work.taskProjection(actor, q);
  }
  @Get('work/goals')
  goals(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(c.WorkGoalQuerySchema))
    q: z.infer<typeof c.WorkGoalQuerySchema>,
  ) {
    return this.work.goalProjection(actor, q);
  }
  @Get('work/notifications')
  notifications(
    @CurrentActor() actor: RequestActor,
    @Query(pageQuery) q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    return this.work.inbox(actor, q);
  }
  @Post('work/notifications/:id/read')
  async mark(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(c.SharedWorkNotificationReadSchema))
    input: z.infer<typeof c.SharedWorkNotificationReadSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.work.markNotification(
      actor,
      input.spaceId,
      id,
      rev(match),
    );
    return etag(res, v, v.revision);
  }
  @Get('calendar/overlays')
  overlays(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(c.WorkOverlayQuerySchema))
    q: z.infer<typeof c.WorkOverlayQuerySchema>,
  ) {
    return this.work.overlays(actor, q);
  }
  @Get('calendar/time-blocks/:blockId/shared-task')
  async block(
    @CurrentActor() actor: RequestActor,
    @Param('blockId', uuid) id: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.work.block(actor, id);
    return etag(res, v, v.revision);
  }
  @Put('calendar/time-blocks/:blockId/shared-task')
  async link(
    @CurrentActor() actor: RequestActor,
    @Param('blockId', uuid) id: string,
    @Body(new ZodValidationPipe(c.SharedTaskBlockInputSchema))
    input: z.infer<typeof c.SharedTaskBlockInputSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.work.block(actor, id, {
      revision: rev(match),
      value: input,
    });
    return etag(res, v, v.revision);
  }
  @Delete('calendar/time-blocks/:blockId/shared-task')
  async unlink(
    @CurrentActor() actor: RequestActor,
    @Param('blockId', uuid) id: string,
    @Body(emptyBody) _input: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.work.block(actor, id, {
      revision: rev(match),
      value: null,
    });
    return etag(res, v, v.revision);
  }
}
