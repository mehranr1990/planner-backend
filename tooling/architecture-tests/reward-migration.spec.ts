import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { assertAdditiveMigration } from '../testing/migration-safety.js';
import {
  assertReviewedRewardsMigration,
  reviewedRewardsMigrationName,
} from '../testing/reviewed-rewards-migration.js';
describe('ADR0021 exact catalog seed exception', () => {
  const sql = fs.readFileSync(
    `prisma/migrations/${reviewedRewardsMigrationName}/migration.sql`,
    'utf8',
  );
  it('accepts only the exact owner-reviewed migration', () =>
    expect(() =>
      assertReviewedRewardsMigration(reviewedRewardsMigrationName, sql),
    ).not.toThrow());
  it('rejects byte drift including whitespace and changed point rules', () => {
    expect(() =>
      assertReviewedRewardsMigration(reviewedRewardsMigrationName, sql + ' '),
    ).toThrow();
    expect(() =>
      assertReviewedRewardsMigration(
        reviewedRewardsMigrationName,
        sql.replace("'TASK',10", "'TASK',99"),
      ),
    ).toThrow();
  });
  it('does not permit a renamed seed or general data-changing SQL', () => {
    expect(() => assertReviewedRewardsMigration('other', sql)).toThrow();
    expect(() => assertAdditiveMigration(sql)).toThrow();
    expect(() =>
      assertAdditiveMigration(
        'INSERT INTO "AchievementDefinition" VALUES (1);',
      ),
    ).toThrow();
  });
  it('keeps the provenance migration under the general additive gate', () =>
    expect(() =>
      assertAdditiveMigration(
        fs.readFileSync(
          'prisma/migrations/202610290005_p1_11_habit_event_provenance/migration.sql',
          'utf8',
        ),
      ),
    ).not.toThrow());
});
