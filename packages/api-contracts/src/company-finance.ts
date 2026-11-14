import { z } from 'zod';
import { financeCurrencyScales } from './finance-currencies.js';
import {
  CompanyStaffMemberSchema,
  CompanyStaffMemberDisplaySchema,
  CompanyStaffPageQuerySchema,
} from './company-staff.js';
import { FileUploadSchema } from './files.js';
const uuid = z.uuid(),
  text = z.string().trim().min(1).max(300),
  positive = z.number().int().positive();
const date = z.iso.date();
const timezone = z
  .string()
  .min(1)
  .max(100)
  .refine((v) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: v });
      return true;
    } catch {
      return false;
    }
  });
export const CompanyMoneySchema = z
  .string()
  .regex(/^(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,4})?$/);
const currency = z
  .string()
  .refine((v) => Object.hasOwn(financeCurrencyScales, v));
const money = { amount: CompanyMoneySchema, currency };
export const CompanyExpenseCategoryCreateSchema = z.strictObject({
  id: uuid,
  title: text,
});
export const CompanyExpenseCategoryPatchSchema = z
  .strictObject({ title: text.optional(), archived: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0);
const base = {
  id: uuid,
  spaceId: uuid,
  scopeId: uuid,
  revision: positive,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};
export const CompanyExpenseCategorySchema = z.strictObject({
  ...base,
  title: text,
  archived: z.boolean(),
});
export const CompanyFinanceProjectCreateSchema = z.strictObject({
  id: uuid,
  projectId: uuid,
});
export const CompanyFinanceProjectSchema = z.strictObject({
  ...base,
  project: z.strictObject({ id: uuid, title: text }).nullable(),
});
export const CompanyBudgetCreateSchema = z
  .strictObject({
    id: uuid,
    title: text,
    ...money,
    startDate: date,
    endDate: date,
    timezone,
    projectReferenceId: uuid.nullable().default(null),
  })
  .refine((v) => v.startDate < v.endDate);
export const CompanyBudgetChangeSchema = z.strictObject({
  amount: CompanyMoneySchema,
  direction: z.enum(['INCREASE', 'DECREASE']),
});
export const CompanyBudgetArchiveSchema = z.strictObject({
  archived: z.boolean(),
});
export const CompanyBudgetSchema = z.strictObject({
  ...base,
  title: text,
  currency,
  scale: z.number().int().min(0).max(4),
  limit: CompanyMoneySchema,
  spent: CompanyMoneySchema,
  reserved: CompanyMoneySchema,
  available: CompanyMoneySchema,
  startDate: date,
  endDate: date,
  timezone,
  projectReferenceId: uuid.nullable(),
  archived: z.boolean(),
});
export const CompanyCommitmentCreateSchema = z.strictObject({
  id: uuid,
  amount: CompanyMoneySchema,
});
export const CompanyCommitmentSchema = z.strictObject({
  ...base,
  budgetId: uuid,
  amount: CompanyMoneySchema,
  remaining: CompanyMoneySchema,
  state: z.enum(['ACTIVE', 'RELEASED']),
});
export const CompanyExpenseAllocationInputSchema = z.strictObject({
  budgetId: uuid,
  commitmentId: uuid.nullable().default(null),
  amount: CompanyMoneySchema,
});
export const CompanyExpenseFactsSchema = z.strictObject({
  ...money,
  categoryId: uuid,
  occurredDate: date,
  timezone,
  vendor: text.nullable().default(null),
  payer: CompanyStaffMemberSchema.nullable().default(null),
  projectReferenceId: uuid.nullable().default(null),
  allocations: z
    .array(CompanyExpenseAllocationInputSchema)
    .max(100)
    .default([]),
});
export const CompanyExpenseCreateSchema = CompanyExpenseFactsSchema.extend({
  id: uuid,
});
export const CompanyExpenseSubmitSchema = z.strictObject({
  reviewer: CompanyStaffMemberSchema,
});
/** ER (owner-approved): a rejection requires a nonempty reason, kept in authorized history. */
export const CompanyExpenseDecisionSchema = z
  .strictObject({
    decision: z.enum(['APPROVE', 'REJECT']),
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .refine((v) => v.decision === 'APPROVE' || v.reason !== undefined, {
    message: 'A rejection requires a reason',
  });
export const CompanyExpenseRevisionSchema = z.strictObject({
  ...base,
  expenseId: uuid,
  number: positive,
  kind: z.enum(['ORIGINAL', 'CORRECTION', 'REVERSAL']),
  state: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELED']),
  requester: CompanyStaffMemberDisplaySchema,
  reviewer: CompanyStaffMemberDisplaySchema.nullable(),
  payer: CompanyStaffMemberDisplaySchema.nullable(),
  ...money,
  scale: z.number().int().min(0).max(4),
  categoryId: uuid,
  occurredDate: date,
  timezone,
  vendor: text.nullable(),
  projectReferenceId: uuid.nullable(),
  allocations: z.array(CompanyExpenseAllocationInputSchema),
  submittedAt: z.iso.datetime().nullable(),
  decidedAt: z.iso.datetime().nullable(),
});
export const CompanyExpenseSchema = z.strictObject({
  ...base,
  state: z.enum(['PENDING', 'APPROVED', 'REVERSED']),
  effectiveVersionId: uuid.nullable(),
  current: CompanyExpenseRevisionSchema,
});
export const CompanyExpenseReceiptCreateSchema = FileUploadSchema.extend({
  id: uuid,
  expectedSize: z.number().int().positive().max(10485760),
  mimeType: z.enum(['application/pdf', 'image/png', 'image/jpeg']),
});
export const CompanyExpenseReceiptSchema = z.strictObject({
  ...base,
  versionId: uuid,
  fileId: uuid,
  filename: z.string(),
  mimeType: z.string(),
  expectedSize: positive,
  actualSize: positive.nullable(),
  status: z.enum(['INITIATED', 'READY', 'REJECTED', 'DELETED']),
  sha256: z.string().nullable(),
  pinnedRevision: positive.nullable(),
  pinnedHash: z.string().nullable(),
});
export const CompanyFinancePageQuerySchema = CompanyStaffPageQuerySchema;
const page = <T extends z.ZodType>(item: T) =>
  z.strictObject({ items: z.array(item), nextCursor: z.string().nullable() });
export const CompanyExpenseCategoryPageSchema = page(
  CompanyExpenseCategorySchema,
);
export const CompanyFinanceProjectPageSchema = page(
  CompanyFinanceProjectSchema,
);
export const CompanyBudgetPageSchema = page(CompanyBudgetSchema);
export const CompanyCommitmentPageSchema = page(CompanyCommitmentSchema);
export const CompanyExpensePageSchema = page(CompanyExpenseSchema);
export const CompanyExpenseRevisionPageSchema = page(
  CompanyExpenseRevisionSchema,
);
export const CompanyExpenseReceiptPageSchema = page(
  CompanyExpenseReceiptSchema,
);

export const CompanyReceiptCleanupSchema = z.strictObject({
  cleaned: z.number().int().nonnegative(),
});
