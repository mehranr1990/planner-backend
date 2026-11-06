export type WorkMetric = {
  status: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELED';
  estimatedMinutes: number | null;
  completedAt: string | null;
  dueAt: string | null;
};
/** Current stock denominator; completion and explicit logged effort use [from,to). */
export function summarizeWork(
  tasks: readonly WorkMetric[],
  logs: readonly { startedAt: Date; endedAt: Date; voidedAt: Date | null }[],
  goalCount: number,
  from: Date,
  to: Date,
  asOf: Date,
) {
  const statusCounts = { OPEN: 0, IN_PROGRESS: 0, DONE: 0, CANCELED: 0 };
  let estimatedMinutes = 0,
    unknownEstimates = 0,
    completedInWindow = 0,
    overdueTaskCount = 0,
    recordedSeconds = 0,
    workLogCount = 0;
  for (const t of tasks) {
    statusCounts[t.status]++;
    if (t.estimatedMinutes === null) unknownEstimates++;
    else estimatedMinutes += t.estimatedMinutes;
    if (
      t.completedAt &&
      Date.parse(t.completedAt) >= +from &&
      Date.parse(t.completedAt) < +to
    )
      completedInWindow++;
    if (
      ['OPEN', 'IN_PROGRESS'].includes(t.status) &&
      t.dueAt &&
      Date.parse(t.dueAt) < +asOf
    )
      overdueTaskCount++;
  }
  for (const log of logs) {
    if (log.voidedAt) continue;
    const seconds = Math.floor(
      (Math.min(+log.endedAt, +to) - Math.max(+log.startedAt, +from)) / 1000,
    );
    if (seconds > 0) {
      recordedSeconds += seconds;
      workLogCount++;
    }
  }
  return {
    taskCount: tasks.length,
    statusCounts,
    estimatedMinutes,
    unknownEstimates,
    completedInWindow,
    overdueTaskCount,
    recordedSeconds,
    workLogCount,
    goalCount,
  };
}
