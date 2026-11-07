import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  CompanyPolicyPublishSchema,
  CompanyInvitationCreateSchema,
  CompanyCreateSchema,
} from './companies.js';
it('uses an independent corporate role catalog and rejects unimplemented source/Company integrations', () => {
  expect(
    CompanyInvitationCreateSchema.safeParse({
      memberRole: 'ORG_ADMIN',
      recipient: { userId: randomUUID() },
    }).success,
  ).toBe(true);
  expect(
    CompanyInvitationCreateSchema.safeParse({
      memberRole: 'ADMIN',
      recipient: { userId: randomUUID() },
    }).success,
  ).toBe(false);
  expect(
    CompanyCreateSchema.safeParse({
      id: randomUUID(),
      title: 'Company',
      retentionPolicyVersion: 'v1',
      teamIds: [randomUUID()],
    }).success,
  ).toBe(false);
});
it('bounds policy keys, tiers, role sets and explicit default overrides without configurable security floors', () => {
  for (const rules of [
    [
      {
        key: 'auth.verified',
        mode: 'OPTIONAL',
        roles: [],
        overrideDefault: false,
      },
    ],
    [
      {
        key: 'directory.read',
        mode: 'MANDATORY',
        roles: [],
        overrideDefault: true,
      },
    ],
    [
      {
        key: 'directory.read',
        mode: 'DEFAULT',
        roles: ['ADMIN'],
        overrideDefault: false,
      },
    ],
    [
      {
        key: 'directory.read',
        mode: 'DEFAULT',
        roles: ['MEMBER', 'MEMBER'],
        overrideDefault: false,
      },
    ],
  ])
    expect(CompanyPolicyPublishSchema.safeParse({ rules }).success).toBe(false);
  expect(
    CompanyPolicyPublishSchema.safeParse({
      rules: [
        {
          key: 'directory.read',
          mode: 'DEFAULT',
          roles: ['MEMBER'],
          overrideDefault: true,
        },
      ],
    }).success,
  ).toBe(true);
});
