import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  TeamCreateSchema,
  TeamInvitationCreateSchema,
  TeamMembershipChangeSchema,
} from './teams.js';
import {
  InvitationCreateSchema,
  MembershipChangeSchema,
  ProjectCreateSchema,
} from './index.js';
it('accepts Team Lead, rejects Project Manager and preserves existing Project role schemas', () => {
  const body = {
    kind: 'MEMBERSHIP',
    memberRole: 'LEAD',
    recipient: { userId: randomUUID() },
  };
  expect(TeamInvitationCreateSchema.safeParse(body).success).toBe(true);
  expect(InvitationCreateSchema.safeParse(body).success).toBe(false);
  expect(
    TeamInvitationCreateSchema.safeParse({ ...body, memberRole: 'MANAGER' })
      .success,
  ).toBe(false);
  expect(
    TeamMembershipChangeSchema.safeParse({
      state: 'ACTIVE',
      memberRole: 'LEAD',
    }).success,
  ).toBe(true);
  expect(
    MembershipChangeSchema.safeParse({ state: 'ACTIVE', memberRole: 'LEAD' })
      .success,
  ).toBe(false);
});
it('rejects Company association, unknown fields and invalid Team envelopes', () => {
  const body = {
    id: randomUUID(),
    title: 'Team',
    retentionPolicyVersion: 'fixture',
  };
  expect(TeamCreateSchema.parse(body)).toEqual(ProjectCreateSchema.parse(body));
  for (const extra of [
    { companyId: randomUUID() },
    { ownerUserId: randomUUID() },
    { association: { kind: 'COMPANY' } },
    { title: ' ' },
  ])
    expect(TeamCreateSchema.safeParse({ ...body, ...extra }).success).toBe(
      false,
    );
});
