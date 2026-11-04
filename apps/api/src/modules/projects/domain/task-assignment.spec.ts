import { describe, expect, it } from 'vitest';
import { endAssignment, respondToAssignment } from './task-assignment.js';
import type { TaskAssignment, AssignmentRecipient } from './task-assignment.js';

const now = new Date('2026-11-04T12:00:00Z');
const recipient: AssignmentRecipient = {
  spaceId: 'project-space',
  scopeId: 'project-scope',
  accessId: 'named-admission',
  generation: 3,
};
const pending = (kind: TaskAssignment['kind'] = 'PRIMARY'): TaskAssignment => ({
  id: 'assignment',
  spaceId: recipient.spaceId,
  scopeId: recipient.scopeId,
  taskId: 'existing-task',
  kind,
  recipientAccessId: recipient.accessId,
  recipientGeneration: recipient.generation,
  decision: 'PENDING',
  revision: 1,
  respondedAt: null,
  declineReason: null,
  endedAt: null,
  endReason: null,
});

describe('P2-04 assignment consent invariants', () => {
  it.each(['PRIMARY', 'CONTRIBUTOR'] as const)(
    'accepts the named %s without changing the source Task or original decision',
    (kind) => {
      const before = Object.freeze(pending(kind));
      const after = respondToAssignment(
        before,
        recipient,
        1,
        { decision: 'ACCEPTED' },
        now,
      );
      expect(after).toMatchObject({
        taskId: before.taskId,
        kind,
        decision: 'ACCEPTED',
        revision: 2,
        respondedAt: now,
        endedAt: null,
        endReason: null,
        declineReason: null,
      });
      expect(after).not.toHaveProperty('status');
      expect(before.decision).toBe('PENDING');
    },
  );

  it('requires and retains a decline reason while ending only the assignment', () => {
    const after = respondToAssignment(
      pending(),
      recipient,
      1,
      { decision: 'DECLINED', reason: '  Capacity unavailable  ' },
      now,
    );
    expect(after).toMatchObject({
      taskId: 'existing-task',
      decision: 'DECLINED',
      declineReason: 'Capacity unavailable',
      respondedAt: now,
      endedAt: now,
      endReason: 'DECLINED',
      revision: 2,
    });
  });

  it.each(['', '  ', 'x'.repeat(2001), 'invalid\u0000reason'])(
    'rejects an invalid decline reason without mutating the prior decision',
    (reason) => {
      const before = Object.freeze(pending());
      expect(() =>
        respondToAssignment(
          before,
          recipient,
          1,
          { decision: 'DECLINED', reason },
          now,
        ),
      ).toThrow('INVALID_DECLINE_REASON');
      expect(before.decision).toBe('PENDING');
      expect(before.revision).toBe(1);
    },
  );

  it.each([
    { spaceId: 'other-space' },
    { scopeId: 'other-scope' },
    { accessId: 'another-person' },
    { generation: 4 },
  ])('rejects a foreign or readmitted recipient: %o', (override) => {
    expect(() =>
      respondToAssignment(
        pending(),
        { ...recipient, ...override },
        1,
        { decision: 'ACCEPTED' },
        now,
      ),
    ).toThrow('ASSIGNMENT_RECIPIENT_MISMATCH');
  });

  it('rejects stale revisions and an already terminal response', () => {
    expect(() =>
      respondToAssignment(
        pending(),
        recipient,
        2,
        { decision: 'ACCEPTED' },
        now,
      ),
    ).toThrow('ASSIGNMENT_CONFLICT');
    const accepted = respondToAssignment(
      pending(),
      recipient,
      1,
      { decision: 'ACCEPTED' },
      now,
    );
    expect(() =>
      respondToAssignment(
        accepted,
        recipient,
        2,
        { decision: 'DECLINED', reason: 'A different decision' },
        now,
      ),
    ).toThrow('ASSIGNMENT_CONFLICT');
  });

  it('retains accepted consent when ending the old assignment for reassignment', () => {
    const accepted = respondToAssignment(
      pending(),
      recipient,
      1,
      { decision: 'ACCEPTED' },
      now,
    );
    const ended = endAssignment(
      accepted,
      2,
      'REASSIGNED',
      new Date(now.getTime() + 1),
    );
    expect(ended).toMatchObject({
      decision: 'ACCEPTED',
      respondedAt: now,
      endReason: 'REASSIGNED',
      revision: 3,
    });
    expect(accepted.endedAt).toBeNull();
    expect(() =>
      respondToAssignment(ended, recipient, 3, { decision: 'ACCEPTED' }, now),
    ).toThrow('ASSIGNMENT_CONFLICT');
  });

  it('revokes a pending assignment without manufacturing acceptance', () => {
    const ended = endAssignment(pending('CONTRIBUTOR'), 1, 'REVOKED', now);
    expect(ended).toMatchObject({
      decision: 'PENDING',
      respondedAt: null,
      endReason: 'REVOKED',
      endedAt: now,
    });
    expect(() => endAssignment(ended, 2, 'REVOKED', now)).toThrow(
      'ASSIGNMENT_CONFLICT',
    );
  });

  it('rejects invalid clocks and exhausted revisions', () => {
    expect(() =>
      respondToAssignment(
        pending(),
        recipient,
        1,
        { decision: 'ACCEPTED' },
        new Date('invalid'),
      ),
    ).toThrow('INVALID_ASSIGNMENT_TIME');
    expect(() =>
      endAssignment(
        { ...pending(), revision: 2147483646 },
        2147483646,
        'REVOKED',
        now,
      ),
    ).toThrow('ASSIGNMENT_REVISION_EXHAUSTED');
  });
});
