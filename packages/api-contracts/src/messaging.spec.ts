import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as c from './messaging.js';
import { messagingOperations, messagingPaths } from './messaging-openapi.js';
describe('P5-01 bounded messaging contracts', () => {
  it('rejects extra permissions, oversized text, duplicate participants and invalid source branches', () => {
    expect(
      c.ConversationMessageInputSchema.safeParse({
        id: randomUUID(),
        text: 'x'.repeat(8001),
      }).success,
    ).toBe(false);
    expect(
      c.ConversationMessageInputSchema.safeParse({
        id: randomUUID(),
        text: '   ',
      }).success,
    ).toBe(false);
    expect(
      c.ConversationMessageInputSchema.safeParse({
        id: randomUUID(),
        text: 'safe',
        actorId: randomUUID(),
      }).success,
    ).toBe(false);
    const user = randomUUID();
    expect(
      c.ConversationCreateSchema.safeParse({
        id: randomUUID(),
        kind: 'PRIVATE_GROUP',
        title: 'Group',
        retentionPolicyVersion: 'policy',
        participants: [user, user],
      }).success,
    ).toBe(false);
    expect(
      c.ConversationCreateSchema.safeParse({
        id: randomUUID(),
        kind: 'PROJECT',
        title: 'Channel',
        participants: [],
        retentionPolicyVersion: 'policy',
      }).success,
    ).toBe(false);
    expect(
      c.ConversationPageQuerySchema.safeParse({ limit: 101 }).success,
    ).toBe(false);
    expect(
      c.ConversationPageQuerySchema.safeParse({ after: '1' }).success,
    ).toBe(false);
  });
  it('serializes sequence as strings and requires a reusable empty polling cursor', () => {
    expect(
      c.ConversationMessagePageSchema.safeParse({
        items: [],
        nextCursor: 'signed',
        hasMore: false,
        highWatermark: '9007199254740993',
      }).success,
    ).toBe(true);
    expect(
      c.ConversationMessagePageSchema.safeParse({
        items: [],
        nextCursor: null,
        hasMore: false,
        highWatermark: 1,
      }).success,
    ).toBe(false);
  });
  it('publishes exactly the foundation operations without sockets, advanced messages or media', () => {
    const paths = messagingPaths();
    expect(messagingOperations).toHaveLength(17);
    expect(Object.values(paths).flatMap(Object.values)).toHaveLength(17);
    expect(JSON.stringify(paths)).not.toMatch(
      /websocket|socket\.io|typing|voice|attachments|reaction/i,
    );
  });
});
