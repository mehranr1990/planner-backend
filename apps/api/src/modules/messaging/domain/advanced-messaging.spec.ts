import { it, expect } from 'vitest';
import { authorWindowOpen } from './messaging-policy.js';
import {
  AdvancedMessageActionSchema,
  MessageEmojiSchema,
} from '@mehran/api-contracts';
import { randomUUID } from 'node:crypto';
it.each([-1, 0, 172799999, 172800000, 172800001])(
  'enforces the inclusive 48h author boundary at %i milliseconds',
  (offset) => {
    const createdAt = new Date('2026-11-08T00:00:00.000Z');
    expect(
      authorWindowOpen(createdAt, new Date(createdAt.getTime() + offset)),
    ).toBe(offset >= 0 && offset <= 172800000);
  },
);
it.each(['👍', '👍🏽', '👨‍👩‍👧‍👦', '🇮🇷', '1️⃣'])(
  'accepts one complete Unicode emoji %s',
  (emoji) => expect(MessageEmojiSchema.safeParse(emoji).success).toBe(true),
);
it.each(['text', '<script>', '👍👍', 'a\u200d', '\u0000', ''])(
  'rejects non-emoji/compound input %s',
  (emoji) => expect(MessageEmojiSchema.safeParse(emoji).success).toBe(false),
);
it('rejects unknown commands and unapproved copied forwarding bodies', () => {
  expect(
    AdvancedMessageActionSchema.safeParse({
      action: 'forward',
      id: randomUUID(),
      sourceId: randomUUID(),
      sourceConversationId: randomUUID(),
      text: 'unapproved copy',
    }).success,
  ).toBe(false);
  expect(
    AdvancedMessageActionSchema.safeParse({
      action: 'admin-export',
      id: randomUUID(),
    }).success,
  ).toBe(false);
});
