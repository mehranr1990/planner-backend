import { it, expect } from 'vitest';
import {
  evaluateRules,
  rolloutBucket,
  configurationDiff,
  type EvaluationRule,
} from './evaluation.js';
const definition = 'definition-opaque',
  now = new Date('2026-11-26T00:00:00.000Z');
const rule = (
  kind: string,
  position: number,
  value: boolean,
  priority = 0,
): EvaluationRule => ({
  position,
  priority,
  target: {
    kind,
    userId: 'u',
    workspaceId: 'w',
    groupId: 'g',
    scopeType: 'TEAM',
  },
  value,
  basisPoints: 10000,
  steps: [],
});
it('orders every targeting specificity and uses explicit priority then position for ties', () => {
  const subject = {
      userId: 'u',
      workspaceId: 'w',
      scopeType: 'TEAM',
      groups: ['g'],
    },
    rules = ['GLOBAL', 'SCOPE_TYPE', 'GROUP', 'WORKSPACE', 'USER'].map((k, i) =>
      rule(k, i, i % 2 === 0),
    );
  for (let i = 4; i >= 0; i--) {
    expect(
      evaluateRules(definition, false, rules.slice(0, i + 1), subject, now)
        .source,
    ).toBe(rules[i]!.target.kind);
  }
  expect(
    evaluateRules(
      definition,
      false,
      [
        rule('GROUP', 2, false),
        rule('GROUP', 4, true, 1),
        rule('GROUP', 1, false, 1),
      ],
      subject,
      now,
    ),
  ).toMatchObject({ value: false, rulePosition: 1 });
});
it('keeps stable cohorts, handles zero/full rollout, and never invents an anonymous percentage identity', () => {
  const r = { ...rule('GLOBAL', 0, true), basisPoints: 5000 };
  const first = evaluateRules(
    definition,
    false,
    [r],
    { userId: 'u', groups: [] },
    now,
  );
  expect(first.bucket).toBe(rolloutBucket(definition, 'u'));
  expect(
    evaluateRules(
      definition,
      false,
      [r],
      { userId: 'u', groups: [] },
      new Date(+now + 86400000),
    ),
  ).toEqual(first);
  expect(evaluateRules(definition, false, [r], { groups: [] }, now).value).toBe(
    false,
  );
  expect(
    evaluateRules(
      definition,
      false,
      [{ ...r, basisPoints: 0 }],
      { userId: 'u', groups: [] },
      now,
    ).value,
  ).toBe(false);
  expect(
    evaluateRules(
      definition,
      false,
      [{ ...r, basisPoints: 10000 }],
      { groups: [] },
      now,
    ).value,
  ).toBe(true);
  const buckets = new Set(
    Array.from({ length: 1000 }, (_, i) =>
      rolloutBucket(definition, String(i)),
    ),
  );
  expect(buckets.size).toBeGreaterThan(900);
});
it('evaluates exact UTC step boundaries without changing the bucket or prior values', () => {
  const r = {
    ...rule('USER', 0, true),
    basisPoints: 0,
    steps: [{ at: now.toISOString(), basisPoints: 10000 }],
  };
  expect(
    evaluateRules(
      definition,
      false,
      [r],
      { userId: 'u', groups: [] },
      new Date(+now - 1),
    ).value,
  ).toBe(false);
  expect(
    evaluateRules(definition, false, [r], { userId: 'u', groups: [] }, now)
      .value,
  ).toBe(true);
  expect(
    configurationDiff({ value: false, rules: [] }, { value: true, rules: [] }),
  ).toEqual([{ path: 'value', before: false, after: true }]);
});
it('uses the Workspace identity for scope/Workspace cohorts so members share rollout assignment', () => {
  const r = { ...rule('WORKSPACE', 0, true), basisPoints: 10000 };
  const a = evaluateRules(
      definition,
      false,
      [r],
      { userId: 'u', workspaceId: 'w', groups: [] },
      now,
    ),
    b = evaluateRules(
      definition,
      false,
      [r],
      { userId: 'different-member', workspaceId: 'w', groups: [] },
      now,
    );
  expect(a.bucket).toBe(rolloutBucket(definition, 'w'));
  expect(b.bucket).toBe(a.bucket);
});
