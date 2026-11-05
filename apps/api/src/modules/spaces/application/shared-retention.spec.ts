import { it, expect } from 'vitest';
import { SharedRetentionSchema } from './shared-retention.js';
import { randomUUID } from 'node:crypto';
const rule = {
  retainAfterClosureSeconds: 0,
  audience: [],
  exportAuthority: [],
  disposalAction: 'PURGE',
};
const policy = () => ({
  policyVersion: 'SYNTHETIC',
  approvalReference: 'SYNTHETIC',
  accountableOperator: 'SYNTHETIC',
  marketScope: 'SYNTHETIC',
  applicableContexts: ['PROJECT'],
  sharedRecoverySeconds: 2592000,
  classRules: {
    workContent: rule,
    commentsHistory: rule,
    filesDerivatives: rule,
    exports: rule,
    accessAuditLifecycle: rule,
  },
  backupPolicyReference: 'SYNTHETIC',
  holds: [] as unknown[],
  obligations: [] as unknown[],
});
const hold = (id: string = randomUUID()) => ({
  id,
  basis: 'SYNTHETIC',
  authority: 'SYNTHETIC',
  scope: 'PROJECT',
  nextReviewAt: '2030-01-01T00:00:00Z',
  state: 'ACTIVE',
  releaseEvidence: null,
});
const obligation = (id: string = randomUUID()) => ({
  id,
  basis: 'SYNTHETIC',
  responsibleOperator: 'SYNTHETIC',
  nextReviewAt: '2030-01-01T00:00:00Z',
  state: 'OUTSTANDING',
  releaseEvidence: null,
});
it('rejects duplicate IDs within holds, within obligations and across their complete namespace', () => {
  const id = randomUUID();
  for (const patch of [
    { holds: [hold(id), hold(id)] },
    { holds: [hold(id), hold(id.toUpperCase())] },
    { obligations: [obligation(id), obligation(id)] },
    { holds: [hold(id)], obligations: [obligation(id)] },
  ])
    expect(
      SharedRetentionSchema.safeParse({ ...policy(), ...patch }).success,
    ).toBe(false);
  expect(
    SharedRetentionSchema.safeParse({
      ...policy(),
      holds: [hold(), hold()],
      obligations: [obligation()],
    }).success,
  ).toBe(true);
});
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
