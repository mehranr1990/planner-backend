import { describe, it, expect } from 'vitest';
import {
  DmContactInputSchema,
  DmContactBlockSchema,
  MessageRecoveryPageSchema,
} from './communication-lifecycle.js';
import { communicationLifecyclePaths } from './communication-lifecycle-openapi.js';
const id = '0d790178-a17f-4de9-b3a1-e3bed6b146fd';
describe('P5-06 contact privacy and recovery contracts', () => {
  it('requires an already known DM or an owner block ID, and forbids direct people lookup', () => {
    expect(
      DmContactInputSchema.parse({ conversationId: id, active: true }),
    ).toEqual({ conversationId: id, active: true });
    expect(DmContactInputSchema.parse({ blockId: id, active: false })).toEqual({
      blockId: id,
      active: false,
    });
    for (const body of [
      { userId: id, active: true },
      { blockId: id, active: true },
      { conversationId: id, active: true, targetUserId: id },
      { conversationId: id, blockId: id, active: false },
    ])
      expect(DmContactInputSchema.safeParse(body).success).toBe(false);
  });
  it('exposes no counterparty identity, block direction or profile in private block results', () => {
    const own = { id, conversationId: null, active: true, revision: 2 };
    expect(DmContactBlockSchema.safeParse(own).success).toBe(true);
    for (const field of ['targetUserId', 'blockedBy', 'email', 'name'])
      expect(
        DmContactBlockSchema.safeParse({ ...own, [field]: id }).success,
      ).toBe(false);
  });
  it('requires explicit finite snapshot progress even for an empty page', () => {
    const page = {
      items: [],
      hasMore: false,
      nextCursor: null,
      throughSequence: '0',
      changeCursor: 'signed',
    };
    expect(MessageRecoveryPageSchema.safeParse(page).success).toBe(true);
    expect(
      MessageRecoveryPageSchema.safeParse({ ...page, throughSequence: '-1' })
        .success,
    ).toBe(false);
    expect(
      MessageRecoveryPageSchema.safeParse({ ...page, changeCursor: undefined })
        .success,
    ).toBe(false);
  });
  it('declares verified REST recovery, private revision/idempotency and reauthentication headers without any realtime surface', () => {
    const paths = communicationLifecyclePaths(),
      encoded = JSON.stringify(paths);
    expect(encoded).not.toMatch(/websocket|presence|typing/i);
    const get = paths['/api/v1/conversations/{id}/recovery']!.get as {
      security: unknown;
      responses: Record<string, unknown>;
    };
    expect(get.security).toEqual([{ sessionCookie: [] }]);
    expect(get.responses['200']).toBeDefined();
    const recover = paths['/api/v1/meetings/{projectId}/lifecycle-job/recover']!
      .post as {
      parameters: { name: string; required: boolean }[];
      responses: Record<string, unknown>;
    };
    expect(
      recover.parameters.filter((p) => p.required).map((p) => p.name),
    ).toEqual(
      expect.arrayContaining(['Origin', 'If-Match', 'X-Deletion-Recovery']),
    );
    expect(recover.responses['200']).toBeDefined();
  });
});
