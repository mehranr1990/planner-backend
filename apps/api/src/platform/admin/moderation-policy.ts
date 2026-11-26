export const moderationStates = [
  'NEW',
  'TRIAGED',
  'INVESTIGATING',
  'ACTION_TAKEN',
  'DISMISSED',
  'APPEALED',
  'CLOSED',
] as const;
export type ModerationState = (typeof moderationStates)[number];
const transitions: Record<ModerationState, readonly ModerationState[]> = {
  NEW: ['TRIAGED', 'DISMISSED'],
  TRIAGED: ['INVESTIGATING', 'DISMISSED'],
  INVESTIGATING: ['ACTION_TAKEN', 'DISMISSED'],
  ACTION_TAKEN: ['APPEALED', 'CLOSED'],
  DISMISSED: ['APPEALED', 'CLOSED'],
  APPEALED: ['INVESTIGATING', 'ACTION_TAKEN', 'DISMISSED'],
  CLOSED: [],
};
export function moderationTransition(
  before: ModerationState,
  after: ModerationState,
): void {
  if (!transitions[before]?.includes(after))
    throw new Error('INVALID_MODERATION_TRANSITION');
}
export function moderationAppeal(input: {
  state: ModerationState;
  now: Date;
  decidedAt: Date | null;
  appealDays: number;
  alreadyAppealed: boolean;
}): void {
  if (
    !['ACTION_TAKEN', 'DISMISSED'].includes(input.state) ||
    input.alreadyAppealed ||
    !Number.isInteger(input.appealDays) ||
    input.appealDays < 1 ||
    input.appealDays > 90 ||
    !input.decidedAt ||
    input.decidedAt > input.now ||
    input.now.getTime() >=
      input.decidedAt.getTime() + input.appealDays * 86400000
  )
    throw new Error('MODERATION_APPEAL_UNAVAILABLE');
}
export function independentAppealReviewer(
  originalAdminId: string | null,
  reviewerAdminId: string,
): void {
  if (!originalAdminId || originalAdminId === reviewerAdminId)
    throw new Error('INDEPENDENT_APPEAL_REVIEWER_REQUIRED');
}
/** Permission alone never widens the exact target bound to an open case. */
export function reportedItemAccess(input: {
  permitted: boolean;
  caseId: string;
  requestedCaseId: string;
  reportedItemId: string | null;
  requestedItemId: string;
  state: ModerationState;
  sourceAvailable: boolean;
}): void {
  if (
    !input.permitted ||
    input.caseId !== input.requestedCaseId ||
    !input.reportedItemId ||
    input.reportedItemId !== input.requestedItemId ||
    input.state === 'CLOSED' ||
    !input.sourceAvailable
  )
    throw new Error('REPORTED_ITEM_ACCESS_DENIED');
}
