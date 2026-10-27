import { describe, expect, it } from 'vitest';
import { SpacePolicyService } from './space-policy.service.js';

describe('personal space policy', () => {
  const policy = new SpacePolicyService();
  it('allows only the explicit personal owner', () => {
    expect(() =>
      policy.assertOwner('owner', {
        id: 'space',
        kind: 'PERSONAL',
        ownerUserId: 'owner',
      }),
    ).not.toThrow();
    for (const space of [
      undefined,
      null,
      { id: 'space', kind: 'PERSONAL', ownerUserId: 'other' },
      { id: 'space', kind: 'COMPANY', ownerUserId: 'owner' },
    ])
      expect(() => policy.assertOwner('owner', space)).toThrow('Not Found');
  });
});
