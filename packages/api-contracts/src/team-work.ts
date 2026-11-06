import { z } from 'zod';
import {
  ProjectPageQuerySchema,
  SharedTaskSchema,
  SharedGoalSchema,
} from './projects.js';
import { PlanningDateSchema } from './planning.js';
import {
  CalendarZoneSchema,
  CalendarEventSchema,
  CalendarRangeQuerySchema,
} from './calendar.js';
export const TeamWorkTargetSchema = z.strictObject({
  kind: z.enum(['TASK', 'GOAL']),
  spaceId: z.uuid(),
  id: z.uuid(),
});
export const TeamPlanCreateSchema = z
  .strictObject({
    id: z.uuid(),
    kind: z.enum(['WEEK', 'SPRINT']),
    title: z.string().trim().min(1).max(300),
    startDate: PlanningDateSchema,
    endDate: PlanningDateSchema,
    timezone: CalendarZoneSchema,
  })
  .refine((v) => {
    const days = (Date.parse(v.endDate) - Date.parse(v.startDate)) / 86400000;
    return days > 0 && days <= 93 && (v.kind !== 'WEEK' || days === 7);
  });
export const TeamPlanPatchSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(300).optional(),
    state: z.enum(['ACTIVE', 'CLOSED']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export const TeamReviewInputSchema = z.strictObject({
  summary: z.string().trim().min(1).max(10000),
});
export const TeamPlanSchema = z.strictObject({
  ...TeamPlanCreateSchema.shape,
  spaceId: z.uuid(),
  state: z.enum(['DRAFT', 'ACTIVE', 'CLOSED']),
  revision: z.number().int().positive(),
  createdByActorId: z.uuid(),
  reviewSummary: z.string().nullable(),
  reviewedByActorId: z.uuid().nullable(),
  reviewedAt: z.iso.datetime().nullable(),
});
export const TeamPlanPageSchema = z.strictObject({
  items: z.array(TeamPlanSchema),
  nextCursor: z.string().nullable(),
});
export const TeamWorkItemCreateSchema = z.strictObject({
  id: z.uuid(),
  target: TeamWorkTargetSchema,
  sourceRevision: z.number().int().positive(),
  planId: z.uuid().nullable().default(null),
  position: z.number().int().min(0).max(1000000).default(0),
});
export const TeamWorkItemPatchSchema = z.strictObject({
  planId: z.uuid().nullable(),
  position: z.number().int().min(0).max(1000000),
  sourceRevision: z.number().int().positive(),
});
export const TeamWorkPageQuerySchema = ProjectPageQuerySchema.extend({
  planId: z.union([z.uuid(), z.literal('BACKLOG')]).optional(),
});
export const TeamWorkItemSchema = z.strictObject({
  id: z.uuid(),
  spaceId: z.uuid(),
  planId: z.uuid().nullable(),
  target: TeamWorkTargetSchema,
  sourceRevision: z.number().int().positive(),
  position: z.number().int().nonnegative(),
  revision: z.number().int().positive(),
  createdByActorId: z.uuid(),
  source: z.union([SharedTaskSchema, SharedGoalSchema]),
});
export const TeamWorkItemPageSchema = z.strictObject({
  items: z.array(TeamWorkItemSchema),
  nextCursor: z.string().nullable(),
});
export const TeamWorkRemovedSchema = z.strictObject({
  id: z.uuid(),
  removed: z.literal(true),
});
export const TeamCalendarEventSchema = CalendarEventSchema.omit({
  createdByUserId: true,
}).extend({ scopeId: z.uuid(), createdByActorId: z.uuid() });
export const TeamCalendarPageSchema = z.strictObject({
  items: z.array(TeamCalendarEventSchema),
  nextCursor: z.string().nullable(),
});
export const TeamCalendarQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(8192).optional(),
});
export const TeamCalendarRangeQuerySchema = CalendarRangeQuerySchema.safeExtend(
  { cursor: z.string().max(8192).optional() },
);
export const TeamCalendarSeriesResultSchema = z.strictObject({
  event: TeamCalendarEventSchema,
  exception: TeamCalendarEventSchema.nullable(),
  successor: TeamCalendarEventSchema.nullable(),
});
