import { z } from 'zod';
import { RichMessageSchema } from './messaging-media.js';
const sequence = z.string().regex(/^(0|[1-9][0-9]{0,18})$/);
export const MessageRecoveryPageSchema = z.strictObject({
  items: z.array(RichMessageSchema).max(100),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
  throughSequence: sequence,
  changeCursor: z.string(),
});
export const DmContactBlockSchema = z.strictObject({
  id: z.uuid().nullable(),
  conversationId: z.uuid().nullable(),
  active: z.boolean(),
  revision: z.number().int().positive(),
});
export const DmContactInputSchema = z.union([
  z.strictObject({ conversationId: z.uuid(), active: z.boolean() }),
  z.strictObject({ blockId: z.uuid(), active: z.literal(false) }),
]);
export const DmContactPageSchema = z.strictObject({
  items: z.array(DmContactBlockSchema).max(100),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export const DmContactReplaySchema = z.strictObject({
  applied: z.number().int().min(0).max(100),
  hasMore: z.boolean(),
});
