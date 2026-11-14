import { z } from 'zod';
const id = z.uuid();
const sequence = z.string().regex(/^(0|[1-9][0-9]{0,18})$/);
const label = z.string().trim().min(1).max(200);
const users = z
  .array(id)
  .max(49)
  .refine((v) => new Set(v).size === v.length);
const retention = z.string().regex(/^[A-Za-z0-9._-]{1,80}$/);
export const ConversationKindSchema = z.enum([
  'DM',
  'PRIVATE_GROUP',
  'PROJECT',
  'TEAM',
  'COMPANY',
]);
export const ConversationCreateSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    id,
    kind: z.literal('DM'),
    participants: z.tuple([id]),
    retentionPolicyVersion: retention,
  }),
  z.strictObject({
    id,
    kind: z.literal('PRIVATE_GROUP'),
    title: label,
    participants: users,
    retentionPolicyVersion: retention,
  }),
  ...(['PROJECT', 'TEAM', 'COMPANY'] as const).map((kind) =>
    z.strictObject({
      id,
      kind: z.literal(kind),
      title: label,
      sourceId: id,
      participants: users,
    }),
  ),
]);
export const ConversationPageQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(10000).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const ConversationEmptySchema = z.strictObject({});
export const ConversationRenameSchema = z.strictObject({ title: label });
export const ConversationInvitationInputSchema = z.strictObject({
  id,
  userId: id,
});
export const ConversationRoleInputSchema = z.strictObject({
  role: z.enum(['ADMIN', 'MEMBER']),
});
export const ConversationMessageInputSchema = z.strictObject({
  id,
  text: z
    .string()
    .trim()
    .min(1)
    .max(8000)
    .regex(/^[^\u0000]*$/),
});
export const ConversationSchema = z.strictObject({
  id,
  kind: ConversationKindSchema,
  sourceId: id.nullable(),
  title: label.nullable(),
  revision: z.number().int().positive(),
  writable: z.boolean(),
  createdAt: z.iso.datetime(),
});
export const ConversationMemberSchema = z.strictObject({
  displayName: z.string().nullable().optional(),
  id,
  conversationId: id,
  actorId: id,
  role: z.enum(['ADMIN', 'MEMBER']),
  state: z.enum(['ACTIVE', 'LEFT', 'REVOKED']),
  generation: z.number().int().positive(),
  revision: z.number().int().positive(),
  historyAfter: sequence,
  joinedAt: z.iso.datetime(),
});
export const ConversationInvitationSchema = z.strictObject({
  inviterDisplayName: z.string().nullable().optional(),
  id,
  conversationId: id,
  kind: ConversationKindSchema,
  inviterActorId: id,
  state: z.enum(['PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED']),
  revision: z.number().int().positive(),
  expiresAt: z.iso.datetime(),
});
export const ConversationMessageSchema = z.strictObject({
  id,
  conversationId: id,
  sequence,
  memberId: id,
  memberGeneration: z.number().int().positive(),
  text: z.string().min(1).max(8000),
  createdAt: z.iso.datetime(),
});
const page = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    items: z.array(item).max(100),
    nextCursor: z.string().nullable(),
  });
export const ConversationPageSchema = page(ConversationSchema);
export const ConversationSummarySchema = ConversationSchema.extend({
  lastMessage: z
    .strictObject({
      id,
      memberId: id,
      kind: z.enum(['TEXT', 'MEDIA', 'FORWARD']),
      text: z.string().nullable(),
      createdAt: z.iso.datetime(),
    })
    .nullable(),
  unreadCount: z.number().int().nonnegative(),
  muted: z.boolean(),
  lastActivityAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const ConversationSummaryPageSchema = page(ConversationSummarySchema);
export const ConversationMemberPageSchema = page(ConversationMemberSchema);
export const ConversationInvitationPageSchema = page(
  ConversationInvitationSchema,
);
export const ConversationMessagePageSchema = z.strictObject({
  items: z.array(ConversationMessageSchema).max(100),
  nextCursor: z.string(),
  hasMore: z.boolean(),
  highWatermark: sequence,
});
