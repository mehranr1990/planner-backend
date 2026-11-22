import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { appendProjectActivity } from './project-activity.js';
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
import { Prisma as P } from '../../../generated/prisma/client.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import { AuthService } from '../../../platform/auth/auth.service.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import {
  SharedKernel,
  SharedAuthority,
  ResourceGrants,
  CollaborationService,
} from '../../spaces/public/index.js';
import type { SharedRequest } from '../../spaces/public/index.js';
import { SharedTasks, ProjectTaskTools } from '../../tasks/public/index.js';
import { SharedGoals } from '../../goals/public/index.js';
import { initialProjectTemplates } from '../domain/initial-templates.js';
type Kind = z.infer<typeof c.ProjectComponentKindSchema>;
const hash = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
const templateNodeId = (projectId: string, key: string) => {
  const h = hash({ projectId, key, templateVersion: 1 });
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
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
    startDate:
      'startDate' in row
        ? (row.startDate?.toISOString().slice(0, 10) ?? null)
        : null,
    endDate:
      'endDate' in row
        ? (row.endDate?.toISOString().slice(0, 10) ?? null)
        : null,
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
    @Inject(ProjectTaskTools) private readonly taskTools: ProjectTaskTools,
    @Inject(SharedGoals) private readonly goals: SharedGoals,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ResourceGrants) private readonly grants: ResourceGrants,
    @Inject(CollaborationService)
    private readonly collaboration: CollaborationService,
  ) {}
  initialTemplates() {
    this.kernel.assertEnabled();
    return { items: initialProjectTemplates };
  }
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
        where: {
          id: target.id,
          spaceId: a.space(tx, spaceId),
          scopeId: a.scope(tx, spaceId),
        },
      }))
    )
      throw new NotFoundException();
  };
  async policy(actor: RequestActor, id: string) {
    const row = await this.hint(id);
    return c.ProjectPolicySchema.parse(
      await this.kernel.readPolicy(actor, row.scopeId),
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
      row.scopeId,
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
    return this.grants.revoke(actor, row.scopeId, grantId, revision);
  }
  async createContentGrantOffer(
    actor: RequestActor,
    id: string,
    input: z.infer<typeof c.ProjectContentGrantCreateSchema>,
    key: string | undefined,
  ) {
    const row = await this.hint(id);
    return this.grants.createOffer(
      actor,
      row.scopeId,
      input,
      key,
      this.validateGrantTarget,
      true,
    );
  }
  async revokeGrantOffer(
    actor: RequestActor,
    id: string,
    offerId: string,
    revision: number,
  ) {
    const row = await this.hint(id);
    return this.grants.revokeOffer(actor, row.scopeId, offerId, revision);
  }
  async leaveCollaboration(actor: RequestActor, id: string, revision: number) {
    const row = await this.hint(id);
    return this.kernel.departGuest(actor, row.scopeId, revision);
  }
  async lifecycleStatus(actor: RequestActor, id: string) {
    const row = await this.hint(id);
    return c.ProjectLifecycleSchema.parse(
      await this.kernel.projectStatus(actor, row.scopeId),
    );
  }
  async readGrantOffer(actor: RequestActor, id: string, offerId: string) {
    const row = await this.hint(id);
    return this.grants.readOffer(actor, row.scopeId, offerId);
  }
  async view(tx: Prisma.TransactionClient, row: Project, a: SharedAuthority) {
    const state = await this.kernel.contextState(tx, a, row.spaceId, row.id);
    return c.ProjectSchema.strip().parse({
      ...row,
      state,
      association: await this.kernel.contextAssociation(
        tx,
        a,
        row.spaceId,
        row.scopeId,
      ),
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
    details?: Prisma.InputJsonValue,
  ) {
    const access = a.require(
      tx,
      r.spaceId,
      r.capability,
      r.resource,
      r.scopeId,
    );
    if (!action.startsWith('project.member.'))
      await appendProjectActivity(
        tx,
        r.scopeId,
        access.actorId,
        action,
        id,
        r.resource ??
          (action.startsWith('task.')
            ? { kind: 'TASK', id }
            : action.startsWith('goal.')
              ? { kind: 'GOAL', id }
              : undefined),
        details,
      );
    await this.kernel.offerEffect(
      tx,
      actor,
      r.scopeId,
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
          a.require(tx, r.spaceId, r.capability, r.resource, r.scopeId)
            .generation +
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
    if (input.startDate && input.endDate && input.startDate > input.endDate)
      throw new BadRequestException();
    if (input.ownerTeamId)
      await this.collaboration.requireContextKind(input.ownerTeamId, 'TEAM');
    const additionalRequests: SharedRequest[] = input.ownerTeamId
      ? [
          {
            spaceId: input.ownerTeamId,
            scopeId: input.ownerTeamId,
            capability: 'settings.manage',
          },
        ]
      : [];
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
              key: input.key ?? null,
              keyOwnerTeamId: input.ownerTeamId ?? null,
              color: input.color ?? null,
              startDate: input.startDate ? new Date(input.startDate) : null,
              endDate: input.endDate ? new Date(input.endDate) : null,
              initialTemplate: input.template ?? 'BLANK',
              initialTemplateVersion: 1,
              creationKey,
              creationFingerprint: fingerprint,
            },
          });
          const template = initialProjectTemplates.find(
            (t) => t.id === (input.template ?? 'BLANK'),
          )!;
          const caps: SharedRequest['capability'][] = [
            'task.read',
            'workflow.publish',
            'work.manage',
            'settings.manage',
          ];
          const entries = [];
          for (const capability of caps)
            entries.push(
              await this.kernel.participantAuthority(
                tx,
                actor,
                actor.userId,
                { spaceId: b.spaceId, scopeId: b.scopeId, capability },
                [actor.userId],
              ),
            );
          for (const r of additionalRequests)
            entries.push(
              await this.kernel.participantAuthority(
                tx,
                actor,
                actor.userId,
                r,
                [actor.userId],
              ),
            );
          const a = new SharedAuthority(tx, entries);
          try {
            for (const [position, title] of template.sections.entries())
              await tx.projectSection.create({
                data: {
                  id: templateNodeId(input.id, 'section:' + position),
                  spaceId: b.spaceId,
                  scopeId: b.scopeId,
                  projectId: input.id,
                  title,
                  position,
                },
              });
            if (template.workflow) {
              const statuses = [
                'OPEN',
                'IN_PROGRESS',
                'DONE',
                'CANCELED',
              ] as const;
              const states = statuses.map((status) => ({
                id: templateNodeId(input.id, 'state:' + status),
                label: status.replaceAll('_', ' '),
                status,
              }));
              const edges = states.flatMap((from) =>
                states
                  .filter((to) => to.id !== from.id)
                  .map((to) => ({
                    id: templateNodeId(
                      input.id,
                      'edge:' + from.status + ':' + to.status,
                    ),
                    fromStateId: from.id,
                    toStateId: to.id,
                    requiresApproval: false,
                    approvers: [],
                  })),
              );
              const workflowId = templateNodeId(input.id, 'workflow');
              await this.taskTools.publishWorkflow(
                tx,
                a,
                {
                  spaceId: b.spaceId,
                  scopeId: b.scopeId,
                  actor,
                  lockedUsers: [actor.userId],
                },
                workflowId,
                0,
                { name: template.name, states, edges },
                hash({ project: input.id, template: template.id, version: 1 }),
                hash(template),
              );
              await this.kernel.offerEffect(
                tx,
                actor,
                b.scopeId,
                b.actorId,
                'workflow.publish',
                workflowId,
                randomUUID(),
                {
                  actorId: b.actorId,
                  feature: 'task.workflow-version',
                  delta: 1,
                },
              );
            }
            if (input.ownerTeamId) {
              const team = a.require(tx, input.ownerTeamId, 'settings.manage');
              await this.kernel.featureGrowth(
                tx,
                input.ownerTeamId,
                'team.project-reference',
              );
              await tx.teamProjectReference.create({
                data: {
                  teamId: input.ownerTeamId,
                  projectId: input.id,
                  spaceId: b.spaceId,
                },
              });
              await this.kernel.offerEffect(
                tx,
                actor,
                input.ownerTeamId,
                team.actorId,
                'team.project.reference',
                input.id,
                randomUUID(),
                {
                  actorId: team.actorId,
                  feature: 'team.project-reference',
                  delta: 1,
                },
              );
            }
          } finally {
            a.close();
          }
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
        'PROJECT',
        [],
        additionalRequests,
      );
    } catch (error) {
      if (
        error instanceof P.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException({ code: 'PROJECT_KEY_CONFLICT' });
      if (!(error instanceof ConflictException)) throw error;
      if (
        !(await this.db.client.project.findUnique({ where: { id: input.id } }))
      )
        throw error;
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
  async list(actor: RequestActor, q: z.infer<typeof c.ProjectListQuerySchema>) {
    this.kernel.assertEnabled();
    // Admission and source visibility are filtered before pagination; guests use named-resource routes.
    const hints = await this.kernel.readableContextHints(actor);
    const scopes = hints.ids,
      after = this.kernel.cursorPosition(
        q.manualStatus ? 'projects:' + q.manualStatus : 'projects',
        hints.stamp,
        actor.userId,
        q.after,
      );
    const rows = await this.db.client.project.findMany({
      where: {
        ...(after ? { id: { gt: after } } : {}),
        scopeId: { in: scopes },
        ...(q.manualStatus ? { manualStatus: q.manualStatus } : {}),
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
      q.manualStatus ? 'projects:' + q.manualStatus : 'projects',
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
      r = this.request(
        row,
        input.manualStatus !== undefined &&
          input.title === undefined &&
          input.description === undefined
          ? 'work.manage'
          : 'settings.manage',
      );
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
            ...(input.manualStatus !== undefined
              ? { manualStatus: input.manualStatus }
              : {}),
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.description !== undefined
              ? { description: input.description }
              : {}),
            revision: { increment: 1 },
            updatedAt: new Date(),
          },
        });
        await this.effect(
          tx,
          actor,
          a,
          r,
          'project.update',
          id,
          undefined,
          input.manualStatus !== undefined
            ? {
                changes: [
                  {
                    field: 'manualStatus',
                    from: current.manualStatus,
                    to: after.manualStatus,
                  },
                ],
              }
            : undefined,
        );
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
      row.scopeId,
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
      startDate?: string | null | undefined;
      endDate?: string | null | undefined;
    },
  ) {
    if (
      (kind === 'phases' && input.phaseId !== undefined) ||
      (kind !== 'phases' &&
        (input.startDate !== undefined || input.endDate !== undefined)) ||
      (input.startDate && input.endDate && input.startDate > input.endDate) ||
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
                ? await tx.projectPhase.create({
                    data: {
                      ...data,
                      startDate: input.startDate
                        ? new Date(input.startDate)
                        : null,
                      endDate: input.endDate ? new Date(input.endDate) : null,
                    },
                  })
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
        if (kind === 'phases') {
          const phase = current as ProjectPhase;
          const start =
            input.startDate !== undefined
              ? input.startDate
              : phase.startDate?.toISOString().slice(0, 10);
          const end =
            input.endDate !== undefined
              ? input.endDate
              : phase.endDate?.toISOString().slice(0, 10);
          if (start && end && start > end) throw new BadRequestException();
        }
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
        if (kind !== 'phases' && input.phaseId) {
          const conflict = await tx.projectTask.findFirst({
            where: {
              spaceId: row.spaceId,
              scopeId: row.scopeId,
              projectId: id,
              Task: { deletedAt: null },
              ...(kind === 'sections'
                ? {
                    sectionId: componentId,
                    ProjectMilestone: { phaseId: { not: input.phaseId } },
                  }
                : {
                    milestoneId: componentId,
                    ProjectSection: { phaseId: { not: input.phaseId } },
                  }),
            },
          });
          if (conflict)
            throw new ConflictException({ code: 'PROJECT_PHASE_MISMATCH' });
        }
        const result =
          kind === 'phases'
            ? await tx.projectPhase.update({
                where: { id: componentId },
                data: {
                  ...data,
                  ...(input.startDate !== undefined
                    ? {
                        startDate: input.startDate
                          ? new Date(input.startDate)
                          : null,
                      }
                    : {}),
                  ...(input.endDate !== undefined
                    ? {
                        endDate: input.endDate ? new Date(input.endDate) : null,
                      }
                    : {}),
                },
              })
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
          undefined,
          {
            changes: (
              [
                'title',
                'position',
                'phaseId',
                'targetDate',
                'completed',
                'startDate',
                'endDate',
              ] as const
            ).flatMap((field) => {
              const before = componentView(kind, current),
                after = componentView(kind, result);
              return after[field] !== before[field]
                ? [
                    {
                      field,
                      from: before[field] ?? null,
                      to: after[field] ?? null,
                    },
                  ]
                : [];
            }),
          },
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
      input.status &&
      (await this.taskTools.workflowHint(this.db.client, row.spaceId, sourceId))
    )
      requests.push(this.request(row, 'workflow.transition'));
    if (
      input.title !== undefined ||
      input.description !== undefined ||
      input.priority !== undefined ||
      input.parentTaskId !== undefined ||
      input.position !== undefined ||
      input.sectionId !== undefined
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
          const before = await this.tasks.read(tx, a, row.scopeId, sourceId);
          const { position, sectionId, ...patch } = input;
          const changes: {
            field: string;
            from: string | number | boolean | null;
            to: string | number | boolean | null;
          }[] = [];
          if (position !== undefined || sectionId !== undefined) {
            const link = await tx.projectTask.findFirst({
              where: {
                spaceId: row.spaceId,
                scopeId: row.scopeId,
                projectId: id,
                taskId: sourceId,
              },
            });
            if (!link) throw new NotFoundException();
            if (position !== undefined)
              changes.push({
                field: 'position',
                from: link.position,
                to: position,
              });
            if (sectionId !== undefined)
              changes.push({
                field: 'sectionId',
                from: link.sectionId,
                to: sectionId,
              });
            await this.associationTargets(tx, row, {
              sectionId: sectionId !== undefined ? sectionId : link.sectionId,
              milestoneId: link.milestoneId,
            });
            await tx.projectTask.update({
              where: { taskId: sourceId },
              data: {
                ...(position !== undefined ? { position } : {}),
                ...(sectionId !== undefined ? { sectionId } : {}),
                revision: { increment: 1 },
              },
            });
          }
          const result = await this.tasks.update(
            tx,
            a,
            row.spaceId,
            sourceId,
            revision,
            patch,
          );
          for (const field of [
            'title',
            'status',
            'priority',
            'parentTaskId',
          ] as const)
            if (patch[field] !== undefined && patch[field] !== before[field])
              changes.push({
                field,
                from: before[field] ?? null,
                to: patch[field] ?? null,
              });
          await this.effect(
            tx,
            actor,
            a,
            r,
            'task.update',
            sourceId,
            undefined,
            { changes },
          );
          return result;
        },
      );
      return this.tasks.read(tx, a, row.spaceId, sourceId);
    });
  }
  async children(
    actor: RequestActor,
    id: string,
    taskId: string,
    q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    const row = await this.hint(id),
      r = this.request(row, 'task.read');
    return this.run(actor, row, [r], async (tx, a) => {
      const b = this.kernel.scopeCursor(tx, a, r, 'subtasks:' + taskId);
      const after = this.kernel.cursorPosition(
        b.context,
        b.stamp,
        actor.userId,
        q.after,
      );
      return this.kernel.cursorPage(
        b.context,
        b.stamp,
        actor.userId,
        await this.tasks.children(tx, a, row.scopeId, taskId, {
          limit: q.limit,
          ...(after ? { after } : {}),
        }),
      );
    });
  }
  async removeTask(
    actor: RequestActor,
    id: string,
    taskId: string,
    revision: number,
    raw: string | undefined,
  ) {
    const row = await this.hint(id),
      resource = { kind: 'TASK' as const, id: taskId },
      r = this.request(row, 'task.delete', resource);
    return this.run(actor, row, [r], async (tx, a) => {
      await this.once(
        tx,
        a,
        r,
        'project.task.delete',
        raw,
        { taskId, revision },
        async () => {
          await this.tasks.remove(tx, a, row.scopeId, taskId, revision);
          const now = (
            await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() now`
          )[0]!.now;
          await tx.taskAssignment.updateMany({
            where: {
              spaceId: row.spaceId,
              scopeId: row.scopeId,
              projectId: id,
              taskId,
              endedAt: null,
            },
            data: {
              endedAt: now,
              endReason: 'REVOKED',
              revision: { increment: 1 },
            },
          });
          await this.effect(tx, actor, a, r, 'task.delete', taskId);
          return { id: taskId };
        },
      );
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
    const where = {
      spaceId: row.spaceId,
      scopeId: row.scopeId,
      projectId: row.id,
    };
    const section = input.sectionId
      ? await tx.projectSection.findFirst({
          where: { ...where, id: input.sectionId },
        })
      : null;
    const milestone = input.milestoneId
      ? await tx.projectMilestone.findFirst({
          where: { ...where, id: input.milestoneId },
        })
      : null;
    if ((input.sectionId && !section) || (input.milestoneId && !milestone))
      throw new NotFoundException();
    if (
      section?.phaseId &&
      milestone?.phaseId &&
      section.phaseId !== milestone.phaseId
    )
      throw new ConflictException({ code: 'PROJECT_PHASE_MISMATCH' });
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
        row.scopeId,
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
              row.scopeId,
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
