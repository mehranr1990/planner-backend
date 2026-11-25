import { z } from 'zod';

export const InvitationFeedFields = {
  invitationId: z.uuid(),
  kind: z.enum([
    'PROJECT',
    'TEAM',
    'COMPANY',
    'CONVERSATION',
    'MEETING',
    'SOCIAL_GROUP',
  ]),
  targetId: z.uuid(),
  targetDisplayName: z.string(),
  inviterDisplayName: z.string().nullable(),
  role: z.string().nullable(),
  createdAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
};
export const InvitationNotificationSchema = z.strictObject({
  ...InvitationFeedFields,
  revision: z.number().int().positive(),
  expiresAt: z.iso.datetime(),
});
export const InvitationNotificationQuerySchema = z.strictObject({
  kind: InvitationFeedFields.kind,
  limit: z.coerce.number().int().min(1).max(100).default(25),
  after: z
    .string()
    .max(2048)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
});
export const InvitationNotificationPageSchema = z.strictObject({
  items: z.array(InvitationNotificationSchema).max(100),
  nextCursor: z.string().nullable(),
});
export const SocialPendingInvitationSummarySchema = z.strictObject({
  notification: InvitationNotificationSchema.optional(),
  id: z.uuid(),
  contextLabel: z.literal('Social Group'),
  revision: z.number().int().positive(),
  expiresAt: z.iso.datetime(),
});
export const SocialPendingInvitationPageSchema = z.strictObject({
  items: z.array(SocialPendingInvitationSummarySchema).max(100),
  nextCursor: z.string().nullable(),
});
