import { createHash } from 'node:crypto';
import { TeamProjects } from '../../projects/public/index.js';
import {
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { localKey, dayBoundary } from '../../calendar/public/index.js';
import { TeamInteractionContext } from './team-interaction.context.js';
import { TeamSprintEvidence } from './team-sprint-evidence.js';
import { addDays } from '../domain/collaboration.js';

@Injectable()
export class TeamSprintReportsService {
  constructor(
    @Inject(TeamProjects) private readonly projects: TeamProjects,
    @Inject(TeamInteractionContext) private readonly op: TeamInteractionContext,
    @Inject(TeamSprintEvidence) private readonly evidence: TeamSprintEvidence,
  ) {}
  burndown(actor: RequestActor, id: string, planId: string) {
    return this.op.read(actor, id, async (s) => {
      const p = await s.tx.teamPlan.findFirst({
        where: { ...this.op.scope(s), id: planId, kind: 'SPRINT' },
      });
      if (!p) throw new NotFoundException();
      const baseline = c.TeamSprintSnapshotSchema.safeParse(p.sprintBaseline);
      const rows = await s.tx.sharedAuditEvent.findMany({
        where: {
          ...this.op.scope(s),
          details: { path: ['sprints', planId, 'version'], equals: 1 },
        },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        take: 10001,
      });
      if (rows.length > 10000) throw new PayloadTooLargeException();
      const observations = rows.flatMap((r) => {
        const details = r.details as {
          sprints?: Record<string, unknown>;
        } | null;
        const parsed = c.TeamSprintSnapshotSchema.safeParse(
          details?.sprints?.[planId],
        );
        return parsed.success
          ? [{ at: r.occurredAt, snapshot: parsed.data }]
          : [];
      });
      const closed = c.TeamSprintSnapshotSchema.safeParse(
        p.sprintClosedEvidence,
      );
      const current =
        p.state === 'CLOSED' && closed.success
          ? closed.data
          : await this.evidence.snapshot(s.tx, s.a, id, planId);
      const last = observations.at(-1)?.snapshot;
      const consistent =
        !!last &&
        JSON.stringify(
          last.items
            .map((i) => [
              i.taskId,
              i.status,
              i.minutes,
              i.points,
              i.completedAt,
            ])
            .sort(),
        ) ===
          JSON.stringify(
            current.items
              .map((i) => [
                i.taskId,
                i.status,
                i.minutes,
                i.points,
                i.completedAt,
              ])
              .sort(),
          );
      const sufficient = baseline.success && !!p.publishedAt && consistent;
      const originalIds = new Set(
          baseline.success ? baseline.data.items.map((i) => i.taskId) : [],
        ),
        currentIds = new Set(current.items.map((i) => i.taskId));
      const days = [];
      for (
        let date = p.startDate.toISOString().slice(0, 10),
          end = p.endDate.toISOString().slice(0, 10);
        date < end;
        date = addDays(date, 1)
      ) {
        const cutoff = new Date(dayBoundary(addDays(date, 1), p.timezone));
        const observed = observations.filter((o) => o.at < cutoff).at(-1);
        const snapshot =
          sufficient &&
          date <= localKey(s.now, p.timezone).slice(0, 10) &&
          observed
            ? observed.snapshot
            : null;
        const live = snapshot?.items.filter(
          (i) => !['DONE', 'CANCELED'].includes(i.status),
        );
        days.push({
          date,
          remainingPoints:
            live && live.every((i) => i.points !== null)
              ? live.reduce((n, i) => n + i.points!, 0)
              : null,
          remainingMinutes:
            live && live.every((i) => i.minutes !== null)
              ? live.reduce((n, i) => n + i.minutes!, 0)
              : null,
          scopeTasks: snapshot?.items.length ?? null,
          completedTasks:
            snapshot?.items.filter((i) => i.status === 'DONE').length ?? null,
        });
      }
      return c.TeamBurndownSchema.parse({
        sourceBasis: 'TEAM_OWNED_TASKS',
        planId,
        startDate: p.startDate.toISOString().slice(0, 10),
        endDate: p.endDate.toISOString().slice(0, 10),
        timezone: p.timezone,
        asOf: s.now.toISOString(),
        basis: sufficient ? 'RECORDED_OBSERVATIONS' : 'INSUFFICIENT_HISTORY',
        originalCommittedTasks: baseline.success ? originalIds.size : null,
        originalCommittedPoints:
          baseline.success &&
          baseline.data.items.every((t) => t.points !== null)
            ? baseline.data.items.reduce((n, t) => n + t.points!, 0)
            : null,
        originalCommittedMinutes:
          baseline.success &&
          baseline.data.items.every((t) => t.minutes !== null)
            ? baseline.data.items.reduce((n, t) => n + t.minutes!, 0)
            : null,
        currentPoints: current.items.every((t) => t.points !== null)
          ? current.items.reduce((n, t) => n + t.points!, 0)
          : null,
        currentMinutes: current.items.every((t) => t.minutes !== null)
          ? current.items.reduce((n, t) => n + t.minutes!, 0)
          : null,
        currentTasks: currentIds.size,
        addedTasks: baseline.success
          ? [...currentIds].filter((t) => !originalIds.has(t)).length
          : null,
        removedTasks: baseline.success
          ? [...originalIds].filter((t) => !currentIds.has(t)).length
          : null,
        days,
      });
    });
  }
  async history(
    actor: RequestActor,
    id: string,
    planId: string,
    q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    const hints = await this.op.kernel.readableContextHints(actor, 'PROJECT');
    const refs = await this.projects.candidates(id, hints.ids);
    if (refs.length > 100) throw new PayloadTooLargeException();
    return this.op.read(
      actor,
      id,
      async (s) => {
        if (
          !(await s.tx.teamPlan.findFirst({
            where: { ...this.op.scope(s), id: planId },
          }))
        )
          throw new NotFoundException();
        const allowed = [
          id,
          ...(await this.projects.candidates(id, hints.ids, s.tx))
            .filter((r) =>
              s.a.has(s.tx, r.spaceId, 'task.read', undefined, r.projectId),
            )
            .map((r) => r.projectId),
        ];
        const page = await this.op.page(
          s,
          'sprint-history:' +
            createHash('sha256')
              .update(JSON.stringify([planId, hints.stamp, allowed]))
              .digest('hex')
              .slice(0, 24),
          q,
          async (after) => {
            const rows = await s.tx.sharedAuditEvent.findMany({
              where: {
                ...this.op.scope(s),
                OR: [
                  { resourceId: planId, action: { startsWith: 'team.plan.' } },
                  {
                    details: {
                      path: ['sprints', planId, 'version'],
                      equals: 1,
                    },
                  },
                ],
                AND: [
                  {
                    OR: [
                      { action: { not: { startsWith: 'team.item.' } } },
                      ...allowed.map((scopeId) => ({
                        details: { path: ['sourceScopeId'], equals: scopeId },
                      })),
                    ],
                  },
                ],
                ...(after ? { id: { gt: after } } : {}),
              },
              orderBy: { id: 'asc' },
              take: q.limit + 1,
            });
            return rows.map((r) => {
              const parsed = c.TeamSprintSnapshotSchema.safeParse(
                (r.details as { sprints?: Record<string, unknown> } | null)
                  ?.sprints?.[planId],
              );
              const items = parsed.success ? parsed.data.items : null,
                live = items?.filter(
                  (t) => !['DONE', 'CANCELED'].includes(t.status),
                );
              return c.TeamSprintHistoryPageSchema.shape.items.element.parse({
                id: r.id,
                actorId: r.actorId,
                at: r.occurredAt.toISOString(),
                action: r.action,
                resourceId: r.resourceId,
                changedFields: [],
                detailsBasis: 'RECORDED_METADATA_ONLY',
                observation:
                  items && live
                    ? {
                        scopeTasks: items.length,
                        completedTasks: items.filter((t) => t.status === 'DONE')
                          .length,
                        remainingPoints: live.every((t) => t.points !== null)
                          ? live.reduce((n, t) => n + t.points!, 0)
                          : null,
                        remainingMinutes: live.every((t) => t.minutes !== null)
                          ? live.reduce((n, t) => n + t.minutes!, 0)
                          : null,
                      }
                    : null,
              });
            });
          },
        );
        return c.TeamSprintHistoryPageSchema.parse(page);
      },
      [],
      refs.map((r) => ({
        spaceId: r.spaceId,
        scopeId: r.projectId,
        capability: 'task.read' as const,
        allowArchived: true,
      })),
    );
  }
  velocity(
    actor: RequestActor,
    id: string,
    q: z.infer<typeof c.TeamVelocityQuerySchema>,
  ) {
    return this.op.read(actor, id, async (s) => {
      const plans = await s.tx.teamPlan.findMany({
        where: { ...this.op.scope(s), kind: 'SPRINT', state: 'CLOSED' },
        orderBy: [{ closedAt: 'asc' }, { id: 'asc' }],
        take: 1001,
      });
      if (plans.length > 1000) throw new PayloadTooLargeException();
      const counted = new Set<string>();
      const items = plans
        .map((p) => {
          const parsed = c.TeamSprintSnapshotSchema.safeParse(
            p.sprintClosedEvidence,
          );
          const known =
            parsed.success && p.publishedAt !== null && p.closedAt !== null;
          const completed = parsed.success
            ? parsed.data.items.filter(
                (i) =>
                  i.status === 'DONE' &&
                  i.completedAt &&
                  p.publishedAt &&
                  p.closedAt &&
                  Date.parse(i.completedAt) >= +p.publishedAt &&
                  Date.parse(i.completedAt) <= +p.closedAt &&
                  !counted.has(i.taskId),
              )
            : [];
          for (const t of completed) counted.add(t.taskId);
          const missing = completed.filter((i) => i.points === null).length;
          return {
            planId: p.id,
            closedAt: p.closedAt?.toISOString() ?? null,
            completedPoints:
              known && !missing
                ? completed.reduce((n, i) => n + (i.points ?? 0), 0)
                : null,
            completedTasks: known ? completed.length : null,
            unestimatedTasks: known ? missing : null,
            state: known
              ? ('KNOWN' as const)
              : ('INSUFFICIENT_HISTORY' as const),
            scopePolicy: 'COMPLETED_IN_SPRINT_AND_PRESENT_AT_CLOSE' as const,
          };
        })
        .slice(-q.limit)
        .reverse();
      return c.TeamVelocitySchema.parse({
        sourceBasis: 'TEAM_OWNED_TASKS',
        basis: 'RECORDED_CLOSED_SPRINT_EVIDENCE_NO_TIME_CONVERSION',
        items,
      });
    });
  }
}
