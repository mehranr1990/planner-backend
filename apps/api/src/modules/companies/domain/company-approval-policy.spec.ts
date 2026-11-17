import { it, expect } from 'vitest';
import { matchingTier, validTiers } from './company-approval-policy.js';
const base = {
  currency: 'USD',
  categoryId: null,
  workflowVersionId: 'version',
  escalateAfterSeconds: null,
};
it('selects exact half-open monetary tiers without floating point rounding', () => {
  const rules = [
    { ...base, minimum: '0', maximum: '100.01' },
    { ...base, minimum: '100.01', maximum: null },
  ];
  expect(validTiers(rules)).toBe(true);
  expect(
    matchingTier(rules, {
      currency: 'USD',
      amount: '100.0100',
      categoryId: null,
    }),
  ).toEqual([rules[1]]);
  expect(
    matchingTier(rules, {
      currency: 'EUR',
      amount: '100.01',
      categoryId: null,
    }),
  ).toEqual([]);
});
it('rejects wildcard/category overlaps and inverted tiers', () => {
  expect(
    validTiers([
      { ...base, minimum: '0', maximum: null },
      { ...base, minimum: '2', maximum: '3', categoryId: 'cat' },
    ]),
  ).toBe(false);
  expect(validTiers([{ ...base, minimum: '2', maximum: '1' }])).toBe(false);
});
