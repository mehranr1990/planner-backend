import { z } from 'zod';
import {
  ProjectPageQuerySchema,
  SharedTaskSchema,
  SharedGoalSchema,
} from './projects.js';
import { CalendarZoneSchema } from './calendar.js';
import { PlanningDateSchema } from './planning.js';
const revision = z.number().int().positive().max(2147483646);
export const TaskAssignmentCreateSchema = z.strictObject({
  id: z.uuid(),
  recipientAccessId: z.uuid(),
  recipientGeneration: revision,
  kind: z.enum(['PRIMARY', 'CONTRIBUTOR']),
});
export const TaskAssignmentReassignSchema = TaskAssignmentCreateSchema.omit({
  kind: true,
}).extend({ sourceRevision: revision });
export const TaskAssignmentDeclineSchema = z.strictObject({
  reason: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .refine((v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v)),
});
export const TaskAssignmentSchema = TaskAssignmentCreateSchema.extend({
  spaceId: z.uuid(),
  scopeId: z.uuid(),
  projectId: z.uuid(),
  taskId: z.uuid(),
  decision: z.enum(['PENDING', 'ACCEPTED', 'DECLINED']),
  revision,
  selectedTaskRevision: revision,
  createdByActorId: z.uuid(),
  createdAt: z.iso.datetime(),
  respondedAt: z.iso.datetime().nullable(),
  declineReason: z.string().max(2000).nullable(),
  endedAt: z.iso.datetime().nullable(),
  endReason: z.enum(['DECLINED', 'REVOKED', 'REASSIGNED']).nullable(),
});
export const TaskAssignmentPreviewSchema = z.strictObject({
  assignment: TaskAssignmentSchema,
  preview: SharedTaskSchema.pick({
    id: true,
    spaceId: true,
    title: true,
    revision: true,
  }),
});
export const AssignmentPolicySchema = z.strictObject({
  mode: z.literal('EXPLICIT_CONSENT'),
  automaticAcceptance: z.literal(false),
  policyVersion: revision,
});
const cursor = ProjectPageQuerySchema.shape.after.unwrap().nullable();
const page = <T extends z.ZodType>(item: T) =>
  z.strictObject({ items: z.array(item).max(100), nextCursor: cursor });
export const TaskAssignmentPageSchema = page(TaskAssignmentSchema);
export const TaskAssignmentPreviewPageSchema = page(
  TaskAssignmentPreviewSchema,
);
export const WorkTaskQuerySchema = ProjectPageQuerySchema.extend({
  projectId: z.uuid().optional(),
  status: SharedTaskSchema.shape.status.optional(),
});
export const WorkGoalQuerySchema = ProjectPageQuerySchema.extend({
  projectId: z.uuid().optional(),
  status: SharedGoalSchema.shape.status.optional(),
});
export const SharedTaskScheduleSchema = z.strictObject({
  id: z.uuid(),
  revision,
  plannedStartAt: z.iso.datetime().nullable(),
  dueAt: z.iso.datetime().nullable(),
  scheduledDate: PlanningDateSchema.nullable(),
});
export const SharedTaskScheduleInputSchema = SharedTaskScheduleSchema.omit({
  id: true,
  revision: true,
}).refine((v) => !v.plannedStartAt || !v.dueAt || v.plannedStartAt <= v.dueAt);
export const WorkTaskSchema = z.strictObject({
  id: z.uuid(),
  projectId: z.uuid(),
  task: SharedTaskSchema,
  schedule: SharedTaskScheduleSchema,
  assignment: TaskAssignmentSchema,
});
export const WorkTaskPageSchema = page(WorkTaskSchema);
export const WorkGoalSchema = z.strictObject({
  id: z.uuid(),
  projectId: z.uuid(),
  goal: SharedGoalSchema,
});
export const WorkGoalPageSchema = page(WorkGoalSchema);
export const WorkOverlayQuerySchema = ProjectPageQuerySchema.extend({
  from: PlanningDateSchema,
  to: PlanningDateSchema,
  timezone: CalendarZoneSchema,
  projectIds: z
    .string()
    .max(3700)
    .transform((v) => v.split(','))
    .pipe(z.array(z.uuid()).min(1).max(100))
    .optional(),
}).refine(
  (v) =>
    v.to > v.from && (Date.parse(v.to) - Date.parse(v.from)) / 86400000 <= 93,
);
export const WorkOverlaySchema = z.strictObject({
  id: z.uuid(),
  projectId: z.uuid(),
  spaceId: z.uuid(),
  sourceRevision: revision,
  title: SharedTaskSchema.shape.title,
  kind: z.enum(['ALL_DAY', 'TIMED']),
  date: PlanningDateSchema,
  startAt: z.iso.datetime().nullable(),
  endAt: z.iso.datetime().nullable(),
});
export const WorkOverlayPageSchema = page(WorkOverlaySchema);
export const SharedAssignmentNotificationSchema = z.strictObject({
  id: z.uuid(),
  spaceId: z.uuid(),
  assignmentId: z.uuid(),
  kind: z.enum(['ASSIGNED', 'ACCEPTED', 'DECLINED', 'REVOKED', 'REASSIGNED']),
  assignmentRevision: revision,
  revision,
  createdAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
});
export const SharedAssignmentNotificationPageSchema = page(
  SharedAssignmentNotificationSchema,
);
export const SharedWorkNotificationReadSchema = z.strictObject({
  spaceId: z.uuid(),
});
export const SharedTaskBlockInputSchema = z.strictObject({
  spaceId: z.uuid(),
  taskId: z.uuid(),
  sourceRevision: revision,
});
export const SharedTaskBlockLinkSchema = SharedTaskBlockInputSchema.omit({
  sourceRevision: true,
}).extend({
  blockId: z.uuid(),
  selectedTaskRevision: revision,
  createdAt: z.iso.datetime(),
});
export const SharedTaskBlockViewSchema = z.strictObject({
  blockId: z.uuid(),
  revision,
  link: SharedTaskBlockLinkSchema.nullable(),
  source: SharedTaskSchema.nullable(),
  availability: z.enum(['AVAILABLE', 'UNAVAILABLE', 'UNLINKED']),
});
