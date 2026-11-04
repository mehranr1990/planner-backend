import { it, expect } from 'vitest';
import { SharedRetentionSchema } from './shared-retention.js';
it('requires explicit complete shared retention without Personal-policy fallback', () => {
  for (const value of [
    {},
    { sharedRecoverySeconds: 604800 },
    {
      sharedRecoverySeconds: 2592000,
      approvalReference: 'SYNTHETIC_REHEARSAL',
    },
  ])
    expect(SharedRetentionSchema.safeParse(value).success).toBe(false);
});
