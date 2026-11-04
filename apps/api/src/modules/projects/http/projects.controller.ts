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
  Injectable,
  UseGuards,
  SetMetadata,
  BadRequestException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
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
import {
  CollaborationService,
  ResourceGrants,
} from '../../spaces/public/index.js';
import { ProjectsService } from '../application/projects.service.js';
const uuid = new ZodValidationPipe(c.ProjectCreateSchema.shape.id),
  empty = new ZodValidationPipe(c.ProjectEmptySchema),
  emptyBody = new ZodValidationPipe(c.ProjectEmptySchema.optional()),
  componentKind = new ZodValidationPipe(c.ProjectComponentKindSchema),
  query = new ZodValidationPipe(c.ProjectPageQuerySchema);
function revision(match: string | undefined) {
  const value = expectedRevision(match);
  if (value === undefined) throw new BadRequestException();
  return value;
}
function result<T>(response: Response, value: T, revision: number) {
  response.setHeader('ETag', revisionTag(revision));
  return value;
}
@Injectable()
export class ProjectGuard implements CanActivate {
  constructor(
    @Inject(CollaborationService)
    private readonly collaboration: CollaborationService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}
  async canActivate(context: ExecutionContext) {
    const req = context
      .switchToHttp()
      .getRequest<Request & { actor?: RequestActor }>();
    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' && Object.keys(req.query).length)
      throw new BadRequestException();
    await this.collaboration.request(
      req.ip ?? req.socket.remoteAddress ?? 'unknown',
      req.actor,
      this.reflector.get<boolean>('project.preview', context.getHandler()) ??
        false,
    );
    return true;
  }
}
@Controller('projects')
@UseGuards(VerifiedSessionGuard, ProjectGuard)
export class ProjectsController {
  constructor(
    @Inject(ProjectsService) private readonly service: ProjectsService,
  ) {}
  @Post()
  async create(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(c.ProjectCreateSchema))
    body: z.infer<typeof c.ProjectCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.create(actor, body, key);
    return result(res, value, value.revision);
  }
  @Get()
  list(
    @CurrentActor() actor: RequestActor,
    @Query(query) q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    return this.service.list(actor, q);
  }
  @Get(':id')
  async read(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.read(actor, id);
    return result(res, value, value.revision);
  }
  @Patch(':id')
  async patch(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(c.ProjectPatchSchema))
    body: z.infer<typeof c.ProjectPatchSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.patch(actor, id, revision(match), body);
    return result(res, value, value.revision);
  }
  @Post(':id/archive')
  async archive(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Body(emptyBody) _b: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.lifecycle(
      actor,
      id,
      revision(match),
      'archive',
    );
    return result(res, value, value.revision);
  }
  @Post(':id/restore')
  async restore(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Body(emptyBody) _b: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.lifecycle(
      actor,
      id,
      revision(match),
      'restore',
    );
    return result(res, value, value.revision);
  }
  @Post(':id/deletion-request')
  async remove(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(c.HandoverAcceptSchema))
    body: z.infer<typeof c.HandoverAcceptSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.lifecycle(
      actor,
      id,
      revision(match),
      'delete',
      body.password,
    );
    return result(res, value, value.revision);
  }
  @Get(':id/access-policy')
  async policy(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.policy(actor, id);
    return result(res, value, value.version);
  }
  @Put(':id/access-policy')
  async publishPolicy(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(c.ProjectPolicyPublishSchema))
    body: z.infer<typeof c.ProjectPolicyPublishSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.publishPolicy(
      actor,
      id,
      revision(match),
      body,
    );
    return result(res, value, value.version);
  }
  @Get(':id/components/:kind')
  components(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('kind', componentKind)
    kind: z.infer<typeof c.ProjectComponentKindSchema>,
    @Query(query) q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    return this.service.components(actor, id, kind, q);
  }
  @Post(':id/components/:kind')
  async createComponent(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('kind', componentKind)
    kind: z.infer<typeof c.ProjectComponentKindSchema>,
    @Body(new ZodValidationPipe(c.ProjectComponentCreateSchema))
    body: z.infer<typeof c.ProjectComponentCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.createComponent(
      actor,
      id,
      kind,
      body,
      key,
    );
    return result(res, value, value.revision);
  }
  @Patch(':id/components/:kind/:componentId')
  async patchComponent(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('kind', componentKind)
    kind: z.infer<typeof c.ProjectComponentKindSchema>,
    @Param('componentId', uuid) componentId: string,
    @Body(new ZodValidationPipe(c.ProjectComponentPatchSchema))
    body: z.infer<typeof c.ProjectComponentPatchSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.patchComponent(
      actor,
      id,
      kind,
      componentId,
      revision(match),
      body,
    );
    return result(res, value, value.revision);
  }
  @Delete(':id/components/:kind/:componentId')
  async deleteComponent(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('kind', componentKind)
    kind: z.infer<typeof c.ProjectComponentKindSchema>,
    @Param('componentId', uuid) componentId: string,
    @Body(emptyBody) _b: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.deleteComponent(
      actor,
      id,
      kind,
      componentId,
      revision(match),
    );
    return result(res, value, value.revision);
  }
  @Get(':id/tasks')
  tasks(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(query) q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    return this.service.sources(actor, id, 'TASK', q);
  }
  @Post(':id/tasks')
  async createTask(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(c.ProjectTaskCreateSchema))
    body: z.infer<typeof c.ProjectTaskCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.createTask(actor, id, body, key);
    return result(res, value, value.revision);
  }
  @Get(':id/tasks/:taskId')
  async task(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('taskId', uuid) taskId: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.SharedTaskSchema.parse(
      await this.service.source(actor, id, 'TASK', taskId),
    );
    return result(res, value, value.revision);
  }
  @Patch(':id/tasks/:taskId')
  async patchTask(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('taskId', uuid) taskId: string,
    @Body(new ZodValidationPipe(c.ProjectTaskPatchSchema))
    body: z.infer<typeof c.ProjectTaskPatchSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.patchTask(
      actor,
      id,
      taskId,
      revision(match),
      body,
      key,
    );
    return result(res, value, value.revision);
  }
  @Get(':id/tasks/:taskId/association')
  readTaskAssociation(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('taskId', uuid) taskId: string,
    @Query(empty) _q: unknown,
  ) {
    return this.service.readAssociation(actor, id, 'TASK', taskId);
  }
  @Put(':id/tasks/:taskId/association')
  async associateTask(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('taskId', uuid) taskId: string,
    @Body(new ZodValidationPipe(c.ProjectTaskAssociationSchema))
    body: z.infer<typeof c.ProjectTaskAssociationSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.associate(
      actor,
      id,
      'TASK',
      taskId,
      revision(match),
      body,
    );
    return result(res, value, value.revision);
  }
  @Get(':id/goals')
  goals(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(query) q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    return this.service.sources(actor, id, 'GOAL', q);
  }
  @Post(':id/goals')
  async createGoal(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(c.ProjectGoalCreateSchema))
    body: z.infer<typeof c.ProjectGoalCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.createGoal(actor, id, body, key);
    return result(res, value, value.revision);
  }
  @Get(':id/goals/:goalId')
  async goal(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('goalId', uuid) goalId: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.SharedGoalSchema.parse(
      await this.service.source(actor, id, 'GOAL', goalId),
    );
    return result(res, value, value.revision);
  }
  @Patch(':id/goals/:goalId')
  async patchGoal(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('goalId', uuid) goalId: string,
    @Body(new ZodValidationPipe(c.ProjectGoalPatchSchema))
    body: z.infer<typeof c.ProjectGoalPatchSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.patchGoal(
      actor,
      id,
      goalId,
      revision(match),
      body,
      key,
    );
    return result(res, value, value.revision);
  }
  @Get(':id/goals/:goalId/association')
  readGoalAssociation(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('goalId', uuid) goalId: string,
    @Query(empty) _q: unknown,
  ) {
    return this.service.readAssociation(actor, id, 'GOAL', goalId);
  }
  @Put(':id/goals/:goalId/association')
  async associateGoal(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('goalId', uuid) goalId: string,
    @Body(new ZodValidationPipe(c.ProjectGoalAssociationSchema))
    body: z.infer<typeof c.ProjectGoalAssociationSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.associate(
      actor,
      id,
      'GOAL',
      goalId,
      revision(match),
      body,
    );
    return result(res, value, value.revision);
  }
  @Put(':id/goals/:goalId/tasks/:taskId')
  async link(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('goalId', uuid) goalId: string,
    @Param('taskId', uuid) taskId: string,
    @Body(emptyBody) _b: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.linkGoalTask(
      actor,
      id,
      goalId,
      taskId,
      revision(match),
    );
    return result(res, value, value.revision);
  }
  @Get(':id/member-assignments')
  assignments(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(query) q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    return this.service.assignments(actor, id, q);
  }
  @Post(':id/member-assignments')
  async assign(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(c.ProjectMemberAssignmentCreateSchema))
    body: z.infer<typeof c.ProjectMemberAssignmentCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.assign(actor, id, body, key);
    return result(res, value, value.revision);
  }
  @Post(':id/member-assignments/:assignmentId/revoke')
  async unassign(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('assignmentId', uuid) assignmentId: string,
    @Body(emptyBody) _b: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.revokeAssignment(
      actor,
      id,
      assignmentId,
      revision(match),
    );
    return result(res, value, value.revision);
  }
  @Post(':id/leave-collaboration')
  async leaveCollaboration(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Headers('if-match') match: string | undefined,
    @Body(emptyBody) _b: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.leaveCollaboration(
      actor,
      id,
      revision(match),
    );
    return result(res, value, value.revision);
  }
  @Get(':id/lifecycle')
  lifecycleStatus(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
  ) {
    return this.service.lifecycleStatus(actor, id);
  }
  @Get(':id/resource-invitations/:offerId')
  async readGrantOffer(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('offerId', uuid) offerId: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.readGrantOffer(actor, id, offerId);
    return result(res, value, value.revision);
  }
  @Post(':id/resource-invitations')
  async grantOffer(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(c.GrantOfferCreateSchema))
    body: z.infer<typeof c.GrantOfferCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.grantOffer(actor, id, body, key);
    return result(res, value, value.offer.revision);
  }
  @Post(':id/resource-invitations/:offerId/revoke')
  async revokeOffer(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('offerId', uuid) offerId: string,
    @Body(emptyBody) _b: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.revokeGrantOffer(
      actor,
      id,
      offerId,
      revision(match),
    );
    return result(res, value, value.revision);
  }
  @Post(':id/grants/:grantId/revoke')
  async revokeGrant(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('grantId', uuid) grantId: string,
    @Body(emptyBody) _b: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.service.revokeGrant(
      actor,
      id,
      grantId,
      revision(match),
    );
    return result(res, value, value.revision);
  }
}
@Controller('resource-invitations')
export class ResourceInvitationController {
  constructor(
    @Inject(ResourceGrants) private readonly grants: ResourceGrants,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
  ) {}
  @Get('preview')
  @SetMetadata('project.preview', true)
  @UseGuards(ProjectGuard)
  async preview(
    @Headers('x-invitation-proof') proof: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return c.ResourceInvitationPreviewSchema.parse(
      await this.grants.preview(proof, this.projects.validateGrantTarget),
    );
  }
  @Post(':id/accept')
  @UseGuards(VerifiedSessionGuard, ProjectGuard)
  async accept(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Headers('x-invitation-proof') proof: string | undefined,
    @Headers('if-match') match: string | undefined,
    @Body(emptyBody) _b: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.GrantOfferAcceptanceSchema.parse(
      await this.grants.decide(
        actor,
        id,
        proof,
        revision(match),
        true,
        this.projects.validateGrantTarget,
      ),
    );
    return result(res, value, value.offer.revision);
  }
  @Post(':id/decline')
  @UseGuards(VerifiedSessionGuard, ProjectGuard)
  async decline(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Headers('x-invitation-proof') proof: string | undefined,
    @Headers('if-match') match: string | undefined,
    @Body(emptyBody) _b: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.GrantOfferSchema.parse(
      await this.grants.decide(
        actor,
        id,
        proof,
        revision(match),
        false,
        this.projects.validateGrantTarget,
      ),
    );
    return result(res, value, value.revision);
  }
}
