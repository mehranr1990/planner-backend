import { z } from 'zod';
import { CursorQuerySchema } from './foundation.js';
import { TaskIdSchema } from './tasks.js';

export const GoalTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine((v) => !/[\x00-\x1f\x7f\ud800-\udfff]/u.test(v));
export const LifeAreaCreateSchema = z.strictObject({
  title: GoalTitleSchema,
  position: z.number().int().min(0).max(9999).default(0),
});
const patchShape = <T extends z.ZodRawShape>(shape: T) =>
  Object.fromEntries(
    Object.entries(shape).map(([k, v]) => [
      k,
      v instanceof z.ZodDefault ? v.removeDefault() : v,
    ]),
  ) as { [K in keyof T]: T[K] extends z.ZodDefault<infer U> ? U : T[K] };
export const LifeAreaPatchSchema = z
  .strictObject(patchShape(LifeAreaCreateSchema.shape))
  .partial()
  .extend({ status: z.enum(['ACTIVE', 'ARCHIVED']).optional() })
  .refine((v) => Object.keys(v).length > 0);
export const GoalRevisionSchema = z.number().int().min(1).max(2147483646);
export const GoalBaseShape = {
  id: TaskIdSchema,
  spaceId: TaskIdSchema,
  createdByUserId: TaskIdSchema,
  revision: GoalRevisionSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};
export const LifeAreaSchema = z.strictObject({
  ...GoalBaseShape,
  title: GoalTitleSchema,
  position: z.number().int().min(0).max(9999),
  status: z.enum(['ACTIVE', 'ARCHIVED']),
});
export const LifeAreaPageSchema = z.strictObject({
  items: z.array(LifeAreaSchema).max(100),
  nextCursor: z.string().nullable(),
});
export const GoalPageQuerySchema = CursorQuerySchema;
export type LifeAreaCreate = z.infer<typeof LifeAreaCreateSchema>;
export type LifeAreaPatch = z.infer<typeof LifeAreaPatchSchema>;

import { PlanningDateSchema } from './planning.js';
import { CalendarZoneSchema } from './calendar.js';
import { HabitRangeSchema } from './habits.js';
export const GoalAmountSchema = z
  .string()
  .regex(/^-?(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/)
  .overwrite((v) => {
    const n = v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v;
    return n === '-0' ? '0' : n;
  });
const Calculated = z
  .string()
  .max(100)
  .regex(/^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/);
export const GoalWeightSchema = GoalAmountSchema.refine(
  (v) => Number(v) > 0 && Number(v) <= 1000000,
);
export const GoalStatusSchema = z.enum([
  'PLANNED',
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'ABANDONED',
]);
export const GoalModeSchema = z.enum(['MANUAL', 'METRIC', 'WEIGHTED']);
const goalFields = {
  title: GoalTitleSchema,
  description: z.string().max(10000).nullable().default(null),
  horizon: z.enum(['SHORT_TERM', 'LONG_TERM']),
  status: GoalStatusSchema.default('PLANNED'),
  lifeAreaId: TaskIdSchema.nullable().default(null),
  parentGoalId: TaskIdSchema.nullable().default(null),
  startDate: PlanningDateSchema.nullable().default(null),
  targetDate: PlanningDateSchema.nullable().default(null),
  progressMode: GoalModeSchema.default('MANUAL'),
  manualProgress: GoalAmountSchema.default('0'),
  metricId: TaskIdSchema.nullable().default(null),
};
const orderedDates = (v: {
  startDate?: string | null | undefined;
  targetDate?: string | null | undefined;
}) => !v.startDate || !v.targetDate || v.startDate <= v.targetDate;
export const GoalCreateSchema = z
  .strictObject({ ...goalFields, timezone: CalendarZoneSchema.optional() })
  .refine(orderedDates)
  .refine((v) => v.metricId === null && v.progressMode !== 'METRIC');
export const GoalPatchSchema = z
  .strictObject(patchShape(goalFields))
  .partial()
  .refine((v) => Object.keys(v).length > 0)
  .refine(orderedDates);
export const GoalSchema = z.strictObject({
  ...GoalBaseShape,
  ...goalFields,
  timezone: CalendarZoneSchema,
});
export const GoalListQuerySchema = CursorQuerySchema.extend({
  status: GoalStatusSchema.optional(),
  lifeAreaId: TaskIdSchema.optional(),
  parentGoalId: TaskIdSchema.optional(),
  horizon: z.enum(['SHORT_TERM', 'LONG_TERM']).optional(),
});
export const GoalMilestoneCreateSchema = z.strictObject({
  title: GoalTitleSchema,
  position: z.number().int().min(0).max(9999).default(0),
  targetDate: PlanningDateSchema.nullable().default(null),
  status: z.enum(['OPEN', 'COMPLETED']).default('OPEN'),
  contributes: z.boolean().default(false),
  weight: GoalWeightSchema.default('1'),
});
export const GoalMilestonePatchSchema = z
  .strictObject(patchShape(GoalMilestoneCreateSchema.shape))
  .partial()
  .refine((v) => Object.keys(v).length > 0);
export const GoalMetricCreateSchema = z
  .strictObject({
    title: GoalTitleSchema,
    unit: z.string().trim().min(1).max(30),
    baseline: GoalAmountSchema,
    target: GoalAmountSchema,
    current: GoalAmountSchema,
    contributes: z.boolean().default(false),
    weight: GoalWeightSchema.default('1'),
  })
  .refine((v) => v.target !== v.baseline);
export const GoalMetricPatchSchema = z
  .strictObject(patchShape(GoalMetricCreateSchema.shape))
  .partial()
  .refine((v) => Object.keys(v).length > 0);
const child = {
  id: TaskIdSchema,
  goalId: TaskIdSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};
export const GoalMilestoneSchema = z.strictObject({
  ...child,
  ...GoalMilestoneCreateSchema.shape,
  completedAt: z.iso.datetime().nullable(),
});
export const GoalMetricSchema = z.strictObject({
  ...child,
  ...GoalMetricCreateSchema.shape,
});
export const GoalTaskLinkCreateSchema = z.strictObject({
  taskId: TaskIdSchema,
  sourceRevision: GoalRevisionSchema,
  contributes: z.boolean().default(false),
  weight: GoalWeightSchema.default('1'),
});
export const GoalTaskLinkPatchSchema = z
  .strictObject({
    contributes: z.boolean().optional(),
    weight: GoalWeightSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export const GoalHabitLinkCreateSchema = HabitRangeSchema.safeExtend({
  habitId: TaskIdSchema,
  sourceRevision: GoalRevisionSchema,
  contributes: z.boolean().default(false),
  weight: GoalWeightSchema.default('1'),
});
export const GoalHabitLinkPatchSchema = z
  .strictObject({
    from: PlanningDateSchema.optional(),
    to: PlanningDateSchema.optional(),
    contributes: z.boolean().optional(),
    weight: GoalWeightSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0)
  .refine(
    (v) =>
      (v.from === undefined && v.to === undefined) ||
      (v.from !== undefined &&
        v.to !== undefined &&
        v.to > v.from &&
        Date.parse(v.to) - Date.parse(v.from) <= 366 * 86400000),
  );
export const GoalTaskLinkSchema = z.strictObject({
  ...child,
  taskId: TaskIdSchema,
  selectedSourceRevision: GoalRevisionSchema,
  contributes: z.boolean(),
  weight: GoalWeightSchema,
});
export const GoalHabitLinkSchema = z.strictObject({
  ...child,
  habitId: TaskIdSchema,
  selectedSourceRevision: GoalRevisionSchema,
  from: PlanningDateSchema,
  to: PlanningDateSchema,
  contributes: z.boolean(),
  weight: GoalWeightSchema,
});
export const GoalProgressSourceSchema = z.strictObject({
  id: TaskIdSchema,
  sourceId: TaskIdSchema,
  kind: z.enum(['METRIC', 'MILESTONE', 'TASK', 'HABIT']),
  weight: GoalWeightSchema,
  rawPercentage: Calculated,
  metric: z
    .strictObject({
      baseline: GoalAmountSchema,
      target: GoalAmountSchema,
      current: GoalAmountSchema,
      unit: z.string().min(1).max(30),
    })
    .nullable(),
  numerator: Calculated,
  denominator: Calculated,
  disposition: z.enum([
    'AVAILABLE',
    'DELETED',
    'MASTER',
    'SKIPPED',
    'CANCELED',
    'NO_DUE_DAYS',
  ]),
  revision: GoalRevisionSchema.nullable(),
  timezone: CalendarZoneSchema.nullable(),
  from: PlanningDateSchema.nullable(),
  to: PlanningDateSchema.nullable(),
  asOfDate: PlanningDateSchema.nullable(),
  scheduleIds: z.array(TaskIdSchema).max(1000),
  entries: z
    .array(z.strictObject({ id: TaskIdSchema, revision: GoalRevisionSchema }))
    .max(10000),
});
export const GoalProgressSchema = z.strictObject({
  ruleVersion: z.literal(1),
  goalId: TaskIdSchema,
  goalRevision: GoalRevisionSchema,
  mode: GoalModeSchema,
  timezone: CalendarZoneSchema,
  computedAt: z.iso.datetime(),
  rawPercentage: Calculated,
  percentage: Calculated,
  weightSum: Calculated,
  reason: z.enum(['CALCULATED', 'NO_SOURCES']),
  sources: z.array(GoalProgressSourceSchema).max(400),
});
export const GoalSnapshotCreateSchema = z.strictObject({});
export const GoalReviewCreateSchema = z.strictObject({
  reflection: z.string().trim().min(1).max(10000),
});
export const GoalReviewSchema = z.strictObject({
  id: TaskIdSchema,
  goalId: TaskIdSchema,
  kind: z.enum(['SNAPSHOT', 'REVIEW']),
  reflection: z.string().nullable(),
  snapshot: GoalProgressSchema,
  createdAt: z.iso.datetime(),
});
export const GoalReviewQuerySchema = CursorQuerySchema.extend({
  kind: z.enum(['SNAPSHOT', 'REVIEW']).optional(),
});
export const GoalPageSchema = z.strictObject({
  items: z.array(GoalSchema).max(100),
  nextCursor: z.string().nullable(),
});
export const GoalReviewPageSchema = z.strictObject({
  items: z.array(GoalReviewSchema).max(100),
  nextCursor: z.string().nullable(),
});
export const GoalMilestoneListSchema = z.strictObject({
  goalRevision: GoalRevisionSchema,
  items: z.array(GoalMilestoneSchema).max(100),
});
export const GoalMetricListSchema = z.strictObject({
  goalRevision: GoalRevisionSchema,
  items: z.array(GoalMetricSchema).max(100),
});
export const GoalTaskLinkListSchema = z.strictObject({
  goalRevision: GoalRevisionSchema,
  items: z.array(GoalTaskLinkSchema).max(100),
});
export const GoalHabitLinkListSchema = z.strictObject({
  goalRevision: GoalRevisionSchema,
  items: z.array(GoalHabitLinkSchema).max(100),
});
export type GoalCreate = z.infer<typeof GoalCreateSchema>;
export type GoalPatch = z.infer<typeof GoalPatchSchema>;
export type Goal = z.infer<typeof GoalSchema>;
export type GoalProgress = z.infer<typeof GoalProgressSchema>;
export type GoalProgressSource = z.infer<typeof GoalProgressSourceSchema>;
export type GoalMilestoneCreate = z.infer<typeof GoalMilestoneCreateSchema>;
export type GoalMetricCreate = z.infer<typeof GoalMetricCreateSchema>;
export type GoalTaskLinkCreate = z.infer<typeof GoalTaskLinkCreateSchema>;
export type GoalHabitLinkCreate = z.infer<typeof GoalHabitLinkCreateSchema>;

export const GoalMilestoneMutationSchema = z.strictObject({
  id: TaskIdSchema,
  revision: GoalRevisionSchema,
  item: GoalMilestoneSchema,
});
export const GoalMetricMutationSchema = z.strictObject({
  id: TaskIdSchema,
  revision: GoalRevisionSchema,
  item: GoalMetricSchema,
});
export const GoalTaskLinkMutationSchema = z.strictObject({
  id: TaskIdSchema,
  revision: GoalRevisionSchema,
  item: GoalTaskLinkSchema,
});
export const GoalHabitLinkMutationSchema = z.strictObject({
  id: TaskIdSchema,
  revision: GoalRevisionSchema,
  item: GoalHabitLinkSchema,
});
export const GoalReviewMutationSchema = GoalReviewSchema.extend({
  revision: GoalRevisionSchema,
});
