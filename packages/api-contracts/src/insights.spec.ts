import { describe, it, expect } from 'vitest';
import {
  InsightQuerySchema,
  RewardPreferencesPatchSchema,
  RewardRecalculateSchema,
} from './insights.js';
import { createOpenApiDocument } from './openapi.js';
import { assertApiCompatible } from '../../../tooling/compatibility/openapi-compatibility.js';
import fs from 'node:fs';
describe('P1-11 strict contracts and earlier API compatibility', () => {
  const q = { from: '2024-01-01', to: '2024-02-01' };
  it('normalizes default grouping/cohort and validates timezone', () => {
    expect(InsightQuerySchema.parse(q).cohort).toBe('DUE_DATE');
    expect(
      InsightQuerySchema.safeParse({ ...q, timezone: 'Not/AZone' }).success,
    ).toBe(false);
  });
  it.each(['includeMood', 'includeJournal', 'spaceId', 'ownerUserId', 'score'])(
    'rejects unsupported/private option %s',
    (key) =>
      expect(
        InsightQuerySchema.safeParse({ ...q, [key]: 'true' }).success,
      ).toBe(false),
  );
  it('rejects invalid dates, unbounded and empty ranges', () => {
    expect(
      InsightQuerySchema.safeParse({ from: '1900-01-01', to: '1900-01-02' })
        .success,
    ).toBe(false);
    for (const bad of [
      { ...q, from: '2024-02-30' },
      { ...q, to: '2026-01-01' },
      { ...q, to: q.from },
    ])
      expect(InsightQuerySchema.safeParse(bad).success).toBe(false);
  });
  it('accepts explicit finance consent only', () => {
    expect(
      InsightQuerySchema.parse({ ...q, includeFinance: 'true' }).includeFinance,
    ).toBe('true');
    expect(
      InsightQuerySchema.safeParse({ ...q, includeFinance: 'yes' }).success,
    ).toBe(false);
  });
  it('does not allow callers to forge preference timestamps or XP', () => {
    expect(
      RewardPreferencesPatchSchema.safeParse({
        enabled: true,
        displayAchievements: true,
        enabledSince: '2024-01-01T00:00:00Z',
      }).success,
    ).toBe(false);
    expect(RewardRecalculateSchema.safeParse({ points: 999 }).success).toBe(
      false,
    );
  });
  it('retains every accepted P1-10 API signature', () =>
    expect(() =>
      assertApiCompatible(
        createOpenApiDocument(),
        JSON.parse(
          fs.readFileSync(
            'tooling/compatibility/p1-10-api-signatures.json',
            'utf8',
          ),
        ) as Record<string, string>,
      ),
    ).not.toThrow());
});
