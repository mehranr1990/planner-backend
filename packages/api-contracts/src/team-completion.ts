import { z } from 'zod';
import { SharedTaskSchema } from './projects.js';
import { PlanningDateSchema } from './planning.js';
import { CalendarZoneSchema } from './calendar.js';
import { TeamMemberReferenceSchema } from './team-interactions.js';
const id = z.uuid(),
  revision = z.number().int().positive().max(2147483646),
  datetime = z.iso.datetime(),
  weekday = z.number().int().min(0).max(6),
  clock = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/),
  safe = (max: number) =>
    z
      .string()
      .trim()
      .max(max)
      .refine((v) => !v.includes('\0')),
  line = safe(300).pipe(z.string().min(1));
/** Cadence and times are always set explicitly by a Team manager; there is no default schedule. */
export const TeamCheckinScheduleSchema = z.discriminatedUnion('cadence', [
  z.strictObject({
    cadence: z.literal('WEEKLY'),
    opensDay: weekday,
    opensTime: clock,
    closesDay: weekday,
    closesTime: clock,
    timezone: CalendarZoneSchema,
  }),
  z.strictObject({
    cadence: z.literal('DAILY'),
    opensTime: clock,
    closesTime: clock,
    timezone: CalendarZoneSchema,
  }),
]);
export const TeamSettingsSchema = z.strictObject({
  teamId: id,
  planningMode: z.enum(['WEEKLY', 'SPRINTS']),
  estimateUnit: z.enum(['HOURS', 'POINTS']).nullable(),
  weekStart: weekday.nullable(),
  checkinsEnabled: z.boolean().nullable(),
  statusEnabled: z.boolean().nullable(),
  color: z
    .string()
    .regex(/^#[A-Fa-f0-9]{6}$/)
    .nullable(),
  shortName: z.string().nullable(),
  defaultInviteRole: z.enum(['ADMIN', 'LEAD', 'MEMBER', 'VIEWER']).nullable(),
  checkinSchedule: TeamCheckinScheduleSchema.nullable(),
  revision,
  updatedAt: datetime.nullable(),
});
export const TeamSettingsPatchSchema = z
  .strictObject({
    planningMode: TeamSettingsSchema.shape.planningMode.optional(),
    estimateUnit: TeamSettingsSchema.shape.estimateUnit.optional(),
    weekStart: TeamSettingsSchema.shape.weekStart.optional(),
    checkinsEnabled: TeamSettingsSchema.shape.checkinsEnabled.optional(),
    statusEnabled: TeamSettingsSchema.shape.statusEnabled.optional(),
    color: TeamSettingsSchema.shape.color.optional(),
    shortName: safe(32).pipe(z.string().min(1)).nullable().optional(),
    defaultInviteRole: TeamSettingsSchema.shape.defaultInviteRole.optional(),
    checkinSchedule: TeamCheckinScheduleSchema.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export const TeamPresenceStatusSchema = z.enum([
  'AVAILABLE',
  'BUSY',
  'AWAY',
  'OFFLINE',
]);
export const TeamPresenceSchema = z.strictObject({
  member: TeamMemberReferenceSchema,
  status: TeamPresenceStatusSchema.nullable(),
  note: z.string(),
  clearAfter: z.enum(['HOUR', 'TODAY', 'WEEK', 'NEVER']),
  until: datetime.nullable(),
  revision,
  updatedAt: datetime.nullable(),
});
export const TeamPresencePageSchema = z.strictObject({
  items: z.array(TeamPresenceSchema),
  nextCursor: z.string().nullable(),
});
export const TeamPresenceInputSchema = z
  .strictObject({
    status: TeamPresenceStatusSchema.nullable(),
    note: safe(200),
    clearAfter: TeamPresenceSchema.shape.clearAfter,
    until: datetime.nullable(),
  })
  .refine((v) => (v.clearAfter === 'NEVER') === (v.until === null))
  .refine(
    (v) => v.status !== null || (v.note === '' && v.clearAfter === 'NEVER'),
  );
export const TeamCheckinReplyInputSchema = z.discriminatedUnion('kind', [
  z
    .strictObject({
      kind: z.literal('ANSWER'),
      did: safe(2000),
      next: safe(2000),
      blocked: safe(2000),
    })
    .refine((v) => v.did.length > 0 || v.next.length > 0),
  z.strictObject({ kind: z.literal('SKIP') }),
]);
export const TeamCheckinCommentInputSchema = z.strictObject({
  id,
  body: safe(2000).pipe(z.string().min(1)),
});
export const TeamCheckinCommentSchema = z.strictObject({
  id,
  replyId: id,
  author: TeamMemberReferenceSchema,
  body: z.string(),
  createdAt: datetime,
});
export const TeamCheckinReplySchema = z.strictObject({
  id,
  period: PlanningDateSchema,
  member: TeamMemberReferenceSchema,
  state: z.enum(['SENT', 'SKIPPED']),
  did: z.string().nullable(),
  next: z.string().nullable(),
  blocked: z.string().nullable(),
  /** Only on the caller's own reply; null on everyone else's. */
  late: z.boolean().nullable(),
  sentAt: datetime,
  revision,
  comments: z.array(TeamCheckinCommentSchema),
});
export const TeamCheckinWeekSchema = z.strictObject({
  teamId: id,
  /** Local opening date of the check-in period (a day, or the weekly opening day). */
  period: PlanningDateSchema,
  status: z.enum(['UPCOMING', 'OPEN', 'LATE', 'CLOSED']),
  opensAt: datetime,
  closesAt: datetime,
  lateUntil: datetime,
  schedule: TeamCheckinScheduleSchema,
  replies: z.array(TeamCheckinReplySchema),
  mine: z.strictObject({
    state: z.enum(['MISSING', 'SENT', 'SKIPPED']),
    reply: TeamCheckinReplySchema.nullable(),
  }),
  notYet: z.array(
    z.strictObject({
      member: TeamMemberReferenceSchema,
      offline: z.boolean(),
    }),
  ),
  can: z.strictObject({ reply: z.boolean(), comment: z.boolean() }),
});
export const TeamBoardStateSchema = z.enum([
  'TODO',
  'IN_PROGRESS',
  'REVIEW',
  'BLOCKED',
  'DONE',
  'CANCELED',
]);
export const TeamBoardStateInputSchema = z.strictObject({
  state: TeamBoardStateSchema.exclude(['CANCELED']),
});
export const TeamTaskEstimateInputSchema = z.strictObject({
  estimatedMinutes: z.number().int().min(0).max(1000000).nullable(),
});
export const TeamTaskPlanningSchema = z.strictObject({
  task: SharedTaskSchema,
  boardState: TeamBoardStateSchema,
  estimatedMinutes: z.number().int().nonnegative().nullable(),
  dueAt: datetime.nullable(),
  scheduledDate: z.iso.date().nullable(),
  items: z.array(
    z.strictObject({
      id,
      planId: id.nullable(),
      carriedFromPlanId: id.nullable(),
      position: z.number().int().nonnegative(),
      revision,
    }),
  ),
});
export const TeamTaskPlanningPageSchema = z.strictObject({
  items: z.array(TeamTaskPlanningSchema),
  nextCursor: z.string().nullable(),
});
export const TeamPlanPlanningInputSchema = z
  .strictObject({
    focus: z.array(line).max(10).optional(),
    goal: line.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
const count = z.number().int().nonnegative();
export const TeamPlanSummarySchema = z.strictObject({
  planId: id,
  kind: z.enum(['WEEK', 'SPRINT']),
  state: z.enum(['DRAFT', 'ACTIVE', 'CLOSED']),
  revision,
  /** Ordinal among this Team's sprint plans by start date; null for weeks. */
  sprintNumber: z.number().int().positive().nullable(),
  focus: z.array(z.string()),
  focusByActorId: id.nullable(),
  focusAt: datetime.nullable(),
  goal: z.string().nullable(),
  publishedAt: datetime.nullable(),
  publishedByActorId: id.nullable(),
  closedAt: datetime.nullable(),
  /** Team-owned Task items only; Project read-through items are listed by /work-items. */
  planned: count,
  done: count,
  canceled: count,
  blocked: count,
  review: count,
  carriedIn: count,
  /** Items placed after publication; null when publication time is unknown. */
  addedAfterPublish: count.nullable(),
  carriedOut: z.strictObject({ toPlan: count, toBacklog: count }),
  plannedMinutes: count,
  doneMinutes: count,
  unknownEstimates: count,
  days: z.array(
    z.strictObject({
      date: PlanningDateSchema,
      scheduled: count,
      completed: count,
      /** Known estimate minutes not yet done at the end of this date; null for future dates. */
      remainingMinutes: count.nullable(),
    }),
  ),
  unfinished: z.array(
    z.strictObject({
      itemId: id,
      itemRevision: revision,
      taskId: id,
      title: z.string(),
      sourceRevision: revision,
      boardState: TeamBoardStateSchema,
    }),
  ),
  asOf: datetime,
});
export const TeamCarryOverInputSchema = z
  .strictObject({
    decision: z.enum(['NEXT', 'BACKLOG', 'CLOSE']),
    targetPlanId: id.nullable(),
    sourceRevision: revision,
  })
  .refine((v) => (v.decision === 'NEXT') === (v.targetPlanId !== null));
export const TeamBacklogOrderInputSchema = z
  .strictObject({
    items: z.array(z.strictObject({ id, revision })).min(1).max(500),
  })
  .refine((v) => new Set(v.items.map((i) => i.id)).size === v.items.length);
export const TeamBacklogOrderSchema = z.strictObject({
  items: z.array(
    z.strictObject({
      id,
      position: z.number().int().nonnegative(),
      revision,
    }),
  ),
});
export const TeamActivityQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export const TeamActivitySchema = z.strictObject({
  id,
  kind: z.enum(['CREATED', 'MOVED', 'COMPLETED']),
  taskId: id,
  title: z.string(),
  actorId: id.nullable(),
  status: SharedTaskSchema.shape.status,
  at: datetime,
});
export const TeamActivityPageSchema = z.strictObject({
  items: z.array(TeamActivitySchema),
});
export const TeamThanksLinkSchema = z.strictObject({
  kind: z.enum(['TASK', 'GOAL']),
  id,
});
export const TeamThanksCreateSchema = z
  .strictObject({
    id,
    recipients: z.array(TeamMemberReferenceSchema).min(1).max(20),
    body: safe(1000).pipe(z.string().min(1)),
    visibility: z.enum(['TEAM', 'PRIVATE']),
    link: TeamThanksLinkSchema.nullable(),
    /** AN (owner-approved): optional linked Project the author can read independently. */
    projectId: id.nullable().optional(),
  })
  .refine(
    (v) =>
      new Set(v.recipients.map((r) => r.accessId)).size === v.recipients.length,
  );
export const TeamThanksSchema = z.strictObject({
  id,
  author: TeamMemberReferenceSchema,
  recipients: z.array(TeamMemberReferenceSchema),
  body: z.string(),
  visibility: z.enum(['TEAM', 'PRIVATE']),
  /** Link title is resolved from the current Team source; null when it is no longer readable. */
  link: TeamThanksLinkSchema.extend({
    title: z.string().nullable(),
  }).nullable(),
  /** Linked Project, served only while it stays linked and the caller can read it. */
  project: z
    .strictObject({ projectId: id, title: z.string() })
    .nullable()
    .optional(),
  /** A recipient hid it from the Team feed (author and recipients still see it). */
  hidden: z.boolean(),
  createdAt: datetime,
  can: z.strictObject({
    delete: z.boolean(),
    hide: z.boolean(),
    remove: z.boolean(),
  }),
});
export const TeamThanksPageSchema = z.strictObject({
  items: z.array(TeamThanksSchema),
  nextCursor: z.string().nullable(),
});
export const TeamThanksHiddenInputSchema = z.strictObject({
  hidden: z.boolean(),
});
export const TeamThanksRemovedSchema = z.strictObject({
  id,
  removed: z.literal(true),
});
export const TeamFeedbackRequestCreateSchema = z.strictObject({
  id,
  asked: TeamMemberReferenceSchema,
  about: safe(300).pipe(z.string().min(1)),
  question: safe(2000).pipe(z.string().min(1)),
});
export const TeamFeedbackRequestSchema = z.strictObject({
  id,
  requester: TeamMemberReferenceSchema,
  asked: TeamMemberReferenceSchema,
  about: z.string(),
  question: z.string(),
  status: z.enum(['OPEN', 'ANSWERED']),
  createdAt: datetime,
});
export const TeamFeedbackNoteCreateSchema = z.strictObject({
  id,
  recipient: TeamMemberReferenceSchema,
  about: safe(300).pipe(z.string().min(1)),
  body: safe(4000).pipe(z.string().min(1)),
  requestId: id.nullable(),
});
export const TeamFeedbackNoteSchema = z.strictObject({
  id,
  author: TeamMemberReferenceSchema,
  recipient: TeamMemberReferenceSchema,
  about: z.string(),
  body: z.string(),
  requestId: id.nullable(),
  createdAt: datetime,
});
/** Only records the caller wrote or received; never anyone else's 1:1, Leads and Owners included. */
export const TeamFeedbackInboxSchema = z.strictObject({
  asked: z.array(TeamFeedbackRequestSchema),
  requested: z.array(TeamFeedbackRequestSchema),
  received: z.array(TeamFeedbackNoteSchema),
  sent: z.array(TeamFeedbackNoteSchema),
});
