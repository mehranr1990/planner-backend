export type DependencyKind = 'FS' | 'SS' | 'FF' | 'SF';
export type Dependency = Readonly<{
  id: string;
  predecessorId: string;
  successorId: string;
  kind: DependencyKind;
  lagMinutes: number;
  revision: number;
}>;
export type ScheduledTask = Readonly<{
  id: string;
  revision: number;
  plannedStartAt: Date | null;
  dueAt: Date | null;
  scheduledDate: string | null;
}>;
export class DependencyRuleError extends Error {
  constructor(
    readonly code:
      | 'GRAPH_LIMIT'
      | 'INVALID_EDGE'
      | 'DEPENDENCY_CYCLE'
      | 'DEPENDENCY_DUPLICATE'
      | 'INVALID_SCHEDULE'
      | 'TIMED_SCHEDULE_REQUIRED'
      | 'DEPENDENCY_CONFLICT',
  ) {
    super(code);
  }
}
export const graphLimits = {
  tasks: 1000,
  edges: 5000,
  lagMinutes: 525600,
} as const;
/** All relationships, regardless of kind, participate in the directed acyclic graph. */
export function dependencyOrder(
  taskIds: string[],
  edges: readonly Dependency[],
): string[] {
  if (taskIds.length > graphLimits.tasks || edges.length > graphLimits.edges)
    throw new DependencyRuleError('GRAPH_LIMIT');
  const ids = new Set(taskIds),
    incoming = new Map(taskIds.map((id) => [id, 0])),
    outgoing = new Map<string, string[]>(),
    seen = new Set<string>();
  if (ids.size !== taskIds.length)
    throw new DependencyRuleError('INVALID_EDGE');
  for (const e of edges) {
    const key = e.predecessorId + ':' + e.successorId + ':' + e.kind;
    if (
      !ids.has(e.predecessorId) ||
      !ids.has(e.successorId) ||
      e.predecessorId === e.successorId ||
      !['FS', 'SS', 'FF', 'SF'].includes(e.kind) ||
      !Number.isSafeInteger(e.lagMinutes) ||
      Math.abs(e.lagMinutes) > graphLimits.lagMinutes
    )
      throw new DependencyRuleError('INVALID_EDGE');
    if (seen.has(key)) throw new DependencyRuleError('DEPENDENCY_DUPLICATE');
    seen.add(key);
    incoming.set(e.successorId, incoming.get(e.successorId)! + 1);
    outgoing.set(e.predecessorId, [
      ...(outgoing.get(e.predecessorId) ?? []),
      e.successorId,
    ]);
  }
  const ready = taskIds.filter((id) => incoming.get(id) === 0).sort(),
    result: string[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    result.push(id);
    for (const next of outgoing.get(id) ?? []) {
      incoming.set(next, incoming.get(next)! - 1);
      if (incoming.get(next) === 0) {
        ready.push(next);
        ready.sort();
      }
    }
  }
  if (result.length !== taskIds.length)
    throw new DependencyRuleError('DEPENDENCY_CYCLE');
  return result;
}
function interval(t: ScheduledTask) {
  const start = t.plannedStartAt ?? t.dueAt,
    finish = t.dueAt ?? t.plannedStartAt;
  if (!start || !finish)
    throw new DependencyRuleError('TIMED_SCHEDULE_REQUIRED');
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(finish.getTime()) ||
    finish < start
  )
    throw new DependencyRuleError('INVALID_SCHEDULE');
  return {
    start: start.getTime(),
    finish: finish.getTime(),
    duration: finish.getTime() - start.getTime(),
  };
}
export function dependencySatisfied(
  edge: Dependency,
  predecessor: ScheduledTask,
  successor: ScheduledTask,
): boolean | null {
  if (
    !(predecessor.plannedStartAt ?? predecessor.dueAt) ||
    !(successor.plannedStartAt ?? successor.dueAt)
  )
    return null;
  const p = interval(predecessor),
    s = interval(successor),
    left = edge.kind[0] === 'F' ? p.finish : p.start,
    right = edge.kind[1] === 'F' ? s.finish : s.start;
  return right >= left + edge.lagMinutes * 60000;
}
/** A preview may shift descendants later; it never writes dates or invents a timezone for date-only Tasks. */
export function reschedulePlan(
  tasks: readonly ScheduledTask[],
  edges: readonly Dependency[],
  anchorId: string,
  requested: { plannedStartAt: Date | null; dueAt: Date | null },
): ScheduledTask[] {
  const ordered = dependencyOrder(
      tasks.map((t) => t.id),
      edges,
    ),
    byId = new Map(tasks.map((t) => [t.id, t]));
  const anchor = byId.get(anchorId);
  if (!anchor) throw new DependencyRuleError('INVALID_EDGE');
  const affected = new Set([anchorId]);
  for (const id of ordered)
    if (affected.has(id))
      for (const e of edges.filter((e) => e.predecessorId === id))
        affected.add(e.successorId);
  byId.set(anchorId, { ...anchor, ...requested });
  interval(byId.get(anchorId)!);
  for (const id of ordered) {
    if (!affected.has(id)) continue;
    const task = byId.get(id)!,
      current = interval(task);
    let minimum = current.start;
    for (const edge of edges.filter((e) => e.successorId === id)) {
      const p = interval(byId.get(edge.predecessorId)!);
      const lower =
        (edge.kind[0] === 'F' ? p.finish : p.start) +
        edge.lagMinutes * 60000 -
        (edge.kind[1] === 'F' ? current.duration : 0);
      minimum = Math.max(minimum, lower);
    }
    if (id === anchorId && minimum > current.start)
      throw new DependencyRuleError('DEPENDENCY_CONFLICT');
    if (minimum > current.start) {
      const delta = minimum - current.start;
      byId.set(id, {
        ...task,
        plannedStartAt: task.plannedStartAt
          ? new Date(task.plannedStartAt.getTime() + delta)
          : null,
        dueAt: task.dueAt ? new Date(task.dueAt.getTime() + delta) : null,
      });
    }
  }
  for (const edge of edges)
    if (affected.has(edge.predecessorId) || affected.has(edge.successorId))
      if (
        dependencySatisfied(
          edge,
          byId.get(edge.predecessorId)!,
          byId.get(edge.successorId)!,
        ) === false
      )
        throw new DependencyRuleError('DEPENDENCY_CONFLICT');
  return [...affected]
    .sort()
    .map((id) => byId.get(id)!)
    .filter((next) => {
      const old = tasks.find((t) => t.id === next.id)!;
      return (
        old.plannedStartAt?.getTime() !== next.plannedStartAt?.getTime() ||
        old.dueAt?.getTime() !== next.dueAt?.getTime()
      );
    });
}
