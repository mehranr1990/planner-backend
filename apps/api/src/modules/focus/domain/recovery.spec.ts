import { describe, it, expect } from 'vitest';
import { measured, workSpans, plan } from './focus.js';
import type { Timer } from './focus.js';
const at = (ms: number) => new Date(Date.UTC(2026, 10, 15) + ms).toISOString();
describe('recoverable focus evidence', () => {
  const base: Timer = {
    mode: 'STOPWATCH',
    pomodoro: null,
    state: 'RUNNING',
    elapsedMs: 0,
    runningSince: at(0),
    recordedAt: at(0),
    clockAdjusted: false,
    recovery: { confirmedAt: at(30000), extensions: [] },
  };
  it('caps interrupted accrual and preserves legacy timing', () => {
    expect(measured(base, new Date(at(3600000))).workMs).toBe(30000);
    expect(
      measured({ ...base, recovery: undefined }, new Date(at(3600000))).workMs,
    ).toBe(3600000);
  });
  it('reconstructs confirmed spans without heartbeat duplicates', () => {
    const first = { ...base, recovery: { confirmedAt: at(0), extensions: [] } };
    const second = {
      ...base,
      elapsedMs: 30000,
      runningSince: at(30000),
      recordedAt: at(30000),
    };
    const end = {
      ...second,
      state: 'PAUSED' as const,
      runningSince: null,
      recordedAt: at(90000),
    };
    expect(workSpans([first, second, end], new Date(at(90000)))).toEqual([
      { start: Date.parse(at(0)), end: Date.parse(at(30000)) },
    ]);
  });
  it('extends only the specified phase without changing preceding phases', () => {
    const p = {
      workMinutes: 25,
      shortBreakMinutes: 5,
      longBreakMinutes: 15,
      longBreakEvery: 4,
      workIntervals: 2,
    };
    const before = plan(p),
      after = plan(p, [{ phase: 1, minutes: 5 }]);
    expect(after[0]).toEqual(before[0]);
    expect(after[1]!.end - before[1]!.end).toBe(300000);
  });
});
