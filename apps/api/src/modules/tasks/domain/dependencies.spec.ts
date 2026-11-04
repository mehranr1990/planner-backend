import { describe, it, expect } from 'vitest';
import {
  dependencyOrder,
  dependencySatisfied,
  reschedulePlan,
} from './dependencies.js';
import type {
  Dependency,
  ScheduledTask,
  DependencyKind,
} from './dependencies.js';
const time = (hour: number) => new Date(Date.UTC(2026, 10, 4, hour));
const task = (id: string, start: number, finish: number): ScheduledTask => ({
  id,
  revision: 1,
  plannedStartAt: time(start),
  dueAt: time(finish),
  scheduledDate: null,
});
const edge = (
  kind: DependencyKind = 'FS',
  lagMinutes = 0,
  predecessorId = 'a',
  successorId = 'b',
): Dependency => ({
  id: predecessorId + successorId + kind,
  predecessorId,
  successorId,
  kind,
  lagMinutes,
  revision: 1,
});
describe('P2-05 dependency graph and explicit reschedule plan', () => {
  it.each(['FS', 'SS', 'FF', 'SF'] as const)(
    'rejects a cycle containing %s',
    (kind) => {
      expect(() =>
        dependencyOrder(
          ['a', 'b', 'c'],
          [edge(kind), edge('SS', 0, 'b', 'c'), edge('FF', 0, 'c', 'a')],
        ),
      ).toThrow('CYCLE');
    },
  );
  it('rejects self/foreign/duplicate edges and excessive signed lag', () => {
    for (const edges of [
      [edge('FS', 0, 'a', 'a')],
      [edge('FS', 0, 'a', 'x')],
      [edge(), edge()],
      [edge('FS', 525601)],
    ])
      expect(() => dependencyOrder(['a', 'b'], edges)).toThrow('INVALID_EDGE');
  });
  it.each([
    ['FS', task('a', 1, 3), task('b', 3, 5), true],
    ['SS', task('a', 1, 3), task('b', 0, 5), false],
    ['FF', task('a', 1, 3), task('b', 1, 2), false],
    ['SF', task('a', 3, 5), task('b', 1, 3), true],
  ] as const)(
    'checks %s against the correct endpoints',
    (kind, p, s, expected) => {
      expect(dependencySatisfied(edge(kind), p, s)).toBe(expected);
    },
  );
  it('honors signed lead without floating-point time or altering source schedules', () => {
    expect(
      dependencySatisfied(edge('FS', -60), task('a', 1, 3), task('b', 2, 4)),
    ).toBe(true);
    expect(
      dependencySatisfied(edge('FS', 1), task('a', 1, 3), task('b', 3, 4)),
    ).toBe(false);
  });
  it('previews the transitive closure while preserving duration and unrelated sources', () => {
    const tasks = [
      task('a', 1, 2),
      task('b', 2, 3),
      task('c', 3, 5),
      task('unrelated', 0, 1),
    ];
    const before = structuredClone(tasks),
      plan = reschedulePlan(tasks, [edge(), edge('FS', 30, 'b', 'c')], 'a', {
        plannedStartAt: time(3),
        dueAt: time(4),
      });
    expect(plan.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(plan[1]!.plannedStartAt).toEqual(time(4));
    expect(plan[1]!.dueAt).toEqual(time(5));
    expect(plan[2]!.plannedStartAt).toEqual(
      new Date(time(5).getTime() + 1800000),
    );
    expect(tasks).toEqual(before);
  });
  it.each(['SS', 'FF', 'SF'] as const)(
    'preserves successor duration for %s',
    (kind) => {
      const tasks = [task('a', 1, 2), task('b', 1, 3)];
      const plan = reschedulePlan(tasks, [edge(kind, 180)], 'a', {
        plannedStartAt: time(5),
        dueAt: time(6),
      });
      const next = plan.find((t) => t.id === 'b')!;
      expect(next.dueAt!.getTime() - next.plannedStartAt!.getTime()).toBe(
        7200000,
      );
      expect(
        dependencySatisfied(
          edge(kind, 180),
          plan.find((t) => t.id === 'a')!,
          next,
        ),
      ).toBe(true);
    },
  );
  it('rejects an explicit anchor violating an incoming constraint', () => {
    expect(() =>
      reschedulePlan([task('a', 1, 3), task('b', 3, 4)], [edge()], 'b', {
        plannedStartAt: time(2),
        dueAt: time(3),
      }),
    ).toThrow('DEPENDENCY_CONFLICT');
  });
  it('keeps unscheduled/date-only work distinct from timed rescheduling', () => {
    const dateOnly: ScheduledTask = {
      id: 'b',
      revision: 1,
      plannedStartAt: null,
      dueAt: null,
      scheduledDate: '2026-11-04',
    };
    expect(dependencySatisfied(edge(), task('a', 1, 2), dateOnly)).toBeNull();
    expect(() =>
      reschedulePlan([task('a', 1, 2), dateOnly], [edge()], 'a', {
        plannedStartAt: time(2),
        dueAt: time(3),
      }),
    ).toThrow('TIMED_SCHEDULE_REQUIRED');
    expect(dateOnly.scheduledDate).toBe('2026-11-04');
  });
});
