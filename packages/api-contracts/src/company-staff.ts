import { z } from 'zod';
import { CompanyPageQuerySchema } from './companies.js';
const uuid = z.uuid();
const positive = z.number().int().positive();
const instant = z.iso.datetime();
const text = (max: number) => z.string().trim().min(1).max(max);
export const CompanyStaffMemberSchema = z.strictObject({
  accessId: uuid,
  generation: positive,
});
export const CompanyStaffProfileCreateSchema = z.strictObject({
  id: uuid,
  member: CompanyStaffMemberSchema,
  position: text(300).nullable().default(null),
  supervisor: CompanyStaffMemberSchema.nullable().default(null),
  workStatus: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
});
export const CompanyStaffProfilePatchSchema = z
  .strictObject({
    position: text(300).nullable().optional(),
    supervisor: CompanyStaffMemberSchema.nullable().optional(),
    workStatus: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export const CompanyStaffProfileSchema = z.strictObject({
  id: uuid,
  spaceId: uuid,
  scopeId: uuid,
  member: CompanyStaffMemberSchema,
  position: text(300).nullable(),
  supervisor: CompanyStaffMemberSchema.nullable(),
  workStatus: z.enum(['ACTIVE', 'INACTIVE']),
  workEmail: z.email().nullable(),
  redactedAt: instant.nullable(),
  revision: positive,
  createdAt: instant,
  updatedAt: instant,
});
export const CompanyWorkContactSchema = z.strictObject({
  published: z.boolean(),
});
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
  }, 'Expected IANA timezone');
const minutes = z.number().int().min(0).max(1440).nullable();
export const CompanyAvailabilityCreateSchema = z.strictObject({
  id: uuid,
  member: CompanyStaffMemberSchema,
  date,
  timezone,
  availableMinutes: minutes,
});
export const CompanyAvailabilityPatchSchema = z.strictObject({
  availableMinutes: minutes,
});
export const CompanyAvailabilitySchema = CompanyAvailabilityCreateSchema.extend(
  {
    spaceId: uuid,
    scopeId: uuid,
    revision: positive,
    createdAt: instant,
    updatedAt: instant,
  },
);
export const CompanyResourceCreateSchema = z.strictObject({
  id: uuid,
  title: text(300),
  description: z.string().max(10000).nullable().default(null),
});
export const CompanyResourcePatchSchema = z
  .strictObject({
    title: text(300).optional(),
    description: z.string().max(10000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export const CompanyResourceSchema = CompanyResourceCreateSchema.extend({
  spaceId: uuid,
  scopeId: uuid,
  state: z.enum(['ACTIVE', 'RETIRED']),
  revision: positive,
  createdAt: instant,
  updatedAt: instant,
});
export const CompanyAllocationCreateSchema = z
  .strictObject({
    id: uuid,
    member: CompanyStaffMemberSchema,
    startAt: instant,
    endAt: instant,
  })
  .refine(
    (v) => Date.parse(v.startAt) < Date.parse(v.endAt),
    'Allocation end must follow start',
  );
export const CompanyAllocationSchema = z.strictObject({
  id: uuid,
  spaceId: uuid,
  scopeId: uuid,
  resourceId: uuid,
  member: CompanyStaffMemberSchema,
  startAt: instant,
  endAt: instant,
  state: z.enum(['ALLOCATED', 'CANCELED', 'RETURNED']),
  endedAt: instant.nullable(),
  revision: positive,
  createdAt: instant,
  updatedAt: instant,
});
export const CompanyEmployeeCaseCreateSchema = z.strictObject({
  id: uuid,
  subject: CompanyStaffMemberSchema,
  reviewer: CompanyStaffMemberSchema,
  reason: text(10000),
  evidence: z.string().max(10000),
});
export const CompanyEmployeeCaseSchema = z.strictObject({
  id: uuid,
  spaceId: uuid,
  scopeId: uuid,
  author: CompanyStaffMemberSchema,
  subject: CompanyStaffMemberSchema,
  reviewer: CompanyStaffMemberSchema,
  reason: text(10000).nullable(),
  evidence: z.string().max(10000).nullable(),
  state: z.enum(['OPEN', 'RESOLVED']),
  redactedAt: instant.nullable(),
  revision: positive,
  createdAt: instant,
  updatedAt: instant,
});
export const CompanyCaseEntryCreateSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    id: uuid,
    kind: z.literal('CORRECTION'),
    body: text(10000),
  }),
  z.strictObject({ id: uuid, kind: z.literal('RESPONSE'), body: text(10000) }),
  z.strictObject({ id: uuid, kind: z.literal('APPEAL'), body: text(10000) }),
  z.strictObject({
    id: uuid,
    kind: z.literal('REVIEW'),
    body: text(10000),
    state: z.enum(['OPEN', 'RESOLVED']),
  }),
]);
export const CompanyCaseEntrySchema = z.strictObject({
  id: uuid,
  caseId: uuid,
  kind: z.enum(['CORRECTION', 'RESPONSE', 'APPEAL', 'REVIEW']),
  body: text(10000).nullable(),
  createdByActorId: uuid,
  revision: positive,
  createdAt: instant,
  updatedAt: instant,
});
export const CompanyCaseEntryResultSchema = z.strictObject({
  entry: CompanyCaseEntrySchema,
  case: CompanyEmployeeCaseSchema,
});
const page = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    items: z.array(item).max(100),
    nextCursor: z.string().nullable(),
  });
export const CompanyStaffProfilePageSchema = page(CompanyStaffProfileSchema);
export const CompanyAvailabilityPageSchema = page(CompanyAvailabilitySchema);
export const CompanyResourcePageSchema = page(CompanyResourceSchema);
export const CompanyAllocationPageSchema = page(CompanyAllocationSchema);
export const CompanyEmployeeCasePageSchema = page(CompanyEmployeeCaseSchema);
export const CompanyCaseEntryPageSchema = page(CompanyCaseEntrySchema);
export const CompanyStaffPageQuerySchema = CompanyPageQuerySchema;
