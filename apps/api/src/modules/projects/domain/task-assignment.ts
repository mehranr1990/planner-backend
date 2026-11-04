export type AssignmentKind = 'PRIMARY' | 'CONTRIBUTOR';
export type AssignmentDecision = 'PENDING' | 'ACCEPTED' | 'DECLINED';
export type AssignmentEndReason = 'DECLINED' | 'REVOKED' | 'REASSIGNED';

/** Consent is separate from Task status and survives reassignment as history. */
export type TaskAssignment = Readonly<{
  id: string;
  spaceId: string;
  scopeId: string;
  taskId: string;
  kind: AssignmentKind;
  recipientAccessId: string;
  recipientGeneration: number;
  decision: AssignmentDecision;
  revision: number;
  respondedAt: Date | null;
  declineReason: string | null;
  endedAt: Date | null;
  endReason: AssignmentEndReason | null;
}>;

export type AssignmentRecipient = Readonly<{
  spaceId: string;
  scopeId: string;
  accessId: string;
  generation: number;
}>;

function mutable(before: TaskAssignment, revision: number, now: Date) {
  if (before.endedAt || before.revision !== revision)
    throw new Error('ASSIGNMENT_CONFLICT');
  if (!Number.isFinite(now.getTime()))
    throw new Error('INVALID_ASSIGNMENT_TIME');
  if (before.revision >= 2147483646)
    throw new Error('ASSIGNMENT_REVISION_EXHAUSTED');
}

/** Call only after current session, policy and source authority are fenced. */
export function respondToAssignment(
  before: TaskAssignment,
  recipient: AssignmentRecipient,
  revision: number,
  response: { decision: 'ACCEPTED' } | { decision: 'DECLINED'; reason: string },
  now: Date,
): TaskAssignment {
  if (
    recipient.spaceId !== before.spaceId ||
    recipient.scopeId !== before.scopeId ||
    recipient.accessId !== before.recipientAccessId ||
    recipient.generation !== before.recipientGeneration
  )
    throw new Error('ASSIGNMENT_RECIPIENT_MISMATCH');
  mutable(before, revision, now);
  if (before.decision !== 'PENDING') throw new Error('ASSIGNMENT_CONFLICT');
  const reason =
    response.decision === 'DECLINED' ? response.reason.trim() : null;
  if (
    reason !== null &&
    (!reason ||
      reason.length > 2000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(reason))
  )
    throw new Error('INVALID_DECLINE_REASON');
  const declined = response.decision === 'DECLINED';
  return {
    ...before,
    decision: response.decision,
    revision: before.revision + 1,
    respondedAt: new Date(now),
    declineReason: reason,
    endedAt: declined ? new Date(now) : null,
    endReason: declined ? 'DECLINED' : null,
  };
}

/** End the old assignment; a replacement must receive its own pending consent. */
export function endAssignment(
  before: TaskAssignment,
  revision: number,
  reason: 'REVOKED' | 'REASSIGNED',
  now: Date,
): TaskAssignment {
  mutable(before, revision, now);
  return {
    ...before,
    revision: before.revision + 1,
    endedAt: new Date(now),
    endReason: reason,
  };
}
