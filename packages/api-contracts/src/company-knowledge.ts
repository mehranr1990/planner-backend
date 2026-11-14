import { z } from 'zod';
import { CompanyStaffPageQuerySchema } from './company-staff.js';
import { FileUploadSchema } from './files.js';
import { ProjectReportSchema } from './project-execution.js';
import { CompanyAvailabilitySchema } from './company-staff.js';
import { CompanyBudgetSchema, CompanyMoneySchema } from './company-finance.js';
const uuid = z.uuid(),
  title = z.string().trim().min(1).max(300),
  description = z.string().max(10000).nullable();
const base = {
  id: uuid,
  spaceId: uuid,
  scopeId: uuid,
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};
export const CompanyKnowledgeFolderCreateSchema = z.strictObject({
  id: uuid,
  parentId: uuid.nullable().default(null),
  title,
});
export const CompanyKnowledgeFolderPatchSchema = z
  .strictObject({ title: title.optional(), archived: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0);
export const CompanyKnowledgeFolderSchema = z.strictObject({
  ...base,
  parentId: uuid.nullable(),
  title,
  archived: z.boolean(),
});
export const CompanyKnowledgeDocumentCreateSchema = z.strictObject({
  id: uuid,
  folderId: uuid,
  title,
  description: description.default(null),
});
export const CompanyKnowledgeDocumentPatchSchema = z
  .strictObject({
    title: title.optional(),
    description: description.optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export const CompanyKnowledgeDocumentSchema = z.strictObject({
  ...base,
  folderId: uuid,
  title,
  description,
  archived: z.boolean(),
  publishedVersionId: uuid.nullable(),
});
export const CompanyKnowledgeVersionCreateSchema = FileUploadSchema.extend({
  id: uuid,
});
export const CompanyKnowledgeVersionSchema = z.strictObject({
  ...base,
  documentId: uuid,
  fileId: uuid,
  title,
  description,
  publishedAt: z.iso.datetime().nullable(),
  pinnedRevision: z.number().int().positive().nullable(),
  pinnedHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  filename: z.string(),
  mimeType: z.string(),
  expectedSize: z.number().int().positive(),
  actualSize: z.number().int().positive().nullable(),
  status: z.enum(['INITIATED', 'READY', 'REJECTED', 'DELETED']),
  sha256: z.string().nullable(),
});
export const CompanyKnowledgeQuerySchema = CompanyStaffPageQuerySchema.extend({
  search: z.string().trim().min(1).max(300).optional(),
  folderId: uuid.optional(),
});
export const CompanyKnowledgeFolderPageSchema = z.strictObject({
  items: z.array(CompanyKnowledgeFolderSchema),
  nextCursor: z.string().nullable(),
});
export const CompanyKnowledgeDocumentPageSchema = z.strictObject({
  items: z.array(CompanyKnowledgeDocumentSchema),
  nextCursor: z.string().nullable(),
});
export const CompanyKnowledgeVersionPageSchema = z.strictObject({
  items: z.array(CompanyKnowledgeVersionSchema),
  nextCursor: z.string().nullable(),
});
export const CompanyReportQuerySchema = z
  .strictObject({
    fromDate: z.iso.date(),
    toDate: z.iso.date(),
    timezone: CompanyAvailabilitySchema.shape.timezone,
  })
  .refine(
    (v) =>
      v.fromDate < v.toDate &&
      Date.parse(v.toDate) - Date.parse(v.fromDate) <= 93 * 86400000,
  );
export const CompanyOperationsReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  spaceId: uuid,
  scopeId: uuid,
  generatedAt: z.iso.datetime(),
  ...CompanyReportQuerySchema.shape,
  basis: z.literal('CURRENT_ADMISSIONS_AND_EXPLICIT_COMPANY_PLANNING'),
  memberCount: z.number().int().nonnegative(),
  profileCount: z.number().int().nonnegative(),
  knownCapacityDays: z.number().int().nonnegative(),
  unknownCapacityDays: z.number().int().nonnegative(),
  availableMinutes: z.number().int().nonnegative(),
  resourceCount: z.number().int().nonnegative(),
  activeAllocationCount: z.number().int().nonnegative(),
});
export const CompanyFinanceReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  spaceId: uuid,
  scopeId: uuid,
  generatedAt: z.iso.datetime(),
  ...CompanyReportQuerySchema.shape,
  basis: z.literal(
    'EFFECTIVE_APPROVED_EXPENSES_BY_STORED_CIVIL_DATE_AND_TIMEZONE',
  ),
  currencies: z.array(
    z.strictObject({
      currency: z.string(),
      scale: z.number().int().min(0).max(4),
      expenseCount: z.number().int().nonnegative(),
      spent: CompanyMoneySchema,
      reimbursementEntitlement: CompanyMoneySchema,
      acknowledged: CompanyMoneySchema,
      reserved: CompanyMoneySchema,
    }),
  ),
  budgets: z.array(
    CompanyBudgetSchema.extend({ variance: CompanyMoneySchema }),
  ),
});
export const CompanyPortfolioReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  spaceId: uuid,
  scopeId: uuid,
  generatedAt: z.iso.datetime(),
  ...CompanyReportQuerySchema.shape,
  basis: z.literal('EXISTING_FINANCIAL_ANCHORS_AND_CURRENT_SOURCE_AUTHORITY'),
  projects: z.array(
    z.strictObject({
      referenceId: uuid,
      projectId: uuid,
      title,
      report: ProjectReportSchema,
    }),
  ),
});
export const CompanyAuditQuerySchema = CompanyStaffPageQuerySchema;
export const CompanyAuditEventSchema = z.strictObject({
  actorDisplayName: z.string().nullable().optional(),
  id: uuid,
  actorId: uuid,
  action: z.string(),
  resourceId: uuid.nullable(),
  occurredAt: z.iso.datetime(),
});
export const CompanyAuditPageSchema = z.strictObject({
  items: z.array(CompanyAuditEventSchema),
  nextCursor: z.string().nullable(),
});
export const CompanyExportInputSchema = CompanyReportQuerySchema.safeExtend({
  dataset: z.enum(['KNOWLEDGE', 'OPERATIONS', 'FINANCE', 'PORTFOLIO', 'AUDIT']),
  format: z.enum(['JSON', 'CSV']),
});
export const CompanyExportPublicationSchema = z.strictObject({
  id: uuid,
  scopeId: uuid,
  state: z.literal('PUBLISHED'),
  publishedAt: z.iso.datetime(),
  downloadAvailable: z.literal(false),
});
export const CompanyExportPublicationPageSchema = z.strictObject({
  items: z.array(CompanyExportPublicationSchema).max(100),
  nextCursor: z.string().nullable(),
});
const exportHeader = z.strictObject({
  schemaVersion: z.literal(1),
  spaceId: uuid,
  scopeId: uuid,
  generatedAt: z.iso.datetime(),
  ...CompanyReportQuerySchema.shape,
});
export const CompanyExportJsonSchema = z.discriminatedUnion('dataset', [
  z.strictObject({
    schemaVersion: z.literal(1),
    dataset: z.literal('OPERATIONS'),
    data: CompanyOperationsReportSchema,
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    dataset: z.literal('FINANCE'),
    data: CompanyFinanceReportSchema,
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    dataset: z.literal('PORTFOLIO'),
    data: CompanyPortfolioReportSchema.omit({ basis: true }),
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    dataset: z.literal('AUDIT'),
    data: exportHeader.extend({
      items: z.array(CompanyAuditEventSchema).max(10000),
    }),
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    dataset: z.literal('KNOWLEDGE'),
    data: exportHeader.extend({
      items: z
        .array(
          z.strictObject({
            id: uuid,
            folderId: uuid,
            versionId: uuid,
            title,
            description,
            filename: z.string(),
            mimeType: z.string(),
            size: z.number().nullable(),
            sha256: z.string().nullable(),
            publishedAt: z.iso.datetime(),
          }),
        )
        .max(10000),
    }),
  }),
]);

export const CompanyKnowledgePublishSchema = z.strictObject({
  documentRevision: z.number().int().positive(),
});

export const CompanyKnowledgeFolderQuerySchema =
  CompanyStaffPageQuerySchema.extend({
    search: z.string().trim().min(1).max(300).optional(),
  });
