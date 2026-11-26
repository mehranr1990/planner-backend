import { assertCommercialFeature } from '../../admin-commerce/public/entitlements.js';
import type { Prisma } from '../../../generated/prisma/client.js';
export const sharedFeatureKeys = [
  'social.connection',
  'social.circle',
  'social.circle-member',
  'social.group',
  'social.join-request',
  'meeting.resource',
  'meeting.participant',
  'meeting.invitation',
  'meeting.agenda-entry',
  'meeting.version',
  'announcement.resource',
  'announcement.version',
  'messaging.conversation',
  'messaging.participant',
  'messaging.message',
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
  'team.project-reference',
  'team.plan',
  'team.work-item',
  'calendar.shared-event',
  'team.capacity-day',
  'team.case',
  'team.case-entry',
  'team.disclosure',
  'team.meeting',
  'team.meeting-invitation',
  'company.association',
  'company.knowledge-folder',
  'company.knowledge-document',
  'company.knowledge-version',
  'company.financial-workflow',
  'company.financial-workflow-version',
  'company.financial-approval',
  'company.reimbursement-request',
  'company.payment-acknowledgement',
  'company.acknowledgement-correction',
  'company.expense',
  'company.budget',
  'company.commitment',
  'company.finance-category',
  'company.finance-reference',
  'company.expense-version',
  'company.staff-profile',
  'company.availability-day',
  'company.resource',
  'company.allocation',
  'company.employee-case',
  'company.case-entry',
  'company.department',
  'company.unit',
  'company.policy-version',
  'company.context-membership',
] as const;
export type SharedFeatureKey = (typeof sharedFeatureKeys)[number];
export type SharedFeatureDecisionInput = {
  feature: SharedFeatureKey;
  usageOwner:
    | { kind: 'SHARED_CUSTODY'; spaceId: string; scopeId?: string }
    | { kind: 'PERSONAL_ACCOUNT'; userId: string };
  growth: 1;
  currentUsage: number;
  batchOffset?: number;
};
/** Current free mode. Safety limits and authorization are always separate. */
export abstract class SharedFeaturePolicy {
  abstract decide(
    input: SharedFeatureDecisionInput,
    tx: Prisma.TransactionClient,
  ): Promise<{ allowed: boolean; mode: 'FREE' | 'COMMERCIAL' }>;
}
export const freeSharedFeaturePolicy: SharedFeaturePolicy = {
  decide: async () => ({ allowed: true, mode: 'FREE' }),
};

/** Default-free until the persisted commercial policy and binding are activated. */
export const configuredSharedFeaturePolicy: SharedFeaturePolicy = {
  decide: async (input, tx) => {
    const policy = await tx.commercePolicy.findUniqueOrThrow({
      where: { id: 'GLOBAL' },
    });
    if (!policy.enforcement) return { allowed: true, mode: 'FREE' };
    const selector =
      input.usageOwner.kind === 'SHARED_CUSTODY'
        ? (input.usageOwner.scopeId ?? input.usageOwner.spaceId)
        : (
            await tx.space.findFirst({
              where: { kind: 'PERSONAL', ownerUserId: input.usageOwner.userId },
              select: { id: true },
            })
          )?.id;
    if (selector) {
      const membership =
        input.feature === 'shared.membership' ||
        input.feature === 'company.context-membership';
      let usage = input.currentUsage;
      if (
        input.usageOwner.kind === 'SHARED_CUSTODY' &&
        input.usageOwner.scopeId
      ) {
        usage = membership
          ? await tx.contextAccess.count({
              where: {
                scopeId: selector,
                state: { in: ['ACTIVE', 'SUSPENDED'] },
                memberRole: { not: null },
                SharedActor: { state: 'ACTIVE' },
              },
            })
          : ((
              await tx.sharedUsageEntry.aggregate({
                where: {
                  spaceId: input.usageOwner.spaceId,
                  feature: input.feature,
                  OR: [
                    { scopeId: selector },
                    ...(selector === input.usageOwner.spaceId
                      ? [{ scopeId: null }]
                      : []),
                  ],
                },
                _sum: { delta: true },
              })
            )._sum.delta ?? 0);
      }
      const offset =
        input.usageOwner.kind === 'SHARED_CUSTODY'
          ? (input.batchOffset ?? 0)
          : 0;
      await assertCommercialFeature(
        tx,
        selector,
        input.feature,
        usage + offset,
        input.growth,
      );
      if (membership)
        await assertCommercialFeature(
          tx,
          selector,
          'seats',
          usage + offset,
          input.growth,
        );
    }
    return { allowed: true, mode: 'COMMERCIAL' };
  },
};
