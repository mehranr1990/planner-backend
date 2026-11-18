import { describe, it, expect } from 'vitest';
import type { GoalRuleError } from './goals.js';
import {
  localDay,
  goalWindow,
  assertWindow,
  percent,
  assertJoin,
  assertSubmission,
  entryTransition,
  goalTransition,
  settleCompletion,
  assertCorrection,
} from './goals.js';
const code = (work: () => unknown) => {
  try {
    work();
  } catch (e) {
    return (e as GoalRuleError).code;
  }
  return null;
};
const now = new Date('2030-01-10T00:00:00.000Z');
describe('P6-05 Social goal rules', () => {
  it('evaluates calendar days in the goal time zone across midnight', () => {
    const t = new Date('2030-01-31T21:00:00.000Z');
    expect(localDay(t, 'UTC')).toBe('2030-01-31');
    expect(localDay(t, 'Asia/Tehran')).toBe('2030-02-01');
    expect(localDay(t, 'America/Los_Angeles')).toBe('2030-01-31');
    expect(goalWindow('2030-02-01', '2030-02-28', '2030-01-31')).toBe(
      'UPCOMING',
    );
    expect(goalWindow('2030-02-01', '2030-02-28', '2030-02-01')).toBe('OPEN');
    expect(goalWindow('2030-02-01', '2030-02-28', '2030-02-28')).toBe('OPEN');
    expect(goalWindow('2030-02-01', '2030-02-28', '2030-03-01')).toBe('ENDED');
  });
  it('bounds windows', () => {
    expect(
      code(() => assertWindow('2030-01-02', '2030-01-01', '2030-01-01')),
    ).toBe('INVALID_WINDOW');
    expect(
      code(() => assertWindow('2030-01-01', '2032-01-02', '2030-01-01')),
    ).toBe('WINDOW_TOO_LONG');
    expect(
      code(() => assertWindow('2029-12-01', '2029-12-31', '2030-01-01')),
    ).toBe('WINDOW_ENDED');
    expect(
      code(() => assertWindow('2029-12-01', '2030-01-01', '2030-01-01')),
    ).toBe(null);
  });
  it('computes floored, capped percentages', () => {
    expect(percent(0, 10)).toBe(0);
    expect(percent(-5, 10)).toBe(0);
    expect(percent(1, 3)).toBe(33);
    expect(percent(2, 3)).toBe(66);
    expect(percent(3, 3)).toBe(100);
    expect(percent(30, 3)).toBe(100);
  });
  it('accepts joins only while active, before the end and before collective completion', () => {
    const g = {
      state: 'ACTIVE' as const,
      kind: 'GOAL' as const,
      window: 'UPCOMING' as const,
      completedAt: null,
    };
    expect(code(() => assertJoin(g))).toBe(null);
    expect(code(() => assertJoin({ ...g, window: 'ENDED' }))).toBe(
      'WINDOW_ENDED',
    );
    expect(code(() => assertJoin({ ...g, completedAt: now }))).toBe(
      'GOAL_COMPLETED',
    );
    expect(
      code(() => assertJoin({ ...g, kind: 'CHALLENGE', completedAt: now })),
    ).toBe(null);
    expect(code(() => assertJoin({ ...g, state: 'CLOSED' }))).toBe(
      'GOAL_NOT_ACTIVE',
    );
  });
  it('limits submissions to days inside the window up to today', () => {
    const g = {
      state: 'ACTIVE' as const,
      startsOn: '2030-01-01',
      endsOn: '2030-01-31',
    };
    expect(code(() => assertSubmission(g, '2030-01-10', '2030-01-10'))).toBe(
      null,
    );
    expect(code(() => assertSubmission(g, '2030-01-11', '2030-01-10'))).toBe(
      'OUTSIDE_WINDOW',
    );
    expect(code(() => assertSubmission(g, '2029-12-31', '2030-01-10'))).toBe(
      'OUTSIDE_WINDOW',
    );
    expect(code(() => assertSubmission(g, '2030-01-01', '2029-12-31'))).toBe(
      'WINDOW_NOT_OPEN',
    );
    expect(code(() => assertSubmission(g, '2030-01-31', '2030-02-01'))).toBe(
      'WINDOW_ENDED',
    );
  });
  it('separates submitter retraction from organizer review', () => {
    const e = {
      kind: 'SUBMISSION' as const,
      state: 'PENDING' as const,
      submittedByUserId: 'u1',
      reviewedAt: null,
    };
    const org = { userId: 'o1', organizer: true },
      self = { userId: 'u1', organizer: false };
    expect(entryTransition('approve', e, 'ACTIVE', org)).toBe('APPROVED');
    expect(entryTransition('reject', e, 'CLOSED', org)).toBe('REJECTED');
    expect(code(() => entryTransition('approve', e, 'ACTIVE', self))).toBe(
      'ORGANIZER_REQUIRED',
    );
    expect(
      code(() =>
        entryTransition('approve', e, 'ACTIVE', {
          userId: 'u1',
          organizer: true,
        }),
      ),
    ).toBe('SELF_REVIEW_FORBIDDEN');
    expect(code(() => entryTransition('approve', e, 'CANCELED', org))).toBe(
      'GOAL_NOT_ACTIVE',
    );
    expect(
      code(() =>
        entryTransition(
          'approve',
          { ...e, state: 'REJECTED', reviewedAt: now },
          'ACTIVE',
          org,
        ),
      ),
    ).toBe('ENTRY_NOT_PENDING');
    expect(entryTransition('retract', e, 'ACTIVE', self)).toBe('RETRACTED');
    expect(code(() => entryTransition('retract', e, 'ACTIVE', org))).toBe(
      'NOT_SUBMITTER',
    );
    // Approved self-reports may be retracted; reviewed approvals may not.
    expect(
      entryTransition('retract', { ...e, state: 'APPROVED' }, 'ACTIVE', self),
    ).toBe('RETRACTED');
    expect(
      code(() =>
        entryTransition(
          'retract',
          { ...e, state: 'APPROVED', reviewedAt: now },
          'ACTIVE',
          self,
        ),
      ),
    ).toBe('ENTRY_NOT_RETRACTABLE');
    expect(
      code(() =>
        entryTransition('approve', { ...e, kind: 'CORRECTION' }, 'ACTIVE', org),
      ),
    ).toBe('ENTRY_NOT_REVIEWABLE');
  });
  it('closes or cancels only an active goal', () => {
    expect(goalTransition('close', 'ACTIVE')).toBe('CLOSED');
    expect(goalTransition('cancel', 'ACTIVE')).toBe('CANCELED');
    expect(code(() => goalTransition('cancel', 'CLOSED'))).toBe(
      'GOAL_NOT_ACTIVE',
    );
  });
  it('settles challenge completion per active participant, deterministically', () => {
    const r = settleCompletion({
      kind: 'CHALLENGE',
      target: 10,
      total: 25,
      goalCompletedAt: null,
      now,
      participants: [
        { id: 'a', state: 'ACTIVE', completedAt: null, total: 10 },
        { id: 'b', state: 'ACTIVE', completedAt: now, total: 9 },
        { id: 'c', state: 'WITHDRAWN', completedAt: null, total: 50 },
        { id: 'd', state: 'ACTIVE', completedAt: now, total: 12 },
      ],
    });
    expect(r).toEqual({
      goalCompletedAt: null,
      awards: ['a'],
      revocations: ['b'],
    });
  });
  it('settles collective completion and revokes it below target', () => {
    const participants = [
      { id: 'a', state: 'ACTIVE' as const, completedAt: null, total: 6 },
      { id: 'b', state: 'WITHDRAWN' as const, completedAt: null, total: 4 },
    ];
    const done = settleCompletion({
      kind: 'GOAL',
      target: 10,
      total: 10,
      goalCompletedAt: null,
      now,
      participants,
    });
    expect(done).toEqual({
      goalCompletedAt: now,
      awards: ['a'],
      revocations: [],
    });
    const same = settleCompletion({
      kind: 'GOAL',
      target: 10,
      total: 12,
      goalCompletedAt: now,
      now,
      participants,
    });
    expect(same).toEqual({ goalCompletedAt: now, awards: [], revocations: [] });
    const undone = settleCompletion({
      kind: 'GOAL',
      target: 10,
      total: 9,
      goalCompletedAt: now,
      now,
      participants: [{ ...participants[0]!, completedAt: now }],
    });
    expect(undone).toEqual({
      goalCompletedAt: null,
      awards: [],
      revocations: ['a'],
    });
  });
  it('never corrects a participant below zero', () => {
    expect(code(() => assertCorrection(5, -5))).toBe(null);
    expect(code(() => assertCorrection(5, -6))).toBe('NEGATIVE_TOTAL');
  });
});
