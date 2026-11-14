import {
  Inject,
  Injectable,
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { SharedKernel } from '../../spaces/public/index.js';
import type {
  SharedAuthority,
  SharedRequest,
} from '../../spaces/public/index.js';
import { SharedTaskWork } from '../../tasks/public/index.js';
import { TeamProjects } from '../../projects/public/index.js';
import { TeamsService } from './teams.service.js';
import { addDays } from '../domain/collaboration.js';
type Tx = Prisma.TransactionClient;
type Page = z.infer<typeof c.ProjectPageQuerySchema>;
const request = (id: string): SharedRequest => ({
  spaceId: id,
  scopeId: id,
  capability: 'task.read',
});
const date = (v: string) => new Date(v + 'T00:00:00Z');
const localDay = (at: Date, timezone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b),
    mid = Math.floor(sorted.length / 2);
  return Math.round(
    sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2,
  );
};
const minutes = (a: Date, b: Date) =>
  Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
@Injectable()
export class TeamInsightsService {
  constructor(
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(TeamsService) private readonly teams: TeamsService,
    @Inject(SharedTaskWork) private readonly work: SharedTaskWork,
    @Inject(TeamProjects) private readonly projects: TeamProjects,
  ) {}
  private async run<T>(
    actor: RequestActor,
    id: string,
    work: (tx: Tx, a: SharedAuthority) => Promise<T>,
    optional: string[] = [],
  ) {
    await this.teams.hint(id);
    return this.kernel.run(
      actor,
      { userIds: [], spaceIds: [id, ...optional] },
      [{ ...request(id), allowArchived: true }],
      work,
      undefined,
      optional.map((p) => ({ ...request(p), allowArchived: true })),
      true,
    );
  }
  private async now(tx: Tx) {
    return (
      await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() now`
    )[0]!.now;
  }
  private scope(tx: Tx, a: SharedAuthority, id: string) {
    return { spaceId: a.space(tx, id), scopeId: id };
  }

  /** CA: availability, approved time off, reserved (estimated) and actual work, per member and day. */
  capacitySummary(
    actor: RequestActor,
    id: string,
    query: z.infer<typeof c.TeamCapacitySummaryQuerySchema>,
  ) {
    const q = c.TeamCapacitySummaryQuerySchema.parse(query);
    if (
      q.to < q.from ||
      (date(q.to).getTime() - date(q.from).getTime()) / 86400000 > 30
    )
      throw new BadRequestException({ code: 'RANGE_TOO_LARGE' });
    try {
      localDay(new Date(), q.timezone);
    } catch {
      throw new BadRequestException({ code: 'INVALID_TIMEZONE' });
    }
    return this.run(actor, id, async (tx, a) => {
      const me = a.require(tx, id, 'task.read'),
        scope = this.scope(tx, a, id);
      const members = (await this.kernel.currentMemberships(tx, a, id))
        .filter((m) => m.state === 'ACTIVE')
        .filter(
          (m) =>
            me.role !== 'VIEWER' ||
            (m.id === me.accessId && m.generation === me.generation),
        );
      if (members.length > 500) throw new PayloadTooLargeException();
      const dates: string[] = [];
      for (let d = q.from; d <= q.to; d = addDays(d, 1)) dates.push(d);
      const who = members.map((m) => ({
        accessId: m.id,
        generation: m.generation,
      }));
      const capacities = who.length
        ? await tx.teamCapacityDay.findMany({
            where: {
              ...scope,
              timezone: q.timezone,
              date: { gte: date(q.from), lte: date(q.to) },
              OR: who,
            },
          })
        : [];
      const timeOff = who.length
        ? await tx.teamTimeOff.findMany({
            where: {
              ...scope,
              state: 'APPROVED',
              startDate: { lte: date(q.to) },
              endDate: { gte: date(q.from) },
              OR: who,
            },
          })
        : [];
      const assignments = who.length
        ? await tx.teamTaskAssignment.findMany({
            where: {
              ...scope,
              state: 'ACCEPTED',
              OR: who.map((m) => ({
                assigneeAccessId: m.accessId,
                assigneeGeneration: m.generation,
              })),
            },
            take: 10001,
          })
        : [];
      if (assignments.length > 10000) throw new PayloadTooLargeException();
      const taskIds = [...new Set(assignments.map((r) => r.taskId))];
      const visible = new Set(
        (await this.work.scopeMetrics(tx, a, id)).map((t) => t.taskId),
      );
      const metrics = new Map(
        (
          await this.work.metrics(
            tx,
            a,
            id,
            taskIds.filter((t) => visible.has(t)),
          )
        ).map((t) => [t.taskId, t]),
      );
      const from = new Date(date(q.from).getTime() - 86400000),
        to = new Date(date(q.to).getTime() + 2 * 86400000);
      const logs = await this.work.taskEffort(
        tx,
        a,
        id,
        [...visible],
        from,
        to,
      );
      const empty = () => ({
        availableMinutes: 0,
        unknownDays: 0,
        timeOffMinutes: 0,
        netAvailableMinutes: 0,
        reservedMinutes: 0,
        actualMinutes: 0,
        bookedBasisPoints: null as number | null,
      });
      const finish = (t: ReturnType<typeof empty>) => ({
        ...t,
        bookedBasisPoints:
          t.unknownDays || !t.netAvailableMinutes
            ? null
            : Math.round((t.reservedMinutes * 10000) / t.netAvailableMinutes),
      });
      const team = empty();
      const rows = members.map((m) => {
        const key = (r: { accessId: string; generation: number }) =>
          r.accessId === m.id && r.generation === m.generation;
        const totals = empty();
        const days = dates.map((d) => {
          const cap = capacities.find(
            (r) => key(r) && r.date.toISOString().slice(0, 10) === d,
          );
          const available = cap?.availableMinutes ?? null;
          const off = timeOff
            .filter(
              (r) =>
                key(r) &&
                r.startDate.toISOString().slice(0, 10) <= d &&
                r.endDate.toISOString().slice(0, 10) >= d,
            )
            .reduce(
              (n, r) =>
                n + (r.minutesPerDay ?? (available === null ? 0 : available)),
              0,
            );
          const timeOffMinutes =
            available === null ? off : Math.min(available, off);
          const reserved = assignments
            .filter(
              (r) =>
                r.assigneeAccessId === m.id &&
                r.assigneeGeneration === m.generation,
            )
            .map((r) => metrics.get(r.taskId))
            .filter(
              (t) =>
                t &&
                ['OPEN', 'IN_PROGRESS'].includes(t.status) &&
                t.scheduledDate === d,
            )
            .reduce((n, t) => n + (t!.estimatedMinutes ?? 0), 0);
          const actual = logs
            .filter((l) => key(l) && localDay(l.startedAt, q.timezone) === d)
            .reduce((n, l) => n + minutes(l.startedAt, l.endedAt), 0);
          const net =
            available === null ? null : Math.max(0, available - timeOffMinutes);
          for (const t of [totals, team]) {
            if (available === null) t.unknownDays++;
            else t.availableMinutes += available;
            t.timeOffMinutes += timeOffMinutes;
            t.netAvailableMinutes += net ?? 0;
            t.reservedMinutes += reserved;
            t.actualMinutes += actual;
          }
          return {
            date: d,
            availableMinutes: available,
            timeOffMinutes,
            netAvailableMinutes: net,
            reservedMinutes: reserved,
            actualMinutes: actual,
          };
        });
        return {
          member: { accessId: m.id, generation: m.generation },
          days,
          totals: finish(totals),
        };
      });
      return c.TeamCapacitySummarySchema.parse({
        from: q.from,
        to: q.to,
        timezone: q.timezone,
        members: rows,
        totals: finish(team),
      });
    });
  }

  /** PH + PM: health of linked Projects the caller reads independently, and shared people. */
  async projectSummaries(actor: RequestActor, id: string, q: Page) {
    await this.teams.hint(id);
    const hints = await this.kernel.readableContextHints(actor),
      refs = (await this.projects.candidates(id, hints.ids)).filter(
        (r) => !q.after || r.projectId > q.after,
      );
    const selected = refs.slice(0, q.limit + 1);
    return this.run(
      actor,
      id,
      async (tx, a) => {
        const asOf = await this.now(tx);
        const teamUsers = new Map<
          string,
          { accessId: string; generation: number }
        >();
        for (const m of await this.kernel.currentMemberships(tx, a, id)) {
          if (m.state !== 'ACTIVE') continue;
          const user = await this.kernel.memberUserInTransaction(tx, id, m.id);
          if (user)
            teamUsers.set(user, { accessId: m.id, generation: m.generation });
        }
        const items = [];
        for (const ref of selected.slice(0, q.limit)) {
          if (!a.has(tx, ref.projectId, 'task.read', undefined, ref.projectId))
            continue;
          const health = await this.projects.health(
            tx,
            a,
            id,
            ref.projectId,
            asOf,
          );
          const commonMembers = [];
          for (const m of await this.kernel.currentMemberships(
            tx,
            a,
            ref.projectId,
          )) {
            if (m.state !== 'ACTIVE') continue;
            const user = await this.kernel.memberUserInTransaction(
              tx,
              ref.projectId,
              m.id,
            );
            const member = user ? teamUsers.get(user) : undefined;
            if (member) commonMembers.push({ member, projectAccessId: m.id });
          }
          items.push(
            c.TeamProjectSummarySchema.parse({
              projectId: ref.projectId,
              title: health.title,
              health: {
                state:
                  health.total === 0
                    ? 'UNKNOWN'
                    : health.overdueOpenTasks
                      ? 'OFF_TRACK'
                      : health.blockedOpenTasks
                        ? 'AT_RISK'
                        : 'ON_TRACK',
                openTasks: health.openTasks,
                overdueOpenTasks: health.overdueOpenTasks,
                blockedOpenTasks: health.blockedOpenTasks,
                progress: health.progress,
                asOf: asOf.toISOString(),
              },
              commonMembers,
            }),
          );
        }
        return {
          items,
          nextCursor:
            selected.length > q.limit ? selected[q.limit - 1]!.projectId : null,
        };
      },
      selected.slice(0, q.limit).map((r) => r.projectId),
    );
  }

  private window(query: z.infer<typeof c.TeamAnalyticsWindowQuerySchema>) {
    const q = c.TeamAnalyticsWindowQuerySchema.parse(query),
      from = new Date(q.from),
      to = new Date(q.to);
    if (to <= from || to.getTime() - from.getTime() > 400 * 86400000)
      throw new BadRequestException({ code: 'RANGE_TOO_LARGE' });
    return { q, from, to };
  }
  private completed(
    tasks: Awaited<ReturnType<SharedTaskWork['scopeMetrics']>>,
    from: Date,
    to: Date,
  ) {
    return tasks.filter(
      (t) =>
        t.status === 'DONE' &&
        t.completedAt !== null &&
        new Date(t.completedAt) >= from &&
        new Date(t.completedAt) < to,
    );
  }
  /** AN: first recorded IN_PROGRESS transition → completion, for Team Tasks completed in the window. */
  cycleTime(
    actor: RequestActor,
    id: string,
    query: z.infer<typeof c.TeamAnalyticsWindowQuerySchema>,
  ) {
    const { q, from, to } = this.window(query);
    return this.run(actor, id, async (tx, a) => {
      const done = this.completed(
        await this.work.scopeMetrics(tx, a, id),
        from,
        to,
      );
      const started = await this.work.firstStarted(
        tx,
        a,
        id,
        done.map((t) => t.taskId),
      );
      const durations = done.flatMap((t) => {
        const at = started.get(t.taskId);
        return at && at <= new Date(t.completedAt!)
          ? [minutes(at, new Date(t.completedAt!))]
          : [];
      });
      return c.TeamCycleTimeSchema.parse({
        from: q.from,
        to: q.to,
        completedTasks: done.length,
        measuredTasks: durations.length,
        medianMinutes: median(durations),
      });
    });
  }
  /** AN: actual (non-voided work logs) versus estimate, only where both exist. */
  estimateAccuracy(
    actor: RequestActor,
    id: string,
    query: z.infer<typeof c.TeamAnalyticsWindowQuerySchema>,
  ) {
    const { q, from, to } = this.window(query);
    return this.run(actor, id, async (tx, a) => {
      const done = this.completed(
          await this.work.scopeMetrics(tx, a, id),
          from,
          to,
        ),
        estimated = done.filter((t) => (t.estimatedMinutes ?? 0) > 0);
      const logs = await this.work.taskEffort(
        tx,
        a,
        id,
        estimated.map((t) => t.taskId),
        new Date(0),
        to,
      );
      let estimatedMinutes = 0,
        actualMinutes = 0;
      const ratios: number[] = [];
      for (const t of estimated) {
        const actual = logs
          .filter((l) => l.taskId === t.taskId)
          .reduce((n, l) => n + minutes(l.startedAt, l.endedAt), 0);
        if (!actual) continue;
        estimatedMinutes += t.estimatedMinutes!;
        actualMinutes += actual;
        ratios.push((actual * 10000) / t.estimatedMinutes!);
      }
      return c.TeamEstimateAccuracySchema.parse({
        from: q.from,
        to: q.to,
        completedTasks: done.length,
        measuredTasks: ratios.length,
        estimatedMinutes,
        actualMinutes,
        medianRatio: median(ratios),
      });
    });
  }
}
