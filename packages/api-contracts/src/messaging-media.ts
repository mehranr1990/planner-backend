import { z } from 'zod';
import { FileNameSchema, FileMimeSchema } from './files.js';
import { ConversationMessageInputSchema } from './messaging.js';
import { AdvancedMessageSchema } from './advanced-messaging.js';
const id = z.uuid(),
  seq = z.string().regex(/^(0|[1-9][0-9]{0,18})$/),
  text = ConversationMessageInputSchema.shape.text;
const file = {
  id,
  filename: FileNameSchema,
  expectedSize: z.number().int().min(1).max(104857600),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
};
export const MessageAttachmentUploadSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...file,
    kind: z.literal('FILE'),
    mimeType: FileMimeSchema,
  }),
  z.strictObject({
    ...file,
    kind: z.literal('IMAGE'),
    mimeType: z.enum(['image/png', 'image/jpeg']),
  }),
  z.strictObject({
    ...file,
    kind: z.literal('VOICE'),
    mimeType: z.literal('audio/wav'),
    expectedSize: z.number().int().min(46).max(10000000),
  }),
]);
export const MessageAttachmentSchema = z.strictObject({
  id,
  conversationId: id,
  messageId: id.nullable(),
  kind: z.enum(['FILE', 'IMAGE', 'VOICE']),
  filename: FileNameSchema,
  mimeType: z.enum([
    'text/plain',
    'application/pdf',
    'image/png',
    'image/jpeg',
    'audio/wav',
  ]),
  status: z.enum(['INITIATED', 'READY', 'REJECTED', 'DELETED']),
  expectedSize: z.number().int().positive(),
  actualSize: z.number().int().positive().nullable(),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  durationMs: z.number().int().min(1).max(120000).nullable(),
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  uploadExpiresAt: z.iso.datetime(),
});
export const MediaMessageCreateSchema = z.strictObject({
  id,
  caption: text.nullable().default(null),
  attachments: z
    .array(id)
    .min(1)
    .max(5)
    .refine((v) => new Set(v).size === v.length),
  replyToId: id.optional(),
  mentions: z.array(id).max(50).default([]),
});
export const MediaMessageEditSchema = z.strictObject({
  caption: text.nullable(),
});
export const MediaForwardSchema = z.strictObject({
  id,
  sourceConversationId: id,
  sourceId: id,
});
export const RichMessageSchema = z.strictObject({
  reactions: AdvancedMessageSchema.shape.reactions,
  mentions: AdvancedMessageSchema.shape.mentions,
  pinned: z.boolean(),
  id,
  conversationId: id,
  sequence: seq,
  kind: z.enum(['TEXT', 'FORWARD', 'MEDIA']),
  state: z.enum(['VISIBLE', 'DELETED', 'HIDDEN', 'UNAVAILABLE']),
  revision: z.number().int().positive(),
  memberId: id,
  createdAt: z.iso.datetime(),
  text: text.nullable(),
  attachments: z.array(MessageAttachmentSchema).max(5),
  replyToId: id.nullable(),
  threadId: id.nullable(),
  sourceId: id.nullable(),
  sourceConversationId: id.nullable(),
});
export const RichMessagePageSchema = z.strictObject({
  items: z.array(RichMessageSchema).max(100),
  nextCursor: z.string(),
  hasMore: z.boolean(),
  changeCursor: z.string(),
});
export const RichMessageChangesSchema = z.strictObject({
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
        message: RichMessageSchema,
      }),
    )
    .max(100),
  nextCursor: z.string(),
  hasMore: z.boolean(),
});
export const MessageMediaRevisionPageSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        revision: z.number().int().positive(),
        caption: text.nullable(),
        editedAt: z.iso.datetime(),
      }),
    )
    .max(100),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export const MessageAcknowledgeSchema = z.strictObject({
  messageId: id,
  state: z.enum(['DELIVERED', 'READ']),
});
export const MessageReceiptSettingsInputSchema = z.strictObject({
  shareReceipts: z.boolean(),
});
export const MessageProgressSchema = z.strictObject({
  deliveredThrough: seq,
  readThrough: seq,
  shareReceipts: z.boolean(),
  revision: z.number().int().positive(),
});
export const MessageReceiptSummarySchema = z.strictObject({
  messageId: id,
  sharing: z.boolean(),
  deliveredCount: z.number().int().nonnegative().nullable(),
  readCount: z.number().int().nonnegative().nullable(),
});
const time = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
export const MessageNoticeSettingsInputSchema = z
  .strictObject({
    mode: z.enum(['ALL', 'MENTIONS_ONLY', 'MUTED']),
    quietStart: time.nullable(),
    quietEnd: time.nullable(),
    mentionQuiet: z.boolean(),
  })
  .refine(
    (v) =>
      (v.quietStart === null) === (v.quietEnd === null) &&
      (v.quietStart === null || v.quietStart !== v.quietEnd),
    'Invalid quiet interval',
  );
export const MessageNoticeSettingsSchema = z.strictObject({
  mode: z.enum(['ALL', 'MENTIONS_ONLY', 'MUTED']),
  quietStart: time.nullable(),
  quietEnd: time.nullable(),
  mentionQuiet: z.boolean(),
  revision: z.number().int().positive(),
});
export const MessagingPushConsentSchema = z.strictObject({
  enabled: z.boolean(),
});
export const MessagingPushSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  revision: z.number().int().positive(),
  serverAvailable: z.boolean(),
  globalWebPush: z.boolean(),
});
export const MessageNoticeSchema = z.strictObject({
  id,
  conversationId: id,
  kind: z.enum(['MESSAGE', 'INVITATION']),
  messageId: id.nullable(),
  invitationId: id.nullable(),
  read: z.boolean(),
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
});
export const MessageNoticePageSchema = z.strictObject({
  items: z.array(MessageNoticeSchema).max(100),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export const MessagePushAttemptsSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        id,
        state: z.enum([
          'PENDING',
          'PROCESSING',
          'NETWORK',
          'RETRY',
          'DELIVERED',
          'CANCELED',
          'EXPIRED',
          'FAILED',
          'AMBIGUOUS',
        ]),
        attempts: z.number().int().min(0).max(5),
        notBefore: z.iso.datetime(),
        code: z.string().max(80).nullable(),
      }),
    )
    .max(20),
});
