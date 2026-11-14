import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as c from './projects.js';
import { projectPaths } from './projects-openapi.js';
it('keeps independent creation and typed resource offers strict with no future attachment or administrative grants', () => {
  const project = {
    id: randomUUID(),
    title: 'Independent',
    retentionPolicyVersion: 'operator-approved',
  };
  expect(c.ProjectCreateSchema.safeParse(project).success).toBe(true);
  for (const field of [
    'teamId',
    'companyId',
    'parentProjectId',
    'createdByUserId',
  ])
    expect(
      c.ProjectCreateSchema.safeParse({ ...project, [field]: randomUUID() })
        .success,
    ).toBe(false);
  const offer = {
    id: randomUUID(),
    recipientUserId: randomUUID(),
    target: { kind: 'TASK', id: randomUUID() },
    capabilities: ['read', 'update'],
    grantExpiresAt: '2027-01-01T00:00:00.000Z',
  };
  expect(c.GrantOfferCreateSchema.safeParse(offer).success).toBe(true);
  for (const capabilities of [
    ['membership.member'],
    ['update'],
    ['read', 'file.read'],
    ['read', 'read'],
  ])
    expect(
      c.GrantOfferCreateSchema.safeParse({ ...offer, capabilities }).success,
    ).toBe(false);
  expect(
    c.GrantOfferCreateSchema.safeParse({
      ...offer,
      target: { kind: 'PROJECT', id: randomUUID() },
    }).success,
  ).toBe(false);
  expect(
    c.ProjectGoalCreateSchema.safeParse({
      id: randomUUID(),
      title: 'Goal',
      timezone: 'UTC',
    }).success,
  ).toBe(false);
  expect(
    c.ProjectGoalCreateSchema.safeParse({
      id: randomUUID(),
      title: 'Goal',
      timezone: 'invalid zone',
      horizon: 'LONG_TERM',
    }).success,
  ).toBe(false);
});
it('publishes exactly the implemented Project operation set and carries proofs only in headers', () => {
  const paths = projectPaths();
  expect(Object.values(paths).flatMap(Object.keys)).toHaveLength(44);
  const preview = paths['/api/v1/resource-invitations/preview']!.get as {
    security: unknown[];
    parameters: { in: string; name: string }[];
  };
  expect(preview.security).toEqual([]);
  expect(
    preview.parameters.some(
      (p) => p.in === 'header' && p.name === 'X-Invitation-Proof',
    ),
  ).toBe(true);
  expect(
    preview.parameters.some((p) => p.in === 'query' && /proof/i.test(p.name)),
  ).toBe(false);
  const list = paths['/api/v1/projects/{id}/tasks']!.get as {
    parameters: { in: string; name: string; schema: Record<string, unknown> }[];
  };
  expect(list.parameters.find((p) => p.name === 'after')!.schema).toMatchObject(
    { maxLength: 2048 },
  );
});
