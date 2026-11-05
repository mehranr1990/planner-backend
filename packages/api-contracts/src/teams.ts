import { z } from 'zod';
import {
  InvitationCreateSchema,
  InvitationSchema,
  SharedMembershipSchema,
  MembershipChangeSchema,
} from './collaboration.js';
import {
  ProjectCreateSchema,
  ProjectPatchSchema,
  ProjectPageQuerySchema,
  ProjectSchema,
} from './projects.js';
export const TeamMemberRoleSchema = z.enum([
  'ADMIN',
  'LEAD',
  'MEMBER',
  'VIEWER',
]);
export const TeamInvitationCreateSchema = InvitationCreateSchema.extend({
  memberRole: TeamMemberRoleSchema,
});
export const TeamInvitationSchema = InvitationSchema.extend({
  memberRole: TeamMemberRoleSchema,
});
export const TeamInvitationDeliverySchema = z.strictObject({
  invitation: TeamInvitationSchema,
  proof: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .nullable(),
});
export const TeamMembershipSchema = SharedMembershipSchema.extend({
  memberRole: TeamMemberRoleSchema.nullable(),
  role: z.enum(['OWNER', 'ADMIN', 'LEAD', 'MEMBER', 'VIEWER']).nullable(),
});
export const TeamMembershipChangeSchema = MembershipChangeSchema.extend({
  memberRole: TeamMemberRoleSchema,
});
export const TeamInvitationAcceptanceSchema = z.strictObject({
  invitation: TeamInvitationSchema,
  membership: TeamMembershipSchema,
});
// Internal shared service boundaries; existing Project transport schemas remain frozen.
export const ContextInvitationCreateSchema = z.union([
  InvitationCreateSchema,
  TeamInvitationCreateSchema,
]);
export const ContextInvitationSchema = z.union([
  InvitationSchema,
  TeamInvitationSchema,
]);
export const ContextMembershipSchema = z.union([
  SharedMembershipSchema,
  TeamMembershipSchema,
]);
export const ContextInvitationAcceptanceSchema = z.strictObject({
  invitation: ContextInvitationSchema,
  membership: ContextMembershipSchema,
});
export const TeamInvitationPreviewSchema = z.strictObject({
  contextLabel: z.literal('Team'),
  offerCategory: z.literal('MEMBERSHIP'),
  expiresAt: z.iso.datetime(),
});
export const TeamCreateSchema = ProjectCreateSchema;
export const TeamPatchSchema = ProjectPatchSchema;
export const TeamPageQuerySchema = ProjectPageQuerySchema;
export const TeamSchema = ProjectSchema.omit({ association: true }).extend({
  association: z.strictObject({ kind: z.literal('INDEPENDENT') }),
});
export const TeamPageSchema = z.strictObject({
  items: z.array(TeamSchema),
  nextCursor: z.string().nullable(),
});
export const TeamMembershipPageSchema = z.strictObject({
  items: z.array(TeamMembershipSchema),
  nextCursor: z.string().nullable(),
});
export const TeamProjectLinkSchema = z.strictObject({
  teamId: z.uuid(),
  projectId: z.uuid(),
  revision: z.number().int().positive(),
  active: z.boolean(),
});
export const TeamProjectSchema = z.strictObject({
  link: TeamProjectLinkSchema,
  project: ProjectSchema,
});
export const TeamProjectPageSchema = z.strictObject({
  items: z.array(TeamProjectSchema),
  nextCursor: z.string().nullable(),
});

export const ContextInvitationDeliverySchema = z.strictObject({
  invitation: ContextInvitationSchema,
  proof: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .nullable(),
});
