import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type {
  Prisma,
  Project,
  ProjectPhase,
  ProjectSection,
  ProjectMilestone,
  ProjectMemberAssignment,
} from '../../../generated/prisma/client.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import { AuthService } from '../../../platform/auth/auth.service.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import {
  SharedKernel,
  SharedAuthority,
  ResourceGrants,
} from '../../spaces/public/index.js';
import type { SharedRequest } from '../../spaces/public/index.js';
import { SharedTasks } from '../../tasks/public/index.js';
import { SharedGoals } from '../../goals/public/index.js';
type Kind = z.infer<typeof c.ProjectComponentKindSchema>;
const hash = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
function key(v: string | undefined) {
  if (!v || !/^[!-~]{1,128}$/.test(v)) throw new BadRequestException();
  return v;
}
const page = <T extends { id: string }>(rows: T[], limit: number) => ({
  items: rows.slice(0, limit),
  nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
});
const componentView = (
  kind: Kind,
  row: ProjectPhase | ProjectSection | ProjectMilestone,
) =>
  c.ProjectComponentSchema.strip().parse({
    ...row,
    kind,
    phaseId: 'phaseId' in row ? row.phaseId : null,
    targetDate:
      'targetDate' in row
        ? (row.targetDate?.toISOString().slice(0, 10) ?? null)
        : null,
    completed: 'completed' in row ? row.completed : null,
  });
const assignmentView = (row: ProjectMemberAssignment) =>
  c.ProjectMemberAssignmentSchema.strip().parse({
    ...row,
    target: {
      kind: row.phaseId ? 'PHASE' : row.sectionId ? 'SECTION' : 'MILESTONE',
      id: row.phaseId ?? row.sectionId ?? row.milestoneId,
    },
    revokedAt: row.revokedAt?.toISOString() ?? null,
  });
@Injectable()
export class ProjectsService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(SharedTasks) private readonly tasks: SharedTasks,
    @Inject(SharedGoals) private readonly goals: SharedGoals,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ResourceGrants) private readonly grants: ResourceGrants,
  ) {}
  validateGrantTarget = async (
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    spaceId: string,
    target: z.infer<typeof c.ResourceTargetSchema>,
  ) => {
    if (target.kind === 'TASK') {
      await this.tasks.read(tx, a, spaceId, target.id);
      return;
    }
    if (target.kind === 'GOAL') {
      await this.goals.read(tx, a, spaceId, target.id);
      return;
    }
    a.require(tx, spaceId, 'task.read', target);
    if (
      !(await tx.project.findFirst({
        where: { id: target.id, spaceId, scopeId: spaceId },
      }))
    )
      throw new NotFoundException();
  };
  async policy(actor: RequestActor, id: string) {
    const row = await this.hint(id);
    return c.ProjectPolicySchema.parse(
      await this.kernel.readPolicy(actor, row.spaceId),
    );
  }
  async publishPolicy(
    actor: RequestActor,
    id: string,
    version: number,
    input: z.infer<typeof c.ProjectPolicyPublishSchema>,
  ) {
    const row = await this.hint(id);
    const result = await this.kernel.publishPolicy(actor, {
      ...input,
      spaceId: row.spaceId,
      scopeId: row.scopeId,
      expectedVersion: version,
    });
    return c.ProjectPolicySchema.parse({ ...input, version: result.version });
  }
  async grantOffer(
    actor: RequestActor,
    id: string,
    input: z.infer<typeof c.GrantOfferCreateSchema>,
    key: string | undefined,
  ) {
    const row = await this.hint(id);
    return this.grants.createOffer(
      actor,
      row.spaceId,
      input,
      key,
      this.validateGrantTarget,
    );
  }
  async revokeGrant(
    actor: RequestActor,
    id: string,
    grantId: string,
    revision: number,
  ) {
    const row = await this.hint(id);
    return this.grants.revoke(actor, row.spaceId, grantId, revision);
  }
  async revokeGrantOffer(
    actor: RequestActor,
    id: string,
    offerId: string,
    revision: number,
  ) {
    const row = await this.hint(id);
    return this.grants.revokeOffer(actor, row.spaceId, offerId, revision);
  }
  async leaveCollaboration(actor: RequestActor, id: string, revision: number) {
    const row = await this.hint(id);
    return this.kernel.departGuest(actor, row.spaceId, revision);
  }
  async lifecycleStatus(actor: RequestActor, id: string) {
    const row = await this.hint(id);
    return c.ProjectLifecycleSchema.parse(
      await this.kernel.projectStatus(actor, row.spaceId),
    );
  }
  async readGrantOffer(actor: RequestActor, id: string, offerId: string) {
    const row = await this.hint(id);
    return this.grants.readOffer(actor, row.spaceId, offerId);
  }
  private async view(
    tx: Prisma.TransactionClient,
    row: Project,
    a: SharedAuthority,
  ) {
    const state = await this.kernel.contextState(tx, a, row.spaceId, row.id);
    return c.ProjectSchema.strip().parse({
      ...row,
      state,
      association: { kind: 'INDEPENDENT' },
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }
  async hint(id: string) {
    this.kernel.assertEnabled();
    const row = await this.db.client.project.findUnique({ where: { id } });
    if (!row) throw new NotFoundException();
    return row;
  }
  private request(
    row: Project,
    capability: SharedRequest['capability'],
    resource?: SharedRequest['resource'],
    allowArchived = false,
  ): SharedRequest {
    return {
      spaceId: row.spaceId,
      scopeId: row.scopeId,
      capability,
      ...(resource ? { resource } : {}),
      allowArchived,
    };
  }
  private run<T>(
    actor: RequestActor,
    row: Project,
    requests: SharedRequest[],
    work: (tx: Prisma.TransactionClient, a: SharedAuthority) => Promise<T>,
    userIds: string[] = [],
  ) {
    return this.kernel.run(
      actor,
      { userIds, spaceIds: [row.spaceId] },
      requests,
      work,
    );
  }
  private async effect(
    tx: Prisma.TransactionClient,
    actor: RequestActor,
    a: SharedAuthority,
    r: SharedRequest,
    action: string,
    id: string,
    feature?: string,
  ) {
    const access = a.require(tx, r.spaceId, r.capability, r.resource);
    await this.kernel.offerEffect(
      tx,
      actor,
      r.spaceId,
      access.actorId,
      action,
      id,
      randomUUID(),
      feature ? { actorId: access.actorId, feature, delta: 1 } : undefined,
    );
  }
  private async once(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    r: SharedRequest,
    operation: string,
    rawKey: string | undefined,
    input: unknown,
    work: () => Promise<{ id: string }>,
  ) {
    return this.kernel.receipt(
      tx,
      a,
      r,
      {
        operation,
        key:
          'generation:' +
          a.require(tx, r.spaceId, r.capability, r.resource).generation +
          ':' +
          key(rawKey),
        fingerprint: hash(input),
      },
      async () => ({
        ...(await work()),
        statusCode: operation.endsWith('.update') ? 200 : 201,
      }),
    );
  }
  async create(
    actor: RequestActor,
    body: z.infer<typeof c.ProjectCreateSchema>,
    rawKey: string | undefined,
  ) {
    const input = c.ProjectCreateSchema.parse(body),
      creationKey = hash(key(rawKey)),
      fingerprint = hash(input);
    try {
      await this.kernel.provision(
        actor,
        input.id,
        input.retentionPolicyVersion,
        async (tx, b) => {
          await tx.project.create({
            data: {
              id: input.id,
              spaceId: b.spaceId,
              scopeId: b.scopeId,
              createdByActorId: b.actorId,
              title: input.title,
              description: input.description ?? null,
              creationKey,
              creationFingerprint: fingerprint,
            },
          });
          await this.kernel.offerEffect(
            tx,
            actor,
            b.spaceId,
            b.actorId,
            'project.create',
            input.id,
            randomUUID(),
          );
        },
      );
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error;
    }
    const row = await this.hint(input.id);
    return this.run(
      actor,
      row,
      [this.request(row, 'task.read')],
      async (tx, a) => {
        const creatorMatches = await this.kernel.creatorIs(
          tx,
          row.createdByActorId,
          actor.userId,
        );
        if (
          !creatorMatches ||
          row.creationKey !== creationKey ||
          row.creationFingerprint !== fingerprint
        )
          throw new ConflictException();
        a.require(tx, row.spaceId, 'task.read');
        return this.view(
          tx,
          await tx.project.findUniqueOrThrow({ where: { id: row.id } }),
          a,
        );
      },
    );
  }
  async read(actor: RequestActor, id: string) {
    const row = await this.hint(id);
    return this.run(
      actor,
      row,
      [this.request(row, 'task.read', { kind: 'PROJECT', id }, true)],
      async (tx, a) => {
        a.require(tx, row.spaceId, 'task.read', { kind: 'PROJECT', id });
        return this.view(
          tx,
          await tx.project.findUniqueOrThrow({ where: { id } }),
          a,
        );
      },
    );
  }
  async list(actor: RequestActor, q: z.infer<typeof c.ProjectPageQuerySchema>) {
    this.kernel.assertEnabled();
    // Admission and source visibility are filtered before pagination; guests use named-resource routes.
    const hints = await this.kernel.readableContextHints(actor);
    const scopes = hints.ids,
      after = this.kernel.cursorPosition(
        'projects',
        hints.stamp,
        actor.userId,
        q.after,
      );
    const rows = await this.db.client.project.findMany({
      where: {
        ...(after ? { id: { gt: after } } : {}),
        scopeId: { in: scopes },
      },
      orderBy: { id: 'asc' },
      take: q.limit + 1,
    });
    const visible: Awaited<ReturnType<ProjectsService['read']>>[] = [];
    for (const row of rows) {
      try {
        const r = this.request(row, 'task.read', undefined, true);
        visible.push(
          await this.run(actor, row, [r], async (tx, a) =>
            this.view(
              tx,
              await tx.project.findUniqueOrThrow({ where: { id: row.id } }),
              a,
            ),
          ),
        );
      } catch (error) {
        if (
          error instanceof NotFoundException ||
          error instanceof ForbiddenException
        )
          continue;
        throw error;
      }
    }
    return this.kernel.cursorPage(
      'projects',
      hints.stamp,
      actor.userId,
      page(visible, q.limit),
    );
  }
  async patch(
    actor: RequestActor,
    id: string,
    revision: number,
    input: z.infer<typeof c.ProjectPatchSchema>,
  ) {
    const row = await this.hint(id),
      r = this.request(row, 'settings.manage');
    return this.run(
      actor,
      row,
      [r, this.request(row, 'task.read')],
      async (tx, a) => {
        const current = await tx.project.findUniqueOrThrow({ where: { id } });
        if (current.revision !== revision) throw new ConflictException();
        const after = await tx.project.update({
          where: { id },
          data: {
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.description !== undefined
              ? { description: input.description }
              : {}),
            revision: { increment: 1 },
            updatedAt: new Date(),
          },
        });
        await this.effect(tx, actor, a, r, 'project.update', id);
        return this.view(tx, after, a);
      },
    );
  }
  async lifecycle(
    actor: RequestActor,
    id: string,
    revision: number,
    action: 'archive' | 'restore' | 'delete',
    password?: string,
  ) {
    const row = await this.hint(id);
    return this.kernel.projectLifecycle(
      actor,
      row.spaceId,
      action,
      async (tx) => {
        const current = await tx.project.findUniqueOrThrow({ where: { id } });
        if (current.revision !== revision) throw new ConflictException();
        if (action === 'delete')
          await this.auth.verifyPasswordInside(
            tx,
            actor.userId,
            password ?? '',
          );
        const updated = await tx.project.update({
          where: { id },
          data: { revision: { increment: 1 }, updatedAt: new Date() },
        });
        return { id, projectId: id, revision: updated.revision };
      },
    );
  }
  private component(
    tx: Prisma.TransactionClient,
    kind: Kind,
    project: Project,
    id: string,
  ) {
    const where = {
      id,
      spaceId: project.spaceId,
      scopeId: project.scopeId,
      projectId: project.id,
    };
    return kind === 'phases'
      ? tx.projectPhase.findFirst({ where })
      : kind === 'sections'
        ? tx.projectSection.findFirst({ where })
        : tx.projectMilestone.findFirst({ where });
  }
  private componentInput(
    kind: Kind,
    input: {
      phaseId?: string | null | undefined;
      targetDate?: string | null | undefined;
      completed?: boolean | undefined;
    },
  ) {
    if (
      (kind === 'phases' && input.phaseId !== undefined) ||
      (kind !== 'milestones' &&
        (input.targetDate !== undefined || input.completed !== undefined))
    )
      throw new BadRequestException();
  }
  async components(
    actor: RequestActor,
    id: string,
    kind: Kind,
    q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    const row = await this.hint(id),
      r = this.request(row, 'task.read', undefined, true);
    return this.run(actor, row, [r], async (tx, a) => {
      a.require(tx, row.spaceId, 'task.read');
      const binding = this.kernel.scopeCursor(tx, a, r, 'components:' + kind),
        after = this.kernel.cursorPosition(
          binding.context,
          binding.stamp,
          actor.userId,
          q.after,
        );
      const position = after
        ? await this.component(tx, kind, row, after)
        : null;
      if (after && !position)
        throw new BadRequestException({ code: 'INVALID_CURSOR' });
      const query = {
        where: {
          projectId: id,
          spaceId: row.spaceId,
          scopeId: row.scopeId,
          ...(position
            ? {
                OR: [
                  { position: { gt: position.position } },
                  { position: position.position, id: { gt: position.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ position: 'asc' as const }, { id: 'asc' as const }],
        take: q.limit + 1,
      };
      const rows =
        kind === 'phases'
          ? await tx.projectPhase.findMany(query)
          : kind === 'sections'
            ? await tx.projectSection.findMany(query)
            : await tx.projectMilestone.findMany(query);
      return this.kernel.cursorPage(
        binding.context,
        binding.stamp,
        actor.userId,
        page(
          rows.map((v) => componentView(kind, v)),
          q.limit,
        ),
      );
    });
  }
  async createComponent(
    actor: RequestActor,
    id: string,
    kind: Kind,
    input: z.infer<typeof c.ProjectComponentCreateSchema>,
    rawKey: string | undefined,
  ) {
    this.componentInput(kind, input);
    const row = await this.hint(id),
      r = this.request(row, 'work.manage');
    return this.run(
      actor,
      row,
      [r, this.request(row, 'task.read')],
      async (tx, a) => {
        await this.once(
          tx,
          a,
          r,
          'project.' + kind + '.create',
          rawKey,
          input,
          async () => {
            if (
              input.phaseId &&
              !(await this.component(tx, 'phases', row, input.phaseId))
            )
              throw new NotFoundException();
            const data = {
              id: input.id,
              spaceId: row.spaceId,
              scopeId: row.scopeId,
              projectId: id,
              title: input.title,
              position: input.position,
            };
            const created =
              kind === 'phases'
                ? await tx.projectPhase.create({ data })
                : kind === 'sections'
                  ? await tx.projectSection.create({
                      data: { ...data, phaseId: input.phaseId ?? null },
                    })
                  : await tx.projectMilestone.create({
                      data: {
                        ...data,
                        phaseId: input.phaseId ?? null,
                        targetDate: input.targetDate
                          ? new Date(input.targetDate + 'T00:00:00Z')
                          : null,
                      },
                    });
            await this.effect(
              tx,
              actor,
              a,
              r,
              'project.' + kind + '.create',
              created.id,
            );
            return created;
          },
        );
        const result = await this.component(tx, kind, row, input.id);
        if (!result) throw new NotFoundException();
        return componentView(kind, result);
      },
    );
  }
  async patchComponent(
    actor: RequestActor,
    id: string,
    kind: Kind,
    componentId: string,
    revision: number,
    input: z.infer<typeof c.ProjectComponentPatchSchema>,
  ) {
    this.componentInput(kind, input);
    const row = await this.hint(id),
      r = this.request(row, 'work.manage');
    return this.run(
      actor,
      row,
      [r, this.request(row, 'task.read')],
      async (tx, a) => {
        const current = await this.component(tx, kind, row, componentId);
        if (!current) throw new NotFoundException();
        if (current.revision !== revision) throw new ConflictException();
        if (
          input.phaseId &&
          !(await this.component(tx, 'phases', row, input.phaseId))
        )
          throw new NotFoundException();
        const data = {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.position !== undefined ? { position: input.position } : {}),
          revision: { increment: 1 },
        };
        const result =
          kind === 'phases'
            ? await tx.projectPhase.update({ where: { id: componentId }, data })
            : kind === 'sections'
              ? await tx.projectSection.update({
                  where: { id: componentId },
                  data: {
                    ...data,
                    ...(input.phaseId !== undefined
                      ? { phaseId: input.phaseId }
                      : {}),
                  },
                })
              : await tx.projectMilestone.update({
                  where: { id: componentId },
                  data: {
                    ...data,
                    ...(input.phaseId !== undefined
                      ? { phaseId: input.phaseId }
                      : {}),
                    ...(input.targetDate !== undefined
                      ? {
                          targetDate: input.targetDate
                            ? new Date(input.targetDate + 'T00:00:00Z')
                            : null,
                        }
                      : {}),
                    ...(input.completed !== undefined
                      ? { completed: input.completed }
                      : {}),
                  },
                });
        await this.effect(
          tx,
          actor,
          a,
          r,
          'project.' + kind + '.update',
          componentId,
        );
        return componentView(kind, result);
      },
    );
  }
  async deleteComponent(
    actor: RequestActor,
    id: string,
    kind: Kind,
    componentId: string,
    revision: number,
  ) {
    const row = await this.hint(id),
      r = this.request(row, 'work.manage');
    return this.run(actor, row, [r], async (tx, a) => {
      const current = await this.component(tx, kind, row, componentId);
      if (!current) throw new NotFoundException();
      if (current.revision !== revision) throw new ConflictException();
      if (kind === 'phases')
        await tx.projectPhase.delete({ where: { id: componentId } });
      else if (kind === 'sections')
        await tx.projectSection.delete({ where: { id: componentId } });
      else await tx.projectMilestone.delete({ where: { id: componentId } });
      await this.effect(
        tx,
        actor,
        a,
        r,
        'project.' + kind + '.delete',
        componentId,
      );
      return { id: componentId, projectId: id, revision: revision + 1 };
    });
  }
  async source(
    actor: RequestActor,
    id: string,
    kind: 'TASK' | 'GOAL',
    sourceId: string,
  ) {
    const row = await this.hint(id);
    const r = this.request(row, 'task.read', { kind, id: sourceId }, true);
    return this.run(actor, row, [r], async (tx, a) =>
      kind === 'TASK'
        ? await this.tasks.read(tx, a, row.spaceId, sourceId)
        : await this.goals.read(tx, a, row.spaceId, sourceId),
    );
  }
  async sources(
    actor: RequestActor,
    id: string,
    kind: 'TASK' | 'GOAL',
    q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    const row = await this.hint(id),
      r = this.request(row, 'task.read', undefined, true);
    return this.run(actor, row, [r], async (tx, a) => {
      const binding = this.kernel.scopeCursor(
          tx,
          a,
          r,
          kind.toLowerCase() + 's',
        ),
        after = this.kernel.cursorPosition(
          binding.context,
          binding.stamp,
          actor.userId,
          q.after,
        ),
        query = { limit: q.limit, ...(after ? { after } : {}) };
      const value =
        kind === 'TASK'
          ? await this.tasks.list(tx, a, row.spaceId, query)
          : await this.goals.list(tx, a, row.spaceId, query);
      return this.kernel.cursorPage<
        z.infer<typeof c.SharedTaskSchema> | z.infer<typeof c.SharedGoalSchema>
      >(binding.context, binding.stamp, actor.userId, value);
    });
  }
  async createTask(
    actor: RequestActor,
    id: string,
    input: z.infer<typeof c.ProjectTaskCreateSchema>,
    rawKey: string | undefined,
  ) {
    const row = await this.hint(id),
      r = this.request(row, 'task.create');
    return this.run(
      actor,
      row,
      [r, this.request(row, 'task.read')],
      async (tx, a) => {
        await this.once(
          tx,
          a,
          r,
          'project.task.create',
          rawKey,
          input,
          async () => {
            await this.associationTargets(tx, row, input);
            await this.kernel.featureGrowth(tx, row.spaceId, 'task.shared');
            const task = await this.tasks.create(tx, a, row.spaceId, input);
            await tx.projectTask.create({
              data: {
                taskId: task.id,
                spaceId: row.spaceId,
                scopeId: row.scopeId,
                projectId: id,
                sectionId: input.sectionId ?? null,
                milestoneId: input.milestoneId ?? null,
              },
            });
            await this.effect(
              tx,
              actor,
              a,
              r,
              'task.create',
              task.id,
              'task.shared',
            );
            return task;
          },
        );
        return this.tasks.read(tx, a, row.spaceId, input.id);
      },
    );
  }
  async createGoal(
    actor: RequestActor,
    id: string,
    input: z.infer<typeof c.ProjectGoalCreateSchema>,
    rawKey: string | undefined,
  ) {
    const row = await this.hint(id),
      r = this.request(row, 'goal.manage');
    return this.run(
      actor,
      row,
      [r, this.request(row, 'task.read')],
      async (tx, a) => {
        await this.once(
          tx,
          a,
          r,
          'project.goal.create',
          rawKey,
          input,
          async () => {
            await this.associationTargets(tx, row, input);
            await this.kernel.featureGrowth(tx, row.spaceId, 'goal.shared');
            const goal = await this.goals.create(tx, a, row.spaceId, input);
            await tx.projectGoal.create({
              data: {
                goalId: goal.id,
                spaceId: row.spaceId,
                scopeId: row.scopeId,
                projectId: id,
                milestoneId: input.milestoneId ?? null,
              },
            });
            await this.effect(
              tx,
              actor,
              a,
              r,
              'goal.create',
              goal.id,
              'goal.shared',
            );
            return goal;
          },
        );
        return this.goals.read(tx, a, row.spaceId, input.id);
      },
    );
  }
  async patchTask(
    actor: RequestActor,
    id: string,
    sourceId: string,
    revision: number,
    input: z.infer<typeof c.ProjectTaskPatchSchema>,
    rawKey: string | undefined,
  ) {
    const row = await this.hint(id),
      resource = { kind: 'TASK' as const, id: sourceId },
      r = this.request(
        row,
        input.status === 'DONE' || input.status === 'OPEN'
          ? 'task.complete'
          : 'task.update',
        resource,
      ),
      requests = [r, this.request(row, 'task.read', resource)];
    if (
      input.title !== undefined ||
      input.description !== undefined ||
      input.priority !== undefined
    )
      requests.push(this.request(row, 'task.update', resource));
    return this.run(actor, row, requests, async (tx, a) => {
      await this.once(
        tx,
        a,
        r,
        'project.task.update',
        rawKey,
        { sourceId, revision, input },
        async () => {
          const result = await this.tasks.update(
            tx,
            a,
            row.spaceId,
            sourceId,
            revision,
            input,
          );
          await this.effect(tx, actor, a, r, 'task.update', sourceId);
          return result;
        },
      );
      return this.tasks.read(tx, a, row.spaceId, sourceId);
    });
  }
  async patchGoal(
    actor: RequestActor,
    id: string,
    sourceId: string,
    revision: number,
    input: z.infer<typeof c.ProjectGoalPatchSchema>,
    rawKey: string | undefined,
  ) {
    const row = await this.hint(id),
      resource = { kind: 'GOAL' as const, id: sourceId },
      r = this.request(row, 'goal.manage', resource);
    return this.run(
      actor,
      row,
      [r, this.request(row, 'task.read', resource)],
      async (tx, a) => {
        await this.once(
          tx,
          a,
          r,
          'project.goal.update',
          rawKey,
          { sourceId, revision, input },
          async () => {
            const result = await this.goals.update(
              tx,
              a,
              row.spaceId,
              sourceId,
              revision,
              input,
            );
            await this.effect(tx, actor, a, r, 'goal.update', sourceId);
            return result;
          },
        );
        return this.goals.read(tx, a, row.spaceId, sourceId);
      },
    );
  }
  private async associationTargets(
    tx: Prisma.TransactionClient,
    row: Project,
    input: {
      sectionId?: string | null | undefined;
      milestoneId?: string | null | undefined;
    },
  ) {
    if (
      input.sectionId &&
      !(await this.component(tx, 'sections', row, input.sectionId))
    )
      throw new NotFoundException();
    if (
      input.milestoneId &&
      !(await this.component(tx, 'milestones', row, input.milestoneId))
    )
      throw new NotFoundException();
  }
  async associate(
    actor: RequestActor,
    id: string,
    kind: 'TASK' | 'GOAL',
    sourceId: string,
    revision: number,
    input: { sectionId?: string | null; milestoneId: string | null },
  ) {
    const row = await this.hint(id),
      r = this.request(row, 'work.manage');
    return this.run(
      actor,
      row,
      [r, this.request(row, 'task.read')],
      async (tx, a) => {
        await this.associationTargets(tx, row, input);
        if (kind === 'TASK')
          await this.tasks.read(tx, a, row.spaceId, sourceId);
        else await this.goals.read(tx, a, row.spaceId, sourceId);
        const before =
          kind === 'TASK'
            ? await tx.projectTask.findUnique({ where: { taskId: sourceId } })
            : await tx.projectGoal.findUnique({ where: { goalId: sourceId } });
        if (!before || before.projectId !== id) throw new NotFoundException();
        if (before.revision !== revision) throw new ConflictException();
        if (kind === 'TASK')
          await tx.projectTask.update({
            where: { taskId: sourceId },
            data: {
              sectionId: input.sectionId ?? null,
              milestoneId: input.milestoneId,
              revision: { increment: 1 },
            },
          });
        else
          await tx.projectGoal.update({
            where: { goalId: sourceId },
            data: {
              milestoneId: input.milestoneId,
              revision: { increment: 1 },
            },
          });
        await this.effect(
          tx,
          actor,
          a,
          r,
          'project.association.change',
          sourceId,
        );
        return { id: sourceId, projectId: id, revision: revision + 1 };
      },
    );
  }
  async readAssociation(
    actor: RequestActor,
    id: string,
    kind: 'TASK' | 'GOAL',
    sourceId: string,
  ) {
    const row = await this.hint(id),
      r = this.request(row, 'task.read');
    return this.run(actor, row, [r], async (tx, a) => {
      if (kind === 'TASK') await this.tasks.read(tx, a, row.spaceId, sourceId);
      else await this.goals.read(tx, a, row.spaceId, sourceId);
      const link =
        kind === 'TASK'
          ? await tx.projectTask.findUnique({ where: { taskId: sourceId } })
          : await tx.projectGoal.findUnique({ where: { goalId: sourceId } });
      if (!link || link.projectId !== id) throw new NotFoundException();
      return kind === 'TASK'
        ? c.ProjectTaskAssociationViewSchema.strip().parse({
            ...link,
            id: sourceId,
          })
        : c.ProjectGoalAssociationViewSchema.strip().parse({
            ...link,
            id: sourceId,
          });
    });
  }
  async linkGoalTask(
    actor: RequestActor,
    id: string,
    goalId: string,
    taskId: string,
    revision: number,
  ) {
    const row = await this.hint(id),
      r = this.request(row, 'goal.manage');
    return this.run(
      actor,
      row,
      [r, this.request(row, 'task.read')],
      async (tx, a) => {
        const task = await this.tasks.read(tx, a, row.spaceId, taskId);
        await this.goals.linkTask(
          tx,
          a,
          row.spaceId,
          goalId,
          taskId,
          revision,
          task.revision,
        );
        await this.effect(tx, actor, a, r, 'goal.task.link', goalId);
        return { id: goalId, projectId: id, revision: revision + 1 };
      },
    );
  }
  async assignments(
    actor: RequestActor,
    id: string,
    q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    const row = await this.hint(id),
      r = this.request(row, 'work.manage', undefined);
    return this.run(actor, row, [r], async (tx, a) => {
      const binding = this.kernel.scopeCursor(tx, a, r, 'member-assignments'),
        after = this.kernel.cursorPosition(
          binding.context,
          binding.stamp,
          actor.userId,
          q.after,
        );
      const rows = await tx.projectMemberAssignment.findMany({
        where: { projectId: id, ...(after ? { id: { gt: after } } : {}) },
        orderBy: { id: 'asc' },
        take: q.limit + 1,
      });
      return this.kernel.cursorPage(
        binding.context,
        binding.stamp,
        actor.userId,
        page(rows.map(assignmentView), q.limit),
      );
    });
  }
  async assign(
    actor: RequestActor,
    id: string,
    input: z.infer<typeof c.ProjectMemberAssignmentCreateSchema>,
    rawKey: string | undefined,
  ) {
    const row = await this.hint(id),
      r = this.request(row, 'work.manage'),
      memberUser = await this.kernel.memberUserHint(
        row.spaceId,
        input.accessId,
      );
    return this.run(
      actor,
      row,
      [r],
      async (tx, a) => {
        await this.once(
          tx,
          a,
          r,
          'project.member.assign',
          rawKey,
          input,
          async () => {
            const kind: Kind =
              input.target.kind === 'PHASE'
                ? 'phases'
                : input.target.kind === 'SECTION'
                  ? 'sections'
                  : 'milestones';
            if (!(await this.component(tx, kind, row, input.target.id)))
              throw new NotFoundException();
            const access = await this.kernel.eligibleMember(
              tx,
              row.spaceId,
              input.accessId,
              memberUser,
            );
            const result = await tx.projectMemberAssignment.create({
              data: {
                id: input.id,
                spaceId: row.spaceId,
                scopeId: row.scopeId,
                projectId: id,
                accessId: access.id,
                generation: access.generation,
                phaseId: kind === 'phases' ? input.target.id : null,
                sectionId: kind === 'sections' ? input.target.id : null,
                milestoneId: kind === 'milestones' ? input.target.id : null,
              },
            });
            await this.effect(
              tx,
              actor,
              a,
              r,
              'project.member.assign',
              result.id,
            );
            return result;
          },
        );
        return assignmentView(
          await tx.projectMemberAssignment.findUniqueOrThrow({
            where: { id: input.id },
          }),
        );
      },
      memberUser ? [memberUser] : [],
    );
  }
  async revokeAssignment(
    actor: RequestActor,
    id: string,
    assignmentId: string,
    revision: number,
  ) {
    const row = await this.hint(id),
      r = this.request(row, 'work.manage');
    return this.run(actor, row, [r], async (tx, a) => {
      const before = await tx.projectMemberAssignment.findFirst({
        where: { id: assignmentId, projectId: id },
      });
      if (!before) throw new NotFoundException();
      if (before.revision !== revision || before.revokedAt)
        throw new ConflictException();
      const now = (
        await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() now`
      )[0]!.now;
      const result = await tx.projectMemberAssignment.update({
        where: { id: assignmentId },
        data: { revokedAt: now, revision: { increment: 1 } },
      });
      await this.effect(
        tx,
        actor,
        a,
        r,
        'project.member.unassign',
        assignmentId,
      );
      return assignmentView(result);
    });
  }
}
