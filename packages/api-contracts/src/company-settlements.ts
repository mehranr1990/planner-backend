import { z } from 'zod';
import {
  CompanyStaffMemberSchema,
  CompanyStaffMemberDisplaySchema,
} from './company-staff.js';
import {
  CompanyMoneySchema,
  CompanyFinancePageQuerySchema,
} from './company-finance.js';
const uuid = z.uuid(),
  positive = z.number().int().positive(),
  title = z.string().trim().min(1).max(300);
const base = {
  id: uuid,
  spaceId: uuid,
  scopeId: uuid,
  revision: positive,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};
export const CompanyFinancialWorkflowKindSchema = z.enum([
  'EXPENSE',
  'REIMBURSEMENT',
]);
export const CompanyFinancialWorkflowCreateSchema = z.strictObject({
  id: uuid,
  title,
  kind: CompanyFinancialWorkflowKindSchema,
});
export const CompanyFinancialWorkflowSchema = z.strictObject({
  ...base,
  title,
  kind: CompanyFinancialWorkflowKindSchema,
});
export const CompanyFinancialWorkflowStepInputSchema = z.strictObject({
  label: z.string().trim().min(1).max(100),
  primary: CompanyStaffMemberSchema,
  alternate: CompanyStaffMemberSchema.nullable().default(null),
});
export const CompanyFinancialWorkflowVersionInputSchema = z.strictObject({
  title,
  steps: z.array(CompanyFinancialWorkflowStepInputSchema).min(1).max(5),
});
export const CompanyFinancialWorkflowVersionCreateSchema =
  CompanyFinancialWorkflowVersionInputSchema.extend({ id: uuid });
export const CompanyFinancialWorkflowVersionSchema = z.strictObject({
  ...base,
  workflowId: uuid,
  number: positive,
  title,
  state: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
  steps: z.array(
    CompanyFinancialWorkflowStepInputSchema.extend({
      primary: CompanyStaffMemberDisplaySchema,
      alternate: CompanyStaffMemberDisplaySchema.nullable(),
      id: uuid,
      position: z.number().int().nonnegative(),
    }),
  ),
});
export const CompanyFinancialWorkflowBindSchema = z.strictObject({
  workflowVersionId: uuid,
});
/** ER/AT (owner-approved): a rejection requires a nonempty reason, kept in authorized history. */
export const CompanyFinancialApprovalDecisionSchema = z
  .strictObject({
    decision: z.enum(['APPROVE', 'REJECT']),
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .refine((v) => v.decision === 'APPROVE' || v.reason !== undefined, {
    message: 'A rejection requires a reason',
  });
export const CompanyFinancialApprovalSchema = z.strictObject({
  ...base,
  workflowVersionId: uuid,
  expenseVersionId: uuid.nullable(),
  reimbursementId: uuid.nullable(),
  requester: CompanyStaffMemberDisplaySchema,
  beneficiary: CompanyStaffMemberDisplaySchema.nullable(),
  attempt: positive,
  state: z.enum(['ACTIVE', 'APPROVED', 'REJECTED', 'CANCELED']),
  stepIndex: z.number().int().nonnegative(),
  escalated: z.boolean(),
  sourceRevision: positive,
});
export const CompanyFinancialApprovalEventSchema = z.strictObject({
  ...base,
  approvalId: uuid,
  stepId: uuid.nullable(),
  action: z.enum([
    'SUBMIT',
    'APPROVE',
    'REJECT',
    'ESCALATE',
    'RESTART',
    'CANCEL',
  ]),
  createdByActorId: uuid,
  createdByDisplayName: z.string().nullable().optional(),
  reviewer: CompanyStaffMemberDisplaySchema.nullable(),
  /** Decision reason; null when none was given or it was erased. */
  reason: z.string().nullable().optional(),
});
export const CompanyReimbursementCreateSchema = z.strictObject({
  id: uuid,
  expenseId: uuid,
  amount: CompanyMoneySchema,
});
export const CompanyReimbursementPatchSchema = z.strictObject({
  amount: CompanyMoneySchema,
});
export const CompanyReimbursementSchema = z.strictObject({
  ...base,
  bucketId: uuid,
  expenseVersionId: uuid,
  beneficiary: CompanyStaffMemberDisplaySchema,
  amount: CompanyMoneySchema,
  currency: z.string().length(3),
  scale: z.number().int().min(0).max(4),
  state: z.enum([
    'DRAFT',
    'SUBMITTED',
    'APPROVED',
    'REJECTED',
    'CANCELED',
    'CLOSED',
    'INVALIDATED',
  ]),
  reserved: CompanyMoneySchema,
  acknowledged: CompanyMoneySchema,
  pending: CompanyMoneySchema,
  settlement: z.enum(['UNACKNOWLEDGED', 'PARTIAL', 'FULL']),
});
export const CompanyPaymentAcknowledgementCreateSchema = z.strictObject({
  id: uuid,
  amount: CompanyMoneySchema,
  reference: title.nullable().default(null),
});
export const CompanyPaymentAcknowledgementSchema = z.strictObject({
  ...base,
  requestId: uuid,
  bucketId: uuid,
  author: CompanyStaffMemberDisplaySchema,
  amount: CompanyMoneySchema,
  reference: title.nullable(),
  state: z.enum([
    'PROPOSED',
    'ACKNOWLEDGED',
    'DISPUTED',
    'CANCELED',
    'INVALIDATED',
  ]),
});
export const CompanyPaymentAcknowledgementDecisionSchema = z.strictObject({
  decision: z.enum(['ACKNOWLEDGE', 'DISPUTE']),
});
export const CompanyAcknowledgementCorrectionCreateSchema = z.strictObject({
  id: uuid,
  amount: CompanyMoneySchema,
  reason: z.string().trim().min(1).max(1000),
});
export const CompanyAcknowledgementCorrectionSchema = z.strictObject({
  ...base,
  paymentId: uuid,
  requestId: uuid,
  bucketId: uuid,
  author: CompanyStaffMemberDisplaySchema,
  amount: CompanyMoneySchema,
  reason: z.string().min(1).max(1000),
  state: z.enum(['PROPOSED', 'ACKNOWLEDGED', 'DECLINED', 'CANCELED']),
});
export const CompanyAcknowledgementCorrectionDecisionSchema = z.strictObject({
  decision: z.enum(['ACKNOWLEDGE', 'DECLINE']),
});
const signed = z.string().regex(/^-?(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,4})?$/);
export const CompanyReimbursementEffectSchema = z.strictObject({
  ...base,
  bucketId: uuid,
  requestId: uuid.nullable(),
  paymentId: uuid.nullable(),
  correctionId: uuid.nullable(),
  sourceVersionId: uuid.nullable(),
  kind: z.enum([
    'INITIAL',
    'APPROVAL',
    'PROPOSE',
    'ACKNOWLEDGE',
    'DISPUTE',
    'CANCEL',
    'CLOSE',
    'CORRECTION',
    'SUPERSEDE',
  ]),
  entitlement: signed,
  reserved: signed,
  acknowledged: signed,
  pending: signed,
  createdByActorId: uuid,
  createdByDisplayName: z.string().nullable().optional(),
});
export const CompanyReimbursementBalanceSchema = z.strictObject({
  ...base,
  expenseId: uuid,
  beneficiaryActorId: uuid,
  beneficiaryDisplayName: z.string().nullable().optional(),
  currency: z.string().length(3),
  scale: z.number().int().min(0).max(4),
  entitlement: CompanyMoneySchema,
  reserved: CompanyMoneySchema,
  acknowledged: CompanyMoneySchema,
  pending: CompanyMoneySchema,
  available: CompanyMoneySchema,
  excess: CompanyMoneySchema,
  reconciliationRequired: z.boolean(),
});
const page = <T extends z.ZodType>(item: T) =>
  z.strictObject({ items: z.array(item), nextCursor: z.string().nullable() });
export const CompanySettlementPageQuerySchema = CompanyFinancePageQuerySchema;
export const CompanyFinancialWorkflowPageSchema = page(
  CompanyFinancialWorkflowSchema,
);
export const CompanyFinancialWorkflowVersionPageSchema = page(
  CompanyFinancialWorkflowVersionSchema,
);
export const CompanyFinancialApprovalPageSchema = page(
  CompanyFinancialApprovalSchema,
);
export const CompanyFinancialApprovalEventPageSchema = page(
  CompanyFinancialApprovalEventSchema,
);
export const CompanyReimbursementPageSchema = page(CompanyReimbursementSchema);
export const CompanyPaymentAcknowledgementPageSchema = page(
  CompanyPaymentAcknowledgementSchema,
);
export const CompanyAcknowledgementCorrectionPageSchema = page(
  CompanyAcknowledgementCorrectionSchema,
);
export const CompanyReimbursementEffectPageSchema = page(
  CompanyReimbursementEffectSchema,
);
export const CompanyReimbursementBalancePageSchema = page(
  CompanyReimbursementBalanceSchema,
);
