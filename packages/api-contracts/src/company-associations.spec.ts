import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  CompanyAssociationCreateSchema,
  CompanyAssociationActionSchema,
} from './company-associations.js';
it('permits only explicit typed administrative references, rejecting custody, role and historical disclosure payloads', () => {
  const body = { id: randomUUID(), sourceId: randomUUID(), kind: 'PROJECT' };
  expect(CompanyAssociationCreateSchema.safeParse(body).success).toBe(true);
  for (const field of [
    'spaceId',
    'ownerId',
    'memberships',
    'includeHistory',
    'consent',
    'transfer',
  ])
    expect(
      CompanyAssociationCreateSchema.safeParse({ ...body, [field]: true })
        .success,
    ).toBe(false);
  expect(
    CompanyAssociationCreateSchema.safeParse({ ...body, kind: 'COMPANY' })
      .success,
  ).toBe(false);
  expect(
    CompanyAssociationActionSchema.safeParse({ side: 'SOURCE' }).success,
  ).toBe(true);
  expect(
    CompanyAssociationActionSchema.safeParse({ side: 'ORG_ADMIN' }).success,
  ).toBe(false);
});
