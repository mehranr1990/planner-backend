import { describe, it, expect } from 'vitest';
import * as c from './focus.js';
describe('strict focus and time contracts', () => {
  it('rejects client clock/elapsed/ownership injection', () => {
    for (const field of [
      'elapsedMs',
      'startedAt',
      'spaceId',
      'createdByUserId',
    ])
      expect(
        c.FocusCreateSchema.safeParse({ title: 'x', [field]: 1 }).success,
      ).toBe(false);
    expect(c.FocusTransitionSchema.safeParse({ elapsedMs: 10 }).success).toBe(
      false,
    );
  });
  it('validates complete finite Pomodoro configuration and defaults', () => {
    expect(c.PomodoroSchema.parse({})).toMatchObject({
      workMinutes: 25,
      workIntervals: 4,
    });
    for (const field of [
      'workMinutes',
      'shortBreakMinutes',
      'longBreakMinutes',
      'longBreakEvery',
      'workIntervals',
    ])
      expect(c.PomodoroSchema.safeParse({ [field]: 0 }).success).toBe(false);
  });
  it('requires revisions on new task links', () => {
    expect(
      c.FocusCreateSchema.safeParse({
        title: 'x',
        taskId: '9fd3f914-265e-4cce-8a15-e918952ab261',
      }).success,
    ).toBe(false);
    expect(
      c.FocusCreateSchema.safeParse({ title: 'x', taskRevision: 1 }).success,
    ).toBe(false);
  });
  it('rejects wrong-mode configuration and overlong entry intervals', () => {
    expect(
      c.FocusCreateSchema.safeParse({
        title: 'x',
        mode: 'STOPWATCH',
        pomodoro: {},
      }).success,
    ).toBe(false);
    expect(
      c.TimeCreateSchema.safeParse({
        startAt: '2024-01-01T00:00:00Z',
        endAt: '2024-01-09T00:00:00Z',
      }).success,
    ).toBe(false);
  });
  it('requires positive manual work and a bounded summary window', () => {
    expect(
      c.TimeCreateSchema.safeParse({
        startAt: '2024-01-01T00:00:00.0001Z',
        endAt: '2024-01-01T00:00:01Z',
      }).success,
    ).toBe(false);
    expect(
      c.TimeCreateSchema.safeParse({
        startAt: '2024-01-01T00:00:00Z',
        endAt: '2024-01-01T00:00:00Z',
      }).success,
    ).toBe(false);
    expect(
      c.ProductivityQuerySchema.safeParse({
        from: '2024-01-01',
        to: '2026-01-01',
        timezone: 'UTC',
      }).success,
    ).toBe(false);
  });
  it('preserves nullable unknown Task estimates and flags', () => {
    expect(
      c.ProductivityTaskPatchSchema.parse({ estimatedMinutes: null }),
    ).toEqual({ estimatedMinutes: null });
    expect(
      c.ProductivityTaskPatchSchema.safeParse({ estimatedMinutes: -1 }).success,
    ).toBe(false);
    expect(
      c.ProductivityTaskPatchSchema.safeParse({ priority: 'HIGH' }).success,
    ).toBe(false);
  });
  it('does not apply create defaults during patches', () => {
    expect(c.FocusPatchSchema.parse({ title: 'x' })).toEqual({ title: 'x' });
    expect(c.TimePatchSchema.parse({ note: null })).toEqual({ note: null });
    expect(c.TimePatchSchema.safeParse({}).success).toBe(false);
  });
});
