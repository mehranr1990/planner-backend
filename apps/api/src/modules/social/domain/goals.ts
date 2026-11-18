/**
 * P6-05 Social Goals and Challenges domain rules (ADR 0065). Pure functions:
 * dates are ISO calendar days evaluated in the goal's IANA time zone, totals
 * are whole units, and completion is a deterministic function of the approved
 * ledger, so every badge award or revocation can be recomputed and audited.
 */
export class GoalRuleError extends Error {
  constructor(
    readonly code: string,
    readonly status: 403 | 409 | 422 = 409,
  ) {
    super(code);
  }
}
export type GoalKind = 'GOAL' | 'CHALLENGE';
export type GoalState = 'ACTIVE' | 'CLOSED' | 'CANCELED';
export type EntryState = 'PENDING' | 'APPROVED' | 'REJECTED' | 'RETRACTED';
export type GoalWindow = 'UPCOMING' | 'OPEN' | 'ENDED';
const fail = (code: string, status: 403 | 409 | 422 = 409): never => {
  throw new GoalRuleError(code, status);
};
/** The calendar day of `now` in `zone` (e.g. 2030-01-01 in Asia/Tehran). */
export function localDay(now: Date, zone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function goalWindow(
  startsOn: string,
  endsOn: string,
  today: string,
): GoalWindow {
  return today < startsOn ? 'UPCOMING' : today > endsOn ? 'ENDED' : 'OPEN';
}
/** Longest permitted goal window, in days (inclusive range). */
export const MAX_WINDOW_DAYS = 731;
export function assertWindow(startsOn: string, endsOn: string, today: string) {
  if (endsOn < startsOn) fail('INVALID_WINDOW', 422);
  const days = (Date.parse(endsOn) - Date.parse(startsOn)) / 86400000 + 1;
  if (days > MAX_WINDOW_DAYS) fail('WINDOW_TOO_LONG', 422);
  if (endsOn < today) fail('WINDOW_ENDED', 422);
}
/** Integer percentage, floored and capped at 100; never negative. */
export function percent(total: number, target: number) {
  if (total <= 0) return 0;
  return Math.min(100, Math.floor((total * 100) / target));
}
export function assertActive(state: GoalState) {
  if (state !== 'ACTIVE') fail('GOAL_NOT_ACTIVE');
}
export function assertJoin(g: {
  state: GoalState;
  kind: GoalKind;
  window: GoalWindow;
  completedAt: Date | null;
}) {
  assertActive(g.state);
  if (g.window === 'ENDED') fail('WINDOW_ENDED');
  // A collective goal that already reached its target awards no later badge.
  if (g.kind === 'GOAL' && g.completedAt) fail('GOAL_COMPLETED');
}
/** Own progress may be reported for a day inside the window, up to today. */
export function assertSubmission(
  g: { state: GoalState; startsOn: string; endsOn: string },
  occurredOn: string,
  today: string,
) {
  assertActive(g.state);
  const w = goalWindow(g.startsOn, g.endsOn, today);
  if (w === 'UPCOMING') fail('WINDOW_NOT_OPEN');
  if (w === 'ENDED') fail('WINDOW_ENDED');
  if (occurredOn < g.startsOn || occurredOn > g.endsOn || occurredOn > today)
    fail('OUTSIDE_WINDOW', 422);
}
export type EntryFacts = {
  kind: 'SUBMISSION' | 'CORRECTION';
  state: EntryState;
  submittedByUserId: string | null;
  reviewedAt: Date | null;
};
export type EntryAction = 'approve' | 'reject' | 'retract';
/** Returns the target state, or throws the stable rule code. */
export function entryTransition(
  action: EntryAction,
  e: EntryFacts,
  goal: GoalState,
  actor: { userId: string; organizer: boolean },
): EntryState {
  if (e.kind !== 'SUBMISSION') fail('ENTRY_NOT_REVIEWABLE');
  if (action === 'retract') {
    if (e.submittedByUserId !== actor.userId) fail('NOT_SUBMITTER', 403);
    assertActive(goal);
    // Pending reports, or approved self-reports nobody reviewed, stay the submitter's own.
    if (!(e.state === 'PENDING' || (e.state === 'APPROVED' && !e.reviewedAt)))
      fail('ENTRY_NOT_RETRACTABLE');
    return 'RETRACTED';
  }
  if (!actor.organizer) fail('ORGANIZER_REQUIRED', 403);
  if (goal === 'CANCELED') fail('GOAL_NOT_ACTIVE');
  if (e.submittedByUserId === actor.userId) fail('SELF_REVIEW_FORBIDDEN', 403);
  if (e.state !== 'PENDING') fail('ENTRY_NOT_PENDING');
  return action === 'approve' ? 'APPROVED' : 'REJECTED';
}
export function goalTransition(
  action: 'close' | 'cancel',
  state: GoalState,
): GoalState {
  assertActive(state);
  return action === 'close' ? 'CLOSED' : 'CANCELED';
}
export type ParticipantFacts = {
  id: string;
  state: 'ACTIVE' | 'WITHDRAWN';
  completedAt: Date | null;
  total: number;
};
/**
 * Deterministic completion. CHALLENGE: an active participant completes when
 * their own approved total reaches the target. GOAL: the goal completes when
 * the collective approved total reaches the target, and the participants
 * active at that moment receive the badge. A later correction below the
 * target revokes it. Withdrawn participants keep their recorded outcome.
 */
export function settleCompletion(input: {
  kind: GoalKind;
  target: number;
  total: number;
  goalCompletedAt: Date | null;
  participants: ParticipantFacts[];
  now: Date;
}) {
  const active = input.participants.filter((p) => p.state === 'ACTIVE');
  if (input.kind === 'CHALLENGE')
    return {
      goalCompletedAt: null,
      awards: active
        .filter((p) => p.total >= input.target && !p.completedAt)
        .map((p) => p.id),
      revocations: active
        .filter((p) => p.total < input.target && p.completedAt)
        .map((p) => p.id),
    };
  const done = input.total >= input.target;
  if (done && !input.goalCompletedAt)
    return {
      goalCompletedAt: input.now,
      awards: active.filter((p) => !p.completedAt).map((p) => p.id),
      revocations: [],
    };
  if (!done && input.goalCompletedAt)
    return {
      goalCompletedAt: null,
      awards: [],
      revocations: active.filter((p) => p.completedAt).map((p) => p.id),
    };
  return {
    goalCompletedAt: input.goalCompletedAt,
    awards: [],
    revocations: [],
  };
}
/** An organizer correction may not take a participant below zero. */
export function assertCorrection(current: number, delta: number) {
  if (current + delta < 0) fail('NEGATIVE_TOTAL', 422);
}
