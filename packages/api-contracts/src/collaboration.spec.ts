import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  InvitationCreateSchema,
  HandoverAcceptSchema,
} from './collaboration.js';
import { collaborationPaths } from './collaboration-openapi.js';
describe('P2-02 strict collaboration contracts', () => {
  it('accepts only currently typed membership offers and exactly one recipient', () => {
    const input = {
      kind: 'MEMBERSHIP',
      memberRole: 'MEMBER',
      recipient: { email: 'recipient@example.test' },
    };
    expect(InvitationCreateSchema.safeParse(input).success).toBe(true);
    for (const value of [
      { ...input, memberRole: 'OWNER' },
      {
        ...input,
        recipient: { userId: randomUUID(), email: 'recipient@example.test' },
      },
      { ...input, kind: 'RESOURCE_GRANT', targetId: randomUUID() },
      { ...input, spaceId: randomUUID() },
      { ...input, recipient: { email: 'invalid' } },
      { ...input, recipient: { email: ' recipient@example.test' } },
    ])
      expect(InvitationCreateSchema.safeParse(value).success).toBe(false);
    expect(
      HandoverAcceptSchema.safeParse({
        password: 'secret',
        successorAccessId: randomUUID(),
      }).success,
    ).toBe(false);
  });
  it('describes all 13 actual operations with bounded proof and concurrency headers', () => {
    const paths = collaborationPaths();
    expect(Object.values(paths).flatMap(Object.keys)).toHaveLength(13);
    const preview = paths['/api/v1/invitations/preview']!['get'] as {
      security: unknown[];
      parameters: { in: string; name: string }[];
    };
    expect(preview.security).toEqual([]);
    expect(preview.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ in: 'header', name: 'X-Invitation-Proof' }),
      ]),
    );
    expect(preview.parameters.some((p) => p.in === 'query')).toBe(false);
  });
});
