import { z } from 'zod';
import { PlanningDateSchema } from './planning.js';
import { CalendarZoneSchema } from './calendar.js';
import { CursorQuerySchema } from './foundation.js';
export const InsightQuerySchema = z
  .strictObject({
    from: PlanningDateSchema,
    to: PlanningDateSchema,
    timezone: CalendarZoneSchema.optional(),
    grouping: z.enum(['DAY', 'WEEK', 'MONTH']).default('DAY'),
    cohort: z
      .enum(['DUE_DATE', 'SCHEDULED_DATE', 'COMPLETED_AT'])
      .default('DUE_DATE'),
    includeFinance: z.enum(['true', 'false']).optional(),
  })
  .refine(
    (q) =>
      q.to > q.from &&
      (Date.parse(q.to) - Date.parse(q.from)) / 86400000 <= 366,
    { path: ['to'], message: 'Range must contain 1–366 dates' },
  )
  .refine(
    (q) =>
      2 * Date.parse(q.from) - Date.parse(q.to) >= Date.parse('1900-01-01'),
    { path: ['from'], message: 'Comparison period precedes supported dates' },
  );
export type InsightQuery = z.infer<typeof InsightQuerySchema>;
export const InsightFamilySchema = z.enum([
  'overview',
  'tasks',
  'habits',
  'goals',
  'time',
  'finance',
]);
export type InsightFamily = z.infer<typeof InsightFamilySchema>;
export const InsightMetricSchema = z.strictObject({
  id: z.string().max(100),
  sourceType: z.enum([
    'TASK',
    'DAILY_PLAN',
    'HABIT',
    'GOAL',
    'GOAL_REVIEW',
    'TIME_ENTRY',
    'FOCUS_SESSION',
    'TRANSACTION_POSTING',
  ]),
  sourceId: z.uuid().nullable(),
  currency: z.string().length(3).nullable(),
  sourceTimezone: z.string().nullable(),
  value: z
    .string()
    .regex(/^-?\d+(\.\d+)?$/)
    .nullable(),
  numerator: z.number().int().nonnegative().nullable(),
  denominator: z.number().int().nonnegative().nullable(),
  reason: z.enum(['NO_DENOMINATOR', 'NO_OBSERVATION']).nullable(),
  definition: z.string().max(500),
});
export type InsightMetric = z.infer<typeof InsightMetricSchema>;
/** Owner-provided bounded, read-only metric evaluator within one snapshot. */
export type InsightReadModel = {
  metrics(
    from: string,
    to: string,
  ): Array<
    Pick<InsightMetric, 'id' | 'sourceType' | 'value' | 'definition'> &
      Partial<InsightMetric>
  >;
};
const Period = z.strictObject({
  from: PlanningDateSchema,
  to: PlanningDateSchema,
});
const Bucket = Period.extend({
  partial: z.boolean(),
  metrics: z.array(InsightMetricSchema).max(100000),
});
export const InsightResponseSchema = z.strictObject({
  ruleVersion: z.literal(1),
  family: InsightFamilySchema,
  computedAt: z.iso.datetime(),
  timezone: CalendarZoneSchema,
  firstDayOfWeek: z.number().int().min(0).max(6),
  grouping: z.enum(['DAY', 'WEEK', 'MONTH']),
  cohort: z.enum(['DUE_DATE', 'SCHEDULED_DATE', 'COMPLETED_AT']),
  freshness: z.literal('CURRENT_SOURCE_STATE_CONSISTENT_SNAPSHOT'),
  current: Period.extend({
    metrics: z.array(InsightMetricSchema).max(100000),
    buckets: z.array(Bucket).max(366),
  }),
  previous: Period.extend({
    metrics: z.array(InsightMetricSchema).max(100000),
  }),
  comparisons: z
    .array(
      z.strictObject({
        metricId: z.string(),
        sourceId: z.uuid().nullable(),
        currency: z.string().nullable(),
        absoluteChange: z.string().nullable(),
        percentageChange: z.string().nullable(),
        reason: z.enum(['NO_BASELINE', 'NO_OBSERVATION']).nullable(),
      }),
    )
    .max(100000),
  explanations: z
    .array(
      z.strictObject({
        metricId: z.string(),
        direction: z.enum(['INCREASED', 'DECREASED', 'UNCHANGED']),
        from: PlanningDateSchema,
        to: PlanningDateSchema,
        ruleVersion: z.literal(1),
      }),
    )
    .max(3),
});
export const RewardPreferencesPatchSchema = z.strictObject({
  enabled: z.boolean(),
  displayAchievements: z.boolean(),
});
export const RewardPreferencesSchema = RewardPreferencesPatchSchema.extend({
  revision: z.number().int().positive(),
  enabledSince: z.iso.datetime().nullable(),
});
export type RewardPreferences = z.infer<typeof RewardPreferencesSchema>;
export const RewardQuerySchema = CursorQuerySchema;
export const AchievementSchema = z.strictObject({
  id: z.uuid(),
  code: z.enum(['FIRST_TASK', 'TEN_TASKS', 'SEVEN_HABIT_DAYS']),
  ruleVersion: z.literal(1),
  required: z.number().int().positive(),
  unlockedAt: z.iso.datetime().nullable(),
});
export const AchievementsSchema = z.strictObject({
  enabled: z.boolean(),
  displayAchievements: z.boolean(),
  items: z.array(AchievementSchema).max(3),
});
export const RewardLedgerItemSchema = z.strictObject({
  id: z.uuid(),
  sourceEventId: z.uuid(),
  kind: z.enum(['TASK', 'HABIT_DAY']),
  points: z.number().int().positive(),
  earnedAt: z.iso.datetime(),
});
export const RewardProgressSchema = z.strictObject({
  enabled: z.boolean(),
  totalXp: z.string().regex(/^\d+$/),
  policy: z.literal('EARNED_HISTORY_NO_NEGATIVE_XP'),
  items: z.array(RewardLedgerItemSchema).max(100),
  nextCursor: z.string().nullable(),
  freshness: z.strictObject({
    pending: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
});
export const RewardRecalculateSchema = z.strictObject({
  after: z.enum(['FIRST_TASK', 'TEN_TASKS', 'SEVEN_HABIT_DAYS']).optional(),
  limit: z.number().int().min(1).max(3).default(3),
});
export const RewardRecalculatedSchema = z.strictObject({
  processed: z.number().int().min(0).max(3),
  nextCursor: z.string().nullable(),
});
