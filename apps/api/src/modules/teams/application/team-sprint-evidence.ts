import { Inject, Injectable, PayloadTooLargeException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { SharedAuthority } from '../../spaces/public/index.js';
import { SharedTaskWork } from '../../tasks/public/index.js';

/** Immutable observations attached to existing activity, with no task titles or private content. */
@Injectable()
export class TeamSprintEvidence {
  constructor(@Inject(SharedTaskWork) private readonly work: SharedTaskWork) {}
  async snapshot(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    id: string,
    planId: string,
  ) {
    const items = await tx.teamWorkItem.findMany({
      where: {
        spaceId: a.space(tx, id),
        scopeId: id,
        planId,
        sourceScopeId: id,
        taskId: { not: null },
        Task: { deletedAt: null },
      },
      select: { taskId: true },
      take: 2001,
    });
    if (items.length > 2000) throw new PayloadTooLargeException();
    const ids = [...new Set(items.map((i) => i.taskId!))];
    const metrics = await this.work.metrics(tx, a, id, ids);
    const points = new Map(
      (
        await tx.teamTaskPoints.findMany({
          where: { spaceId: a.space(tx, id), scopeId: id, taskId: { in: ids } },
        })
      ).map((r) => [r.taskId, r.points]),
    );
    return {
      version: 1 as const,
      items: metrics.map((t) => ({
        taskId: t.taskId,
        status: t.status,
        minutes: t.estimatedMinutes,
        points: points.get(t.taskId) ?? null,
        completedAt: t.completedAt,
      })),
    };
  }
  async details(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    id: string,
    resourceId: string,
  ) {
    const plans = await tx.teamPlan.findMany({
      where: {
        spaceId: a.space(tx, id),
        scopeId: id,
        kind: 'SPRINT',
        OR: [{ state: 'ACTIVE' }, { id: resourceId }],
      },
      select: { id: true },
      take: 101,
    });
    if (plans.length > 100) throw new PayloadTooLargeException();
    const sprints: Record<
      string,
      Awaited<ReturnType<TeamSprintEvidence['snapshot']>>
    > = {};
    for (const p of plans) sprints[p.id] = await this.snapshot(tx, a, id, p.id);
    return { version: 1, sprints };
  }
}
