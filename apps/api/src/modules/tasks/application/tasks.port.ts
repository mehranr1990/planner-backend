import type {
  TaskCreate,
  TaskListQuery,
  TaskSubtaskQuery,
  TaskCursorQuery,
  ChecklistCreate,
  ChecklistPatch,
  TaskTemplateCreate,
  TaskTemplatePatch,
  SavedTaskFilterCreate,
  SavedTaskFilterPatch,
  TaskTemplateSchema,
  SavedTaskFilterSchema,
  BulkTaskResult,
  Series,
  Occurrence,
} from '@mehran/api-contracts';
import type { z } from 'zod';
import type { RecurrenceDefinition } from '../domain/recurrence.js';
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
  series(id: string): Promise<Series>;
  requireMasterCandidate(id: string): Promise<void>;
  retainedInLineage(series: Series, localDate: string): Promise<boolean>;
  allSeries(query: TaskCursorQuery): Promise<Page<Series>>;
  insertSeries(input: {
    id: string;
    masterTaskId: string;
    previousSeriesId: string | null;
    definition: RecurrenceDefinition;
  }): Promise<Series>;
  updateSeries(
    before: Series,
    patch: {
      definition?: RecurrenceDefinition;
      scannedThrough?: string | null;
      retiredAt?: string | null;
      splitBefore?: string;
    },
    incrementRevision?: boolean,
  ): Promise<Series>;
  occurrence(id: string): Promise<Occurrence>;
  occurrenceByKey(seriesId: string, key: string): Promise<Occurrence | null>;
  occurrences(
    seriesId: string,
    query: TaskCursorQuery,
  ): Promise<Page<Occurrence>>;
  pendingOccurrences(seriesId: string, after?: string): Promise<Occurrence[]>;
  insertOccurrence(input: {
    seriesId: string;
    taskId: string | null;
    recurrenceKey: string;
    localDate: string;
    localTime: string;
    timezone: string;
    scheduledAt: string | null;
    state: Occurrence['state'];
    reason: Occurrence['reason'];
  }): Promise<Occurrence>;
  updateOccurrence(
    before: Occurrence,
    patch: Partial<
      Pick<
        Occurrence,
        | 'state'
        | 'reason'
        | 'exception'
        | 'scheduledAt'
        | 'localDate'
        | 'localTime'
        | 'timezone'
      >
    >,
  ): Promise<Occurrence>;
  audit(
    action:
      | 'TASK_RECURRENCE_CREATE'
      | 'TASK_RECURRENCE_EDIT'
      | 'TASK_RECURRENCE_CANCEL'
      | 'TASK_OCCURRENCE_SKIP'
      | 'TASK_OCCURRENCE_CANCEL',
    id: string,
  ): Promise<void>;
  template(id: string): Promise<z.infer<typeof TaskTemplateSchema>>;
  templates(
    query: TaskCursorQuery,
  ): Promise<Page<z.infer<typeof TaskTemplateSchema>>>;
  insertTemplate(
    input: TaskTemplateCreate,
  ): Promise<z.infer<typeof TaskTemplateSchema>>;
  updateTemplate(
    id: string,
    revision: number,
    input: TaskTemplatePatch,
  ): Promise<z.infer<typeof TaskTemplateSchema>>;
  deleteTemplate(id: string, revision: number): Promise<void>;
  savedFilter(id: string): Promise<z.infer<typeof SavedTaskFilterSchema>>;
  savedFilters(
    query: TaskCursorQuery,
  ): Promise<Page<z.infer<typeof SavedTaskFilterSchema>>>;
  insertSavedFilter(
    input: SavedTaskFilterCreate,
  ): Promise<z.infer<typeof SavedTaskFilterSchema>>;
  updateSavedFilter(
    id: string,
    revision: number,
    input: SavedTaskFilterPatch,
  ): Promise<z.infer<typeof SavedTaskFilterSchema>>;
  deleteSavedFilter(id: string, revision: number): Promise<void>;
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
  bulkItemOnce(
    scope: AuthorizedSpace,
    key: string,
    request: { index: number; batch: unknown },
    work: (tx: TaskTransaction) => Promise<BulkTaskResult>,
  ): Promise<BulkTaskResult>;
  templateTaskOnce(
    scope: AuthorizedSpace,
    key: string,
    request: unknown,
    work: (tx: TaskTransaction) => Promise<TaskRecord>,
  ): Promise<TaskRecord>;
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
