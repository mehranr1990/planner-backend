import * as c from './index.js';
import { teamCompletionPaths } from './team-completion-openapi.js';
import type { Operation } from './team-completion-openapi.js';
const p = '/teams/{id}';
export const teamGapOperations: Operation[] = [
  {
    path: p + '/projects/{projectId}/association-history',
    method: 'get',
    output: c.TeamAssociationHistoryPageSchema,
    query: c.ProjectPageQuerySchema,
  },
  {
    path: p + '/calendar/occupancy',
    method: 'get',
    output: c.TeamCalendarOccupancySchema,
    query: c.TeamSourceCalendarQuerySchema,
  },
  {
    path: p + '/files/config',
    method: 'get',
    output: c.ProjectFileConfigSchema,
  },
  {
    path: p + '/assignments/{assignmentId}/revert',
    method: 'post',
    output: c.TeamAssignmentReassignResultSchema,
    input: c.TeamAssignmentRevertSchema,
    revision: true,
    idempotency: true,
    status: 200,
  },
  {
    path: p + '/project-association-requests',
    method: 'get',
    output: c.TeamAssociationPageSchema,
    query: c.ProjectPageQuerySchema,
  },
  {
    path: p + '/projects/{projectId}/association-request',
    method: 'get',
    output: c.TeamAssociationSchema,
    etag: true,
  },
  {
    path: p + '/projects/{projectId}/association-requests',
    method: 'post',
    output: c.TeamAssociationSchema,
    input: c.TeamAssociationInputSchema,
    revision: true,
    idempotency: true,
    etag: true,
  },
  {
    path: p + '/projects/{projectId}/association-request/decision',
    method: 'post',
    output: c.TeamAssociationSchema,
    input: c.TeamAssociationDecisionSchema,
    revision: true,
    etag: true,
    status: 200,
  },
  {
    path: p + '/visible-tasks',
    method: 'get',
    output: c.TeamVisibleTasksSchema,
    query: c.TeamSourceQuerySchema,
  },
  {
    path: p + '/calendar/sources',
    method: 'get',
    output: c.TeamSourceCalendarSchema,
    query: c.TeamSourceCalendarQuerySchema,
  },
  {
    path: p + '/cross-team-workload',
    method: 'get',
    output: c.TeamCrossWorkloadSchema,
    query: c.TeamCrossWorkloadQuerySchema,
  },
  {
    path: p + '/plans/{planId}/burndown',
    method: 'get',
    output: c.TeamBurndownSchema,
  },
  {
    path: p + '/plans/{planId}/history',
    method: 'get',
    output: c.TeamSprintHistoryPageSchema,
    query: c.ProjectPageQuerySchema,
  },
  {
    path: p + '/sprint-velocity',
    method: 'get',
    output: c.TeamVelocitySchema,
    query: c.TeamVelocityQuerySchema,
  },
  {
    path: p + '/sent-invitations',
    method: 'get',
    output: c.TeamSentInvitationPageSchema,
    query: c.TeamSentInvitationQuerySchema,
  },
  {
    path: p + '/invitations/{offerId}/resend',
    method: 'post',
    output: c.TeamInvitationSchema,
    input: c.CollaborationEmptySchema,
    revision: true,
    idempotency: true,
    etag: true,
    status: 200,
  },
  {
    path: p + '/memberships/{accessId}/weekly-capacity',
    method: 'get',
    output: c.TeamWeeklyCapacitySchema,
    etag: true,
  },
  {
    path: p + '/memberships/{accessId}/weekly-capacity',
    method: 'put',
    output: c.TeamWeeklyCapacitySchema,
    input: c.TeamWeeklyCapacityInputSchema,
    revision: true,
    etag: true,
  },
  {
    path: p + '/availability',
    method: 'get',
    output: c.TeamAvailabilitySchema,
    query: c.TeamCapacitySummaryQuerySchema,
  },
  {
    path: p + '/forecast',
    method: 'get',
    output: c.TeamForecastSchema,
    query: c.TeamCapacitySummaryQuerySchema,
  },
  {
    path: p + '/meetings/{meetingId}/rsvp-summary',
    method: 'get',
    output: c.TeamRsvpSummarySchema,
    query: c.TeamRsvpQuerySchema,
  },
  {
    path: p + '/time-off/{timeOffId}',
    method: 'patch',
    output: c.TeamTimeOffSchema,
    input: c.TeamTimeOffCreateSchema,
    revision: true,
    etag: true,
  },
  {
    path: p + '/plans/{planId}/point-capacity',
    method: 'get',
    output: c.TeamSprintCapacitySchema,
    etag: true,
  },
  {
    path: p + '/plans/{planId}/point-capacity',
    method: 'put',
    output: c.TeamSprintCapacitySchema,
    input: c.TeamSprintCapacityInputSchema,
    revision: true,
    etag: true,
  },
  {
    path: p + '/recorded-activity',
    method: 'get',
    output: c.TeamRecordedActivityPageSchema,
    query: c.TeamHistoryQuerySchema,
  },
];
export function teamGapPaths() {
  return teamCompletionPaths(teamGapOperations, {
    prefix: 'teamGap',
    tag: 'teams',
    description:
      'Current authorized Team result; explicit capacity and independent source permissions apply.',
  });
}
