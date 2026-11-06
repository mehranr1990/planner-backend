import { z } from 'zod';
import {
  ProjectCapacityInputSchema,
  ProjectWorkloadQuerySchema,
  ProjectWorkloadRowSchema,
} from './project-execution.js';
import { ProjectPageQuerySchema } from './projects.js';
const id = z.uuid(),
  count = z.number().int().nonnegative();
export const TeamCapacityInputSchema = ProjectCapacityInputSchema;
export const TeamCapacityCreateSchema = TeamCapacityInputSchema.safeExtend({
  id,
});
export const TeamCapacitySchema = TeamCapacityCreateSchema.safeExtend({
  teamId: id,
  revision: z.number().int().positive(),
});
export const TeamAnalyticsQuerySchema = ProjectWorkloadQuerySchema;
export const TeamCapacityQuerySchema = TeamAnalyticsQuerySchema.safeExtend(
  ProjectPageQuerySchema.shape,
);
export const TeamCapacityPageSchema = z.strictObject({
  items: z.array(TeamCapacitySchema).max(100),
  nextCursor: z.string().nullable(),
});
export const TeamWorkloadSchema = z.strictObject({
  teamId: id,
  ...TeamAnalyticsQuerySchema.shape,
  basis: z.literal(
    'CURRENT_TEAM_MEMBERS_AND_VISIBLE_ACCEPTED_PROJECT_ALLOCATIONS',
  ),
  rows: z.array(ProjectWorkloadRowSchema).max(10000),
});
export const TeamWorkSummarySchema = z.strictObject({
  taskCount: count,
  statusCounts: z.strictObject({
    OPEN: count,
    IN_PROGRESS: count,
    DONE: count,
    CANCELED: count,
  }),
  estimatedMinutes: count,
  unknownEstimates: count,
  completedInWindow: count,
  overdueTaskCount: count,
  recordedSeconds: count,
  workLogCount: count,
  goalCount: count,
});
export const TeamPortfolioSourceSchema = z.strictObject({
  kind: z.enum(['TEAM', 'PROJECT']),
  spaceId: id,
  summary: TeamWorkSummarySchema,
});
export const TeamPortfolioSchema = z.strictObject({
  teamId: id,
  ...TeamAnalyticsQuerySchema.shape,
  asOf: z.iso.datetime(),
  window: z.strictObject({ fromAt: z.iso.datetime(), toAt: z.iso.datetime() }),
  basis: z.literal('CURRENT_AUTHORIZED_SOURCES_AND_EXPLICIT_SHARED_WORK'),
  denominator: z.literal(
    'CURRENT_NONDELETED_TASKS_IN_TEAM_AND_VISIBLE_REFERENCED_PROJECTS',
  ),
  sources: z.array(TeamPortfolioSourceSchema).max(101),
  summary: TeamWorkSummarySchema,
});
export const TeamDashboardSchema = z.strictObject({
  portfolio: TeamPortfolioSchema,
  workload: TeamWorkloadSchema,
  planning: z.strictObject({
    visibleBacklogItems: count,
    visiblePlannedItems: count,
    activePlans: count,
  }),
});
