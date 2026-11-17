import { OwnerHandoverSchema } from './collaboration.js';
import { z } from 'zod';
import {
  CompanyPageQuerySchema,
  CompanyMemberRoleSchema,
} from './companies.js';
import {
  CompanyStaffMemberSchema,
  CompanyStaffMemberDisplaySchema,
} from './company-staff.js';
const id = z.uuid(),
  instant = z.iso.datetime(),
  text = (n: number) => z.string().trim().min(1).max(n);
const revision = z.number().int().positive();
const stamp = { id, revision, createdAt: instant, updatedAt: instant };
const page = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    items: z.array(item).max(100),
    nextCursor: z.string().nullable(),
  });
export const CompanyGapPageQuerySchema = CompanyPageQuerySchema;
export const CompanyObservationRangeSchema = z
  .strictObject({ from: instant, to: instant })
  .refine(
    (v) =>
      Date.parse(v.from) < Date.parse(v.to) &&
      Date.parse(v.to) - Date.parse(v.from) <= 366 * 86400000,
    'Expected a positive range of at most 366 days',
  );
export const CompanyObservationPageQuerySchema = CompanyPageQuerySchema.extend({
  from: instant,
  to: instant,
}).refine(
  (v) =>
    Date.parse(v.from) < Date.parse(v.to) &&
    Date.parse(v.to) - Date.parse(v.from) <= 366 * 86400000,
);
export const CompanyTransferHistorySchema = z.strictObject({
  id,
  employeeActorId: id,
  actorId: id,
  fromScopeId: id,
  toScopeId: id,
  fromDepartmentId: id.nullable(),
  toDepartmentId: id.nullable(),
  fromUnitId: id.nullable(),
  toUnitId: id.nullable(),
  fromAccessId: id,
  toAccessId: id,
  fromGeneration: revision,
  toGeneration: revision,
  role: CompanyMemberRoleSchema,
  state: z.literal('CONFIRMED'),
  effectiveAt: instant,
  createdAt: instant,
});
export const CompanyTransferHistoryPageSchema = page(
  CompanyTransferHistorySchema,
);
export const CompanyOrganizationChartSchema = z.strictObject({
  companyId: id,
  nodes: z
    .array(
      z.strictObject({
        id,
        kind: z.enum(['COMPANY', 'DEPARTMENT', 'UNIT']),
        parentId: id.nullable(),
        title: text(300),
        revision,
        memberCount: z.number().int().nonnegative().nullable(),
        managers: z.array(CompanyStaffMemberDisplaySchema).max(100),
        evidence: z.enum(['OBSERVED', 'RESTRICTED']),
      }),
    )
    .max(1001),
});
export const CompanyAssetTagInputSchema = z.strictObject({
  assetTag: text(100).nullable(),
});
export const CompanyAssetTagSchema = CompanyAssetTagInputSchema.extend({
  id,
  revision,
});
export const CompanyCustodyCreateSchema = z.strictObject({
  id,
  member: CompanyStaffMemberSchema,
  expectedReturnAt: instant.nullable().default(null),
});
export const CompanyCustodySchema = z.strictObject({
  ...stamp,
  resourceId: id,
  member: CompanyStaffMemberDisplaySchema,
  issuedByActorId: id,
  assignedAt: instant,
  expectedReturnAt: instant.nullable(),
  returnedAt: instant.nullable(),
  returnedByActorId: id.nullable(),
});
export const CompanyCustodyPageSchema = page(CompanyCustodySchema);
export const CompanyMaintenanceCreateSchema = z.strictObject({
  id,
  kind: text(100),
  reason: text(2000).nullable().default(null),
  scheduledAt: instant,
  responsible: CompanyStaffMemberSchema,
});
export const CompanyMaintenanceChangeSchema = z.strictObject({
  state: z.enum(['IN_PROGRESS', 'COMPLETED', 'CANCELED']),
});
export const CompanyMaintenanceSchema = z.strictObject({
  ...stamp,
  resourceId: id,
  kind: text(100),
  reason: text(2000).nullable(),
  scheduledAt: instant,
  completedAt: instant.nullable(),
  responsible: CompanyStaffMemberDisplaySchema,
  state: z.enum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELED']),
});
export const CompanyMaintenancePageSchema = page(CompanyMaintenanceSchema);
export const CompanyKpiObservationCreateSchema = z
  .strictObject({
    id,
    metric: text(100),
    source: text(300),
    unit: text(80),
    value: z.string().regex(/^-?(?:0|[1-9]\d{0,17})(?:\.\d{1,4})?$/),
    periodStart: instant,
    periodEnd: instant,
  })
  .refine((v) => Date.parse(v.periodStart) < Date.parse(v.periodEnd));
export const CompanyKpiObservationSchema =
  CompanyKpiObservationCreateSchema.safeExtend({
    ...stamp,
    recordedByActorId: id,
    evidence: z.literal('OBSERVED'),
  });
export const CompanyKpiObservationPageSchema = page(
  CompanyKpiObservationSchema,
);
export const CompanyReviewCycleCreateSchema = z
  .strictObject({
    id,
    title: text(300),
    periodStart: instant,
    periodEnd: instant,
  })
  .refine((v) => Date.parse(v.periodStart) < Date.parse(v.periodEnd));
export const CompanyReviewCycleSchema =
  CompanyReviewCycleCreateSchema.safeExtend({
    ...stamp,
    state: z.enum(['DRAFT', 'OPEN', 'CLOSED']),
  });
export const CompanyReviewCyclePageSchema = page(CompanyReviewCycleSchema);
export const CompanyReviewCycleChangeSchema = z.strictObject({
  state: z.enum(['OPEN', 'CLOSED']),
});
export const CompanyReviewAssignmentSchema = z
  .strictObject({
    id,
    subject: CompanyStaffMemberSchema,
    reviewer: CompanyStaffMemberSchema,
  })
  .refine((v) => v.subject.accessId !== v.reviewer.accessId);
export const CompanyReviewSubmissionSchema = z.strictObject({
  body: text(10000),
});
export const CompanyPerformanceReviewSchema = z.strictObject({
  ...stamp,
  cycleId: id,
  subject: CompanyStaffMemberDisplaySchema,
  reviewer: CompanyStaffMemberDisplaySchema,
  state: z.enum(['DRAFT', 'SUBMITTED', 'COMPLETED']),
  body: text(10000).nullable(),
  redactedAt: instant.nullable(),
});
export const CompanyPerformanceReviewPageSchema = page(
  CompanyPerformanceReviewSchema,
);
export const CompanyPrivateRevisionSchema = z.strictObject({
  ...stamp,
  actorId: id,
  body: text(10000).nullable(),
  state: z.string().nullable(),
  meetingAt: instant.nullable(),
  redactedAt: instant.nullable(),
});
export const CompanyPrivateRevisionPageSchema = page(
  CompanyPrivateRevisionSchema,
);
export const CompanyOneOnOneCreateSchema = z.strictObject({
  id,
  employee: CompanyStaffMemberSchema,
  meetingAt: instant,
  notes: text(10000),
});
export const CompanyOneOnOnePatchSchema = z.strictObject({
  meetingAt: instant,
  notes: text(10000),
});
export const CompanyOneOnOneSchema = z.strictObject({
  ...stamp,
  manager: CompanyStaffMemberDisplaySchema,
  employee: CompanyStaffMemberDisplaySchema,
  meetingAt: instant,
  notes: text(10000).nullable(),
  redactedAt: instant.nullable(),
});
export const CompanyOneOnOnePageSchema = page(CompanyOneOnOneSchema);
export const CompanyOneOnOneActionCreateSchema = z.strictObject({
  id,
  body: text(2000),
});
export const CompanyOneOnOneActionChangeSchema = z.strictObject({
  state: z.enum(['OPEN', 'DONE', 'CANCELED']),
});
export const CompanyOneOnOneActionSchema = z.strictObject({
  ...stamp,
  recordId: id,
  body: text(2000).nullable(),
  state: z.enum(['OPEN', 'DONE', 'CANCELED']),
});
export const CompanyOneOnOneActionPageSchema = page(
  CompanyOneOnOneActionSchema,
);
const window = { validFrom: instant, expiresAt: instant };
export const CompanyDelegationCreateSchema = z
  .strictObject({
    id,
    delegate: CompanyStaffMemberSchema,
    workflowVersionId: id,
    ...window,
  })
  .refine((v) => Date.parse(v.validFrom) < Date.parse(v.expiresAt));
export const CompanyDelegationSchema = z.strictObject({
  ...stamp,
  delegator: CompanyStaffMemberDisplaySchema,
  delegate: CompanyStaffMemberDisplaySchema,
  workflowVersionId: id,
  ...window,
  revokedAt: instant.nullable(),
});
export const CompanyDelegationPageSchema = page(CompanyDelegationSchema);
// Fixed administration/finance authority remains reserved; only approved read keys are delegable.
export const CompanyCustomCapabilitiesSchema = z
  .array(z.enum(['structure.read', 'directory.read']))
  .min(1)
  .max(2)
  .refine((v) => new Set(v).size === v.length);
export const CompanyCustomRoleInputSchema = z.strictObject({
  id,
  title: text(100),
  capabilities: CompanyCustomCapabilitiesSchema,
});
export const CompanyCustomRolePatchSchema = CompanyCustomRoleInputSchema.omit({
  id: true,
});
export const CompanyCustomRoleSchema = CompanyCustomRoleInputSchema.safeExtend({
  ...stamp,
  archivedAt: instant.nullable(),
});
export const CompanyCustomRolePageSchema = page(CompanyCustomRoleSchema);
export const CompanyRoleAssignmentInputSchema = z.strictObject({
  id,
  member: CompanyStaffMemberSchema,
});
export const CompanyRoleAssignmentSchema = z.strictObject({
  ...stamp,
  roleId: id,
  member: CompanyStaffMemberDisplaySchema,
  revokedAt: instant.nullable(),
});
export const CompanyTemporaryGrantInputSchema = z
  .strictObject({
    id,
    member: CompanyStaffMemberSchema,
    capabilities: CompanyCustomCapabilitiesSchema,
    ...window,
    reason: text(2000),
  })
  .refine((v) => Date.parse(v.validFrom) < Date.parse(v.expiresAt));
export const CompanyTemporaryGrantSchema = z.strictObject({
  ...stamp,
  member: CompanyStaffMemberDisplaySchema,
  capabilities: CompanyCustomCapabilitiesSchema,
  ...window,
  revokedAt: instant.nullable(),
  active: z.boolean(),
});
export const CompanyAccessReviewInputSchema = z.strictObject({
  id,
  member: CompanyStaffMemberSchema,
  decision: z.enum(['RETAIN', 'REVOKE']),
  reason: text(2000),
});
export const CompanyAccessReviewSchema = CompanyAccessReviewInputSchema.omit({
  reason: true,
}).extend({ ...stamp, member: CompanyStaffMemberDisplaySchema, actorId: id });
export const CompanyAccessReviewPageSchema = page(CompanyAccessReviewSchema);
export const CompanyAccessInventorySchema = z.strictObject({
  scopeId: id,
  members: z
    .array(
      z.strictObject({
        member: CompanyStaffMemberDisplaySchema,
        role: z.string(),
        source: z.literal('MEMBERSHIP'),
      }),
    )
    .max(1000),
  roles: z.array(CompanyCustomRoleSchema).max(1000),
  assignments: z.array(CompanyRoleAssignmentSchema).max(1000),
  temporary: z.array(CompanyTemporaryGrantSchema).max(1000),
  delegations: z.array(CompanyDelegationSchema).max(1000),
});
export const CompanyDepartmentAnalyticsSchema = z.strictObject({
  scopeId: id,
  from: instant,
  to: instant,
  snapshotAt: instant,
  goals: z.number().int().nonnegative(),
  kpiObservations: z.number().int().nonnegative(),
  approvalThroughput: z.strictObject({
    approved: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    canceled: z.number().int().nonnegative(),
  }),
  activeMembers: z.number().int().nonnegative(),
  units: z.number().int().nonnegative(),
  resources: z.number().int().nonnegative(),
  transfers: z.number().int().nonnegative(),
  reviewCompletion: z.strictObject({
    submitted: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  workEvidence: z.literal('UNKNOWN'),
  financeEvidence: z.literal('SEPARATE_AUTHORIZED_REPORT'),
  privateContentIncluded: z.literal(false),
});
export const CompanyRecoveryCaseInputSchema = z.strictObject({
  id,
  evidenceReference: text(200).nullable().default(null),
});
export const CompanyRecoveryCaseSchema = z.strictObject({
  ...stamp,
  state: z.enum(['POLICY_GATED', 'CANCELED']),
  policyVersion: text(80).nullable(),
  executable: z.literal(false),
});
export const CompanyRecoveryCasePageSchema = page(CompanyRecoveryCaseSchema);
export const CompanyRetentionReadinessSchema = z.strictObject({
  companyId: id,
  policyVersion: text(80),
  approvalRecorded: z.boolean(),
  sharedEnabled: z.boolean(),
  activationAuthorized: z.literal(false),
  holds: z.number().int().nonnegative().nullable(),
});
export const CompanySentInvitationSchema = z.strictObject({
  id,
  scopeId: id,
  memberRole: CompanyMemberRoleSchema,
  recipientEmail: z.email().nullable(),
  state: z.enum(['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'REVOKED']),
  revision,
  createdAt: instant,
  sentAt: instant,
  expiresAt: instant,
});
export const CompanySentInvitationPageSchema = page(
  CompanySentInvitationSchema,
);
const money = z.string().regex(/^(?:0|[1-9]\d{0,17})(?:\.\d{1,4})?$/);
export const CompanyApprovalTierSchema = z.strictObject({
  currency: z.string().regex(/^[A-Z]{3}$/),
  minimum: money,
  maximum: money.nullable(),
  categoryId: id.nullable(),
  workflowVersionId: id,
  escalateAfterSeconds: z.number().int().positive().max(2147483647).nullable(),
});
export const CompanyApprovalPolicyInputSchema = z
  .strictObject({
    id,
    kind: z.enum(['EXPENSE', 'REIMBURSEMENT', 'BUDGET_CHANGE']),
    effectiveFrom: instant,
    effectiveUntil: instant.nullable(),
    rules: z.array(CompanyApprovalTierSchema).min(1).max(100),
  })
  .refine(
    (v) =>
      v.effectiveUntil === null ||
      Date.parse(v.effectiveFrom) < Date.parse(v.effectiveUntil),
  );
export const CompanyApprovalPolicySchema =
  CompanyApprovalPolicyInputSchema.safeExtend({
    ...stamp,
    state: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
  });
export const CompanyApprovalPolicyPageSchema = page(
  CompanyApprovalPolicySchema,
);
export const CompanyApprovalPolicyChangeSchema = z.strictObject({
  state: z.enum(['PUBLISHED', 'ARCHIVED']),
});
export const CompanyApprovalTimelineEventSchema = z.strictObject({
  id,
  approvalId: id,
  requestId: id,
  requestType: z.enum(['EXPENSE', 'REIMBURSEMENT', 'BUDGET_CHANGE']),
  workflowVersionId: id,
  policyVersionId: id.nullable(),
  stepId: id.nullable(),
  actorId: id,
  delegationId: id.nullable(),
  reviewer: CompanyStaffMemberDisplaySchema.nullable(),
  action: z.string(),
  reason: z.string().nullable(),
  previousStatus: z.string().nullable(),
  resultingStatus: z.string().nullable(),
  createdAt: instant,
});
export const CompanyApprovalTimelinePageSchema = page(
  CompanyApprovalTimelineEventSchema,
);
export const CompanyBudgetAlertInputSchema = z.strictObject({
  id,
  budgetId: id,
  threshold: money,
  basis: z.enum(['SPENT', 'COMMITTED']),
});
export const CompanyBudgetAlertSchema = CompanyBudgetAlertInputSchema.extend({
  ...stamp,
  revokedAt: instant.nullable(),
  triggered: z.boolean(),
});
export const CompanyBudgetAlertPageSchema = page(CompanyBudgetAlertSchema);
export const CompanyRecoveryPolicyDraftInputSchema = z
  .strictObject({
    id,
    version: text(80),
    requiredApprovals: z.number().int().positive().max(100).nullable(),
    approvers: z.array(CompanyStaffMemberSchema).max(100),
    proofValiditySeconds: z.number().int().positive().nullable(),
    waitingSeconds: z.number().int().nonnegative().nullable(),
    approvalReference: text(200).nullable(),
  })
  .refine(
    (v) =>
      new Set(v.approvers.map((m) => m.accessId)).size === v.approvers.length &&
      (v.requiredApprovals === null ||
        v.requiredApprovals <= v.approvers.length),
  );
export const CompanyRecoveryPolicyDraftSchema =
  CompanyRecoveryPolicyDraftInputSchema.safeExtend({
    ...stamp,
    approvers: z.array(CompanyStaffMemberDisplaySchema).max(100),
    state: z.literal('DRAFT'),
    executable: z.literal(false),
  });
export const CompanyRecoveryPolicyDraftPageSchema = page(
  CompanyRecoveryPolicyDraftSchema,
);
export const CompanySensitiveAuditSchema = z.strictObject({
  id,
  actorId: id,
  action: z.string(),
  resourceId: id,
  requestId: id,
  occurredAt: instant,
});
export const CompanySensitiveAuditPageSchema = page(
  CompanySensitiveAuditSchema,
);
export const CompanyResourceUsageSchema = z.strictObject({
  from: instant,
  to: instant,
  items: z
    .array(
      z.strictObject({
        resourceId: id,
        bookedMilliseconds: z.number().int().nonnegative(),
        custodyMilliseconds: z.number().int().nonnegative(),
        occupancyBasisPoints: z.number().int().min(0).max(10000).nullable(),
        occupancyEvidence: z.enum(['OBSERVED', 'UNKNOWN']),
        custodyEvidence: z.enum(['OBSERVED', 'UNKNOWN']),
      }),
    )
    .max(1000),
});
export const CompanyApprovalActionStateSchema = z.strictObject({
  id,
  revision,
  state: z.enum(['ACTIVE', 'APPROVED', 'REJECTED', 'CANCELED']),
  currentStepId: id.nullable(),
  policyVersionId: id.nullable(),
  can: z.strictObject({
    approve: z.boolean(),
    reject: z.boolean(),
    escalate: z.boolean(),
    restart: z.boolean(),
  }),
});
export const CompanyEffectiveReadPermissionsSchema = z.strictObject({
  scopeId: id,
  capabilities: z.strictObject({
    'structure.read': z.boolean(),
    'directory.read': z.boolean(),
  }),
});

export const CompanyOwnerHandoverPageSchema = page(OwnerHandoverSchema);
