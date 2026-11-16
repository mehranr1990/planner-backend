export function advisoryHealth(
  tasks: readonly { status: string; dueAt: string | null }[],
  endDate: string | null,
  blocked: ReadonlySet<string>,
  asOf: Date,
) {
  const eligible = tasks.filter((t) => t.status !== 'CANCELED'),
    completed = eligible.filter((t) => t.status === 'DONE').length;
  const overdue = eligible.filter(
    (t) =>
      t.status !== 'DONE' && t.dueAt && Date.parse(t.dueAt) < asOf.getTime(),
  ).length;
  const progressPercent = eligible.length
    ? Math.round((completed * 10000) / eligible.length) / 100
    : null;
  const observed = {
    eligibleTasks: eligible.length,
    completedTasks: completed,
    overdueTasks: overdue,
    blockedTasks: blocked.size,
    progressPercent,
    endDate,
  };
  const reasons: (
    | 'PROJECT_DEADLINE_PASSED'
    | 'OVERDUE_WORK'
    | 'BLOCKED_WORK'
    | 'ALL_ELIGIBLE_WORK_COMPLETED'
    | 'INSUFFICIENT_BASELINE'
  )[] = [];
  let state: 'ON_TRACK' | 'AT_RISK' | 'OFF_TRACK' | 'UNKNOWN' = 'UNKNOWN';
  if (eligible.length && completed === eligible.length) {
    state = 'ON_TRACK';
    reasons.push('ALL_ELIGIBLE_WORK_COMPLETED');
  } else if (
    endDate &&
    asOf.toISOString().slice(0, 10) > endDate &&
    completed < eligible.length
  ) {
    state = 'OFF_TRACK';
    reasons.push('PROJECT_DEADLINE_PASSED');
  } else if (overdue || blocked.size) state = 'AT_RISK';
  if (overdue) reasons.push('OVERDUE_WORK');
  if (blocked.size) reasons.push('BLOCKED_WORK');
  if (state === 'UNKNOWN') reasons.push('INSUFFICIENT_BASELINE');
  return {
    state,
    advisory: true as const,
    asOf: asOf.toISOString(),
    reasons,
    observed,
  };
}
