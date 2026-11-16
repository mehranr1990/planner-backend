type WorkLog = {
  accessId: string;
  generation: number;
  startedAt: Date;
  endedAt: Date;
};
/** Distinct recorded time per admission. Never mix Personal Focus/TimeEntry. */
export function unionedWorkSeconds(
  logs: readonly WorkLog[],
  from: Date,
  to: Date,
) {
  const groups = new Map<string, [number, number][]>();
  for (const log of logs) {
    const key = log.accessId + ':' + log.generation,
      rows = groups.get(key) ?? [],
      start = Math.max(from.getTime(), log.startedAt.getTime()),
      end = Math.min(to.getTime(), log.endedAt.getTime());
    if (end > start) rows.push([start, end]);
    groups.set(key, rows);
  }
  let milliseconds = 0;
  for (const rows of groups.values()) {
    rows.sort((a, b) => a[0] - b[0]);
    let start: number | undefined,
      end = 0;
    for (const [lo, hi] of rows) {
      if (start === undefined) {
        start = lo;
        end = hi;
      } else if (lo > end) {
        milliseconds += end - start;
        start = lo;
        end = hi;
      } else end = Math.max(end, hi);
    }
    if (start !== undefined) milliseconds += end - start;
  }
  return Math.floor(milliseconds / 1000);
}
export function cycleTime(
  tasks: readonly { taskId: string; completedAt: string | null }[],
  starts: ReadonlyMap<string, Date>,
) {
  const durations = tasks
    .flatMap((t) => {
      const start = starts.get(t.taskId)?.getTime(),
        end = t.completedAt ? Date.parse(t.completedAt) : NaN;
      return start !== undefined && end >= start
        ? [Math.floor((end - start) / 1000)]
        : [];
    })
    .sort((a, b) => a - b);
  return {
    knownCompletedTasks: durations.length,
    unknownCompletedTasks: tasks.length - durations.length,
    medianSeconds: durations.length
      ? (durations[Math.floor((durations.length - 1) / 2)]! +
          durations[Math.floor(durations.length / 2)]!) /
        2
      : null,
  };
}
