import { z } from 'zod';
import { PlanningDateSchema } from './planning.js';
const Clock = z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/);
const Intervals = z
  .array(z.strictObject({ start: Clock, end: Clock }))
  .max(16)
  .refine((v) => v.every((i) => i.end > i.start));
export const WorkingHoursSchema = z
  .strictObject({
    intervalsByWeekday: z.array(Intervals).length(7),
    exceptions: z
      .array(z.strictObject({ date: PlanningDateSchema, intervals: Intervals }))
      .max(366),
  })
  .refine(
    (v) =>
      new Set(v.exceptions.map((e) => e.date)).size === v.exceptions.length,
  );
export const WorkingHoursPutSchema = z.strictObject({
  workingHours: WorkingHoursSchema.nullable(),
});
export const WorkingHoursViewSchema = WorkingHoursPutSchema.extend({
  revision: z.number().int().positive(),
  timezone: z.string(),
  firstDayOfWeek: z.number().int().min(0).max(6),
});
export const WorkingCapacityQuerySchema = z
  .strictObject({
    date: PlanningDateSchema.optional(),
    weekStartDate: PlanningDateSchema.optional(),
  })
  .refine((v) => !!v.date !== !!v.weekStartDate);
const Day = z.strictObject({
  date: PlanningDateSchema,
  state: z.enum(['CONFIGURED', 'UNKNOWN', 'DST_GAP']),
  availableMinutes: z.number().nonnegative().nullable(),
  busyMinutes: z.number().nonnegative(),
  reservedMinutes: z.number().nonnegative().nullable(),
  remainingMinutes: z.number().nonnegative().nullable(),
  overbookedMinutes: z.number().nonnegative().nullable(),
});
export const WorkingCapacitySchema = z.strictObject({
  timezone: z.string(),
  revision: z.number().int().positive(),
  state: z.enum(['CONFIGURED', 'UNKNOWN', 'DST_GAP']),
  days: z.array(Day).min(1).max(7),
  availableMinutes: z.number().nonnegative().nullable(),
  reservedMinutes: z.number().nonnegative().nullable(),
  remainingMinutes: z.number().nonnegative().nullable(),
  overbookedMinutes: z.number().nonnegative().nullable(),
});
export type WorkingHours = z.infer<typeof WorkingHoursSchema>;
