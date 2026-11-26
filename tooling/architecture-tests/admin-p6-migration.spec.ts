import fs from 'node:fs';
import { it, expect } from 'vitest';
import {
  adminP6MigrationName,
  assertReviewedAdminP6Migration,
  adminP6ScheduleMigrationName,
  assertReviewedAdminP6ScheduleMigration,
} from '../testing/reviewed-admin-p6-migration.js';
it('freezes additive P6 history and preserves the original P2 non-self-approval checks', () => {
  const sql = fs.readFileSync(
    'prisma/migrations/' + adminP6MigrationName + '/migration.sql',
    'utf8',
  );
  expect(() => assertReviewedAdminP6Migration(sql)).not.toThrow();
  expect(() => assertReviewedAdminP6Migration(sql + '\n')).toThrow();
  expect(sql).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM|ALTER TABLE "User"/);
  expect(sql.match(/CREATE TABLE /g)).toHaveLength(7);
  expect(sql).toContain('DROP CONSTRAINT "AdminSecurityApproval_check2"');
  expect(sql).not.toContain('DROP CONSTRAINT "AdminSecurityApproval_check"');
});

it('freezes the durable readiness-gated release schedule', () => {
  const sql = fs.readFileSync(
    'prisma/migrations/' + adminP6ScheduleMigrationName + '/migration.sql',
    'utf8',
  );
  expect(() => assertReviewedAdminP6ScheduleMigration(sql)).not.toThrow();
  expect(() => assertReviewedAdminP6ScheduleMigration(sql + '\n')).toThrow();
  expect(sql).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/);
});
