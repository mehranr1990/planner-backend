import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as c from './communication-email-invitations.js';
import { ProjectWeekdayCapacityInputSchema } from './project-execution.js';
import { messagingPaths } from './messaging-openapi.js';
it('accepts exact email only and requires a redacted proof header on protected claims', () => {
  expect(
    c.CommunicationEmailInviteSchema.safeParse({
      id: randomUUID(),
      email: 'person@example.test',
    }).success,
  ).toBe(true);
  for (const extra of [
    { username: 'person' },
    { email: 'person' },
    { email: 'person@example.test', role: 'ADMIN' },
    { email: 'person@example.test', proof: 'secret' },
  ])
    expect(
      c.CommunicationEmailInviteSchema.safeParse({ id: randomUUID(), ...extra })
        .success,
    ).toBe(false);
  const op = messagingPaths()[
    '/api/v1/conversation-invitations/{invitationId}/claim-email'
  ]!.post as {
    security: unknown[];
    parameters: { name: string; in: string; required: boolean }[];
  };
  expect(op.security).not.toEqual([]);
  expect(op.parameters).toContainEqual(
    expect.objectContaining({
      name: 'X-Invitation-Proof',
      in: 'header',
      required: true,
    }),
  );
  expect(
    op.parameters.some(
      (p) => p.in === 'query' && p.name.toLowerCase().includes('proof'),
    ),
  ).toBe(false);
});
it('validates seven bounded weekday overrides and generation-scoped membership', () => {
  const member = { accessId: randomUUID(), generation: 1 },
    template = {
      timezone: 'Asia/Tehran',
      effectiveFrom: '2030-01-01',
      weekdays: [null, 0, 480, null, null, null, null],
    };
  expect(
    ProjectWeekdayCapacityInputSchema.safeParse({ member, template }).success,
  ).toBe(true);
  for (const weekdays of [[], [480], Array(7).fill(-1), Array(7).fill(1441)])
    expect(
      ProjectWeekdayCapacityInputSchema.safeParse({
        member,
        template: { ...template, weekdays },
      }).success,
    ).toBe(false);
  expect(
    ProjectWeekdayCapacityInputSchema.safeParse({
      member: { ...member, generation: 0 },
      template,
    }).success,
  ).toBe(false);
});
