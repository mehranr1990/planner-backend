import { z } from 'zod';
import { CalendarZoneSchema, CalendarLocalSchema } from './calendar.js';
import { PlanningDateSchema } from './planning.js';
import { ProjectPageQuerySchema, SharedTaskSchema } from './projects.js';
import {
  CalendarRangeQuerySchema,
  CalendarOccurrenceSchema,
} from './calendar.js';
import { TeamMemberReferenceSchema } from './team-interactions.js';
import { TeamInvitationSchema } from './teams.js';
import { ProjectSentInvitationQuerySchema } from './project-gap-closure.js';
import { TeamCapacitySummarySchema } from './backend-completion.js';

const id = z.uuid(),
  revision = z.number().int().positive();
export const TeamWeeklyCapacityInputSchema = z.strictObject({
  timezone: CalendarZoneSchema,
  effectiveFrom: PlanningDateSchema,
  /** Sunday=0 through Saturday=6; null explicitly means unknown, zero means nonworking. */
  weekdays: z.array(z.number().int().min(0).max(1440).nullable()).length(7),
});
export const TeamWeeklyCapacityStoredSchema =
  TeamWeeklyCapacityInputSchema.extend({ version: z.literal(1).default(1) });
export const TeamWeeklyCapacitySchema = z.strictObject({
  member: TeamMemberReferenceSchema,
  template: TeamWeeklyCapacityInputSchema.nullable(),
  revision,
});
export const TeamSentInvitationQuerySchema = ProjectSentInvitationQuerySchema;
export const TeamSentInvitationSchema = TeamInvitationSchema.extend({
  recipientEmail: z.email().nullable(),
  createdAt: z.iso.datetime(),
  sentAt: z.iso.datetime(),
});
export const TeamSentInvitationPageSchema = z.strictObject({
  items: z.array(TeamSentInvitationSchema).max(100),
  nextCursor: z.string().nullable(),
});
export const TeamRsvpQuerySchema = z.strictObject({
  recurrenceKey: CalendarLocalSchema.optional(),
});
export const TeamRsvpSummarySchema = z.strictObject({
  meetingId: id,
  recurrenceKey: CalendarLocalSchema.nullable(),
  accepted: z.number().int().nonnegative(),
  declined: z.number().int().nonnegative(),
  maybe: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
});
export const TeamAvailabilitySchema = z.strictObject({
  basis: z.literal(
    'EXPLICIT_TEAM_CAPACITY_APPROVED_TIME_OFF_AND_VISIBLE_TEAM_WORK',
  ),
  personalAvailability: z.literal('UNKNOWN'),
  busyIntervals: z.literal('UNKNOWN'),
  asOf: z.iso.datetime(),
  capacity: TeamCapacitySummarySchema,
  missingEstimates: z.number().int().nonnegative(),
  hiddenProjectWork: z.literal('UNKNOWN'),
  projectAllocations: z
    .array(
      z.strictObject({
        member: TeamMemberReferenceSchema,
        date: PlanningDateSchema,
        projectId: id,
        taskId: id,
        plannedMinutes: z.number().int().nonnegative(),
      }),
    )
    .max(10000),
});
export const TeamForecastSchema = TeamAvailabilitySchema.extend({
  advisory: z.literal(true),
  periods: z
    .array(
      z.strictObject({
        member: TeamMemberReferenceSchema,
        date: PlanningDateSchema,
        knownWorkloadMinutes: z.number().int().nonnegative(),
        unknownEstimates: z.number().int().nonnegative(),
        remainingMinutes: z.number().int().nullable(),
        overallocatedMinutes: z.number().int().nonnegative().nullable(),
        state: z.enum(['KNOWN', 'UNKNOWN']),
      }),
    )
    .max(16000),
});
export const TeamSprintCapacityInputSchema = z.strictObject({
  capacityPoints: z.number().int().min(0).max(1000000).nullable(),
});
export const TeamSprintCapacitySchema = TeamSprintCapacityInputSchema.extend({
  sourceBasis: z.literal('TEAM_OWNED_TASKS'),
  planId: id,
  revision,
  committedPoints: z.number().int().nonnegative(),
  unestimatedTasks: z.number().int().nonnegative(),
  remainingPoints: z.number().int().nullable(),
});
export const TeamHistoryQuerySchema = ProjectPageQuerySchema.extend({
  action: z.string().min(1).max(100).optional(),
  resourceId: id.optional(),
});
export const TeamRecordedActivitySchema = z.strictObject({
  id,
  actorId: id.nullable(),
  at: z.iso.datetime(),
  action: z.string(),
  resourceId: id.nullable(),
  changedFields: z.array(z.string()),
  detailsBasis: z.literal('RECORDED_METADATA_ONLY'),
});
export const TeamRecordedActivityPageSchema = z.strictObject({
  items: z.array(TeamRecordedActivitySchema).max(100),
  nextCursor: z.string().nullable(),
});
export const TeamSprintSnapshotSchema = z.strictObject({
  version: z.literal(1),
  items: z
    .array(
      z.strictObject({
        taskId: id,
        status: z.enum(['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELED']),
        minutes: z.number().int().nonnegative().nullable(),
        points: z.number().int().nonnegative().nullable(),
        completedAt: z.iso.datetime().nullable(),
      }),
    )
    .max(2000),
});
export const TeamSprintHistoryPageSchema = z.strictObject({
  items: z
    .array(
      TeamRecordedActivitySchema.extend({
        observation: z
          .strictObject({
            scopeTasks: z.number().int().nonnegative(),
            completedTasks: z.number().int().nonnegative(),
            remainingPoints: z.number().int().nonnegative().nullable(),
            remainingMinutes: z.number().int().nonnegative().nullable(),
          })
          .nullable(),
      }),
    )
    .max(100),
  nextCursor: z.string().nullable(),
});
export const TeamBurndownSchema = z.strictObject({
  sourceBasis: z.literal('TEAM_OWNED_TASKS'),
  planId: id,
  startDate: PlanningDateSchema,
  endDate: PlanningDateSchema,
  timezone: CalendarZoneSchema,
  asOf: z.iso.datetime(),
  basis: z.enum(['RECORDED_OBSERVATIONS', 'INSUFFICIENT_HISTORY']),
  originalCommittedTasks: z.number().int().nonnegative().nullable(),
  originalCommittedPoints: z.number().int().nonnegative().nullable(),
  originalCommittedMinutes: z.number().int().nonnegative().nullable(),
  currentPoints: z.number().int().nonnegative().nullable(),
  currentMinutes: z.number().int().nonnegative().nullable(),
  currentTasks: z.number().int().nonnegative(),
  addedTasks: z.number().int().nonnegative().nullable(),
  removedTasks: z.number().int().nonnegative().nullable(),
  days: z
    .array(
      z.strictObject({
        date: PlanningDateSchema,
        remainingPoints: z.number().int().nonnegative().nullable(),
        remainingMinutes: z.number().int().nonnegative().nullable(),
        scopeTasks: z.number().int().nonnegative().nullable(),
        completedTasks: z.number().int().nonnegative().nullable(),
      }),
    )
    .max(93),
});
export const TeamVelocityQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(30).default(12),
});
export const TeamVelocitySchema = z.strictObject({
  sourceBasis: z.literal('TEAM_OWNED_TASKS'),
  basis: z.literal('RECORDED_CLOSED_SPRINT_EVIDENCE_NO_TIME_CONVERSION'),
  items: z
    .array(
      z.strictObject({
        planId: id,
        closedAt: z.iso.datetime().nullable(),
        completedPoints: z.number().int().nonnegative().nullable(),
        completedTasks: z.number().int().nonnegative().nullable(),
        unestimatedTasks: z.number().int().nonnegative().nullable(),
        state: z.enum(['KNOWN', 'INSUFFICIENT_HISTORY']),
        scopePolicy: z.literal('COMPLETED_IN_SPRINT_AND_PRESENT_AT_CLOSE'),
      }),
    )
    .max(30),
});
export const TeamAssociationInputSchema = z.strictObject({
  id,
  action: z.enum(['LINK', 'UNLINK']),
});
export const TeamAssociationDecisionSchema = z.strictObject({
  decision: z.enum(['APPROVE', 'REJECT', 'CANCEL']),
});
export const TeamAssociationRequestSchema = z.strictObject({
  id,
  action: z.enum(['LINK', 'UNLINK']),
  state: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELED']),
  requestedAt: z.iso.datetime(),
  reviewedAt: z.iso.datetime().nullable(),
});
export const TeamAssociationSchema = z.strictObject({
  teamId: id,
  projectId: id,
  revision,
  active: z.boolean(),
  request: TeamAssociationRequestSchema.nullable(),
  implications: z.strictObject({
    grantsProjectMembership: z.literal(false),
    changesCustody: z.literal(false),
    changesRetention: z.literal(false),
  }),
});
export const TeamAssociationHistoryPageSchema = z.strictObject({
  items: z
    .array(
      TeamRecordedActivitySchema.extend({
        request: TeamAssociationRequestSchema.nullable(),
      }),
    )
    .max(100),
  nextCursor: z.string().nullable(),
});
export const TeamAssociationPageSchema = z.strictObject({
  items: z.array(TeamAssociationSchema).max(100),
  nextCursor: z.string().nullable(),
});
export const TeamSourceQuerySchema = ProjectPageQuerySchema.extend({
  source: z.enum(['ALL', 'TEAM', 'PROJECT']).default('ALL'),
  status: SharedTaskSchema.shape.status.optional(),
});
export const TeamVisibleTasksSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        kind: z.enum(['TEAM', 'PROJECT']),
        spaceId: id,
        scopeId: id,
        visibility: z.literal('FULL'),
        task: SharedTaskSchema,
      }),
    )
    .max(100),
  nextCursor: z.string().nullable(),
  hiddenWork: z.literal('UNKNOWN'),
});
export const TeamSourceCalendarQuerySchema =
  CalendarRangeQuerySchema.safeExtend({
    source: z.enum(['ALL', 'TEAM', 'PROJECT']).default('ALL'),
  });
export const TeamSourceCalendarSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        kind: z.enum(['TEAM', 'PROJECT']),
        spaceId: id,
        scopeId: id,
        occurrence: CalendarOccurrenceSchema,
      }),
    )
    .max(100),
  nextCursor: z.string().nullable(),
});
export const TeamCalendarOccupancySchema = z.strictObject({
  from: PlanningDateSchema,
  to: PlanningDateSchema,
  timezone: CalendarZoneSchema,
  asOf: z.iso.datetime(),
  basis: z.literal('UNION_OF_AUTHORIZED_ACTIVE_CALENDAR_OCCURRENCES'),
  visibleEvents: z.number().int().nonnegative(),
  unknownIntervals: z.number().int().nonnegative(),
  occupiedMinutes: z.number().int().nonnegative(),
});
export const TeamCrossWorkloadQuerySchema = z
  .strictObject({
    from: PlanningDateSchema,
    to: PlanningDateSchema,
    timezone: CalendarZoneSchema,
  })
  .refine(
    (q) =>
      q.to >= q.from && Date.parse(q.to) - Date.parse(q.from) <= 30 * 86400000,
  );
export const TeamCrossWorkloadSchema = z.strictObject({
  asOf: z.iso.datetime(),
  basis: z.literal('REQUESTER_OWN_VISIBLE_TEAM_ASSIGNMENTS_DISTINCT_TASKS'),
  capacityBasis: z.literal(
    'INDEPENDENT_TEAM_BUDGETS_NO_SHARED_PERSONAL_CAPACITY',
  ),
  personalAvailability: z.literal('UNKNOWN'),
  items: z
    .array(z.strictObject({ teamId: id, capacity: TeamCapacitySummarySchema }))
    .max(100),
  knownEstimatedMinutes: z.number().int().nonnegative(),
  unknownEstimates: z.number().int().nonnegative(),
  recordedMinutes: z.number().int().nonnegative(),
  allocatedProjectMinutes: z.number().int().nonnegative(),
  distinctTasks: z.number().int().nonnegative(),
  capacityMinutes: z.number().int().nonnegative().nullable(),
});

export const TeamAssignmentRevertSchema = z.strictObject({ id });
