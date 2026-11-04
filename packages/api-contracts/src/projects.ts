import { z } from 'zod';
import { GoalStatusSchema } from './goals.js';
import { SharedMembershipSchema } from './collaboration.js';
const title = z.string().trim().min(1).max(300),
  description = z.string().max(10000).nullable();
export const ProjectCreateSchema = z.strictObject({
  id: z.uuid(),
  title,
  description: description.optional(),
  retentionPolicyVersion: z.string().min(1).max(100),
});
export const ProjectPatchSchema = z
  .strictObject({
    title: title.optional(),
    description: description.optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export const ProjectSchema = z.strictObject({
  id: z.uuid(),
  spaceId: z.uuid(),
  scopeId: z.uuid(),
  title,
  description,
  revision: z.number().int().positive(),
  state: z.enum([
    'ACTIVE',
    'ARCHIVED',
    'OWNER_EXIT_FROZEN',
    'CLOSING_GRACE',
    'CLOSED',
  ]),
  association: z.strictObject({ kind: z.literal('INDEPENDENT') }),
  createdByActorId: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const ProjectPageQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  after: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
});
export const ProjectPageSchema = z.strictObject({
  items: z.array(ProjectSchema),
  nextCursor: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^[A-Za-z0-9_-]+$/)
    .nullable(),
});
export const ProjectComponentKindSchema = z.enum([
  'phases',
  'sections',
  'milestones',
]);
export const ProjectComponentCreateSchema = z.strictObject({
  id: z.uuid(),
  title,
  position: z.number().int().nonnegative().max(1000000).default(0),
  phaseId: z.uuid().nullable().optional(),
  targetDate: z.iso.date().nullable().optional(),
});
export const ProjectComponentPatchSchema = z
  .strictObject({
    title: title.optional(),
    position: z.number().int().nonnegative().max(1000000).optional(),
    phaseId: z.uuid().nullable().optional(),
    targetDate: z.iso.date().nullable().optional(),
    completed: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export const ProjectComponentSchema = z.strictObject({
  id: z.uuid(),
  projectId: z.uuid(),
  kind: ProjectComponentKindSchema,
  title,
  position: z.number().int().nonnegative(),
  revision: z.number().int().positive(),
  phaseId: z.uuid().nullable(),
  targetDate: z.iso.date().nullable(),
  completed: z.boolean().nullable(),
});
export const ProjectComponentPageSchema = z.strictObject({
  items: z.array(ProjectComponentSchema),
  nextCursor: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^[A-Za-z0-9_-]+$/)
    .nullable(),
});
export const ProjectTaskCreateSchema = z.strictObject({
  id: z.uuid(),
  title,
  description: description.optional(),
  priority: z.enum(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('NONE'),
  sectionId: z.uuid().nullable().optional(),
  milestoneId: z.uuid().nullable().optional(),
});
export const ProjectTaskPatchSchema = z
  .strictObject({
    title: title.optional(),
    description: description.optional(),
    priority: z.enum(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
    status: z.enum(['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELED']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export const SharedTaskSchema = z.strictObject({
  id: z.uuid(),
  spaceId: z.uuid(),
  scopeId: z.uuid(),
  createdByActorId: z.uuid(),
  title,
  description,
  status: z.enum(['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELED']),
  priority: z.enum(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  revision: z.number().int().positive(),
  deletedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
});
export const SharedTaskPageSchema = z.strictObject({
  items: z.array(SharedTaskSchema),
  nextCursor: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^[A-Za-z0-9_-]+$/)
    .nullable(),
});
export const ProjectGoalCreateSchema = z.strictObject({
  id: z.uuid(),
  title,
  horizon: z.enum(['SHORT_TERM', 'LONG_TERM']),
  description: description.optional(),
  milestoneId: z.uuid().nullable().optional(),
  timezone: z
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
    }),
});
export const ProjectGoalPatchSchema = z
  .strictObject({
    title: title.optional(),
    horizon: z.enum(['SHORT_TERM', 'LONG_TERM']).optional(),
    description: description.optional(),
    status: GoalStatusSchema.optional(),
    manualProgress: z
      .string()
      .regex(/^(?:100(?:\.0{1,6})?|[0-9]{1,2}(?:\.[0-9]{1,6})?)$/)
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export const SharedGoalSchema = z.strictObject({
  id: z.uuid(),
  spaceId: z.uuid(),
  scopeId: z.uuid(),
  createdByActorId: z.uuid(),
  title,
  horizon: z.enum(['SHORT_TERM', 'LONG_TERM']),
  description,
  status: GoalStatusSchema,
  revision: z.number().int().positive(),
  manualProgress: z.string(),
  timezone: z.string(),
});
export const SharedGoalPageSchema = z.strictObject({
  items: z.array(SharedGoalSchema),
  nextCursor: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^[A-Za-z0-9_-]+$/)
    .nullable(),
});
export const ProjectTaskAssociationSchema = z.strictObject({
  sectionId: z.uuid().nullable(),
  milestoneId: z.uuid().nullable(),
});
export const ProjectGoalAssociationSchema = z.strictObject({
  milestoneId: z.uuid().nullable(),
});
export const ProjectAssociationResultSchema = z.strictObject({
  id: z.uuid(),
  projectId: z.uuid(),
  revision: z.number().int().positive(),
});
export const ProjectTaskAssociationViewSchema =
  ProjectTaskAssociationSchema.extend({
    id: z.uuid(),
    projectId: z.uuid(),
    revision: z.number().int().positive(),
  });
export const ProjectGoalAssociationViewSchema =
  ProjectGoalAssociationSchema.extend({
    id: z.uuid(),
    projectId: z.uuid(),
    revision: z.number().int().positive(),
  });
export const ProjectMemberAssignmentCreateSchema = z.strictObject({
  id: z.uuid(),
  accessId: z.uuid(),
  target: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('PHASE'), id: z.uuid() }),
    z.strictObject({ kind: z.literal('SECTION'), id: z.uuid() }),
    z.strictObject({ kind: z.literal('MILESTONE'), id: z.uuid() }),
  ]),
});
export const ProjectMemberAssignmentSchema = z.strictObject({
  id: z.uuid(),
  projectId: z.uuid(),
  accessId: z.uuid(),
  generation: z.number().int().positive(),
  revision: z.number().int().positive(),
  target: z.strictObject({
    kind: z.enum(['PHASE', 'SECTION', 'MILESTONE']),
    id: z.uuid(),
  }),
  revokedAt: z.iso.datetime().nullable(),
});
export const ProjectMemberAssignmentPageSchema = z.strictObject({
  items: z.array(ProjectMemberAssignmentSchema),
  nextCursor: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^[A-Za-z0-9_-]+$/)
    .nullable(),
});
export const ResourceTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('PROJECT'), id: z.uuid() }),
  z.strictObject({ kind: z.literal('TASK'), id: z.uuid() }),
  z.strictObject({ kind: z.literal('GOAL'), id: z.uuid() }),
]);
export const GrantOfferCreateSchema = z
  .strictObject({
    id: z.uuid(),
    recipientUserId: z.uuid(),
    target: ResourceTargetSchema,
    capabilities: z
      .array(z.enum(['read', 'update', 'complete']))
      .min(1)
      .max(3)
      .refine((v) => new Set(v).size === v.length),
    grantExpiresAt: z.iso.datetime(),
  })
  .refine(
    (v) =>
      v.capabilities.includes('read') &&
      (v.target.kind === 'TASK' ||
        v.capabilities.every(
          (c) => c === 'read' || (v.target.kind === 'GOAL' && c === 'update'),
        )),
  );
export const GrantOfferSchema = z.strictObject({
  id: z.uuid(),
  spaceId: z.uuid(),
  target: ResourceTargetSchema,
  capabilities: z.array(z.string()),
  state: z.enum(['PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED']),
  revision: z.number().int().positive(),
  expiresAt: z.iso.datetime(),
  grantExpiresAt: z.iso.datetime(),
  grantId: z.uuid().nullable(),
});
export const GrantOfferDeliverySchema = z.strictObject({
  offer: GrantOfferSchema,
  proof: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .nullable(),
});
export const ResourceGrantSchema = z.strictObject({
  id: z.uuid(),
  spaceId: z.uuid(),
  scopeId: z.uuid(),
  granteeAccessId: z.uuid(),
  granteeGeneration: z.number().int().positive(),
  target: ResourceTargetSchema,
  capabilities: z.array(z.string()),
  expiresAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
  revision: z.number().int().positive(),
});
export const GrantOfferAcceptanceSchema = z.strictObject({
  offer: GrantOfferSchema,
  grant: ResourceGrantSchema,
  admission: SharedMembershipSchema,
});
export const ProjectEmptySchema = z.strictObject({});
export const ProjectLifecycleSchema = z.strictObject({
  spaceId: z.uuid(),
  state: z.string().min(1).max(32),
  authorizationVersion: z.string().regex(/^[1-9][0-9]*$/),
  closureGeneration: z.number().int().nonnegative(),
  recoveryDeadline: z.iso.datetime().nullable(),
  jobState: z.string().nullable(),
});
export const ResourceInvitationPreviewSchema = z.strictObject({
  contextLabel: z.literal('Project'),
  offerCategory: z.literal('RESOURCE_GRANT'),
  expiresAt: z.iso.datetime(),
});
const OrdinaryCapabilitySchema = z.enum([
  'task.read',
  'task.create',
  'task.update',
  'task.complete',
  'task.delete',
  'assignment.accept',
  'assignment.decline',
  'assignment.assign',
  'workflow.transition',
  'workflow.publish',
  'export.visible',
  'file.read',
]);
export const ProjectPolicyPublishSchema = z.strictObject({
  roleDefaults: z.strictObject({
    OWNER: z.array(OrdinaryCapabilitySchema),
    ADMIN: z.array(OrdinaryCapabilitySchema),
    MANAGER: z.array(OrdinaryCapabilitySchema),
    MEMBER: z.array(OrdinaryCapabilitySchema),
    VIEWER: z.array(OrdinaryCapabilitySchema),
  }),
  exportMaxRecords: z.number().int().min(1).max(10000),
  exportMaxBytes: z.number().int().min(1).max(10485760),
});
export const ProjectPolicySchema = ProjectPolicyPublishSchema.extend({
  version: z.number().int().positive(),
});
