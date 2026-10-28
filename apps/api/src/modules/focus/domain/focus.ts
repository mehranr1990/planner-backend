import type { Interval } from './intervals.js';
export type Pomodoro = {
  workMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakEvery: number;
  workIntervals: number;
};
export type State = 'IDLE' | 'RUNNING' | 'PAUSED' | 'FINISHED' | 'ABANDONED';
export type Action =
  'CREATE' | 'EDIT' | 'START' | 'PAUSE' | 'RESUME' | 'FINISH' | 'STOP';
export type Timer = {
  mode: 'STOPWATCH' | 'POMODORO';
  pomodoro: Pomodoro | null;
  state: State;
  elapsedMs: number;
  runningSince: string | null;
  recordedAt: string;
  clockAdjusted: boolean;
};
export type PhaseInterval = Interval & {
  kind: 'WORK' | 'SHORT_BREAK' | 'LONG_BREAK';
  interval: number;
};
export function plan(p: Pomodoro): PhaseInterval[] {
  const rows: PhaseInterval[] = [];
  let at = 0;
  for (let i = 1; i <= p.workIntervals; i++) {
    let end = at + p.workMinutes * 60000;
    rows.push({ start: at, end, kind: 'WORK', interval: i });
    at = end;
    if (i < p.workIntervals) {
      const long = i % p.longBreakEvery === 0;
      end = at + (long ? p.longBreakMinutes : p.shortBreakMinutes) * 60000;
      rows.push({
        start: at,
        end,
        kind: long ? 'LONG_BREAK' : 'SHORT_BREAK',
        interval: i,
      });
      at = end;
    }
  }
  return rows;
}
export function measured(row: Timer, now: Date) {
  const clockAdjusted =
    row.clockAdjusted || now.getTime() < Date.parse(row.recordedAt);
  const instant = Math.max(now.getTime(), Date.parse(row.recordedAt));
  const projected =
    row.elapsedMs +
    (row.state === 'RUNNING'
      ? Math.max(0, instant - Date.parse(row.runningSince!))
      : 0);
  const schedule = row.mode === 'POMODORO' ? plan(row.pomodoro!) : null;
  const total = schedule?.at(-1)?.end ?? null;
  const activeMs = total === null ? projected : Math.min(total, projected);
  const workMs = schedule
    ? schedule
        .filter((s) => s.kind === 'WORK')
        .reduce(
          (n, s) => n + Math.max(0, Math.min(activeMs, s.end) - s.start),
          0,
        )
    : activeMs;
  const phase = schedule?.find((s) => s.end > activeMs);
  return {
    activeMs,
    workMs,
    breakMs: activeMs - workMs,
    clockAdjusted,
    phase:
      row.state === 'IDLE'
        ? ('IDLE' as const)
        : row.state === 'FINISHED' || row.state === 'ABANDONED'
          ? row.state
          : total !== null && activeMs >= total
            ? ('READY_TO_FINISH' as const)
            : (phase?.kind ?? ('WORK' as const)),
    interval:
      row.state === 'IDLE'
        ? 0
        : (phase?.interval ?? row.pomodoro?.workIntervals ?? 0),
    remainingMs: total === null ? null : total - activeMs,
  };
}
export class TimerError extends Error {}
export function transition(
  row: Timer,
  action: Exclude<Action, 'CREATE' | 'EDIT'>,
  now: Date,
) {
  const value = measured(row, now),
    recordedAt = new Date(
      Math.max(now.getTime(), Date.parse(row.recordedAt)),
    ).toISOString();
  let state: State;
  switch (action) {
    case 'START':
      if (row.state !== 'IDLE') throw new TimerError('NOT_IDLE');
      state = 'RUNNING';
      break;
    case 'PAUSE':
      if (row.state !== 'RUNNING') throw new TimerError('NOT_RUNNING');
      state = 'PAUSED';
      break;
    case 'RESUME':
      if (row.state !== 'PAUSED' || value.remainingMs === 0)
        throw new TimerError('NOT_RESUMABLE');
      state = 'RUNNING';
      break;
    case 'FINISH':
      if (
        !['RUNNING', 'PAUSED'].includes(row.state) ||
        (row.mode === 'POMODORO' && value.remainingMs !== 0)
      )
        throw new TimerError('NOT_FINISHABLE');
      state = 'FINISHED';
      break;
    case 'STOP':
      if (['FINISHED', 'ABANDONED'].includes(row.state))
        throw new TimerError('TERMINAL');
      state = 'ABANDONED';
      break;
  }
  return {
    state,
    elapsedMs: value.activeMs,
    runningSince: state === 'RUNNING' ? recordedAt : null,
    recordedAt,
    clockAdjusted: value.clockAdjusted,
  };
}
export function workSpans(rows: Timer[], now: Date): Interval[] {
  const result: Interval[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.state !== 'RUNNING') continue;
    const end = rows[i + 1] ? new Date(rows[i + 1]!.recordedAt) : now;
    const until = measured(r, end).activeMs;
    const schedule =
      r.mode === 'POMODORO'
        ? plan(r.pomodoro!)
        : [{ start: 0, end: until, kind: 'WORK', interval: 0 }];
    for (const phase of schedule.filter((p) => p.kind === 'WORK')) {
      const startOffset = Math.max(r.elapsedMs, phase.start),
        endOffset = Math.min(until, phase.end);
      if (endOffset > startOffset) {
        const at = Date.parse(r.runningSince!);
        result.push({
          start: at + startOffset - r.elapsedMs,
          end: at + endOffset - r.elapsedMs,
        });
      }
    }
  }
  return result;
}
