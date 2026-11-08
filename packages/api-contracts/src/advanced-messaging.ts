import { z } from 'zod';
import {
  ConversationMessageInputSchema,
  ConversationPageQuerySchema,
} from './messaging.js';
const id = z.uuid(),
  seq = z.string().regex(/^(0|[1-9][0-9]{0,18})$/);
const text = ConversationMessageInputSchema.shape.text;
const reason = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .regex(/^[^\u0000]*$/);
export const MessageEmojiSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => {
    const segments = [
      ...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(value),
    ];
    return (
      segments.length === 1 && new RegExp('^\\p{RGI_Emoji}$', 'v').test(value)
    );
  }, 'One Unicode emoji is required');
export const AdvancedMessageActionSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('compose'),
    id,
    text,
    replyToId: id.optional(),
    mentions: z.array(id).max(50).default([]),
  }),
  z.strictObject({
    action: z.literal('forward'),
    id,
    sourceConversationId: id,
    sourceId: id,
  }),
  z.strictObject({ action: z.literal('edit'), messageId: id, text }),
  z.strictObject({ action: z.literal('delete'), messageId: id }),
  z.strictObject({ action: z.literal('hide'), messageId: id }),
  z.strictObject({
    action: z.literal('reaction'),
    messageId: id,
    emoji: MessageEmojiSchema,
    active: z.boolean(),
  }),
  z.strictObject({
    action: z.literal('pin'),
    messageId: id,
    active: z.boolean(),
  }),
  z.strictObject({ action: z.literal('report'), id, messageId: id, reason }),
  z.strictObject({ action: z.literal('resolve-report'), reportId: id, reason }),
  z.strictObject({ action: z.literal('moderate'), messageId: id, reason }),
  z.strictObject({
    action: z.literal('policy'),
    authorDelete: z.boolean(),
    reason,
  }),
]);
export const AdvancedMessageResultSchema = z.strictObject({
  resourceId: id,
  revision: z.number().int().positive().nullable(),
});
export const AdvancedMessageSchema = z.strictObject({
  id,
  conversationId: id,
  sequence: seq,
  kind: z.enum(['TEXT', 'FORWARD']),
  state: z.enum(['VISIBLE', 'DELETED', 'HIDDEN', 'UNAVAILABLE']),
  revision: z.number().int().positive(),
  memberId: id,
  createdAt: z.iso.datetime(),
  replyToId: id.nullable(),
  threadId: id.nullable(),
  content: z
    .strictObject({
      text,
      sourceId: id.nullable(),
      sourceConversationId: id.nullable(),
      sourceMemberId: id.nullable(),
    })
    .nullable(),
  reactions: z
    .array(
      z.strictObject({
        emoji: MessageEmojiSchema,
        count: z.number().int().positive(),
        mine: z.boolean(),
      }),
    )
    .max(100),
  mentions: z.array(id).max(50),
  pinned: z.boolean(),
});
export const AdvancedMessagePageSchema = z.strictObject({
  items: z.array(AdvancedMessageSchema).max(100),
  nextCursor: z.string(),
  hasMore: z.boolean(),
  changeCursor: z.string(),
});
export const MessageChangesSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        sequence: seq,
        kind: z.enum([
          'CREATE',
          'EDIT',
          'DELETE',
          'HIDE',
          'REACTION',
          'PIN',
          'MENTION',
        ]),
        message: AdvancedMessageSchema,
      }),
    )
    .max(100),
  nextCursor: z.string(),
  hasMore: z.boolean(),
});
export const MessageSearchQuerySchema = ConversationPageQuerySchema.extend({
  q: z.string().trim().min(1).max(200),
});
export const MessageReportSchema = z.strictObject({
  id,
  conversationId: id,
  messageId: id,
  memberId: id,
  reason,
  state: z.enum(['OPEN', 'RESOLVED']),
  resolution: reason.nullable(),
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
});
export const MessageReportPageSchema = z.strictObject({
  items: z.array(MessageReportSchema).max(100),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export const MessageRevisionPageSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        revision: z.number().int().positive(),
        text,
        editedAt: z.iso.datetime(),
      }),
    )
    .max(100),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export const MessagePolicySchema = z.strictObject({
  revision: z.number().int().positive(),
  authorDelete: z.boolean(),
});
