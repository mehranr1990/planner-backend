import type {
  TaskCreate,
  TaskListQuery,
  TaskSubtaskQuery,
  TaskCursorQuery,
  ChecklistCreate,
  ChecklistPatch,
} from '@mehran/api-contracts';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import type {
  TaskRecord,
  TaskNode,
  TaskWrite,
  ChecklistRecord,
  LabelRecord,
  TaskChangeInput,
  TaskChangeRecord,
  AttachmentRecord,
  Page,
} from '../domain/tasks.js';

export const TASKS_REPOSITORY = Symbol('TASKS_REPOSITORY');
export interface TaskReader {
  task(id: string, includeDeleted?: boolean): Promise<TaskRecord>;
  tasks(query: TaskListQuery): Promise<Page<TaskRecord>>;
  subtasks(id: string, query: TaskSubtaskQuery): Promise<Page<TaskRecord>>;
  checklist(
    taskId: string,
    query: TaskCursorQuery,
  ): Promise<Page<ChecklistRecord>>;
  checklistItem(taskId: string, itemId: string): Promise<ChecklistRecord>;
  label(id: string): Promise<LabelRecord>;
  labels(query: TaskCursorQuery, taskId?: string): Promise<Page<LabelRecord>>;
  attachments(
    taskId: string,
    query: TaskCursorQuery,
  ): Promise<Page<AttachmentRecord>>;
  history(
    taskId: string,
    query: TaskCursorQuery,
  ): Promise<Page<TaskChangeRecord>>;
}
export interface TaskTransaction extends TaskReader {
  ancestors(id: string): Promise<TaskNode[]>;
  subtree(id: string): Promise<TaskNode[]>;
  insertTask(input: TaskCreate & { id: string }): Promise<TaskRecord>;
  updateTask(task: TaskRecord, patch: TaskWrite): Promise<TaskRecord>;
  updateTasks(tasks: TaskNode[], patch: TaskWrite): Promise<TaskNode[]>;
  record(changes: TaskChangeInput[]): Promise<void>;
  events(
    type:
      | 'task.created'
      | 'task.updated'
      | 'task.completed'
      | 'task.reopened'
      | 'task.deleted'
      | 'task.due_changed',
    ids: string[],
  ): Promise<void>;
  insertChecklist(
    taskId: string,
    input: ChecklistCreate,
  ): Promise<ChecklistRecord>;
  updateChecklist(
    taskId: string,
    id: string,
    input: ChecklistPatch,
  ): Promise<ChecklistRecord>;
  deleteChecklist(taskId: string, id: string): Promise<void>;
  insertLabel(name: string): Promise<LabelRecord>;
  updateLabel(label: LabelRecord, name: string): Promise<LabelRecord>;
  deleteLabel(id: string): Promise<void>;
  tasksForLabel(id: string): Promise<TaskNode[]>;
  setLabel(taskId: string, labelId: string, present: boolean): Promise<boolean>;
  setAttachment(
    taskId: string,
    fileId: string,
    present: boolean,
  ): Promise<boolean>;
}
export interface TasksPort {
  read(scope: AuthorizedSpace): TaskReader;
  transaction<T>(
    scope: AuthorizedSpace,
    work: (tx: TaskTransaction) => Promise<T>,
  ): Promise<T>;
  createTaskOnce(
    scope: AuthorizedSpace,
    input: TaskCreate,
    key: string | undefined,
    work: (tx: TaskTransaction) => Promise<TaskRecord>,
  ): Promise<TaskRecord>;
}
