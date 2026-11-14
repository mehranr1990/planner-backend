import { z } from 'zod';
import { TeamMemberReferenceSchema } from './team-interactions.js';
import { PlanningDateSchema } from './planning.js';
import { CompanyMoneySchema } from './company-finance.js';
import { CompanyStaffMemberDisplaySchema } from './company-staff.js';
const id = z.uuid(),
  revision = z.number().int().positive().max(2147483646),
  datetime = z.iso.datetime(),
  basisPoints = z.number().int().min(0).max(10000),
  safe = (max: number) =>
    z
      .string()
      .trim()
      .max(max)
      .refine((v) => !v.includes('\0')),
  text = (max: number) => safe(max).pipe(z.string().min(1)),
  decimal = z.string().regex(/^-?(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,4})?$/),
  page = <T extends z.ZodType>(item: T) =>
    z.strictObject({
      items: z.array(item).max(100),
      nextCursor: z.string().nullable(),
    });
const member = TeamMemberReferenceSchema;

// Team assignments (TA) -------------------------------------------------------
export const TeamAssignmentStateSchema = z.enum([
  'PENDING',
  'ACCEPTED',
  'DECLINED',
  'REMOVED',
]);
export const TeamAssignmentSchema = z.strictObject({
  id,
  taskId: id,
  assignee: member,
  issuer: member,
  state: TeamAssignmentStateSchema,
  /** Visible to the assignee, the issuer and Team work managers only. */
  declineReason: z.string().nullable(),
  endReason: z.enum(['REMOVED', 'REASSIGNED']).nullable(),
  revision,
  createdAt: datetime,
  respondedAt: datetime.nullable(),
  endedAt: datetime.nullable(),
  can: z.strictObject({
    accept: z.boolean(),
    decline: z.boolean(),
    remove: z.boolean(),
    reassign: z.boolean(),
    remind: z.boolean(),
  }),
});
export const TeamAssignmentPageSchema = page(TeamAssignmentSchema);
export const TeamAssignmentQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  after: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
  taskId: id.optional(),
  open: z.enum(['true', 'false']).optional(),
});
/** Assigning someone else needs `work.manage`; a member may assign only themself (auto-accepted). */
export const TeamAssignmentCreateSchema = z.strictObject({
  id,
  assignee: member,
});
export const TeamAssignmentDeclineSchema = z.strictObject({
  reason: text(1000).nullable().default(null),
});
export const TeamAssignmentReassignSchema = z.strictObject({
  id,
  assignee: member,
});
export const TeamAssignmentReassignResultSchema = z.strictObject({
  previous: TeamAssignmentSchema,
  current: TeamAssignmentSchema,
});
export const TeamAssignmentEventSchema = z.strictObject({
  id,
  action: z.enum([
    'ASSIGNED',
    'ACCEPTED',
    'DECLINED',
    'REMOVED',
    'REASSIGNED',
    'REMINDED',
  ]),
  /** Current Team admission of the acting actor; null when no longer resolvable. */
  by: member.nullable(),
  createdAt: datetime,
});
export const TeamAssignmentEventPageSchema = page(TeamAssignmentEventSchema);
const workTask = z.strictObject({
  sourceId: id,
  title: z.string(),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELED']),
  boardState: z.enum([
    'TODO',
    'IN_PROGRESS',
    'REVIEW',
    'BLOCKED',
    'DONE',
    'CANCELED',
  ]),
  dueAt: datetime.nullable(),
  scheduledDate: PlanningDateSchema.nullable(),
  estimatedMinutes: z.number().int().nonnegative().nullable(),
});
/** "Assigned to you": the caller's own open assignments with their current Task state. */
export const TeamMyWorkSchema = z.strictObject({
  member,
  pending: z.array(
    z.strictObject({ assignment: TeamAssignmentSchema, task: workTask }),
  ),
  accepted: z.array(
    z.strictObject({ assignment: TeamAssignmentSchema, task: workTask }),
  ),
});
/** "Now working on": accepted assignments whose Task board state is IN_PROGRESS. */
export const TeamNowWorkingSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        member,
        tasks: z.array(workTask.pick({ sourceId: true, title: true })),
      }),
    )
    .max(500),
});
export const TeamRemovalPreviewSchema = z.strictObject({
  member,
  openAssignments: z.number().int().nonnegative(),
  pendingAssignments: z.number().int().nonnegative(),
  inProgressAssignedTasks: z.number().int().nonnegative(),
  pendingTimeOff: z.number().int().nonnegative(),
  upcomingApprovedTimeOff: z.number().int().nonnegative(),
  futureCapacityDays: z.number().int().nonnegative(),
});
export const TeamGoalPeriodInputSchema = z
  .strictObject({
    startDate: PlanningDateSchema,
    targetDate: PlanningDateSchema,
  })
  .refine((v) => v.targetDate >= v.startDate);
export const TeamGoalPeriodSchema = z.strictObject({
  goalId: id,
  startDate: PlanningDateSchema,
  targetDate: PlanningDateSchema,
  revision,
});

// Story points (SP) -----------------------------------------------------------
export const TeamTaskPointsSchema = z.strictObject({
  taskId: id,
  points: z.number().int().min(0).max(1000).nullable(),
  revision,
  updatedAt: datetime.nullable(),
});
export const TeamTaskPointsPageSchema = page(TeamTaskPointsSchema);
export const TeamTaskPointsInputSchema = z.strictObject({
  points: z.number().int().min(0).max(1000).nullable(),
});
export const TeamPlanPointsSchema = z.strictObject({
  planId: id,
  kind: z.enum(['WEEK', 'SPRINT']),
  /** Sum of current points of Team Tasks planned in the plan; unestimated tasks are counted separately. */
  plannedPoints: z.number().int().nonnegative(),
  completedPoints: z.number().int().nonnegative(),
  plannedTasks: z.number().int().nonnegative(),
  unestimatedTasks: z.number().int().nonnegative(),
});

// Capacity (CA) and time off (TO) -------------------------------------------
export const TeamCapacitySummaryQuerySchema = z.strictObject({
  from: PlanningDateSchema,
  to: PlanningDateSchema,
  timezone: z.string().min(1).max(100),
});
const capacityDay = z.strictObject({
  date: PlanningDateSchema,
  /** Configured available minutes; null when no capacity was recorded for the day. */
  availableMinutes: z.number().int().nonnegative().nullable(),
  timeOffMinutes: z.number().int().nonnegative(),
  /** available − approved time off (floored at 0); null when availability is unknown. */
  netAvailableMinutes: z.number().int().nonnegative().nullable(),
  /** Estimated minutes of accepted, open assigned Team Tasks scheduled on the day. */
  reservedMinutes: z.number().int().nonnegative(),
  /** Recorded Shared work-log minutes that started on the day. */
  actualMinutes: z.number().int().nonnegative(),
});
const capacityTotals = z.strictObject({
  availableMinutes: z.number().int().nonnegative(),
  unknownDays: z.number().int().nonnegative(),
  timeOffMinutes: z.number().int().nonnegative(),
  netAvailableMinutes: z.number().int().nonnegative(),
  reservedMinutes: z.number().int().nonnegative(),
  actualMinutes: z.number().int().nonnegative(),
  /** reserved ÷ net available in basis points; null when net available is 0 or any day is unknown. */
  bookedBasisPoints: z.number().int().nonnegative().nullable(),
});
export const TeamCapacitySummarySchema = z.strictObject({
  from: PlanningDateSchema,
  to: PlanningDateSchema,
  timezone: z.string(),
  /** Viewers receive only their own row; other roles receive every current member. */
  members: z
    .array(
      z.strictObject({
        member,
        days: z.array(capacityDay),
        totals: capacityTotals,
      }),
    )
    .max(500),
  totals: capacityTotals,
});
export const TeamTimeOffStateSchema = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELED',
]);
export const TeamTimeOffSchema = z.strictObject({
  id,
  member,
  startDate: PlanningDateSchema,
  endDate: PlanningDateSchema,
  /** null = whole day. */
  minutesPerDay: z.number().int().min(1).max(1440).nullable(),
  /** Private: only the requester and Team work managers receive it. */
  reason: z.string().nullable(),
  state: TeamTimeOffStateSchema,
  decisionNote: z.string().nullable(),
  decidedAt: datetime.nullable(),
  revision,
  createdAt: datetime,
  can: z.strictObject({ decide: z.boolean(), cancel: z.boolean() }),
});
export const TeamTimeOffPageSchema = page(TeamTimeOffSchema);
export const TeamTimeOffQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  after: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
  state: TeamTimeOffStateSchema.optional(),
});
export const TeamTimeOffCreateSchema = z
  .strictObject({
    id,
    startDate: PlanningDateSchema,
    endDate: PlanningDateSchema,
    minutesPerDay: z.number().int().min(1).max(1440).nullable().default(null),
    reason: text(1000).nullable().default(null),
  })
  .refine((v) => v.endDate >= v.startDate);
export const TeamTimeOffDecisionSchema = z.strictObject({
  decision: z.enum(['APPROVE', 'REJECT']),
  note: text(1000).nullable().default(null),
});
export const TeamTimeOffEventSchema = z.strictObject({
  id,
  action: z.enum(['SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELED']),
  by: member.nullable(),
  createdAt: datetime,
});
export const TeamTimeOffEventPageSchema = page(TeamTimeOffEventSchema);

// Key results (GL) ------------------------------------------------------------
export const TeamKeyResultSchema = z.strictObject({
  id,
  goalId: id,
  title: z.string(),
  unit: z.string().nullable(),
  /** MANUAL: latest recorded check-in value. TASKS: count of DONE Team Tasks linked to the Goal. */
  source: z.enum(['MANUAL', 'TASKS']),
  startValue: decimal,
  targetValue: decimal,
  currentValue: decimal.nullable(),
  /** clamp((current − start) ÷ (target − start), 0, 1) in basis points; null without a current value. */
  progress: basisPoints.nullable(),
  archived: z.boolean(),
  revision,
  updatedAt: datetime,
});
export const TeamGoalKeyResultsSchema = z.strictObject({
  goalId: id,
  startDate: PlanningDateSchema.nullable(),
  targetDate: PlanningDateSchema.nullable(),
  /** Unweighted mean of active key-result progress; null when any is unknown or none exist. */
  progress: basisPoints.nullable(),
  /** Elapsed share of the Goal period (inclusive days); null without both period dates. */
  expectedProgress: basisPoints.nullable(),
  /** ON_TRACK when progress ≥ expectedProgress; null when either is unknown. */
  pace: z.enum(['ON_TRACK', 'BEHIND']).nullable(),
  items: z.array(TeamKeyResultSchema).max(50),
});
export const TeamKeyResultCreateSchema = z
  .strictObject({
    id,
    title: text(300),
    unit: text(30).nullable().default(null),
    source: z.enum(['MANUAL', 'TASKS']),
    startValue: decimal,
    targetValue: decimal,
  })
  .refine((v) => Number(v.startValue) !== Number(v.targetValue))
  .refine(
    (v) =>
      v.source === 'MANUAL' ||
      (Number(v.startValue) === 0 && Number(v.targetValue) > 0),
  );
export const TeamKeyResultPatchSchema = z
  .strictObject({
    title: text(300).optional(),
    unit: text(30).nullable().optional(),
    targetValue: decimal.optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export const TeamKeyResultCheckinCreateSchema = z.strictObject({
  id,
  value: decimal,
  note: text(500).nullable().default(null),
});
export const TeamKeyResultCheckinSchema = z.strictObject({
  id,
  keyResultId: id,
  value: decimal,
  note: z.string().nullable(),
  by: member.nullable(),
  createdAt: datetime,
});
export const TeamKeyResultCheckinPageSchema = page(TeamKeyResultCheckinSchema);

// Membership profile (MB) -----------------------------------------------------
export const TeamMemberProfileSchema = z.strictObject({
  member,
  jobTitle: z.string().nullable(),
  revision,
});
export const TeamMemberProfilePageSchema = page(TeamMemberProfileSchema);
export const TeamMemberProfileInputSchema = z.strictObject({
  generation: revision,
  jobTitle: text(100).nullable(),
});

// In-app notifications (RM) ---------------------------------------------------
export const TeamNotificationSchema = z.strictObject({
  id,
  kind: z.enum([
    'ASSIGNMENT',
    'ASSIGNMENT_REMINDER',
    'CHECKIN_REMINDER',
    'TIME_OFF_DECIDED',
  ]),
  subjectId: id,
  createdAt: datetime,
  readAt: datetime.nullable(),
});
export const TeamNotificationPageSchema = page(TeamNotificationSchema);
export const TeamReminderSettingsSchema = z.strictObject({
  teamId: id,
  /** Minutes before a check-in closes; null = no scheduled reminder (manager-configured). */
  checkinReminderMinutes: z.number().int().min(1).max(1440).nullable(),
  revision,
});
export const TeamReminderSettingsInputSchema = z.strictObject({
  checkinReminderMinutes: z.number().int().min(1).max(1440).nullable(),
});
export const TeamRemindResultSchema = z.strictObject({
  delivered: z.number().int().nonnegative(),
});

// Project health (PH) and identity mapping (PM) -----------------------------
export const TeamProjectSummarySchema = z.strictObject({
  projectId: id,
  title: z.string(),
  health: z.strictObject({
    /** UNKNOWN without open work; OFF_TRACK on overdue work; AT_RISK on blocked work; else ON_TRACK. */
    state: z.enum(['ON_TRACK', 'AT_RISK', 'OFF_TRACK', 'UNKNOWN']),
    openTasks: z.number().int().nonnegative(),
    overdueOpenTasks: z.number().int().nonnegative(),
    blockedOpenTasks: z.number().int().nonnegative(),
    /** DONE ÷ (all − CANCELED) Tasks in basis points; null without Tasks. */
    progress: basisPoints.nullable(),
    asOf: datetime,
  }),
  /** Team members who are also current Project members (same account identity). */
  commonMembers: z
    .array(z.strictObject({ member, projectAccessId: id }))
    .max(500),
});
export const TeamProjectSummaryPageSchema = page(TeamProjectSummarySchema);

// Analytics (AN) --------------------------------------------------------------
export const TeamAnalyticsWindowQuerySchema = z.strictObject({
  from: datetime,
  to: datetime,
});
export const TeamCycleTimeSchema = z.strictObject({
  from: datetime,
  to: datetime,
  /** Team Tasks completed (DONE) in the window. */
  completedTasks: z.number().int().nonnegative(),
  /** Of those, Tasks with a recorded IN_PROGRESS transition before completion. */
  measuredTasks: z.number().int().nonnegative(),
  /** Median minutes from the first recorded IN_PROGRESS change to completion. */
  medianMinutes: z.number().int().nonnegative().nullable(),
});
export const TeamEstimateAccuracySchema = z.strictObject({
  from: datetime,
  to: datetime,
  completedTasks: z.number().int().nonnegative(),
  /** Completed Tasks with an estimate and at least one non-voided Shared work log. */
  measuredTasks: z.number().int().nonnegative(),
  estimatedMinutes: z.number().int().nonnegative(),
  actualMinutes: z.number().int().nonnegative(),
  /** Median of actual ÷ estimate per measured Task, in basis points; null without measurements. */
  medianRatio: z.number().int().nonnegative().nullable(),
});

// Company legal settings (LS), decisions (ER/AT) and budget changes (BU) -----
export const CompanyLegalSettingsInputSchema = z
  .strictObject({
    legalName: text(300).nullable().optional(),
    fiscalStartMonth: z.number().int().min(1).max(12).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export const CompanyDecisionReasonSchema = z.strictObject({
  reason: z.string().nullable(),
});
export const CompanyBudgetChangeRequestStateSchema = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
]);
export const CompanyBudgetChangeRequestSchema = z.strictObject({
  id,
  budgetId: id,
  budgetRevision: revision,
  amount: CompanyMoneySchema,
  direction: z.enum(['INCREASE', 'DECREASE']),
  currency: z.string(),
  requester: CompanyStaffMemberDisplaySchema,
  reason: z.string().nullable(),
  state: CompanyBudgetChangeRequestStateSchema,
  decidedAt: datetime.nullable(),
  decisionReason: z.string().nullable(),
  adjustmentId: id.nullable(),
  revision,
  createdAt: datetime,
  can: z.strictObject({ decide: z.boolean(), withdraw: z.boolean() }),
});
export const CompanyBudgetChangeRequestPageSchema = page(
  CompanyBudgetChangeRequestSchema,
);
export const CompanyBudgetChangeRequestCreateSchema = z.strictObject({
  id,
  amount: CompanyMoneySchema.refine((v) => Number(v) > 0),
  direction: z.enum(['INCREASE', 'DECREASE']),
  reason: text(1000).nullable().default(null),
});
export const CompanyBudgetChangeDecisionSchema = z
  .strictObject({
    decision: z.enum(['APPROVE', 'REJECT']),
    reason: text(1000).nullable().default(null),
  })
  .refine((v) => v.decision === 'APPROVE' || v.reason !== null, {
    message: 'A rejection requires a reason',
  });

// Retention selection (OD-1, R1, R2) ----------------------------------------
const retentionClass = z.strictObject({
  retainAfterClosureSeconds: z.number().int().nonnegative(),
  disposalAction: z.enum(['PURGE', 'PSEUDONYMIZE']),
});
export const RetentionContextSchema = z.enum([
  'PROJECT',
  'TEAM',
  'COMPANY',
  'CONVERSATION',
  'MEETING',
  'SOCIAL_GROUP',
]);
export const RetentionPolicySummarySchema = z.strictObject({
  version: z.string(),
  applicableContexts: z.array(RetentionContextSchema),
  marketScope: z.string(),
  classRules: z.strictObject({
    workContent: retentionClass,
    commentsHistory: retentionClass,
    filesDerivatives: retentionClass,
    exports: retentionClass,
    accessAuditLifecycle: retentionClass,
  }),
  createdAt: datetime,
});
export const RetentionPolicyCatalogSchema = z.strictObject({
  items: z.array(RetentionPolicySummarySchema).max(200),
});
export const RetentionPolicyCatalogQuerySchema = z.strictObject({
  context: RetentionContextSchema,
});
export const SpaceRetentionSchema = z.strictObject({
  spaceId: id,
  kind: RetentionContextSchema,
  policy: RetentionPolicySummarySchema,
  revision,
  /** Space Managers may move only to an applicable, comparable, strictly longer policy. */
  canChange: z.boolean(),
});
export const SpaceRetentionChangeSchema = z.strictObject({
  policyVersion: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/),
});

// In-app invitation proof delivery (OD-4) -----------------------------------
export const RecipientInvitationProofSchema = z.strictObject({
  invitationId: id,
  /** One-time acceptance proof for the verified recipient; earlier proofs no longer work. */
  proof: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  revision,
  expiresAt: datetime,
});
export const ProjectPendingInvitationSummarySchema = z.strictObject({
  id,
  contextLabel: z.literal('Project'),
  revision,
  expiresAt: datetime,
});
export const ProjectPendingInvitationPageSchema = page(
  ProjectPendingInvitationSummarySchema,
);
export const BackendCompletionEmptySchema = z.strictObject({});
export const CompanyExpenseReviewSchema = z.strictObject({
  id,
  versionId: id,
  action: z.string(),
  reviewer: CompanyStaffMemberDisplaySchema.nullable(),
  /** Decision reason; null when none was given or it was erased. */
  reason: z.string().nullable(),
  createdAt: datetime,
});
export const CompanyExpenseReviewPageSchema = page(CompanyExpenseReviewSchema);
