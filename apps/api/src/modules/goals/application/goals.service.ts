import type { ZodType } from 'zod';
import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import * as c from '@mehran/api-contracts';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { GOALS_REPOSITORY } from './goals.port.js';
import type {
  GoalsPort,
  GoalsTransaction,
  Kind,
  PageQuery,
  GoalQuery,
  ReviewQuery,
  Collections,
} from './goals.port.js';
import { validHierarchy } from '../domain/hierarchy.js';
import {
  calculate,
  metric,
  percentage,
  output,
  ratio,
  units,
} from '../domain/progress.js';
import type { Ratio } from '../domain/progress.js';
const invalid = (code: string): never => {
  throw new BadRequestException({
    code: 'VALIDATION_ERROR',
    details: [{ path: 'goal', code }],
  });
};
@Injectable()
export class GoalsService {
  private validate<T>(schema: ZodType<T>, input: unknown): T {
    const result = schema.safeParse(input);
    if (!result.success) return invalid('INVALID_CHILD_CONFIGURATION');
    return result.data;
  }
  constructor(@Inject(GOALS_REPOSITORY) private readonly repo: GoalsPort) {}
  private revision(value: { revision: number }, expected: number) {
    if (value.revision !== expected) throw new ConflictException();
  }
  private key(key: string | undefined) {
    if (!key) throw new BadRequestException();
    return key;
  }
  createArea(
    scope: AuthorizedSpace,
    key: string | undefined,
    input: c.LifeAreaCreate,
  ) {
    return this.repo.once(
      scope,
      'post.life-areas',
      this.key(key),
      input,
      async (tx) => {
        const a = await tx.createArea(input);
        await tx.audit('LIFE_AREA_CREATE', a.id);
        return a;
      },
    );
  }
  area(scope: AuthorizedSpace, id: string) {
    return this.repo.run(scope, (tx) => tx.area(id));
  }
  areas(scope: AuthorizedSpace, q: PageQuery) {
    return this.repo.run(scope, (tx) => tx.areas(q));
  }
  patchArea(
    scope: AuthorizedSpace,
    id: string,
    revision: number,
    input: c.LifeAreaPatch,
  ) {
    return this.repo.run(scope, async (tx) => {
      const a = await tx.area(id);
      this.revision(a, revision);
      const next = await tx.updateArea(a, input);
      await tx.audit('LIFE_AREA_UPDATE', id);
      return next;
    });
  }
  private async relations(
    tx: GoalsTransaction,
    g: c.GoalCreate | c.Goal,
    id?: string,
    before?: c.Goal,
  ) {
    if (g.lifeAreaId) {
      const area = await tx.area(g.lifeAreaId);
      if (area.status === 'ARCHIVED' && g.lifeAreaId !== before?.lifeAreaId)
        invalid('LIFE_AREA_ARCHIVED');
    }
    if (g.parentGoalId) await tx.goal(g.parentGoalId);
    const graph = await tx.hierarchy();
    if (!id && graph.length >= 10000) invalid('GOAL_LIMIT');
    const node = { id: id ?? 'new', parentGoalId: g.parentGoalId };
    const nodes = id
      ? graph.map((n) => (n.id === id ? node : n))
      : [...graph, node];
    if (!validHierarchy(nodes, 5)) invalid('GOAL_HIERARCHY');
    if (g.startDate && g.targetDate && g.startDate > g.targetDate)
      invalid('DATE_ORDER');
    if (g.progressMode === 'METRIC') {
      if (!g.metricId) invalid('METRIC_REQUIRED');
      if (
        !id ||
        (await tx.children(id)).metrics.every((m) => m.id !== g.metricId)
      )
        throw new NotFoundException();
    } else if (g.metricId !== null) invalid('METRIC_MODE_REQUIRED');
  }
  create(scope: AuthorizedSpace, key: string | undefined, input: c.GoalCreate) {
    return this.repo.once(
      scope,
      'post.goals',
      this.key(key),
      input,
      async (tx) => {
        await this.relations(tx, input);
        const g = await tx.createGoal(
          input,
          input.timezone ?? (await tx.timezone()),
        );
        await tx.audit('GOAL_CREATE', g.id);
        await tx.event(g.id);
        return g;
      },
    );
  }
  get(scope: AuthorizedSpace, id: string) {
    return this.repo.run(scope, (tx) => tx.goal(id));
  }
  list(scope: AuthorizedSpace, q: GoalQuery) {
    return this.repo.run(scope, (tx) => tx.goals(q));
  }
  patch(
    scope: AuthorizedSpace,
    id: string,
    revision: number,
    input: c.GoalPatch,
  ) {
    return this.repo.run(scope, async (tx) => {
      const g = await tx.goal(id);
      this.revision(g, revision);
      await this.relations(tx, c.GoalSchema.parse({ ...g, ...input }), id, g);
      const next = await tx.updateGoal(g, input);
      await tx.audit('GOAL_UPDATE', id);
      await tx.event(id);
      return next;
    });
  }
  children(scope: AuthorizedSpace, id: string, kind: Kind) {
    return this.repo.run(scope, async (tx) => {
      const g = await tx.goal(id);
      return { goalRevision: g.revision, items: (await tx.children(id))[kind] };
    });
  }
  private async source(tx: GoalsTransaction, kind: Kind, input: object) {
    if (kind === 'tasks') {
      const v = c.GoalTaskLinkCreateSchema.parse(input),
        s = await tx.task(v.taskId);
      this.revision(s, v.sourceRevision);
      if (s.deleted || s.isMaster) invalid('TASK_UNAVAILABLE');
    }
    if (kind === 'habits') {
      const v = c.GoalHabitLinkCreateSchema.parse(input),
        s = await tx.habit(v.habitId, v, new Date());
      this.revision(s, v.sourceRevision);
    }
  }
  nested(
    scope: AuthorizedSpace,
    id: string,
    revision: number,
    kind: Kind,
    childId: string | null,
    input: object,
    key?: string,
  ) {
    const work = async (tx: GoalsTransaction) => {
      let g = await tx.goal(id);
      this.revision(g, revision);
      const all = await tx.children(id),
        list = all[kind];
      const before = childId ? list.find((x) => x.id === childId) : undefined;
      if (childId && !before) throw new NotFoundException();
      if (!childId && list.length >= 100) invalid('COLLECTION_LIMIT');
      let merged: object = { ...before, ...input };
      // Omit server fields; validation remains authoritative for the complete child.
      const clean = (v: object) =>
        Object.fromEntries(
          Object.entries(v).filter(
            ([k]) =>
              ![
                'id',
                'goalId',
                'createdAt',
                'updatedAt',
                'completedAt',
                'selectedSourceRevision',
              ].includes(k),
          ),
        );
      merged = clean(merged);
      if (kind === 'tasks' || kind === 'habits') {
        const old = before as
          | Collections['tasks'][number]
          | Collections['habits'][number]
          | undefined;
        merged = {
          ...merged,
          sourceRevision: old?.selectedSourceRevision,
          ...input,
        };
        if (!childId) await this.source(tx, kind, merged);
      }
      if (kind === 'metrics')
        merged = this.validate(c.GoalMetricCreateSchema, merged);
      if (kind === 'milestones')
        merged = this.validate(c.GoalMilestoneCreateSchema, merged);
      if (kind === 'habits')
        merged = this.validate(c.GoalHabitLinkCreateSchema, merged);
      if (kind === 'tasks')
        merged = this.validate(c.GoalTaskLinkCreateSchema, merged);
      await tx.writeChild(id, kind, merged, childId ?? undefined);
      g = await tx.updateGoal(g, {});
      await tx.audit(
        kind === 'tasks' || kind === 'habits'
          ? 'GOAL_LINK_CHANGE'
          : 'GOAL_UPDATE',
        id,
      );
      await tx.event(id);
      const after = (await tx.children(id))[kind];
      const item = childId
        ? after.find((x) => x.id === childId)!
        : after.find((x) => !list.some((old) => old.id === x.id))!;
      return { id: item.id, revision: g.revision, item };
    };
    return childId
      ? this.repo.run(scope, work)
      : this.repo.once(
          scope,
          'post.goals.' + kind,
          this.key(key),
          { id, revision, input },
          work,
        );
  }
  remove(
    scope: AuthorizedSpace,
    id: string,
    revision: number,
    kind: Kind,
    childId: string,
  ) {
    return this.repo.run(scope, async (tx) => {
      const g = await tx.goal(id);
      this.revision(g, revision);
      if (!(await tx.children(id))[kind].some((x) => x.id === childId))
        throw new NotFoundException();
      if (kind === 'metrics' && g.metricId === childId)
        invalid('METRIC_IN_USE');
      await tx.removeChild(id, kind, childId);
      const next = await tx.updateGoal(g, {});
      await tx.audit('GOAL_LINK_CHANGE', id);
      await tx.event(id);
      return next;
    });
  }
  private async compute(
    tx: GoalsTransaction,
    g: c.Goal,
    now: Date,
  ): Promise<c.GoalProgress> {
    const all = await tx.children(g.id),
      sources: c.GoalProgressSource[] = [],
      values: Array<{ weight: string; value: Ratio }> = [];
    const base = (
      id: string,
      kind: c.GoalProgressSource['kind'],
      sourceId: string,
      weight: string,
    ): c.GoalProgressSource => ({
      id,
      kind,
      sourceId,
      weight,
      rawPercentage: '0',
      metric: null,
      numerator: '0',
      denominator: '1',
      disposition: 'AVAILABLE',
      revision: null,
      timezone: null,
      from: null,
      to: null,
      asOfDate: null,
      scheduleIds: [],
      entries: [],
    });
    const add = (s: c.GoalProgressSource, v: Ratio) => {
      sources.push({ ...s, rawPercentage: output(v) });
      values.push({ weight: s.weight, value: v });
    };
    if (g.progressMode === 'METRIC' || g.progressMode === 'WEIGHTED') {
      for (const m of all.metrics.filter((m) =>
        g.progressMode === 'METRIC' ? m.id === g.metricId : m.contributes,
      )) {
        const s = base(m.id, 'METRIC', m.id, m.weight);
        s.revision = g.revision;
        s.metric = {
          baseline: m.baseline,
          target: m.target,
          current: m.current,
          unit: m.unit,
        };
        s.numerator = output(
          ratio(units(m.current) - units(m.baseline), 1000000n),
        );
        s.denominator = output(
          ratio(units(m.target) - units(m.baseline), 1000000n),
        );
        add(s, metric(m.current, m.baseline, m.target));
      }
    }
    if (g.progressMode === 'WEIGHTED') {
      for (const m of all.milestones.filter((m) => m.contributes)) {
        const s = base(m.id, 'MILESTONE', m.id, m.weight);
        s.revision = g.revision;
        s.numerator = m.status === 'COMPLETED' ? '1' : '0';
        add(s, percentage(m.status === 'COMPLETED' ? 1 : 0, 1));
      }
      for (const l of all.tasks.filter((l) => l.contributes)) {
        const t = await tx.task(l.taskId),
          s = base(l.id, 'TASK', l.taskId, l.weight);
        s.revision = t.revision;
        s.disposition = t.deleted
          ? 'DELETED'
          : t.isMaster
            ? 'MASTER'
            : t.occurrenceState === 'SKIPPED'
              ? 'SKIPPED'
              : t.status === 'CANCELED' || t.occurrenceState === 'CANCELED'
                ? 'CANCELED'
                : 'AVAILABLE';
        const done = s.disposition === 'AVAILABLE' && t.status === 'DONE';
        s.numerator = done ? '1' : '0';
        add(s, percentage(done ? 1 : 0, 1));
      }
      let evidenceCount = 0;
      for (const l of all.habits.filter((l) => l.contributes)) {
        const h = await tx.habit(l.habitId, l, now),
          s = base(l.id, 'HABIT', l.habitId, l.weight);
        evidenceCount += h.entries.length + h.scheduleIds.length;
        if (evidenceCount > 10000) invalid('PROGRESS_TOO_DENSE');
        Object.assign(s, {
          revision: h.revision,
          timezone: h.timezone,
          from: l.from,
          to: l.to,
          asOfDate: h.asOfDate,
          scheduleIds: h.scheduleIds,
          entries: h.entries,
          numerator: String(h.numerator),
          denominator: String(h.denominator),
          disposition: h.denominator === 0 ? 'NO_DUE_DAYS' : 'AVAILABLE',
        });
        add(s, percentage(h.numerator, h.denominator));
      }
    }
    return c.GoalProgressSchema.parse({
      ruleVersion: 1,
      goalId: g.id,
      goalRevision: g.revision,
      mode: g.progressMode,
      timezone: g.timezone,
      computedAt: now.toISOString(),
      ...calculate(g.progressMode, g.manualProgress, values),
      sources,
    });
  }
  progress(scope: AuthorizedSpace, id: string) {
    return this.repo.run(scope, async (tx) =>
      this.compute(tx, await tx.goal(id), new Date()),
    );
  }
  snapshot(
    scope: AuthorizedSpace,
    id: string,
    revision: number,
    key: string | undefined,
    reflection: string | null,
  ) {
    return this.repo.once(
      scope,
      'post.goals.' + (reflection === null ? 'progress' : 'reviews'),
      this.key(key),
      { id, revision, reflection },
      async (tx) => {
        let g = await tx.goal(id);
        this.revision(g, revision);
        g = await tx.updateGoal(g, {});
        const r = await tx.review(
          id,
          reflection === null ? 'SNAPSHOT' : 'REVIEW',
          reflection,
          await this.compute(tx, g, new Date()),
        );
        await tx.audit('GOAL_REVIEW_CREATE', id);
        await tx.event(id);
        return { ...r, revision: g.revision };
      },
    );
  }
  reviews(scope: AuthorizedSpace, id: string, q: ReviewQuery) {
    return this.repo.run(scope, async (tx) => {
      await tx.goal(id);
      return tx.reviews(id, q);
    });
  }
}
