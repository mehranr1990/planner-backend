import { it, expect, describe } from 'vitest';
import {
  validateWorkflow,
  workflowEdge,
  legacyWorkflowEdge,
  designatedApprover,
} from './workflows.js';
import type { WorkflowEdge } from './workflows.js';
const states = [
  { id: 'open', label: 'Open', status: 'OPEN' as const },
  { id: 'review', label: 'Review', status: 'IN_PROGRESS' as const },
  { id: 'done', label: 'Done', status: 'DONE' as const },
];
const direct: WorkflowEdge = {
  id: 'start',
  fromStateId: 'open',
  toStateId: 'review',
  requiresApproval: false,
  approvers: [],
};
const approval: WorkflowEdge = {
  id: 'finish',
  fromStateId: 'review',
  toStateId: 'done',
  requiresApproval: true,
  approvers: [{ accessId: 'approver', generation: 2 }],
};
describe('P2-05 pinned workflow and ADR0032 approval rules', () => {
  it('validates explicit transitions and maps custom states to the existing Task lifecycle', () => {
    validateWorkflow(states, [direct, approval]);
    expect(
      workflowEdge(states, [direct, approval], 'open', 'OPEN', 'start').target
        .status,
    ).toBe('IN_PROGRESS');
  });
  it('rejects foreign state references, duplicate edges, missing approvers and invalid generations', () => {
    for (const edge of [
      { ...direct, toStateId: 'foreign' },
      { ...approval, approvers: [] },
      { ...direct, approvers: [{ accessId: 'x', generation: 1 }] },
      { ...approval, approvers: [{ accessId: 'x', generation: 0 }] },
    ])
      expect(() => validateWorkflow(states, [edge])).toThrow(
        'INVALID_WORKFLOW',
      );
    expect(() => validateWorkflow(states, [direct, direct])).toThrow(
      'INVALID_WORKFLOW',
    );
  });
  it('supports legacy status changes only through the exact pinned edge', () => {
    expect(
      legacyWorkflowEdge(
        states,
        [direct, approval],
        'open',
        'OPEN',
        'IN_PROGRESS',
      ),
    ).toBe(direct);
    expect(() =>
      legacyWorkflowEdge(states, [direct, approval], 'open', 'OPEN', 'DONE'),
    ).toThrow('INVALID_TRANSITION');
    expect(() =>
      legacyWorkflowEdge(
        states,
        [direct, approval],
        'review',
        'IN_PROGRESS',
        'DONE',
      ),
    ).toThrow('APPROVAL_REQUIRED');
  });
  it('rejects ambiguous legacy mapping without choosing or rewriting a custom state', () => {
    expect(() =>
      legacyWorkflowEdge(
        [...states, { id: 'other', label: 'Other', status: 'IN_PROGRESS' }],
        [direct, { ...direct, id: 'other-edge', toStateId: 'other' }],
        'open',
        'OPEN',
        'IN_PROGRESS',
      ),
    ).toThrow('AMBIGUOUS_TRANSITION');
  });
  it('detects source/workflow drift and leaves exact old status no-ops unchanged', () => {
    expect(() =>
      workflowEdge(states, [direct], 'open', 'DONE', 'start'),
    ).toThrow('STATE_MISMATCH');
    expect(
      legacyWorkflowEdge(states, [direct], 'open', 'OPEN', 'OPEN'),
    ).toBeNull();
  });
  it('requires the named current admission generation', () => {
    expect(() =>
      designatedApprover(
        approval,
        { accessId: 'requester', actorId: 'requester-actor' },
        { accessId: 'approver', generation: 2, actorId: 'approver-actor' },
      ),
    ).not.toThrow();
    expect(() =>
      designatedApprover(
        approval,
        { accessId: 'requester', actorId: 'requester-actor' },
        { accessId: 'approver', generation: 3, actorId: 'approver-actor' },
      ),
    ).toThrow('NOT_APPROVER');
    expect(() =>
      designatedApprover(
        approval,
        { accessId: 'requester', actorId: 'requester-actor' },
        {
          accessId: 'owner-not-designated',
          generation: 1,
          actorId: 'owner-actor',
        },
      ),
    ).toThrow('NOT_APPROVER');
  });
  it('forbids self-approval even for a designated current Owner or another access record for the same actor', () => {
    expect(() =>
      designatedApprover(
        approval,
        { accessId: 'approver', actorId: 'same' },
        { accessId: 'approver', generation: 2, actorId: 'same' },
      ),
    ).toThrow('SELF_APPROVAL');
    expect(() =>
      designatedApprover(
        approval,
        { accessId: 'other-access', actorId: 'same' },
        { accessId: 'approver', generation: 2, actorId: 'same' },
      ),
    ).toThrow('SELF_APPROVAL');
  });
});
