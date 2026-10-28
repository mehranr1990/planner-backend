export type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELED';
export type TaskPriority = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type TaskDescription = {
  format: 'MARKDOWN';
  version: 1;
  content: string;
};
export type TaskRecord = {
  isRecurrenceMaster?: boolean;
  id: string;
  spaceId: string;
  createdByUserId: string;
  title: string;
  description: TaskDescription | null;
  status: TaskStatus;
  priority: TaskPriority;
  parentTaskId: string | null;
  plannedStartAt: Date | null;
  dueAt: Date | null;
  scheduledDate: string | null;
  completedAt: Date | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  deletionBatchId: string | null;
};
export type TaskNode = Pick<
  TaskRecord,
  | 'id'
  | 'parentTaskId'
  | 'status'
  | 'priority'
  | 'revision'
  | 'deletedAt'
  | 'deletionBatchId'
  | 'updatedAt'
>;
export type ChecklistRecord = {
  id: string;
  taskId: string;
  title: string;
  completed: boolean;
  position: number;
  createdAt: Date;
  updatedAt: Date;
};
export type LabelRecord = {
  id: string;
  name: string;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
};
export type ChangeKind =
  | 'CREATED'
  | 'UPDATED'
  | 'COMPLETED'
  | 'REOPENED'
  | 'DELETED'
  | 'RESTORED'
  | 'CHECKLIST_CREATED'
  | 'CHECKLIST_UPDATED'
  | 'CHECKLIST_DELETED'
  | 'LABEL_ADDED'
  | 'LABEL_REMOVED'
  | 'ATTACHMENT_BOUND'
  | 'ATTACHMENT_UNBOUND';
export type TaskField =
  | 'title'
  | 'description'
  | 'status'
  | 'priority'
  | 'parentTaskId'
  | 'plannedStartAt'
  | 'dueAt'
  | 'scheduledDate'
  | 'completedAt'
  | 'deletedAt'
  | 'checklistItems'
  | 'labels'
  | 'attachments';
export type TaskChangeInput = {
  taskId: string;
  kind: ChangeKind;
  fields: TaskField[];
  previousRevision: number;
  revision: number;
  beforeStatus: TaskStatus | null;
  afterStatus: TaskStatus;
  beforePriority: TaskPriority | null;
  afterPriority: TaskPriority;
  relatedId: string | null;
};
export type TaskChangeRecord = TaskChangeInput & {
  id: string;
  actorUserId: string;
  createdAt: Date;
};
export type TaskWrite = Partial<
  Pick<
    TaskRecord,
    | 'title'
    | 'description'
    | 'status'
    | 'priority'
    | 'parentTaskId'
    | 'plannedStartAt'
    | 'dueAt'
    | 'scheduledDate'
    | 'completedAt'
    | 'deletedAt'
    | 'deletionBatchId'
  >
>;
export type AttachmentRecord = {
  fileId: string;
  filename: string;
  mimeType: string;
  status: 'INITIATED' | 'READY' | 'REJECTED' | 'DELETED';
  size: number | null;
  attachedAt: Date;
};
export type Page<T> = { items: T[]; nextCursor: string | null };

export const MAX_TASK_DEPTH = 5;
export const TASK_RESTORE_MS = 30 * 86400000;
export class TaskRuleError extends Error {
  constructor(
    readonly code: 'HIERARCHY' | 'STATE' | 'RESTORE_EXPIRED' | 'POSITION',
  ) {
    super('Task rule rejected the operation');
  }
}
export const normalizeTitle = (value: string) =>
  value.normalize('NFC').trim().replace(/\s+/gu, ' ');
export function validateHierarchy(
  id: string,
  parentChain: TaskNode[],
  subtree: TaskNode[],
): void {
  if (parentChain.some((node) => node.id === id))
    throw new TaskRuleError('HIERARCHY');
  const children = new Map<string, TaskNode[]>();
  for (const node of subtree)
    if (node.id !== id && node.parentTaskId) {
      const list = children.get(node.parentTaskId) ?? [];
      list.push(node);
      children.set(node.parentTaskId, list);
    }
  const visit = (nodeId: string, path: Set<string>): number => {
    if (path.has(nodeId) || path.size + parentChain.length > MAX_TASK_DEPTH)
      throw new TaskRuleError('HIERARCHY');
    const next = new Set([...path, nodeId]);
    let height = 0;
    for (const node of children.get(nodeId) ?? [])
      height = Math.max(height, 1 + visit(node.id, next));
    return height;
  };
  if (parentChain.length + visit(id, new Set()) > MAX_TASK_DEPTH)
    throw new TaskRuleError('HIERARCHY');
}
export function transition(
  task: TaskRecord,
  action: 'complete' | 'reopen',
  now: Date,
): TaskWrite {
  if (action === 'complete')
    return task.status === 'DONE' ? {} : { status: 'DONE', completedAt: now };
  return task.status === 'OPEN' ? {} : { status: 'OPEN', completedAt: null };
}
export function requireRestorable(task: TaskRecord, now: Date): void {
  if (
    !task.deletedAt ||
    now.getTime() - task.deletedAt.getTime() >= TASK_RESTORE_MS
  )
    throw new TaskRuleError('RESTORE_EXPIRED');
}
export function changedFields(task: TaskRecord, patch: TaskWrite): TaskField[] {
  return (Object.keys(patch) as Array<keyof TaskWrite>).filter(
    (key) =>
      key !== 'deletionBatchId' &&
      JSON.stringify(task[key]) !== JSON.stringify(patch[key]),
  ) as TaskField[];
}
export function history(
  before: TaskNode | null,
  after: TaskNode,
  kind: ChangeKind,
  fields: TaskField[],
  relatedId: string | null = null,
): TaskChangeInput {
  return {
    taskId: after.id,
    kind,
    fields,
    previousRevision: before?.revision ?? 0,
    revision: after.revision,
    beforeStatus: before?.status ?? null,
    afterStatus: after.status,
    beforePriority: before?.priority ?? null,
    afterPriority: after.priority,
    relatedId,
  };
}
