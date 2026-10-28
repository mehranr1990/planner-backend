import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
  reviewedFinanceMigrationName,
  assertReviewedFinanceMigration,
} from '../../../../../tooling/testing/reviewed-finance-migration.js';
import {
  assertAdditiveMigration,
  reviewMigrations,
} from '../../../../../tooling/testing/migration-safety.js';
describe('ADR0016 exact Capture CHECK expansion', () => {
  const sql = fs.readFileSync(
    'prisma/migrations/' + reviewedFinanceMigrationName + '/migration.sql',
    'utf8',
  );
  it('accepts exact name and bytes only', () => {
    expect(() =>
      assertReviewedFinanceMigration(reviewedFinanceMigrationName, sql),
    ).not.toThrow();
    expect(reviewMigrations()).toContain(reviewedFinanceMigrationName);
  });
  it('keeps generic destructive SQL rejection', () => {
    expect(() => assertAdditiveMigration(sql)).toThrow();
  });
  it('rejects extra operations, changed target list, removed transaction and renamed migration', () => {
    for (const changed of [
      sql + 'DROP TABLE "Transaction";',
      sql.replace('BEGIN;', ''),
      sql.replace('"targetTaskId",', ''),
      sql.replace('"targetTransactionId"', '"voiceFileId"'),
    ])
      expect(() =>
        assertReviewedFinanceMigration(reviewedFinanceMigrationName, changed),
      ).toThrow();
    expect(() => assertReviewedFinanceMigration('unapproved', sql)).toThrow();
  });
});
