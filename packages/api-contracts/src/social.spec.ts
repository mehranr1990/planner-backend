import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as c from './social.js';
import { socialPaths } from './social-openapi.js';
import { assertOpenApiContract } from '../../../tooling/compatibility/openapi-compatibility.js';
import { createOpenApiDocument } from './openapi.js';
describe('P6-01 social transport and privacy contracts', () => {
  it('refuses owner, membership, verification, role and internal-state overposting', () => {
    const request = { id: randomUUID(), recipientUserId: randomUUID() };
    for (const field of [
      'spaceId',
      'ownerUserId',
      'state',
      'emailVerified',
      'memberRole',
    ])
      expect(
        c.SocialConnectionCreateSchema.safeParse({
          ...request,
          [field]: 'ADMIN',
        }).success,
      ).toBe(false);
    expect(c.SocialPrivacyPatchSchema.safeParse({}).success).toBe(false);
    expect(
      c.SocialPrivacyPatchSchema.safeParse({ discoverable: true, version: 1 })
        .success,
    ).toBe(false);
  });
  it('keeps discovery and Group previews strictly free from contacts, counts and private fields', () => {
    const person = { id: randomUUID(), name: 'Public name' },
      group = {
        id: randomUUID(),
        name: 'Public group',
        publicSummary: 'Approved summary',
      };
    expect(c.SocialPersonSchema.safeParse(person).success).toBe(true);
    for (const field of ['email', 'phone', 'friendCount', 'memberRole'])
      expect(
        c.SocialPersonSchema.safeParse({ ...person, [field]: 'secret' })
          .success,
      ).toBe(false);
    for (const field of [
      'description',
      'ownerUserId',
      'members',
      'memberCount',
    ])
      expect(
        c.SocialGroupPreviewSchema.safeParse({ ...group, [field]: 'secret' })
          .success,
      ).toBe(false);
  });
  it('defaults groups private and forbids inviting Admin without separate Owner promotion', () => {
    const g = c.SocialGroupCreateSchema.parse({
      id: randomUUID(),
      name: 'Private',
      retentionPolicyVersion: 'approved',
    });
    expect(g.discoverable).toBe(false);
    expect(c.SocialGroupPatchSchema.parse({ name: 'Rename only' })).toEqual({
      name: 'Rename only',
    });
    expect(c.SocialGroupPatchSchema.safeParse({}).success).toBe(false);
    expect(
      c.SocialGroupInvitationCreateSchema.safeParse({
        kind: 'MEMBERSHIP',
        memberRole: 'ADMIN',
        recipient: { userId: randomUUID() },
      }).success,
    ).toBe(false);
    expect(
      c.SocialMembershipChangeSchema.safeParse({
        state: 'ACTIVE',
        memberRole: 'VIEWER',
      }).success,
    ).toBe(false);
  });
  it('bounds discovery envelopes, pages and action catalogs and exposes no phone endpoint', () => {
    expect(
      c.SocialDiscoverySchema.safeParse({
        email: 'a@example.test',
        phone: '+123',
      }).success,
    ).toBe(false);
    expect(c.SocialPageQuerySchema.safeParse({ limit: 101 }).success).toBe(
      false,
    );
    expect(c.SocialConnectionActionSchema.safeParse('transfer').success).toBe(
      false,
    );
    expect(c.SocialJoinActionSchema.safeParse('activate').success).toBe(false);
    expect(Object.keys(socialPaths()).join(' ')).not.toMatch(
      /phone|expenses|payments|activities|feed/,
    );
  });
  it('resolves every new OpenAPI reference with explicit mutation Origin and bounded action parameters', () => {
    expect(
      assertOpenApiContract(createOpenApiDocument()).operations,
    ).toBeGreaterThan(801);
    for (const [path, verbs] of Object.entries(socialPaths()))
      for (const [verb, raw] of Object.entries(verbs)) {
        const operation = raw as {
          parameters: { in: string; name: string; required?: boolean }[];
          security: unknown[];
        };
        if (verb !== 'get')
          expect(operation.parameters).toContainEqual(
            expect.objectContaining({
              name: 'Origin',
              in: 'header',
              required: true,
            }),
          );
        if (path.endsWith('/preview')) expect(operation.security).toEqual([]);
        else expect(operation.security).toHaveLength(1);
      }
  });
});
