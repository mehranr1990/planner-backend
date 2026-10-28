import { z } from 'zod';
import { TaskIdSchema } from './tasks.js';
import { CursorQuerySchema } from './foundation.js';
import { CalendarZoneSchema } from './calendar.js';
import { PlanningDateSchema } from './planning.js';
const ManualInstant = z.iso.datetime().refine((v) => !/[.]\d{4,}Z$/.test(v));
const Revision = z.number().int().min(1).max(2147483646),
  Ms = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const PomodoroSchema = z.strictObject({
  workMinutes: z.number().int().min(1).max(180).default(25),
  shortBreakMinutes: z.number().int().min(1).max(60).default(5),
  longBreakMinutes: z.number().int().min(1).max(120).default(15),
  longBreakEvery: z.number().int().min(1).max(16).default(4),
  workIntervals: z.number().int().min(1).max(16).default(4),
});
const title = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine((v) => !/[\x00-\x1f\x7f\ud800-\udfff]/u.test(v));
const link = {
  taskId: TaskIdSchema.nullable().optional(),
  taskRevision: Revision.optional(),
};
const validLink = (v: {
  taskId?: string | null | undefined;
  taskRevision?: number | undefined;
}) =>
  v.taskId == null
    ? v.taskRevision === undefined
    : v.taskRevision !== undefined;
export const FocusCreateSchema = z
  .strictObject({
    title,
    mode: z.enum(['STOPWATCH', 'POMODORO']).default('STOPWATCH'),
    pomodoro: PomodoroSchema.optional(),
    timezone: CalendarZoneSchema.optional(),
    ...link,
  })
  .refine(validLink)
  .refine((v) => v.mode === 'POMODORO' || v.pomodoro === undefined);
export const FocusPatchSchema = z
  .strictObject({
    title: title.optional(),
    pomodoro: PomodoroSchema.optional(),
    ...link,
  })
  .refine((v) => Object.keys(v).length > 0)
  .refine(validLink);
export const FocusActionSchema = z.enum([
  'CREATE',
  'EDIT',
  'START',
  'PAUSE',
  'RESUME',
  'FINISH',
  'STOP',
]);
export const FocusStateSchema = z.enum([
  'IDLE',
  'RUNNING',
  'PAUSED',
  'FINISHED',
  'ABANDONED',
]);
export const FocusRevisionSchema = z.strictObject({
  id: TaskIdSchema,
  revisionId: TaskIdSchema,
  previousRevisionId: TaskIdSchema.nullable(),
  revision: Revision,
  spaceId: TaskIdSchema,
  createdByUserId: TaskIdSchema,
  title,
  mode: z.enum(['STOPWATCH', 'POMODORO']),
  timezone: CalendarZoneSchema,
  taskId: TaskIdSchema.nullable(),
  selectedTaskRevision: Revision.nullable(),
  pomodoro: PomodoroSchema.nullable(),
  state: FocusStateSchema,
  action: FocusActionSchema,
  elapsedMs: Ms,
  runningSince: z.iso.datetime().nullable(),
  recordedAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  clockAdjusted: z.boolean(),
  current: z.boolean(),
});
export const FocusViewSchema = FocusRevisionSchema.extend({
  serverNow: z.iso.datetime(),
  activeMs: Ms,
  workMs: Ms,
  breakMs: Ms,
  phase: z.enum([
    'IDLE',
    'WORK',
    'SHORT_BREAK',
    'LONG_BREAK',
    'READY_TO_FINISH',
    'FINISHED',
    'ABANDONED',
  ]),
  interval: z.number().int().nonnegative().max(16),
  remainingMs: Ms.nullable(),
  taskDisposition: z.enum([
    'NONE',
    'AVAILABLE',
    'DONE',
    'DELETED',
    'MASTER',
    'SKIPPED',
    'CANCELED',
  ]),
});
export const FocusPageSchema = z.strictObject({
  items: z.array(FocusViewSchema).max(100),
  nextCursor: z.string().nullable(),
});
export const FocusHistoryPageSchema = z.strictObject({
  items: z.array(FocusRevisionSchema).max(100),
  nextCursor: z.string().nullable(),
});
export const FocusQuerySchema = CursorQuerySchema.extend({
  state: FocusStateSchema.optional(),
  taskId: TaskIdSchema.optional(),
});
export const FocusTransitionSchema = z.strictObject({});
export const TimeCreateSchema = z
  .strictObject({
    startAt: ManualInstant,
    endAt: ManualInstant,
    note: z.string().max(10000).nullable().default(null),
    timezone: CalendarZoneSchema.optional(),
    ...link,
  })
  .refine(validLink)
  .refine(
    (v) =>
      Date.parse(v.endAt) > Date.parse(v.startAt) &&
      Date.parse(v.endAt) - Date.parse(v.startAt) <= 7 * 86400000,
  );
export const TimePatchSchema = z
  .strictObject({
    startAt: ManualInstant.optional(),
    endAt: ManualInstant.optional(),
    note: z.string().max(10000).nullable().optional(),
    void: z.boolean().optional(),
    ...link,
  })
  .refine((v) => Object.keys(v).length > 0)
  .refine(validLink);
export const TimeEntrySchema = z.strictObject({
  id: TaskIdSchema,
  revisionId: TaskIdSchema,
  previousRevisionId: TaskIdSchema.nullable(),
  revision: Revision,
  spaceId: TaskIdSchema,
  createdByUserId: TaskIdSchema,
  kind: z.enum(['MANUAL', 'TRACKED']),
  state: z.enum(['RECORDED', 'VOID']),
  sessionId: TaskIdSchema.nullable(),
  segmentOrdinal: z.number().int().nonnegative().nullable(),
  taskId: TaskIdSchema.nullable(),
  selectedTaskRevision: Revision.nullable(),
  startAt: z.iso.datetime(),
  endAt: z.iso.datetime(),
  durationMs: Ms,
  note: z.string().nullable(),
  timezone: CalendarZoneSchema,
  createdAt: z.iso.datetime(),
  recordedAt: z.iso.datetime(),
  current: z.boolean(),
});
export const TimeQuerySchema = CursorQuerySchema.extend({
  taskId: TaskIdSchema.optional(),
  sessionId: TaskIdSchema.optional(),
  state: z.enum(['RECORDED', 'VOID']).optional(),
});
export const TimePageSchema = z.strictObject({
  items: z.array(TimeEntrySchema).max(100),
  nextCursor: z.string().nullable(),
});
export const ProductivityTaskPatchSchema = z
  .strictObject({
    estimatedMinutes: z.number().int().min(0).max(10080).nullable().optional(),
    important: z.boolean().nullable().optional(),
    urgent: z.boolean().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export const QuadrantSchema = z.enum([
  'DO',
  'SCHEDULE',
  'DELEGATE',
  'ELIMINATE',
  'UNCLASSIFIED',
]);
export const ProductivityTaskSchema = z.strictObject({
  taskId: TaskIdSchema,
  revision: Revision,
  estimatedMinutes: z.number().int().min(0).max(10080).nullable(),
  important: z.boolean().nullable(),
  urgent: z.boolean().nullable(),
  quadrant: QuadrantSchema,
});
export const ProductivityQuerySchema = z
  .strictObject({
    from: PlanningDateSchema,
    to: PlanningDateSchema,
    timezone: CalendarZoneSchema,
  })
  .refine(
    (v) =>
      v.to > v.from && Date.parse(v.to) - Date.parse(v.from) <= 366 * 86400000,
  );
const totals = {
  recordedMs: Ms,
  distinctWorkMs: Ms,
  overlapMs: Ms,
  manualMs: Ms,
  trackedMs: Ms,
  entryCount: z.number().int().nonnegative(),
};
export const ProductivitySummarySchema = z.strictObject({
  from: PlanningDateSchema,
  to: PlanningDateSchema,
  timezone: CalendarZoneSchema,
  serverNow: z.iso.datetime(),
  ...totals,
  uncommittedWorkMs: Ms,
  days: z
    .array(z.strictObject({ localDate: PlanningDateSchema, ...totals }))
    .max(366),
  sessions: z.strictObject({
    started: z.number().int().nonnegative(),
    finished: z.number().int().nonnegative(),
    abandoned: z.number().int().nonnegative(),
  }),
  tasks: z.strictObject({
    scope: z.literal('CURRENT_ACTIONABLE'),
    count: z.number().int().nonnegative(),
    estimatedMinutes: z.number().int().nonnegative(),
    unknownEstimates: z.number().int().nonnegative(),
    quadrants: z.strictObject({
      DO: z.number().int().nonnegative(),
      SCHEDULE: z.number().int().nonnegative(),
      DELEGATE: z.number().int().nonnegative(),
      ELIMINATE: z.number().int().nonnegative(),
      UNCLASSIFIED: z.number().int().nonnegative(),
    }),
  }),
  definition: z.literal(
    'CURRENT_NONVOID_ENTRIES_CLIPPED_TO_RANGE;DISTINCT_IS_INTERVAL_UNION;LIVE_EXCLUDED',
  ),
});
export type Pomodoro = z.infer<typeof PomodoroSchema>;
export type FocusCreate = z.infer<typeof FocusCreateSchema>;
export type FocusPatch = z.infer<typeof FocusPatchSchema>;
export type FocusRevision = z.infer<typeof FocusRevisionSchema>;
export type FocusView = z.infer<typeof FocusViewSchema>;
export type TimeCreate = z.infer<typeof TimeCreateSchema>;
export type TimePatch = z.infer<typeof TimePatchSchema>;
export type TimeEntry = z.infer<typeof TimeEntrySchema>;
export type ProductivityTaskPatch = z.infer<typeof ProductivityTaskPatchSchema>;
export type ProductivityTask = z.infer<typeof ProductivityTaskSchema>;
export type ProductivityQuery = z.infer<typeof ProductivityQuerySchema>;
