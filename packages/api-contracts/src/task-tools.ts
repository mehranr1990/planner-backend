import { z } from 'zod';
import { CursorQuerySchema } from './foundation.js';
import {
  TaskCreateSchema,
  TaskPatchSchema,
  TaskSchema,
  TaskIdSchema,
  TaskListQuerySchema,
} from './tasks.js';

const Name = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => !/[\x00-\x1f\x7f]/u.test(value));
const Revision = z.number().int().positive();
const Instant = z.iso.datetime();
// Templates deliberately contain values, never IDs for private files, parents or labels.
export const TaskTemplateValuesSchema = z.strictObject({
  version: z.literal(1),
  task: TaskCreateSchema.omit({
    parentTaskId: true,
    plannedStartAt: true,
    dueAt: true,
    scheduledDate: true,
    status: true,
  }),
  checklist: z
    .array(z.strictObject({ title: TaskCreateSchema.shape.title }))
    .max(100),
});
export const TaskTemplateCreateSchema = z.strictObject({
  name: Name,
  values: TaskTemplateValuesSchema,
});
export const TaskTemplatePatchSchema =
  TaskTemplateCreateSchema.partial().refine(
    (value) => Object.keys(value).length > 0,
  );
export const TaskTemplateApplySchema = z.strictObject({
  revision: Revision,
  overrides: TaskCreateSchema.omit({ parentTaskId: true, status: true })
    .partial()
    .optional(),
});
const resourceFields = {
  id: TaskIdSchema,
  spaceId: TaskIdSchema,
  createdByUserId: TaskIdSchema,
  revision: Revision,
  createdAt: Instant,
  updatedAt: Instant,
};
export const TaskTemplateSchema = z.strictObject({
  ...resourceFields,
  ...TaskTemplateCreateSchema.shape,
});
// A versioned conjunction of the existing Task list predicates, without pagination.
export const SavedTaskQuerySchema = z.strictObject({
  version: z.literal(1),
  where: z
    .strictObject({
      status: TaskListQuerySchema.shape.status,
      priority: TaskListQuerySchema.shape.priority,
      parentTaskId: TaskListQuerySchema.shape.parentTaskId,
      rootOnly: TaskListQuerySchema.shape.rootOnly,
      labelId: TaskListQuerySchema.shape.labelId,
      scheduledDate: TaskListQuerySchema.shape.scheduledDate,
      dueFrom: TaskListQuerySchema.shape.dueFrom,
      dueTo: TaskListQuerySchema.shape.dueTo,
      deleted: TaskListQuerySchema.shape.deleted,
    })
    .refine((value) => TaskListQuerySchema.safeParse(value).success),
});
export function normalizeSavedTaskQuery(
  input: z.infer<typeof SavedTaskQuerySchema>,
) {
  const parsed = SavedTaskQuerySchema.parse(input);
  return SavedTaskQuerySchema.parse({
    version: 1,
    where: Object.fromEntries(
      Object.entries(parsed.where)
        .filter(
          ([key, value]) =>
            value !== undefined &&
            !(value === 'false' && (key === 'rootOnly' || key === 'deleted')),
        )
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [
          key,
          value !== undefined && (key === 'dueFrom' || key === 'dueTo')
            ? new Date(value).toISOString()
            : value,
        ]),
    ),
  });
}
export const SavedTaskFilterCreateSchema = z.strictObject({
  name: Name,
  query: SavedTaskQuerySchema,
});
export const SavedTaskFilterPatchSchema =
  SavedTaskFilterCreateSchema.partial().refine(
    (value) => Object.keys(value).length > 0,
  );
export const SavedTaskFilterSchema = z.strictObject({
  ...resourceFields,
  ...SavedTaskFilterCreateSchema.shape,
});
export const TaskTemplatePageSchema = z.strictObject({
  items: z.array(TaskTemplateSchema).max(100),
  nextCursor: z.string().nullable(),
});
export const SavedTaskFilterPageSchema = z.strictObject({
  items: z.array(SavedTaskFilterSchema).max(100),
  nextCursor: z.string().nullable(),
});
export const TaskToolPageQuerySchema = CursorQuerySchema;

const item = { id: TaskIdSchema, revision: Revision };
export const BulkTaskItemSchema = z.discriminatedUnion('action', [
  z.strictObject({
    ...item,
    action: z.literal('PATCH'),
    patch: TaskPatchSchema,
  }),
  ...(['COMPLETE', 'REOPEN', 'DELETE', 'RESTORE'] as const).map((action) =>
    z.strictObject({ ...item, action: z.literal(action) }),
  ),
  z.strictObject({
    ...item,
    action: z.literal('ADD_LABEL'),
    labelId: TaskIdSchema,
  }),
  z.strictObject({
    ...item,
    action: z.literal('REMOVE_LABEL'),
    labelId: TaskIdSchema,
  }),
]);
export const BulkTaskRequestSchema = z.strictObject({
  items: z.array(z.unknown()).min(1).max(100),
});
export const BulkTaskResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    index: z.number().int().nonnegative(),
    status: z.literal('APPLIED'),
    task: TaskSchema,
  }),
  z.strictObject({
    index: z.number().int().nonnegative(),
    status: z.literal('REJECTED'),
    error: z.strictObject({
      code: z.enum(['BAD_REQUEST', 'NOT_FOUND', 'CONFLICT']),
      message: z.string(),
    }),
  }),
]);
export const BulkTaskResponseSchema = z.strictObject({
  items: z.array(BulkTaskResultSchema).max(100),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});
export type BulkTaskRequest = z.infer<typeof BulkTaskRequestSchema>;
export type BulkTaskItem = z.infer<typeof BulkTaskItemSchema>;
export type BulkTaskResult = z.infer<typeof BulkTaskResultSchema>;
export type TaskTemplateCreate = z.infer<typeof TaskTemplateCreateSchema>;
export type TaskTemplatePatch = z.infer<typeof TaskTemplatePatchSchema>;
export type TaskTemplateApply = z.infer<typeof TaskTemplateApplySchema>;
export type SavedTaskFilterCreate = z.infer<typeof SavedTaskFilterCreateSchema>;
export type SavedTaskFilterPatch = z.infer<typeof SavedTaskFilterPatchSchema>;
