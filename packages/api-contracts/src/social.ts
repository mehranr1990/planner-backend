import { z } from 'zod';
import {
  InvitationCreateSchema,
  InvitationSchema,
  SharedMembershipSchema,
  OwnerHandoverSchema,
  HandoverCreateSchema,
  HandoverAcceptSchema,
} from './collaboration.js';
export { OwnerHandoverSchema, HandoverCreateSchema, HandoverAcceptSchema };
const id = z.uuid();
export const SocialEmptySchema = z.strictObject({});
export const SocialPageQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  after: z
    .string()
    .max(2048)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
});
export const SocialPrivacySchema = z.strictObject({
  discoverable: z.boolean(),
  allowFriendRequests: z.boolean(),
  revision: z.number().int().positive(),
});
export const SocialPrivacyPatchSchema = SocialPrivacySchema.omit({
  revision: true,
})
  .partial()
  .refine((v) => Object.keys(v).length > 0);
export const SocialDiscoverySchema = z.strictObject({
  email: z.email().max(254),
});
export const SocialPersonSchema = z.strictObject({
  id,
  name: z.string().max(200),
});
export const SocialDiscoveryResultSchema = z.strictObject({
  items: z.array(SocialPersonSchema).max(1),
});
export const SocialConnectionCreateSchema = z.strictObject({
  id,
  recipientUserId: id,
});
export const SocialConnectionActionSchema = z.enum([
  'accept',
  'decline',
  'cancel',
  'remove',
]);
export const SocialJoinActionSchema = z.enum(['approve', 'reject', 'cancel']);
export const SocialConnectionSchema = z.strictObject({
  requesterDisplayName: z.string().nullable().optional(),
  recipientDisplayName: z.string().nullable().optional(),
  id,
  requesterUserId: id,
  recipientUserId: id,
  state: z.enum(['PENDING', 'ACCEPTED', 'DECLINED', 'CANCELED', 'REMOVED']),
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const SocialConnectionPageSchema = z.strictObject({
  items: z.array(SocialConnectionSchema).max(100),
  nextCursor: z.string().nullable(),
});
export const SocialCircleCreateSchema = z.strictObject({
  id,
  name: z.string().trim().min(1).max(100),
});
export const SocialCirclePatchSchema = SocialCircleCreateSchema.omit({
  id: true,
});
export const SocialCircleSchema = SocialCircleCreateSchema.extend({
  revision: z.number().int().positive(),
});
export const SocialCirclePageSchema = z.strictObject({
  items: z.array(SocialCircleSchema).max(100),
  nextCursor: z.string().nullable(),
});
export const SocialCircleMemberSchema = z.strictObject({
  circleId: id,
  connectionId: id,
});
export const SocialCircleMemberPageSchema = z.strictObject({
  items: z.array(SocialCircleMemberSchema).max(100),
  nextCursor: z.string().nullable(),
});
export const SocialBlockCreateSchema = z.strictObject({ targetUserId: id });
export const SocialGroupCreateSchema = z.strictObject({
  id,
  name: z.string().trim().min(1).max(200),
  description: z.string().max(4000).nullable().optional(),
  publicSummary: z.string().trim().max(500).default(''),
  discoverable: z.boolean().default(false),
  retentionPolicyVersion: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/),
});
export const SocialGroupPatchSchema = SocialGroupCreateSchema.omit({
  id: true,
  retentionPolicyVersion: true,
})
  .extend({
    publicSummary: z.string().trim().max(500),
    discoverable: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0);
export const SocialGroupSchema = SocialGroupCreateSchema.omit({
  retentionPolicyVersion: true,
}).extend({
  description: z.string().max(4000).nullable(),
  spaceId: id,
  scopeId: id,
  revision: z.number().int().positive(),
  state: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const SocialGroupPageSchema = z.strictObject({
  items: z.array(SocialGroupSchema).max(100),
  nextCursor: z.string().nullable(),
});
export const SocialGroupPreviewSchema = z.strictObject({
  id,
  name: z.string().max(200),
  publicSummary: z.string().max(500),
});
export const SocialGroupDiscoveryPageSchema = z.strictObject({
  items: z.array(SocialGroupPreviewSchema).max(100),
  nextCursor: z.string().nullable(),
});
export const SocialJoinCreateSchema = z.strictObject({ id });
export const SocialJoinRequestSchema = z.strictObject({
  requesterDisplayName: z.string().nullable().optional(),
  id,
  groupId: id,
  requesterUserId: id,
  state: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELED']),
  revision: z.number().int().positive(),
});
export const SocialJoinRequestPageSchema = z.strictObject({
  items: z.array(SocialJoinRequestSchema).max(100),
  nextCursor: z.string().nullable(),
});
export const SocialGroupInvitationCreateSchema = InvitationCreateSchema.extend({
  memberRole: z.literal('MEMBER'),
});
export const SocialGroupInvitationSchema = InvitationSchema.extend({
  memberRole: z.enum(['ADMIN', 'MEMBER']),
});
export const SocialGroupInvitationDeliverySchema = z.strictObject({
  invitation: SocialGroupInvitationSchema,
  proof: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .nullable(),
});
export const SocialGroupInvitationPreviewSchema = z.strictObject({
  contextLabel: z.literal('Social Group'),
  offerCategory: z.literal('MEMBERSHIP'),
  expiresAt: z.iso.datetime(),
});
export const SocialMembershipSchema = SharedMembershipSchema.extend({
  displayName: z.string().nullable().optional(),
  memberRole: z.enum(['ADMIN', 'MEMBER']).nullable(),
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER']).nullable(),
});
export const SocialGroupAccessMeSchema = z.strictObject({
  accessId: id,
  actorId: id,
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER']),
  state: z.literal('ACTIVE'),
  generation: z.number().int().positive(),
  revision: z.number().int().positive(),
  groupState: z.string(),
  capabilities: z.array(
    z.enum([
      'task.read',
      'settings.manage',
      'membership.member',
      'membership.admin',
      'membership.leave',
      'custody.handover',
    ]),
  ),
});
export const SocialMembershipPageSchema = z.strictObject({
  items: z.array(SocialMembershipSchema).max(100),
  nextCursor: z.string().nullable(),
});
export const SocialGroupHistoryActionSchema = z.enum([
  'social.group.create',
  'social.group.update',
  'social.group.private',
  'social.group.public',
  'membership.admit',
  'membership.change',
  'membership.leave',
  'handover.accept',
]);
export const SocialGroupHistoryEventSchema = z.strictObject({
  id,
  actorId: id,
  actorDisplayName: z.string().nullable(),
  action: SocialGroupHistoryActionSchema,
  resourceId: id.nullable(),
  occurredAt: z.iso.datetime(),
});
export const SocialGroupHistoryPageSchema = z.strictObject({
  items: z.array(SocialGroupHistoryEventSchema).max(100),
  nextCursor: z.string().nullable(),
});
export const SocialMembershipChangeSchema = z.strictObject({
  state: z.enum(['ACTIVE', 'SUSPENDED', 'REVOKED']),
  memberRole: z.enum(['ADMIN', 'MEMBER']),
});
export const SocialGroupInvitationAcceptanceSchema = z.strictObject({
  invitation: SocialGroupInvitationSchema,
  membership: SocialMembershipSchema,
});
export const SocialReplaySchema = z.strictObject({
  applied: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});
