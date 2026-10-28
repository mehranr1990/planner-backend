import { describe, it, expect } from 'vitest';
import { plan, measured, transition, workSpans } from './focus.js';
import type { Timer } from './focus.js';
const at = (n: number) => new Date(Date.parse('2024-01-01T00:00:00Z') + n);
const base: Timer = {
  mode: 'STOPWATCH',
  pomodoro: null,
  state: 'IDLE',
  elapsedMs: 0,
  runningSince: null,
  recordedAt: at(0).toISOString(),
  clockAdjusted: false,
};
const active = (
  row: Timer,
  action: Parameters<typeof transition>[1],
  n: number,
): Timer => ({ ...row, ...transition(row, action, at(n)) });
describe('authoritative focus clock and Pomodoro accounting', () => {
  it('measures exact milliseconds and excludes pauses', () => {
    const start = active(base, 'START', 0),
      pause = active(start, 'PAUSE', 1234),
      resume = active(pause, 'RESUME', 5000),
      end = active(resume, 'FINISH', 5678);
    expect(end.elapsedMs).toBe(1912);
    expect(workSpans([base, start, pause, resume, end], at(5678))).toEqual([
      { start: at(0).getTime(), end: at(1234).getTime() },
      { start: at(5000).getTime(), end: at(5678).getTime() },
    ]);
  });
  it('continues across client/API downtime from persisted instants', () => {
    const start = active(base, 'START', 0);
    expect(measured(start, at(3600000)).workMs).toBe(3600000);
  });
  it('never accepts elapsed time from an action payload', () => {
    expect(transition(base, 'START', at(5)).elapsedMs).toBe(0);
  });
  it('rejects invalid terminal and resume transitions', () => {
    const end = active(active(base, 'START', 0), 'FINISH', 1);
    for (const action of [
      'PAUSE',
      'RESUME',
      'START',
      'FINISH',
      'STOP',
    ] as const)
      expect(() => transition(end, action, at(2))).toThrow();
  });
  it('caps finite Pomodoro accrual and requires explicit terminalization', () => {
    const row = {
      ...base,
      mode: 'POMODORO' as const,
      pomodoro: {
        workMinutes: 1,
        shortBreakMinutes: 1,
        longBreakMinutes: 2,
        longBreakEvery: 2,
        workIntervals: 3,
      },
    };
    const started = active(row, 'START', 0);
    expect(measured(started, at(9999999))).toMatchObject({
      activeMs: 360000,
      workMs: 180000,
      breakMs: 180000,
      phase: 'READY_TO_FINISH',
      remainingMs: 0,
    });
    expect(started.state).toBe('RUNNING');
  });
  it('uses long breaks at configured boundaries without a trailing break', () =>
    expect(
      plan({
        workMinutes: 1,
        shortBreakMinutes: 1,
        longBreakMinutes: 2,
        longBreakEvery: 2,
        workIntervals: 3,
      }).map((p) => p.kind),
    ).toEqual(['WORK', 'SHORT_BREAK', 'WORK', 'LONG_BREAK', 'WORK']));
  it('rejects early Pomodoro finish but allows stop with earned work', () => {
    const row = active(
      {
        ...base,
        mode: 'POMODORO',
        pomodoro: {
          workMinutes: 1,
          shortBreakMinutes: 1,
          longBreakMinutes: 1,
          longBreakEvery: 4,
          workIntervals: 2,
        },
      },
      'START',
      0,
    );
    expect(() => transition(row, 'FINISH', at(30000))).toThrow();
    expect(active(row, 'STOP', 30000)).toMatchObject({
      state: 'ABANDONED',
      elapsedMs: 30000,
    });
  });
  it('splits tracked work around breaks and pauses precisely', () => {
    const row = active(
      {
        ...base,
        mode: 'POMODORO',
        pomodoro: {
          workMinutes: 1,
          shortBreakMinutes: 1,
          longBreakMinutes: 1,
          longBreakEvery: 4,
          workIntervals: 2,
        },
      },
      'START',
      0,
    );
    const pause = active(row, 'PAUSE', 90000),
      resume = active(pause, 'RESUME', 180000),
      end = active(resume, 'FINISH', 270000);
    expect(workSpans([row, pause, resume, end], at(270000))).toEqual([
      { start: at(0).getTime(), end: at(60000).getTime() },
      { start: at(210000).getTime(), end: at(270000).getTime() },
    ]);
  });
  it('detects regressing authoritative clocks without negative elapsed or timestamps', () => {
    const start = active(base, 'START', 1000),
      pause = active(start, 'PAUSE', 500);
    expect(pause).toMatchObject({
      elapsedMs: 0,
      recordedAt: at(1000).toISOString(),
      clockAdjusted: true,
    });
    expect(measured(start, at(500))).toMatchObject({
      activeMs: 0,
      clockAdjusted: true,
    });
  });
  it('allows abandoning IDLE without fabricating time', () => {
    const end = active(base, 'STOP', 1000);
    expect(end.state).toBe('ABANDONED');
    expect(workSpans([base, end], at(1000))).toEqual([]);
  });
});
