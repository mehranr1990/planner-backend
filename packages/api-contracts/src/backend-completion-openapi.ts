import * as c from './index.js';
import { ProjectPageQuerySchema } from './projects.js';
import { teamCompletionPaths } from './team-completion-openapi.js';
import type { Operation } from './team-completion-openapi.js';
const empty = c.BackendCompletionEmptySchema;
const team = '/teams/{id}',
  ctx = '/companies/{id}/contexts/{scopeId}';
export const backendCompletionOperations: Operation[] = [
  // Team assignments (TA)
  {
    path: team + '/assignments',
    method: 'get',
    output: c.TeamAssignmentPageSchema,
    query: c.TeamAssignmentQuerySchema,
  },
  {
    path: team + '/tasks/{sourceId}/assignments',
    method: 'post',
    output: c.TeamAssignmentSchema,
    input: c.TeamAssignmentCreateSchema,
    idempotency: true,
    etag: true,
  },
  ...(['accept', 'remove'] as const).map((action): Operation => ({
    path: team + '/assignments/{assignmentId}/' + action,
    method: 'post',
    output: c.TeamAssignmentSchema,
    input: empty,
    revision: true,
    etag: true,
    status: 200,
  })),
  {
    path: team + '/assignments/{assignmentId}/decline',
    method: 'post',
    output: c.TeamAssignmentSchema,
    input: c.TeamAssignmentDeclineSchema,
    revision: true,
    etag: true,
    status: 200,
  },
  {
    path: team + '/assignments/{assignmentId}/reassign',
    method: 'post',
    output: c.TeamAssignmentReassignResultSchema,
    input: c.TeamAssignmentReassignSchema,
    revision: true,
    status: 200,
  },
  {
    path: team + '/assignments/{assignmentId}/remind',
    method: 'post',
    output: c.TeamRemindResultSchema,
    input: empty,
    status: 200,
  },
  {
    path: team + '/assignments/{assignmentId}/history',
    method: 'get',
    output: c.TeamAssignmentEventPageSchema,
    query: ProjectPageQuerySchema,
  },
  { path: team + '/my-work', method: 'get', output: c.TeamMyWorkSchema },
  {
    path: team + '/now-working-on',
    method: 'get',
    output: c.TeamNowWorkingSchema,
  },
  {
    path: team + '/memberships/{accessId}/removal-preview',
    method: 'get',
    output: c.TeamRemovalPreviewSchema,
  },
  // Story points (SP)
  {
    path: team + '/task-points',
    method: 'get',
    output: c.TeamTaskPointsPageSchema,
    query: ProjectPageQuerySchema,
  },
  {
    path: team + '/tasks/{sourceId}/points',
    method: 'put',
    output: c.TeamTaskPointsSchema,
    input: c.TeamTaskPointsInputSchema,
    revision: true,
    etag: true,
  },
  {
    path: team + '/plans/{planId}/points',
    method: 'get',
    output: c.TeamPlanPointsSchema,
  },
  // Capacity (CA) and time off (TO)
  {
    path: team + '/capacity/summary',
    method: 'get',
    output: c.TeamCapacitySummarySchema,
    query: c.TeamCapacitySummaryQuerySchema,
  },
  {
    path: team + '/time-off',
    method: 'get',
    output: c.TeamTimeOffPageSchema,
    query: c.TeamTimeOffQuerySchema,
  },
  {
    path: team + '/time-off',
    method: 'post',
    output: c.TeamTimeOffSchema,
    input: c.TeamTimeOffCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    path: team + '/time-off/{timeOffId}/decision',
    method: 'post',
    output: c.TeamTimeOffSchema,
    input: c.TeamTimeOffDecisionSchema,
    revision: true,
    etag: true,
    status: 200,
  },
  {
    path: team + '/time-off/{timeOffId}/cancel',
    method: 'post',
    output: c.TeamTimeOffSchema,
    input: empty,
    revision: true,
    etag: true,
    status: 200,
  },
  {
    path: team + '/time-off/{timeOffId}/history',
    method: 'get',
    output: c.TeamTimeOffEventPageSchema,
    query: ProjectPageQuerySchema,
  },
  // Key results (GL)
  {
    path: team + '/goals/{goalId}/period',
    method: 'put',
    output: c.TeamGoalPeriodSchema,
    input: c.TeamGoalPeriodInputSchema,
    revision: true,
    etag: true,
  },
  {
    path: team + '/goals/{goalId}/key-results',
    method: 'get',
    output: c.TeamGoalKeyResultsSchema,
  },
  {
    path: team + '/goals/{goalId}/key-results',
    method: 'post',
    output: c.TeamKeyResultSchema,
    input: c.TeamKeyResultCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    path: team + '/goals/{goalId}/key-results/{keyResultId}',
    method: 'patch',
    output: c.TeamKeyResultSchema,
    input: c.TeamKeyResultPatchSchema,
    revision: true,
    etag: true,
  },
  {
    path: team + '/goals/{goalId}/key-results/{keyResultId}/checkins',
    method: 'get',
    output: c.TeamKeyResultCheckinPageSchema,
    query: ProjectPageQuerySchema,
  },
  {
    path: team + '/goals/{goalId}/key-results/{keyResultId}/checkins',
    method: 'post',
    output: c.TeamKeyResultCheckinSchema,
    input: c.TeamKeyResultCheckinCreateSchema,
    idempotency: true,
  },
  // Membership profile (MB)
  {
    path: team + '/member-profiles',
    method: 'get',
    output: c.TeamMemberProfilePageSchema,
    query: ProjectPageQuerySchema,
  },
  {
    path: team + '/member-profiles/{accessId}',
    method: 'put',
    output: c.TeamMemberProfileSchema,
    input: c.TeamMemberProfileInputSchema,
    revision: true,
    etag: true,
  },
  // In-app notifications and reminders (RM)
  {
    path: team + '/notifications',
    method: 'get',
    output: c.TeamNotificationPageSchema,
    query: ProjectPageQuerySchema,
  },
  {
    path: team + '/notifications/{notificationId}/read',
    method: 'post',
    output: c.TeamNotificationSchema,
    input: empty,
    status: 200,
  },
  {
    path: team + '/reminder-settings',
    method: 'get',
    output: c.TeamReminderSettingsSchema,
    etag: true,
  },
  {
    path: team + '/reminder-settings',
    method: 'put',
    output: c.TeamReminderSettingsSchema,
    input: c.TeamReminderSettingsInputSchema,
    revision: true,
    etag: true,
  },
  {
    path: team + '/checkins/{period}/remind',
    method: 'post',
    output: c.TeamRemindResultSchema,
    input: empty,
    status: 200,
  },
  // Project health (PH), identity mapping (PM) and analytics (AN)
  {
    path: team + '/project-summaries',
    method: 'get',
    output: c.TeamProjectSummaryPageSchema,
    query: ProjectPageQuerySchema,
  },
  {
    path: team + '/analytics/cycle-time',
    method: 'get',
    output: c.TeamCycleTimeSchema,
    query: c.TeamAnalyticsWindowQuerySchema,
  },
  {
    path: team + '/analytics/estimate-accuracy',
    method: 'get',
    output: c.TeamEstimateAccuracySchema,
    query: c.TeamAnalyticsWindowQuerySchema,
  },
  // Company (LS, ER, BU)
  {
    path: '/companies/{id}/settings/legal',
    method: 'put',
    output: c.CompanySettingsSchema,
    input: c.CompanyLegalSettingsInputSchema,
    revision: true,
    etag: true,
  },
  {
    path: ctx + '/expenses/{expenseId}/review-history',
    method: 'get',
    output: c.CompanyExpenseReviewPageSchema,
    query: ProjectPageQuerySchema,
  },
  {
    path: ctx + '/finance/budgets/{budgetId}/change-requests',
    method: 'get',
    output: c.CompanyBudgetChangeRequestPageSchema,
    query: ProjectPageQuerySchema,
  },
  {
    path: ctx + '/finance/budgets/{budgetId}/change-requests',
    method: 'post',
    output: c.CompanyBudgetChangeRequestSchema,
    input: c.CompanyBudgetChangeRequestCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    path: ctx + '/finance/budget-change-requests/{requestId}',
    method: 'get',
    output: c.CompanyBudgetChangeRequestSchema,
    etag: true,
  },
  {
    path: ctx + '/finance/budget-change-requests/{requestId}/decision',
    method: 'post',
    output: c.CompanyBudgetChangeRequestSchema,
    input: c.CompanyBudgetChangeDecisionSchema,
    revision: true,
    etag: true,
    status: 200,
  },
  {
    path: ctx + '/finance/budget-change-requests/{requestId}/withdraw',
    method: 'post',
    output: c.CompanyBudgetChangeRequestSchema,
    input: empty,
    revision: true,
    etag: true,
    status: 200,
  },
  // Retention selection (OD-1, R1, R2)
  {
    path: '/retention-policies',
    method: 'get',
    output: c.RetentionPolicyCatalogSchema,
    query: c.RetentionPolicyCatalogQuerySchema,
  },
  {
    path: '/spaces/{spaceId}/retention',
    method: 'get',
    output: c.SpaceRetentionSchema,
    etag: true,
  },
  {
    path: '/spaces/{spaceId}/retention',
    method: 'put',
    output: c.SpaceRetentionSchema,
    input: c.SpaceRetentionChangeSchema,
    revision: true,
    etag: true,
  },
  // In-app invitations (OD-4)
  {
    path: '/project-invitations',
    method: 'get',
    output: c.ProjectPendingInvitationPageSchema,
    query: ProjectPageQuerySchema,
  },
  ...(
    ['/invitations', '/team-invitations', '/company-invitations'] as const
  ).map((base): Operation => ({
    path: base + '/{invitationId}/proof',
    method: 'post',
    output: c.RecipientInvitationProofSchema,
    input: empty,
    revision: true,
    status: 200,
  })),
];
export function backendCompletionPaths() {
  return teamCompletionPaths(backendCompletionOperations, {
    prefix: 'backendCompletion',
    tag: 'backend-completion',
    description: 'Current authorized result',
  });
}
