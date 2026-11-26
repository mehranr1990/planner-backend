import fs from 'node:fs';
import { it, expect } from 'vitest';
import {
  adminP7MigrationName,
  assertReviewedAdminP7Migration,
} from '../testing/reviewed-admin-p7-migration.js';
import {
  adminP7OrderMigrationName,
  assertReviewedAdminP7OrderMigration,
  adminP7FenceMigrationName,
  assertReviewedAdminP7FenceMigration,
  adminP7ContextMigrationName,
  assertReviewedAdminP7ContextMigration,
} from '../testing/reviewed-admin-p7-migration.js';
it.each([
  [adminP7OrderMigrationName, assertReviewedAdminP7OrderMigration],
  [adminP7FenceMigrationName, assertReviewedAdminP7FenceMigration],
  [adminP7ContextMigrationName, assertReviewedAdminP7ContextMigration],
] as const)(
  'freezes reviewed P7 privacy/context migration %s',
  (name, check) => {
    const sql = fs.readFileSync(
      'prisma/migrations/' + name + '/migration.sql',
      'utf8',
    );
    expect(() => check(sql)).not.toThrow();
    expect(() => check(sql + '\n')).toThrow();
    expect(sql).not.toMatch(/DROP TABLE|TRUNCATE|ALTER TABLE "User"/);
  },
);
it('freezes P7 metadata-only persistence with typed erasure and retention constraints', () => {
  const sql = fs.readFileSync(
    'prisma/migrations/' + adminP7MigrationName + '/migration.sql',
    'utf8',
  );
  expect(() => assertReviewedAdminP7Migration(sql)).not.toThrow();
  expect(() => assertReviewedAdminP7Migration(sql + '\n')).toThrow();
  expect(sql.match(/CREATE TABLE /g)).toHaveLength(5);
  expect(sql).toContain('"minimumCohort" BETWEEN 5 AND 100');
  expect(sql).not.toMatch(/ALTER TABLE|DROP TABLE|TRUNCATE/);
});

import {
  adminP7FinancialMigrationName,
  assertReviewedAdminP7FinancialMigration,
} from '../testing/reviewed-admin-p7-migration.js';
it('freezes the additive financial-report discriminator', () => {
  const sql = fs.readFileSync(
    'prisma/migrations/' + adminP7FinancialMigrationName + '/migration.sql',
    'utf8',
  );
  expect(() => assertReviewedAdminP7FinancialMigration(sql)).not.toThrow();
  expect(() => assertReviewedAdminP7FinancialMigration(sql + '\n')).toThrow();
  expect(sql).toContain("DEFAULT 'PRODUCT'");
});
