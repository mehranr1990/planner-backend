import { z } from 'zod';
import { CursorQuerySchema } from './foundation.js';
import { TaskIdSchema } from './tasks.js';
import { PlanningDateSchema } from './planning.js';
import { RecurrenceDefinitionSchema } from './recurrence.js';

export const CalendarZoneSchema = z
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
export const CalendarLocalSchema = z
  .string()
  .regex(/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d$/)
  .refine((value) => PlanningDateSchema.safeParse(value.slice(0, 10)).success);
const Title = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine((value) => !/[\x00-\x1f\x7f\ud800-\udfff]/u.test(value));
const Description = z
  .string()
  .max(20000)
  .refine(
    (value) => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ud800-\udfff]/u.test(value),
  );
export const CalendarTimedInputSchema = z
  .strictObject({
    kind: z.literal('TIMED'),
    timezone: CalendarZoneSchema,
    localStart: CalendarLocalSchema,
    localEnd: CalendarLocalSchema,
  })
  .refine(
    (value) =>
      value.localEnd > value.localStart &&
      Date.parse(value.localEnd + 'Z') - Date.parse(value.localStart + 'Z') <=
        366 * 86400000,
  );
export const CalendarAllDayInputSchema = z
  .strictObject({
    kind: z.literal('ALL_DAY'),
    timezone: CalendarZoneSchema,
    startDate: PlanningDateSchema,
    endDate: PlanningDateSchema,
  })
  .refine(
    (value) =>
      value.endDate > value.startDate &&
      Date.parse(value.endDate) - Date.parse(value.startDate) <= 366 * 86400000,
  );
export const CalendarScheduleInputSchema = z.discriminatedUnion('kind', [
  CalendarAllDayInputSchema,
  CalendarTimedInputSchema,
]);
export const CalendarEventCreateSchema = z.strictObject({
  title: Title,
  description: Description.nullable().optional(),
  schedule: CalendarScheduleInputSchema,
  recurrence: RecurrenceDefinitionSchema.optional(),
});
export const CalendarEventPatchSchema = z
  .strictObject({
    title: Title.optional(),
    description: Description.nullable().optional(),
    schedule: CalendarScheduleInputSchema.optional(),
    status: z.enum(['ACTIVE', 'CANCELED']).optional(),
  })
  .refine((value) => Object.keys(value).length > 0);
export const TimeBlockCreateSchema = z
  .strictObject({
    title: Title,
    schedule: CalendarTimedInputSchema,
    taskId: TaskIdSchema.nullable().optional(),
    taskRevision: z.number().int().positive().optional(),
  })
  .refine((value) =>
    value.taskId
      ? value.taskRevision !== undefined
      : value.taskRevision === undefined,
  );
export const TimeBlockPatchSchema = z
  .strictObject({
    title: Title.optional(),
    schedule: CalendarTimedInputSchema.optional(),
    taskId: TaskIdSchema.nullable().optional(),
    taskRevision: z.number().int().positive().optional(),
    status: z.enum(['ACTIVE', 'CANCELED']).optional(),
  })
  .refine((value) => Object.keys(value).length > 0)
  .refine((value) =>
    value.taskId
      ? value.taskRevision !== undefined
      : value.taskRevision === undefined,
  );
export const CalendarRangeQuerySchema = CursorQuerySchema.extend({
  from: PlanningDateSchema,
  to: PlanningDateSchema,
  timezone: CalendarZoneSchema,
}).refine(
  (value) =>
    value.to > value.from &&
    Date.parse(value.to) - Date.parse(value.from) <= 93 * 86400000,
);
export type CalendarScheduleInput = z.infer<typeof CalendarScheduleInputSchema>;
export type CalendarEventCreate = z.infer<typeof CalendarEventCreateSchema>;
export type CalendarEventPatch = z.infer<typeof CalendarEventPatchSchema>;
export type TimeBlockCreate = z.infer<typeof TimeBlockCreateSchema>;
export type TimeBlockPatch = z.infer<typeof TimeBlockPatchSchema>;
export type CalendarRangeQuery = z.infer<typeof CalendarRangeQuerySchema>;

export const CalendarSeriesEditSchema = z.discriminatedUnion('scope', [
  z.strictObject({
    scope: z.literal('THIS_OCCURRENCE'),
    recurrenceKey: CalendarLocalSchema,
    exceptionRevision: z.number().int().min(0),
    patch: CalendarEventPatchSchema,
  }),
  z.strictObject({
    scope: z.literal('THIS_AND_FUTURE'),
    recurrenceKey: CalendarLocalSchema,
    event: CalendarEventCreateSchema,
  }),
  z.strictObject({
    scope: z.literal('ENTIRE_SERIES'),
    event: CalendarEventCreateSchema,
    status: z.enum(['ACTIVE', 'CANCELED']).optional(),
  }),
]);
const Schedule = z.discriminatedUnion('kind', [
  z.strictObject({
    ...CalendarAllDayInputSchema.shape,
    startAt: z.null(),
    endAt: z.null(),
  }),
  z.strictObject({
    ...CalendarTimedInputSchema.shape,
    startAt: z.iso.datetime().nullable(),
    endAt: z.iso.datetime().nullable(),
  }),
]);
const Base = {
  id: TaskIdSchema,
  spaceId: TaskIdSchema,
  createdByUserId: TaskIdSchema,
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
  title: Title,
  status: z.enum(['ACTIVE', 'CANCELED']),
  schedule: Schedule,
  foldPolicy: z.literal('EARLIER'),
  gapPolicy: z.literal('REJECT_EXPLICIT_SKIP_RECURRENCE'),
};
export const CalendarEventSchema = z.strictObject({
  ...Base,
  description: Description.nullable(),
  seriesId: TaskIdSchema.nullable(),
  recurrenceKey: CalendarLocalSchema.nullable(),
  previousSeriesId: TaskIdSchema.nullable(),
  splitBefore: CalendarLocalSchema.nullable(),
  recurrence: RecurrenceDefinitionSchema.nullable(),
});
export const CalendarTaskDispositionSchema = z.enum([
  'READY',
  'STALE',
  'COMPLETED',
  'DELETED',
  'SKIPPED',
  'CANCELED',
  'BLOCKED',
]);
export const TimeBlockSchema = z.strictObject({
  ...Base,
  taskId: TaskIdSchema.nullable(),
  selectedTaskRevision: z.number().int().positive().nullable(),
  taskDisposition: CalendarTaskDispositionSchema.nullable(),
});
export const CalendarOccurrenceSchema = z.strictObject({
  identity: z.string().max(100),
  resourceId: TaskIdSchema,
  kind: z.enum(['EVENT', 'TIME_BLOCK']),
  seriesId: TaskIdSchema.nullable(),
  recurrenceKey: CalendarLocalSchema.nullable(),
  revision: z.number().int().positive(),
  exceptionRevision: z.number().int().min(0),
  title: Title,
  status: z.enum(['ACTIVE', 'CANCELED', 'SKIPPED']),
  reason: z.literal('DST_GAP').nullable(),
  schedule: Schedule,
  displayStart: z.string(),
  displayEnd: z.string(),
  taskId: TaskIdSchema.nullable(),
  taskDisposition: CalendarTaskDispositionSchema.nullable(),
  foldPolicy: z.literal('EARLIER'),
  gapPolicy: z.literal('REJECT_EXPLICIT_SKIP_RECURRENCE'),
});
export const CalendarViewSchema = z.strictObject({
  from: PlanningDateSchema,
  to: PlanningDateSchema,
  timezone: CalendarZoneSchema,
  items: z.array(CalendarOccurrenceSchema).max(100),
  nextCursor: z.string().nullable(),
});
export const CalendarConflictSchema = z.strictObject({
  left: z.string().max(100),
  right: z.string().max(100),
  startAt: z.iso.datetime(),
  endAt: z.iso.datetime(),
});
export const CalendarConflictsSchema = z.strictObject({
  advisory: z.literal(true),
  items: z.array(CalendarConflictSchema).max(100),
  nextCursor: z.string().nullable(),
});
export const CalendarEventPageSchema = z.strictObject({
  items: z.array(CalendarEventSchema).max(100),
  nextCursor: z.string().nullable(),
});
export const TimeBlockPageSchema = z.strictObject({
  items: z.array(TimeBlockSchema).max(100),
  nextCursor: z.string().nullable(),
});
export const CalendarSeriesResultSchema = z.strictObject({
  event: CalendarEventSchema,
  exception: CalendarEventSchema.nullable(),
  successor: CalendarEventSchema.nullable(),
});
export type CalendarSeriesEdit = z.infer<typeof CalendarSeriesEditSchema>;
