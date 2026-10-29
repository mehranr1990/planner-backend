import { z } from 'zod';
import {
  TaskCreateSchema,
  TaskPatchSchema,
  ChecklistCreateSchema,
  ChecklistPatchSchema,
  LabelCreateSchema,
  LabelPatchSchema,
  TaskSchema,
  ChecklistSchema,
  LabelSchema,
} from './tasks.js';
import {
  PlanningDateSchema,
  SelectionPutSchema,
  DayReorderSchema,
  DailyPlanSchema,
} from './planning.js';
import {
  HabitEntryCreateSchema,
  HabitEntryPatchSchema,
  HabitEntrySchema,
} from './habits.js';
import {
  NoteCreateSchema,
  NotePatchSchema,
  NoteSchema,
  CaptureCreateSchema,
  CapturePatchSchema,
  CaptureSchema,
} from './writing.js';
const Id = z.uuid(),
  Rev = z.number().int().min(0).max(2147483646),
  Empty = z.strictObject({});
export const SyncEntitySchema = z.enum([
  'TASK',
  'CHECKLIST',
  'LABEL',
  'DAILY_PLAN',
  'HABIT_ENTRY',
  'NOTE',
  'CAPTURE',
]);
export type SyncEntity = z.infer<typeof SyncEntitySchema>;
const shared = {
  clientMutationId: Id,
  baseRevision: Rev,
  resourceId: Id.optional(),
  parentId: Id.optional(),
  localDate: PlanningDateSchema.optional(),
  clientEntryId: Id.optional(),
};
const command = <const O extends string, T extends z.ZodType>(
  operation: O,
  body: T,
) => z.strictObject({ ...shared, operation: z.literal(operation), body });
export const SyncCommandSchema = z.discriminatedUnion('operation', [
  command('TASK_CREATE', TaskCreateSchema),
  command('TASK_PATCH', TaskPatchSchema),
  command('TASK_COMPLETE', Empty),
  command('TASK_REOPEN', Empty),
  command('TASK_DELETE', Empty),
  command('TASK_RESTORE', Empty),
  command('CHECKLIST_CREATE', ChecklistCreateSchema),
  command('CHECKLIST_PATCH', ChecklistPatchSchema),
  command('CHECKLIST_DELETE', Empty),
  command('LABEL_CREATE', LabelCreateSchema),
  command('LABEL_PATCH', LabelPatchSchema),
  command('LABEL_DELETE', Empty),
  command(
    'TASK_LABEL_SET',
    z.strictObject({ labelId: Id, present: z.boolean() }),
  ),
  command('DAY_CREATE', Empty),
  command('DAY_SELECT', SelectionPutSchema),
  command('DAY_REMOVE', Empty),
  command('DAY_REORDER', DayReorderSchema),
  command('HABIT_LOG', HabitEntryCreateSchema),
  command('HABIT_CORRECT', HabitEntryPatchSchema),
  command('NOTE_CREATE', NoteCreateSchema),
  command('NOTE_PATCH', NotePatchSchema),
  command('NOTE_DELETE', Empty),
  command('NOTE_RESTORE', Empty),
  command('CAPTURE_CREATE', CaptureCreateSchema),
  command('CAPTURE_PATCH', CapturePatchSchema),
]);
export type SyncCommand = z.infer<typeof SyncCommandSchema>;
export const SyncPushSchema = z.strictObject({
  epoch: Id,
  operations: z
    .array(
      z.strictObject({
        ...shared,
        operation: z.string().regex(/^[A-Z_]{1,40}$/),
        body: z.json(),
      }),
    )
    .min(1)
    .max(50),
});
const base = {
  id: Id,
  revision: z.number().int().positive(),
  deleted: z.boolean(),
};
export const SyncResourceSchema = z.discriminatedUnion('entity', [
  z.strictObject({
    ...base,
    entity: z.literal('TASK'),
    data: TaskSchema.extend({ labelIds: z.array(Id).max(10000) }).nullable(),
  }),
  z.strictObject({
    ...base,
    entity: z.literal('CHECKLIST'),
    data: ChecklistSchema.nullable(),
  }),
  z.strictObject({
    ...base,
    entity: z.literal('LABEL'),
    data: LabelSchema.nullable(),
  }),
  z.strictObject({
    ...base,
    entity: z.literal('DAILY_PLAN'),
    data: DailyPlanSchema.nullable(),
  }),
  z.strictObject({
    ...base,
    entity: z.literal('HABIT_ENTRY'),
    data: HabitEntrySchema.nullable(),
  }),
  z.strictObject({
    ...base,
    entity: z.literal('NOTE'),
    data: NoteSchema.nullable(),
  }),
  z.strictObject({
    ...base,
    entity: z.literal('CAPTURE'),
    data: CaptureSchema.nullable(),
  }),
]);
export type SyncResource = z.infer<typeof SyncResourceSchema>;
export const SyncItemResultSchema = z.strictObject({
  clientMutationId: Id,
  status: z.enum(['APPLIED', 'DUPLICATE', 'CONFLICT', 'REJECTED']),
  originalStatus: z.enum(['APPLIED', 'CONFLICT', 'REJECTED']).nullable(),
  resource: SyncResourceSchema.nullable(),
  resultExpired: z.boolean(),
  error: z
    .strictObject({
      code: z.string().max(80),
      server: SyncResourceSchema.nullable(),
      client: z.json().nullable(),
    })
    .nullable(),
});
export const SyncPushResultSchema = z.strictObject({
  results: z.array(SyncItemResultSchema).max(50),
});
export const SyncPullQuerySchema = z.strictObject({
  cursor: z.string().max(2048).optional(),
  limit: z
    .string()
    .regex(/^(?:[1-9]|[1-9][0-9]|100)$/)
    .optional(),
});
export const SyncPullResultSchema = z.strictObject({
  phase: z.enum(['BOOTSTRAP', 'INCREMENTAL']),
  reset: z.boolean(),
  epoch: Id,
  cursor: z.string().max(2048),
  hasMore: z.boolean(),
  semantics: z.literal('CURRENT_STATE'),
  items: z.array(SyncResourceSchema).max(100),
});
export const SyncStatusSchema = z.strictObject({
  epoch: Id,
  currentSequence: z.string().regex(/^\d+$/),
  retainedSequence: z.string().regex(/^\d+$/),
  feedRetentionDays: z.literal(30),
  receiptBodyRetentionDays: z.literal(30),
  maxPushOperations: z.literal(50),
  maxPullItems: z.literal(100),
  entities: z.array(SyncEntitySchema),
  financePosting: z.literal('ONLINE_ONLY'),
});
