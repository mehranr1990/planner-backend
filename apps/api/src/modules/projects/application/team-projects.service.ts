import type { TeamProjectReference } from '../../../generated/prisma/client.js';
import * as c from '@mehran/api-contracts';
const associationRequestView = (row: TeamProjectReference | null) =>
  row?.requestId
    ? c.TeamAssociationRequestSchema.parse({
        id: row.requestId,
        action: row.requestAction,
        state: row.requestState,
        requestedAt: row.requestCreatedAt?.toISOString(),
        reviewedAt: row.requestReviewedAt?.toISOString() ?? null,
      })
    : null;
import type { z } from 'zod';
import {
  Inject,
  Injectable,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { SharedAuthority, SharedKernel } from '../../spaces/public/index.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import { ProjectsService } from './projects.service.js';
import { SharedTaskWork } from '../../tasks/public/index.js';
@Injectable()
export class TeamProjects {
  async cleanup(tx: Prisma.TransactionClient, scope: SharedCleanupScope) {
    scope.verify(tx);
    const count =
      await tx.$executeRaw`DELETE FROM "TeamProjectReference" WHERE ctid IN (SELECT ctid FROM "TeamProjectReference" WHERE "teamId"=${scope.scopeId ?? scope.spaceId}::uuid LIMIT 200)`;
    return count === 0;
  }
  async analytics(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    teamId: string,
    projectId: string,
    window: {
      fromDate: string;
      toDate: string;
      timezone: string;
      from: Date;
      to: Date;
    },
  ) {
    a.require(tx, teamId, 'task.read');
    const ref = await tx.teamProjectReference.findFirst({
      where: { teamId, projectId, active: true },
    });
    if (!ref) throw new NotFoundException();
    a.require(tx, ref.spaceId, 'task.read', undefined, projectId);
    const where = { spaceId: ref.spaceId, scopeId: projectId, projectId };
    const links = await tx.projectTask.findMany({
      where: { ...where, Task: { deletedAt: null } },
      select: { taskId: true },
      take: 10001,
    });
    const goalCount = await tx.projectGoal.count({ where });
    const allocations = await tx.projectWorkAllocation.findMany({
      where: {
        ...where,
        timezone: window.timezone,
        date: { gte: new Date(window.fromDate), lt: new Date(window.toDate) },
        TaskAssignment: { decision: 'ACCEPTED', endedAt: null },
      },
      take: 10001,
    });
    if (links.length + allocations.length + goalCount > 10000)
      throw new PayloadTooLargeException();
    const tasks = await this.work.metrics(
      tx,
      a,
      projectId,
      links.map((r) => r.taskId),
    );
    const logs = await this.work.effort(
      tx,
      a,
      projectId,
      links.map((r) => r.taskId),
      window.from,
      window.to,
    );
    const eligible = [];
    for (const row of allocations) {
      if (
        await this.kernel.visibleWorkMember(
          tx,
          a,
          projectId,
          row.accessId,
          row.generation,
        )
      )
        eligible.push(row);
    }
    return {
      spaceId: ref.spaceId,
      scopeId: projectId,
      tasks,
      logs,
      goalCount,
      allocations: eligible,
    };
  }
  /** Active Team link and Project title. Callers must authorize an independent Project read first. */
  async linkedProject(
    tx: Prisma.TransactionClient,
    teamId: string,
    projectId: string,
  ) {
    const ref = await tx.teamProjectReference.findFirst({
      where: { teamId, projectId, active: true },
    });
    if (!ref) return null;
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { title: true },
    });
    return project ? { spaceId: ref.spaceId, title: project.title } : null;
  }
  /** PH (owner-approved): health derived only from deadlines, recorded progress and blocked work. */
  async health(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    teamId: string,
    projectId: string,
    asOf: Date,
  ) {
    a.require(tx, teamId, 'task.read');
    const ref = await tx.teamProjectReference.findFirst({
      where: { teamId, projectId, active: true },
    });
    if (!ref) throw new NotFoundException();
    a.require(tx, ref.spaceId, 'task.read', undefined, projectId);
    const project = await tx.project.findUniqueOrThrow({
      where: { id: projectId },
    });
    const links = await tx.projectTask.findMany({
      where: {
        spaceId: ref.spaceId,
        scopeId: projectId,
        projectId,
        Task: { deletedAt: null },
      },
      select: { taskId: true },
      take: 10001,
    });
    if (links.length > 10000) throw new PayloadTooLargeException();
    const ids = links.map((r) => r.taskId),
      tasks = await this.work.metrics(tx, a, projectId, ids),
      blocked = await this.work.blocked(tx, a, projectId, ids),
      live = tasks.filter(
        (t) => t.status === 'OPEN' || t.status === 'IN_PROGRESS',
      ),
      counted = tasks.filter((t) => t.status !== 'CANCELED').length;
    return {
      title: project.title,
      total: tasks.length,
      openTasks: live.length,
      overdueOpenTasks: live.filter(
        (t) => t.dueAt !== null && new Date(t.dueAt) < asOf,
      ).length,
      blockedOpenTasks: live.filter((t) => blocked.has(t.taskId)).length,
      progress: counted
        ? Math.round(
            (tasks.filter((t) => t.status === 'DONE').length * 10000) / counted,
          )
        : null,
    };
  }
  constructor(
    @Inject(SharedTaskWork) private readonly work: SharedTaskWork,
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
  ) {}
  async hint(id: string) {
    return this.projects.hint(id);
  }
  async candidates(
    teamId: string,
    visibleIds: string[],
    tx?: Prisma.TransactionClient,
  ) {
    return (tx ?? this.db.client).teamProjectReference.findMany({
      where: { teamId, active: true, projectId: { in: visibleIds } },
      select: {
        teamId: true,
        projectId: true,
        spaceId: true,
        revision: true,
        active: true,
      },
      orderBy: { projectId: 'asc' },
    });
  }
  async sourceReference(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    teamId: string,
    target: {
      kind: 'TASK' | 'GOAL';
      spaceId: string;
      scopeId: string;
      id: string;
    },
  ) {
    a.require(tx, teamId, 'task.read');
    a.require(tx, target.spaceId, 'task.read', undefined, target.scopeId);
    const ref = await tx.teamProjectReference.findFirst({
      where: {
        teamId,
        projectId: target.scopeId,
        spaceId: target.spaceId,
        active: true,
      },
    });
    if (!ref) throw new NotFoundException();
    const source =
      target.kind === 'TASK'
        ? await tx.projectTask.findFirst({
            where: {
              spaceId: target.spaceId,
              projectId: ref.projectId,
              taskId: target.id,
            },
          })
        : await tx.projectGoal.findFirst({
            where: {
              spaceId: target.spaceId,
              projectId: ref.projectId,
              goalId: target.id,
            },
          });
    if (!source) throw new NotFoundException();
  }
  async list(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    teamId: string,
    visibleIds: string[],
  ) {
    a.require(tx, teamId, 'task.read');
    const rows = await tx.teamProjectReference.findMany({
      where: { teamId, active: true, projectId: { in: visibleIds } },
      orderBy: { projectId: 'asc' },
    });
    const result = [];
    for (const row of rows) {
      a.require(tx, row.spaceId, 'task.read', undefined, row.projectId);
      const project = await tx.project.findUniqueOrThrow({
        where: { id: row.projectId },
      });
      result.push({
        link: {
          teamId,
          projectId: row.projectId,
          revision: row.revision,
          active: row.active,
        },
        project: await this.projects.view(tx, project, a),
      });
    }
    return result;
  }
  associationCandidates(
    teamId: string,
    ids: string[],
    tx: Prisma.TransactionClient = this.db.client,
  ) {
    return tx.teamProjectReference.findMany({
      where: {
        teamId,
        projectId: { in: ids },
        requestState: 'PENDING',
      },
      select: { projectId: true, spaceId: true, revision: true },
      orderBy: { projectId: 'asc' },
      take: 101,
    });
  }
  async associationHistory(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    teamId: string,
    projectId: string,
    after: string | undefined,
    limit: number,
  ) {
    await this.associationView(tx, a, teamId, projectId);
    const rows = await tx.sharedAuditEvent.findMany({
      where: {
        spaceId: a.space(tx, teamId),
        scopeId: teamId,
        resourceId: projectId,
        action: { startsWith: 'team.project.association.' },
        ...(after ? { id: { gt: after } } : {}),
      },
      orderBy: { id: 'asc' },
      take: limit + 1,
    });
    return rows.map((r) =>
      c.TeamAssociationHistoryPageSchema.shape.items.element.parse({
        request:
          c.TeamAssociationRequestSchema.safeParse(
            (r.details as { associationRequest?: unknown } | null)
              ?.associationRequest,
          ).data ?? null,
        id: r.id,
        actorId: r.actorId,
        at: r.occurredAt.toISOString(),
        action: r.action,
        resourceId: r.resourceId,
        changedFields: [],
        detailsBasis: 'RECORDED_METADATA_ONLY',
      }),
    );
  }
  async associationView(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    teamId: string,
    projectId: string,
  ) {
    a.require(tx, teamId, 'task.read');
    const p = await tx.project.findUnique({ where: { id: projectId } });
    if (!p) throw new NotFoundException();
    a.require(tx, p.spaceId, 'task.read', undefined, projectId);
    const row = await tx.teamProjectReference.findUnique({
      where: { teamId_projectId: { teamId, projectId } },
    });
    return c.TeamAssociationSchema.parse({
      teamId,
      projectId,
      revision: row?.revision ?? 1,
      active: row?.active ?? false,
      request: associationRequestView(row),
      implications: {
        grantsProjectMembership: false,
        changesCustody: false,
        changesRetention: false,
      },
    });
  }
  async requestAssociation(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    actor: RequestActor,
    teamId: string,
    projectId: string,
    revision: number | undefined,
    body: z.infer<typeof c.TeamAssociationInputSchema>,
  ) {
    const access = a.require(tx, teamId, 'settings.manage');
    const p = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
    a.require(tx, p.spaceId, 'task.read', undefined, projectId);
    const row = await tx.teamProjectReference.findUnique({
      where: { teamId_projectId: { teamId, projectId } },
    });
    if (
      (row ? row.revision !== revision : revision !== 1) ||
      row?.requestState === 'PENDING' ||
      row?.requestId === body.id ||
      (body.action === 'LINK' && row?.active) ||
      (body.action === 'UNLINK' && !row?.active)
    )
      throw new ConflictException();
    const at = (
      await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() now`
    )[0]!.now;
    const associationRequest = {
      ...body,
      state: 'PENDING',
      requestedAt: at.toISOString(),
      reviewedAt: null,
    };
    if (row)
      await tx.teamProjectReference.update({
        where: { teamId_projectId: { teamId, projectId } },
        data: {
          requestId: associationRequest.id,
          requestAction: associationRequest.action,
          requestState: associationRequest.state,
          requestCreatedAt: new Date(associationRequest.requestedAt),
          requestReviewedAt: associationRequest.reviewedAt
            ? new Date(associationRequest.reviewedAt)
            : null,
          revision: { increment: 1 },
        },
      });
    else {
      await this.kernel.featureGrowth(tx, teamId, 'team.project-reference');
      await tx.teamProjectReference.create({
        data: {
          teamId,
          projectId,
          spaceId: p.spaceId,
          active: false,
          revision: 2,
          requestId: associationRequest.id,
          requestAction: associationRequest.action,
          requestState: associationRequest.state,
          requestCreatedAt: at,
        },
      });
    }
    await this.kernel.offerEffect(
      tx,
      actor,
      teamId,
      access.actorId,
      'team.project.association.request',
      projectId,
      randomUUID(),
      !row
        ? {
            actorId: access.actorId,
            feature: 'team.project-reference',
            delta: 1,
          }
        : undefined,
      { associationRequest },
    );
  }
  async reviewAssociation(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    actor: RequestActor,
    teamId: string,
    projectId: string,
    revision: number,
    decision: 'APPROVE' | 'REJECT' | 'CANCEL',
  ) {
    const access = a.require(tx, teamId, 'settings.manage');
    const row = await tx.teamProjectReference.findUnique({
      where: { teamId_projectId: { teamId, projectId } },
    });
    if (!row) throw new NotFoundException();
    const parsed = c.TeamAssociationRequestSchema.safeParse(
      associationRequestView(row),
    );
    if (
      !parsed.success ||
      parsed.data.state !== 'PENDING' ||
      row.revision !== revision
    )
      throw new ConflictException();
    if (decision !== 'CANCEL')
      a.require(tx, row.spaceId, 'settings.manage', undefined, projectId);
    if (decision === 'APPROVE')
      await this.reference(
        tx,
        a,
        actor,
        teamId,
        projectId,
        revision,
        parsed.data.action === 'LINK',
      );
    const at = (
      await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() now`
    )[0]!.now;
    const associationRequest = {
      ...parsed.data,
      state:
        decision === 'APPROVE'
          ? 'APPROVED'
          : decision === 'REJECT'
            ? 'REJECTED'
            : 'CANCELED',
      reviewedAt: at.toISOString(),
    };
    await tx.teamProjectReference.update({
      where: { teamId_projectId: { teamId, projectId } },
      data: {
        requestState: associationRequest.state,
        requestReviewedAt: at,
        revision: { increment: 1 },
      },
    });
    await this.kernel.offerEffect(
      tx,
      actor,
      teamId,
      access.actorId,
      'team.project.association.' + decision.toLowerCase(),
      projectId,
      randomUUID(),
      undefined,
      { associationRequest },
    );
  }
  async reference(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    actor: RequestActor,
    teamId: string,
    projectId: string,
    revision: number | undefined,
    active: boolean,
  ) {
    const project = await tx.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException();
    const ta = a.require(tx, teamId, 'settings.manage');
    const pa = a.require(
      tx,
      project.spaceId,
      'settings.manage',
      undefined,
      project.scopeId,
    );
    const prior = await tx.teamProjectReference.findUnique({
      where: { teamId_projectId: { teamId, projectId } },
    });
    if (prior?.active && active && revision === undefined)
      return { teamId, projectId, revision: prior.revision, active: true };
    if (prior ? revision !== prior.revision : revision !== undefined || !active)
      throw new ConflictException();
    if (!prior)
      await this.kernel.featureGrowth(tx, teamId, 'team.project-reference');
    const row = prior
      ? await tx.teamProjectReference.update({
          where: { teamId_projectId: { teamId, projectId } },
          data: { active, revision: { increment: 1 } },
        })
      : await tx.teamProjectReference.create({
          data: { teamId, projectId, spaceId: project.spaceId },
        });
    for (const access of [ta, pa])
      await this.kernel.offerEffect(
        tx,
        actor,
        access.spaceId,
        access.actorId,
        active ? 'team.project.reference' : 'team.project.unreference',
        projectId,
        randomUUID(),
        !prior && access.spaceId === teamId
          ? { actorId: ta.actorId, feature: 'team.project-reference', delta: 1 }
          : undefined,
      );
    return { teamId, projectId, revision: row.revision, active: row.active };
  }
}
import type { SharedCleanupScope } from '../../../platform/lifecycle/shared-cleanup.js';
