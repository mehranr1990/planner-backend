import fs from 'node:fs';
import { it, expect } from 'vitest';
import {
  companyStaffMigrationName,
  assertReviewedCompanyStaffMigration,
} from '../testing/reviewed-company-staff-migration.js';
it('pins additive staff tables, typed admissions, immutable evidence and exclusive allocations', () => {
  const sql = fs.readFileSync(
    'prisma/migrations/' + companyStaffMigrationName + '/migration.sql',
    'utf8',
  );
  expect(() =>
    assertReviewedCompanyStaffMigration(companyStaffMigrationName, sql),
  ).not.toThrow();
  expect(() =>
    assertReviewedCompanyStaffMigration(companyStaffMigrationName, sql + ' '),
  ).toThrow();
  expect(sql.match(/CREATE TABLE/g)).toHaveLength(6);
  expect(sql).toContain('FOR UPDATE');
  expect(sql).toContain("USING ERRCODE='23P01'");
  expect(sql).toContain('Append only case history');
  expect(sql).toContain('Redaction is irreversible');
  expect(sql).not.toMatch(
    /ON DELETE CASCADE|ALTER TABLE "Task"|ALTER TABLE "Goal"|UPDATE "User"|CREATE EXTENSION|shared_purge_allowed/,
  );
});
