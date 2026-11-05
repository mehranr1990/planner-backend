import type { Prisma } from '../../../generated/prisma/client.js';
export const sharedFeatureKeys = [
  'shared.custody',
  'shared.membership',
  'task.shared',
  'goal.shared',
  'shared.resource-grant',
  'task.assignment',
  'calendar.shared-link',
  'task.field-version',
  'task.dependency',
  'task.reschedule-preview',
  'task.workflow-version',
  'project.risk-issue',
  'project.template-version',
  'project.change-plan',
  'task.shared-work-log',
  'project.capacity-day',
  'project.work-allocation',
  'project.report-snapshot',
  'project.document-version',
  'project.comment-version',
  'file.shared',
] as const;
export type SharedFeatureKey = (typeof sharedFeatureKeys)[number];
export type SharedFeatureDecisionInput = {
  feature: SharedFeatureKey;
  usageOwner:
    | { kind: 'SHARED_CUSTODY'; spaceId: string }
    | { kind: 'PERSONAL_ACCOUNT'; userId: string };
  growth: 1;
  currentUsage: number;
};
/** Current free mode. Safety limits and authorization are always separate. */
export abstract class SharedFeaturePolicy {
  abstract decide(
    input: SharedFeatureDecisionInput,
    tx: Prisma.TransactionClient,
  ): Promise<{ allowed: boolean; mode: 'FREE' }>;
}
export const freeSharedFeaturePolicy: SharedFeaturePolicy = {
  decide: async () => ({ allowed: true, mode: 'FREE' }),
};
