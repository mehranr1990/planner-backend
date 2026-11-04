import { z } from 'zod';
export const SharedMemberRoleSchema = z.enum([
  'ADMIN',
  'MANAGER',
  'MEMBER',
  'VIEWER',
]);
export const SharedOfferStateSchema = z.enum([
  'PENDING',
  'ACCEPTED',
  'DECLINED',
  'REVOKED',
  'EXPIRED',
]);
const RecipientSchema = z.union([
  z.strictObject({ userId: z.uuid() }),
  z.strictObject({ email: z.email().max(320) }),
]);
export const InvitationCreateSchema = z.strictObject({
  kind: z.literal('MEMBERSHIP'),
  memberRole: SharedMemberRoleSchema,
  recipient: RecipientSchema,
});
export const InvitationSchema = z.strictObject({
  id: z.uuid(),
  spaceId: z.uuid(),
  scopeId: z.uuid(),
  kind: z.literal('MEMBERSHIP'),
  memberRole: SharedMemberRoleSchema,
  state: SharedOfferStateSchema,
  revision: z.number().int().positive(),
  expiresAt: z.iso.datetime(),
  acceptedAccessId: z.uuid().nullable(),
});
export const InvitationDeliverySchema = z.strictObject({
  invitation: InvitationSchema,
  proof: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .nullable(),
});
export const InvitationPreviewSchema = z.strictObject({
  contextLabel: z.literal('Project'),
  offerCategory: z.literal('MEMBERSHIP'),
  expiresAt: z.iso.datetime(),
});
export const SharedMembershipSchema = z.strictObject({
  id: z.uuid(),
  spaceId: z.uuid(),
  scopeId: z.uuid(),
  actorId: z.uuid(),
  memberRole: SharedMemberRoleSchema.nullable(),
  role: z.enum(['OWNER', 'ADMIN', 'MANAGER', 'MEMBER', 'VIEWER']).nullable(),
  state: z.enum(['ACTIVE', 'SUSPENDED', 'LEFT', 'REVOKED', 'ERASED']),
  generation: z.number().int().positive(),
  revision: z.number().int().positive(),
});
export const InvitationAcceptanceSchema = z.strictObject({
  invitation: InvitationSchema,
  membership: SharedMembershipSchema,
});
export const MembershipChangeSchema = z.strictObject({
  state: z.enum(['ACTIVE', 'SUSPENDED', 'LEFT', 'REVOKED']),
  memberRole: SharedMemberRoleSchema,
});
export const SharedDepartureSchema = z.strictObject({
  id: z.uuid(),
  revision: z.number().int().positive(),
});
export const HandoverCreateSchema = z.strictObject({
  successorAccessId: z.uuid(),
});
export const HandoverAcceptSchema = z.strictObject({
  password: z.string().min(1).max(1024),
});
export const OwnerHandoverSchema = z.strictObject({
  id: z.uuid(),
  spaceId: z.uuid(),
  scopeId: z.uuid(),
  fromAccessId: z.uuid(),
  toAccessId: z.uuid(),
  state: SharedOfferStateSchema,
  revision: z.number().int().positive(),
  expiresAt: z.iso.datetime(),
  expectedCustodyRevision: z.number().int().positive(),
  acceptedAt: z.iso.datetime().nullable(),
});
export const CollaborationEmptySchema = z.strictObject({});
