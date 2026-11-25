import { expect, it } from 'vitest';
import type { Prisma } from '../../../generated/prisma/client.js';
import {
  RecipientInvitationAuthority,
  validatedRecipientInvitation,
} from './recipient-invitation-authority.js';

it('binds recipient metadata authorization to its checked transaction and immutable target', () => {
  const tx = {} as Prisma.TransactionClient;
  const row = {
    id: 'offer',
    spaceId: 'space',
    scopeId: 'scope',
    companyScopeId: null,
  };
  expect(() => new RecipientInvitationAuthority(Symbol(), tx, row)).toThrow();
  const authority = validatedRecipientInvitation(tx, row);
  row.scopeId = 'different';
  expect(authority.require(tx).scopeId).toBe('scope');
  expect(Object.isFrozen(authority.require(tx))).toBe(true);
  expect(() => authority.require({} as Prisma.TransactionClient)).toThrow();
});
