import { z } from 'zod';
import { CompanyStaffPageQuerySchema } from './company-staff.js';
export const CompanyAssociationKindSchema = z.enum(['PROJECT', 'TEAM']);
export const CompanyAssociationCreateSchema = z.strictObject({
  id: z.uuid(),
  kind: CompanyAssociationKindSchema,
  sourceId: z.uuid(),
});
export const CompanyAssociationActionSchema = z.strictObject({
  side: z.enum(['SOURCE', 'COMPANY']).default('SOURCE'),
});
export const CompanyAssociationSchema = z.strictObject({
  id: z.uuid(),
  kind: CompanyAssociationKindSchema,
  sourceId: z.uuid(),
  companySpaceId: z.uuid(),
  companyScopeId: z.uuid(),
  state: z.enum([
    'PENDING',
    'ASSOCIATED',
    'ATTACH_PENDING',
    'ATTACHED',
    'REVOKED',
  ]),
  revision: z.number().int().positive(),
  expiresAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const CompanyAssociationQuerySchema = CompanyStaffPageQuerySchema;
export const CompanyAssociationPageSchema = z.strictObject({
  items: z.array(CompanyAssociationSchema),
  nextCursor: z.string().nullable(),
});
