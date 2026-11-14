import { z } from 'zod';
import { CompanyPageQuerySchema } from './companies.js';
import { CompanyReportQuerySchema } from './company-knowledge.js';
import { CompanyStaffMemberDisplaySchema } from './company-staff.js';
import { CompanyMoneySchema } from './company-finance.js';
import { financeCurrencyScales } from './finance-currencies.js';
const uuid = z.uuid();
const positive = z.number().int().positive();
const instant = z.iso.datetime();
const text = (max: number) => z.string().trim().min(1).max(max);
const page = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    items: z.array(item).max(100),
    nextCursor: z.string().nullable(),
  });
const money = CompanyMoneySchema;

/** C-M1 (OD-9/F1): one fixed Company currency, locked by the first budget or expense version. */
export const CompanySettingsSchema = z.strictObject({
  companyId: uuid,
  currency: z.string().length(3).nullable(),
  scale: z.number().int().min(0).max(4).nullable(),
  currencyLocked: z.boolean(),
  /** LS (owner-approved): optional legal name and fiscal-year start month (1–12). */
  legalName: z.string().nullable().optional(),
  fiscalStartMonth: z.number().int().min(1).max(12).nullable().optional(),
  revision: positive,
});
export const CompanyCurrencyInputSchema = z.strictObject({
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .refine((v) => financeCurrencyScales[v] !== undefined, 'Unknown currency'),
});

/** C-M3: owner-approved public internal directory and work-contact fields only. */
export const CompanyWorkDetailsInputSchema = z
  .strictObject({
    workPhone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 ()./-]{3,40}$/)
      .nullable()
      .optional(),
    workLocation: text(200).nullable().optional(),
    workHours: text(200).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export const CompanyWorkDetailsSchema = z.strictObject({
  profileId: uuid,
  scopeId: uuid,
  workPhone: z.string().nullable(),
  workLocation: z.string().nullable(),
  workHours: z.string().nullable(),
  revision: positive,
});
export const CompanyDirectoryEntrySchema = z.strictObject({
  profileId: uuid,
  scopeId: uuid,
  member: CompanyStaffMemberDisplaySchema,
  position: z.string().nullable(),
  workStatus: z.enum(['ACTIVE', 'INACTIVE']),
  workEmail: z.email().nullable(),
  workPhone: z.string().nullable(),
  workLocation: z.string().nullable(),
  workHours: z.string().nullable(),
});
export const CompanyDirectoryPageSchema = page(CompanyDirectoryEntrySchema);

/** C-M4 (C4): manager-defined resource types and versioned role-based approval workflows. */
export const CompanyResourceTypeCreateSchema = z.strictObject({
  id: uuid,
  title: text(300),
});
export const CompanyResourceTypePatchSchema = z.strictObject({
  title: text(300),
});
export const CompanyResourceTypeSchema = CompanyResourceTypeCreateSchema.extend(
  {
    spaceId: uuid,
    scopeId: uuid,
    revision: positive,
    createdAt: instant,
    updatedAt: instant,
  },
);
export const CompanyResourceTypePageSchema = page(CompanyResourceTypeSchema);
export const CompanyResourceTypeAssignSchema = z.strictObject({
  typeId: uuid.nullable(),
});
export const CompanyApproverRoleSchema = z.enum([
  'OWNER',
  'ORG_ADMIN',
  'DEPT_MANAGER',
]);
export const CompanyResourceWorkflowStepSchema = z.strictObject({
  roles: z
    .array(CompanyApproverRoleSchema)
    .min(1)
    .max(3)
    .refine((v) => new Set(v).size === v.length, 'Duplicate role'),
});
const steps = z.array(CompanyResourceWorkflowStepSchema).min(1).max(10);
export const CompanyResourceWorkflowCreateSchema = z.strictObject({
  id: uuid,
  typeId: uuid,
  steps,
});
export const CompanyResourceWorkflowPatchSchema = z.strictObject({ steps });
export const CompanyResourceWorkflowSchema = z.strictObject({
  id: uuid,
  spaceId: uuid,
  scopeId: uuid,
  typeId: uuid,
  state: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
  steps,
  publishedAt: instant.nullable(),
  revision: positive,
  createdAt: instant,
  updatedAt: instant,
});
export const CompanyResourceWorkflowPageSchema = page(
  CompanyResourceWorkflowSchema,
);
export const CompanyResourceWorkflowQuerySchema = CompanyPageQuerySchema.extend(
  { typeId: uuid.optional() },
);
export const CompanyResourceRequestCreateSchema = z
  .strictObject({
    id: uuid,
    startAt: instant,
    endAt: instant,
    reason: z.string().trim().max(2000).nullable().default(null),
  })
  .refine(
    (v) => Date.parse(v.startAt) < Date.parse(v.endAt),
    'Request end must follow start',
  );
export const CompanyResourceRequestDecisionSchema = z
  .strictObject({
    decision: z.enum(['APPROVE', 'REJECT']),
    reason: z.string().trim().min(1).max(2000).nullable().default(null),
  })
  .refine(
    (v) => v.decision === 'APPROVE' || v.reason !== null,
    'A rejection requires a reason',
  );
export const CompanyResourceRequestSchema = z.strictObject({
  id: uuid,
  spaceId: uuid,
  scopeId: uuid,
  resourceId: uuid,
  workflowVersionId: uuid,
  requester: CompanyStaffMemberDisplaySchema,
  startAt: instant,
  endAt: instant,
  reason: z.string().nullable(),
  state: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN']),
  step: z.number().int().min(0).max(9),
  stepCount: z.number().int().min(1).max(10),
  pendingRoles: z.array(CompanyApproverRoleSchema),
  allocationId: uuid.nullable(),
  decidedAt: instant.nullable(),
  revision: positive,
  createdAt: instant,
  updatedAt: instant,
});
export const CompanyResourceRequestPageSchema = page(
  CompanyResourceRequestSchema,
);
export const CompanyResourceRequestQuerySchema = CompanyPageQuerySchema.extend({
  state: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN']).optional(),
});
export const CompanyResourceRequestEventSchema = z.strictObject({
  id: uuid,
  requestId: uuid,
  actorId: uuid,
  actorDisplayName: z.string().nullable().optional(),
  kind: z.enum(['SUBMIT', 'APPROVE', 'REJECT', 'WITHDRAW']),
  step: z.number().int().min(0).max(9).nullable(),
  reason: z.string().nullable(),
  createdAt: instant,
});
export const CompanyResourceRequestHistorySchema = z.strictObject({
  items: z.array(CompanyResourceRequestEventSchema).max(25),
});

/** C-M3 KPIs: explicit sources, numerators and denominators; null when unknown. */
const ratio = z.strictObject({
  numerator: z.number().int().nonnegative(),
  denominator: z.number().int().nonnegative(),
  basisPoints: z.number().int().nonnegative().nullable(),
});
export const CompanyKpiReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  spaceId: uuid,
  scopeId: uuid,
  generatedAt: instant,
  ...CompanyReportQuerySchema.shape,
  tasks: z.strictObject({
    source: z.literal('AUTHORIZED_PORTFOLIO_PROJECT_REPORTS'),
    projectCount: z.number().int().nonnegative(),
    completion: ratio,
    overdueTaskCount: z.number().int().nonnegative(),
    completedInWindow: z.number().int().nonnegative(),
  }),
  /** OD-2: measured goal progress for the context; null when the context has no goals. */
  goals: z
    .strictObject({
      source: z.literal('COMPANY_GOAL_KEY_RESULTS'),
      goalCount: z.number().int().nonnegative(),
      measuredGoals: z.number().int().nonnegative(),
      averageProgress: z.number().int().min(0).max(10000).nullable(),
    })
    .nullable(),
  capacity: z.strictObject({
    source: z.literal('EXPLICIT_COMPANY_AVAILABILITY_AND_PROJECT_ESTIMATES'),
    memberCount: z.number().int().nonnegative(),
    knownCapacityDays: z.number().int().nonnegative(),
    unknownCapacityDays: z.number().int().nonnegative(),
    availableMinutes: z.number().int().nonnegative(),
    estimatedMinutes: z.number().int().nonnegative(),
    unknownEstimates: z.number().int().nonnegative(),
  }),
  expenses: z.strictObject({
    source: z.literal('EFFECTIVE_APPROVED_EXPENSES_AND_ACTIVE_BUDGETS'),
    currency: z.string().length(3).nullable(),
    spent: money.nullable(),
    budgetCount: z.number().int().nonnegative(),
    budgetSpent: money.nullable(),
    budgetLimit: money.nullable(),
    usageBasisPoints: z.number().int().nonnegative().nullable(),
  }),
});

/** C-M4 (C3): association summaries with independently authorized source fields only. */
export const CompanyAssociationSummarySchema = z.strictObject({
  associationId: uuid,
  kind: z.enum(['PROJECT', 'TEAM']),
  sourceId: uuid,
  state: z.string(),
  source: z
    .strictObject({
      title: z.string(),
      lifecycleState: z.enum(['ACTIVE', 'ARCHIVED']),
      responsibleDisplayName: z.string().nullable(),
      memberCount: z.number().int().nonnegative(),
    })
    .nullable(),
});
export const CompanyAssociationSummaryPageSchema = page(
  CompanyAssociationSummarySchema,
);
export const CompanyAttachCandidateSchema = z.strictObject({
  kind: z.enum(['PROJECT', 'TEAM']),
  sourceId: uuid,
  title: z.string(),
});
export const CompanyAttachCandidatePageSchema = z.strictObject({
  items: z.array(CompanyAttachCandidateSchema).max(200),
});
