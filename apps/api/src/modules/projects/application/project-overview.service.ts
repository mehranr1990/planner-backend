import {
  Inject,
  Injectable,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import {
  CollaborationService,
  ordinaryCapabilities,
  fixedCapabilities,
} from '../../spaces/public/index.js';
import { ProjectExecutionContext } from './project-execution-context.js';
import type { ExecutionContext } from './project-execution-context.js';
import { ProjectsService } from './projects.service.js';
import { ProjectWorkMetricsService } from './project-work-metrics.service.js';

@Injectable()
export class ProjectOverviewService {
  constructor(
    @Inject(ProjectExecutionContext)
    private readonly op: ProjectExecutionContext,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(CollaborationService)
    private readonly collaboration: CollaborationService,
    @Inject(ProjectWorkMetricsService)
    private readonly metrics: ProjectWorkMetricsService,
  ) {}

  async accessMe(actor: RequestActor, pid: string) {
    const row = await this.projects.hint(pid);
    const read = {
      spaceId: row.spaceId,
      scopeId: row.scopeId,
      capability: 'task.read' as const,
      resource: { kind: 'PROJECT' as const, id: pid },
      allowArchived: true,
    };
    const catalog = [...ordinaryCapabilities, ...fixedCapabilities];
    return this.op.kernel.run(
      actor,
      { spaceIds: [row.spaceId], userIds: [] },
      [read],
      async (tx, a) => {
        const access = a.require(tx, pid, 'task.read', read.resource);
        const full = a.has(tx, pid, 'task.read');
        const current = await tx.project.findUniqueOrThrow({
          where: { id: pid },
        });
        const view = await this.projects.view(tx, current, a);
        return c.ProjectAccessMeSchema.parse({
          accessId: access.accessId,
          actorId: access.actorId,
          role: access.role,
          state: 'ACTIVE',
          generation: access.generation,
          scope: full ? 'FULL' : 'PROJECT',
          projectState: view.state,
          capabilities: full
            ? [
                ...catalog.filter((cap) => a.has(tx, pid, cap)),
                // Mirrors meeting source management: role and work.manage.
                ...(['OWNER', 'ADMIN', 'MANAGER'].includes(access.role ?? '') &&
                a.has(tx, pid, 'work.manage')
                  ? ['meeting.create']
                  : []),
              ].sort()
            : ['task.read'],
        });
      },
      undefined,
      catalog.map((capability) => ({
        spaceId: row.spaceId,
        scopeId: row.scopeId,
        capability,
        allowArchived: [
          'task.read',
          'file.read',
          'custody.archive',
          'custody.accept',
        ].includes(capability),
      })),
      true,
    );
  }

  private async metadataView(s: ExecutionContext) {
    const row = await s.tx.project.findFirstOrThrow({
      where: { id: s.pid, spaceId: s.spaceId, scopeId: s.scopeId },
    });
    const view = await this.projects.view(s.tx, row, s.a);
    return c.ProjectMetadataSchema.parse({
      id: row.id,
      title: row.title,
      key: row.key,
      color: row.color,
      summary: row.description,
      startDate: row.startDate?.toISOString().slice(0, 10) ?? null,
      endDate: row.endDate?.toISOString().slice(0, 10) ?? null,
      statusNote: row.statusNote,
      status: view.state,
      revision: row.revision,
    });
  }

  metadata(actor: RequestActor, pid: string) {
    return this.op.read(actor, pid, [], { kind: 'PROJECT', id: pid }, (s) =>
      this.metadataView(s),
    );
  }

  patchMetadata(
    actor: RequestActor,
    pid: string,
    revision: number,
    body: z.infer<typeof c.ProjectMetadataPatchSchema>,
  ) {
    const input = c.ProjectMetadataPatchSchema.parse(body);
    return this.op.write(
      actor,
      pid,
      ['settings.manage'],
      undefined,
      'project.metadata.update',
      pid,
      [],
      async (s) => {
        const current = await s.tx.project.findFirstOrThrow({
          where: { id: pid, spaceId: s.spaceId, scopeId: s.scopeId },
        });
        if (current.revision !== revision)
          throw new ConflictException({ code: 'STALE_REVISION' });
        const start =
          input.startDate !== undefined
            ? input.startDate
            : current.startDate?.toISOString().slice(0, 10);
        const end =
          input.endDate !== undefined
            ? input.endDate
            : current.endDate?.toISOString().slice(0, 10);
        if (start && end && start > end) throw new BadRequestException();
        await s.begin();
        await s.tx.project.update({
          where: { id: pid },
          data: {
            ...(input.key !== undefined ? { key: input.key } : {}),
            ...(input.color !== undefined ? { color: input.color } : {}),
            ...(input.summary !== undefined
              ? { description: input.summary }
              : {}),
            ...(input.startDate !== undefined
              ? {
                  startDate: input.startDate
                    ? new Date(input.startDate + 'T00:00:00Z')
                    : null,
                }
              : {}),
            ...(input.endDate !== undefined
              ? {
                  endDate: input.endDate
                    ? new Date(input.endDate + 'T00:00:00Z')
                    : null,
                }
              : {}),
            ...(input.statusNote !== undefined
              ? { statusNote: input.statusNote }
              : {}),
            revision: { increment: 1 },
            updatedAt: s.now,
          },
        });
        return this.metadataView(s);
      },
    );
  }

  members(
    actor: RequestActor,
    pid: string,
    query: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    return this.op.read(actor, pid, [], undefined, async (s) =>
      c.ProjectMemberDisplayPageSchema.parse(
        await this.op.page(s, 'member-display', query, (after) =>
          this.collaboration.memberDirectory(
            s.tx,
            s.a,
            pid,
            after,
            query.limit,
          ),
        ),
      ),
    );
  }
  handovers(
    actor: RequestActor,
    pid: string,
    query: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    return this.op.read(
      actor,
      pid,
      ['custody.handover'],
      undefined,
      async (s) =>
        c.ProjectHandoverPageSchema.parse(
          await this.op.page(s, 'owner-handovers', query, (after) =>
            this.collaboration.handoverPage(s.tx, s.a, pid, after, query.limit),
          ),
        ),
    );
  }

  async dashboard(
    actor: RequestActor,
    pid: string,
    query: z.infer<typeof c.ProjectReportWindowSchema>,
  ) {
    const report = await this.metrics.currentReport(actor, pid, query);
    const completedTasks = report.statusCounts.DONE;
    const eligibleTasks = report.taskCount - report.statusCounts.CANCELED;
    return c.ProjectDashboardSchema.parse({
      report,
      progress: {
        basis: 'DONE_OVER_NON_CANCELED_VISIBLE_TASKS',
        completedTasks,
        eligibleTasks,
        percent: eligibleTasks
          ? Math.round((completedTasks / eligibleTasks) * 10000) / 100
          : null,
      },
      health: {
        basis: 'CURRENT_AUTHORIZED_PROJECT_DATA',
        overdueTaskCount: report.overdueTaskCount,
        openRiskCount: report.openRiskCount,
        openIssueCount: report.openIssueCount,
      },
    });
  }
}
