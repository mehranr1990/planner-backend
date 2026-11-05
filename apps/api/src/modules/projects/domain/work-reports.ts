export function recordedSeconds(
  logs: readonly { startedAt: Date; endedAt: Date; voidedAt: Date | null }[],
  from: Date,
  to: Date,
) {
  let seconds = 0,
    count = 0;
  for (const log of logs) {
    if (log.voidedAt) continue;
    const start = Math.max(from.getTime(), log.startedAt.getTime()),
      end = Math.min(to.getTime(), log.endedAt.getTime());
    if (end > start) {
      seconds += Math.floor((end - start) / 1000);
      count++;
    }
  }
  return { seconds, count };
}
/** Recorded effort is explicitly logged effort, not a measure of distinct attendance or Personal Focus. */
export function taskReport(
  tasks: readonly {
    status: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELED';
    estimatedMinutes: number | null;
    completedAt: string | null;
    dueAt: string | null;
  }[],
  from: Date,
  to: Date,
  asOf: Date,
) {
  const statusCounts = { OPEN: 0, IN_PROGRESS: 0, DONE: 0, CANCELED: 0 };
  let estimatedMinutes = 0,
    unknownEstimates = 0,
    completedInWindow = 0,
    overdueTaskCount = 0;
  for (const t of tasks) {
    statusCounts[t.status]++;
    if (t.estimatedMinutes === null) unknownEstimates++;
    else estimatedMinutes += t.estimatedMinutes;
    if (
      t.completedAt &&
      Date.parse(t.completedAt) >= from.getTime() &&
      Date.parse(t.completedAt) < to.getTime()
    )
      completedInWindow++;
    if (
      (t.status === 'OPEN' || t.status === 'IN_PROGRESS') &&
      t.dueAt &&
      Date.parse(t.dueAt) < asOf.getTime()
    )
      overdueTaskCount++;
  }
  return {
    taskCount: tasks.length,
    statusCounts,
    estimatedMinutes,
    unknownEstimates,
    completedInWindow,
    overdueTaskCount,
  };
}
