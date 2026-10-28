import { z } from 'zod';
import { CursorQuerySchema } from './foundation.js';
import { TaskIdSchema, TaskPatchSchema } from './tasks.js';
const DateOnly = z.iso
  .date()
  .refine((value) => value >= '1900-01-01' && value <= '9998-12-31');
const Time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const Zone = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return !/^[+-]/.test(value);
    } catch {
      return false;
    }
  });
const Interval = z.number().int().min(1).max(1000);
const Weekday = z.number().int().min(1).max(7);
export const RecurrenceRuleSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('DAILY'), interval: Interval }),
  z.strictObject({ kind: z.literal('WEEKLY'), interval: Interval }),
  z.strictObject({
    kind: z.literal('WEEKDAYS'),
    interval: Interval,
    weekdays: z
      .array(Weekday)
      .min(1)
      .max(7)
      .refine((value) => new Set(value).size === value.length),
  }),
  z.strictObject({
    kind: z.literal('MONTHLY_DATE'),
    interval: Interval,
    day: z.number().int().min(1).max(31),
  }),
  z.strictObject({
    kind: z.literal('MONTHLY_NTH'),
    interval: Interval,
    weekday: Weekday,
    nth: z.union([z.literal(-1), z.number().int().min(1).max(5)]),
  }),
  z
    .strictObject({
      kind: z.literal('YEARLY'),
      interval: Interval,
      month: z.number().int().min(1).max(12),
      day: z.number().int().min(1).max(31),
    })
    .refine(
      (value) =>
        new Date(Date.UTC(2000, value.month - 1, value.day)).getUTCMonth() ===
        value.month - 1,
    ),
  z.strictObject({
    kind: z.literal('INTERVAL'),
    interval: Interval,
    unit: z.enum(['DAY', 'WEEK', 'MONTH', 'YEAR']),
  }),
]);
export const RecurrenceDefinitionSchema = z
  .strictObject({
    version: z.literal(1).default(1),
    startDate: DateOnly,
    endDate: DateOnly.nullable(),
    localTime: Time,
    timezone: Zone,
    rule: RecurrenceRuleSchema,
    exclusionDates: z
      .array(DateOnly)
      .max(1000)
      .refine((value) => new Set(value).size === value.length),
  })
  .refine((value) => !value.endDate || value.endDate >= value.startDate);
export const TaskRecurrenceCreateSchema = z.strictObject({
  taskId: TaskIdSchema,
  taskRevision: z.number().int().positive(),
  definition: RecurrenceDefinitionSchema,
});
export const TaskRecurrenceSchema = z.strictObject({
  id: TaskIdSchema,
  spaceId: TaskIdSchema,
  createdByUserId: TaskIdSchema,
  masterTaskId: TaskIdSchema,
  previousSeriesId: TaskIdSchema.nullable(),
  definition: RecurrenceDefinitionSchema,
  identityTime: Time,
  splitBefore: DateOnly.nullable(),
  gapPolicy: z.literal('SKIP_WITH_REASON'),
  foldPolicy: z.literal('EARLIER'),
  shortMonthPolicy: z.literal('SKIP'),
  leapDayPolicy: z.literal('SKIP'),
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  scannedThrough: DateOnly.nullable(),
  retiredAt: z.iso.datetime().nullable(),
});
export const TaskOccurrenceSchema = z.strictObject({
  id: TaskIdSchema,
  seriesId: TaskIdSchema,
  taskId: TaskIdSchema.nullable(),
  recurrenceKey: z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:00$/),
  localDate: DateOnly,
  localTime: Time,
  timezone: Zone,
  scheduledAt: z.iso.datetime().nullable(),
  state: z.enum(['PENDING', 'DONE', 'SKIPPED', 'CANCELED']),
  reason: z
    .enum([
      'DST_GAP',
      'USER_SKIP',
      'USER_CANCEL',
      'SERIES_EDIT',
      'SERIES_SPLIT',
      'SERIES_CANCELED',
      'TASK_DELETED',
    ])
    .nullable(),
  exception: z.boolean(),
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const SeriesTaskPatchSchema = z
  .strictObject({
    title: TaskPatchSchema.shape.title,
    description: TaskPatchSchema.shape.description,
    priority: TaskPatchSchema.shape.priority,
  })
  .refine((value) => Object.keys(value).length > 0);
export const RecurrenceEditSchema = z.discriminatedUnion('scope', [
  z.strictObject({
    scope: z.literal('THIS_OCCURRENCE'),
    occurrenceId: TaskIdSchema,
    occurrenceRevision: z.number().int().positive(),
    taskRevision: z.number().int().positive(),
    patch: z
      .strictObject({
        title: TaskPatchSchema.shape.title,
        description: TaskPatchSchema.shape.description,
        priority: TaskPatchSchema.shape.priority,
        plannedStartAt: TaskPatchSchema.shape.plannedStartAt,
        dueAt: TaskPatchSchema.shape.dueAt,
        scheduledDate: TaskPatchSchema.shape.scheduledDate,
      })
      .refine((value) => Object.keys(value).length > 0),
  }),
  z.strictObject({
    scope: z.literal('THIS_AND_FUTURE'),
    occurrenceId: TaskIdSchema,
    occurrenceRevision: z.number().int().positive(),
    definition: RecurrenceDefinitionSchema,
    taskPatch: SeriesTaskPatchSchema.optional(),
  }),
  z.strictObject({
    scope: z.literal('ENTIRE_SERIES'),
    definition: RecurrenceDefinitionSchema,
    taskPatch: SeriesTaskPatchSchema.optional(),
  }),
]);
export const CatchUpSchema = z.strictObject({
  through: DateOnly,
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(1024).optional(),
});
export const OccurrenceActionSchema = z.strictObject({
  taskRevision: z.number().int().positive(),
});
export const TaskRecurrencePageSchema = z.strictObject({
  items: z.array(TaskRecurrenceSchema).max(100),
  nextCursor: z.string().nullable(),
});
export const TaskOccurrencePageSchema = z.strictObject({
  items: z.array(TaskOccurrenceSchema).max(100),
  nextCursor: z.string().nullable(),
});
export const RecurrenceEditResultSchema = z.strictObject({
  series: TaskRecurrenceSchema,
  successor: TaskRecurrenceSchema.nullable(),
  occurrence: TaskOccurrenceSchema.nullable(),
});
export const CatchUpResultSchema = z.strictObject({
  items: z.array(TaskOccurrenceSchema).max(100),
  nextCursor: z.string().nullable(),
  scannedThrough: DateOnly.nullable(),
});
export const RecurrenceListQuerySchema = CursorQuerySchema;
export type RecurrenceCreate = z.infer<typeof TaskRecurrenceCreateSchema>;
export type RecurrenceEdit = z.infer<typeof RecurrenceEditSchema>;
export type CatchUp = z.infer<typeof CatchUpSchema>;
export type Series = z.infer<typeof TaskRecurrenceSchema>;
export type Occurrence = z.infer<typeof TaskOccurrenceSchema>;
