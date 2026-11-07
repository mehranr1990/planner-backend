import { z } from 'zod';
import { ProjectPageQuerySchema } from './projects.js';
import { InvitationCreateSchema } from './collaboration.js';
export const CompanyRoleSchema = z.enum([
  'OWNER',
  'ORG_ADMIN',
  'DEPT_MANAGER',
  'TEAM_LEAD',
  'MEMBER',
  'VIEWER',
]);
export const CompanyMemberRoleSchema = z.enum([
  'ORG_ADMIN',
  'DEPT_MANAGER',
  'TEAM_LEAD',
  'MEMBER',
  'VIEWER',
]);
const id = z.uuid(),
  revision = z.number().int().positive().max(2147483646),
  title = z.string().trim().min(1).max(300),
  description = z.string().max(10000).nullable();
export const CompanyCreateSchema = z.strictObject({
  id,
  title,
  description: description.optional(),
  retentionPolicyVersion: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/),
});
export const CompanyPatchSchema = z
  .strictObject({
    title: title.optional(),
    description: description.optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export const CompanySchema = z.strictObject({
  id,
  spaceId: id,
  scopeId: id,
  title,
  description,
  revision,
  state: z.enum(['ACTIVE', 'ARCHIVED']),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const CompanyPageQuerySchema = ProjectPageQuerySchema;
export const CompanyPageSchema = z.strictObject({
  items: z.array(CompanySchema),
  nextCursor: z.string().nullable(),
});
export const CompanyContextCreateSchema = z.strictObject({
  id,
  title,
  description: description.optional(),
});
export const CompanyContextSchema = z.strictObject({
  id,
  spaceId: id,
  scopeId: id,
  kind: z.enum(['DEPARTMENT', 'UNIT']),
  departmentId: id.nullable(),
  title,
  description,
  revision,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const CompanyContextPageSchema = z.strictObject({
  items: z.array(CompanyContextSchema),
  nextCursor: z.string().nullable(),
});
export const CompanyMembershipSchema = z.strictObject({
  id,
  spaceId: id,
  scopeId: id,
  actorId: id,
  memberRole: CompanyMemberRoleSchema,
  state: z.enum(['ACTIVE', 'SUSPENDED', 'LEFT', 'REVOKED', 'ERASED']),
  generation: revision,
  revision,
  role: CompanyRoleSchema,
});
export const CompanyMembershipPageSchema = z.strictObject({
  items: z.array(CompanyMembershipSchema),
  nextCursor: z.string().nullable(),
});
export const CompanyMembershipChangeSchema = z.strictObject({
  memberRole: CompanyMemberRoleSchema,
  state: z.enum(['ACTIVE', 'SUSPENDED', 'REVOKED']),
});
export const CompanyInvitationCreateSchema = z.strictObject({
  memberRole: CompanyMemberRoleSchema,
  recipient: InvitationCreateSchema.shape.recipient,
});
export const CompanyInvitationSchema = z.strictObject({
  id,
  spaceId: id,
  scopeId: id,
  memberRole: CompanyMemberRoleSchema,
  state: z.enum(['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'REVOKED']),
  revision,
  expiresAt: z.iso.datetime(),
});
export const CompanyInvitationDeliverySchema = z.strictObject({
  invitation: CompanyInvitationSchema,
  proof: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .nullable(),
});
export const CompanyInvitationDecisionSchema = z.strictObject({
  invitation: CompanyInvitationSchema,
  membership: CompanyMembershipSchema.nullable(),
});
export const CompanyInvitationPreviewSchema = z.strictObject({
  companyId: id,
  title,
  kind: z.literal('MEMBERSHIP'),
  expiresAt: z.iso.datetime(),
});
export const CompanyLeaveResultSchema = z.strictObject({ id, revision });
export const CompanyPolicyRuleSchema = z
  .strictObject({
    key: z.enum(['structure.read', 'directory.read']),
    mode: z.enum(['MANDATORY', 'DEFAULT', 'OPTIONAL']),
    roles: z
      .array(CompanyRoleSchema)
      .max(6)
      .refine((v) => new Set(v).size === v.length),
    overrideDefault: z.boolean().default(false),
  })
  .refine((v) => !v.overrideDefault || v.mode === 'DEFAULT');
export const CompanyPolicyPublishSchema = z.strictObject({
  rules: z
    .array(CompanyPolicyRuleSchema)
    .max(2)
    .refine((v) => new Set(v.map((r) => r.key)).size === v.length),
});
export const CompanyPolicySchema = z.strictObject({
  spaceId: id,
  scopeId: id,
  version: revision,
  rules: CompanyPolicyPublishSchema.shape.rules,
});
export const CompanyEffectivePolicySchema = z.strictObject({
  scopeId: id,
  version: revision,
  chain: z.array(CompanyPolicySchema).min(1).max(3),
});
