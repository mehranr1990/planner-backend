import { z } from 'zod';
import { CursorQuerySchema } from './foundation.js';

export const TaskIdSchema = z.string().uuid();
export const TaskStatusSchema = z.enum([
  'OPEN',
  'IN_PROGRESS',
  'DONE',
  'CANCELED',
]);
export const TaskPrioritySchema = z.enum([
  'NONE',
  'LOW',
  'MEDIUM',
  'HIGH',
  'URGENT',
]);
const EditableStatusSchema = z.enum(['OPEN', 'IN_PROGRESS', 'CANCELED']);
const safeText = (value: string) =>
  !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ud800-\udfff]/u.test(value);
const TitleSchema = z.string().trim().min(1).max(300).refine(safeText);
const InstantSchema = z.iso
  .datetime()
  .refine((value) => !value.startsWith('0000-'));
const LocalDateSchema = z.iso
  .date()
  .refine((value) => !value.startsWith('0000-'));
export const TaskDescriptionSchema = z.strictObject({
  format: z.literal('MARKDOWN'),
  version: z.literal(1),
  content: z.string().max(20000).refine(safeText),
});
const TaskFields = {
  title: TitleSchema,
  description: TaskDescriptionSchema.nullable().optional(),
  status: EditableStatusSchema.optional(),
  priority: TaskPrioritySchema.optional(),
  parentTaskId: TaskIdSchema.nullable().optional(),
  plannedStartAt: InstantSchema.nullable().optional(),
  dueAt: InstantSchema.nullable().optional(),
  scheduledDate: LocalDateSchema.nullable().optional(),
};
export const TaskCreateSchema = z.strictObject(TaskFields);
export const SubtaskCreateSchema = TaskCreateSchema.omit({
  parentTaskId: true,
});
export const TaskPatchSchema = TaskCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
);
export const TaskSchema = z.strictObject({
  id: TaskIdSchema,
  spaceId: TaskIdSchema,
  createdByUserId: TaskIdSchema,
  title: TitleSchema,
  description: TaskDescriptionSchema.nullable(),
  status: TaskStatusSchema,
  priority: TaskPrioritySchema,
  parentTaskId: TaskIdSchema.nullable(),
  plannedStartAt: InstantSchema.nullable(),
  dueAt: InstantSchema.nullable(),
  scheduledDate: LocalDateSchema.nullable(),
  completedAt: InstantSchema.nullable(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
  revision: z.number().int().positive(),
  deletedAt: InstantSchema.nullable(),
  restoreUntil: InstantSchema.nullable(),
});
export const TaskReadQuerySchema = z.strictObject({
  includeDeleted: z.enum(['true', 'false']).optional(),
});
export const TaskListQuerySchema = CursorQuerySchema.extend({
  status: TaskStatusSchema.optional(),
  priority: TaskPrioritySchema.optional(),
  parentTaskId: TaskIdSchema.optional(),
  rootOnly: z.enum(['true', 'false']).optional(),
  labelId: TaskIdSchema.optional(),
  scheduledDate: LocalDateSchema.optional(),
  dueFrom: InstantSchema.optional(),
  dueTo: InstantSchema.optional(),
  deleted: z.enum(['true', 'false']).optional(),
})
  .refine((value) => !(value.parentTaskId && value.rootOnly === 'true'))
  .refine(
    (value) =>
      !value.dueFrom ||
      !value.dueTo ||
      Date.parse(value.dueFrom) <= Date.parse(value.dueTo),
  );
export const SubtaskQuerySchema = CursorQuerySchema.extend({
  recursive: z.enum(['true', 'false']).optional(),
});
export const ChecklistCreateSchema = z.strictObject({
  title: TitleSchema,
  position: z.number().int().min(0).max(2147483000).optional(),
});
export const ChecklistPatchSchema = z
  .strictObject({
    title: TitleSchema.optional(),
    completed: z.boolean().optional(),
    position: z.number().int().min(0).max(2147483000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0);
export const ChecklistSchema = z.strictObject({
  id: TaskIdSchema,
  taskId: TaskIdSchema,
  title: TitleSchema,
  completed: z.boolean(),
  position: z.number().int().nonnegative(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export const LabelCreateSchema = z.strictObject({
  name: z.string().trim().min(1).max(100).refine(safeText),
});
export const LabelPatchSchema = LabelCreateSchema;
export const LabelSchema = z.strictObject({
  id: TaskIdSchema,
  name: z.string().min(1).max(100),
  revision: z.number().int().positive(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export const TaskHistoryKindSchema = z.enum([
  'CREATED',
  'UPDATED',
  'COMPLETED',
  'REOPENED',
  'DELETED',
  'RESTORED',
  'CHECKLIST_CREATED',
  'CHECKLIST_UPDATED',
  'CHECKLIST_DELETED',
  'LABEL_ADDED',
  'LABEL_REMOVED',
  'ATTACHMENT_BOUND',
  'ATTACHMENT_UNBOUND',
]);
export const TaskFieldSchema = z.enum([
  'title',
  'description',
  'status',
  'priority',
  'parentTaskId',
  'plannedStartAt',
  'dueAt',
  'scheduledDate',
  'completedAt',
  'deletedAt',
  'checklistItems',
  'labels',
  'attachments',
]);
export const TaskChangeSchema = z.strictObject({
  id: TaskIdSchema,
  taskId: TaskIdSchema,
  actorUserId: TaskIdSchema,
  kind: TaskHistoryKindSchema,
  fields: z.array(TaskFieldSchema).max(13),
  previousRevision: z.number().int().nonnegative(),
  revision: z.number().int().positive(),
  beforeStatus: TaskStatusSchema.nullable(),
  afterStatus: TaskStatusSchema,
  beforePriority: TaskPrioritySchema.nullable(),
  afterPriority: TaskPrioritySchema,
  relatedId: TaskIdSchema.nullable(),
  createdAt: InstantSchema,
});
export const TaskAttachmentSchema = z.strictObject({
  fileId: TaskIdSchema,
  filename: z.string(),
  mimeType: z.string(),
  status: z.enum(['INITIATED', 'READY', 'REJECTED', 'DELETED']),
  size: z.number().int().positive().nullable(),
  attachedAt: InstantSchema,
});
const page = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    items: z.array(item).max(100),
    nextCursor: z.string().nullable(),
  });
export const TaskPageSchema = page(TaskSchema),
  ChecklistPageSchema = page(ChecklistSchema),
  LabelPageSchema = page(LabelSchema),
  TaskChangePageSchema = page(TaskChangeSchema),
  TaskAttachmentPageSchema = page(TaskAttachmentSchema);
export type TaskCreate = z.infer<typeof TaskCreateSchema>;
export type TaskPatch = z.infer<typeof TaskPatchSchema>;
export type TaskListQuery = z.infer<typeof TaskListQuerySchema>;
export type TaskSubtaskQuery = z.infer<typeof SubtaskQuerySchema>;
export type TaskCursorQuery = z.infer<typeof CursorQuerySchema>;
export type ChecklistCreate = z.infer<typeof ChecklistCreateSchema>;
export type ChecklistPatch = z.infer<typeof ChecklistPatchSchema>;

export const ChecklistMutationSchema = z.strictObject({
  task: TaskSchema,
  item: ChecklistSchema,
});
