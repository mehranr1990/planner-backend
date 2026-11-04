import type { TaskStatus } from './tasks.js';
export type WorkflowState = Readonly<{
  id: string;
  label: string;
  status: TaskStatus;
}>;
export type WorkflowEdge = Readonly<{
  id: string;
  fromStateId: string;
  toStateId: string;
  requiresApproval: boolean;
  approvers: readonly { accessId: string; generation: number }[];
}>;
export class WorkflowRuleError extends Error {
  constructor(
    readonly code:
      | 'INVALID_WORKFLOW'
      | 'INVALID_TRANSITION'
      | 'AMBIGUOUS_TRANSITION'
      | 'APPROVAL_REQUIRED'
      | 'STATE_MISMATCH'
      | 'NOT_APPROVER'
      | 'SELF_APPROVAL',
  ) {
    super(code);
  }
}
export function validateWorkflow(
  states: readonly WorkflowState[],
  edges: readonly WorkflowEdge[],
): void {
  const ids = new Set(states.map((s) => s.id)),
    edgeIds = new Set<string>(),
    pairs = new Set<string>();
  if (
    !states.length ||
    states.length > 32 ||
    edges.length > 128 ||
    ids.size !== states.length ||
    states.some(
      (s) =>
        !s.label.trim() ||
        s.label.length > 100 ||
        !['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELED'].includes(s.status),
    )
  )
    throw new WorkflowRuleError('INVALID_WORKFLOW');
  for (const e of edges) {
    const pair = e.fromStateId + ':' + e.toStateId;
    if (
      !ids.has(e.fromStateId) ||
      !ids.has(e.toStateId) ||
      e.fromStateId === e.toStateId ||
      edgeIds.has(e.id) ||
      pairs.has(pair) ||
      e.approvers.length > 20 ||
      new Set(e.approvers.map((a) => a.accessId)).size !== e.approvers.length ||
      e.approvers.some(
        (a) => !Number.isSafeInteger(a.generation) || a.generation < 1,
      ) ||
      e.requiresApproval !== Boolean(e.approvers.length)
    )
      throw new WorkflowRuleError('INVALID_WORKFLOW');
    edgeIds.add(e.id);
    pairs.add(pair);
  }
}
export function workflowEdge(
  states: readonly WorkflowState[],
  edges: readonly WorkflowEdge[],
  stateId: string,
  status: TaskStatus,
  edgeId: string,
): { edge: WorkflowEdge; target: WorkflowState } {
  const current = states.find((s) => s.id === stateId);
  if (!current || current.status !== status)
    throw new WorkflowRuleError('STATE_MISMATCH');
  const edge = edges.find((e) => e.id === edgeId && e.fromStateId === stateId),
    target = edge && states.find((s) => s.id === edge.toStateId);
  if (!edge || !target) throw new WorkflowRuleError('INVALID_TRANSITION');
  return { edge, target };
}
/** Compatibility adapter for old status PATCH: only an unambiguous, nonapproval edge may execute. */
export function legacyWorkflowEdge(
  states: readonly WorkflowState[],
  edges: readonly WorkflowEdge[],
  stateId: string,
  currentStatus: TaskStatus,
  targetStatus: TaskStatus,
): WorkflowEdge | null {
  const current = states.find((s) => s.id === stateId);
  if (!current || current.status !== currentStatus)
    throw new WorkflowRuleError('STATE_MISMATCH');
  if (currentStatus === targetStatus) return null;
  const targets = new Set(
      states.filter((s) => s.status === targetStatus).map((s) => s.id),
    ),
    candidates = edges.filter(
      (e) => e.fromStateId === stateId && targets.has(e.toStateId),
    );
  if (!candidates.length) throw new WorkflowRuleError('INVALID_TRANSITION');
  if (candidates.length > 1)
    throw new WorkflowRuleError('AMBIGUOUS_TRANSITION');
  if (candidates[0]!.requiresApproval)
    throw new WorkflowRuleError('APPROVAL_REQUIRED');
  return candidates[0]!;
}
export function designatedApprover(
  edge: WorkflowEdge,
  requester: { accessId: string; actorId: string },
  decider: { accessId: string; generation: number; actorId: string },
): void {
  if (
    requester.accessId === decider.accessId ||
    requester.actorId === decider.actorId
  )
    throw new WorkflowRuleError('SELF_APPROVAL');
  if (
    !edge.requiresApproval ||
    !edge.approvers.some(
      (a) =>
        a.accessId === decider.accessId && a.generation === decider.generation,
    )
  )
    throw new WorkflowRuleError('NOT_APPROVER');
}
