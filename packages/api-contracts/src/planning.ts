import { z } from 'zod';
import { CursorQuerySchema } from './foundation.js';
import { TaskIdSchema, TaskStatusSchema } from './tasks.js';
export const PlanningDateSchema = z.iso
  .date()
  .refine((value) => value >= '1900-01-01' && value <= '9998-12-31');
const Revision = z.number().int().min(1).max(2147483646),
  SnapshotRevision = z.number().int().min(0).max(2147483646);
const Zone = z.string().min(1).max(100);
const Minutes = z.number().int().min(0).max(1440);
const TaskFields = {
  id: TaskIdSchema,
  revision: Revision,
  title: z.string().nullable(),
  status: TaskStatusSchema,
  dueAt: z.iso.datetime().nullable(),
  scheduledDate: z.iso.date().nullable(),
  deleted: z.boolean(),
  isMaster: z.boolean(),
  occurrenceState: z
    .enum(['PENDING', 'DONE', 'SKIPPED', 'CANCELED'])
    .nullable(),
};
export const PlanningTaskSchema = z.strictObject(TaskFields);
export const PlanningAvailabilitySchema = z.strictObject({
  version: z.literal(1),
  minutesByWeekday: z.array(Minutes).length(7),
});
export const AvailabilityPutSchema = z.strictObject({
  availability: PlanningAvailabilitySchema.nullable(),
});
export const AvailabilitySchema = z.strictObject({
  availability: PlanningAvailabilitySchema.nullable(),
  revision: Revision,
  timezone: Zone,
  firstDayOfWeek: z.number().int().min(0).max(6),
});
const base = {
  id: TaskIdSchema,
  spaceId: TaskIdSchema,
  createdByUserId: TaskIdSchema,
  revision: Revision,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};
export const SelectionDispositionSchema = z.enum([
  'READY',
  'STALE',
  'COMPLETED',
  'DELETED',
  'SKIPPED',
  'CANCELED',
  'BLOCKED',
  'ALREADY_SELECTED',
]);
export const DailyPlanItemSchema = z.strictObject({
  id: TaskIdSchema,
  taskId: TaskIdSchema,
  position: z.number().int().min(0).max(99),
  plannedMinutes: Minutes.nullable(),
  selectedTaskRevision: Revision,
  revision: Revision,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  disposition: SelectionDispositionSchema,
  task: PlanningTaskSchema.nullable(),
});
export const DailyPlanSchema = z.strictObject({
  ...base,
  localDate: PlanningDateSchema,
  timezone: Zone,
  items: z.array(DailyPlanItemSchema).max(100),
  blockedItems: z.array(DailyPlanItemSchema).max(100),
});
export const WeeklyPlanSchema = z.strictObject({
  ...base,
  weekStartDate: PlanningDateSchema,
  timezone: Zone,
  firstDayOfWeek: z.number().int().min(0).max(6),
  days: z
    .array(
      z.strictObject({
        localDate: PlanningDateSchema,
        planId: TaskIdSchema.nullable(),
        revision: SnapshotRevision,
        timezone: Zone.nullable(),
        selectionCount: z.number().int().min(0).max(100),
        blockedCount: z.number().int().min(0).max(100),
      }),
    )
    .length(7),
});
export const SelectionPutSchema = z.strictObject({
  taskRevision: Revision,
  plannedMinutes: Minutes.nullable(),
  position: z.number().int().min(0).max(99).optional(),
});
export const DayReorderSchema = z.strictObject({
  taskIds: z
    .array(TaskIdSchema)
    .max(100)
    .refine((value) => new Set(value).size === value.length),
});
export const SelectionMoveSchema = z.strictObject({
  targetDate: PlanningDateSchema,
  targetRevision: SnapshotRevision,
  taskRevision: Revision,
  position: z.number().int().min(0).max(99).optional(),
});
export const SelectionMoveResultSchema = z.strictObject({
  source: DailyPlanSchema,
  target: DailyPlanSchema,
});
export const ReviewKindSchema = z.enum(['MORNING', 'EVENING', 'WEEKLY']);
const Reflection = z
  .string()
  .max(10000)
  .refine(
    (value) => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ud800-\udfff]/u.test(value),
  );
export const PlanningReviewCreateSchema = z.strictObject({
  kind: ReviewKindSchema,
  localDate: PlanningDateSchema,
  reflection: Reflection,
});
export const PlanningReviewPatchSchema = z.strictObject({
  reflection: Reflection,
});
export const PlanningReviewSchema = z.strictObject({
  ...base,
  ...PlanningReviewCreateSchema.shape,
  timezone: Zone,
  firstDayOfWeek: z.number().int().min(0).max(6),
});
export const PlanningReviewQuerySchema = CursorQuerySchema.extend({
  from: PlanningDateSchema.optional(),
  to: PlanningDateSchema.optional(),
  kind: ReviewKindSchema.optional(),
}).refine(
  (value) =>
    (!value.from && !value.to) ||
    (value.from &&
      value.to &&
      value.from <= value.to &&
      (Date.parse(value.to) - Date.parse(value.from)) / 86400000 <= 366),
);
export const PlanningReviewPageSchema = z.strictObject({
  items: z.array(PlanningReviewSchema).max(100),
  nextCursor: z.string().nullable(),
});
const rollover = { fromDate: PlanningDateSchema, toDate: PlanningDateSchema };
export const RolloverPreviewRequestSchema = z
  .strictObject(rollover)
  .refine((value) => value.toDate > value.fromDate);
export const RolloverPreviewSchema = z.strictObject({
  ...rollover,
  sourceRevision: Revision,
  targetRevision: SnapshotRevision,
  settingsRevision: Revision,
  items: z
    .array(
      z.strictObject({
        taskId: TaskIdSchema,
        taskRevision: Revision.nullable(),
        itemRevision: Revision,
        disposition: SelectionDispositionSchema,
        plannedMinutes: Minutes.nullable(),
      }),
    )
    .max(100),
});
export const RolloverCommitSchema = z
  .strictObject({
    ...rollover,
    sourceRevision: Revision,
    targetRevision: SnapshotRevision,
    settingsRevision: Revision,
    mode: z.enum(['COPY', 'MOVE']),
    items: z
      .array(
        z.strictObject({
          taskId: TaskIdSchema,
          taskRevision: Revision,
          itemRevision: Revision,
        }),
      )
      .min(1)
      .max(100),
  })
  .refine(
    (value) =>
      value.toDate > value.fromDate &&
      new Set(value.items.map((item) => item.taskId)).size ===
        value.items.length,
  );
export const RolloverResultSchema = z.strictObject({
  source: DailyPlanSchema,
  target: DailyPlanSchema.nullable(),
  mode: z.enum(['COPY', 'MOVE']),
  succeeded: z.number().int().min(0).max(100),
  skipped: z.number().int().min(0).max(100),
  items: z
    .array(
      z.strictObject({
        taskId: TaskIdSchema,
        outcome: z.enum(['APPLIED', 'SKIPPED', 'STALE', 'BLOCKED']),
        reason: SelectionDispositionSchema.nullable(),
      }),
    )
    .max(100),
});
export const CapacityQuerySchema = z
  .strictObject({
    date: PlanningDateSchema.optional(),
    weekStartDate: PlanningDateSchema.optional(),
  })
  .refine((value) => !(value.date && value.weekStartDate));
export const CapacitySchema = z.strictObject({
  kind: z.enum(['DAY', 'WEEK']),
  timezone: Zone,
  settingsRevision: Revision,
  availableMinutes: z.number().int().min(0).max(10080).nullable(),
  knownPlannedMinutes: z.number().int().min(0).max(1008000),
  unknownAllocations: z.number().int().min(0).max(700),
  blockedAllocations: z.number().int().min(0).max(700),
  remainingMinutes: z.number().int().nullable(),
  overCapacity: z.boolean().nullable(),
  days: z
    .array(
      z.strictObject({
        localDate: PlanningDateSchema,
        timezone: Zone,
        availableMinutes: Minutes.nullable(),
        knownPlannedMinutes: z.number().int().min(0).max(144000),
        unknownAllocations: z.number().int().min(0).max(100),
        blockedAllocations: z.number().int().min(0).max(100),
      }),
    )
    .min(1)
    .max(7),
});
export type Availability = z.infer<typeof PlanningAvailabilitySchema>;
export type SelectionPut = z.infer<typeof SelectionPutSchema>;
export type SelectionMove = z.infer<typeof SelectionMoveSchema>;
export type ReviewCreate = z.infer<typeof PlanningReviewCreateSchema>;
export type ReviewQuery = z.infer<typeof PlanningReviewQuerySchema>;
export type RolloverCommit = z.infer<typeof RolloverCommitSchema>;
export type CapacityQuery = z.infer<typeof CapacityQuerySchema>;
