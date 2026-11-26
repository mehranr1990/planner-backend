import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import {
  adminP5MigrationName,
  adminP5ClockMigrationName,
  adminP5ClosureMigrationName,
  assertReviewedAdminP5Migration,
  assertReviewedAdminP5ClockMigration,
  assertReviewedAdminP5ClosureMigration,
} from '../testing/reviewed-admin-p5-migration.js';
it('freezes P5 SQL, append-only financial guards and additive term history', () => {
  const migrations = [
    [adminP5MigrationName, assertReviewedAdminP5Migration],
    [adminP5ClockMigrationName, assertReviewedAdminP5ClockMigration],
    [adminP5ClosureMigrationName, assertReviewedAdminP5ClosureMigration],
  ] as const;
  let tables = 0;
  for (const [name, assertReviewed] of migrations) {
    const sql = readFileSync(
      'prisma/migrations/' + name + '/migration.sql',
      'utf8',
    );
    expect(() => assertReviewed(sql)).not.toThrow();
    expect(() => assertReviewed(sql + '\n')).toThrow();
    expect(sql).not.toMatch(
      /DROP TABLE|TRUNCATE|DELETE FROM|ALTER TABLE "User"/,
    );
    tables += (sql.match(/CREATE TABLE/g) ?? []).length;
  }
  expect(tables).toBe(27);
  const financial = readFileSync(
    'prisma/migrations/' + adminP5MigrationName + '/migration.sql',
    'utf8',
  );
  expect(financial).toContain('INVOICE_ADJUSTMENT_REQUIRED');
  expect(financial).toContain('IMMUTABLE_PAYMENT_HISTORY');
  expect(financial).toContain('NO_SUBSCRIPTION_TRANSFER_OR_ERASURE');
});
