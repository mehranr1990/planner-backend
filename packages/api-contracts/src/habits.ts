import { z } from 'zod';
import { CursorQuerySchema } from './foundation.js';
import { TaskIdSchema } from './tasks.js';
import { PlanningDateSchema } from './planning.js';
import { CalendarZoneSchema } from './calendar.js';
const Revision = z.number().int().min(1).max(2147483646);
const Title = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine((v) => !/[\x00-\x1f\x7f\ud800-\udfff]/u.test(v));
export const HabitAmountSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/)
  .overwrite((v) =>
    v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v,
  );
const Total = z
  .string()
  .max(40)
  .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/);
export const HabitRuleSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('DAILY') }),
  z.strictObject({ kind: z.literal('WEEKLY') }),
  z.strictObject({
    kind: z.literal('WEEKDAYS'),
    weekdays: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .refine((v) => new Set(v).size === v.length),
  }),
  z.strictObject({
    kind: z.literal('INTERVAL'),
    days: z.number().int().min(1).max(365),
  }),
]);
export const HabitScheduleDefinitionSchema = z.strictObject({
  version: z.literal(1).default(1),
  startDate: PlanningDateSchema,
  rule: HabitRuleSchema,
});
export const HabitStatusSchema = z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED']);
export const HabitCreateSchema = z
  .strictObject({
    title: Title,
    type: z.enum(['CHECKBOX', 'QUANTITY', 'DURATION']),
    unit: z.string().regex(/^[A-Z][A-Z0-9_]{0,29}$/),
    purpose: z.enum(['GENERIC', 'WATER']).default('GENERIC'),
    target: HabitAmountSchema.refine((v) => v !== '0'),
    timezone: CalendarZoneSchema.optional(),
    schedule: HabitScheduleDefinitionSchema,
  })
  .refine(
    (v) =>
      (v.type !== 'CHECKBOX' || (v.unit === 'COUNT' && v.target === '1')) &&
      (v.type !== 'DURATION' ||
        (v.unit === 'SECOND' && !v.target.includes('.'))) &&
      (v.purpose !== 'WATER' || (v.type === 'QUANTITY' && v.unit === 'ML')),
  );
export const HabitPatchSchema = z
  .strictObject({
    title: Title.optional(),
    target: HabitAmountSchema.refine((v) => v !== '0').optional(),
    timezone: CalendarZoneSchema.optional(),
    schedule: HabitScheduleDefinitionSchema.optional(),
    status: HabitStatusSchema.optional(),
    effectiveFrom: PlanningDateSchema.optional(),
    confirmHistoricalChange: z.boolean().optional(),
  })
  .refine((v) =>
    Object.keys(v).some(
      (k) => !['effectiveFrom', 'confirmHistoricalChange'].includes(k),
    ),
  )
  .refine(
    (v) =>
      (v.effectiveFrom === undefined &&
        v.confirmHistoricalChange === undefined) ||
      v.target !== undefined ||
      v.timezone !== undefined ||
      v.schedule !== undefined ||
      v.status !== undefined,
  );
export const HabitEntryCreateSchema = z
  .strictObject({
    habitRevision: Revision,
    localDate: PlanningDateSchema.optional(),
    action: z.enum(['LOG', 'SKIP']).default('LOG'),
    value: HabitAmountSchema.optional(),
  })
  .refine((v) => v.action !== 'SKIP' || v.value === undefined);
export const HabitEntryPatchSchema = z
  .strictObject({
    habitRevision: Revision,
    value: HabitAmountSchema.optional(),
    void: z.boolean().optional(),
  })
  .refine((v) => v.value !== undefined || v.void !== undefined);
export const HabitRangeSchema = z
  .strictObject({ from: PlanningDateSchema, to: PlanningDateSchema })
  .refine(
    (v) =>
      v.to > v.from && Date.parse(v.to) - Date.parse(v.from) <= 366 * 86400000,
  );
export const HabitStatsQuerySchema = HabitRangeSchema.safeExtend({
  asOfDate: PlanningDateSchema.optional(),
});
export const WaterSummaryQuerySchema = HabitRangeSchema.safeExtend({
  habitId: TaskIdSchema.optional(),
});
export const HabitEntriesQuerySchema = CursorQuerySchema.extend({
  from: PlanningDateSchema.optional(),
  to: PlanningDateSchema.optional(),
}).refine(
  (v) =>
    (v.from === undefined && v.to === undefined) ||
    (v.from !== undefined &&
      v.to !== undefined &&
      v.to > v.from &&
      Date.parse(v.to) - Date.parse(v.from) <= 366 * 86400000),
);
const Base = {
  id: TaskIdSchema,
  spaceId: TaskIdSchema,
  createdByUserId: TaskIdSchema,
  revision: Revision,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};
export const HabitScheduleSchema = z.strictObject({
  id: TaskIdSchema,
  habitId: TaskIdSchema,
  revision: Revision,
  effectiveFrom: PlanningDateSchema,
  timezone: CalendarZoneSchema,
  target: HabitAmountSchema,
  status: HabitStatusSchema,
  schedule: HabitScheduleDefinitionSchema,
  createdAt: z.iso.datetime(),
});
export const HabitSchema = z.strictObject({
  ...Base,
  title: Title,
  type: z.enum(['CHECKBOX', 'QUANTITY', 'DURATION']),
  unit: z.string(),
  purpose: z.enum(['GENERIC', 'WATER']),
  currentSchedule: HabitScheduleSchema.nullable(),
  latestSchedule: HabitScheduleSchema,
});
export const HabitEntrySchema = z.strictObject({
  id: TaskIdSchema,
  revisionId: TaskIdSchema,
  habitId: TaskIdSchema,
  scheduleId: TaskIdSchema,
  revision: Revision,
  previousRevisionId: TaskIdSchema.nullable(),
  kind: z.enum(['CHECKBOX', 'QUANTITY', 'DURATION', 'SKIP']),
  state: z.enum(['RECORDED', 'VOID']),
  localDate: PlanningDateSchema,
  value: HabitAmountSchema.nullable(),
  timezone: CalendarZoneSchema,
  recordedTimezone: CalendarZoneSchema,
  recordedAt: z.iso.datetime(),
  actorUserId: TaskIdSchema,
  current: z.boolean(),
});
export const HabitDaySchema = z.strictObject({
  localDate: PlanningDateSchema,
  scheduleId: TaskIdSchema.nullable(),
  timezone: CalendarZoneSchema.nullable(),
  target: HabitAmountSchema.nullable(),
  total: Total,
  outcome: z.enum([
    'COMPLETED',
    'MISSED',
    'PENDING',
    'SKIPPED',
    'REST',
    'PAUSED',
    'ARCHIVED',
    'UPCOMING',
  ]),
});
export const HabitStatsSchema = z.strictObject({
  habitId: TaskIdSchema,
  from: PlanningDateSchema,
  to: PlanningDateSchema,
  asOfDate: PlanningDateSchema,
  streakScope: z.literal('RANGE'),
  currentStreak: z.number().int().nonnegative(),
  longestStreak: z.number().int().nonnegative(),
  due: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  missed: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  completionRate: z.strictObject({
    numerator: z.number().int().nonnegative(),
    denominator: z.number().int().nonnegative(),
  }),
  days: z.array(HabitDaySchema).max(366),
});
export const RoutineCreateSchema = z.strictObject({
  title: Title,
  habitIds: z
    .array(TaskIdSchema)
    .max(100)
    .refine((v) => new Set(v).size === v.length),
});
export const RoutinePatchSchema = RoutineCreateSchema.partial()
  .extend({ status: z.enum(['ACTIVE', 'ARCHIVED']).optional() })
  .refine((v) => Object.keys(v).length > 0);
export const RoutineSchema = z.strictObject({
  ...Base,
  title: Title,
  status: z.enum(['ACTIVE', 'ARCHIVED']),
  habits: z
    .array(
      z.strictObject({
        habitId: TaskIdSchema,
        position: z.number().int().min(0).max(99),
        title: Title,
        status: HabitStatusSchema.nullable(),
      }),
    )
    .max(100),
});
export const WaterSummarySchema = z.strictObject({
  from: PlanningDateSchema,
  to: PlanningDateSchema,
  unit: z.literal('ML'),
  totalML: Total,
  days: z
    .array(z.strictObject({ localDate: PlanningDateSchema, totalML: Total }))
    .max(366),
  habits: z
    .array(
      z.strictObject({
        habitId: TaskIdSchema,
        title: Title,
        totalML: Total,
        targets: z.array(HabitScheduleSchema).max(1000),
      }),
    )
    .max(1000),
});
export const HabitPageSchema = z.strictObject({
  items: z.array(HabitSchema).max(100),
  nextCursor: z.string().nullable(),
});
export const HabitEntryPageSchema = z.strictObject({
  items: z.array(HabitEntrySchema).max(100),
  nextCursor: z.string().nullable(),
});
export const HabitSchedulePageSchema = z.strictObject({
  items: z.array(HabitScheduleSchema).max(100),
  nextCursor: z.string().nullable(),
});
export const RoutinePageSchema = z.strictObject({
  items: z.array(RoutineSchema).max(100),
  nextCursor: z.string().nullable(),
});
export type HabitCreate = z.infer<typeof HabitCreateSchema>;
export type HabitPatch = z.infer<typeof HabitPatchSchema>;
export type HabitEntryCreate = z.infer<typeof HabitEntryCreateSchema>;
export type HabitEntryPatch = z.infer<typeof HabitEntryPatchSchema>;
export type HabitEntriesQuery = z.infer<typeof HabitEntriesQuerySchema>;
export type HabitStatsQuery = z.infer<typeof HabitStatsQuerySchema>;
export type WaterSummaryQuery = z.infer<typeof WaterSummaryQuerySchema>;
export type RoutineCreate = z.infer<typeof RoutineCreateSchema>;
export type RoutinePatch = z.infer<typeof RoutinePatchSchema>;
