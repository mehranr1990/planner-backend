import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SharedRetentionSchema } from './shared-retention.js';
import { retentionTransition } from './retention-transition.js';

const rule = (seconds: number) => ({
  retainAfterClosureSeconds: seconds,
  audience: ['OWNER', 'ADMIN'] as const,
  exportAuthority: ['OWNER'] as const,
  disposalAction: 'PURGE' as const,
});
const policy = (seconds: number, extra: Record<string, unknown> = {}) =>
  SharedRetentionSchema.parse({
    policyVersion: 'v' + seconds,
    approvalReference: 'fixture',
    accountableOperator: 'fixture operator',
    applicableContexts: ['TEAM', 'PROJECT'],
    marketScope: 'fixture',
    sharedRecoverySeconds: 2592000,
    classRules: {
      workContent: rule(seconds),
      commentsHistory: rule(seconds),
      filesDerivatives: rule(seconds),
      exports: rule(seconds),
      accessAuditLifecycle: rule(seconds),
    },
    obligations: [],
    holds: [],
    backupPolicyReference: 'fixture',
    ...extra,
  });

describe('retention policy transitions', () => {
  it('allows only strictly longer, comparable and applicable policies', () => {
    expect(retentionTransition(policy(10), policy(20), 'TEAM')).toBeNull();
    expect(retentionTransition(policy(20), policy(10), 'TEAM')).toBe(
      'RETENTION_SHORTENING_FORBIDDEN',
    );
    expect(retentionTransition(policy(10), policy(10), 'TEAM')).toBe(
      'RETENTION_NOT_INCREASED',
    );
    expect(retentionTransition(policy(10), policy(20), 'COMPANY')).toBe(
      'RETENTION_NOT_APPLICABLE',
    );
    expect(
      retentionTransition(
        policy(10),
        policy(20, { marketScope: 'elsewhere' }),
        'TEAM',
      ),
    ).toBe('RETENTION_NOT_COMPARABLE');
    const pseudo = policy(20);
    pseudo.classRules.exports.disposalAction = 'PSEUDONYMIZE';
    expect(retentionTransition(policy(10), pseudo, 'TEAM')).toBe(
      'RETENTION_NOT_COMPARABLE',
    );
  });
  it('never drops an active hold or outstanding obligation', () => {
    const hold = {
      id: randomUUID(),
      basis: 'litigation',
      authority: 'counsel',
      scope: 'all',
      nextReviewAt: '2031-01-01T00:00:00.000Z',
      state: 'ACTIVE',
      releaseEvidence: null,
    };
    expect(
      retentionTransition(policy(10, { holds: [hold] }), policy(20), 'TEAM'),
    ).toBe('RETENTION_HOLD_DROPPED');
    expect(
      retentionTransition(
        policy(10, { holds: [hold] }),
        policy(20, { holds: [hold] }),
        'TEAM',
      ),
    ).toBeNull();
  });
});
