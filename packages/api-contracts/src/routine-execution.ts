import { z } from 'zod';
import { PlanningDateSchema } from './planning.js';
import { CalendarZoneSchema } from './calendar.js';
export const RoutineScheduleSchema = z
  .strictObject({
    startDate: PlanningDateSchema,
    endDate: PlanningDateSchema.optional(),
    kind: z.enum(['DAILY', 'WEEKLY', 'WEEKDAYS']),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
    startTime: z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/),
    expectedMinutes: z.number().int().min(1).max(1440).optional(),
    timezone: CalendarZoneSchema,
    reminder: z.boolean().optional(),
  })
  .refine(
    (v) =>
      (!v.endDate || v.endDate >= v.startDate) &&
      (v.kind === 'WEEKDAYS'
        ? !!v.weekdays && new Set(v.weekdays).size === v.weekdays.length
        : !v.weekdays),
  );
export const RoutineScheduleUpdateSchema = z.strictObject({
  schedule: RoutineScheduleSchema.nullable(),
});
export const RoutineScheduleViewSchema = RoutineScheduleUpdateSchema.extend({
  revision: z.number().int().positive(),
});
export const RoutineOccurrenceQuerySchema = z
  .strictObject({
    from: PlanningDateSchema,
    to: PlanningDateSchema,
    limit: z
      .string()
      .regex(/^(?:[1-9]|[1-9][0-9]|100)$/)
      .optional(),
    afterDate: PlanningDateSchema.optional(),
  })
  .refine(
    (v) =>
      v.to > v.from && Date.parse(v.to) - Date.parse(v.from) <= 366 * 86400000,
  );
export const RoutineExecutionSchema = z.strictObject({
  id: z.string().max(100),
  routineId: z.uuid(),
  localDate: PlanningDateSchema,
  scheduledAt: z.iso.datetime().nullable(),
  timezone: CalendarZoneSchema,
  state: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'SKIPPED', 'DST_GAP']),
  revision: z.number().int().nonnegative(),
  startedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
  linkedHabitCount: z.number().int().nonnegative(),
  completedHabitCount: z.number().int().nonnegative(),
  completionPercentage: z.number().min(0).max(100).nullable(),
});
export const RoutineExecutionPageSchema = z.strictObject({
  items: z.array(RoutineExecutionSchema).max(100),
  nextDate: PlanningDateSchema.nullable(),
});
export const RoutineExecuteSchema = z.strictObject({
  action: z.enum(['START', 'COMPLETE', 'SKIP']),
});
export type RoutineSchedule = z.infer<typeof RoutineScheduleSchema>;
export type RoutineExecution = z.infer<typeof RoutineExecutionSchema>;
